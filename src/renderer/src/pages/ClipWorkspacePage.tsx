import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IoArrowBack, IoCheckmark, IoClose, IoPlay, IoPause, IoShareOutline } from 'react-icons/io5'
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
  title
}: {
  mediaUrl: string | null
  startTime: number
  endTime: number
  title: string
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
      <div className="relative aspect-[9/16] w-full bg-black">
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

        <div className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white/75">
          Clip preview
        </div>
        <div className="absolute right-3 top-3 rounded-full bg-black/70 px-3 py-1 text-sm font-medium text-white">
          {formatTime(endTime - startTime)}
        </div>
        <button
          type="button"
          onClick={togglePlayback}
          className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 via-black/30 to-transparent px-4 py-4 text-sm text-white"
        >
          <span className="max-w-[70%] truncate text-left">{title}</span>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/14 px-3 py-2">
            {isPlaying ? <IoPause size={16} /> : <IoPlay size={16} />}
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

  const selectedClipId = useMemo(() => clipId || clips[0]?.id || null, [clipId, clips])

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
      <div className="ml-[220px] flex h-full items-center justify-center bg-[#0a0b0f]">
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
      <div className="ml-[220px] flex h-full items-center justify-center bg-[#0a0b0f]">
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
    <div className="ml-[220px] h-full overflow-y-auto bg-[#0a0b0f] px-10 py-8">
      <div className="w-full space-y-0 pb-16">
          <button
            type="button"
            onClick={() => navigate(`/review/${episodeId}`)}
            className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-[#12151b]/88 px-3 py-2 text-sm text-text-secondary transition-colors hover:border-white/12 hover:bg-[#171b22] hover:text-text-primary"
          >
            <IoArrowBack size={15} />
            <span>Back to clips</span>
          </button>

          {clips.map((clip) => {
            const isFocused = clip.id === selectedClipId

            return (
              <section
                key={clip.id}
                ref={(node) => {
                  cardRefs.current[clip.id] = node
                }}
                className={`w-full border-b px-0 py-8 transition-colors ${
                  isFocused ? 'border-white/14' : 'border-white/8'
                }`}
              >
                <div className="mb-7 flex items-start justify-between gap-6">
                  <div className="max-w-4xl">
                    <h1 className="text-[22px] font-semibold leading-[1.35] tracking-[-0.02em] text-text-primary">
                      {clip.title}
                    </h1>
                    {clip.reason ? (
                      <p className="mt-3 text-sm leading-6 text-text-secondary">{clip.reason}</p>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-[140px_320px_minmax(0,1fr)_180px] gap-6">
                  <aside className="space-y-3">
                    <div className="rounded-2xl border border-white/8 bg-[#0d1014] p-4">
                      <div className="text-[12px] uppercase tracking-[0.16em] text-text-muted">Score</div>
                      <div className="mt-3 text-[48px] font-semibold leading-none text-[#8df0a7]">
                        {Math.round(clip.shareabilityScore * 10)}
                      </div>
                      <div className="mt-2 text-sm text-text-secondary">{clip.contentType.replace('_', ' ')}</div>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-[#0d1014] space-y-3 p-4 text-sm text-text-secondary">
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Duration</div>
                        <div className="mt-1 text-text-primary">{formatTime(clip.duration)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Range</div>
                        <div className="mt-1 text-text-primary">
                          {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">Status</div>
                        <div className="mt-1 capitalize text-text-primary">{clip.status}</div>
                      </div>
                    </div>
                  </aside>

                  <ClipPreview
                    mediaUrl={mediaUrl}
                    startTime={clip.startTime}
                    endTime={clip.endTime}
                    title={clip.title}
                  />

                  <section className="min-h-[568px] rounded-2xl border border-white/8 bg-[#0d1014] p-5">
                    <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/8 pb-4">
                      <div className="text-sm font-medium text-text-primary">Transcript</div>
                      <div className="text-xs text-text-muted">
                        {clip.transcriptLines.length} segments
                      </div>
                    </div>
                    <div className="max-h-[500px] space-y-4 overflow-y-auto pr-2">
                      {clip.transcriptLines.length > 0 ? (
                        clip.transcriptLines.map((segment) => (
                          <div key={segment.id} className="text-[15px] leading-8 text-text-secondary">
                            <span className="mr-2 text-xs text-text-muted">
                              [{formatTime(segment.start)}-{formatTime(segment.end)}]
                            </span>
                            <span>{segment.text}</span>
                          </div>
                        ))
                      ) : (
                        <div className="pt-20 text-center text-sm text-text-muted">No transcript available for this clip.</div>
                      )}
                    </div>
                  </section>

                  <aside className="space-y-3">
                    <button
                      type="button"
                      onClick={() => updateClipStatus(clip.id, 'approved')}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-[#181d24] px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:border-white/12 hover:bg-[#1d232c]"
                    >
                      <IoCheckmark size={16} />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => updateClipStatus(clip.id, 'rejected')}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-[#181d24] px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:border-white/12 hover:bg-[#1d232c]"
                    >
                      <IoClose size={16} />
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/export/${episodeId}`)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/8 bg-[#181d24] px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:border-white/12 hover:bg-[#1d232c]"
                    >
                      <IoShareOutline size={16} />
                      Export
                    </button>
                  </aside>
                </div>
              </section>
            )
          })}
      </div>
    </div>
  )
}
