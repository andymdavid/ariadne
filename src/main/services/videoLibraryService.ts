import { randomUUID } from 'crypto'
import { database } from '../database/database'
import type {
  ClipVisualSource,
  GeneratedVideoAsset,
  GeneratedVideoAssetStatus,
  GeneratedVideoAspectRatio,
  GeneratedVideoJob,
  GeneratedVideoJobStatus,
  ResolvedClipVideoSource,
  VideoGenerationModelId
} from '@shared/types'

const DEFAULT_VIDEO_MODEL: VideoGenerationModelId = 'alibaba/wan-2.6'
const DEFAULT_VIDEO_DURATION_SECONDS = 5
const DEFAULT_VIDEO_ASPECT_RATIO: GeneratedVideoAspectRatio = '9:16'

export class VideoLibraryService {
  buildDraftAsset(overrides: Partial<GeneratedVideoAsset> = {}): GeneratedVideoAsset {
    const now = new Date().toISOString()
    return {
      id: overrides.id ?? randomUUID(),
      name: overrides.name ?? 'Untitled video',
      status: overrides.status ?? 'pending',
      provider: overrides.provider ?? 'openrouter',
      modelId: overrides.modelId ?? DEFAULT_VIDEO_MODEL,
      prompt: overrides.prompt ?? '',
      stylePrompt: overrides.stylePrompt ?? null,
      negativePrompt: overrides.negativePrompt ?? null,
      referenceImagePath: overrides.referenceImagePath ?? null,
      sourceJobId: overrides.sourceJobId ?? null,
      filePath: overrides.filePath ?? null,
      thumbnailPath: overrides.thumbnailPath ?? null,
      durationSeconds: overrides.durationSeconds ?? null,
      aspectRatio: overrides.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO,
      width: overrides.width ?? null,
      height: overrides.height ?? null,
      metadata: overrides.metadata ?? {},
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now
    }
  }

  buildDraftJob(overrides: Partial<GeneratedVideoJob> = {}): GeneratedVideoJob {
    const now = new Date().toISOString()
    return {
      id: overrides.id ?? randomUUID(),
      assetId: overrides.assetId ?? null,
      provider: overrides.provider ?? 'openrouter',
      modelId: overrides.modelId ?? DEFAULT_VIDEO_MODEL,
      prompt: overrides.prompt ?? '',
      stylePrompt: overrides.stylePrompt ?? null,
      negativePrompt: overrides.negativePrompt ?? null,
      referenceImagePath: overrides.referenceImagePath ?? null,
      aspectRatio: overrides.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO,
      durationSeconds: overrides.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS,
      input: overrides.input ?? {},
      output: overrides.output ?? {},
      status: overrides.status ?? 'pending',
      progress: overrides.progress ?? 0,
      errorMessage: overrides.errorMessage ?? null,
      createdAt: overrides.createdAt ?? now,
      startedAt: overrides.startedAt ?? null,
      completedAt: overrides.completedAt ?? null,
      updatedAt: overrides.updatedAt ?? now
    }
  }

  createDraftGeneration(input: {
    name?: string | null
    prompt: string
    stylePrompt?: string | null
    negativePrompt?: string | null
    referenceImagePath?: string | null
    modelId?: VideoGenerationModelId
    aspectRatio?: GeneratedVideoAspectRatio
    durationSeconds?: number
  }) {
    const now = new Date().toISOString()
    const asset = this.buildDraftAsset({
      id: randomUUID(),
      name: input.name?.trim() || this.buildAssetName(input.prompt),
      status: 'pending',
      modelId: input.modelId ?? DEFAULT_VIDEO_MODEL,
      prompt: input.prompt.trim(),
      stylePrompt: input.stylePrompt?.trim() || null,
      negativePrompt: input.negativePrompt?.trim() || null,
      referenceImagePath: input.referenceImagePath ?? null,
      aspectRatio: input.aspectRatio ?? DEFAULT_VIDEO_ASPECT_RATIO,
      metadata: {
        generationState: 'draft'
      },
      createdAt: now,
      updatedAt: now
    })

    const job = this.buildDraftJob({
      id: randomUUID(),
      assetId: asset.id,
      modelId: asset.modelId,
      prompt: asset.prompt,
      stylePrompt: asset.stylePrompt,
      negativePrompt: asset.negativePrompt,
      referenceImagePath: asset.referenceImagePath,
      aspectRatio: asset.aspectRatio,
      durationSeconds: input.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS,
      status: 'pending',
      progress: 0,
      input: {
        prompt: asset.prompt,
        stylePrompt: asset.stylePrompt,
        negativePrompt: asset.negativePrompt,
        referenceImagePath: asset.referenceImagePath,
        modelId: asset.modelId,
        aspectRatio: asset.aspectRatio,
        durationSeconds: input.durationSeconds ?? DEFAULT_VIDEO_DURATION_SECONDS
      },
      output: {},
      createdAt: now,
      updatedAt: now
    })

    asset.sourceJobId = job.id

    database.upsertGeneratedVideoAsset(asset)
    database.upsertGeneratedVideoJob(job)

    return { asset, job }
  }

  saveAsset(asset: GeneratedVideoAsset): GeneratedVideoAsset {
    database.upsertGeneratedVideoAsset(asset)
    return asset
  }

  getAsset(assetId: string) {
    return database.getGeneratedVideoAsset(assetId)
  }

  listAssets(statuses?: GeneratedVideoAssetStatus[]) {
    return database.listGeneratedVideoAssets(statuses)
  }

  saveJob(job: GeneratedVideoJob): GeneratedVideoJob {
    database.upsertGeneratedVideoJob(job)
    return job
  }

  getJob(jobId: string) {
    return database.getGeneratedVideoJob(jobId)
  }

  listJobs(assetId?: string) {
    return database.listGeneratedVideoJobs(assetId)
  }

  setClipVideoSource(
    clipId: string,
    sourceType: ClipVisualSource['sourceType'],
    generatedVideoAssetId?: string | null
  ): ClipVisualSource {
    if (sourceType === 'generated_video') {
      if (!generatedVideoAssetId) {
        throw new Error('Generated video asset is required when source type is generated_video')
      }

      const asset = database.getGeneratedVideoAsset(generatedVideoAssetId)
      if (!asset) {
        throw new Error(`Generated video asset not found: ${generatedVideoAssetId}`)
      }

      if (asset.status !== 'completed' || !asset.filePath) {
        throw new Error(`Generated video asset is not ready for use: ${generatedVideoAssetId}`)
      }
    }

    const source: ClipVisualSource = {
      clipId,
      sourceType,
      generatedVideoAssetId: sourceType === 'generated_video' ? generatedVideoAssetId ?? null : null,
      updatedAt: new Date().toISOString()
    }

    database.upsertClipVisualSource(source)
    return source
  }

  getClipVideoSource(clipId: string): ClipVisualSource {
    return (
      database.getClipVisualSource(clipId) ?? {
        clipId,
        sourceType: 'original',
        generatedVideoAssetId: null,
        updatedAt: new Date(0).toISOString()
      }
    )
  }

  resolveClipVideoSource(clipId: string): ResolvedClipVideoSource {
    const clip = database.getClip(clipId) as any
    if (!clip) {
      throw new Error(`Clip not found: ${clipId}`)
    }

    const episode = database.getEpisode(clip.episode_id) as any
    if (!episode?.file_path) {
      throw new Error(`Episode media not found for clip: ${clipId}`)
    }

    const source = this.getClipVideoSource(clipId)

    if (source.sourceType === 'generated_video' && source.generatedVideoAssetId) {
      const asset = database.getGeneratedVideoAsset(source.generatedVideoAssetId)
      if (asset?.status === 'completed' && asset.filePath) {
        return {
          clipId,
          sourceType: 'generated_video',
          sourcePath: asset.filePath,
          generatedVideoAssetId: asset.id,
          asset
        }
      }
    }

    return {
      clipId,
      sourceType: 'original',
      sourcePath: episode.file_path,
      generatedVideoAssetId: null,
      asset: null
    }
  }

  private buildAssetName(prompt: string) {
    const trimmed = prompt.trim()
    if (!trimmed) return 'Untitled video'
    const compact = trimmed.replace(/\s+/g, ' ')
    return compact.length > 48 ? `${compact.slice(0, 48).trim()}...` : compact
  }
}

export const videoLibraryService = new VideoLibraryService()
