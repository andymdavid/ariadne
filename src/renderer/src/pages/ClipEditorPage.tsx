import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IoArrowBack,
  IoCheckmarkCircleOutline,
  IoExpandOutline,
  IoFlashOffOutline,
  IoMusicalNotesOutline,
  IoPlay,
  IoPause,
  IoResizeOutline,
  IoTextOutline
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
  words?: Array<{
    word: string
    start: number
    end: number
  }>
}

type PreviewCaptionState = {
  presetId?: string | null
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

type CaptionLayoutConfig = {
  maxLines: number
  widthRatio: number
  minWidth: number
  maxWidth?: number
  fontScale: number
  minFontSize: number
  maxFontSize: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const measureTextWidth = (
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight = 600
) => {
  if (typeof document === 'undefined') return text.length * fontSize * 0.56
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return text.length * fontSize * 0.56
  context.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  return context.measureText(text).width
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

const getCaptionLayoutConfig = (
  presetId: string | null | undefined,
  _previewWidth: number
): CaptionLayoutConfig => {
  switch (presetId) {
    case 'deep-diver':
      return {
        maxLines: 1,
        widthRatio: 0.7,
        minWidth: 150,
        fontScale: 0.06,
        minFontSize: 15,
        maxFontSize: 22
      }
    case 'karaoke':
      return {
        maxLines: 2,
        widthRatio: 0.78,
        minWidth: 180,
        maxWidth: 340,
        fontScale: 0.054,
        minFontSize: 14,
        maxFontSize: 20
      }
    case 'beasty':
      return {
        maxLines: 3,
        widthRatio: 0.82,
        minWidth: 190,
        maxWidth: 360,
        fontScale: 0.053,
        minFontSize: 14,
        maxFontSize: 20
      }
    case 'youshaei':
    case 'pod-p':
      return {
        maxLines: 2,
        widthRatio: 0.8,
        minWidth: 185,
        maxWidth: 350,
        fontScale: 0.052,
        minFontSize: 14,
        maxFontSize: 19
      }
    default:
      return {
        maxLines: 2,
        widthRatio: 0.78,
        minWidth: 180,
        maxWidth: 340,
        fontScale: 0.052,
        minFontSize: 14,
        maxFontSize: 19
      }
  }
}

export function ClipEditorPage() {
  const navigate = useNavigate()
  const { id: episodeId, clipId } = useParams<{ id: string; clipId: string }>()
  const [clip, setClip] = useState<ClipRecord | null>(null)
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
  const [isDraggingCaption, setIsDraggingCaption] = useState(false)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const [previewFrameWidth, setPreviewFrameWidth] = useState(260)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const transcriptScrollerRef = useRef<HTMLDivElement>(null)
  const previewFrameRef = useRef<HTMLDivElement>(null)

  const previewAspectClass =
    framePreview?.aspectRatio === '1:1'
      ? 'aspect-square w-full max-w-[460px]'
      : framePreview?.aspectRatio === '16:9'
        ? 'aspect-video w-full max-w-[760px]'
        : 'aspect-[9/16] h-full max-h-[500px] w-full max-w-[300px]'

  const getPreviewCaptionText = (
    line: TranscriptLine | undefined,
    fallbackText: string,
    presetId?: string | null,
    playheadTime?: number,
    font = 'Inter'
  ) => {
    if (!line) return fallbackText
    if (presetId === 'none') return ''

    const layout = getCaptionLayoutConfig(presetId, previewFrameWidth)
    const words = line.words?.filter((word) => word.word?.trim())
    if (words && words.length > 0 && playheadTime !== undefined) {
      const fontSize = clamp(
        Math.round(previewFrameWidth * layout.fontScale),
        layout.minFontSize,
        layout.maxFontSize
      )
      const bubblePadding = 32
      const rawBubbleWidth = Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio)
      const maxBubbleWidth = layout.maxWidth
        ? Math.min(layout.maxWidth, rawBubbleWidth)
        : rawBubbleWidth
      const maxTextWidth = Math.max(110, maxBubbleWidth - bubblePadding)
      const relativeWordIndex = words.findIndex(
        (word) => playheadTime >= word.start && playheadTime <= word.end
      )
      const anchorIndex = relativeWordIndex >= 0 ? relativeWordIndex : 0
      const fittedWords: string[] = []

      for (let index = anchorIndex; index < words.length; index += 1) {
        const nextWord = words[index]?.word?.trim()
        if (!nextWord) continue
        const candidateText = [...fittedWords, nextWord]
          .join(' ')
          .replace(/\s+([,.!?;:])/g, '$1')
          .trim()
        const candidateWidth = measureTextWidth(candidateText, fontSize, font)
        const nextLineCount = Math.max(1, Math.ceil(candidateWidth / maxTextWidth))

        if (fittedWords.length > 0 && nextLineCount > layout.maxLines) {
          break
        }

        fittedWords.push(nextWord)
      }

      const phrase = fittedWords.join(' ').replace(/\s+([,.!?;:])/g, '$1').trim()

      if (phrase) return phrase
    }

    const fallbackWords = (line.text || fallbackText).split(/\s+/).filter(Boolean)
    return fallbackWords.slice(0, layout.maxLines === 1 ? 1 : 6).join(' ').trim()
  }

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

        const [rawClip, mediaSource, segments, brandTemplate] = await Promise.all([
          window.electronAPI?.getClip?.(clipId),
          window.electronAPI?.getEpisodeMediaSource?.(episodeId),
          window.electronAPI?.getClipTranscriptSegments?.(clipId).catch(() => []),
          window.electronAPI?.getBrandTemplate?.().catch(() => null)
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
        setMediaUrl(mediaSource?.mediaUrl ?? null)
        setEpisodeDuration(mediaSource?.duration ?? 0)
        setTranscriptLines(
          (segments || []).map((segment: any) => ({
            id: segment.id,
            start: Number(segment.start_time ?? segment.start ?? 0),
            end: Number(segment.end_time ?? segment.end ?? 0),
            text: segment.text || '',
            words: Array.isArray(segment.words)
              ? segment.words.map((word: any) => ({
                  word: word.word || '',
                  start: Number(word.start ?? 0),
                  end: Number(word.end ?? 0)
                }))
              : undefined
          }))
        )
        setCurrentTime(mappedClip.startTime)

        const template = brandTemplate as BrandTemplate | null
        const firstLine = (segments || [])[0]
        const activeCaptionText =
          getPreviewCaptionText(
            firstLine
              ? {
                  id: firstLine.id,
                  start: Number(firstLine.start_time ?? firstLine.start ?? 0),
                  end: Number(firstLine.end_time ?? firstLine.end ?? 0),
                  text: firstLine.text || '',
                  words: Array.isArray(firstLine.words)
                    ? firstLine.words.map((word: any) => ({
                        word: word.word || '',
                        start: Number(word.start ?? 0),
                        end: Number(word.end ?? 0)
                      }))
                    : undefined
                }
              : undefined,
            mappedClip.keyQuote,
            template?.caption.presetId,
            mappedClip.startTime,
            template?.caption.font || 'Inter'
          ) || mappedClip.keyQuote

        setCaptionPreview({
          presetId: template?.caption.presetId ?? null,
          text: activeCaptionText,
          font: template?.caption.font || 'Inter',
          position: (template?.caption.position || 'bottom') as PreviewCaptionState['position'],
          customX: template?.caption.customX ?? null,
          customY: template?.caption.customY ?? null
        })

        setLogoPreview({
          enabled: (template?.logo.enabled ?? false) || Boolean(template?.logo.assetPath),
          assetPath: template?.logo.assetPath || null,
          positionX: template?.logo.positionX ?? 85,
          positionY: template?.logo.positionY ?? 85,
          scale: template?.logo.scale ?? 0.15,
          opacity: template?.logo.opacity ?? 0.8
        })

        setFramePreview({
          aspectRatio: (template?.frame.aspectRatio || '9:16') as PreviewFrameState['aspectRatio'],
          cropMode: (template?.frame.cropMode || 'fit') as PreviewFrameState['cropMode']
        })

        setMusicEnabled(template?.music.enabled ?? false)
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
        text: getPreviewCaptionText(
          activeLine,
          currentCaption.text,
          currentCaption.presetId,
          currentTime,
          currentCaption.font
        )
      }
    })
  }, [currentTime, previewFrameWidth, transcriptLines])

  useEffect(() => {
    const previewFrame = previewFrameRef.current
    if (!previewFrame || typeof ResizeObserver === 'undefined') return

    const updateWidth = () => {
      setPreviewFrameWidth(previewFrame.clientWidth || 260)
    }

    updateWidth()

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(previewFrame)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const previewFrame = previewFrameRef.current
    if (!previewFrame || (!isDraggingCaption && !isDraggingLogo)) return

    const handleMouseMove = (event: MouseEvent) => {
      const rect = previewFrame.getBoundingClientRect()
      const x = clamp(((event.clientX - rect.left) / rect.width) * 100, 8, 92)
      const y = clamp(((event.clientY - rect.top) / rect.height) * 100, 8, 92)

      if (isDraggingCaption) {
        setCaptionPreview((current) =>
          current
            ? {
                ...current,
                position: 'custom',
                customX: x,
                customY: y
              }
            : current
        )
      }

      if (isDraggingLogo) {
        setLogoPreview((current) =>
          current
            ? {
                ...current,
                positionX: x,
                positionY: y
              }
            : current
        )
      }
    }

    const handleMouseUp = async () => {
      setIsDraggingCaption(false)
      setIsDraggingLogo(false)

      try {
        if (!clipId) return

        if (isDraggingCaption && captionPreview) {
          await window.electronAPI?.saveClipEdits?.(clipId, {
            caption_position: 'custom',
            caption_custom_x: captionPreview.customX,
            caption_custom_y: captionPreview.customY,
            caption_font: captionPreview.font
          })
        }

        if (isDraggingLogo && logoPreview) {
          await window.electronAPI?.saveClipEdits?.(clipId, {
            logo_enabled: logoPreview.enabled ? 1 : 0,
            logo_path: logoPreview.assetPath,
            logo_position_x: logoPreview.positionX,
            logo_position_y: logoPreview.positionY,
            logo_scale: logoPreview.scale,
            logo_opacity: logoPreview.opacity
          })
        }
      } catch (dragSaveError) {
        console.error('Failed to persist preview drag state:', dragSaveError)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [captionPreview, clipId, isDraggingCaption, isDraggingLogo, logoPreview])

  if (loading) {
    return (
      <div className="app-page">
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="text-lg text-text-primary">Loading clip editor…</div>
            <div className="text-sm text-text-muted">Preparing transcript and preview</div>
          </div>
        </div>
      </div>
    )
  }

  if (error || !clip || !episodeId) {
    return (
      <div className="app-page">
        <div className="flex h-full items-center justify-center">
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
      </div>
    )
  }

  return (
    <div className="app-page">
      <div className="workspace-shell clip-editor-shell mx-auto w-full max-w-[1480px]">
        <div className="app-page-header clip-editor-page-header">
          <div className="app-page-header-content">
            <h1 className="app-page-title">Clip Workspace</h1>
          </div>
          <div className="workspace-actions">
            <button
              type="button"
              onClick={() => navigate(`/review/${episodeId}`)}
              className="app-action-secondary clip-editor-header-action"
            >
              <IoArrowBack size={16} />
              Back to review
            </button>
            <button
              type="button"
              onClick={() => navigate(`/export/${episodeId}`)}
              className="app-action-primary clip-editor-header-action"
            >
              Export
            </button>
          </div>
        </div>

        <div className="workspace-grid clip-editor-grid">
          <section className="workspace-panel clip-editor-transcript-panel">
            <div className="workspace-panel-scroll">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="workspace-panel-title !mt-0">Transcript</h2>
                <label className="inline-flex items-center gap-3 text-sm text-text-secondary">
                  <input
                    type="checkbox"
                    checked={isTranscriptOnly}
                    onChange={(event) => setIsTranscriptOnly(event.target.checked)}
                    className="h-4 w-4 rounded border-white/12 bg-transparent"
                  />
                  Transcript only
                </label>
              </div>

              <div ref={transcriptScrollerRef} className="min-h-0 overflow-y-auto pr-2">
                <div className="space-y-5 text-[15px] leading-8 text-[#d8dbe2]">
                  {transcriptLines.map((line) => (
                    <div
                      key={line.id}
                      data-line-id={line.id}
                      className={`rounded-xl px-3 py-2 transition-colors ${
                        activeLineId === line.id ? 'bg-white/8 text-white' : ''
                      }`}
                    >
                      {line.text}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="clip-editor-preview-stage">
            <div className="clip-editor-preview-meta">
              <span className="clip-editor-preview-meta-item">
                <IoResizeOutline size={15} />
                {framePreview?.aspectRatio || '9:16'}
              </span>
              <span className="clip-editor-preview-meta-item">
                <IoExpandOutline size={15} />
                Layout: {framePreview?.cropMode === 'blur' ? 'Blur' : framePreview?.cropMode === 'center' ? 'Center' : 'Fit'}
              </span>
              <span className="clip-editor-preview-meta-item">
                <IoTextOutline size={15} />
                {captionPreview?.presetId || 'Default captions'}
              </span>
              <span className="clip-editor-preview-meta-item">
                {musicEnabled ? <IoMusicalNotesOutline size={15} /> : <IoFlashOffOutline size={15} />}
                {musicEnabled ? 'Music on' : 'Tracker: OFF'}
              </span>
            </div>

            <div className="clip-editor-preview-canvas">
              <div
                ref={previewFrameRef}
                className={`relative min-h-0 overflow-hidden rounded-[5px] bg-black ${previewAspectClass}`}
              >
                    {mediaUrl && framePreview?.cropMode === 'blur' ? (
                      <>
                        <video
                          src={mediaUrl}
                          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-75"
                          playsInline
                          muted
                          preload="metadata"
                        />
                        <div className="absolute inset-0 bg-black/18" />
                        <video
                          ref={videoRef}
                          src={mediaUrl}
                          className="relative z-10 h-full w-full object-contain"
                          playsInline
                          preload="metadata"
                        />
                      </>
                    ) : mediaUrl ? (
                      <video
                        ref={videoRef}
                        src={mediaUrl}
                        className={`h-full w-full ${
                          framePreview?.cropMode === 'fit' ? 'object-contain' : 'object-cover object-center'
                        }`}
                        playsInline
                        preload="metadata"
                      />
                    ) : null}
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
                          zIndex: 20,
                          cursor: isDraggingLogo ? 'grabbing' : 'grab'
                        }}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          setIsDraggingLogo(true)
                        }}
                      />
                    ) : null}
                    {captionPreview?.text ? (
                      (() => {
                        const layout = getCaptionLayoutConfig(captionPreview.presetId, previewFrameWidth)
                        const bubbleWidth = layout.maxWidth
                          ? Math.min(layout.maxWidth, Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio))
                          : Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio)
                        const fontSize = clamp(
                          Math.round(previewFrameWidth * layout.fontScale),
                          layout.minFontSize,
                          layout.maxFontSize
                        )

                        return (
                          <div
                            className={`absolute left-1/2 -translate-x-1/2 rounded-xl bg-white/90 px-4 py-2 text-center font-semibold text-black shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${
                              layout.maxLines === 1 ? 'whitespace-nowrap leading-[1.2]' : 'leading-[1.28]'
                            }`}
                            style={{
                              fontFamily: captionPreview.font,
                              fontSize: `${fontSize}px`,
                              width: `${bubbleWidth}px`,
                              maxWidth: `${bubbleWidth}px`,
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
                              zIndex: 25,
                              cursor: isDraggingCaption ? 'grabbing' : 'grab'
                            }}
                            onMouseDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setIsDraggingCaption(true)
                            }}
                          >
                            {captionPreview.text}
                          </div>
                        )
                      })()
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

        <footer className="workspace-panel shrink-0">
          <div className="workspace-panel-scroll !p-0">
            <div className="flex items-center justify-between border-b border-white/8 px-6 py-3">
              <div className="flex items-center gap-4 text-sm text-text-secondary">
                <button
                  type="button"
                  className="inline-flex items-center gap-2 hover:text-text-primary"
                >
                  <IoCheckmarkCircleOutline size={15} />
                  Timeline
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
          </div>
        </footer>
      </div>
    </div>
  )
}
