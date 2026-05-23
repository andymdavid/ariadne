import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IoArrowBack, IoCheckmark, IoClose, IoCreateOutline, IoPlay, IoPause, IoShareOutline } from 'react-icons/io5'
import { isClipApproved, isClipPendingReview, normalizeClipStatus } from '@shared/types'
import type {
  Clip,
  ClipBoundaryQuality,
  ClipReviewFeedback,
  ClipTranscriptContextLine,
  ClipVisualSource,
  GeneratedVideoAsset,
  ResolvedClipVideoSource,
  ScheduledPublication
} from '@shared/types'

type ClipCardData = Clip & {
  title: string
  transcriptLines: Array<{ id: string; start: number; end: number; text: string }>
  publicationStatus?: string | null
  visualSource: ClipVisualSource
  resolvedVideoSource: ResolvedClipVideoSource
  mediaUrl: string | null
  reviewFeedback: ClipReviewFeedback | null
  transcriptContext: ClipTranscriptContextLine[]
}

type RawClip = Record<string, any>

const mapClip = (clip: RawClip, episodeId: string): Clip => ({
  id: clip.id,
  episodeId: clip.episode_id || clip.episodeId || episodeId,
  startTime: Number(clip.start_time ?? clip.startTime ?? 0),
  endTime: Number(clip.end_time ?? clip.endTime ?? 0),
  duration: Number(clip.duration ?? 0),
  contentType: (clip.content_type || clip.contentType || 'insight') as Clip['contentType'],
  shareabilityScore: Number(clip.shareability_score ?? clip.shareabilityScore ?? 0),
  keyQuote: clip.key_quote || clip.keyQuote || 'Untitled clip',
  reason: clip.reason || '',
  contextNeeded: (clip.context_needed || clip.contextNeeded || 'low') as Clip['contextNeeded'],
  videoWidth: clip.video_width ?? clip.videoWidth ?? null,
  videoHeight: clip.video_height ?? clip.videoHeight ?? null,
  status: normalizeClipStatus(clip.status),
  createdAt: clip.created_at || clip.createdAt || new Date().toISOString()
})

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const defaultVisualSource = (clipId: string): ClipVisualSource => ({
  clipId,
  sourceType: 'original',
  generatedVideoAssetId: null,
  updatedAt: new Date(0).toISOString()
})

const defaultReviewFeedback = (clipId: string): ClipReviewFeedback => ({
  clipId,
  startQuality: 'unreviewed',
  endQuality: 'unreviewed',
  notes: null,
  suggestedStartTime: null,
  suggestedEndTime: null,
  updatedAt: new Date(0).toISOString()
})

const boundaryQualityOptions: Array<{ value: ClipBoundaryQuality; label: string }> = [
  { value: 'usable', label: 'Usable' },
  { value: 'trim_start', label: 'Trim' },
  { value: 'extend_start', label: 'Extend' },
  { value: 'trim_end', label: 'Trim' },
  { value: 'extend_end', label: 'Extend' },
  { value: 'reject', label: 'Reject' }
]

const startBoundaryQualityOptions = boundaryQualityOptions.filter((option) =>
  option.value === 'usable' || option.value === 'trim_start' || option.value === 'extend_start' || option.value === 'reject'
)

const endBoundaryQualityOptions = boundaryQualityOptions.filter((option) =>
  option.value === 'usable' || option.value === 'trim_end' || option.value === 'extend_end' || option.value === 'reject'
)

function ClipPreview({
  mediaUrl,
  startTime,
  endTime,
  title,
  compact = false
}: {
  mediaUrl: string | null
  startTime: number
  endTime: number
  title: string
  compact?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaUrl) return

    const handleLoadedMetadata = () => {
      video.currentTime = startTime
    }

    const handleTimeUpdate = () => {
      if (video.currentTime >= endTime) {
        video.pause()
        video.currentTime = startTime
        setIsPlaying(false)
      }
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [endTime, mediaUrl, startTime])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.pause()
    setIsPlaying(false)
    if (mediaUrl) {
      video.currentTime = startTime
    }
  }, [mediaUrl, startTime, endTime])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || !mediaUrl) return

    if (isPlaying) {
      video.pause()
      return
    }

    if (video.currentTime < startTime || video.currentTime >= endTime) {
      video.currentTime = startTime
    }

    void video.play()
  }

  return (
    <div className="app-surface-muted overflow-hidden">
      <div className={`relative w-full bg-black ${compact ? 'aspect-[4/5]' : 'aspect-[9/16]'}`}>
        {mediaUrl ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            className="h-full w-full object-cover"
            playsInline
            muted
            preload="metadata"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-text-muted">
            Preview unavailable
          </div>
        )}

        <div className={`clip-preview-badge clip-preview-badge-label ${compact ? 'rounded-[5px] px-2 py-1 text-[10px]' : 'rounded-[5px] px-3 py-1 text-[11px]'}`}>
          Clip preview
        </div>
        <div className={`clip-preview-badge clip-preview-badge-duration ${compact ? 'rounded-[5px] px-2 py-1 text-[12px]' : 'rounded-[5px] px-3 py-1 text-sm'}`}>
          {formatTime(endTime - startTime)}
        </div>
        <button
          type="button"
          onClick={togglePlayback}
          className={`clip-preview-overlay ${compact ? 'px-3 py-2.5 text-[12px]' : 'px-4 py-4 text-sm'}`}
        >
          <span className="max-w-[70%] truncate text-left">{title}</span>
          <span className={`clip-preview-action ${compact ? 'rounded-[5px] px-2 py-1.5 text-[11px]' : 'rounded-[5px] px-3 py-2'}`}>
            {isPlaying ? <IoPause size={compact ? 13 : 16} /> : <IoPlay size={compact ? 13 : 16} />}
            {isPlaying ? 'Pause' : 'Preview'}
          </span>
        </button>
      </div>
    </div>
  )
}

export function ClipWorkspacePage() {
  const navigate = useNavigate()
  const { id: episodeId, clipId } = useParams<{ id: string; clipId?: string }>()
  const [clips, setClips] = useState<ClipCardData[]>([])
  const [generatedVideoAssets, setGeneratedVideoAssets] = useState<GeneratedVideoAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingVideoSourceClipId, setUpdatingVideoSourceClipId] = useState<string | null>(null)
  const cardRefs = useRef<Record<string, HTMLElement | null>>({})

  useEffect(() => {
    const loadWorkspace = async () => {
      if (!episodeId) {
        setError('Missing episode ID')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const [rawClips, completedAssets] = await Promise.all([
          window.electronAPI?.getEpisodeClips?.(episodeId),
          window.electronAPI?.listGeneratedVideoAssets?.(['completed'])
        ])

        const overview = await window.electronAPI?.getCalendarOverview?.()
        const publicationStatusByClipId = new Map<string, string>()
        ;(overview?.publications ?? []).forEach((publication: ScheduledPublication) => {
          if (!['cancelled', 'published'].includes(publication.status)) {
            publicationStatusByClipId.set(publication.clipId, publication.status)
          }
        })

        setGeneratedVideoAssets(completedAssets ?? [])

        const normalizedClips = ((rawClips || []) as RawClip[]).map((clip) => mapClip(clip, episodeId))

        const detailedClips = await Promise.all(
          normalizedClips.map(async (clip) => {
            const [titles, transcriptSegments, transcriptContext, visualSource, resolvedVideoSource, reviewFeedback] = await Promise.all([
              window.electronAPI?.getClipTitles?.(clip.id).catch(() => []),
              window.electronAPI?.getClipTranscriptLines?.(clip.id).catch(() => []),
              window.electronAPI?.getClipTranscriptContext?.(clip.id, 3).catch(() => []),
              window.electronAPI?.getClipVisualSource?.(clip.id).catch(() => defaultVisualSource(clip.id)),
              window.electronAPI?.resolveClipVideoSource?.(clip.id).catch(() => null),
              window.electronAPI?.getClipReviewFeedback?.(clip.id).catch(() => null)
            ])

            const selectedTitle =
              (titles || []).find((title: any) => title.is_selected)?.title ||
              (titles || [])[0]?.title ||
              clip.keyQuote

            return {
              ...clip,
              title: selectedTitle,
              publicationStatus: publicationStatusByClipId.get(clip.id) ?? null,
              visualSource: visualSource ?? defaultVisualSource(clip.id),
              resolvedVideoSource: resolvedVideoSource ?? {
                clipId: clip.id,
                sourceType: 'original',
                sourcePath: '',
                generatedVideoAssetId: null,
                asset: null
              },
              mediaUrl: resolvedVideoSource?.sourcePath ? `app-file://${resolvedVideoSource.sourcePath}` : null,
              reviewFeedback: reviewFeedback ?? defaultReviewFeedback(clip.id),
              transcriptContext: (transcriptContext || []).map((line: any) => ({
                id: String(line.id),
                index: Number(line.index ?? 0),
                start: Number(line.start ?? 0),
                end: Number(line.end ?? 0),
                text: String(line.text ?? ''),
                relation: line.relation === 'previous' || line.relation === 'next' ? line.relation : 'selected'
              })),
              transcriptLines: (transcriptSegments || []).map((segment: any) => ({
                id: segment.id,
                start: Number(segment.start_time ?? segment.start ?? 0),
                end: Number(segment.end_time ?? segment.end ?? 0),
                text: segment.text || ''
              }))
            } satisfies ClipCardData
          })
        )

        setClips(detailedClips)
      } catch (loadError) {
        console.error('Failed to load clip workspace:', loadError)
        setError('Failed to load clip workspace')
      } finally {
        setLoading(false)
      }
    }

    void loadWorkspace()
  }, [episodeId])

  useEffect(() => {
    if (!clipId) return
    const target = cardRefs.current[clipId]
    if (!target) return

    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [clipId, clips])

  const selectedClipId = useMemo(() => clipId || null, [clipId])

  const handleVideoSourceChange = async (targetClipId: string, nextValue: string) => {
    const [sourceType, generatedVideoAssetIdRaw] = nextValue.split(':')
    const generatedVideoAssetId = generatedVideoAssetIdRaw || null

    try {
      setUpdatingVideoSourceClipId(targetClipId)
      const visualSource = await window.electronAPI?.setClipVisualSource?.(
        targetClipId,
        sourceType as ClipVisualSource['sourceType'],
        generatedVideoAssetId
      )
      const resolvedVideoSource = await window.electronAPI?.resolveClipVideoSource?.(targetClipId)

      setClips((currentClips) =>
        currentClips.map((clip) =>
          clip.id === targetClipId
            ? {
                ...clip,
                visualSource: visualSource ?? clip.visualSource,
                resolvedVideoSource: resolvedVideoSource ?? clip.resolvedVideoSource,
                mediaUrl: resolvedVideoSource?.sourcePath ? `app-file://${resolvedVideoSource.sourcePath}` : clip.mediaUrl
              }
            : clip
        )
      )
    } catch (sourceError) {
      console.error('Failed to update clip visual source:', sourceError)
    } finally {
      setUpdatingVideoSourceClipId(null)
    }
  }

  const updateClipStatus = async (targetClipId: string, status: Clip['status']) => {
    try {
      const response = await window.electronAPI?.updateClipStatus?.(targetClipId, status)
      setClips((currentClips) =>
        currentClips.map((clip) =>
          clip.id === targetClipId
            ? {
                ...clip,
                status,
                publicationStatus:
                  isClipApproved(status)
                    ? (response as any)?.scheduling?.publication?.status ?? clip.publicationStatus
                    : clip.publicationStatus
              }
            : clip
        )
      )
    } catch (statusError) {
      console.error(`Failed to update clip status to ${status}:`, statusError)
    }
  }

  const updateClipBoundaryFeedback = async (
    targetClipId: string,
    boundary: 'startQuality' | 'endQuality',
    quality: ClipBoundaryQuality
  ) => {
    try {
      const saved = await window.electronAPI?.saveClipReviewFeedback?.(targetClipId, {
        [boundary]: quality
      })
      setClips((currentClips) =>
        currentClips.map((clip) =>
          clip.id === targetClipId
            ? {
                ...clip,
                reviewFeedback: saved ?? {
                  ...(clip.reviewFeedback ?? defaultReviewFeedback(targetClipId)),
                  [boundary]: quality,
                  updatedAt: new Date().toISOString()
                }
              }
            : clip
        )
      )
    } catch (feedbackError) {
      console.error(`Failed to save ${boundary} feedback:`, feedbackError)
    }
  }

  const renderBoundaryButtons = (
    clip: ClipCardData,
    boundary: 'startQuality' | 'endQuality',
    options: Array<{ value: ClipBoundaryQuality; label: string }>
  ) => (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const selected = (clip.reviewFeedback?.[boundary] ?? 'unreviewed') === option.value
        return (
          <button
            key={`${clip.id}-${boundary}-${option.value}`}
            type="button"
            onClick={() => updateClipBoundaryFeedback(clip.id, boundary, option.value)}
            className={`rounded-[5px] border px-2 py-1 text-[11px] transition-colors ${
              selected
                ? 'border-accent-primary bg-accent-primary/15 text-text-primary'
                : 'border-border-default text-text-muted hover:bg-hover-bg hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )

  if (loading) {
    return (
      <div
        className="clip-workspace-shell flex h-full items-center justify-center"
        style={{ marginLeft: 'var(--nav-dock-width, 72px)' }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <div className="text-center">
            <div className="text-lg text-text-primary">Loading clips…</div>
            <div className="text-sm text-text-muted">Preparing workspace</div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !episodeId) {
    return (
      <div
        className="clip-workspace-shell flex h-full items-center justify-center"
        style={{ marginLeft: 'var(--nav-dock-width, 72px)' }}
      >
        <div className="flex h-full w-full items-center justify-center">
          <div className="max-w-md text-center">
            <div className="text-lg text-text-primary">Workspace unavailable</div>
            <div className="mt-2 text-sm text-text-muted">{error || 'The clip workspace could not be loaded.'}</div>
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-5 inline-flex items-center gap-2 rounded-full border border-border-default bg-bg-secondary px-4 py-2 text-sm text-text-primary transition-colors hover:bg-hover-bg"
            >
              <IoArrowBack size={15} />
              Back home
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="clip-workspace-shell"
      style={{ marginLeft: 'var(--nav-dock-width, 72px)' }}
    >
      <div className="w-full pb-16">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="shell-inline-button"
        >
          <IoArrowBack size={15} />
          <span>Back home</span>
        </button>

        {clips.length > 0 && (
          <details className="mt-8 rounded-[8px] border border-border-default bg-bg-secondary/70 p-4">
            <summary className="cursor-pointer text-[12px] uppercase tracking-[0.18em] text-text-muted">
              Boundary review
            </summary>
            <div className="mt-4 space-y-4">
              {clips.map((clip) => (
                <section
                  key={`boundary-review-${clip.id}`}
                  className="rounded-[6px] border border-border-default bg-bg-primary/60 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="line-clamp-1 text-sm text-text-primary">{clip.title}</div>
                      <div className="mt-1 font-mono text-[11px] text-text-muted">
                        {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-[5px] border border-border-default px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-hover-bg hover:text-text-primary"
                      onClick={() => navigate(`/content/${episodeId}/${clip.id}`)}
                    >
                      Edit
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-[48px_1fr] gap-x-3 gap-y-2 text-[11px]">
                    <span className="pt-1 uppercase tracking-[0.16em] text-text-muted">Start</span>
                    {renderBoundaryButtons(clip, 'startQuality', startBoundaryQualityOptions)}
                    <span className="pt-1 uppercase tracking-[0.16em] text-text-muted">End</span>
                    {renderBoundaryButtons(clip, 'endQuality', endBoundaryQualityOptions)}
                  </div>

                  {clip.transcriptContext.length > 0 && (
                    <details className="mt-3 rounded-[6px] border border-border-default bg-bg-secondary/60 p-2 text-[11px]">
                      <summary className="cursor-pointer uppercase tracking-[0.16em] text-text-muted">Transcript context</summary>
                      <div className="mt-2 max-h-56 space-y-1 overflow-auto">
                        {clip.transcriptContext.map((line) => (
                          <button
                            key={`${clip.id}-review-context-${line.id}`}
                            type="button"
                            onClick={() => {
                              if (line.relation === 'previous') {
                                void updateClipBoundaryFeedback(clip.id, 'startQuality', 'extend_start')
                              } else if (line.relation === 'next') {
                                void updateClipBoundaryFeedback(clip.id, 'endQuality', 'extend_end')
                              }
                            }}
                            className={`w-full rounded-[5px] border px-2 py-1.5 text-left transition-colors ${
                              line.relation === 'selected'
                                ? 'border-accent-primary/40 bg-accent-primary/10 text-text-primary'
                                : 'border-border-default text-text-muted hover:bg-hover-bg hover:text-text-primary'
                            }`}
                          >
                            <div className="mb-0.5 flex items-center justify-between gap-2">
                              <span className="font-mono text-[10px]">{formatTime(line.start)}-{formatTime(line.end)}</span>
                              <span className="text-[10px] uppercase tracking-[0.14em]">{line.relation}</span>
                            </div>
                            <div>{line.text}</div>
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </section>
              ))}
            </div>
          </details>
        )}

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
          {clips.map((clip) => {
            const isFocused = clip.id === selectedClipId

            return (
              <article
                key={clip.id}
                ref={(node) => {
                  cardRefs.current[clip.id] = node
                }}
                className={`clip-card clip-card-grid ${isFocused ? 'selected' : ''}`}
              >
                {!isClipPendingReview(clip.status) && (
                  <div className={`status-badge ${clip.status}`}>
                    {isClipApproved(clip.status) ? '✓' : '✗'}
                  </div>
                )}

                {clip.publicationStatus && (
                  <div className={`status-badge publication publication-${clip.publicationStatus}`}>
                    {clip.publicationStatus.split('_').join(' ')}
                  </div>
                )}

                <div className="clip-card-preview-shell">
                  <ClipPreview
                    mediaUrl={clip.mediaUrl}
                    startTime={clip.startTime}
                    endTime={clip.endTime}
                    title={clip.title}
                    compact
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Video source</div>
                  <select
                    value={
                      clip.visualSource.sourceType === 'generated_video' && clip.visualSource.generatedVideoAssetId
                        ? `generated_video:${clip.visualSource.generatedVideoAssetId}`
                        : 'original:'
                    }
                    onChange={(event) => void handleVideoSourceChange(clip.id, event.target.value)}
                    className="brand-control-select w-full"
                    disabled={updatingVideoSourceClipId === clip.id}
                  >
                    <option value="original:">Original clip</option>
                    {generatedVideoAssets.map((asset) => (
                      <option key={asset.id} value={`generated_video:${asset.id}`}>
                        Library: {asset.name}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-text-muted">
                    {clip.resolvedVideoSource.sourceType === 'generated_video'
                      ? `Using library video${clip.resolvedVideoSource.asset?.name ? `: ${clip.resolvedVideoSource.asset.name}` : ''}`
                      : 'Using original episode source'}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="clip-workspace-score">
                    {Math.round(clip.shareabilityScore * 10)}
                  </div>
                  <div className="clip-card-header !mb-0">
                    <span className={`content-type ${clip.contentType}`}>
                      {clip.contentType}
                    </span>
                  </div>
                </div>

                <h2 className="clip-card-grid-title">
                  {clip.title}
                </h2>

                <div className="clip-metadata">
                  <span className="duration">{formatTime(clip.duration)}</span>
                  <span className="divider">•</span>
                  <span className="timestamp">
                    {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                  </span>
                </div>

                <div className="clip-actions clip-actions-grid">
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-approve clip-card-button-icon"
                    onClick={() => updateClipStatus(clip.id, 'approved_by_user')}
                    aria-label="Approve clip"
                    title="Approve"
                  >
                    <IoCheckmark size={16} />
                  </button>
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-reject clip-card-button-icon"
                    onClick={() => updateClipStatus(clip.id, 'rejected_by_user')}
                    aria-label="Reject clip"
                    title="Reject"
                  >
                    <IoClose size={16} />
                  </button>
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-secondary clip-card-button-icon"
                    onClick={() => navigate(`/content/${episodeId}/${clip.id}`)}
                    aria-label="Edit clip"
                    title="Edit"
                  >
                    <IoCreateOutline size={16} />
                  </button>
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-secondary clip-card-button-icon"
                    onClick={() => navigate(`/export/${episodeId}`)}
                    aria-label="Export clip"
                    title="Export"
                  >
                    <IoShareOutline size={16} />
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
