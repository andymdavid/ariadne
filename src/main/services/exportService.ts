import { randomUUID } from 'crypto'
import { join, basename } from 'path'
import { BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { database } from '../database/database'
import { ffmpegService } from './ffmpegService'

interface ClipEditsRow {
  captions_enabled?: number
  caption_segments?: string | null
  caption_font?: string | null
  caption_size?: number | null
  caption_color?: string | null
  caption_position?: string | null
  caption_custom_x?: number | null
  caption_custom_y?: number | null
  caption_bold?: number | null
  caption_weight?: number | null
  caption_italic?: number | null
  caption_outline?: number | null
  caption_outline_color?: string | null
  caption_outline_width?: number | null
  caption_shadow?: number | null
  caption_highlight_style?: string | null
  caption_background?: number | null
  caption_background_color?: string | null
  caption_background_opacity?: number | null
  caption_text_case?: string | null
  caption_words_per_caption?: number | null
  caption_max_width?: number | null
  caption_line_height?: number | null
  caption_letter_spacing?: number | null
  logo_enabled?: number | null
  logo_path?: string | null
  logo_position_x?: number | null
  logo_position_y?: number | null
  logo_scale?: number | null
  logo_opacity?: number | null
  music_enabled?: number | null
  music_path?: string | null
  music_volume?: number | null
  music_duck_volume?: number | null
  music_duck_enabled?: number | null
  music_fade_in?: number | null
  music_fade_out?: number | null
  music_loop?: number | null
  aspect_ratio?: '9:16' | '1:1' | '16:9' | null
  crop_mode?: 'center' | 'fit' | 'blur' | 'canvas' | null
  crop_position_x?: number | null
  crop_position_y?: number | null
  zoom_level?: number | null
  video_offset_x?: number | null
  video_offset_y?: number | null
}

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
    const includeCaptions = options.includeCaptions !== false // Default true

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      job.currentClipIndex = i

      try {
        // Get clip edits from database
        console.log(`========================================`)
        console.log(`[ExportService] ⭐ PROCESSING CLIP ${i + 1}/${clips.length}`)
        console.log(`[ExportService] Clip ID: ${clip.id}`)
        const clipEdits = database.getClipEdits(clip.id) as ClipEditsRow | undefined
        console.log(`[ExportService] Clip edits loaded:`, clipEdits ? 'YES' : 'NO')
        if (clipEdits) {
          console.log(`[ExportService] - Captions enabled: ${clipEdits.captions_enabled}`)
          console.log(`[ExportService] - Logo enabled: ${clipEdits.logo_enabled}`)
          console.log(`[ExportService] - Music enabled: ${clipEdits.music_enabled}`)
          console.log(`[ExportService] - Aspect ratio: ${clipEdits.aspect_ratio}`)
        }
        console.log(`========================================`)

        // Get clip title for filename
        let clipTitle = 'clip'
        const titles = database.getClipTitles(clip.id)
        if (titles && titles.length > 0) {
          const selectedTitle: any = titles.find((t: any) => t.is_selected) || titles[0]
          clipTitle = this.sanitizeFilename(selectedTitle.title)
        }

        // Generate output path
        const outputFilename = `${clipTitle}_${Date.now()}.mp4`
        const outputPath = join(outputDirectory, outputFilename)

        // Parse caption segments from database
        let captionSegments: any[] = []
        if (includeCaptions && clipEdits && clipEdits.captions_enabled) {
          try {
            captionSegments = JSON.parse(clipEdits.caption_segments || '[]')
            console.log(`[ExportService] Parsed ${captionSegments.length} caption segments`)
          } catch (error) {
            console.error('[ExportService] Failed to parse caption segments:', error)
          }
        }

        // Build caption style from database or defaults
        const captionStyle = clipEdits ? {
          enabled: clipEdits.captions_enabled === 1,
          font: clipEdits.caption_font || 'Inter',
          size: clipEdits.caption_size || 48,
          color: clipEdits.caption_color || '#FFFFFF',
          position: clipEdits.caption_position || 'bottom',
          customX: clipEdits.caption_custom_x ?? undefined,
          customY: clipEdits.caption_custom_y ?? undefined,
          weight: clipEdits.caption_weight || (clipEdits.caption_bold === 1 ? 700 : 400), // Use weight, fallback to bold
          italic: clipEdits.caption_italic === 1,
          outline: clipEdits.caption_outline === 1,
          outlineColor: clipEdits.caption_outline_color || '#000000',
          outlineWidth: clipEdits.caption_outline_width || 2,
          shadow: clipEdits.caption_shadow === 1,
          highlightStyle: clipEdits.caption_highlight_style || 'word',
          background: clipEdits.caption_background === 1,
          backgroundColor: clipEdits.caption_background_color || '#000000',
          backgroundOpacity: clipEdits.caption_background_opacity || 0.5,
          textCase: clipEdits.caption_text_case || 'normal',
          wordsPerCaption: clipEdits.caption_words_per_caption || 3,
          maxWidth: clipEdits.caption_max_width ?? 90,
          lineHeight: clipEdits.caption_line_height ?? 1.2,
          letterSpacing: clipEdits.caption_letter_spacing ?? 0
        } : undefined

        // Build logo settings from database
        const logoSettings = clipEdits && clipEdits.logo_enabled ? {
          enabled: true,
          logoPath: clipEdits.logo_path ?? null,
          positionX: clipEdits.logo_position_x ?? 85,
          positionY: clipEdits.logo_position_y ?? 85,
          scale: clipEdits.logo_scale ?? 0.15,
          opacity: clipEdits.logo_opacity ?? 0.8
        } : undefined

        // Build music settings from database
        const musicSettings = clipEdits && clipEdits.music_enabled ? {
          enabled: true,
          musicPath: clipEdits.music_path ?? null,
          volume: clipEdits.music_volume ?? 0.3,
          duckVolume: clipEdits.music_duck_volume ?? 0.1,
          duckEnabled: clipEdits.music_duck_enabled === 1,
          fadeIn: clipEdits.music_fade_in ?? 1.0,
          fadeOut: clipEdits.music_fade_out ?? 1.0,
          loop: clipEdits.music_loop === 1
        } : undefined

        // Build frame settings from database
        const normalizedCropMode = clipEdits?.crop_mode === 'canvas' ? 'fit' : clipEdits?.crop_mode
        const frameSettings = clipEdits ? {
          aspectRatio: (clipEdits.aspect_ratio || '9:16') as '9:16' | '1:1' | '16:9',
          cropMode: (normalizedCropMode || 'center') as 'center' | 'fit' | 'blur',
          cropPositionX: clipEdits.crop_position_x ?? 50,
          cropPositionY: clipEdits.crop_position_y ?? 50,
          zoomLevel: clipEdits.zoom_level ?? 1,
          videoOffsetX: clipEdits.video_offset_x ?? 0,
          videoOffsetY: clipEdits.video_offset_y ?? 0,
          videoWidth: clip.video_width ?? null,
          videoHeight: clip.video_height ?? null
        } : {
          aspectRatio: (options.aspectRatio || '9:16') as '9:16' | '1:1' | '16:9',
          cropMode: 'center' as 'center' | 'fit' | 'blur',
          cropPositionX: 50,
          cropPositionY: 50,
          zoomLevel: 1,
          videoOffsetX: 0,
          videoOffsetY: 0,
          videoWidth: clip.video_width ?? null,
          videoHeight: clip.video_height ?? null
        }

        console.log(`[ExportService] Exporting clip ${clip.id} with settings:`, {
          captionStyle: captionStyle?.enabled,
          captionSegments: captionSegments.length,
          logo: logoSettings?.enabled,
          music: musicSettings?.enabled,
          frame: frameSettings
        })

        // Export clip with FFmpeg using all settings
        await ffmpegService.exportReelClip(
          inputPath,
          clip.start_time,
          clip.duration,
          outputPath,
          {
            captionSegments,
            captionStyle,
            logoSettings,
            musicSettings,
            frameSettings,
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
