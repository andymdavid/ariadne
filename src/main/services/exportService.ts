import { randomUUID } from 'crypto'
import { join } from 'path'
import { dialog } from 'electron'
import { existsSync, mkdirSync, statSync } from 'fs'
import { database } from '../database/database'
import { exportWorkerSupervisor } from './exportWorkerSupervisor'
import type {
  ExportCaptionSegment,
  ExportCaptionStyle,
  ExportFrameSettings,
  ExportLogoSettings,
  ExportMusicSettings,
  ExportRenderTask
} from '@shared/types/exportWorker'

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

    const tasks = this.buildRenderTasks(
      episode,
      approvedClips,
      outputDirectory,
      {
        aspectRatio,
        includeCaptions
      },
      clipIds
    )

    database.updateWorkflowJob(workflowJobId, {
      status: 'running',
      stage: 'rendering',
      message: 'Export started',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
    database.updateExportJob(job.id, {
      status: 'running',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })

    exportWorkerSupervisor.startExport(
      {
        type: 'start_export',
        exportJobId: job.id,
        workflowJobId,
        tasks
      },
      (updatedJobId) => this.emitProgress(updatedJobId, onProgress)
    ).catch((error) => {
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
      this.emitProgress(job.id, onProgress)
    })

    return this.getJob(job.id) || job
  }

  async recoverExports(onProgress?: (job: ExportJob) => void) {
    const workflowJobs = database.listRecoverableExportWorkflowJobs()

    for (const workflowJob of workflowJobs) {
      const exportJob = database.getExportJobByWorkflowJobId(workflowJob.id)
      if (!exportJob) {
        continue
      }

      if (exportWorkerSupervisor.hasLiveWorker(exportJob.id)) {
        continue
      }

      let shouldResume = workflowJob.status === 'pending_resume' || exportJob.status === 'pending_resume'

      if (workflowJob.status === 'running' || exportJob.status === 'running') {
        const normalizedAt = new Date().toISOString()
        database.updateWorkflowJob(workflowJob.id, {
          status: 'pending_resume',
          stage: 'pending_resume',
          message: 'Waiting to resume export',
          updatedAt: normalizedAt
        })
        database.updateExportJob(exportJob.id, {
          status: 'pending_resume',
          updatedAt: normalizedAt
        })
        shouldResume = true
      }

      if (workflowJob.status === 'cancel_requested' || exportJob.status === 'cancel_requested') {
        continue
      }

      if (!shouldResume) {
        continue
      }

      await this.resumeExportJob(exportJob.id, onProgress)
    }
  }

  private buildRenderTasks(
    episode: any,
    clips: any[],
    outputDirectory: string,
    options: Required<Pick<ExportOptions, 'aspectRatio' | 'includeCaptions'>>,
    orderedClipIds?: string[]
  ): ExportRenderTask[] {
    const clipOrder = orderedClipIds || clips.map((clip) => clip.id)

    return clips.map((clip, clipIndex) => {
      console.log(`========================================`)
      console.log(`[ExportService] Preparing clip ${clipIndex + 1}/${clips.length}`)
      console.log(`[ExportService] Clip ID: ${clip.id}`)

      const clipEdits = database.getClipEdits(clip.id) as ClipEditsRow | undefined
      const outputPath = join(outputDirectory, this.buildOutputFilename(clip.id))
      const captionSegments = this.buildCaptionSegments(clipEdits, options.includeCaptions)
      const captionStyle = this.buildCaptionStyle(clipEdits)
      const logoSettings = this.buildLogoSettings(clipEdits)
      const musicSettings = this.buildMusicSettings(clipEdits)
      const frameSettings = this.buildFrameSettings(clip, clipEdits, options.aspectRatio)

      console.log(`[ExportService] Prepared clip ${clip.id} with settings:`, {
        captionStyle: captionStyle?.enabled,
        captionSegments: captionSegments.length,
        logo: logoSettings?.enabled,
        music: musicSettings?.enabled,
        frame: frameSettings
      })

      return {
        clipId: clip.id,
        clipIndex: clipOrder.indexOf(clip.id),
        totalClips: clipOrder.length,
        sourceMediaPath: episode.file_path,
        startTime: clip.start_time,
        duration: clip.duration,
        outputPath,
        resolution: frameSettings.aspectRatio,
        captionSegments,
        captionStyle,
        logoSettings,
        musicSettings,
        frameSettings
      }
    })
  }

  private buildOutputFilename(clipId: string) {
    let clipTitle = 'clip'
    const titles = database.getClipTitles(clipId)
    if (titles && titles.length > 0) {
      const selectedTitle: any = titles.find((title: any) => title.is_selected) || titles[0]
      clipTitle = this.sanitizeFilename(selectedTitle.title)
    }

    return `${clipTitle}_${Date.now()}.mp4`
  }

  private buildCaptionSegments(clipEdits: ClipEditsRow | undefined, includeCaptions: boolean): ExportCaptionSegment[] {
    if (!includeCaptions || !clipEdits || clipEdits.captions_enabled !== 1) {
      return []
    }

    try {
      return JSON.parse(clipEdits.caption_segments || '[]') as ExportCaptionSegment[]
    } catch (error) {
      console.error('[ExportService] Failed to parse caption segments:', error)
      return []
    }
  }

  private buildCaptionStyle(clipEdits: ClipEditsRow | undefined): ExportCaptionStyle | undefined {
    if (!clipEdits) {
      return undefined
    }

    return {
      enabled: clipEdits.captions_enabled === 1,
      font: clipEdits.caption_font || 'Inter',
      size: clipEdits.caption_size || 48,
      color: clipEdits.caption_color || '#FFFFFF',
      position: clipEdits.caption_position || 'bottom',
      customX: clipEdits.caption_custom_x ?? undefined,
      customY: clipEdits.caption_custom_y ?? undefined,
      weight: clipEdits.caption_weight || (clipEdits.caption_bold === 1 ? 700 : 400),
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
    }
  }

  private buildLogoSettings(clipEdits: ClipEditsRow | undefined): ExportLogoSettings | undefined {
    if (!clipEdits || !clipEdits.logo_enabled) {
      return undefined
    }

    return {
      enabled: true,
      logoPath: clipEdits.logo_path ?? null,
      positionX: clipEdits.logo_position_x ?? 85,
      positionY: clipEdits.logo_position_y ?? 85,
      scale: clipEdits.logo_scale ?? 0.15,
      opacity: clipEdits.logo_opacity ?? 0.8
    }
  }

  private buildMusicSettings(clipEdits: ClipEditsRow | undefined): ExportMusicSettings | undefined {
    if (!clipEdits || !clipEdits.music_enabled) {
      return undefined
    }

    return {
      enabled: true,
      musicPath: clipEdits.music_path ?? null,
      volume: clipEdits.music_volume ?? 0.3,
      duckVolume: clipEdits.music_duck_volume ?? 0.1,
      duckEnabled: clipEdits.music_duck_enabled === 1,
      fadeIn: clipEdits.music_fade_in ?? 1.0,
      fadeOut: clipEdits.music_fade_out ?? 1.0,
      loop: clipEdits.music_loop === 1
    }
  }

  private buildFrameSettings(
    clip: any,
    clipEdits: ClipEditsRow | undefined,
    defaultAspectRatio: '9:16' | '1:1' | '16:9'
  ): ExportFrameSettings {
    const normalizedCropMode = clipEdits?.crop_mode === 'canvas' ? 'fit' : clipEdits?.crop_mode

    if (clipEdits) {
      return {
        aspectRatio: clipEdits.aspect_ratio || defaultAspectRatio,
        cropMode: (normalizedCropMode || 'center') as 'center' | 'fit' | 'blur',
        cropPositionX: clipEdits.crop_position_x ?? 50,
        cropPositionY: clipEdits.crop_position_y ?? 50,
        zoomLevel: clipEdits.zoom_level ?? 1,
        videoOffsetX: clipEdits.video_offset_x ?? 0,
        videoOffsetY: clipEdits.video_offset_y ?? 0,
        videoWidth: clip.video_width ?? null,
        videoHeight: clip.video_height ?? null
      }
    }

    return {
      aspectRatio: defaultAspectRatio,
      cropMode: 'center',
      cropPositionX: 50,
      cropPositionY: 50,
      zoomLevel: 1,
      videoOffsetX: 0,
      videoOffsetY: 0,
      videoWidth: clip.video_width ?? null,
      videoHeight: clip.video_height ?? null
    }
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

  getActiveJobForEpisode(episodeId: string): ExportJob | undefined {
    const exportJob = database.getActiveExportJobForEpisode(episodeId)
    if (!exportJob) {
      return undefined
    }

    return this.getJob(exportJob.id)
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
      const durableView = database.getDurableExportView(jobId)
      if (durableView.job) {
        database.updateWorkflowJob(durableView.job.workflowJobId, {
          status: 'failed',
          stage: 'failed',
          message: 'Cancelled by user',
          completedAt: failedAt,
          updatedAt: failedAt
        })
        exportWorkerSupervisor.cancelExport(jobId)
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
  clearCompletedJobs(): number {
    let clearedCount = 0

    for (const [jobId, job] of this.activeJobs.entries()) {
      const currentJob = this.getJob(jobId) || job
      if (currentJob.status === 'completed' || currentJob.status === 'failed') {
        this.activeJobs.delete(jobId)
        clearedCount += 1
      }
    }

    return clearedCount
  }

  private async resumeExportJob(jobId: string, onProgress?: (job: ExportJob) => void) {
    const durableView = database.getDurableExportView(jobId)
    if (!durableView.job) {
      return
    }

    const episode = database.getEpisode(durableView.job.episodeId)
    if (!episode) {
      return
    }

    const clipIds = JSON.parse(durableView.job.clipIdsJson || '[]') as string[]
    const completedClipIds = new Set<string>()

    for (const clipId of clipIds) {
      const output = durableView.outputs.find((candidate) => candidate.clipId === clipId)
      if (!output) {
        continue
      }

      const isComplete = this.isOutputComplete(output)
      if (isComplete) {
        completedClipIds.add(clipId)
        continue
      }

      this.normalizeIncompleteOutput(durableView.job.workflowJobId, output)
    }

    const remainingClips = clipIds
      .map((clipId) => database.getClip(clipId) as any)
      .filter((clip) => clip && !completedClipIds.has(clip.id))

    if (remainingClips.length === 0) {
      const completedAt = new Date().toISOString()
      database.updateWorkflowJob(durableView.job.workflowJobId, {
        status: 'completed',
        stage: 'completed',
        message: 'Export complete',
        progress: 100,
        completedAt,
        updatedAt: completedAt
      })
      database.updateExportJob(jobId, {
        status: 'completed',
        progress: 100,
        completedAt,
        updatedAt: completedAt
      })
      this.emitProgress(jobId, onProgress)
      return
    }

    const resumedAt = new Date().toISOString()
    database.updateWorkflowJob(durableView.job.workflowJobId, {
      status: 'running',
      stage: 'rendering',
      message: 'Resuming export',
      updatedAt: resumedAt
    })
    database.updateExportJob(jobId, {
      status: 'running',
      progress: Math.round((completedClipIds.size / clipIds.length) * 100),
      updatedAt: resumedAt
    })

    const tasks = this.buildRenderTasks(
      episode,
      remainingClips,
      durableView.job.outputDirectory,
      {
        aspectRatio: durableView.job.aspectRatio as '9:16' | '1:1' | '16:9',
        includeCaptions: durableView.job.includeCaptions
      },
      clipIds
    )

    exportWorkerSupervisor.startExport(
      {
        type: 'start_export',
        exportJobId: durableView.job.id,
        workflowJobId: durableView.job.workflowJobId,
        tasks
      },
      (updatedJobId) => this.emitProgress(updatedJobId, onProgress)
    ).catch((error) => {
      const failedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : 'Unknown error'
      database.updateWorkflowJob(durableView.job!.workflowJobId, {
        status: 'failed',
        stage: 'failed',
        message,
        completedAt: failedAt,
        updatedAt: failedAt
      })
      database.updateExportJob(jobId, {
        status: 'failed',
        errorMessage: message,
        completedAt: failedAt,
        updatedAt: failedAt
      })
      this.emitProgress(jobId, onProgress)
    })
  }

  private isOutputComplete(output: { artifactId: string | null; filePath: string; status: string }) {
    if (output.status !== 'completed' || !output.artifactId || !output.filePath) {
      return false
    }

    const artifact = database.getArtifactById(output.artifactId)
    if (!artifact || artifact.status !== 'complete') {
      return false
    }

    try {
      return existsSync(output.filePath) && statSync(output.filePath).size > 0
    } catch {
      return false
    }
  }

  private normalizeIncompleteOutput(workflowJobId: string, output: {
    exportJobId: string | null
    clipId: string
    artifactId: string | null
    filePath: string
    status: string
  }) {
    if (output.artifactId) {
      const artifact = database.getArtifactById(output.artifactId)
      if (artifact) {
        let shouldInvalidate = false
        try {
          shouldInvalidate = !artifact.filePath || !existsSync(artifact.filePath) || statSync(artifact.filePath).size <= 0
        } catch {
          shouldInvalidate = true
        }

        if (shouldInvalidate) {
          database.updateArtifact(artifact.id, {
            status: 'invalid',
            updatedAt: new Date().toISOString()
          })
        }
      }
    }

    database.updateExportOutputByJobAndClip(output.exportJobId || '', output.clipId, {
      status: 'pending',
      errorMessage: null
    })
    database.updateWorkflowStepRunByJobAndClip(workflowJobId, output.clipId, {
      status: 'pending',
      progress: 0,
      updatedAt: new Date().toISOString()
    })
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
