import { randomUUID } from 'crypto'
import { join } from 'path'
import { dialog } from 'electron'
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
  private cancelledJobs: Set<string> = new Set()

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

    const approvedClips = database.getApprovedClips(episodeId) as any[]
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

    const now = new Date().toISOString()
    const jobId = randomUUID()
    const clipIds = approvedClips.map((c: any) => c.id)
    const aspectRatio = options.aspectRatio || '9:16'
    const includeCaptions = options.includeCaptions !== false
    const workflowJobId = randomUUID()

    database.createWorkflowJob({
      id: workflowJobId,
      jobType: 'export',
      status: 'pending',
      workerKind: 'main_process',
      projectId: (episode as any).project_id ?? null,
      episodeId,
      clipId: null,
      parentJobId: null,
      progress: 0,
      stage: 'queued',
      message: 'Queued for export',
      inputJson: JSON.stringify({
        episodeId,
        clipIds,
        outputDirectory,
        aspectRatio,
        includeCaptions
      }),
      configSnapshotJson: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      attemptCount: 0,
      maxAttempts: 1,
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    })

    database.createExportJob({
      id: jobId,
      workflowJobId,
      episodeId,
      status: 'pending',
      outputDirectory,
      aspectRatio,
      includeCaptions,
      currentClipIndex: 0,
      totalClips: approvedClips.length,
      progress: 0,
      clipIdsJson: JSON.stringify(clipIds),
      errorMessage: null,
      createdAt: now,
      startedAt: null,
      completedAt: null,
      updatedAt: now
    })

    for (let i = 0; i < approvedClips.length; i++) {
      const clip = approvedClips[i]
      database.createWorkflowStepRun({
        id: randomUUID(),
        jobId: workflowJobId,
        stepKey: 'export_clip',
        status: 'pending',
        stepOrder: i,
        clipId: clip.id,
        attempt: 1,
        progress: 0,
        message: null,
        inputJson: JSON.stringify({
          clipId: clip.id,
          startTime: clip.start_time,
          duration: clip.duration
        }),
        outputJson: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      })

      database.createExportOutput({
        id: randomUUID(),
        exportJobId: jobId,
        clipId: clip.id,
        artifactId: null,
        filePath: '',
        format: 'mp4',
        resolution: aspectRatio,
        metadata: JSON.stringify({
          aspectRatio,
          includeCaptions
        }),
        status: 'pending',
        errorMessage: null,
        createdAt: now
      })
    }

    // Create export job view for runtime compatibility
    const job: ExportJob = {
      id: jobId,
      episodeId,
      clipIds,
      status: 'pending',
      progress: 0,
      currentClipIndex: 0,
      totalClips: approvedClips.length,
      outputPaths: []
    }

    this.activeJobs.set(jobId, job)

    // Start export process
    this.processExportJob(job, workflowJobId, episode, approvedClips, outputDirectory, options, onProgress)
      .catch(error => {
        const failedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : 'Unknown error'
        database.updateWorkflowJob(workflowJobId, {
          status: 'failed',
          stage: 'failed',
          message,
          completedAt: failedAt,
          updatedAt: failedAt
        })
        database.updateExportJob(job.id, {
          status: 'failed',
          errorMessage: message,
          completedAt: failedAt,
          updatedAt: failedAt
        })

        const currentJob = this.getJob(job.id)
        if (currentJob) {
          this.activeJobs.set(job.id, currentJob)
          onProgress?.(currentJob)
        }
      })

    return this.getJob(job.id) || job
  }

  /**
   * Process export job
   */
  private async processExportJob(
    job: ExportJob,
    workflowJobId: string,
    episode: any,
    clips: any[],
    outputDirectory: string,
    options: ExportOptions,
    onProgress?: (job: ExportJob) => void
  ): Promise<void> {
    const startedAt = new Date().toISOString()
    database.updateWorkflowJob(workflowJobId, {
      status: 'running',
      stage: 'rendering',
      message: 'Export started',
      startedAt,
      updatedAt: startedAt
    })
    database.updateExportJob(job.id, {
      status: 'running',
      startedAt,
      updatedAt: startedAt
    })
    this.emitProgress(job.id, onProgress)

    const inputPath = episode.file_path
    const includeCaptions = options.includeCaptions !== false // Default true

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      const stepStartedAt = new Date().toISOString()

      if (this.cancelledJobs.has(job.id)) {
        throw new Error('Cancelled by user')
      }

      database.updateWorkflowJob(workflowJobId, {
        progress: Math.round((i / clips.length) * 100),
        stage: 'rendering',
        message: `Exporting clip ${i + 1} of ${clips.length}`,
        updatedAt: stepStartedAt
      })
      database.updateExportJob(job.id, {
        status: 'running',
        currentClipIndex: i,
        progress: Math.round((i / clips.length) * 100),
        updatedAt: stepStartedAt
      })
      database.updateWorkflowStepRunByJobAndClip(workflowJobId, clip.id, {
        status: 'running',
        progress: 0,
        startedAt: stepStartedAt,
        updatedAt: stepStartedAt
      })
      database.updateExportOutputByJobAndClip(job.id, clip.id, {
        status: 'rendering',
        errorMessage: null
      })
      this.emitProgress(job.id, onProgress)

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
              if (this.cancelledJobs.has(job.id)) {
                return
              }
              // Calculate overall progress
              const overallProgress = ((i + (clipProgress / 100)) / clips.length) * 100
              const progressAt = new Date().toISOString()
              database.updateWorkflowJob(workflowJobId, {
                progress: Math.round(overallProgress),
                stage: 'rendering',
                message: `Exporting clip ${i + 1} of ${clips.length}`,
                updatedAt: progressAt
              })
              database.updateExportJob(job.id, {
                status: 'running',
                currentClipIndex: i,
                progress: Math.round(overallProgress),
                updatedAt: progressAt
              })
              database.updateWorkflowStepRunByJobAndClip(workflowJobId, clip.id, {
                status: 'running',
                progress: Math.round(clipProgress),
                updatedAt: progressAt
              })
              database.updateExportOutputByJobAndClip(job.id, clip.id, {
                status: 'rendering'
              })
              this.emitProgress(job.id, onProgress)
            }
          }
        )

        const completedAt = new Date().toISOString()
        const artifactId = randomUUID()
        database.createArtifact({
          id: artifactId,
          artifactType: 'export_mp4',
          status: 'complete',
          projectId: (episode as any).project_id ?? null,
          episodeId: episode.id ?? job.episodeId,
          clipId: clip.id,
          workflowJobId,
          filePath: outputPath,
          tempFilePath: null,
          mimeType: 'video/mp4',
          sizeBytes: null,
          checksum: null,
          metadataJson: JSON.stringify({
            exportJobId: job.id,
            clipId: clip.id,
            aspectRatio: options.aspectRatio || '9:16'
          }),
          createdAt: completedAt,
          updatedAt: completedAt,
          completedAt
        })
        database.updateExportOutputByJobAndClip(job.id, clip.id, {
          artifactId,
          filePath: outputPath,
          format: 'mp4',
          resolution: options.aspectRatio || '9:16',
          status: 'completed',
          errorMessage: null
        })
        database.updateWorkflowStepRunByJobAndClip(workflowJobId, clip.id, {
          status: 'completed',
          progress: 100,
          outputJson: JSON.stringify({ outputPath, artifactId }),
          completedAt,
          updatedAt: completedAt
        })
        database.updateExportJob(job.id, {
          currentClipIndex: i,
          progress: Math.round(((i + 1) / clips.length) * 100),
          updatedAt: completedAt
        })
        database.updateWorkflowJob(workflowJobId, {
          progress: Math.round(((i + 1) / clips.length) * 100),
          updatedAt: completedAt
        })
        this.emitProgress(job.id, onProgress)

        if (this.cancelledJobs.has(job.id)) {
          throw new Error('Cancelled by user')
        }

      } catch (error) {
        const failedAt = new Date().toISOString()
        const message = error instanceof Error ? error.message : 'Unknown error'
        database.updateWorkflowStepRunByJobAndClip(workflowJobId, clip.id, {
          status: 'failed',
          errorCode: this.cancelledJobs.has(job.id) ? 'cancelled' : 'export_failed',
          errorMessage: message,
          completedAt: failedAt,
          updatedAt: failedAt
        })
        database.updateExportOutputByJobAndClip(job.id, clip.id, {
          status: 'failed',
          errorMessage: message
        })
        console.error(`Failed to export clip ${clip.id}:`, error)
        throw new Error(`Failed to export clip ${i + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    // Mark job as completed
    const completedAt = new Date().toISOString()
    database.updateWorkflowJob(workflowJobId, {
      status: 'completed',
      progress: 100,
      stage: 'completed',
      message: 'Export complete',
      completedAt,
      updatedAt: completedAt
    })
    database.updateExportJob(job.id, {
      status: 'completed',
      progress: 100,
      completedAt,
      updatedAt: completedAt
    })
    this.cancelledJobs.delete(job.id)
    this.emitProgress(job.id, onProgress)
  }

  /**
   * Get export job status
   */
  getJob(jobId: string): ExportJob | undefined {
    const view = database.getDurableExportView(jobId)
    if (!view.job) {
      return undefined
    }

    const outputPaths = view.outputs
      .filter((output) => output.status === 'completed' && output.filePath)
      .map((output) => output.filePath)

    let status: ExportJob['status']
    switch (view.job.status) {
      case 'running':
        status = 'processing'
        break
      case 'completed':
        status = 'completed'
        break
      case 'failed':
      case 'cancelled':
      case 'cancel_requested':
        status = 'failed'
        break
      default:
        status = 'pending'
        break
    }

    const job: ExportJob = {
      id: view.job.id,
      episodeId: view.job.episodeId,
      clipIds: JSON.parse(view.job.clipIdsJson || '[]'),
      status,
      progress: view.job.progress,
      currentClipIndex: view.job.currentClipIndex,
      totalClips: view.job.totalClips,
      outputPaths,
      error: view.job.errorMessage || undefined
    }

    this.activeJobs.set(jobId, job)
    return job
  }

  /**
   * Cancel export job
   */
  cancelJob(jobId: string): boolean {
    const job = this.getJob(jobId)
    if (!job) {
      return false
    }

    if (job.status === 'processing' || job.status === 'pending') {
      const failedAt = new Date().toISOString()
      this.cancelledJobs.add(jobId)
      const durableView = database.getDurableExportView(jobId)
      if (durableView.job) {
        database.updateWorkflowJob(durableView.job.workflowJobId, {
          status: 'failed',
          stage: 'failed',
          message: 'Cancelled by user',
          completedAt: failedAt,
          updatedAt: failedAt
        })
      }
      database.updateExportJob(jobId, {
        status: 'failed',
        errorMessage: 'Cancelled by user',
        completedAt: failedAt,
        updatedAt: failedAt
      })
      this.activeJobs.set(jobId, {
        ...job,
        status: 'failed',
        error: 'Cancelled by user'
      })
      return true
    }

    return false
  }

  /**
   * Clear completed jobs
   */
  clearCompletedJobs(): void {
    for (const [jobId, job] of this.activeJobs.entries()) {
      const currentJob = this.getJob(jobId) || job
      if (currentJob.status === 'completed' || currentJob.status === 'failed') {
        this.activeJobs.delete(jobId)
        this.cancelledJobs.delete(jobId)
      }
    }
  }

  private emitProgress(jobId: string, onProgress?: (job: ExportJob) => void) {
    const currentJob = this.getJob(jobId)
    if (currentJob) {
      onProgress?.(currentJob)
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
