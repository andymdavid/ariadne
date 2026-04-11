import { randomUUID } from 'crypto'
import { join } from 'path'
import { dialog } from 'electron'
import { existsSync, mkdirSync } from 'fs'
import { database } from '../database/database'
import { exportWorkerSupervisor } from './exportWorkerSupervisor'
import { workflowReadModel } from './workflowReadModel'
import { configService } from './configService'
import { exportOverlayService } from './exportOverlayService'
import type { BrandTemplate } from '@shared/types'
import { getCanonicalPreviewCanvas, getCaptionLayoutConfig } from '../../shared/previewCanvas'
import type {
  ExportCaptionOverlayAsset,
  ExportCaptionOverlayFrame,
  ExportCaptionSegment,
  ExportCaptionStyle,
  ExportFrameSettings,
  ExportLogoSettings,
  ExportMusicSettings,
  ExportRenderTask
} from '@shared/types/exportWorker'

interface ClipEditsRow {
  updated_at?: string | null
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

interface ExportTranscriptWord {
  word: string
  start: number
  end: number
}

interface ExportTranscriptSegment {
  start_time?: number
  end_time?: number
  start?: number
  end?: number
  text?: string
  words?: ExportTranscriptWord[]
}

const isLegacyDefaultLogoPosition = (x: unknown, y: unknown) =>
  Number(x) === 85 && Number(y) === 85

const isUpdatedAfter = (candidate?: string | null, baseline?: string | null) => {
  const candidateTime = candidate ? Date.parse(candidate) : Number.NaN
  const baselineTime = baseline ? Date.parse(baseline) : Number.NaN

  if (Number.isNaN(candidateTime)) return false
  if (Number.isNaN(baselineTime)) return true

  return candidateTime > baselineTime
}

const normalizeCaptionText = (text: string) => text.replace(/\s+([,.!?;:])/g, '$1').trim()

const estimateTextWidth = (
  text: string,
  fontSize: number,
  fontWeight = 600
) => {
  const weightFactor = fontWeight >= 700 ? 0.62 : 0.58
  return text.length * fontSize * weightFactor
}

const splitCaptionWords = (
  words: string[],
  maxWordsPerCue: number,
  maxTextWidth?: number,
  fontSize = 16,
  fontWeight = 700
) => {
  if (!words.length) return []
  if (!maxTextWidth || maxTextWidth <= 0) {
    const chunks: string[][] = []
    for (let index = 0; index < words.length; index += maxWordsPerCue) {
      chunks.push(words.slice(index, index + maxWordsPerCue))
    }
    return chunks
  }

  const chunks: string[][] = []
  let currentChunk: string[] = []

  words.forEach((rawWord) => {
    const word = rawWord.trim()
    if (!word) return

    const candidateChunk = [...currentChunk, word]
    const candidateText = normalizeCaptionText(candidateChunk.join(' '))
    const fitsWidth = estimateTextWidth(candidateText, fontSize, Number(fontWeight)) <= maxTextWidth

    if (currentChunk.length > 0 && (candidateChunk.length > maxWordsPerCue || !fitsWidth)) {
      chunks.push(currentChunk)
      currentChunk = [word]
      return
    }

    currentChunk = candidateChunk
  })

  if (currentChunk.length > 0) {
    chunks.push(currentChunk)
  }

  return chunks
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
  status: 'pending' | 'pending_resume' | 'processing' | 'completed' | 'failed'
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
      workerKind: 'export_worker',
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
    this.recordEvent(workflowJobId, null, 'export_job', 'job_created', 'Export job created', {
      exportJobId: jobId,
      episodeId,
      clipIds
    }, now)

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

    const tasks = await this.buildRenderTasks(
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
    this.recordEvent(workflowJobId, null, 'export_job', 'job_started', 'Export started', {
      exportJobId: job.id,
      clipCount: approvedClips.length
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
      database.createFailureEvent({
        id: randomUUID(),
        jobId: workflowJobId,
        stepRunId: null,
        scope: 'export_supervision.start',
        errorCode: 'export_start_failed',
        message,
        detailJson: JSON.stringify({
          exportJobId: job.id
        }),
        createdAt: failedAt
      })
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

      if (
        workflowJob.status === 'pending' ||
        exportJob.status === 'pending' ||
        workflowJob.status === 'running' ||
        exportJob.status === 'running'
      ) {
        const normalizedAt = new Date().toISOString()
        this.recordEvent(workflowJob.id, null, 'export_recovery', 'job_normalized', 'Normalized stale export job to pending_resume', {
          previousWorkflowStatus: workflowJob.status,
          previousExportStatus: exportJob.status
        }, normalizedAt)
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

      this.recordEvent(workflowJob.id, null, 'export_recovery', 'resume_started', 'Attempting export resume', {
        exportJobId: exportJob.id
      })
      await this.resumeExportJob(exportJob.id, onProgress)
    }
  }

  private async buildRenderTasks(
    episode: any,
    clips: any[],
    outputDirectory: string,
    options: Required<Pick<ExportOptions, 'aspectRatio' | 'includeCaptions'>>,
    orderedClipIds?: string[]
  ): Promise<ExportRenderTask[]> {
    const clipOrder = orderedClipIds || clips.map((clip) => clip.id)
    const brandTemplate = configService.getBrandTemplate()
    const tasks: ExportRenderTask[] = []

    for (const [clipIndex, clip] of clips.entries()) {
      console.log(`========================================`)
      console.log(`[ExportService] Preparing clip ${clipIndex + 1}/${clips.length}`)
      console.log(`[ExportService] Clip ID: ${clip.id}`)

      const clipEdits = database.getClipEdits(clip.id) as ClipEditsRow | undefined
      const transcriptSegments = database.getClipTranscriptSegments(clip.id) as ExportTranscriptSegment[]
      const outputPath = join(outputDirectory, this.buildOutputFilename(clip.id))
      const captionSegments = this.buildCaptionSegments(
        clip.id,
        Number(clip.start_time ?? 0),
        clipEdits,
        transcriptSegments,
        brandTemplate,
        options.includeCaptions
      )
      const captionStyle = this.buildCaptionStyle(clipEdits, brandTemplate)
      const logoSettings = this.buildLogoSettings(clipEdits, brandTemplate)
      const musicSettings = this.buildMusicSettings(clipEdits, brandTemplate)
      const frameSettings = this.buildFrameSettings(clip, clipEdits, brandTemplate, options.aspectRatio)
      const resolution =
        frameSettings.aspectRatio === '16:9'
          ? { width: 1920, height: 1080 }
          : frameSettings.aspectRatio === '1:1'
            ? { width: 1080, height: 1080 }
            : { width: 1080, height: 1920 }
      let captionOverlayAsset: ExportCaptionOverlayAsset | undefined

      if (captionStyle?.enabled && captionSegments.length > 0) {
        captionOverlayAsset = await exportOverlayService.renderCaptionOverlayAsset(
          clip.id,
          captionSegments,
          captionStyle,
          resolution,
          Number(clip.duration ?? 0)
        )
      }

      console.log(`[ExportService] Prepared clip ${clip.id} with settings:`, {
        captionStyle: captionStyle?.enabled,
        captionBackground: captionStyle?.background,
        captionBackgroundColor: captionStyle?.backgroundColor,
        captionSegments: captionSegments.length,
        captionOverlayFrames: captionOverlayAsset ? 1 : 0,
        logo: logoSettings?.enabled,
        music: musicSettings?.enabled,
        frame: frameSettings
      })

      tasks.push({
        clipId: clip.id,
        clipIndex: clipOrder.indexOf(clip.id),
        totalClips: clipOrder.length,
        sourceMediaPath: episode.file_path,
        startTime: clip.start_time,
        duration: clip.duration,
        outputPath,
        resolution: frameSettings.aspectRatio,
        captionSegments,
        captionOverlayAsset,
        captionStyle,
        logoSettings,
        musicSettings,
        frameSettings
      })
    }

    return tasks
  }

  private buildOutputFilename(clipId: string) {
    let clipTitle = 'clip'
    const titles = database.getClipTitles(clipId)
    if (titles && titles.length > 0) {
      const selectedTitle: any = titles.find((title: any) => title.is_selected) || titles[0]
      clipTitle = this.sanitizeFilename(selectedTitle.title)
    }

    return `${clipTitle}_${clipId.slice(0, 8)}_${Date.now()}.mp4`
  }

  private buildCaptionSegments(
    clipId: string,
    clipStartTime: number,
    clipEdits: ClipEditsRow | undefined,
    transcriptSegments: ExportTranscriptSegment[],
    brandTemplate: BrandTemplate,
    includeCaptions: boolean
  ): ExportCaptionSegment[] {
    const captionsEnabled = clipEdits?.captions_enabled != null
      ? clipEdits.captions_enabled === 1
      : true

    if (!includeCaptions || !captionsEnabled) {
      return []
    }

    try {
      const parsed = JSON.parse(clipEdits?.caption_segments || '[]') as ExportCaptionSegment[]
      if (parsed.length > 0) {
        return parsed
      }
    } catch (error) {
      console.error('[ExportService] Failed to parse caption segments:', error)
    }

    return this.buildCaptionSegmentsFromTranscript(clipId, clipStartTime, transcriptSegments, brandTemplate)
  }

  private buildCaptionSegmentsFromTranscript(
    clipId: string,
    clipStartTime: number,
    transcriptSegments: ExportTranscriptSegment[],
    brandTemplate: BrandTemplate
  ): ExportCaptionSegment[] {
    const maxWordsPerCue = 3
    const previewWidth = getCanonicalPreviewCanvas(brandTemplate.frame.aspectRatio).width
    const layout = getCaptionLayoutConfig(brandTemplate.caption.presetId)
    const paddingX = Math.max(0, brandTemplate.caption.backgroundPaddingX ?? 24)
    const bubbleWidth = layout.maxWidth
      ? Math.min(layout.maxWidth, Math.max(layout.minWidth, previewWidth * layout.widthRatio))
      : Math.max(layout.minWidth, previewWidth * layout.widthRatio)
    const maxTextWidth =
      (brandTemplate.caption.lineMode || 'one-line') === 'one-line'
        ? Math.max(96, Math.min(bubbleWidth, 236) - paddingX * 2)
        : undefined
    const fontSize = Number(brandTemplate.caption.fontSize ?? 30)
    const fontWeight = Number(brandTemplate.caption.fontWeight ?? 700)
    const cues: ExportCaptionSegment[] = []

    for (const segment of transcriptSegments) {
      const words = Array.isArray(segment.words)
        ? segment.words.filter(
            (word) =>
              word.word?.trim() &&
              Number.isFinite(word.start) &&
              Number.isFinite(word.end) &&
              word.end > word.start
          )
        : []

      if (words.length > 0) {
        const timedChunks = splitCaptionWords(
          words.map((word) => brandTemplate.caption.uppercase ? word.word.toUpperCase() : word.word),
          maxWordsPerCue,
          maxTextWidth,
          fontSize,
          fontWeight
        )
        let timedWordIndex = 0

        for (let index = 0; index < timedChunks.length; index += 1) {
          const chunkWords = timedChunks[index]
          const chunk = words.slice(timedWordIndex, timedWordIndex + chunkWords.length)
          timedWordIndex += chunkWords.length
          if (!chunk.length) continue
          const relativeStart = Math.max(0, chunk[0].start - clipStartTime)
          const relativeEnd = Math.max(relativeStart, chunk[chunk.length - 1].end - clipStartTime)
          cues.push({
            text: normalizeCaptionText(chunkWords.join(' ')),
            start: relativeStart,
            end: relativeEnd,
            words: chunk.map((word) => ({
              word: brandTemplate.caption.uppercase ? word.word.toUpperCase() : word.word,
              start: Math.max(0, word.start - clipStartTime),
              end: Math.max(0, word.end - clipStartTime)
            }))
          })
        }
        continue
      }

      const text = String(segment.text || '').trim()
      const start = Math.max(0, Number(segment.start_time ?? segment.start ?? 0) - clipStartTime)
      const end = Math.max(start, Number(segment.end_time ?? segment.end ?? start) - clipStartTime)
      if (!text || end <= start) continue

      const fallbackWords = (brandTemplate.caption.uppercase ? text.toUpperCase() : text).split(/\s+/).filter(Boolean)
      const totalDuration = Math.max(end - start, 0.01)
      const fallbackChunks = splitCaptionWords(
        fallbackWords,
        maxWordsPerCue,
        maxTextWidth,
        fontSize,
        fontWeight
      )
      const chunkCount = Math.max(fallbackChunks.length, 1)
      const chunkDuration = totalDuration / chunkCount

      fallbackChunks.forEach((chunk, chunkIndex) => {
        const chunkStart = start + chunkIndex * chunkDuration
        const chunkEnd =
          chunkIndex === chunkCount - 1
            ? end
            : Math.min(end, chunkStart + chunkDuration)

        cues.push({
          text: normalizeCaptionText(chunk.join(' ')),
          start: chunkStart,
          end: chunkEnd,
          words: chunk.map((word, wordIndex) => {
            const wordDuration = chunkDuration / Math.max(chunk.length, 1)
            const wordStart = chunkStart + wordIndex * wordDuration
            const wordEnd =
              chunkIndex === chunkCount - 1 && wordIndex === chunk.length - 1
                ? chunkEnd
                : Math.min(chunkEnd, wordStart + wordDuration)

            return {
              word,
              start: wordStart,
              end: wordEnd
            }
          })
        })
      })
    }

    console.log(`[ExportService] Built ${cues.length} transcript-derived caption cues for clip ${clipId}`)
    return cues
  }

  private buildCaptionStyle(clipEdits: ClipEditsRow | undefined, brandTemplate: BrandTemplate): ExportCaptionStyle | undefined {
    const templateCaption = brandTemplate.caption
    const captionsEnabled = clipEdits?.captions_enabled != null
      ? clipEdits.captions_enabled === 1
      : true
    const clipOverridesCurrent = isUpdatedAfter(clipEdits?.updated_at, brandTemplate.updatedAt)
    const useCaptionPositionOverride =
      clipOverridesCurrent && clipEdits?.caption_position === 'custom'

    return {
      enabled: captionsEnabled,
      font: templateCaption.font || 'Inter',
      size: templateCaption.fontSize || 48,
      color: templateCaption.highlightColor || '#FFFFFF',
      textColor: templateCaption.textColor || '#B3B3B3',
      highlightColor: templateCaption.highlightColor || '#FFFFFF',
      position: useCaptionPositionOverride ? 'custom' : (templateCaption.position || 'bottom'),
      customX: useCaptionPositionOverride ? (clipEdits?.caption_custom_x ?? undefined) : (templateCaption.customX ?? undefined),
      customY: useCaptionPositionOverride ? (clipEdits?.caption_custom_y ?? undefined) : (templateCaption.customY ?? undefined),
      weight:
        Number(templateCaption.fontWeight || 700),
      italic: templateCaption.italic === true,
      underline: templateCaption.underline === true,
      outline: Number(templateCaption.strokeWidth ?? 0) > 0,
      outlineColor: templateCaption.strokeColor || '#000000',
      outlineWidth: Number(templateCaption.strokeWidth ?? 2),
      shadow: templateCaption.shadowEnabled === true,
      highlightStyle: 'word',
      background: templateCaption.backgroundEnabled === true,
      backgroundColor: templateCaption.backgroundColor || '#000000',
      backgroundOpacity: 1,
      backgroundPaddingX: templateCaption.backgroundPaddingX ?? 24,
      backgroundPaddingY: templateCaption.backgroundPaddingY ?? 12,
      backgroundRadius: templateCaption.backgroundRadius ?? 16,
      textCase: templateCaption.uppercase ? 'uppercase' : 'normal',
      wordsPerCaption: 3,
      maxWidth: 90,
      lineHeight: 1.2,
      letterSpacing: 0,
      lineMode: templateCaption.lineMode ?? 'one-line',
      shadowColor: templateCaption.shadowColor || '#000000',
      shadowOffsetX: templateCaption.shadowOffsetX ?? 0,
      shadowOffsetY: templateCaption.shadowOffsetY ?? 0,
      shadowBlur: templateCaption.shadowBlur ?? 0
    }
  }

  private buildLogoSettings(clipEdits: ClipEditsRow | undefined, brandTemplate: BrandTemplate): ExportLogoSettings | undefined {
    const clipOverridesCurrent = isUpdatedAfter(clipEdits?.updated_at, brandTemplate.updatedAt)
    const useLogoPositionOverride =
      clipOverridesCurrent &&
      clipEdits?.logo_position_x != null &&
      clipEdits?.logo_position_y != null &&
      !isLegacyDefaultLogoPosition(clipEdits.logo_position_x, clipEdits.logo_position_y)

    const enabled = brandTemplate.logo.enabled || Boolean(brandTemplate.logo.assetPath)
    const logoPath = brandTemplate.logo.assetPath ?? null
    if (!enabled || !logoPath) {
      return undefined
    }

    return {
      enabled: true,
      logoPath,
      positionX: useLogoPositionOverride ? Number(clipEdits?.logo_position_x) : (brandTemplate.logo.positionX ?? 85),
      positionY: useLogoPositionOverride ? Number(clipEdits?.logo_position_y) : (brandTemplate.logo.positionY ?? 85),
      scale: brandTemplate.logo.scale ?? 0.15,
      opacity: brandTemplate.logo.opacity ?? 0.8
    }
  }

  private buildMusicSettings(clipEdits: ClipEditsRow | undefined, brandTemplate: BrandTemplate): ExportMusicSettings | undefined {
    const enabled = clipEdits?.music_enabled != null
      ? Boolean(clipEdits.music_enabled)
      : brandTemplate.music.enabled || Boolean(brandTemplate.music.assetPath)

    const musicPath = clipEdits?.music_path ?? brandTemplate.music.assetPath ?? null
    if (!enabled || !musicPath) {
      return undefined
    }

    return {
      enabled: true,
      musicPath,
      volume: clipEdits?.music_volume ?? brandTemplate.music.volume ?? 0.3,
      duckVolume: clipEdits?.music_duck_volume ?? 0.1,
      duckEnabled: clipEdits?.music_duck_enabled === 1,
      fadeIn: clipEdits?.music_fade_in ?? 1.0,
      fadeOut: clipEdits?.music_fade_out ?? 1.0,
      loop: clipEdits?.music_loop === 1
    }
  }

  private buildFrameSettings(
    clip: any,
    clipEdits: ClipEditsRow | undefined,
    brandTemplate: BrandTemplate,
    defaultAspectRatio: '9:16' | '1:1' | '16:9'
  ): ExportFrameSettings {
    const normalizedCropMode = clipEdits?.crop_mode === 'canvas' ? 'fit' : clipEdits?.crop_mode
    const clipOverridesCurrent = isUpdatedAfter(clipEdits?.updated_at, brandTemplate.updatedAt)
    const useFrameOverride =
      clipOverridesCurrent &&
      (clipEdits?.aspect_ratio != null || normalizedCropMode != null)

    if (useFrameOverride) {
      const edits = clipEdits as ClipEditsRow
      return {
        aspectRatio: edits.aspect_ratio || defaultAspectRatio,
        cropMode: (normalizedCropMode || brandTemplate.frame.cropMode || 'center') as 'center' | 'fit' | 'blur',
        cropPositionX: edits.crop_position_x ?? 50,
        cropPositionY: edits.crop_position_y ?? 50,
        zoomLevel: edits.zoom_level ?? 1,
        videoOffsetX: edits.video_offset_x ?? 0,
        videoOffsetY: edits.video_offset_y ?? 0,
        videoWidth: clip.video_width ?? null,
        videoHeight: clip.video_height ?? null
      }
    }

    return {
      aspectRatio: defaultAspectRatio,
      cropMode: (brandTemplate.frame.cropMode || 'center') as 'center' | 'fit' | 'blur',
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
    const job = workflowReadModel.getExportJobById(jobId)
    if (!job) {
      return undefined
    }
    this.activeJobs.set(jobId, job)
    return job
  }

  getActiveJobForEpisode(episodeId: string): ExportJob | undefined {
    const job = workflowReadModel.getActiveExportJobByEpisode(episodeId)
    if (job) {
      this.activeJobs.set(job.id, job)
    }
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

    if (job.status === 'processing' || job.status === 'pending' || job.status === 'pending_resume') {
      const failedAt = new Date().toISOString()
      const durableView = database.getDurableExportView(jobId)
      if (durableView.job) {
        this.recordEvent(durableView.job.workflowJobId, null, 'export_job', 'job_cancelled', 'Cancelled by user', {
          exportJobId: jobId
        }, failedAt)
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
      this.recordEvent(durableView.job.workflowJobId, null, 'export_recovery', 'resume_completed', 'Export resume found all clips already complete', {
        exportJobId: jobId
      }, completedAt)
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
    this.recordEvent(durableView.job.workflowJobId, null, 'export_recovery', 'resume_dispatched', 'Dispatching export resume', {
      exportJobId: jobId,
      completedClips: completedClipIds.size,
      remainingClips: remainingClips.length
    }, resumedAt)

    const tasks = await this.buildRenderTasks(
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
      database.createFailureEvent({
        id: randomUUID(),
        jobId: durableView.job!.workflowJobId,
        stepRunId: null,
        scope: 'export_supervision.resume',
        errorCode: 'export_resume_failed',
        message,
        detailJson: JSON.stringify({
          exportJobId: jobId
        }),
        createdAt: failedAt
      })
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
    return database.validateArtifact(artifact, output.filePath).isValid
  }

  private normalizeIncompleteOutput(workflowJobId: string, output: {
    exportJobId: string | null
    clipId: string
    artifactId: string | null
    filePath: string
    status: string
  }) {
    const now = new Date().toISOString()
    const stepRun = database.getWorkflowStepRunByJobAndClip(workflowJobId, output.clipId)

    if (output.artifactId) {
      const artifact = database.getArtifactById(output.artifactId)
      if (artifact) {
        const validation = database.validateArtifact(artifact, output.filePath || undefined)
        if (!validation.isValid) {
          database.invalidateArtifact(artifact.id, now)
          database.createFailureEvent({
            id: randomUUID(),
            jobId: workflowJobId,
            stepRunId: stepRun?.id ?? null,
            scope: 'export_resume_validation.artifact',
            errorCode: validation.errorCode || 'artifact_invalid',
            message: validation.message || 'Stored export artifact is missing or invalid during resume',
            detailJson: JSON.stringify({
              exportJobId: output.exportJobId,
              clipId: output.clipId,
              artifactId: artifact.id,
              filePath: artifact.filePath,
              expectedPath: output.filePath
            }),
            createdAt: now
          })
        }
      }
    }

    if (output.status === 'completed' || output.status === 'failed') {
      database.createFailureEvent({
        id: randomUUID(),
        jobId: workflowJobId,
        stepRunId: stepRun?.id ?? null,
        scope: 'export_resume_validation.output',
        errorCode: 'output_incomplete',
        message: 'Stored export output could not be treated as complete during resume',
        detailJson: JSON.stringify({
          exportJobId: output.exportJobId,
          clipId: output.clipId,
          artifactId: output.artifactId,
          filePath: output.filePath,
          status: output.status
        }),
        createdAt: now
      })
    }

    database.updateExportOutputByJobAndClip(output.exportJobId || '', output.clipId, {
      status: 'pending',
      errorMessage: null
    })
    database.updateWorkflowStepRunByJobAndClip(workflowJobId, output.clipId, {
      status: 'pending',
      progress: 0,
      updatedAt: now
    })
  }

  private emitProgress(jobId: string, onProgress?: (job: ExportJob) => void) {
    const currentJob = this.getJob(jobId)
    if (currentJob) {
      onProgress?.(currentJob)
    }
  }

  private recordEvent(
    jobId: string,
    stepRunId: string | null,
    scope: string,
    eventType: string,
    message: string,
    detail: Record<string, unknown>,
    createdAt = new Date().toISOString()
  ) {
    database.createWorkflowEvent({
      id: randomUUID(),
      jobId,
      stepRunId,
      scope,
      eventType,
      message,
      detailJson: JSON.stringify(detail),
      createdAt
    })
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
