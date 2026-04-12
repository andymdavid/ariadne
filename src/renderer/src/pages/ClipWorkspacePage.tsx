import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IoArrowBack, IoCheckmark, IoClose, IoCreateOutline, IoPlay, IoPause, IoShareOutline } from 'react-icons/io5'
import type { Clip, ClipVisualSource, GeneratedVideoAsset, ResolvedClipVideoSource, ScheduledPublication } from '@shared/types'

type ClipCardData = Clip & {
  title: string
  transcriptLines: Array<{ id: string; start: number; end: number; text: string; episodeSegmentIndex: number }>
  publicationStatus?: string | null
  visualSource: ClipVisualSource
  resolvedVideoSource: ResolvedClipVideoSource
  mediaUrl: string | null
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
  status: (clip.status || 'pending') as Clip['status'],
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

function ClipPreview({
  mediaUrl,
  startTime,
  endTime,
  title,
  transcriptLines,
  compact = false
}: {
  mediaUrl: string | null
  startTime: number
  endTime: number
  title: string
  transcriptLines: Array<{ id: string; start: number; end: number; text: string }>
  compact?: boolean
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(startTime)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaUrl) return

    const handleLoadedMetadata = () => {
      video.currentTime = startTime
    }

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      if (video.currentTime >= endTime) {
        video.pause()
        video.currentTime = startTime
        setIsPlaying(false)
        setCurrentTime(startTime)
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
    setCurrentTime(startTime)
  }, [mediaUrl, startTime, endTime])

  const activeCaptionLine = useMemo(() => {
    const active = transcriptLines.find((line) => currentTime >= line.start && currentTime <= line.end)
    if (active) return active

    const upcoming = transcriptLines.find((line) => currentTime < line.start)
    return upcoming ?? transcriptLines[transcriptLines.length - 1] ?? null
  }, [currentTime, transcriptLines])

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
        {activeCaptionLine?.text ? (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
            <div className={`max-w-[88%] rounded-[3px] bg-[#0f0f0f] px-3 py-1.5 text-center font-medium text-white ${compact ? 'text-[11px]' : 'text-sm'}`}>
              {activeCaptionLine.text}
            </div>
          </div>
        ) : null}
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
  const [savingTranscriptKey, setSavingTranscriptKey] = useState<string | null>(null)
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
            const [titles, transcriptSegments, visualSource, resolvedVideoSource] = await Promise.all([
              window.electronAPI?.getClipTitles?.(clip.id).catch(() => []),
              window.electronAPI?.getClipTranscriptSegments?.(clip.id).catch(() => []),
              window.electronAPI?.getClipVisualSource?.(clip.id).catch(() => defaultVisualSource(clip.id)),
              window.electronAPI?.resolveClipVideoSource?.(clip.id).catch(() => null)
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
              transcriptLines: (transcriptSegments || []).map((segment: any) => ({
                id: segment.id,
                start: Number(segment.start_time ?? segment.start ?? 0),
                end: Number(segment.end_time ?? segment.end ?? 0),
                text: segment.text || '',
                episodeSegmentIndex: Number(segment.episode_segment_index ?? 0)
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
                  status === 'approved'
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

  const handleTranscriptChange = (targetClipId: string, lineId: string, nextText: string) => {
    setClips((currentClips) =>
      currentClips.map((clip) =>
        clip.id === targetClipId
          ? {
              ...clip,
              transcriptLines: clip.transcriptLines.map((line) =>
                line.id === lineId ? { ...line, text: nextText } : line
              )
            }
          : clip
      )
    )
  }

  const handleTranscriptBlur = async (
    targetClipId: string,
    lineId: string,
    episodeSegmentIndex: number,
    nextText: string
  ) => {
    if (!episodeId) return

    const saveKey = `${targetClipId}:${lineId}`
    setSavingTranscriptKey(saveKey)

    try {
      await window.electronAPI?.updateTranscriptSegment?.(episodeId, episodeSegmentIndex, nextText)
    } catch (transcriptError) {
      console.error('Failed to save transcript segment:', transcriptError)
    } finally {
      setSavingTranscriptKey(null)
    }
  }

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
                {clip.status !== 'pending' && (
                  <div className={`status-badge ${clip.status}`}>
                    {clip.status === 'approved' ? '✓' : '✗'}
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
                    transcriptLines={clip.transcriptLines}
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

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Transcript</div>
                    {savingTranscriptKey?.startsWith(`${clip.id}:`) ? (
                      <div className="text-[11px] text-text-muted">Saving…</div>
                    ) : null}
                  </div>
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-[3px] border border-border-default bg-bg-secondary p-2">
                    {clip.transcriptLines.length > 0 ? (
                      clip.transcriptLines.map((line) => (
                        <textarea
                          key={line.id}
                          value={line.text}
                          onChange={(event) => handleTranscriptChange(clip.id, line.id, event.target.value)}
                          onBlur={(event) =>
                            void handleTranscriptBlur(
                              clip.id,
                              line.id,
                              line.episodeSegmentIndex,
                              event.target.value
                            )
                          }
                          className="brand-control-textarea min-h-[52px] w-full resize-y text-sm"
                        />
                      ))
                    ) : (
                      <div className="text-sm text-text-muted">No transcript lines available for this clip.</div>
                    )}
                  </div>
                </div>

                <div className="clip-actions clip-actions-grid">
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-approve clip-card-button-icon"
                    onClick={() => updateClipStatus(clip.id, 'approved')}
                    aria-label="Approve clip"
                    title="Approve"
                  >
                    <IoCheckmark size={16} />
                  </button>
                  <button
                    type="button"
                    className="clip-card-button clip-card-button-reject clip-card-button-icon"
                    onClick={() => updateClipStatus(clip.id, 'rejected')}
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
