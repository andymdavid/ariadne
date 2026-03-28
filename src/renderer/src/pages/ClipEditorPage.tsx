import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IoArrowBack,
  IoCheckmarkCircleOutline,
  IoExpandOutline,
  IoMusicalNotesOutline,
  IoPlay,
  IoPause,
  IoResizeOutline,
  IoSaveOutline
} from 'react-icons/io5'
import type { BrandTemplate } from '@shared/types'

type ClipRecord = {
  id: string
  keyQuote: string
  startTime: number
  endTime: number
  duration: number
}

type TranscriptLine = {
  id: string
  start: number
  end: number
  text: string
}

type PreviewCaptionState = {
  text: string
  font: string
  position: 'top' | 'center' | 'bottom' | 'custom'
  customX?: number | null
  customY?: number | null
}

type PreviewLogoState = {
  enabled: boolean
  assetPath: string | null
  positionX: number
  positionY: number
  scale: number
  opacity: number
}

type PreviewFrameState = {
  aspectRatio: '9:16' | '1:1' | '16:9'
  cropMode: 'fit' | 'center' | 'blur'
}

const formatClockTime = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00'
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  const hundredths = Math.floor((seconds % 1) * 100)

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
  }

  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${hundredths.toString().padStart(2, '0')}`
}

export function ClipEditorPage() {
  const navigate = useNavigate()
  const { id: episodeId, clipId } = useParams<{ id: string; clipId: string }>()
  const [clip, setClip] = useState<ClipRecord | null>(null)
  const [clipTitle, setClipTitle] = useState('Untitled clip')
  const [mediaUrl, setMediaUrl] = useState<string | null>(null)
  const [episodeDuration, setEpisodeDuration] = useState(0)
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([])
  const [isTranscriptOnly, setIsTranscriptOnly] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [captionPreview, setCaptionPreview] = useState<PreviewCaptionState | null>(null)
  const [logoPreview, setLogoPreview] = useState<PreviewLogoState | null>(null)
  const [framePreview, setFramePreview] = useState<PreviewFrameState | null>(null)
  const [musicEnabled, setMusicEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const transcriptScrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const loadEditor = async () => {
      if (!episodeId || !clipId) {
        setError('Missing episode or clip ID')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const [rawClip, mediaSource, titles, segments, brandTemplate, clipEdits] = await Promise.all([
          window.electronAPI?.getClip?.(clipId),
          window.electronAPI?.getEpisodeMediaSource?.(episodeId),
          window.electronAPI?.getClipTitles?.(clipId).catch(() => []),
          window.electronAPI?.getClipTranscriptSegments?.(clipId).catch(() => []),
          window.electronAPI?.getBrandTemplate?.().catch(() => null),
          window.electronAPI?.getClipEdits?.(clipId).catch(() => null)
        ])

        if (!rawClip) {
          setError('Clip not found')
          return
        }

        const mappedClip: ClipRecord = {
          id: rawClip.id,
          keyQuote: rawClip.key_quote ?? rawClip.keyQuote ?? 'Untitled clip',
          startTime: Number(rawClip.start_time ?? rawClip.startTime ?? 0),
          endTime: Number(rawClip.end_time ?? rawClip.endTime ?? 0),
          duration: Number(rawClip.duration ?? 0)
        }

        setClip(mappedClip)
        setClipTitle((titles || []).find((entry: any) => entry.is_selected)?.title || (titles || [])[0]?.title || mappedClip.keyQuote)
        setMediaUrl(mediaSource?.mediaUrl ?? null)
        setEpisodeDuration(mediaSource?.duration ?? 0)
        setTranscriptLines(
          (segments || []).map((segment: any) => ({
            id: segment.id,
            start: Number(segment.start_time ?? segment.start ?? 0),
            end: Number(segment.end_time ?? segment.end ?? 0),
            text: segment.text || ''
          }))
        )
        setCurrentTime(mappedClip.startTime)

        const template = brandTemplate as BrandTemplate | null
        const activeCaptionText =
          transcriptLines[0]?.text ||
          (segments || [])[0]?.text ||
          mappedClip.keyQuote

        setCaptionPreview({
          text: activeCaptionText,
          font: clipEdits?.caption_font || template?.caption.font || 'Inter',
          position: (clipEdits?.caption_position || template?.caption.position || 'bottom') as PreviewCaptionState['position'],
          customX: clipEdits?.caption_custom_x ?? template?.caption.customX ?? null,
          customY: clipEdits?.caption_custom_y ?? template?.caption.customY ?? null
        })

        setLogoPreview({
          enabled: clipEdits ? clipEdits.logo_enabled === 1 : template?.logo.enabled ?? false,
          assetPath: clipEdits?.logo_path || template?.logo.assetPath || null,
          positionX: clipEdits?.logo_position_x ?? template?.logo.positionX ?? 85,
          positionY: clipEdits?.logo_position_y ?? template?.logo.positionY ?? 85,
          scale: clipEdits?.logo_scale ?? template?.logo.scale ?? 0.15,
          opacity: clipEdits?.logo_opacity ?? template?.logo.opacity ?? 0.8
        })

        setFramePreview({
          aspectRatio: (clipEdits?.aspect_ratio || template?.frame.aspectRatio || '9:16') as PreviewFrameState['aspectRatio'],
          cropMode: (clipEdits?.crop_mode === 'canvas' ? 'fit' : (clipEdits?.crop_mode || template?.frame.cropMode || 'fit')) as PreviewFrameState['cropMode']
        })

        setMusicEnabled(clipEdits ? clipEdits.music_enabled === 1 : template?.music.enabled ?? false)
      } catch (loadError) {
        console.error('Failed to load clip editor:', loadError)
        setError('Failed to load clip editor')
      } finally {
        setLoading(false)
      }
    }

    void loadEditor()
  }, [clipId, episodeId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !clip || !mediaUrl) return

    const handleLoadedMetadata = () => {
      video.currentTime = clip.startTime
      setCurrentTime(clip.startTime)
    }

    const handleTimeUpdate = () => {
      const nextTime = video.currentTime
      setCurrentTime(nextTime)

      if (nextTime >= clip.endTime) {
        video.pause()
        video.currentTime = clip.startTime
        setCurrentTime(clip.startTime)
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
  }, [clip, mediaUrl])

  const activeLineId = useMemo(() => {
    return transcriptLines.find((line) => currentTime >= line.start && currentTime <= line.end)?.id || null
  }, [currentTime, transcriptLines])

  useEffect(() => {
    if (!activeLineId || !transcriptScrollerRef.current) return

    const activeNode = transcriptScrollerRef.current.querySelector<HTMLElement>(`[data-line-id="${activeLineId}"]`)
    activeNode?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeLineId])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || !clip) return

    if (isPlaying) {
      video.pause()
      return
    }

    if (video.currentTime < clip.startTime || video.currentTime >= clip.endTime) {
      video.currentTime = clip.startTime
      setCurrentTime(clip.startTime)
    }

    void video.play()
  }

  const seekWithinClip = (nextTime: number) => {
    const video = videoRef.current
    if (!video || !clip) return

    const clampedTime = Math.min(Math.max(nextTime, clip.startTime), clip.endTime)
    video.currentTime = clampedTime
    setCurrentTime(clampedTime)
  }

  const timelineProgress = useMemo(() => {
    if (!clip || clip.duration <= 0) return 0
    return ((currentTime - clip.startTime) / clip.duration) * 100
  }, [clip, currentTime])

  useEffect(() => {
    if (!transcriptLines.length) return

    const activeLine = transcriptLines.find((line) => currentTime >= line.start && currentTime <= line.end) || transcriptLines[0]
    setCaptionPreview((currentCaption) => {
      if (!currentCaption) return currentCaption
      return {
        ...currentCaption,
        text: activeLine?.text || currentCaption.text
      }
    })
  }, [currentTime, transcriptLines])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-[#08090c]">
        <div className="text-center">
          <div className="text-lg text-text-primary">Loading clip editor…</div>
          <div className="text-sm text-text-muted">Preparing transcript and preview</div>
        </div>
      </div>
    )
  }

  if (error || !clip || !episodeId) {
    return (
      <div className="flex h-full items-center justify-center bg-[#08090c]">
        <div className="max-w-md text-center">
          <div className="text-lg text-text-primary">Editor unavailable</div>
          <div className="mt-2 text-sm text-text-muted">{error || 'Clip data could not be loaded.'}</div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#12151b] px-4 py-2 text-sm text-text-primary transition-colors hover:bg-[#171b22]"
          >
            <IoArrowBack size={15} />
            Back home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-[#08090c] text-text-primary">
      <header className="flex items-center justify-between border-b border-white/8 px-6 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <button
            type="button"
            onClick={() => navigate(`/review/${episodeId}`)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-secondary transition-colors hover:bg-white/6 hover:text-text-primary"
          >
            <IoArrowBack size={16} />
          </button>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-text-primary">{clipTitle}</div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-xl border border-white/8 bg-[#14171d] px-4 py-2 text-sm font-medium text-text-muted"
          >
            <IoSaveOutline size={16} />
            Save changes
          </button>
          <button
            type="button"
            onClick={() => navigate(`/export/${episodeId}`)}
            className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black"
          >
            Export
          </button>
        </div>
      </header>

      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: 'minmax(320px, 1.05fr) minmax(440px, 1fr)' }}
      >
        <section className="flex min-h-0 flex-col border-r border-white/8 px-6 py-5">
          <div className="mb-4 flex items-center justify-between">
            <label className="inline-flex items-center gap-3 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={isTranscriptOnly}
                onChange={(event) => setIsTranscriptOnly(event.target.checked)}
                className="h-4 w-4 rounded border-white/12 bg-transparent"
              />
              Transcript only
            </label>
            <button
              type="button"
              className="rounded-lg border border-white/8 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-white/6 hover:text-text-primary"
            >
              + Add a section
            </button>
          </div>

          <div ref={transcriptScrollerRef} className="min-h-0 flex-1 overflow-y-auto pr-4">
            <div className="space-y-8 text-[15px] leading-9 text-[#d8dbe2]">
              {transcriptLines.map((line) => (
                <div
                  key={line.id}
                  data-line-id={line.id}
                  className={`rounded-xl px-2 py-1 transition-colors ${
                    activeLineId === line.id ? 'bg-white/8 text-white' : ''
                  }`}
                >
                  {line.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <div className="flex items-center justify-between px-8 py-5">
            <div className="flex items-center gap-7 text-sm text-text-secondary">
              <span className="inline-flex items-center gap-2">
                <IoResizeOutline size={15} />
                {framePreview?.aspectRatio || '9:16'}
              </span>
              <span className="inline-flex items-center gap-2">
                <IoExpandOutline size={15} />
                Layout: {framePreview?.cropMode === 'blur' ? 'Blur' : framePreview?.cropMode === 'center' ? 'Center Crop' : 'Fill'}
              </span>
              <span>Tracker: OFF</span>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-6">
            <div className="relative aspect-[9/16] h-full max-h-[420px] min-h-0 overflow-hidden rounded-[24px] bg-black">
              {mediaUrl ? (
                <video
                  ref={videoRef}
                  src={mediaUrl}
                  className="h-full w-full object-cover"
                  playsInline
                  muted
                  preload="metadata"
                />
              ) : null}
              <div className="absolute left-5 top-5 rounded-full bg-black/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
                Preview
              </div>
              {logoPreview?.enabled && logoPreview.assetPath ? (
                <img
                  src={`app-file://${logoPreview.assetPath}`}
                  alt="Brand logo"
                  className="absolute"
                  style={{
                    left: `${logoPreview.positionX}%`,
                    top: `${logoPreview.positionY}%`,
                    transform: 'translate(-50%, -50%)',
                    width: `${logoPreview.scale * 100}%`,
                    opacity: logoPreview.opacity,
                    zIndex: 20
                  }}
                />
              ) : null}
              {captionPreview?.text ? (
                <div
                  className="absolute left-1/2 max-w-[72%] -translate-x-1/2 rounded-xl bg-white/90 px-4 py-2 text-center text-[18px] font-semibold text-black shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                  style={{
                    fontFamily: captionPreview.font,
                    top:
                      captionPreview.position === 'top'
                        ? '12%'
                        : captionPreview.position === 'center'
                          ? '50%'
                          : captionPreview.position === 'custom' && captionPreview.customY != null
                            ? `${captionPreview.customY}%`
                            : undefined,
                    bottom:
                      captionPreview.position === 'bottom'
                        ? '12%'
                        : captionPreview.position === 'custom' && captionPreview.customY == null
                          ? '12%'
                          : undefined,
                    left:
                      captionPreview.position === 'custom' && captionPreview.customX != null
                        ? `${captionPreview.customX}%`
                        : '50%',
                    transform:
                      captionPreview.position === 'center'
                        ? 'translate(-50%, -50%)'
                        : 'translateX(-50%)',
                    zIndex: 25
                  }}
                >
                  {captionPreview.text}
                </div>
              ) : null}
              {musicEnabled ? (
                <div className="absolute bottom-5 left-5 inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 text-xs text-white/85">
                  <IoMusicalNotesOutline size={14} />
                  Music on
                </div>
              ) : null}
            </div>
          </div>
        </section>

      </div>

      <footer className="shrink-0 border-t border-white/8 bg-[#090b0f]">
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-3">
          <div className="flex items-center gap-4 text-sm text-text-secondary">
            <button type="button" className="inline-flex items-center gap-2 hover:text-text-primary">
              <IoCheckmarkCircleOutline size={15} />
              Hide timeline
            </button>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => seekWithinClip(currentTime - 1)}
              className="text-text-secondary transition-colors hover:text-text-primary"
            >
              ‹‹
            </button>
            <button
              type="button"
              onClick={togglePlayback}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-black"
            >
              {isPlaying ? <IoPause size={16} /> : <IoPlay size={16} />}
            </button>
            <button
              type="button"
              onClick={() => seekWithinClip(currentTime + 1)}
              className="text-text-secondary transition-colors hover:text-text-primary"
            >
              ››
            </button>
            <div className="text-sm text-text-secondary">
              {formatClockTime(currentTime - clip.startTime)} / {formatClockTime(clip.duration)}
            </div>
          </div>
        </div>

        <div className="px-6 py-4">
          <div className="relative mb-4 h-1 rounded-full bg-white/8">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: `${Math.min(Math.max(timelineProgress, 0), 100)}%` }}
            />
          </div>

          <div className="flex items-end gap-2 overflow-x-auto pb-2">
            {transcriptLines.map((line) => {
              const width = episodeDuration > 0 ? Math.max(((line.end - line.start) / episodeDuration) * 1000, 54) : 72
              const isActive = activeLineId === line.id

              return (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => seekWithinClip(line.start)}
                  className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                    isActive
                      ? 'border-white/20 bg-white/10 text-white'
                      : 'border-white/8 bg-[#11141a] text-text-secondary hover:border-white/14 hover:text-text-primary'
                  }`}
                  style={{ width }}
                >
                  <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-text-muted">Segment</div>
                  <div className="truncate text-xs">{line.text}</div>
                </button>
              )
            })}
          </div>
        </div>
      </footer>
    </div>
  )
}
