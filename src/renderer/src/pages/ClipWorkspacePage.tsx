import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IoArrowBack, IoCheckmark, IoClose, IoCreateOutline, IoPlay, IoPause, IoShareOutline } from 'react-icons/io5'
import type { Clip } from '@shared/types'

type ClipCardData = Clip & {
  title: string
  transcriptLines: Array<{ id: string; start: number; end: number; text: string }>
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

        <div className={`absolute left-3 top-3 bg-black/55 font-medium uppercase tracking-[0.16em] text-white/75 ${compact ? 'rounded-[5px] px-2 py-1 text-[10px]' : 'rounded-full px-3 py-1 text-[11px]'}`}>
          Clip preview
        </div>
        <div className={`absolute right-3 top-3 bg-black/70 font-medium text-white ${compact ? 'rounded-[5px] px-2 py-1 text-[12px]' : 'rounded-full px-3 py-1 text-sm'}`}>
          {formatTime(endTime - startTime)}
        </div>
        <button
          type="button"
          onClick={togglePlayback}
          className={`absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/30 to-transparent text-white ${compact ? 'px-3 py-2.5 text-[12px]' : 'px-4 py-4 text-sm'}`}
        >
          <span className="max-w-[70%] truncate text-left">{title}</span>
          <span className={`inline-flex items-center gap-1.5 bg-white/14 ${compact ? 'rounded-[5px] px-2 py-1.5 text-[11px]' : 'rounded-full px-3 py-2'}`}>
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
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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

        const [mediaSource, rawClips] = await Promise.all([
          window.electronAPI?.getEpisodeMediaSource?.(episodeId),
          window.electronAPI?.getEpisodeClips?.(episodeId)
        ])

        setMediaUrl(mediaSource?.mediaUrl ?? null)

        const normalizedClips = ((rawClips || []) as RawClip[]).map((clip) => mapClip(clip, episodeId))

        const detailedClips = await Promise.all(
          normalizedClips.map(async (clip) => {
            const [titles, transcriptSegments] = await Promise.all([
              window.electronAPI?.getClipTitles?.(clip.id).catch(() => []),
              window.electronAPI?.getClipTranscriptSegments?.(clip.id).catch(() => [])
            ])

            const selectedTitle =
              (titles || []).find((title: any) => title.is_selected)?.title ||
              (titles || [])[0]?.title ||
              clip.keyQuote

            return {
              ...clip,
              title: selectedTitle,
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

  const updateClipStatus = async (targetClipId: string, status: Clip['status']) => {
    try {
      await window.electronAPI?.updateClipStatus?.(targetClipId, status)
      setClips((currentClips) =>
        currentClips.map((clip) => (clip.id === targetClipId ? { ...clip, status } : clip))
      )
    } catch (statusError) {
      console.error(`Failed to update clip status to ${status}:`, statusError)
    }
  }

  if (loading) {
    return (
      <div
        className="flex h-full items-center justify-center bg-[#0a0b0f]"
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
        className="flex h-full items-center justify-center bg-[#0a0b0f]"
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
      className="h-full overflow-y-auto bg-[#0a0b0f] px-10 py-8"
      style={{ marginLeft: 'var(--nav-dock-width, 72px)' }}
    >
      <div className="w-full pb-16">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 rounded-[5px] border border-white/8 bg-[#12151b]/88 px-3 py-2 text-sm text-text-secondary transition-colors hover:border-white/12 hover:bg-[#171b22] hover:text-text-primary"
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

                <div className="clip-card-preview-shell">
                  <ClipPreview
                    mediaUrl={mediaUrl}
                    startTime={clip.startTime}
                    endTime={clip.endTime}
                    title={clip.title}
                    compact
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="text-[18px] font-semibold leading-none text-[#72e695]">
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
