import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IoAddOutline,
  IoArrowBack,
  IoCheckmarkCircleOutline,
  IoExpandOutline,
  IoFilmOutline,
  IoFlashOffOutline,
  IoGridOutline,
  IoMusicalNotesOutline,
  IoPlay,
  IoPause,
  IoRemoveOutline,
  IoResizeOutline,
  IoScanOutline,
  IoTextOutline,
  IoVolumeHighOutline
} from 'react-icons/io5'
import type { BrandTemplate } from '@shared/types'

const clipCaptionPresets = [
  {
    id: 'none',
    label: 'none',
    text: '',
    font: 'Inter',
    fontWeight: '700' as const,
    textColor: '#5F5F5F',
    highlightColor: '#111111',
    backgroundColor: '#ffffff',
    backgroundEnabled: false,
    lineMode: 'one-line' as const
  },
  {
    id: 'karaoke',
    label: 'karaoke',
    text: 'TO GET STARTED',
    font: 'Inter',
    fontWeight: '800' as const,
    textColor: '#B3B3B3',
    highlightColor: '#ffffff',
    backgroundColor: '#111111',
    backgroundEnabled: true,
    lineMode: 'three-lines' as const
  },
  {
    id: 'beasty',
    label: 'beasty',
    text: 'Build clips that hook fast',
    font: 'Inter',
    fontWeight: '800' as const,
    textColor: '#5F5F5F',
    highlightColor: '#111111',
    backgroundColor: '#ffffff',
    backgroundEnabled: true,
    lineMode: 'three-lines' as const
  },
  {
    id: 'deep-diver',
    label: 'deep-diver',
    text: 'One Line',
    font: 'Inter',
    fontWeight: '700' as const,
    textColor: '#5F5F5F',
    highlightColor: '#111111',
    backgroundColor: '#ffffff',
    backgroundEnabled: true,
    lineMode: 'one-line' as const
  },
  {
    id: 'youshaei',
    label: 'youshaei',
    text: 'TO GET STARTED',
    font: 'Inter',
    fontWeight: '700' as const,
    textColor: '#B3B3B3',
    highlightColor: '#59f0c2',
    backgroundColor: '#111111',
    backgroundEnabled: true,
    lineMode: 'three-lines' as const
  },
  {
    id: 'pod-p',
    label: 'pod-p',
    text: 'TO GET',
    font: 'Inter',
    fontWeight: '800' as const,
    textColor: '#B3B3B3',
    highlightColor: '#ff4fe1',
    backgroundColor: '#111111',
    backgroundEnabled: true,
    lineMode: 'one-line' as const
  }
] as const

const aspectRatioCycle: Array<'9:16' | '1:1' | '16:9'> = ['9:16', '1:1', '16:9']
const cropModeCycle: Array<'fit' | 'center' | 'blur'> = ['fit', 'center', 'blur']
const SAFE_AREA_PERCENT = 6
const CENTER_SNAP_THRESHOLD_PERCENT = 2.5

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
  fontSize: number
  fontWeight: '500' | '600' | '700' | '800'
  italic: boolean
  underline: boolean
  uppercase: boolean
  position: 'top' | 'center' | 'bottom' | 'custom'
  lineMode: 'one-line' | 'three-lines'
  backgroundEnabled: boolean
  textColor: string
  highlightColor: string
  backgroundColor: string
  backgroundPaddingX: number
  backgroundPaddingY: number
  backgroundRadius: number
  strokeColor: string
  strokeWidth: number
  shadowEnabled: boolean
  shadowColor: string
  shadowOffsetX: number
  shadowOffsetY: number
  shadowBlur: number
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

type CaptionCue = {
  id: string
  lineId: string
  start: number
  end: number
  text: string
  words: Array<{
    word: string
    start: number
    end: number
  }>
}

type CaptionCueBuildOptions = {
  maxWordsPerCue?: number
  maxTextWidth?: number
  fontSize?: number
  fontFamily?: string
  fontWeight?: number | string
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)
const getFontFamilyValue = (fontFamily: string) => `"${fontFamily}", "Hedvig Letters Sans", system-ui, sans-serif`
const isLegacyDefaultLogoPosition = (x: unknown, y: unknown) =>
  Number(x) === 85 && Number(y) === 85

const normalizeCaptionText = (text: string) => text.replace(/\s+([,.!?;:])/g, '$1').trim()

const getTimedClipCaptionWordState = (cue: CaptionCue | null, currentTime: number) => {
  if (!cue) return { words: [] as string[], activeIndex: -1 }
  const cueWords = cue.words.filter((word) => word.word?.trim())
  if (cueWords.length === 0) {
    const fallbackWords = cue.text.split(' ').filter(Boolean)
    return {
      words: fallbackWords,
      activeIndex: fallbackWords.length > 0 ? 0 : -1
    }
  }

  const activeIndex = cueWords.findIndex((word) => currentTime >= word.start && currentTime <= word.end)
  const safeIndex =
    activeIndex >= 0
      ? activeIndex
      : currentTime < cueWords[0].start
        ? 0
        : cueWords.length - 1

  return {
    words: cueWords.map((word) => word.word),
    activeIndex: safeIndex
  }
}

const isUpdatedAfter = (candidate?: string | null, baseline?: string | null) => {
  const candidateTime = candidate ? Date.parse(candidate) : Number.NaN
  const baselineTime = baseline ? Date.parse(baseline) : Number.NaN

  if (Number.isNaN(candidateTime)) return false
  if (Number.isNaN(baselineTime)) return true

  return candidateTime > baselineTime
}

const splitCaptionWords = (
  words: string[],
  maxWordsPerCue: number,
  maxTextWidth?: number,
  fontSize = 16,
  fontFamily = 'Inter',
  fontWeight: number | string = 700
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
    const fitsWidth = measureTextWidth(candidateText, fontSize, fontFamily, Number(fontWeight)) <= maxTextWidth

    if (
      currentChunk.length > 0 &&
      (candidateChunk.length > maxWordsPerCue || !fitsWidth)
    ) {
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

const buildCaptionCues = (lines: TranscriptLine[], options: CaptionCueBuildOptions = {}): CaptionCue[] => {
  const {
    maxWordsPerCue = 3,
    maxTextWidth,
    fontSize = 16,
    fontFamily = 'Inter',
    fontWeight = 700
  } = options
  const cues: CaptionCue[] = []

  lines.forEach((line) => {
    const timedWords = (line.words || []).filter(
      (word) =>
        word.word?.trim() &&
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start
    )

    if (timedWords.length > 0) {
      const timedChunks = splitCaptionWords(
        timedWords.map((word) => word.word),
        maxWordsPerCue,
        maxTextWidth,
        fontSize,
        fontFamily,
        fontWeight
      )
      let timedWordIndex = 0

      timedChunks.forEach((chunk, chunkIndex) => {
        if (!chunk.length) return
        const timedChunk = timedWords.slice(timedWordIndex, timedWordIndex + chunk.length)
        timedWordIndex += chunk.length
        cues.push({
          id: `${line.id}-cue-${chunkIndex}`,
          lineId: line.id,
          start: timedChunk[0].start,
          end: timedChunk[timedChunk.length - 1].end,
          text: normalizeCaptionText(chunk.join(' ')),
          words: timedChunk.map((word) => ({
            word: word.word,
            start: word.start,
            end: word.end
          }))
        })
      })
      return
    }

    const fallbackWords = line.text.split(/\s+/).filter(Boolean)
    if (!fallbackWords.length) return

    const totalDuration = Math.max(line.end - line.start, 0.01)
    const fallbackChunks = splitCaptionWords(
      fallbackWords,
      maxWordsPerCue,
      maxTextWidth,
      fontSize,
      fontFamily,
      fontWeight
    )
    const chunkCount = Math.max(fallbackChunks.length, 1)
    const chunkDuration = totalDuration / chunkCount

    fallbackChunks.forEach((chunk, chunkIndex) => {
      const start = line.start + chunkIndex * chunkDuration
      const end =
        chunkIndex === chunkCount - 1
          ? line.end
          : Math.min(line.end, start + chunkDuration)

      cues.push({
        id: `${line.id}-cue-${chunkIndex}`,
        lineId: line.id,
        start,
        end,
        text: normalizeCaptionText(chunk.join(' ')),
        words: chunk.map((word, wordIndex) => {
          const wordDuration = chunkDuration / Math.max(chunk.length, 1)
          const wordStart = start + wordIndex * wordDuration
          const wordEnd = chunkIndex === chunkCount - 1 && wordIndex === chunk.length - 1
            ? end
            : Math.min(end, wordStart + wordDuration)

          return {
            word,
            start: wordStart,
            end: wordEnd
          }
        })
      })
    })
  })

  return cues
}

const measureTextWidth = (
  text: string,
  fontSize: number,
  fontFamily: string,
  fontWeight = 600
) => {
  if (typeof document === 'undefined') return text.length * fontSize * 0.56
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return text.length * fontSize * 0.56
  context.font = `${fontWeight} ${fontSize}px ${getFontFamilyValue(fontFamily)}`
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
  const [transcriptLines, setTranscriptLines] = useState<TranscriptLine[]>([])
  const [isTranscriptOnly, setIsTranscriptOnly] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [captionPreview, setCaptionPreview] = useState<PreviewCaptionState | null>(null)
  const [logoPreview, setLogoPreview] = useState<PreviewLogoState | null>(null)
  const [framePreview, setFramePreview] = useState<PreviewFrameState | null>(null)
  const [musicEnabled, setMusicEnabled] = useState(false)
  const [musicAssetPath, setMusicAssetPath] = useState<string | null>(null)
  const [musicVolume, setMusicVolume] = useState(0.3)
  const [trackerEnabled, setTrackerEnabled] = useState(true)
  const [isDraggingCaption, setIsDraggingCaption] = useState(false)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const [isCaptionSelected, setIsCaptionSelected] = useState(false)
  const [isLogoSelected, setIsLogoSelected] = useState(false)
  const [dragGuides, setDragGuides] = useState({ horizontal: false, vertical: false })
  const [previewFrameWidth, setPreviewFrameWidth] = useState(260)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSavingClip, setIsSavingClip] = useState(false)
  const [saveClipFeedback, setSaveClipFeedback] = useState<'idle' | 'saved'>('idle')
  const [timelineZoom, setTimelineZoom] = useState(1.15)
  const [timelineWaveform, setTimelineWaveform] = useState<number[]>([])
  const [timelineThumbnails, setTimelineThumbnails] = useState<Record<string, string>>({})

  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const transcriptScrollerRef = useRef<HTMLDivElement>(null)
  const previewFrameRef = useRef<HTMLDivElement>(null)
  const saveFeedbackTimeoutRef = useRef<number | null>(null)
  const playbackFrameRef = useRef<number | null>(null)

  const previewAspectClass =
    framePreview?.aspectRatio === '1:1'
      ? 'aspect-square w-full max-w-[460px]'
      : framePreview?.aspectRatio === '16:9'
        ? 'aspect-video w-full max-w-[760px]'
        : 'aspect-[9/16] h-full max-h-[500px] w-full max-w-[300px]'

  const captionCueBuildOptions = useMemo<CaptionCueBuildOptions>(() => {
    const presetId = captionPreview?.presetId ?? null
    const layout = getCaptionLayoutConfig(presetId, previewFrameWidth)
    const lineMode = captionPreview?.lineMode || 'one-line'
    const maxLines = lineMode === 'three-lines' ? 3 : 1
    const rawBubbleWidth = Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio)
    const maxBubbleWidth = layout.maxWidth ? Math.min(layout.maxWidth, rawBubbleWidth) : rawBubbleWidth
    const fontSize = clamp(captionPreview?.fontSize ?? 30, 12, 72)
    const paddingX = Math.max(0, captionPreview?.backgroundPaddingX ?? 24)
    const maxTextWidth = Math.max(96, Math.min(maxBubbleWidth, previewFrameWidth - 24) - paddingX * 2)

    return {
      maxWordsPerCue: 3,
      maxTextWidth: maxLines === 1 ? maxTextWidth : undefined,
      fontSize,
      fontFamily: captionPreview?.font || 'Inter',
      fontWeight: Number(captionPreview?.fontWeight ?? 700)
    }
  }, [captionPreview, previewFrameWidth])

  const captionCues = useMemo(
    () => buildCaptionCues(transcriptLines, captionCueBuildOptions),
    [captionCueBuildOptions, transcriptLines]
  )

  const activeCaptionCue = useMemo(() => {
    return (
      captionCues.find((cue) => currentTime >= cue.start && currentTime <= cue.end) ||
      captionCues.find((cue) => cue.start >= currentTime) ||
      captionCues[captionCues.length - 1] ||
      null
    )
  }, [captionCues, currentTime])

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

        const [rawClip, mediaSource, segments, brandTemplate, clipEdits] = await Promise.all([
          window.electronAPI?.getClip?.(clipId),
          window.electronAPI?.getEpisodeMediaSource?.(episodeId),
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

        const template = brandTemplate as BrandTemplate | null
        const savedEdits = clipEdits as Record<string, any> | null
        const mappedSegments: TranscriptLine[] = (segments || []).map((segment: any) => ({
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
        const initialLayout = getCaptionLayoutConfig(template?.caption.presetId ?? null, 260)
        const initialFontSize = clamp(
          Math.round(Number(template?.caption.fontSize ?? 30) * (260 / 300)),
          initialLayout.minFontSize,
          initialLayout.maxFontSize
        )
        const initialPaddingX = Math.round(Number(template?.caption.backgroundPaddingX ?? 24) * (260 / 300))
        const initialBubbleWidth = initialLayout.maxWidth
          ? Math.min(initialLayout.maxWidth, Math.max(initialLayout.minWidth, 260 * initialLayout.widthRatio))
          : Math.max(initialLayout.minWidth, 260 * initialLayout.widthRatio)
        const initialCaptionCues = buildCaptionCues(mappedSegments, {
          maxWordsPerCue: 3,
          maxTextWidth:
            (template?.caption.lineMode || 'one-line') === 'one-line'
              ? Math.max(96, Math.min(initialBubbleWidth, 236) - initialPaddingX * 2)
              : undefined,
          fontSize: initialFontSize,
          fontFamily: template?.caption.font || 'Inter',
          fontWeight: Number(template?.caption.fontWeight ?? 700)
        })

        setClip(mappedClip)
        setMediaUrl(mediaSource?.mediaUrl ?? null)
        setTranscriptLines(mappedSegments)
        setCurrentTime(mappedClip.startTime)
        const activeCaptionText =
          initialCaptionCues.find((cue) => mappedClip.startTime >= cue.start && mappedClip.startTime <= cue.end)?.text ||
          initialCaptionCues[0]?.text ||
          mappedClip.keyQuote
        const clipOverridesCurrent = isUpdatedAfter(savedEdits?.updated_at, template?.updatedAt)
        const useCaptionPositionOverride =
          clipOverridesCurrent && savedEdits?.caption_position === 'custom'
        const useLogoPositionOverride =
          clipOverridesCurrent &&
          savedEdits?.logo_position_x != null &&
          savedEdits?.logo_position_y != null &&
          !isLegacyDefaultLogoPosition(savedEdits?.logo_position_x, savedEdits?.logo_position_y)
        const useFrameOverride =
          clipOverridesCurrent &&
          (savedEdits?.aspect_ratio != null || savedEdits?.crop_mode != null)

        setCaptionPreview({
          presetId: template?.caption.presetId ?? null,
          text: activeCaptionText,
          font: template?.caption.font || 'Inter',
          fontSize: Number(template?.caption.fontSize ?? 30),
          fontWeight: String(template?.caption.fontWeight ?? '700') as PreviewCaptionState['fontWeight'],
          italic: template?.caption.italic ?? false,
          underline: template?.caption.underline ?? false,
          uppercase: template?.caption.uppercase ?? false,
          position: (
            useCaptionPositionOverride
              ? savedEdits?.caption_position
              : template?.caption.position || 'bottom'
          ) as PreviewCaptionState['position'],
          lineMode: template?.caption.lineMode || 'one-line',
          backgroundEnabled: template?.caption.backgroundEnabled ?? true,
          textColor: template?.caption.textColor || '#5F5F5F',
          highlightColor: template?.caption.highlightColor || '#111111',
          backgroundColor: template?.caption.backgroundColor || '#ffffff',
          backgroundPaddingX: template?.caption.backgroundPaddingX ?? 24,
          backgroundPaddingY: template?.caption.backgroundPaddingY ?? 12,
          backgroundRadius: template?.caption.backgroundRadius ?? 16,
          strokeColor: template?.caption.strokeColor || '#000000',
          strokeWidth: Number(template?.caption.strokeWidth ?? 0),
          shadowEnabled: template?.caption.shadowEnabled ?? false,
          shadowColor: template?.caption.shadowColor || '#000000',
          shadowOffsetX: template?.caption.shadowOffsetX ?? 0,
          shadowOffsetY: template?.caption.shadowOffsetY ?? 0,
          shadowBlur: template?.caption.shadowBlur ?? 0,
          customX: useCaptionPositionOverride ? (savedEdits?.caption_custom_x ?? null) : (template?.caption.customX ?? null),
          customY: useCaptionPositionOverride ? (savedEdits?.caption_custom_y ?? null) : (template?.caption.customY ?? null)
        })

        setLogoPreview({
          enabled: (template?.logo.enabled ?? false) || Boolean(template?.logo.assetPath),
          assetPath: template?.logo.assetPath || null,
          positionX: Number(useLogoPositionOverride ? savedEdits?.logo_position_x : (template?.logo.positionX ?? 85)),
          positionY: Number(useLogoPositionOverride ? savedEdits?.logo_position_y : (template?.logo.positionY ?? 85)),
          scale: Number(template?.logo.scale ?? 0.15),
          opacity: Number(template?.logo.opacity ?? 0.8)
        })

        setFramePreview({
          aspectRatio: (
            (useFrameOverride ? savedEdits?.aspect_ratio : null) ||
            template?.frame.aspectRatio ||
            '9:16'
          ) as PreviewFrameState['aspectRatio'],
          cropMode: (
            (useFrameOverride ? savedEdits?.crop_mode : null) ||
            template?.frame.cropMode ||
            'fit'
          ) as PreviewFrameState['cropMode']
        })

        setMusicEnabled(template?.music.enabled ?? false)
        setMusicAssetPath(template?.music.assetPath || null)
        setMusicVolume(Number(template?.music.volume ?? 0.3))
      } catch (loadError) {
        console.error('Failed to load clip editor:', loadError)
        setError('Failed to load clip editor')
      } finally {
        setLoading(false)
      }
    }

    void loadEditor()
  }, [clipId, episodeId])

  const syncAudioToVideo = (videoTime: number, forceSeek = false) => {
    const audio = audioRef.current
    if (!audio || !musicEnabled || !musicAssetPath || !clip) return

    const expectedAudioTime = Math.max(videoTime - clip.startTime, 0)
    if (forceSeek || Math.abs(audio.currentTime - expectedAudioTime) > 0.2) {
      audio.currentTime = expectedAudioTime
    }
  }

  const stopPlayback = (resetToStart = false) => {
    const video = videoRef.current
    const audio = audioRef.current

    if (playbackFrameRef.current != null) {
      window.cancelAnimationFrame(playbackFrameRef.current)
      playbackFrameRef.current = null
    }

    video?.pause()
    audio?.pause()

    if (resetToStart && clip && video) {
      video.currentTime = clip.startTime
      syncAudioToVideo(clip.startTime, true)
      if (audio) {
        audio.currentTime = 0
      }
      setCurrentTime(clip.startTime)
    }

    setIsPlaying(false)
  }

  const handleVideoLoadedMetadata = () => {
    const video = videoRef.current
    if (!video || !clip) return
    video.currentTime = clip.startTime
    syncAudioToVideo(clip.startTime, true)
    setCurrentTime(clip.startTime)
  }

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current
    if (!video || !clip) return

    const nextTime = video.currentTime
    if (nextTime >= clip.endTime) {
      stopPlayback(true)
      return
    }

    setCurrentTime(nextTime)
    syncAudioToVideo(nextTime)
  }

  const handleVideoPlay = () => {
    if (playbackFrameRef.current != null) {
      window.cancelAnimationFrame(playbackFrameRef.current)
    }

    setIsPlaying(true)
    const tick = () => {
      const video = videoRef.current
      if (!video || !clip) {
        playbackFrameRef.current = null
        return
      }

      if (video.paused || video.ended) {
        playbackFrameRef.current = null
        return
      }

      if (video.currentTime >= clip.endTime) {
        stopPlayback(true)
        return
      }

      setCurrentTime(video.currentTime)
      syncAudioToVideo(video.currentTime)
      playbackFrameRef.current = window.requestAnimationFrame(tick)
    }

    playbackFrameRef.current = window.requestAnimationFrame(tick)
  }

  const handleVideoPause = () => {
    if (playbackFrameRef.current != null) {
      window.cancelAnimationFrame(playbackFrameRef.current)
      playbackFrameRef.current = null
    }
    const audio = audioRef.current
    audio?.pause()
    setIsPlaying(false)
  }

  useEffect(() => {
    return () => {
      if (playbackFrameRef.current != null) {
        window.cancelAnimationFrame(playbackFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!episodeId || !clip) {
      setTimelineWaveform([])
      return
    }

    let cancelled = false
    const buildWaveform = async () => {
      try {
        const response = await window.electronAPI?.getClipWaveform?.(
          episodeId,
          clip.startTime,
          clip.duration,
          180
        )
        if (!cancelled) {
          setTimelineWaveform(response?.peaks ?? [])
        }
      } catch (waveformError) {
        console.error('Failed to generate timeline waveform:', waveformError)
        if (!cancelled) {
          setTimelineWaveform([])
        }
      }
    }

    void buildWaveform()

    return () => {
      cancelled = true
    }
  }, [clip, episodeId])

  useEffect(() => {
    if (!mediaUrl || !clip || transcriptLines.length === 0) {
      setTimelineThumbnails({})
      return
    }

    let cancelled = false

    const captureFrame = async (video: HTMLVideoElement, time: number) => {
      await new Promise<void>((resolve, reject) => {
        const handleSeeked = () => {
          cleanup()
          resolve()
        }
        const handleError = () => {
          cleanup()
          reject(new Error('Timeline thumbnail seek failed'))
        }
        const cleanup = () => {
          video.removeEventListener('seeked', handleSeeked)
          video.removeEventListener('error', handleError)
        }

        video.addEventListener('seeked', handleSeeked, { once: true })
        video.addEventListener('error', handleError, { once: true })
        video.currentTime = time
      })
    }

    const buildThumbnails = async () => {
      const captureVideo = document.createElement('video')
      captureVideo.src = mediaUrl
      captureVideo.muted = true
      captureVideo.playsInline = true
      captureVideo.preload = 'auto'

      try {
        await new Promise<void>((resolve, reject) => {
          const handleLoaded = () => {
            cleanup()
            resolve()
          }
          const handleError = () => {
            cleanup()
            reject(new Error('Timeline thumbnail load failed'))
          }
          const cleanup = () => {
            captureVideo.removeEventListener('loadedmetadata', handleLoaded)
            captureVideo.removeEventListener('error', handleError)
          }

          captureVideo.addEventListener('loadedmetadata', handleLoaded, { once: true })
          captureVideo.addEventListener('error', handleError, { once: true })
        })

        const canvas = document.createElement('canvas')
        canvas.width = 220
        canvas.height = 124
        const context = canvas.getContext('2d')
        if (!context) return

        const entries = await Promise.all(
          transcriptLines.map(async (line) => {
            const sampleTime = clamp(line.start + 0.08, clip.startTime, Math.max(clip.startTime, line.end - 0.05))
            try {
              await captureFrame(captureVideo, sampleTime)
              context.clearRect(0, 0, canvas.width, canvas.height)
              context.drawImage(captureVideo, 0, 0, canvas.width, canvas.height)
              return [line.id, canvas.toDataURL('image/jpeg', 0.72)] as const
            } catch {
              return [line.id, ''] as const
            }
          })
        )

        if (!cancelled) {
          setTimelineThumbnails(
            Object.fromEntries(entries.filter((entry) => entry[1]))
          )
        }
      } catch (thumbnailError) {
        console.error('Failed to generate timeline thumbnails:', thumbnailError)
        if (!cancelled) {
          setTimelineThumbnails({})
        }
      }
    }

    void buildThumbnails()

    return () => {
      cancelled = true
    }
  }, [clip, mediaUrl, transcriptLines])

  const activeLineId = useMemo(() => {
    return (
      activeCaptionCue?.lineId ||
      transcriptLines.find((line) => currentTime >= line.start && currentTime <= line.end)?.id ||
      null
    )
  }, [activeCaptionCue, currentTime, transcriptLines])

  useEffect(() => {
    if (!activeLineId || !transcriptScrollerRef.current) return

    const activeNode = transcriptScrollerRef.current.querySelector<HTMLElement>(`[data-line-id="${activeLineId}"]`)
    activeNode?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeLineId])

  const togglePlayback = () => {
    const video = videoRef.current
    if (!video || !clip) return
    const audio = audioRef.current

    if (!video.paused && !video.ended) {
      stopPlayback(false)
      return
    }

    if (video.currentTime < clip.startTime || video.currentTime >= clip.endTime) {
      video.currentTime = clip.startTime
      setCurrentTime(clip.startTime)
    }

    if (audio && musicEnabled && musicAssetPath) {
      syncAudioToVideo(video.currentTime, true)
      audio.volume = musicVolume
      void audio.play().catch(() => {
        // ignore audio playback failures; clip playback should still work
      })
    }

    void video.play()
  }

  const seekWithinClip = (nextTime: number) => {
    const video = videoRef.current
    if (!video || !clip) return
    const audio = audioRef.current

    const clampedTime = Math.min(Math.max(nextTime, clip.startTime), clip.endTime)
    video.currentTime = clampedTime
    setCurrentTime(clampedTime)
    if (audio && musicEnabled && musicAssetPath) {
      syncAudioToVideo(clampedTime, true)
    }
  }

  const seekFromTimeline = (clientX: number, rect: DOMRect) => {
    if (!clip || rect.width <= 0) return
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    seekWithinClip(clip.startTime + ratio * clip.duration)
  }

  const timelineProgress = useMemo(() => {
    if (!clip || clip.duration <= 0) return 0
    return ((currentTime - clip.startTime) / clip.duration) * 100
  }, [clip, currentTime])

  const clipRelativeTime = useMemo(() => {
    if (!clip) return 0
    return Math.min(Math.max(currentTime - clip.startTime, 0), clip.duration)
  }, [clip, currentTime])

  const timelineWidth = useMemo(() => {
    if (!clip) return 960
    return Math.round(clamp(clip.duration * 42 * timelineZoom, 900, 2800))
  }, [clip, timelineZoom])

  const timelineRulerMarks = useMemo(() => {
    if (!clip || clip.duration <= 0) return []
    const totalSeconds = Math.max(1, Math.ceil(clip.duration))
    const marks: Array<{ second: number; left: number; major: boolean }> = []

    for (let second = 0; second <= totalSeconds; second += 1) {
      marks.push({
        second,
        left: (second / clip.duration) * timelineWidth,
        major: second % 5 === 0
      })
    }

    return marks
  }, [clip, timelineWidth])

  const waveformBars = useMemo(() => {
    if (!timelineWaveform.length) return []

    return timelineWaveform.map((value, index) => {
      const progress = index / Math.max(timelineWaveform.length - 1, 1)
      return {
        id: `wave-${index}`,
        left: progress * timelineWidth,
        height: 10 + value * 34
      }
    })
  }, [timelineWaveform, timelineWidth])

  const persistFrameEdits = async (nextFrame: PreviewFrameState) => {
    if (!clipId) return
    await window.electronAPI?.saveClipEdits?.(clipId, {
      aspect_ratio: nextFrame.aspectRatio,
      crop_mode: nextFrame.cropMode
    })
  }

  const cycleAspectRatio = async () => {
    if (!framePreview) return
    const currentIndex = aspectRatioCycle.indexOf(framePreview.aspectRatio)
    const nextAspectRatio = aspectRatioCycle[(currentIndex + 1) % aspectRatioCycle.length]
    const nextFrame = { ...framePreview, aspectRatio: nextAspectRatio }
    setFramePreview(nextFrame)
    await persistFrameEdits(nextFrame)
  }

  const cycleCropMode = async () => {
    if (!framePreview) return
    const currentIndex = cropModeCycle.indexOf(framePreview.cropMode)
    const nextCropMode = cropModeCycle[(currentIndex + 1) % cropModeCycle.length]
    const nextFrame = { ...framePreview, cropMode: nextCropMode }
    setFramePreview(nextFrame)
    await persistFrameEdits(nextFrame)
  }

  const cycleCaptionPreset = () => {
    setCaptionPreview((current) => {
      if (!current) return current
      const currentIndex = clipCaptionPresets.findIndex((preset) => preset.id === current.presetId)
      const nextPreset = clipCaptionPresets[(currentIndex + 1 + clipCaptionPresets.length) % clipCaptionPresets.length]
      return {
        ...current,
        presetId: nextPreset.id,
        font: nextPreset.font,
        fontWeight: nextPreset.fontWeight,
        textColor: nextPreset.textColor,
        highlightColor: nextPreset.highlightColor,
        backgroundColor: nextPreset.backgroundColor,
        backgroundEnabled: nextPreset.backgroundEnabled,
        lineMode: nextPreset.lineMode,
        text: nextPreset.id === 'none' ? '' : current.text || nextPreset.text
      }
    })
  }

  const handleSaveClipEdits = async () => {
    if (!clipId || !captionPreview || !framePreview) return

    setIsSavingClip(true)
    setSaveClipFeedback('idle')

    try {
      const clipEditPayload: Record<string, unknown> = {
        aspect_ratio: framePreview.aspectRatio,
        crop_mode: framePreview.cropMode
      }

      if (captionPreview.position === 'custom') {
        clipEditPayload.caption_position = 'custom'
        clipEditPayload.caption_custom_x = captionPreview.customX
        clipEditPayload.caption_custom_y = captionPreview.customY
      }

      await window.electronAPI?.saveClipEdits?.(clipId, {
        ...clipEditPayload
      })

      if (saveFeedbackTimeoutRef.current) {
        window.clearTimeout(saveFeedbackTimeoutRef.current)
      }
      setSaveClipFeedback('saved')
      saveFeedbackTimeoutRef.current = window.setTimeout(() => {
        setSaveClipFeedback('idle')
      }, 1600)
    } catch (saveError) {
      console.error('Failed to save clip edits:', saveError)
    } finally {
      setIsSavingClip(false)
    }
  }

  useEffect(() => {
    if (!captionCues.length) return

    setCaptionPreview((currentCaption) => {
      if (!currentCaption) return currentCaption
      const nextText =
        currentCaption.presetId === 'none'
          ? ''
          : activeCaptionCue?.text || captionCues[0]?.text || currentCaption.text

      if (nextText === currentCaption.text) {
        return currentCaption
      }

      return {
        ...currentCaption,
        text: nextText
      }
    })
  }, [activeCaptionCue, captionCues])

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

    const getSnappedPosition = (rawX: number, rawY: number) => {
      const vertical = Math.abs(rawX - 50) <= CENTER_SNAP_THRESHOLD_PERCENT
      const horizontal = Math.abs(rawY - 50) <= CENTER_SNAP_THRESHOLD_PERCENT

      setDragGuides({ horizontal, vertical })

      return {
        x: clamp(vertical ? 50 : rawX, SAFE_AREA_PERCENT, 100 - SAFE_AREA_PERCENT),
        y: clamp(horizontal ? 50 : rawY, SAFE_AREA_PERCENT, 100 - SAFE_AREA_PERCENT)
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      const rect = previewFrame.getBoundingClientRect()
      const rawX = ((event.clientX - rect.left) / rect.width) * 100
      const rawY = ((event.clientY - rect.top) / rect.height) * 100
      const nextPosition = getSnappedPosition(rawX, rawY)

      if (isDraggingCaption) {
        setCaptionPreview((current) =>
          current
            ? {
                ...current,
                position: 'custom',
                customX: nextPosition.x,
                customY: nextPosition.y
              }
            : current
        )
      }

      if (isDraggingLogo) {
        setLogoPreview((current) =>
          current
            ? {
                ...current,
                positionX: nextPosition.x,
                positionY: nextPosition.y
              }
            : current
        )
      }
    }

    const handleMouseUp = async () => {
      setIsDraggingCaption(false)
      setIsDraggingLogo(false)
      setDragGuides({ horizontal: false, vertical: false })

      try {
        if (!clipId) return

        if (isDraggingCaption && captionPreview) {
          await window.electronAPI?.saveClipEdits?.(clipId, {
            caption_position: 'custom',
            caption_custom_x: captionPreview.customX,
            caption_custom_y: captionPreview.customY
          })
        }

        if (isDraggingLogo && logoPreview) {
          await window.electronAPI?.saveClipEdits?.(clipId, {
            logo_position_x: logoPreview.positionX,
            logo_position_y: logoPreview.positionY
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

  useEffect(() => {
    return () => {
      if (saveFeedbackTimeoutRef.current) {
        window.clearTimeout(saveFeedbackTimeoutRef.current)
      }
    }
  }, [])

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
              className="clip-editor-error-button"
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
          <div className="app-page-header-shell">
            <div className="app-page-header-content">
              <h1 className="app-page-title">Clip Workspace</h1>
            </div>
            <div className="app-page-header-actions clip-editor-header-actions">
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
                onClick={() => void handleSaveClipEdits()}
                disabled={isSavingClip}
                className="app-action-secondary clip-editor-header-action"
              >
                <IoCheckmarkCircleOutline size={16} />
                {isSavingClip ? 'Saving...' : saveClipFeedback === 'saved' ? 'Saved' : 'Save clip'}
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
        </div>

        <div className="workspace-grid clip-editor-grid">
          <section className="workspace-panel clip-editor-transcript-panel">
            <div className="workspace-panel-scroll">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h2 className="workspace-panel-title !mt-0">Transcript</h2>
                <label className="clip-editor-transcript-toggle">
                  <input
                    type="checkbox"
                    checked={isTranscriptOnly}
                    onChange={(event) => setIsTranscriptOnly(event.target.checked)}
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
                      className={`clip-editor-transcript-line ${
                        activeLineId === line.id ? 'is-active' : ''
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
              <button
                type="button"
                className="clip-editor-preview-meta-item clip-editor-preview-control"
                onClick={() => void cycleAspectRatio()}
              >
                <IoResizeOutline size={15} />
                {framePreview?.aspectRatio || '9:16'}
              </button>
              <button
                type="button"
                className="clip-editor-preview-meta-item clip-editor-preview-control"
                onClick={() => void cycleCropMode()}
              >
                {framePreview?.cropMode === 'blur' ? <IoGridOutline size={15} /> : framePreview?.cropMode === 'center' ? <IoScanOutline size={15} /> : <IoExpandOutline size={15} />}
                Layout: {framePreview?.cropMode === 'blur' ? 'Blur' : framePreview?.cropMode === 'center' ? 'Center' : 'Fit'}
              </button>
              <button
                type="button"
                className="clip-editor-preview-meta-item clip-editor-preview-control"
                onClick={cycleCaptionPreset}
              >
                <IoTextOutline size={15} />
                {captionPreview?.presetId || 'Default captions'}
              </button>
              <button
                type="button"
                className="clip-editor-preview-meta-item clip-editor-preview-control"
                onClick={() => setTrackerEnabled((current) => !current)}
              >
                <IoFlashOffOutline size={15} />
                Tracker: {trackerEnabled ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="clip-editor-preview-canvas">
              <div
                ref={previewFrameRef}
                className={`clip-editor-preview-frame relative min-h-0 overflow-hidden ${previewAspectClass}`}
                onMouseDown={() => {
                  setIsCaptionSelected(false)
                  setIsLogoSelected(false)
                }}
              >
                    <div
                      className={`brand-template-preview-safe-area ${
                        isDraggingCaption || isDraggingLogo ? 'is-active' : ''
                      }`}
                      style={{ inset: `${SAFE_AREA_PERCENT}%` }}
                    />
                    {dragGuides.vertical ? <div className="brand-template-preview-guide is-vertical" /> : null}
                    {dragGuides.horizontal ? <div className="brand-template-preview-guide is-horizontal" /> : null}
                    {mediaUrl && framePreview?.cropMode === 'blur' ? (
                      <>
                        <video
                          src={mediaUrl}
                          className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl opacity-75"
                          playsInline
                          muted
                          preload="metadata"
                        />
                        <div className="clip-editor-preview-dim" />
                        <video
                          ref={videoRef}
                          src={mediaUrl}
                          className="relative z-10 h-full w-full object-contain"
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={handleVideoLoadedMetadata}
                          onTimeUpdate={handleVideoTimeUpdate}
                          onPlay={handleVideoPlay}
                          onPause={handleVideoPause}
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
                        onLoadedMetadata={handleVideoLoadedMetadata}
                        onTimeUpdate={handleVideoTimeUpdate}
                        onPlay={handleVideoPlay}
                        onPause={handleVideoPause}
                      />
                    ) : null}
                    <div className="clip-editor-preview-dim" />
                    {logoPreview?.enabled && logoPreview.assetPath ? (
                      <div
                        className="absolute z-20 select-none"
                        style={{
                          left: `${logoPreview.positionX}%`,
                          top: `${logoPreview.positionY}%`,
                          transform: 'translate(-50%, -50%)',
                          width: `${logoPreview.scale * 100}%`,
                          cursor: trackerEnabled ? (isDraggingLogo ? 'grabbing' : 'grab') : 'default'
                        }}
                        onMouseDown={(event) => {
                          if (!trackerEnabled || event.button !== 0) return
                          event.preventDefault()
                          event.stopPropagation()
                          setIsCaptionSelected(false)
                          setIsLogoSelected(true)
                          setIsDraggingLogo(true)
                        }}
                      >
                        <div
                          className={`relative rounded-[5px] ${
                            isDraggingLogo || isLogoSelected ? 'ring-2 ring-white/80' : ''
                          }`}
                        >
                          <img
                            src={`app-file://${logoPreview.assetPath}`}
                            alt="Brand logo"
                            className="block w-full pointer-events-none"
                            style={{ opacity: logoPreview.opacity }}
                            draggable={false}
                          />
                          {trackerEnabled && isLogoSelected ? (
                            <>
                              <div className="absolute inset-0 border border-white/80" />
                              {[
                                'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
                                'right-0 top-0 translate-x-1/2 -translate-y-1/2',
                                'left-0 bottom-0 -translate-x-1/2 translate-y-1/2',
                                'right-0 bottom-0 translate-x-1/2 translate-y-1/2'
                              ].map((handleClass) => (
                                <span
                                  key={handleClass}
                                  className={`absolute h-4 w-4 rounded-full border-2 border-white bg-[#09090b] ${handleClass}`}
                                />
                              ))}
                            </>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                    {captionPreview?.text ? (
                      (() => {
                        const layout = getCaptionLayoutConfig(captionPreview.presetId, previewFrameWidth)
                        const maxLines =
                          captionPreview.lineMode === 'one-line'
                            ? 1
                            : captionPreview.lineMode === 'three-lines'
                              ? 3
                              : layout.maxLines
                        const bubbleWidth = layout.maxWidth
                          ? Math.min(layout.maxWidth, Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio))
                          : Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio)
                        const fontSize = clamp(captionPreview.fontSize, 12, 72)
                        const paddingX = Math.max(0, captionPreview.backgroundPaddingX)
                        const paddingY = Math.max(0, captionPreview.backgroundPaddingY)
                        const radius = Math.max(0, captionPreview.backgroundRadius)
                        const strokeWidth = Math.max(0, captionPreview.strokeWidth)
                        const shadowBlur = Math.max(0, captionPreview.shadowBlur)
                        const shadowOffsetX = captionPreview.shadowOffsetX
                        const shadowOffsetY = captionPreview.shadowOffsetY
                        const captionText = captionPreview.uppercase
                          ? captionPreview.text.toUpperCase()
                          : captionPreview.text
                        const previewCaptionWords = activeCaptionCue
                          ? getTimedClipCaptionWordState(activeCaptionCue, currentTime)
                          : {
                              words: captionText.split(' ').filter(Boolean),
                              activeIndex: captionText.trim() ? 0 : -1
                            }
                        const measuredTextWidth = measureTextWidth(
                          captionText,
                          fontSize,
                          captionPreview.font,
                          Number(captionPreview.fontWeight)
                        )
                        const maxBubbleWidth = Math.min(
                          layout.maxWidth ?? Math.max(layout.minWidth, previewFrameWidth * layout.widthRatio),
                          previewFrameWidth - 24
                        )
                        const singleLineMaxWidth = Math.min(
                          maxBubbleWidth,
                          Math.max(layout.minWidth, Math.ceil(measuredTextWidth + paddingX * 2))
                        )
                        const resolvedBubbleWidth = maxLines === 1 ? undefined : bubbleWidth

                        return (
                          <div
                            className={`absolute left-1/2 -translate-x-1/2 text-center ${
                              maxLines === 1 ? 'whitespace-nowrap' : 'leading-[1.28]'
                            }`}
                            style={{
                              width: resolvedBubbleWidth ? `${resolvedBubbleWidth}px` : 'auto',
                              maxWidth:
                                maxLines === 1
                                  ? `${singleLineMaxWidth}px`
                                  : resolvedBubbleWidth
                                    ? `${resolvedBubbleWidth}px`
                                    : 'none',
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
                              cursor: trackerEnabled ? (isDraggingCaption ? 'grabbing' : 'grab') : 'default'
                            }}
                            onMouseDown={(event) => {
                              if (!trackerEnabled || event.button !== 0) return
                              event.preventDefault()
                              event.stopPropagation()
                              setIsLogoSelected(false)
                              setIsCaptionSelected(true)
                              setIsDraggingCaption(true)
                            }}
                          >
                            <div
                              className={`${
                                trackerEnabled && (isDraggingCaption || isCaptionSelected)
                                  ? 'ring-2 ring-white/80'
                                  : ''
                              } rounded-2xl text-center shadow-lg`}
                              style={{
                                background: captionPreview.backgroundEnabled ? captionPreview.backgroundColor : 'transparent',
                                padding: captionPreview.backgroundEnabled ? `${paddingY}px ${paddingX}px` : '0',
                                borderRadius: captionPreview.backgroundEnabled ? `${radius}px` : '0'
                              }}
                            >
                              <span
                                style={{
                                  display: 'inline-block',
                                  whiteSpace: maxLines === 1 ? 'nowrap' : 'pre-line',
                                  fontFamily: getFontFamilyValue(captionPreview.font),
                                  fontSize: `${fontSize}px`,
                                  fontWeight: captionPreview.fontWeight,
                                  fontStyle: captionPreview.italic ? 'italic' : 'normal',
                                  textDecoration: captionPreview.underline ? 'underline' : 'none',
                                  lineHeight: maxLines === 1 ? 'normal' : 1.28,
                                  color: captionPreview.highlightColor,
                                  WebkitTextStroke:
                                    strokeWidth > 0 ? `${strokeWidth}px ${captionPreview.strokeColor}` : undefined,
                                  textShadow: captionPreview.shadowEnabled
                                    ? `${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${captionPreview.shadowColor}`
                                    : undefined
                                }}
                              >
                                {previewCaptionWords.words.map((word, index) => (
                                  <span
                                    key={`${word}-${index}`}
                                    style={{
                                      color:
                                        index === previewCaptionWords.activeIndex
                                          ? captionPreview.highlightColor
                                          : captionPreview.textColor
                                    }}
                                  >
                                    {index > 0 ? ' ' : ''}
                                    {word}
                                  </span>
                                ))}
                              </span>
                            </div>
                          </div>
                        )
                      })()
                    ) : null}
                    {musicEnabled ? (
                      <div className="clip-editor-audio-indicator absolute right-4 top-4">
                        <IoMusicalNotesOutline size={17} />
                      </div>
                    ) : null}
                </div>
              </div>
          </section>
        </div>

        <footer className="workspace-panel shrink-0 clip-editor-timeline-panel">
          <div className="workspace-panel-scroll !p-0">
            <div className="clip-editor-timeline-toolbar">
              <div className="clip-editor-timeline-toolbar-left">
                <button
                  type="button"
                  className="clip-editor-timeline-tab"
                >
                  <IoCheckmarkCircleOutline size={14} />
                  Timeline
                </button>
              </div>

              <div className="clip-editor-timeline-toolbar-center">
                <button
                  type="button"
                  onClick={() => seekWithinClip(currentTime - 1)}
                  className="clip-editor-timeline-icon-button"
                >
                  ‹‹
                </button>
                <button
                  type="button"
                  onClick={togglePlayback}
                  className="clip-editor-timeline-play-button"
                >
                  {isPlaying ? <IoPause size={16} /> : <IoPlay size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => seekWithinClip(currentTime + 1)}
                  className="clip-editor-timeline-icon-button"
                >
                  ››
                </button>
                <div className="clip-editor-timeline-timecode">
                  {formatClockTime(clipRelativeTime)} / {formatClockTime(clip.duration)}
                </div>
              </div>

              <div className="clip-editor-timeline-toolbar-right">
                <button
                  type="button"
                  onClick={() => setTimelineZoom((current) => clamp(Number((current - 0.15).toFixed(2)), 0.7, 2))}
                  className="clip-editor-timeline-zoom-button"
                >
                  <IoRemoveOutline size={14} />
                </button>
                <input
                  type="range"
                  min="0.7"
                  max="2"
                  step="0.05"
                  value={timelineZoom}
                  onChange={(event) => setTimelineZoom(Number(event.target.value))}
                  className="clip-editor-timeline-zoom-slider"
                />
                <button
                  type="button"
                  onClick={() => setTimelineZoom((current) => clamp(Number((current + 0.15).toFixed(2)), 0.7, 2))}
                  className="clip-editor-timeline-zoom-button"
                >
                  <IoAddOutline size={14} />
                </button>
              </div>
            </div>

            <div className="clip-editor-timeline-shell">
              <div className="clip-editor-timeline-labels">
                <div className="clip-editor-timeline-label clip-editor-timeline-label-spacer" />
                <div className="clip-editor-timeline-label">
                  <IoFilmOutline size={14} />
                  Video
                </div>
                <div className="clip-editor-timeline-label">
                  <IoVolumeHighOutline size={14} />
                  Audio
                </div>
                <div className="clip-editor-timeline-label">
                  <IoTextOutline size={14} />
                  Captions
                </div>
              </div>

              <div className="clip-editor-timeline-scroll">
                <div
                  className="clip-editor-timeline-content"
                  style={{ width: `${timelineWidth}px` }}
                >
                  <button
                    type="button"
                    className="clip-editor-timeline-hitbox"
                    onClick={(event) => seekFromTimeline(event.clientX, event.currentTarget.getBoundingClientRect())}
                    aria-label="Seek timeline"
                  />

                  <div
                    className="clip-editor-timeline-playhead"
                    style={{ left: `${Math.min(Math.max(timelineProgress, 0), 100)}%` }}
                  >
                    <div className="clip-editor-timeline-playhead-handle" />
                  </div>

                  <div className="clip-editor-timeline-ruler">
                    {timelineRulerMarks.map((mark) => (
                      <button
                        key={`mark-${mark.second}`}
                        type="button"
                        className={`clip-editor-timeline-ruler-mark ${mark.major ? 'is-major' : ''}`}
                        style={{ left: `${mark.left}px` }}
                        onClick={() => seekWithinClip(clip.startTime + mark.second)}
                      >
                        <span className="clip-editor-timeline-ruler-tick" />
                        {mark.major ? (
                          <span className="clip-editor-timeline-ruler-label">{mark.second}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>

                  <div className="clip-editor-track clip-editor-track-video">
                    {transcriptLines.map((line, index) => {
                      const left = ((line.start - clip.startTime) / clip.duration) * timelineWidth
                      const width = Math.max(((line.end - line.start) / clip.duration) * timelineWidth, 72)
                      const isActive = activeLineId === line.id

                      return (
                        <button
                          key={`video-${line.id}`}
                          type="button"
                          onClick={() => seekWithinClip(line.start)}
                          className={`clip-editor-video-segment ${isActive ? 'is-active' : ''}`}
                          style={{ left: `${left}px`, width: `${width}px` }}
                        >
                          <div
                            className="clip-editor-video-segment-frame"
                            style={
                              timelineThumbnails[line.id]
                                ? {
                                    backgroundImage: `linear-gradient(180deg, rgba(7, 10, 13, 0.08), rgba(7, 10, 13, 0.18)), url(${timelineThumbnails[line.id]})`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center'
                                  }
                                : undefined
                            }
                          >
                            <span className="clip-editor-video-segment-badge">
                              {framePreview?.cropMode === 'blur' ? 'Blur' : framePreview?.cropMode === 'center' ? 'Center' : 'Fit'}
                            </span>
                            <div className="clip-editor-video-segment-copy">
                              {timelineThumbnails[line.id] ? '' : index + 1}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="clip-editor-track clip-editor-track-audio">
                    {waveformBars.map((bar) => (
                      <span
                        key={bar.id}
                        className="clip-editor-wave-bar"
                        style={{
                          left: `${bar.left}px`,
                          height: `${bar.height}px`
                        }}
                      />
                    ))}
                  </div>

                  <div className="clip-editor-track clip-editor-track-captions">
                    {captionCues.map((cue) => {
                      const left = ((cue.start - clip.startTime) / clip.duration) * timelineWidth
                      const width = Math.max(((cue.end - cue.start) / clip.duration) * timelineWidth, 72)
                      const isActive = activeCaptionCue?.id === cue.id

                      return (
                        <button
                          key={`caption-${cue.id}`}
                          type="button"
                          onClick={() => seekWithinClip(cue.start)}
                          className={`clip-editor-caption-segment ${isActive ? 'is-active' : ''}`}
                          style={{ left: `${left}px`, width: `${width}px` }}
                        >
                          {cue.text}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </footer>
        <audio
          ref={audioRef}
          src={musicAssetPath ? `app-file://${musicAssetPath}` : undefined}
          preload="auto"
        />
      </div>
    </div>
  )
}
