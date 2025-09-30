import { randomUUID } from 'crypto'
import { join, basename } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { database } from '../database/database'
import { ffmpegService } from './ffmpegService'

export interface ExportOptions {
  aspectRatio?: '9:16' | '1:1' | '16:9'
  includeCaptions?: boolean
  outputDirectory?: string
}

export interface ExportJob {
  id: string
  episodeId: string
  clipIds: string[]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  currentClipIndex: number
  totalClips: number
  outputPaths: string[]
  error?: string
}

class ExportService {
  private activeJobs: Map<string, ExportJob> = new Map()

  /**
   * Export approved clips from an episode
   */
  async exportApprovedClips(
    episodeId: string,
    options: ExportOptions = {},
    onProgress?: (job: ExportJob) => void
  ): Promise<ExportJob> {
    // Get episode and clips
    const episode = database.getEpisode(episodeId)
    if (!episode) {
      throw new Error(`Episode not found: ${episodeId}`)
    }

    const approvedClips = database.getApprovedClips(episodeId)
    if (approvedClips.length === 0) {
      throw new Error('No approved clips to export')
    }

    // Select or prompt for output directory
    let outputDirectory = options.outputDirectory
    if (!outputDirectory) {
      const result = await dialog.showOpenDialog({
        title: 'Select Export Directory',
        properties: ['openDirectory', 'createDirectory']
      })

      if (result.canceled || result.filePaths.length === 0) {
        throw new Error('Export cancelled by user')
      }

      outputDirectory = result.filePaths[0]
    }

    // Ensure output directory exists
    if (!existsSync(outputDirectory)) {
      mkdirSync(outputDirectory, { recursive: true })
    }

    // Create export job
    const jobId = randomUUID()
    const job: ExportJob = {
      id: jobId,
      episodeId,
      clipIds: approvedClips.map((c: any) => c.id),
      status: 'pending',
      progress: 0,
      currentClipIndex: 0,
      totalClips: approvedClips.length,
      outputPaths: []
    }

    this.activeJobs.set(jobId, job)

    // Start export process
    this.processExportJob(job, episode, approvedClips, outputDirectory, options, onProgress)
      .catch(error => {
        job.status = 'failed'
        job.error = error.message
        onProgress?.(job)
      })

    return job
  }

  /**
   * Process export job
   */
  private async processExportJob(
    job: ExportJob,
    episode: any,
    clips: any[],
    outputDirectory: string,
    options: ExportOptions,
    onProgress?: (job: ExportJob) => void
  ): Promise<void> {
    job.status = 'processing'
    onProgress?.(job)

    const inputPath = episode.file_path
    const aspectRatio = options.aspectRatio || '9:16'
    const includeCaptions = options.includeCaptions !== false // Default true

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      job.currentClipIndex = i

      try {
        // Get clip title for filename
        let clipTitle = 'clip'
        if (includeCaptions) {
          const titles = database.getClipTitles(clip.id)
          if (titles && titles.length > 0) {
            const selectedTitle: any = titles.find((t: any) => t.is_selected) || titles[0]
            clipTitle = this.sanitizeFilename(selectedTitle.title)
          }
        }

        // Generate output path
        const outputFilename = `${clipTitle}_${Date.now()}.mp4`
        const outputPath = join(outputDirectory, outputFilename)

        // Get captions if needed
        let captions: string | undefined
        if (includeCaptions) {
          const clipCaptions = clip.key_quote || clip.reason
          if (clipCaptions) {
            // Limit caption length for display
            captions = clipCaptions.length > 100
              ? clipCaptions.substring(0, 97) + '...'
              : clipCaptions
          }
        }

        // Export clip with FFmpeg
        await ffmpegService.exportReelClip(
          inputPath,
          clip.start_time,
          clip.duration,
          outputPath,
          {
            captions,
            aspectRatio,
            onProgress: (clipProgress) => {
              // Calculate overall progress
              const overallProgress = ((i + (clipProgress / 100)) / clips.length) * 100
              job.progress = Math.round(overallProgress)
              onProgress?.(job)
            }
          }
        )

        job.outputPaths.push(outputPath)

      } catch (error) {
        console.error(`Failed to export clip ${clip.id}:`, error)
        throw new Error(`Failed to export clip ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Mark job as completed
    job.status = 'completed'
    job.progress = 100
    onProgress?.(job)
  }

  /**
   * Get export job status
   */
  getJob(jobId: string): ExportJob | undefined {
    return this.activeJobs.get(jobId)
  }

  /**
   * Cancel export job
   */
  cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId)
    if (!job) {
      return false
    }

    if (job.status === 'processing') {
      job.status = 'failed'
      job.error = 'Cancelled by user'
      return true
    }

    return false
  }

  /**
   * Clear completed jobs
   */
  clearCompletedJobs(): void {
    for (const [jobId, job] of this.activeJobs.entries()) {
      if (job.status === 'completed' || job.status === 'failed') {
        this.activeJobs.delete(jobId)
      }
    }
  }

  /**
   * Sanitize filename for safe file system usage
   */
  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-z0-9\s-]/gi, '') // Remove special characters
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .toLowerCase()
      .substring(0, 50) // Limit length
  }
}

export const exportService = new ExportService()