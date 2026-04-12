import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'fs'
import { promises as fsPromises } from 'fs'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { basename, extname, join } from 'path'
import { database } from '../database/database'
import { configService } from './configService'
import { ffmpegService } from './ffmpegService'
import { videoLibraryService } from './videoLibraryService'
import type {
  GeneratedVideoAsset,
  GeneratedVideoJobEvent,
  GeneratedVideoJob,
  VideoGenerationModelId
} from '@shared/types'

type OpenRouterVideoSubmitResponse = {
  id: string
  polling_url: string
  status: string
}

type OpenRouterVideoPollResponse = {
  id: string
  polling_url?: string
  status: string
  error?: string
  unsigned_urls?: string[]
}

const DEFAULT_POLL_INTERVAL_MS = 10_000
const MAX_POLL_ATTEMPTS = 90

const modelResolutionDefaults: Record<VideoGenerationModelId, string> = {
  'alibaba/wan-2.6': '720p',
  'bytedance/seedance-1-5-pro': '720p',
  'google/veo-3.1': '720p',
  'openai/sora-2-pro': '720p'
}

export class VideoGenerationService {
  private activeJobs = new Set<string>()
  private cancelledJobs = new Set<string>()
  private assetsDir: string
  private thumbnailsDir: string
  private progressListener: ((event: GeneratedVideoJobEvent) => void) | null = null

  constructor() {
    const baseDir = join(app.getPath('userData'), 'video-library')
    this.assetsDir = join(baseDir, 'assets')
    this.thumbnailsDir = join(baseDir, 'thumbnails')

    if (!existsSync(this.assetsDir)) {
      mkdirSync(this.assetsDir, { recursive: true })
    }

    if (!existsSync(this.thumbnailsDir)) {
      mkdirSync(this.thumbnailsDir, { recursive: true })
    }
  }

  async startJob(jobId: string) {
    const existing = videoLibraryService.getJob(jobId)
    if (!existing) {
      throw new Error(`Generated video job not found: ${jobId}`)
    }

    if (this.activeJobs.has(jobId)) {
      return existing
    }

    this.activeJobs.add(jobId)
    this.cancelledJobs.delete(jobId)
    void this.runJob(jobId).finally(() => {
      this.activeJobs.delete(jobId)
      this.cancelledJobs.delete(jobId)
    })
    return videoLibraryService.getJob(jobId) ?? existing
  }

  cancelJob(jobId: string) {
    const existing = videoLibraryService.getJob(jobId)
    if (!existing) {
      throw new Error(`Generated video job not found: ${jobId}`)
    }

    const cancelledAt = new Date().toISOString()
    this.cancelledJobs.add(jobId)

    const cancelledJob: GeneratedVideoJob = {
      ...existing,
      status: 'cancelled',
      errorMessage: existing.status === 'completed' ? null : 'Cancelled by user',
      completedAt: cancelledAt,
      updatedAt: cancelledAt
    }
    videoLibraryService.saveJob(cancelledJob)

    const asset = existing.assetId ? videoLibraryService.getAsset(existing.assetId) : undefined
    const updatedAsset =
      asset && asset.status !== 'completed'
        ? {
            ...asset,
            status: 'pending' as const,
            updatedAt: cancelledAt,
            metadata: {
              ...(asset.metadata ?? {}),
              generationState: 'cancelled'
            }
          }
        : asset ?? null

    if (updatedAsset) {
      videoLibraryService.saveAsset(updatedAsset)
    }

    this.emitJobUpdate(cancelledJob, updatedAsset)
    return cancelledJob
  }

  retryJob(jobId: string) {
    const existing = videoLibraryService.getJob(jobId)
    if (!existing) {
      throw new Error(`Generated video job not found: ${jobId}`)
    }

    if (!['failed', 'cancelled'].includes(existing.status)) {
      throw new Error('Only failed or cancelled video jobs can be retried')
    }

    const retriedAt = new Date().toISOString()
    const retriedJob: GeneratedVideoJob = {
      ...existing,
      status: 'pending',
      progress: 0,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      updatedAt: retriedAt,
      output: {}
    }
    videoLibraryService.saveJob(retriedJob)

    const asset = existing.assetId ? videoLibraryService.getAsset(existing.assetId) : undefined
    const updatedAsset =
      asset
        ? {
            ...asset,
            status: 'pending' as const,
            filePath: null,
            thumbnailPath: null,
            updatedAt: retriedAt,
            metadata: {
              ...(asset.metadata ?? {}),
              generationState: 'draft',
              errorMessage: null
            }
          }
        : null

    if (updatedAsset) {
      videoLibraryService.saveAsset(updatedAsset)
    }

    this.emitJobUpdate(retriedJob, updatedAsset)
    return this.startJob(jobId)
  }

  setProgressListener(listener: ((event: GeneratedVideoJobEvent) => void) | null) {
    this.progressListener = listener
  }

  private emitJobUpdate(job: GeneratedVideoJob, asset?: GeneratedVideoAsset | null) {
    this.progressListener?.({ job, asset })
  }

  private async runJob(jobId: string) {
    const job = videoLibraryService.getJob(jobId)
    if (!job) {
      throw new Error(`Generated video job not found: ${jobId}`)
    }

    const apiKey = configService.getOpenRouterKey()
    if (!apiKey) {
      await this.failJob(job, 'OpenRouter API key not configured')
      return
    }

    const asset = job.assetId ? videoLibraryService.getAsset(job.assetId) : undefined
    if (!asset) {
      await this.failJob(job, 'Generated video asset missing for job')
      return
    }

    const startedAt = new Date().toISOString()
    const runningJob: GeneratedVideoJob = {
      ...job,
      status: 'running',
      progress: 5,
      startedAt,
      updatedAt: startedAt,
      output: {
        ...(job.output ?? {})
      }
    }
    const runningAsset: GeneratedVideoAsset = {
      ...asset,
      status: 'running',
      updatedAt: startedAt,
      metadata: {
        ...(asset.metadata ?? {}),
        generationState: 'submitting'
      }
    }
    videoLibraryService.saveJob(runningJob)
    videoLibraryService.saveAsset(runningAsset)
    this.emitJobUpdate(runningJob, runningAsset)

    try {
      const submitResponse = await this.submitToOpenRouter(runningJob, apiKey)

      const submittedAt = new Date().toISOString()
      const submittedJob: GeneratedVideoJob = {
        ...runningJob,
        progress: 15,
        updatedAt: submittedAt,
        output: {
          ...(runningJob.output ?? {}),
          openrouterJobId: submitResponse.id,
          pollingUrl: submitResponse.polling_url,
          submitStatus: submitResponse.status
        }
      }
      const submittedAsset: GeneratedVideoAsset = {
        ...runningAsset,
        updatedAt: submittedAt,
        metadata: {
          ...(runningAsset.metadata ?? {}),
          generationState: 'polling',
          openrouterJobId: submitResponse.id
        }
      }
      videoLibraryService.saveJob(submittedJob)
      videoLibraryService.saveAsset(submittedAsset)
      this.emitJobUpdate(submittedJob, submittedAsset)

      const completed = await this.pollUntilCompleted(submittedJob, apiKey)
      const downloadUrl = completed.unsigned_urls?.[0]
      if (!downloadUrl) {
        throw new Error('OpenRouter video generation completed without a downloadable URL')
      }

      const downloadedVideoPath = await this.downloadVideo(jobId, asset.id, downloadUrl)
      const thumbnailPath = await this.generateThumbnail(asset.id, downloadedVideoPath)
      const finishedAt = new Date().toISOString()

      const completedAsset: GeneratedVideoAsset = {
        ...submittedAsset,
        status: 'completed',
        filePath: downloadedVideoPath,
        thumbnailPath,
        durationSeconds: submittedJob.durationSeconds,
        updatedAt: finishedAt,
        metadata: {
          ...(submittedAsset.metadata ?? {}),
          generationState: 'completed',
          openrouterJobId: submitResponse.id,
          downloadUrl
        }
      }
      videoLibraryService.saveAsset(completedAsset)

      const completedJob: GeneratedVideoJob = {
        ...submittedJob,
        status: 'completed',
        progress: 100,
        completedAt: finishedAt,
        updatedAt: finishedAt,
        output: {
          ...(submittedJob.output ?? {}),
          openrouterJobId: submitResponse.id,
          downloadUrl,
          savedVideoPath: downloadedVideoPath,
          thumbnailPath
        }
      }
      videoLibraryService.saveJob(completedJob)
      this.emitJobUpdate(completedJob, completedAsset)
    } catch (error) {
      await this.failJob(runningJob, error instanceof Error ? error.message : 'Unknown video generation error')
    }
  }

  private async submitToOpenRouter(job: GeneratedVideoJob, apiKey: string) {
    const payload: Record<string, unknown> = {
      model: job.modelId,
      prompt: this.composePrompt(job),
      duration: job.durationSeconds,
      resolution: modelResolutionDefaults[job.modelId] ?? '720p',
      generate_audio: false
    }

    if (job.referenceImagePath) {
      payload.input_references = [
        {
          type: 'image_url',
          image_url: {
            url: this.toDataUrl(job.referenceImagePath)
          }
        }
      ]
      delete payload.aspect_ratio
    } else {
      payload.aspect_ratio = job.aspectRatio
    }

    const payloadDebug = {
      jobId: job.id,
      model: payload.model,
      duration: payload.duration,
      resolution: payload.resolution,
      aspect_ratio: Object.prototype.hasOwnProperty.call(payload, 'aspect_ratio')
        ? payload.aspect_ratio
        : undefined,
      hasInputReferences: Array.isArray(payload.input_references) && payload.input_references.length > 0
    }
    console.log('[VideoGeneration] submitting payload', payloadDebug)

    const response = await fetch('https://openrouter.ai/api/v1/videos', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`OpenRouter video submission failed: ${response.status} ${errorText}`)
    }

    return (await response.json()) as OpenRouterVideoSubmitResponse
  }

  private async pollUntilCompleted(job: GeneratedVideoJob, apiKey: string) {
    const pollingUrl = String((job.output ?? {}).pollingUrl || '')
    if (!pollingUrl) {
      throw new Error('Missing polling URL for generated video job')
    }

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
      if (this.cancelledJobs.has(job.id)) {
        throw new Error('Video generation cancelled')
      }

      await this.sleep(DEFAULT_POLL_INTERVAL_MS)

      if (this.cancelledJobs.has(job.id)) {
        throw new Error('Video generation cancelled')
      }

      const response = await fetch(pollingUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`OpenRouter video polling failed: ${response.status} ${errorText}`)
      }

      const status = (await response.json()) as OpenRouterVideoPollResponse
      const progress = Math.min(95, 15 + Math.round((attempt / MAX_POLL_ATTEMPTS) * 75))

      const updatedJob: GeneratedVideoJob = {
        ...videoLibraryService.getJob(job.id) ?? job,
        status: 'running',
        progress,
        updatedAt: new Date().toISOString(),
        output: {
          ...((videoLibraryService.getJob(job.id)?.output ?? job.output) ?? {}),
          lastPollStatus: status.status,
          openrouterResponse: status
        }
      }
      videoLibraryService.saveJob(updatedJob)
      this.emitJobUpdate(updatedJob, job.assetId ? videoLibraryService.getAsset(job.assetId) ?? null : null)

      if (status.status === 'completed') {
        return status
      }

      if (status.status === 'failed' || status.status === 'cancelled') {
        throw new Error(status.error || `OpenRouter video job ended with status ${status.status}`)
      }
    }

    throw new Error('OpenRouter video generation timed out while polling')
  }

  private async downloadVideo(jobId: string, assetId: string, downloadUrl: string) {
    const response = await fetch(downloadUrl)
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download generated video: ${response.status}`)
    }

    const outputPath = join(this.assetsDir, `${assetId}_${jobId}.mp4`)
    const fileStream = createWriteStream(outputPath)

    await new Promise<void>((resolve, reject) => {
      response.body!.pipeTo(
        new WritableStream({
          write(chunk) {
            fileStream.write(Buffer.from(chunk))
          },
          close() {
            fileStream.end()
            resolve()
          },
          abort(reason) {
            fileStream.destroy()
            reject(reason)
          }
        })
      ).catch((error) => {
        fileStream.destroy()
        reject(error)
      })
    })

    return outputPath
  }

  private async generateThumbnail(assetId: string, videoPath: string) {
    const thumbnailPath = join(this.thumbnailsDir, `${assetId}.jpg`)
    await ffmpegService.extractFrame(videoPath, 0.5, thumbnailPath)
    return thumbnailPath
  }

  private async failJob(job: GeneratedVideoJob, message: string) {
    if (this.cancelledJobs.has(job.id) || message === 'Video generation cancelled') {
      return
    }

    const failedAt = new Date().toISOString()
    const asset = job.assetId ? videoLibraryService.getAsset(job.assetId) : undefined
    let failedAsset: GeneratedVideoAsset | null = null
    if (asset) {
      failedAsset = {
        ...asset,
        status: 'failed',
        updatedAt: failedAt,
        metadata: {
          ...(asset.metadata ?? {}),
          generationState: 'failed',
          errorMessage: message
        }
      }
      videoLibraryService.saveAsset(failedAsset)
    }

    const failedJob: GeneratedVideoJob = {
      ...job,
      status: 'failed',
      errorMessage: message,
      progress: Math.max(job.progress, 100),
      updatedAt: failedAt,
      completedAt: failedAt
    }
    videoLibraryService.saveJob(failedJob)
    this.emitJobUpdate(failedJob, failedAsset)
  }

  private composePrompt(job: GeneratedVideoJob) {
    const segments = [job.prompt]
    if (job.stylePrompt) {
      segments.push(`Style: ${job.stylePrompt}`)
    }
    if (job.negativePrompt) {
      segments.push(`Avoid: ${job.negativePrompt}`)
    }
    return segments.filter(Boolean).join('\n\n')
  }

  private toDataUrl(filePath: string) {
    const buffer = readFileSync(filePath)
    const ext = extname(filePath).toLowerCase()
    const mimeType =
      ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg'
    return `data:${mimeType};base64,${buffer.toString('base64')}`
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export const videoGenerationService = new VideoGenerationService()
