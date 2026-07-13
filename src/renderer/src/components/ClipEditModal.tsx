import React, { useEffect, useRef, useState } from 'react'
import { IoArrowBack, IoClose, IoSaveOutline, IoCopyOutline, IoMusicalNotesOutline, IoCropOutline, IoCheckmarkCircle } from 'react-icons/io5'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { CaptionStyleEditor, CaptionStyle } from './CaptionStyleEditor'
import { LogoEditor, LogoSettings } from './LogoEditor'
import { MusicEditor, MusicSettings } from './MusicEditor'
import { FrameEditor } from './FrameEditor'
import type { TrimBoundaryAnchor } from '@shared/types'
import type { FrameSettings } from '@shared/types/frameSettings'
import { DEFAULT_FRAME_SETTINGS } from '@shared/types/frameSettings'

const ASPECT_RESOLUTIONS: Record<FrameSettings['aspectRatio'], { width: number; height: number }> = {
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '16:9': { width: 1920, height: 1080 }
}

const getAspectResolution = (aspect?: FrameSettings['aspectRatio']) => {
  if (!aspect) return ASPECT_RESOLUTIONS['9:16']
  return ASPECT_RESOLUTIONS[aspect]
}

interface ClipEditModalProps {
  isOpen: boolean
  clipId: string
  episodeId: string
  presentation?: 'modal' | 'page'
  clipData: {
    id: string
    keyQuote: string
    startTime: number
    endTime: number
    duration: number
    videoWidth?: number | null
    videoHeight?: number | null
  }
  onClose: () => void
  onSave: () => void
  onBack?: () => void
}

type EditorTab = 'duration' | 'transcript' | 'captions' | 'logo' | 'music' | 'frame'
type TrimBoundarySide = 'in' | 'out'
type TrimSnapMode = 'free' | 'frame' | 'word'

const EDITOR_SECTIONS: Array<{
  id: EditorTab
  label: string
  shortLabel: string
  description: string
}> = [
  { id: 'duration', label: 'Trim', shortLabel: 'Trim', description: 'Shape clip boundaries and timing.' },
  { id: 'transcript', label: 'Transcript', shortLabel: 'Text', description: 'Correct spoken text before captions.' },
  { id: 'captions', label: 'Captions', shortLabel: 'Caps', description: 'Style subtitles and on-screen text.' },
  { id: 'logo', label: 'Logo', shortLabel: 'Logo', description: 'Place branding and watermark overlays.' },
  { id: 'music', label: 'Music', shortLabel: 'Music', description: 'Mix background music and ducking.' },
  { id: 'frame', label: 'Frame', shortLabel: 'Frame', description: 'Set crop, aspect ratio, and positioning.' }
]

const clampZoom = (value?: number) => Math.max(0.5, Math.min(4, value ?? 1))

export function ClipEditModal({
  isOpen,
  clipId,
  episodeId,
  presentation = 'modal',
  clipData,
  onClose,
  onSave,
  onBack
}: ClipEditModalProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('duration')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [mediaSourceUrl, setMediaSourceUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const blurVideoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  // Duration tab state
  const [editedStartTime, setEditedStartTime] = useState(clipData.startTime)
  const [editedEndTime, setEditedEndTime] = useState(clipData.endTime)
  const [episodeDuration, setEpisodeDuration] = useState<number | null>(null)
  const [frameRate, setFrameRate] = useState<number | null>(null)
  const [showManualInputs, setShowManualInputs] = useState(false)
  const [allEpisodeSegments, setAllEpisodeSegments] = useState<any[]>([])
  const [selectedTrimWordId, setSelectedTrimWordId] = useState<string | null>(null)
  const [selectedBoundary, setSelectedBoundary] = useState<TrimBoundarySide>('out')
  const [snapMode, setSnapMode] = useState<TrimSnapMode>('word')
  const [isLoopPreviewEnabled, setIsLoopPreviewEnabled] = useState(false)
  const [showPrecisionDetails, setShowPrecisionDetails] = useState(false)
  const [startAnchor, setStartAnchor] = useState<TrimBoundaryAnchor | null>(null)
  const [endAnchor, setEndAnchor] = useState<TrimBoundaryAnchor | null>(null)
  const pendingSeekTimeRef = useRef<number | null>(null)

  // Transcript tab state
  const [clipTranscriptSegments, setClipTranscriptSegments] = useState<any[]>([])
  const [editedTranscriptSegments, setEditedTranscriptSegments] = useState<Map<string, string>>(new Map())
  const firstClipSegmentRef = useRef<HTMLDivElement>(null)

  // Caption style state
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle | null>(null)
  const [isDraggingCaption, setIsDraggingCaption] = useState(false)
  const videoContainerRef = useRef<HTMLDivElement>(null)

  // Logo settings state
  const [logoSettings, setLogoSettings] = useState<LogoSettings | null>(null)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)

  // Music settings state
  const [musicSettings, setMusicSettings] = useState<MusicSettings | null>(null)

  // Frame settings state
  const [frameSettings, setFrameSettings] = useState<FrameSettings | null>(null)
  const [isDraggingCrop, setIsDraggingCrop] = useState(false)
  const previousCropMode = useRef<FrameSettings['cropMode'] | null>(null)
  const [isDraggingVideo, setIsDraggingVideo] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [videoMetadata, setVideoMetadata] = useState<{ width: number; height: number } | null>(null)
  const [isVideoMetadataLoading, setIsVideoMetadataLoading] = useState(true)
  const [videoMetadataError, setVideoMetadataError] = useState<string | null>(null)

  // Load clip video and caption style on mount
  useEffect(() => {
    if (isOpen && clipId && !saving) {
      loadSourceMedia()
      loadTrimState()
      loadCaptionStyle()
      loadLogoSettings()
      loadMusicSettings()
      loadFrameSettings()
    }
  }, [isOpen, clipId])

  useEffect(() => {
    if (!isOpen) return

    setEditedStartTime(clipData.startTime)
    setEditedEndTime(clipData.endTime)
    setStartAnchor(null)
    setEndAnchor(null)
    setSelectedBoundary('out')
    setSelectedTrimWordId(null)
    setSnapMode('word')
    setIsLoopPreviewEnabled(false)
    setShowPrecisionDetails(false)
  }, [clipData.endTime, clipData.startTime, isOpen])

  // Load logo settings
  const loadLogoSettings = async () => {
    try {
      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)

      if (existingEdits) {
        setLogoSettings({
          enabled: existingEdits.logo_enabled === 1,
          logoPath: existingEdits.logo_path || null,
          positionX: existingEdits.logo_position_x ?? 85,
          positionY: existingEdits.logo_position_y ?? 85,
          scale: existingEdits.logo_scale ?? 0.15,
          opacity: existingEdits.logo_opacity ?? 0.8
        })
      } else {
        const brandTemplate = await window.electronAPI?.getBrandTemplate?.()
        setLogoSettings({
          enabled: brandTemplate?.logo.enabled ?? false,
          logoPath: brandTemplate?.logo.assetPath ?? null,
          positionX: brandTemplate?.logo.positionX ?? 85,
          positionY: brandTemplate?.logo.positionY ?? 85,
          scale: brandTemplate?.logo.scale ?? 0.15,
          opacity: brandTemplate?.logo.opacity ?? 0.8
        })
      }
    } catch (error) {
      console.error('Failed to load logo settings:', error)
      // Set defaults on error
      setLogoSettings({
        enabled: false,
        logoPath: null,
        positionX: 85,
        positionY: 85,
        scale: 0.15,
        opacity: 0.8
      })
    }
  }

  // Load music settings
  const loadMusicSettings = async () => {
    try {
      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      const brandTemplate = await window.electronAPI?.getBrandTemplate?.()

      // Only use clip edits if music was explicitly configured (has a path set)
      // Otherwise fall back to brand template to avoid clip edits overriding brand template music
      if (existingEdits?.music_path) {
        setMusicSettings({
          enabled: existingEdits.music_enabled === 1,
          musicPath: existingEdits.music_path,
          volume: existingEdits.music_volume ?? 0.3,
          duckVolume: existingEdits.music_duck_volume ?? 0.1,
          duckEnabled: existingEdits.music_duck_enabled === 1,
          fadeIn: existingEdits.music_fade_in ?? 1.0,
          fadeOut: existingEdits.music_fade_out ?? 1.0,
          loop: existingEdits.music_loop === 1
        })
      } else {
        setMusicSettings({
          enabled: brandTemplate?.music.enabled ?? false,
          musicPath: brandTemplate?.music.assetPath ?? null,
          volume: brandTemplate?.music.volume ?? 0.3,
          duckVolume: 0.1,
          duckEnabled: brandTemplate?.music.duckEnabled ?? true,
          fadeIn: 1.0,
          fadeOut: 1.0,
          loop: true
        })
      }
    } catch (error) {
      console.error('Failed to load music settings:', error)
    }
  }

  // Load frame settings
  const loadFrameSettings = async () => {
    try {
      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      if (existingEdits) {
        const normalizedMode = existingEdits.crop_mode === 'canvas'
          ? 'fit'
          : (existingEdits.crop_mode || DEFAULT_FRAME_SETTINGS.cropMode)

        const settings: FrameSettings = {
          aspectRatio: (existingEdits.aspect_ratio || DEFAULT_FRAME_SETTINGS.aspectRatio) as FrameSettings['aspectRatio'],
          cropMode: normalizedMode as FrameSettings['cropMode'],
          cropPositionX: existingEdits.crop_position_x ?? DEFAULT_FRAME_SETTINGS.cropPositionX,
          cropPositionY: existingEdits.crop_position_y ?? DEFAULT_FRAME_SETTINGS.cropPositionY,
          zoomLevel: clampZoom(existingEdits.zoom_level ?? DEFAULT_FRAME_SETTINGS.zoomLevel),
          videoOffsetX: existingEdits.video_offset_x ?? DEFAULT_FRAME_SETTINGS.videoOffsetX,
          videoOffsetY: existingEdits.video_offset_y ?? DEFAULT_FRAME_SETTINGS.videoOffsetY
        }
        console.log('[ClipEditModal] Loaded frame settings:', settings)
        setFrameSettings(settings)
      } else {
        const brandTemplate = await window.electronAPI?.getBrandTemplate?.()
        console.log('[ClipEditModal] No existing edits, using brand template defaults')
        setFrameSettings({
          ...DEFAULT_FRAME_SETTINGS,
          aspectRatio: brandTemplate?.frame.aspectRatio ?? DEFAULT_FRAME_SETTINGS.aspectRatio,
          cropMode: brandTemplate?.frame.cropMode ?? DEFAULT_FRAME_SETTINGS.cropMode
        })
      }
    } catch (error) {
      console.error('Failed to load frame settings:', error)
      // Set defaults on error
      setFrameSettings({ ...DEFAULT_FRAME_SETTINGS })
    }
  }

  // Load persisted video metadata for Canvas Fit preview/export parity
  useEffect(() => {
    if (!isOpen) return

    let cancelled = false

    const applyMetadata = (width: number, height: number) => {
      if (cancelled) return
      setVideoMetadata({ width, height })
      setVideoMetadataError(null)
      setIsVideoMetadataLoading(false)
    }

    const fetchMetadata = async () => {
      setIsVideoMetadataLoading(true)
      setVideoMetadataError(null)

      // Prefer metadata already provided via clipData prop
      if (clipData?.videoWidth && clipData?.videoHeight) {
        applyMetadata(clipData.videoWidth, clipData.videoHeight)
        return
      }

      try {
        const clipRecord = await window.electronAPI?.getClip?.(clipId)
        if (cancelled) return

        if (clipRecord?.video_width && clipRecord?.video_height) {
          applyMetadata(clipRecord.video_width, clipRecord.video_height)
        } else {
          setVideoMetadata(null)
          setVideoMetadataError('Video dimensions are unavailable for this clip.')
          setIsVideoMetadataLoading(false)
        }
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load video metadata:', error)
        setVideoMetadata(null)
        setVideoMetadataError('Failed to load video dimensions.')
        setIsVideoMetadataLoading(false)
      }
    }

    fetchMetadata()

    return () => {
      cancelled = true
    }
  }, [clipId, clipData?.videoWidth, clipData?.videoHeight, isOpen])

  const clampCanvasFitOffsets = (
  proposedX: number,
  proposedY: number,
  settingsOverride?: FrameSettings | null
): { x: number; y: number } => {
    const metadata = videoMetadata
    const activeSettings = settingsOverride ?? frameSettings

    if (!metadata || activeSettings?.cropMode !== 'fit') {
      return { x: proposedX, y: proposedY }
    }

  const resolution = getAspectResolution(activeSettings.aspectRatio)
  const zoom = activeSettings.zoomLevel ?? 1
  const baseScale = resolution.width / metadata.width
  const videoWidth = metadata.width * baseScale * zoom
  const videoHeight = metadata.height * baseScale * zoom

    const minVisibleRatio = 0.1
    const minVisibleWidth = videoWidth * minVisibleRatio
    const minVisibleHeight = videoHeight * minVisibleRatio

    const leftBase = (resolution.width - videoWidth) / 2
    const topBase = (resolution.height - videoHeight) / 2

    let offsetX = proposedX
    let offsetY = proposedY

    const desiredLeft = leftBase + offsetX
    const desiredTop = topBase + offsetY
    const minLeft = minVisibleWidth - videoWidth
    const maxLeft = resolution.width - minVisibleWidth
    const minTop = minVisibleHeight - videoHeight
    const maxTop = resolution.height - minVisibleHeight

    if (desiredLeft < minLeft) {
      offsetX += (minLeft - desiredLeft)
    } else if (desiredLeft > maxLeft) {
      offsetX -= (desiredLeft - maxLeft)
    }

    if (desiredTop < minTop) {
      offsetY += (minTop - desiredTop)
    } else if (desiredTop > maxTop) {
      offsetY -= (desiredTop - maxTop)
    }

    return { x: offsetX, y: offsetY }
  }

  // Log frame settings changes and handle mode transitions
  useEffect(() => {
    if (!frameSettings) return
    console.log('[ClipEditModal] Frame settings updated:', frameSettings)

    const prevMode = previousCropMode.current
    previousCropMode.current = frameSettings.cropMode

    if (frameSettings.cropMode === 'fit' && prevMode !== 'fit') {
      setFrameSettings(prev => prev ? {
        ...prev,
        videoOffsetX: prev.videoOffsetX ?? 0,
        videoOffsetY: prev.videoOffsetY ?? 0,
        zoomLevel: clampZoom(prev.zoomLevel)
      } : prev)
    }
  }, [frameSettings])

  // Clamp historical offsets once when metadata becomes available
  useEffect(() => {
    if (!frameSettings || frameSettings.cropMode !== 'fit' || !videoMetadata) return

    const clamped = clampCanvasFitOffsets(
      frameSettings.videoOffsetX ?? 0,
      frameSettings.videoOffsetY ?? 0,
      frameSettings
    )

    if (
      clamped.x !== (frameSettings.videoOffsetX ?? 0) ||
      clamped.y !== (frameSettings.videoOffsetY ?? 0)
    ) {
      setFrameSettings(prev => prev ? {
        ...prev,
        videoOffsetX: clamped.x,
        videoOffsetY: clamped.y
      } : prev)
    }
  }, [videoMetadata, frameSettings?.cropMode])

  // Load and sync music with video
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicSettings?.enabled || !musicSettings?.musicPath) {
      // Clear audio if music is disabled
      if (audio) {
        audio.pause()
        audio.src = ''
      }
      return
    }

    // Load music file
    audio.src = `app-file://${musicSettings.musicPath}`
    audio.loop = musicSettings.loop
    audio.volume = musicSettings.volume

    console.log('Music loaded:', musicSettings.musicPath)
  }, [musicSettings?.enabled, musicSettings?.musicPath, musicSettings?.loop])

  // Sync audio play/pause with video
  useEffect(() => {
    const video = videoRef.current
    const audio = audioRef.current

    if (!video || !audio || !musicSettings?.enabled || !musicSettings?.musicPath) return

    const handleVideoPlay = () => {
      audio.currentTime = Math.max(0, video.currentTime - editedStartTime)
      audio.play().catch(err => console.error('Failed to play audio:', err))
    }

    const handleVideoPause = () => {
      audio.pause()
    }

    const handleVideoSeeked = () => {
      // Keep music aligned to the clip-relative playhead.
      audio.currentTime = Math.max(0, video.currentTime - editedStartTime)
    }

    video.addEventListener('play', handleVideoPlay)
    video.addEventListener('pause', handleVideoPause)
    video.addEventListener('seeked', handleVideoSeeked)

    return () => {
      video.removeEventListener('play', handleVideoPlay)
      video.removeEventListener('pause', handleVideoPause)
      video.removeEventListener('seeked', handleVideoSeeked)
    }
  }, [editedStartTime, musicSettings?.enabled, musicSettings?.musicPath])

  // Sync blur video with main video
  useEffect(() => {
    const video = videoRef.current
    const blurVideo = blurVideoRef.current

    if (!video || !blurVideo || frameSettings?.cropMode !== 'blur') return

    const handleVideoPlay = () => {
      blurVideo.play().catch(err => console.error('Failed to play blur video:', err))
    }

    const handleVideoPause = () => {
      blurVideo.pause()
    }

    const handleVideoSeeked = () => {
      blurVideo.currentTime = video.currentTime
    }

    const handleVideoTimeUpdate = () => {
      // Keep blur video in sync (in case of any drift)
      if (Math.abs(blurVideo.currentTime - video.currentTime) > 0.1) {
        blurVideo.currentTime = video.currentTime
      }
    }

    video.addEventListener('play', handleVideoPlay)
    video.addEventListener('pause', handleVideoPause)
    video.addEventListener('seeked', handleVideoSeeked)
    video.addEventListener('timeupdate', handleVideoTimeUpdate)

    return () => {
      video.removeEventListener('play', handleVideoPlay)
      video.removeEventListener('pause', handleVideoPause)
      video.removeEventListener('seeked', handleVideoSeeked)
      video.removeEventListener('timeupdate', handleVideoTimeUpdate)
    }
  }, [frameSettings?.cropMode])

  // Apply volume and ducking based on transcript segments
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !musicSettings?.enabled) return

    // If ducking is disabled, just use base volume
    if (!musicSettings?.duckEnabled) {
      audio.volume = musicSettings.volume
      return
    }

    // Check if current time is during speech (within clip transcript segments)
    const clipRelativeSegments = clipTranscriptSegments
      .filter((seg: any) => seg.start_time >= editedStartTime && seg.end_time <= editedEndTime)

    const clipRelativeCurrentTime = Math.max(0, currentTime - editedStartTime)

    const isDuringSpeech = clipRelativeSegments.some((seg: any) => {
      const segmentStart = seg.start_time - editedStartTime
      const segmentEnd = seg.end_time - editedStartTime
      return clipRelativeCurrentTime >= segmentStart && clipRelativeCurrentTime <= segmentEnd
    })

    // Apply ducking - reduce volume during speech
    const targetVolume = isDuringSpeech ? musicSettings.duckVolume : musicSettings.volume

    // Smooth transition to avoid abrupt changes
    if (Math.abs(audio.volume - targetVolume) > 0.01) {
      audio.volume = targetVolume
    }
  }, [currentTime, musicSettings?.volume, musicSettings?.duckVolume, musicSettings?.duckEnabled, musicSettings?.enabled, clipTranscriptSegments, editedStartTime, editedEndTime])

  // Load caption style for video preview
  const loadCaptionStyle = async () => {
    try {
      console.log('[ClipEditModal] Loading caption style for clip:', clipId)
      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[ClipEditModal] Received edits from database:', existingEdits)

      if (existingEdits) {
        const loadedStyle = {
          enabled: existingEdits.captions_enabled === 1,
          font: existingEdits.caption_font || 'Inter',
          size: existingEdits.caption_size || 48,
          color: existingEdits.caption_color || '#FFFFFF',
          position: existingEdits.caption_position || 'bottom',
          customX: existingEdits.caption_custom_x,
          customY: existingEdits.caption_custom_y,
          weight: existingEdits.caption_weight || (existingEdits.caption_bold === 1 ? 700 : 400),
          italic: existingEdits.caption_italic === 1,
          outline: existingEdits.caption_outline === 1,
          outlineColor: existingEdits.caption_outline_color || '#000000',
          outlineWidth: existingEdits.caption_outline_width || 2,
          shadow: existingEdits.caption_shadow === 1,
          highlightStyle: existingEdits.caption_highlight_style || 'word',
          background: existingEdits.caption_background === 1,
          backgroundColor: existingEdits.caption_background_color || '#000000',
          backgroundOpacity: existingEdits.caption_background_opacity || 0.5,
          textCase: existingEdits.caption_text_case || 'normal',
          wordsPerCaption: existingEdits.caption_words_per_caption || 3,
          maxWidth: existingEdits.caption_max_width ?? 90,
          lineHeight: existingEdits.caption_line_height ?? 1.2,
          letterSpacing: existingEdits.caption_letter_spacing ?? 0
        }
        console.log('[ClipEditModal] Setting caption style to:', loadedStyle)
        setCaptionStyle(loadedStyle)
      } else {
        const brandTemplate = await window.electronAPI?.getBrandTemplate?.()
        console.log('[ClipEditModal] No existing edits, using brand template defaults')
        const defaultStyle: CaptionStyle = {
          enabled: brandTemplate?.caption.presetId !== 'none',
          font: brandTemplate?.caption.font || 'Inter',
          size: 48,
          color: '#FFFFFF',
          position: brandTemplate?.caption.position || 'bottom',
          customX: brandTemplate?.caption.customX ?? undefined,
          customY: brandTemplate?.caption.customY ?? undefined,
          weight: 700,
          italic: false,
          outline: true,
          outlineColor: '#000000',
          outlineWidth: 2,
          shadow: false,
          highlightStyle: 'word',
          background: false,
          backgroundColor: '#000000',
          backgroundOpacity: 0.5,
          textCase: 'normal',
          wordsPerCaption: 3,
          maxWidth: 90,
          lineHeight: 1.2,
          letterSpacing: 0
        }
        console.log('[ClipEditModal] Setting default caption style:', defaultStyle)
        setCaptionStyle(defaultStyle)
      }
    } catch (error) {
      console.error('[ClipEditModal] Failed to load caption style:', error)
    }
  }

  // Video event listeners
  useEffect(() => {
    const video = videoRef.current
    if (!video || !mediaSourceUrl) return
    const boundaryTime = selectedBoundary === 'in' ? editedStartTime : editedEndTime
    const loopStart = Math.max(0, boundaryTime - 0.75)
    const loopEnd = Math.min(
      episodeDuration ?? duration ?? boundaryTime + 0.75,
      boundaryTime + 0.75
    )

    const handleTimeUpdate = () => {
      const absoluteTime = video.currentTime
      setCurrentTime(absoluteTime)

      if (isLoopPreviewEnabled && absoluteTime >= loopEnd) {
        video.currentTime = loopStart
        setCurrentTime(loopStart)
        if (video.paused) {
          video.play().catch(error => console.error('Failed to continue loop preview:', error))
        }
        return
      }

      if (absoluteTime >= editedEndTime) {
        video.pause()
        video.currentTime = editedEndTime
        setCurrentTime(editedEndTime)
      }
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      setLoading(false)
      const seekTarget = pendingSeekTimeRef.current ?? editedStartTime
      video.currentTime = seekTarget
      setCurrentTime(seekTarget)
      pendingSeekTimeRef.current = null
      console.log('Video metadata loaded, duration:', video.duration)
    }
    const handleError = () => {
      console.error('Video failed to load')
      setLoading(false)
    }
    const handleCanPlay = () => {
      // Fallback in case loadedmetadata doesn't fire
      setLoading(false)
      console.log('Video can play')
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('error', handleError)
    video.addEventListener('canplay', handleCanPlay)

    // Timeout fallback - if video doesn't load within 5 seconds, stop loading
    const timeoutId = setTimeout(() => {
      console.warn('Video load timeout - stopping loading state')
      setLoading(false)
    }, 5000)

    return () => {
      clearTimeout(timeoutId)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('error', handleError)
      video.removeEventListener('canplay', handleCanPlay)
    }
  }, [duration, editedEndTime, editedStartTime, episodeDuration, isLoopPreviewEnabled, mediaSourceUrl, selectedBoundary])

  const seekSourceVideo = (absoluteTime: number) => {
    const maxTime = episodeDuration ?? duration ?? absoluteTime
    const boundedTime = Math.max(0, Math.min(absoluteTime, maxTime))

    if (videoRef.current) {
      videoRef.current.currentTime = boundedTime
    }

    setCurrentTime(boundedTime)
  }

  const loadSourceMedia = async () => {
    try {
      console.log('loadSourceMedia called')
      setLoading(true)
      pendingSeekTimeRef.current = editedStartTime

      const result = await window.electronAPI?.getEpisodeMediaSource?.(episodeId)

      console.log('getEpisodeMediaSource result:', result)

      if (result?.mediaUrl) {
        setMediaSourceUrl(result.mediaUrl)
        if (result.duration) {
          setEpisodeDuration(result.duration)
        }
        setFrameRate(result.frameRate ?? null)
      } else {
        console.warn('No mediaUrl in result, stopping loading')
        setLoading(false)
      }
    } catch (error) {
      console.error('Failed to load source media:', error)
      setLoading(false)
    }
  }

  const loadTrimState = async () => {
    try {
      const trimState = await window.electronAPI?.getClipTrimState?.(clipId)
      if (!trimState) return

      setEditedStartTime(trimState.inPoint)
      setEditedEndTime(trimState.outPoint)
      setStartAnchor(trimState.inAnchorType ? {
        type: trimState.inAnchorType,
        sourceId: trimState.inAnchorSourceId,
        label: trimState.inAnchorLabel,
        confidence: trimState.inAnchorConfidence,
        time: trimState.inPoint
      } : null)
      setEndAnchor(trimState.outAnchorType ? {
        type: trimState.outAnchorType,
        sourceId: trimState.outAnchorSourceId,
        label: trimState.outAnchorLabel,
        confidence: trimState.outAnchorConfidence,
        time: trimState.outPoint
      } : null)
    } catch (error) {
      console.error('Failed to load trim state:', error)
    }
  }

  // Load episode duration for Duration tab
  useEffect(() => {
    if (isOpen && activeTab === 'duration') {
      loadEpisodeDuration()
    }
  }, [isOpen, activeTab, episodeId])

  // Load all transcript segments when modal opens (needed for caption overlay on all tabs)
  useEffect(() => {
    if (isOpen) {
      loadClipTranscript()
    }
  }, [isOpen, episodeId, editedStartTime, editedEndTime])

  // Auto-scroll to first clip segment when transcript tab is opened
  useEffect(() => {
    if (activeTab === 'transcript' && clipTranscriptSegments.length > 0 && firstClipSegmentRef.current) {
      // Small delay to ensure DOM is rendered
      setTimeout(() => {
        firstClipSegmentRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        })
      }, 100)
    }
  }, [activeTab, clipTranscriptSegments])

  const loadEpisodeDuration = async () => {
    try {
      // Get episode duration
      const episode = await window.electronAPI?.getEpisode?.(episodeId)
      if (episode) {
        setEpisodeDuration(episode.duration)
      }

      // Get all transcript segments for live preview
      const allSegments = await window.electronAPI?.getTranscriptSegments?.(episodeId)
      if (allSegments) {
        setAllEpisodeSegments(allSegments)
      }
    } catch (error) {
      console.error('Failed to load episode duration:', error)
    }
  }

  const loadClipTranscript = async () => {
    try {
      console.log('Loading transcript for episode:', episodeId)
      console.log('Clip boundaries:', { start: editedStartTime, end: editedEndTime })

      // Get ALL transcript segments to show full context (before, during, and after clip)
      const allSegments = await window.electronAPI?.getTranscriptSegments?.(episodeId)
      console.log('All segments received:', allSegments?.length || 0, 'segments')

      if (allSegments && allSegments.length > 0) {
        console.log('First segment sample:', allSegments[0])

        // Show ALL segments for full context
        setClipTranscriptSegments(allSegments)
        // Reset edited segments when loading fresh data
        setEditedTranscriptSegments(new Map())
      } else {
        console.warn('No transcript segments found in database for episode:', episodeId)
        setClipTranscriptSegments([])
      }
    } catch (error) {
      console.error('Failed to load clip transcript:', error)
    }
  }

  const handleTranscriptEdit = (segmentId: string, newText: string) => {
    const updatedEdits = new Map(editedTranscriptSegments)
    updatedEdits.set(segmentId, newText)
    setEditedTranscriptSegments(updatedEdits)
    setHasUnsavedChanges(true)
  }

  const handleTranscriptBlur = async (segmentId: string, segmentIndex: number) => {
    const editedText = editedTranscriptSegments.get(segmentId)
    if (editedText !== undefined) {
      try {
        // Update the transcript segment in the database
        await window.electronAPI?.updateTranscriptSegment?.(
          episodeId,
          segmentIndex,
          editedText
        )

        // Update the local state to reflect the saved change
        const updatedSegments = [...clipTranscriptSegments]
        updatedSegments[segmentIndex] = {
          ...updatedSegments[segmentIndex],
          text: editedText
        }
        setClipTranscriptSegments(updatedSegments)

        console.log('Transcript segment saved:', segmentId)
      } catch (error) {
        console.error('Failed to save transcript segment:', error)
        alert('Failed to save transcript changes')
      }
    }
  }

  // Handle caption dragging
  useEffect(() => {
    const handleCaptionDrag = (e: MouseEvent) => {
      if (!isDraggingCaption || !videoContainerRef.current) return

      const rect = videoContainerRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100

      // Clamp values between 10% and 90% to keep caption visible
      const clampedX = Math.max(10, Math.min(90, x))
      const clampedY = Math.max(10, Math.min(90, y))

      setCaptionStyle(prev => prev ? {
        ...prev,
        position: 'custom',
        customX: clampedX,
        customY: clampedY
      } : prev)
      setHasUnsavedChanges(true)
    }

    const handleMouseUp = () => {
      setIsDraggingCaption(false)
    }

    if (isDraggingCaption) {
      document.addEventListener('mousemove', handleCaptionDrag)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleCaptionDrag)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingCaption])

  // Handle logo dragging
  useEffect(() => {
    const handleLogoDrag = (e: MouseEvent) => {
      if (!isDraggingLogo || !videoContainerRef.current) return

      const rect = videoContainerRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100

      // Clamp values between 5% and 95% to keep logo visible
      const clampedX = Math.max(5, Math.min(95, x))
      const clampedY = Math.max(5, Math.min(95, y))

      setLogoSettings(prev => prev ? {
        ...prev,
        positionX: clampedX,
        positionY: clampedY
      } : prev)
      setHasUnsavedChanges(true)
    }

    const handleMouseUp = () => {
      setIsDraggingLogo(false)
    }

    if (isDraggingLogo) {
      document.addEventListener('mousemove', handleLogoDrag)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleLogoDrag)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingLogo])

  // Handle crop position dragging
  useEffect(() => {
    const handleCropDrag = (e: MouseEvent) => {
      if (!isDraggingCrop || !videoContainerRef.current) return

      const rect = videoContainerRef.current.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * 100
      const y = ((e.clientY - rect.top) / rect.height) * 100

      // Clamp values between 0% and 100%
      const clampedX = Math.max(0, Math.min(100, x))
      const clampedY = Math.max(0, Math.min(100, y))

      setFrameSettings(prev => prev ? {
        ...prev,
        cropPositionX: clampedX,
        cropPositionY: clampedY
      } : prev)
      setHasUnsavedChanges(true)
    }

    const handleMouseUp = () => {
      setIsDraggingCrop(false)
    }

    if (isDraggingCrop) {
      document.addEventListener('mousemove', handleCropDrag)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleCropDrag)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingCrop])

  // Canvas Fit dragging handler
  useEffect(() => {
    if (!isDraggingVideo) return

    const handleVideoDrag = (e: MouseEvent) => {
      if (!frameSettings || frameSettings.cropMode !== 'fit') return
      const resolution = getAspectResolution(frameSettings.aspectRatio)
      const container = videoContainerRef.current
      if (!container) return

      const previewScaleX = container.offsetWidth / resolution.width || 1
      const previewScaleY = container.offsetHeight / resolution.height || 1

      const deltaX = e.clientX - dragStart.x
      const deltaY = e.clientY - dragStart.y

      if (deltaX === 0 && deltaY === 0) return

      setFrameSettings(prev => prev ? {
        ...prev,
        ...(() => {
          const nextOffsetX = (prev.videoOffsetX ?? 0) + (deltaX / previewScaleX)
          const nextOffsetY = (prev.videoOffsetY ?? 0) + (deltaY / previewScaleY)
          const clamped = clampCanvasFitOffsets(nextOffsetX, nextOffsetY, prev)
          return {
            videoOffsetX: clamped.x,
            videoOffsetY: clamped.y
          }
        })()
      } : prev)

      setDragStart({ x: e.clientX, y: e.clientY })
      setHasUnsavedChanges(true)
    }

    const handleMouseUp = () => {
      setIsDraggingVideo(false)
    }

    document.addEventListener('mousemove', handleVideoDrag)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleVideoDrag)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingVideo, dragStart, frameSettings, videoMetadata])

  useEffect(() => {
    if (frameSettings?.cropMode !== 'fit') {
      setIsDraggingVideo(false)
    }
  }, [frameSettings?.cropMode])

  const handleClose = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm(
        'You have unsaved changes. Are you sure you want to close?'
      )
      if (!confirmed) return
    }
    onClose()
  }

  const buildEditsObject = (_targetClipId: string, targetStartTime: number, targetEndTime: number) => {
    const allEdits: any = {}

    // Add caption style edits
    if (captionStyle) {
      // Get clip-relative transcript segments for caption_segments field
      // For the target clip, we need to filter based on its boundaries
      const clipRelativeSegments = clipTranscriptSegments
        .filter((seg: any) => seg.start_time >= targetStartTime && seg.end_time <= targetEndTime)
        .map((seg: any) => ({
          text: seg.text,
          start: seg.start_time - targetStartTime,
          end: seg.end_time - targetStartTime
        }))

      Object.assign(allEdits, {
        captions_enabled: captionStyle.enabled ? 1 : 0,
        caption_segments: JSON.stringify(clipRelativeSegments),
        caption_font: captionStyle.font,
        caption_size: captionStyle.size,
        caption_color: captionStyle.color,
        caption_position: captionStyle.position,
        caption_custom_x: captionStyle.customX,
        caption_custom_y: captionStyle.customY,
        caption_bold: captionStyle.weight >= 700 ? 1 : 0, // Keep for backward compatibility
        caption_weight: captionStyle.weight || 700,
        caption_italic: captionStyle.italic ? 1 : 0,
        caption_outline: captionStyle.outline ? 1 : 0,
        caption_outline_color: captionStyle.outlineColor,
        caption_outline_width: captionStyle.outlineWidth,
        caption_shadow: captionStyle.shadow ? 1 : 0,
        caption_highlight_style: captionStyle.highlightStyle,
        caption_background: captionStyle.background ? 1 : 0,
        caption_background_color: captionStyle.backgroundColor,
        caption_background_opacity: captionStyle.backgroundOpacity,
        caption_text_case: captionStyle.textCase,
        caption_words_per_caption: captionStyle.wordsPerCaption,
        caption_max_width: captionStyle.maxWidth,
        caption_line_height: captionStyle.lineHeight,
        caption_letter_spacing: captionStyle.letterSpacing
      })
    }

    // Add logo settings edits
    if (logoSettings) {
      Object.assign(allEdits, {
        logo_enabled: logoSettings.enabled ? 1 : 0,
        logo_path: logoSettings.logoPath,
        logo_position_x: logoSettings.positionX,
        logo_position_y: logoSettings.positionY,
        logo_scale: logoSettings.scale,
        logo_opacity: logoSettings.opacity
      })
    }

    // Add music settings edits
    if (musicSettings) {
      Object.assign(allEdits, {
        music_enabled: musicSettings.enabled ? 1 : 0,
        music_path: musicSettings.musicPath,
        music_volume: musicSettings.volume,
        music_duck_volume: musicSettings.duckVolume,
        music_duck_enabled: musicSettings.duckEnabled ? 1 : 0,
        music_fade_in: musicSettings.fadeIn,
        music_fade_out: musicSettings.fadeOut,
        music_loop: musicSettings.loop ? 1 : 0
      })
    }

    // Add frame settings edits
    if (frameSettings) {
      Object.assign(allEdits, {
        aspect_ratio: frameSettings.aspectRatio,
        crop_mode: frameSettings.cropMode,
        crop_position_x: frameSettings.cropPositionX ?? 50,
        crop_position_y: frameSettings.cropPositionY ?? 50,
        zoom_level: frameSettings.zoomLevel ?? 1.0,
        video_offset_x: frameSettings.videoOffsetX ?? 0,
        video_offset_y: frameSettings.videoOffsetY ?? 0
      })
    }

    return allEdits
  }

  const handleApplyToAll = async () => {
    try {
      // Confirm with the user
      const confirmed = window.confirm(
        'This will apply the current caption, logo, music, and frame settings to ALL clips in this episode. Duration and transcript edits will not be affected. Continue?'
      )
      if (!confirmed) return

      setSaving(true)
      console.log('[ClipEditModal] Applying settings to all clips in episode:', episodeId)

      // Get all clips for this episode
      const allClips = await window.electronAPI?.getEpisodeClips?.(episodeId)
      if (!allClips || allClips.length === 0) {
        alert('No clips found for this episode')
        return
      }

      console.log(`[ClipEditModal] Found ${allClips.length} clips to update`)

      // Apply settings to each clip
      let successCount = 0
      let errorCount = 0

      for (const clip of allClips) {
        try {
          // Build the edits object for this clip using its boundaries
          const edits = buildEditsObject(clip.id, clip.start_time, clip.end_time)

          if (Object.keys(edits).length > 0) {
            await window.electronAPI?.saveClipEdits?.(clip.id, edits)
            successCount++
            console.log(`[ClipEditModal] Applied settings to clip ${clip.id}`)
          }
        } catch (error) {
          console.error(`[ClipEditModal] Failed to apply settings to clip ${clip.id}:`, error)
          errorCount++
        }
      }

      // Show result
      if (errorCount === 0) {
        alert(`Successfully applied settings to all ${successCount} clips!`)
      } else {
        alert(`Applied settings to ${successCount} clips, but ${errorCount} failed. Check console for details.`)
      }

      // Refresh the parent component
      await onSave()
    } catch (error) {
      console.error('[ClipEditModal] Failed to apply settings to all clips:', error)
      alert('Failed to apply settings: ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      setJustSaved(false)

      // Save duration changes if modified
      if (editedStartTime !== clipData.startTime || editedEndTime !== clipData.endTime) {
        await window.electronAPI?.updateClipBoundaries?.(
          clipId,
          editedStartTime,
          editedEndTime
        )
      }

      await window.electronAPI?.saveClipTrimState?.(
        clipId,
        editedStartTime,
        editedEndTime,
        startAnchor ? { ...startAnchor, time: editedStartTime } : null,
        endAnchor ? { ...endAnchor, time: editedEndTime } : null
      )

      // Build edits for the current clip
      const allEdits = buildEditsObject(clipId, editedStartTime, editedEndTime)

      // Save all edits in one call
      if (Object.keys(allEdits).length > 0) {
        await window.electronAPI?.saveClipEdits?.(clipId, allEdits)
      }

      // Call the parent callback
      await onSave()

      setHasUnsavedChanges(false)
      setJustSaved(true)

      // Reset "Saved" state after 2 seconds
      setTimeout(() => {
        setJustSaved(false)
      }, 2000)
    } catch (error) {
      console.error('[ClipEditModal] Failed to save clip edits:', error)
      alert('Failed to save changes: ' + (error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        if (videoRef.current.currentTime < editedStartTime || videoRef.current.currentTime >= editedEndTime) {
          videoRef.current.currentTime = editedStartTime
          setCurrentTime(editedStartTime)
        }
        videoRef.current.play()
      } else {
        videoRef.current.pause()
      }
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatPreciseTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.round((seconds - Math.floor(seconds)) * 1000)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`
  }

  const clipRelativeCurrentTime = Math.max(0, currentTime - editedStartTime)
  const updateStartBoundary = (time: number, anchor: TrimBoundaryAnchor) => {
    setEditedStartTime(time)
    setStartAnchor({ ...anchor, time })
    setSelectedBoundary('in')
    setHasUnsavedChanges(true)
  }

  const updateEndBoundary = (time: number, anchor: TrimBoundaryAnchor) => {
    setEditedEndTime(time)
    setEndAnchor({ ...anchor, time })
    setSelectedBoundary('out')
    setHasUnsavedChanges(true)
  }

  const resolveWordSnapCandidate = (boundary: TrimBoundarySide, time: number) => {
    if (!visibleTrimWords.length) return null

    const candidates = visibleTrimWords
      .map((word) => ({
        time: boundary === 'in' ? word.start : word.end,
        word,
        type: boundary === 'in' ? 'word_start' as const : 'word_end' as const
      }))
      .sort((a, b) => Math.abs(a.time - time) - Math.abs(b.time - time))

    return candidates[0] ?? null
  }

  const applyBoundaryWithSnap = (
    boundary: TrimBoundarySide,
    proposedTime: number,
    options?: {
      preferredAnchor?: TrimBoundaryAnchor
      skipSnap?: boolean
    }
  ) => {
    const maxEnd = episodeDuration ?? duration ?? editedEndTime
    const boundedTime = boundary === 'in'
      ? Math.max(0, Math.min(proposedTime, editedEndTime - 35))
      : Math.max(editedStartTime + 35, Math.min(proposedTime, maxEnd))

    const shouldSkipSnap = options?.skipSnap || snapMode === 'free'

    if (!shouldSkipSnap && options?.preferredAnchor) {
      if (boundary === 'in') {
        updateStartBoundary(boundedTime, options.preferredAnchor)
      } else {
        updateEndBoundary(boundedTime, options.preferredAnchor)
      }
      return boundedTime
    }

    if (!shouldSkipSnap && snapMode === 'word') {
      const snappedWord = resolveWordSnapCandidate(boundary, boundedTime)
      if (snappedWord) {
        const snappedTime = snappedWord.time
        const isValid = boundary === 'in'
          ? editedEndTime - snappedTime >= 35
          : snappedTime - editedStartTime >= 35

        if (isValid) {
          setSelectedTrimWordId(snappedWord.word.id)
          const anchor: TrimBoundaryAnchor = {
            type: snappedWord.type,
            time: snappedTime,
            sourceId: snappedWord.word.id,
            label: snappedWord.word.text
          }
          if (boundary === 'in') {
            updateStartBoundary(snappedTime, anchor)
          } else {
            updateEndBoundary(snappedTime, anchor)
          }
          return snappedTime
        }
      }
    }

    if (!shouldSkipSnap && snapMode === 'frame' && frameRate) {
      const snappedTime = Math.round(boundedTime * frameRate) / frameRate
      const anchor: TrimBoundaryAnchor = {
        type: 'frame',
        time: snappedTime,
        label: `${frameRate.toFixed(3)} fps`
      }
      if (boundary === 'in') {
        updateStartBoundary(snappedTime, anchor)
      } else {
        updateEndBoundary(snappedTime, anchor)
      }
      return snappedTime
    }

    const freeAnchor: TrimBoundaryAnchor = {
      type: 'free',
      time: boundedTime
    }
    if (boundary === 'in') {
      updateStartBoundary(boundedTime, freeAnchor)
    } else {
      updateEndBoundary(boundedTime, freeAnchor)
    }
    return boundedTime
  }

  const episodeWords = allEpisodeSegments.flatMap((segment: any, segmentIndex: number) =>
    Array.isArray(segment.words)
      ? segment.words.map((word: any, wordIndex: number) => ({
          id: `${segment.id || segment.start_time || segmentIndex}-word-${wordIndex}`,
          text: String(word.word ?? '').trim(),
          start: Number(word.start),
          end: Number(word.end),
          segmentId: segment.id || `${segment.start_time}-${segment.end_time}`,
        })).filter((word: { text: string; start: number; end: number }) =>
          word.text.length > 0 && Number.isFinite(word.start) && Number.isFinite(word.end)
        )
      : []
  )
  const trimWordContextStart = Math.max(0, editedStartTime - 4)
  const trimWordContextEnd = editedEndTime + 4
  const visibleTrimWords = episodeWords.filter((word) =>
    word.end >= trimWordContextStart && word.start <= trimWordContextEnd
  )
  const activeTrimWord = visibleTrimWords.find((word) => currentTime >= word.start && currentTime <= word.end) || null
  const selectedTrimWord = visibleTrimWords.find((word) => word.id === selectedTrimWordId) || activeTrimWord || null

  const applyWordStartBoundary = (wordStart: number) => {
    if (editedEndTime - wordStart < 35) return
    const nextTime = applyBoundaryWithSnap('in', wordStart, {
      preferredAnchor: {
        type: 'word_start',
        time: wordStart,
        sourceId: selectedTrimWord?.id ?? null,
        label: selectedTrimWord?.text ?? null
      }
    })
    seekSourceVideo(nextTime)
  }

  const applyWordEndBoundary = (wordEnd: number) => {
    if (wordEnd - editedStartTime < 35) return
    const nextTime = applyBoundaryWithSnap('out', wordEnd, {
      preferredAnchor: {
        type: 'word_end',
        time: wordEnd,
        sourceId: selectedTrimWord?.id ?? null,
        label: selectedTrimWord?.text ?? null
      }
    })
    seekSourceVideo(Math.min(nextTime, editedEndTime))
  }

  const moveBoundaryBy = (deltaSeconds: number, skipSnap = false) => {
    if (selectedBoundary === 'in') {
      const nextStart = applyBoundaryWithSnap('in', editedStartTime + deltaSeconds, { skipSnap })
      seekSourceVideo(nextStart)
      return
    }

    const nextEnd = applyBoundaryWithSnap('out', editedEndTime + deltaSeconds, { skipSnap })
    seekSourceVideo(nextEnd)
  }

  const moveBoundaryToAdjacentWord = (direction: -1 | 1) => {
    if (!visibleTrimWords.length) return

    const comparisonTime = selectedBoundary === 'in' ? editedStartTime : editedEndTime
    const candidates = visibleTrimWords
      .map((word) => ({
        time: selectedBoundary === 'in' ? word.start : word.end,
        word
      }))
      .filter(({ time }) => direction < 0 ? time < comparisonTime : time > comparisonTime)
      .sort((a, b) => direction < 0 ? b.time - a.time : a.time - b.time)

    const nextCandidate = candidates[0]
    if (!nextCandidate) return

    setSelectedTrimWordId(nextCandidate.word.id)
    const nextTime = applyBoundaryWithSnap(selectedBoundary, nextCandidate.time, {
      preferredAnchor: {
        type: selectedBoundary === 'in' ? 'word_start' : 'word_end',
        time: nextCandidate.time,
        sourceId: nextCandidate.word.id,
        label: nextCandidate.word.text
      }
    })
    seekSourceVideo(nextTime)
  }

  const activeBoundaryAnchor = selectedBoundary === 'in' ? startAnchor : endAnchor
  const activeBoundaryTime = selectedBoundary === 'in' ? editedStartTime : editedEndTime
  const frameStep = frameRate && frameRate > 0 ? 1 / frameRate : 0.01
  const coarseFrameStep = frameStep * 5
  const loopPreviewHalfWindow = 0.75
  const loopPreviewStart = Math.max(0, activeBoundaryTime - loopPreviewHalfWindow)
  const loopPreviewEnd = Math.min(
    episodeDuration ?? duration ?? activeBoundaryTime + loopPreviewHalfWindow,
    activeBoundaryTime + loopPreviewHalfWindow
  )
  const nearestWordDelta = selectedTrimWord
    ? Math.min(
        Math.abs(activeBoundaryTime - selectedTrimWord.start),
        Math.abs(activeBoundaryTime - selectedTrimWord.end)
      )
    : null

  useEffect(() => {
    if (!isOpen || activeTab !== 'duration') return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return
      }

      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return

      event.preventDefault()
      const skipSnap = event.metaKey || event.ctrlKey

      if (event.altKey) {
        moveBoundaryToAdjacentWord(event.key === 'ArrowLeft' ? -1 : 1)
        return
      }

      const baseStep = event.shiftKey ? coarseFrameStep : frameStep
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      moveBoundaryBy(baseStep * direction, skipSnap)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    activeTab,
    coarseFrameStep,
    duration,
    editedEndTime,
    editedStartTime,
    episodeDuration,
    frameRate,
    frameStep,
    isOpen,
    selectedBoundary,
    visibleTrimWords
  ])

  if (!isOpen) return null

  const isPagePresentation = presentation === 'page'
  const containerClassName = isPagePresentation
    ? 'h-full w-full bg-bg-primary border border-border-default overflow-hidden flex flex-col'
    : 'absolute inset-0 legacy-editor-panel overflow-hidden flex flex-col z-[60]'
  const activeSection = EDITOR_SECTIONS.find((section) => section.id === activeTab) ?? EDITOR_SECTIONS[0]
  const clipDurationLabel = formatPreciseTime(editedEndTime - editedStartTime)
  const clipWordCount = visibleTrimWords.length
  const transcriptSegmentCount = clipTranscriptSegments.length
  const activeBoundaryLabel = selectedBoundary === 'in' ? 'Start' : 'End'
  const activeSnapLabel = snapMode === 'word' ? 'Word' : snapMode === 'frame' ? 'Frame' : 'Free'

  return (
    <div
      className={containerClassName}
      style={{
        width: '100%',
        height: '100%'
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default flex-shrink-0 w-full">
          <div className="flex items-center gap-3">
            {isPagePresentation && onBack && (
              <button
                onClick={onBack}
                className="shell-inline-button h-9"
              >
                <IoArrowBack className="text-base" />
                Back to Review
              </button>
            )}
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Edit Clip</h2>
              {isPagePresentation && (
                <p className="text-xs text-text-muted">
                  Full editor workspace for trim, transcript, captions, music, and framing.
                </p>
              )}
            </div>
          </div>
          <button
            onClick={handleClose}
            className="app-icon-button"
            aria-label={isPagePresentation ? 'Close editor' : 'Close modal'}
          >
            <IoClose className="text-xl" />
          </button>
        </div>

        {/* Main Content Area - Side by Side Layout */}
        <div className="flex-1 flex overflow-hidden min-h-0 w-full">
          {isPagePresentation && (
            <aside className="w-56 border-r border-border-default bg-bg-secondary/60 p-3 flex-shrink-0">
              <div className="space-y-1">
                <div className="px-2 pb-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Editor</div>
                  <div className="mt-2 text-lg font-semibold text-text-primary">{activeSection.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {activeSection.description}
                  </p>
                </div>

                {EDITOR_SECTIONS.map((section) => {
                  const isActive = activeTab === section.id

                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveTab(section.id)}
                      className={`legacy-editor-nav-button px-3 py-3 text-left ${isActive ? 'is-active' : ''}`}
                    >
                      <div className="text-sm font-medium">{section.label}</div>
                      <div className="mt-1 text-xs text-text-muted">{section.description}</div>
                    </button>
                  )
                })}
              </div>
            </aside>
          )}

          <div className="flex min-w-0 flex-1 overflow-hidden">
          {/* Left Panel: Tabs and Content */}
          <div className={`flex flex-col min-h-0 ${isPagePresentation ? 'flex-1' : 'flex-shrink-0'}`} style={isPagePresentation ? undefined : { width: '75%' }}>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)} className="flex-1 flex flex-col min-h-0">
              {/* Tab Navigation */}
              {!isPagePresentation && (
                <TabsList className="w-full justify-center bg-bg-primary border-b border-border-default rounded-none h-auto p-0">
                  <TabsTrigger value="duration" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Duration
                  </TabsTrigger>
                  <TabsTrigger value="transcript" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Transcript
                  </TabsTrigger>
                  <TabsTrigger value="captions" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Captions
                  </TabsTrigger>
                  <TabsTrigger value="logo" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Logo
                  </TabsTrigger>
                  <TabsTrigger value="music" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Music
                  </TabsTrigger>
                  <TabsTrigger value="frame" className="data-[state=active]:bg-transparent data-[state=active]:text-accent-primary data-[state=active]:border-b-2 data-[state=active]:border-accent-primary rounded-none">
                    Frame
                  </TabsTrigger>
                </TabsList>
              )}

              {/* Tab Content */}
              <TabsContent value="duration" className="flex-1 px-4 py-4 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-bold text-text-primary mb-1">
                      {isPagePresentation ? 'Trim' : 'Duration & Boundaries'}
                    </h3>
                    <p className="text-xs text-text-muted">
                      {isPagePresentation
                        ? 'Use the overview timeline for rough edits, then open precision controls only when you need exact placement.'
                        : 'Play the video, pause where you want to trim, then click the trim buttons'}
                    </p>
                  </div>

                  {/* Trim Controls - Compact */}
                  <div className="flex items-center justify-between gap-3 p-3 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-lg border border-border-default shadow-sm">
                    <Button
                      onClick={() => {
                        const absoluteTime = currentTime
                        if (editedEndTime - absoluteTime >= 35) {
                          applyBoundaryWithSnap('in', absoluteTime)
                        } else {
                          alert('Clip must be at least 35 seconds long. Move forward in the video first.')
                        }
                      }}
                      variant="outline"
                      size="sm"
                      disabled={editedEndTime - currentTime < 35}
                      className="border-green-200 bg-green-50 hover:bg-green-100 text-green-700 hover:text-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="mr-1.5">◀</span>
                      <span className="font-medium">Trim Left</span>
                    </Button>

                    <div className="text-center px-3">
                      <div className="text-xs text-text-muted">Playhead</div>
                      <div className="text-lg font-mono font-bold text-accent-primary">
                        {formatPreciseTime(currentTime)}
                      </div>
                      <div className="text-xs text-text-muted">
                        clip-relative {formatPreciseTime(clipRelativeCurrentTime)}
                      </div>
                      {!isPagePresentation && (
                        <div className="text-xs text-text-muted">
                          {frameRate ? `${frameRate.toFixed(3)} fps` : '10ms nudge fallback'}
                        </div>
                      )}
                    </div>

                    <Button
                      onClick={() => {
                        const absoluteTime = currentTime
                        if (absoluteTime - editedStartTime >= 35) {
                          applyBoundaryWithSnap('out', absoluteTime)
                        } else {
                          alert('Clip must be at least 35 seconds long. Move backward in the video first.')
                        }
                      }}
                      variant="outline"
                      size="sm"
                      disabled={currentTime - editedStartTime < 35}
                      className="border-red-200 bg-red-50 hover:bg-red-100 text-red-700 hover:text-red-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="font-medium">Trim Right</span>
                      <span className="ml-1.5">▶</span>
                    </Button>
                  </div>

                  {/* Extended Timeline - Shows ±20s Context */}
                  {episodeDuration && (() => {
                    const contextPadding = 20 // seconds
                    const timelineStart = Math.max(0, editedStartTime - contextPadding)
                    const timelineEnd = Math.min(episodeDuration, editedEndTime + contextPadding)
                    const timelineExtent = timelineEnd - timelineStart

                    // Calculate positions relative to extended timeline
                    const clipStartPercent = ((editedStartTime - timelineStart) / timelineExtent) * 100
                    const clipEndPercent = ((editedEndTime - timelineStart) / timelineExtent) * 100
                    const playheadPercent = ((currentTime - timelineStart) / timelineExtent) * 100

                    return (
                      <div className="space-y-3">
                        <div
                          className="relative h-20 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-xl border-2 border-border-default overflow-hidden cursor-pointer shadow-md hover:shadow-lg transition-shadow duration-200 group"
                          onClick={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect()
                            const x = e.clientX - rect.left
                            const percentage = x / rect.width

                            // Calculate absolute time in episode from extended timeline
                            const absoluteTime = timelineStart + (percentage * timelineExtent)

                            seekSourceVideo(absoluteTime)
                          }}
                        >
                          {/* Subtle grid pattern */}
                          <div className="absolute inset-0 opacity-20" style={{
                            backgroundImage: 'linear-gradient(90deg, rgba(0,0,0,.03) 1px, transparent 1px)',
                            backgroundSize: '20px 100%'
                          }} />

                          {/* Context region - before clip */}
                          <div
                            className="absolute top-0 bottom-0 bg-slate-200/40 dark:bg-slate-700/40"
                            style={{
                              left: '0%',
                              width: `${clipStartPercent}%`
                            }}
                          />

                          {/* Active clip region - highlighted */}
                          <div
                            className="absolute top-0 bottom-0 bg-gradient-to-r from-accent-primary/10 via-accent-primary/20 to-accent-primary/10 border-l-2 border-r-2 border-accent-primary/50"
                            style={{
                              left: `${clipStartPercent}%`,
                              width: `${clipEndPercent - clipStartPercent}%`
                            }}
                          >
                            {/* Clip duration label */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-accent-primary/90 text-white text-xs font-bold px-2 py-1 rounded shadow-lg">
                              {formatTime(editedEndTime - editedStartTime)}
                            </div>
                          </div>

                          {/* Context region - after clip */}
                          <div
                            className="absolute top-0 bottom-0 bg-slate-200/40 dark:bg-slate-700/40"
                            style={{
                              left: `${clipEndPercent}%`,
                              width: `${100 - clipEndPercent}%`
                            }}
                          />

                          {/* Playhead with glow */}
                          <div
                            className="absolute top-0 bottom-0 w-1 bg-white shadow-2xl z-20 transition-all duration-75"
                            style={{
                              left: `${playheadPercent}%`,
                              boxShadow: '0 0 20px rgba(255,255,255,0.5), 0 0 40px rgba(59,130,246,0.3)'
                            }}
                          >
                            {/* Playhead handle */}
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-10 bg-white rounded-md border-2 border-accent-primary shadow-xl backdrop-blur-sm">
                              <div className="absolute inset-0 bg-gradient-to-b from-accent-primary/20 to-transparent rounded-md" />
                            </div>
                          </div>

                          {/* Start marker */}
                          <div
                            className="absolute top-0 bottom-0 w-1.5 bg-gradient-to-b from-green-400 to-green-600 shadow-lg z-10"
                            style={{ left: `${clipStartPercent}%` }}
                          >
                            <div className="absolute -top-2 left-0 text-xs font-bold text-white bg-gradient-to-r from-green-500 to-green-600 px-2 py-0.5 rounded-tr-md rounded-br-md shadow-md whitespace-nowrap">
                              START
                            </div>
                          </div>

                          {/* End marker */}
                          <div
                            className="absolute top-0 bottom-0 w-1.5 bg-gradient-to-b from-red-400 to-red-600 shadow-lg z-10"
                            style={{ left: `${clipEndPercent}%` }}
                          >
                            <div className="absolute -top-2 right-0 text-xs font-bold text-white bg-gradient-to-r from-red-600 to-red-500 px-2 py-0.5 rounded-tl-md rounded-bl-md shadow-md whitespace-nowrap">
                              END
                            </div>
                          </div>

                          {/* Time markers */}
                          <div className="absolute bottom-2 left-0 right-0 flex justify-between px-3 text-xs font-medium text-text-muted/80">
                            <span>{formatTime(timelineStart)}</span>
                            <span className="opacity-60">Context: ±{contextPadding}s</span>
                            <span>{formatTime(timelineEnd)}</span>
                          </div>

                          {/* Hover hint */}
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
                            <div className="bg-black/70 text-white text-xs px-3 py-1.5 rounded-full backdrop-blur-sm">
                              Click to seek
                            </div>
                          </div>
                        </div>

                        <p className="text-xs text-center text-text-muted">
                          <span className="opacity-60">Gray regions show available context</span> •
                          <span className="text-accent-primary font-medium mx-1">Highlighted area</span>
                          <span className="opacity-60">is your clip</span>
                        </p>
                      </div>
                    )
                  })()}

                  {visibleTrimWords.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-border-default" />
                        <h4 className="text-sm font-semibold text-text-primary">
                          {isPagePresentation ? 'Transcript Context' : 'Word Boundaries'}
                        </h4>
                        <div className="h-px flex-1 bg-border-default" />
                      </div>

                      <div className="p-4 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-xl border border-border-default shadow-sm space-y-3">
                        <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
                          <span>
                            {isPagePresentation
                              ? 'Select nearby words when you want to snap a boundary to spoken content.'
                              : 'Click a word to target an exact trim anchor from Whisper timing.'}
                          </span>
                          {activeTrimWord && (
                            <span className="font-mono text-accent-primary">
                              Playhead: "{activeTrimWord.text}" at {formatPreciseTime(activeTrimWord.start)}
                            </span>
                          )}
                        </div>

                        <div className="max-h-36 overflow-y-auto rounded-lg border border-border-default bg-bg-primary/70 p-3">
                          <div className="flex flex-wrap gap-2">
                            {visibleTrimWords.map((word) => {
                              const isSelected = selectedTrimWord?.id === word.id
                              const isActive = activeTrimWord?.id === word.id
                              const isInsideClip = word.start >= editedStartTime && word.end <= editedEndTime

                              return (
                                <button
                                  key={word.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTrimWordId(word.id)
                                    seekSourceVideo(word.start)
                                  }}
                                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                                    isSelected
                                      ? 'border-accent-primary bg-accent-primary text-white'
                                      : isActive
                                        ? 'border-accent-primary/60 bg-accent-primary/10 text-accent-primary'
                                        : isInsideClip
                                          ? 'border-green-300 bg-green-50 text-green-800'
                                          : 'border-border-default bg-bg-secondary text-text-secondary hover:border-accent-primary/40 hover:text-text-primary'
                                  }`}
                                  title={`${word.text} • ${formatPreciseTime(word.start)} - ${formatPreciseTime(word.end)}`}
                                >
                                  {word.text}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {selectedTrimWord && (
                          <div className="flex items-center justify-between gap-4 rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                            <div className="space-y-1">
                              <div className="text-sm font-semibold text-text-primary">
                                "{selectedTrimWord.text}"
                              </div>
                              <div className="text-xs font-mono text-text-muted">
                                start {formatPreciseTime(selectedTrimWord.start)} • end {formatPreciseTime(selectedTrimWord.end)}
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applyWordStartBoundary(selectedTrimWord.start)}
                                disabled={editedEndTime - selectedTrimWord.start < 35}
                                className="border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                              >
                                Set Start To Word
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => applyWordEndBoundary(selectedTrimWord.end)}
                                disabled={selectedTrimWord.end - editedStartTime < 35}
                                className="border-red-300 bg-red-50 text-red-700 hover:bg-red-100"
                              >
                                Set End After Word
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Live Transcript Preview */}
                  {allEpisodeSegments.length > 0 && (() => {
                    // Calculate absolute playhead position in episode
                    const absolutePlayheadTime = currentTime

                    // Find current, previous, and next segments
                    const currentSegmentIndex = allEpisodeSegments.findIndex((seg: any) =>
                      absolutePlayheadTime >= seg.start_time && absolutePlayheadTime <= seg.end_time
                    )

                    const currentSegment = currentSegmentIndex >= 0 ? allEpisodeSegments[currentSegmentIndex] : null
                    const previousSegment = currentSegmentIndex > 0 ? allEpisodeSegments[currentSegmentIndex - 1] : null
                    const nextSegment = currentSegmentIndex >= 0 && currentSegmentIndex < allEpisodeSegments.length - 1
                      ? allEpisodeSegments[currentSegmentIndex + 1]
                      : null

                    return (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-border-default" />
                          <h4 className="text-sm font-semibold text-text-primary">
                            {isPagePresentation ? 'Context Around Playhead' : 'Live Transcript'}
                          </h4>
                          <div className="h-px flex-1 bg-border-default" />
                        </div>

                        <div className="p-4 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-xl border border-border-default shadow-sm space-y-2">
                          {/* Previous Line */}
                          {previousSegment ? (
                            <div className="flex items-start gap-2 opacity-60 transition-opacity">
                              <div className="flex-shrink-0 w-1 h-1 mt-2 rounded-full bg-text-muted" />
                              <div className="flex-1">
                                <p className="text-sm text-text-muted leading-relaxed">
                                  {previousSegment.text}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 opacity-40">
                              <div className="flex-1 text-center">
                                <p className="text-xs text-text-muted italic">Start of content</p>
                              </div>
                            </div>
                          )}

                          {/* Current Line - Highlighted */}
                          {currentSegment ? (
                            <div className="flex items-start gap-2 p-3 bg-accent-primary/10 border-l-4 border-accent-primary rounded-r-lg">
                              <div className="flex-shrink-0 text-accent-primary mt-0.5">▶</div>
                              <div className="flex-1">
                                <p className="text-base font-medium text-text-primary leading-relaxed">
                                  {currentSegment.text}
                                </p>
                                <p className="text-xs text-text-muted mt-1 font-mono">
                                  {formatTime(currentSegment.start_time)} - {formatTime(currentSegment.end_time)}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 p-3 bg-bg-tertiary rounded-lg">
                              <div className="flex-1 text-center">
                                <p className="text-sm text-text-muted italic">No active segment</p>
                              </div>
                            </div>
                          )}

                          {/* Next Line */}
                          {nextSegment ? (
                            <div className="flex items-start gap-2 opacity-60 transition-opacity">
                              <div className="flex-shrink-0 w-1 h-1 mt-2 rounded-full bg-text-muted" />
                              <div className="flex-1">
                                <p className="text-sm text-text-muted leading-relaxed">
                                  {nextSegment.text}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2 opacity-40">
                              <div className="flex-1 text-center">
                                <p className="text-xs text-text-muted italic">End of content</p>
                              </div>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-center text-text-muted italic">
                          Watch and listen to find the perfect trim point
                        </p>
                      </div>
                    )
                  })()}

                  {/* Preview Changes Button */}
                  {(editedStartTime !== clipData.startTime || editedEndTime !== clipData.endTime) && (
                    <div className="flex justify-center">
                      <div className="flex gap-2">
                        <Button
                          onClick={() => {
                            setIsLoopPreviewEnabled(false)
                            seekSourceVideo(editedStartTime)
                            videoRef.current?.play().catch(error => console.error('Failed to preview trim boundaries:', error))
                          }}
                          variant="secondary"
                          size="sm"
                          className="flex items-center space-x-2"
                          disabled={loading}
                        >
                          <span>{loading ? 'Loading...' : '🔄 Preview Boundaries'}</span>
                        </Button>
                        <Button
                          onClick={() => {
                            const nextEnabled = !isLoopPreviewEnabled
                            setIsLoopPreviewEnabled(nextEnabled)
                            if (!nextEnabled) return
                            seekSourceVideo(loopPreviewStart)
                            videoRef.current?.play().catch(error => console.error('Failed to start loop preview:', error))
                          }}
                          variant={isLoopPreviewEnabled ? 'default' : 'outline'}
                          size="sm"
                          disabled={loading}
                        >
                          {isLoopPreviewEnabled ? 'Loop Preview On' : 'Loop Active Boundary'}
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Time Display - Always Visible */}
                  {!isPagePresentation && (
                  <div className="p-5 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-xl border border-border-default shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-8">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">Start</div>
                          <div className="text-xl font-mono font-bold text-green-600 dark:text-green-500">{formatPreciseTime(editedStartTime)}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">End</div>
                          <div className="text-xl font-mono font-bold text-red-600 dark:text-red-500">{formatPreciseTime(editedEndTime)}</div>
                        </div>
                        <div className="space-y-1 pl-8 border-l-2 border-border-default">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">Duration</div>
                          <div className="text-xl font-mono font-bold text-accent-primary">{formatPreciseTime(editedEndTime - editedStartTime)}</div>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowManualInputs(!showManualInputs)}
                        className="text-xs hover:bg-bg-tertiary"
                      >
                        <span className="mr-1">Advanced</span>
                        <span className="text-base transition-transform duration-200" style={{
                          transform: showManualInputs ? 'rotate(90deg)' : 'rotate(0deg)'
                        }}>▶</span>
                      </Button>
                    </div>

                    {/* Manual Time Input - Collapsible */}
                    {showManualInputs && (
                      <div className="mt-4 pt-4 border-t border-border-default grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-text-muted block mb-1.5">Start Time (seconds)</label>
                          <input
                            type="number"
                            min={0}
                            max={editedEndTime - 35}
                            step={0.01}
                            value={editedStartTime.toFixed(2)}
                            onChange={(e) => {
                              const newStart = parseFloat(e.target.value)
                              if (newStart >= 0 && editedEndTime - newStart >= 35) {
                                applyBoundaryWithSnap('in', newStart)
                              }
                            }}
                            className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                          />
                        </div>
                        <div>
                          <label className="text-xs text-text-muted block mb-1.5">End Time (seconds)</label>
                          <input
                            type="number"
                            min={editedStartTime + 35}
                            max={episodeDuration || undefined}
                            step={0.01}
                            value={editedEndTime.toFixed(2)}
                            onChange={(e) => {
                              const newEnd = parseFloat(e.target.value)
                              if (newEnd - editedStartTime >= 35) {
                                applyBoundaryWithSnap('out', newEnd)
                              }
                            }}
                            className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {isPagePresentation ? (
                    <div className="rounded-xl border border-border-default bg-bg-secondary/70 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setShowPrecisionDetails((current) => !current)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                      >
                        <div>
                          <div className="text-sm font-semibold text-text-primary">Precision Controls</div>
                          <div className="text-xs text-text-muted">
                            {activeBoundaryLabel} boundary, {activeSnapLabel.toLowerCase()} snap
                          </div>
                        </div>
                        <span
                          className="text-base text-text-muted transition-transform duration-200"
                          style={{ transform: showPrecisionDetails ? 'rotate(90deg)' : 'rotate(0deg)' }}
                        >
                          ▶
                        </span>
                      </button>

                      {showPrecisionDetails && (
                        <div className="space-y-3 border-t border-border-default px-4 py-4">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-text-primary">Boundary Inspector</div>
                            <div className="flex flex-wrap gap-2 justify-end">
                              <button
                                type="button"
                                onClick={() => setSelectedBoundary('in')}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  selectedBoundary === 'in'
                                    ? 'bg-green-600 text-white'
                                    : 'bg-green-50 text-green-700 border border-green-200'
                                }`}
                              >
                                Inspect Start
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedBoundary('out')}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  selectedBoundary === 'out'
                                    ? 'bg-red-600 text-white'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                              >
                                Inspect End
                              </button>
                              <button
                                type="button"
                                onClick={() => setSnapMode('word')}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  snapMode === 'word'
                                    ? 'bg-accent-primary text-white'
                                    : 'bg-bg-primary text-text-secondary border border-border-default'
                                }`}
                              >
                                Word Snap
                              </button>
                              <button
                                type="button"
                                onClick={() => setSnapMode('frame')}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  snapMode === 'frame'
                                    ? 'bg-accent-primary text-white'
                                    : 'bg-bg-primary text-text-secondary border border-border-default'
                                }`}
                              >
                                Frame Snap
                              </button>
                              <button
                                type="button"
                                onClick={() => setSnapMode('free')}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                  snapMode === 'free'
                                    ? 'bg-accent-primary text-white'
                                    : 'bg-bg-primary text-text-secondary border border-border-default'
                                }`}
                              >
                                Free
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                              <div className="text-xs uppercase tracking-wide text-text-muted">Timestamp</div>
                              <div className="mt-1 font-mono text-base text-text-primary">{formatPreciseTime(activeBoundaryTime)}</div>
                            </div>
                            <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                              <div className="text-xs uppercase tracking-wide text-text-muted">Anchor</div>
                              <div className="mt-1 text-base font-medium text-text-primary">
                                {activeBoundaryAnchor?.label || activeBoundaryAnchor?.type || 'Free placement'}
                              </div>
                            </div>
                            <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                              <div className="text-xs uppercase tracking-wide text-text-muted">Word Delta</div>
                              <div className="mt-1 font-mono text-base text-text-primary">
                                {nearestWordDelta !== null ? `${nearestWordDelta.toFixed(3)}s` : 'Unavailable'}
                              </div>
                            </div>
                            <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                              <div className="text-xs uppercase tracking-wide text-text-muted">Frame Step</div>
                              <div className="mt-1 font-mono text-base text-text-primary">
                                {frameRate ? `${frameStep.toFixed(4)}s / frame` : '0.0100s fallback'}
                              </div>
                            </div>
                            <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3 col-span-2">
                              <div className="text-xs uppercase tracking-wide text-text-muted">Keyboard</div>
                              <div className="mt-1 text-sm text-text-primary">
                                Left/Right: 1 frame. Shift+Left/Right: 5 frames. Alt+Left/Right: previous/next word boundary. Hold Cmd/Ctrl to bypass snapping.
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                  <div className="p-4 bg-bg-secondary rounded-xl border border-border-default shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-sm font-semibold text-text-primary">Boundary Inspector</h4>
                      <div className="flex flex-wrap gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setSelectedBoundary('in')}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selectedBoundary === 'in'
                              ? 'bg-green-600 text-white'
                              : 'bg-green-50 text-green-700 border border-green-200'
                          }`}
                        >
                          Inspect Start
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedBoundary('out')}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            selectedBoundary === 'out'
                              ? 'bg-red-600 text-white'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}
                        >
                          Inspect End
                        </button>
                        <button
                          type="button"
                          onClick={() => setSnapMode('word')}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            snapMode === 'word'
                              ? 'bg-accent-primary text-white'
                              : 'bg-bg-primary text-text-secondary border border-border-default'
                          }`}
                        >
                          Word Snap
                        </button>
                        <button
                          type="button"
                          onClick={() => setSnapMode('frame')}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            snapMode === 'frame'
                              ? 'bg-accent-primary text-white'
                              : 'bg-bg-primary text-text-secondary border border-border-default'
                          }`}
                        >
                          Frame Snap
                        </button>
                        <button
                          type="button"
                          onClick={() => setSnapMode('free')}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            snapMode === 'free'
                              ? 'bg-accent-primary text-white'
                              : 'bg-bg-primary text-text-secondary border border-border-default'
                          }`}
                        >
                          Free
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Timestamp</div>
                        <div className="mt-1 font-mono text-base text-text-primary">{formatPreciseTime(activeBoundaryTime)}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Anchor Type</div>
                        <div className="mt-1 text-base font-medium text-text-primary">
                          {activeBoundaryAnchor?.type ?? 'free'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Snap Mode</div>
                        <div className="mt-1 text-base font-medium text-text-primary">
                          {snapMode}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Anchor Label</div>
                        <div className="mt-1 text-base text-text-primary">
                          {activeBoundaryAnchor?.label || 'No label'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Nearest Word Delta</div>
                        <div className="mt-1 font-mono text-base text-text-primary">
                          {nearestWordDelta !== null ? `${nearestWordDelta.toFixed(3)}s` : 'Unavailable'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Nudge</div>
                        <div className="mt-1 font-mono text-base text-text-primary">
                          {frameRate ? `${frameStep.toFixed(4)}s / frame` : '0.0100s fallback'}
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3 col-span-2">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Keyboard</div>
                        <div className="mt-1 text-sm text-text-primary">
                          Left/Right: 1 frame. Shift+Left/Right: 5 frames. Alt+Left/Right: previous/next word boundary. Hold Cmd/Ctrl to bypass snapping.
                        </div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-primary/80 px-4 py-3 col-span-2">
                        <div className="text-xs uppercase tracking-wide text-text-muted">Loop Preview</div>
                        <div className="mt-1 text-sm text-text-primary">
                          {isLoopPreviewEnabled
                            ? `Looping ${formatPreciseTime(loopPreviewStart)} to ${formatPreciseTime(loopPreviewEnd)} around the active boundary.`
                            : `Preview window ready: ${formatPreciseTime(loopPreviewStart)} to ${formatPreciseTime(loopPreviewEnd)}.`}
                        </div>
                      </div>
                    </div>
                  </div>
                  )}

                </div>
              </TabsContent>

              <TabsContent value="transcript" className="flex-1 px-4 py-5 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-base font-semibold text-text-primary mb-1">Edit Transcript</h3>
                    <p className="text-xs text-text-muted">
                      Click on highlighted text (within clip boundaries) to edit. Changes save automatically.
                    </p>
                  </div>

                  {clipTranscriptSegments.length > 0 ? (
                    <div className="max-h-[500px] overflow-y-auto p-2.5 bg-bg-tertiary rounded-lg border border-border-default space-y-0.5">
                      {clipTranscriptSegments.map((segment: any, index: number) => {
                        const segmentId = `${segment.start_time}-${index}`
                        const currentText = editedTranscriptSegments.get(segmentId) ?? segment.text

                        // Determine if segment is inside, before, or after clip
                        const isInClip = segment.start_time >= editedStartTime && segment.end_time <= editedEndTime
                        const isBeforeClip = segment.end_time < editedStartTime
                        const isAfterClip = segment.start_time > editedEndTime

                        // Find first in-clip segment for auto-scroll
                        const isFirstClipSegment = isInClip && !clipTranscriptSegments.slice(0, index).some((s: any) =>
                          s.start_time >= editedStartTime && s.end_time <= editedEndTime
                        )

                        return (
                          <div
                            key={segmentId}
                            ref={isFirstClipSegment ? firstClipSegmentRef : null}
                            className={`text-xs py-0.5 px-1.5 rounded ${
                              isInClip
                                ? 'bg-accent-primary/10 text-text-primary font-medium'
                                : isBeforeClip || isAfterClip
                                ? 'text-text-muted opacity-60'
                                : 'text-text-secondary'
                            }`}
                          >
                            <span className="text-xs font-mono text-text-muted mr-2">
                              [{formatTime(segment.start_time)}]
                            </span>
                            {isInClip ? (
                              <Textarea
                                value={currentText}
                                onChange={(e) => handleTranscriptEdit(segmentId, e.target.value)}
                                onBlur={() => handleTranscriptBlur(segmentId, index)}
                                rows={1}
                                className="inline-block h-auto min-h-0 w-full resize-none font-normal bg-transparent border border-transparent p-0 m-0 leading-none focus:bg-background/50 focus:outline-none focus:border-accent-primary/30 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 rounded text-xs align-top"
                                placeholder="Transcript text..."
                              />
                            ) : (
                              <span className="inline">{segment.text}</span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="p-8 bg-bg-tertiary rounded-lg border border-border-default text-center">
                      <p className="text-sm text-text-secondary">
                        No transcript segments found for this episode
                      </p>
                      <p className="text-xs text-text-muted mt-1">
                        Process an episode to see transcript
                      </p>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="captions" className="flex-1 px-4 py-5 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <CaptionStyleEditor
                  clipId={clipId}
                  transcriptSegments={clipTranscriptSegments
                    .filter((seg: any) => seg.start_time >= editedStartTime && seg.end_time <= editedEndTime)
                    .map((seg: any) => ({
                      text: seg.text,
                      start: seg.start_time - editedStartTime,
                      end: seg.end_time - editedStartTime
                    }))}
                  currentStyle={captionStyle}
                  onStyleChange={(style) => {
                    console.log('[ClipEditModal] Caption style changed, updating state:', style)
                    setCaptionStyle(style)
                    setHasUnsavedChanges(true)
                    console.log('[ClipEditModal] hasUnsavedChanges set to true')
                  }}
                />
              </TabsContent>

              <TabsContent value="logo" className="flex-1 px-4 py-5 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <LogoEditor
                  clipId={clipId}
                  currentSettings={logoSettings}
                  onSettingsChange={(settings) => {
                    setLogoSettings(settings)
                    setHasUnsavedChanges(true)
                  }}
                />
              </TabsContent>

              <TabsContent value="music" className="flex-1 px-4 py-5 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <MusicEditor
                  clipId={clipId}
                  currentSettings={musicSettings}
                  onSettingsChange={(settings) => {
                    setMusicSettings(settings)
                    setHasUnsavedChanges(true)
                  }}
                />
              </TabsContent>

              <TabsContent value="frame" className="flex-1 px-4 py-5 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <FrameEditor
                  clipId={clipId}
                  currentSettings={frameSettings}
                  onSettingsChange={(settings) => {
                    setFrameSettings(settings)
                    setHasUnsavedChanges(true)
                  }}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* Right Panel: Video Preview */}
          <div className={`border-l border-border-default bg-bg-secondary flex flex-col ${isPagePresentation ? 'w-[360px] p-3' : 'items-center justify-center p-4 flex-shrink-0'}`} style={isPagePresentation ? undefined : { width: '25%' }}>
          {isPagePresentation && (
            <div className="legacy-editor-panel mb-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Current Tool</div>
                  <div className="mt-1 text-lg font-semibold text-text-primary">{activeSection.label}</div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{activeSection.description}</p>
                </div>
                <div className={`legacy-editor-status-pill ${hasUnsavedChanges ? 'is-dirty' : 'is-clean'}`}>
                  {hasUnsavedChanges ? 'Unsaved' : 'Saved'}
                </div>
              </div>
            </div>
          )}
          <div
            ref={videoContainerRef}
            className="legacy-editor-panel relative overflow-hidden flex items-center justify-center"
            style={{
              aspectRatio: frameSettings?.aspectRatio || '9/16',
              width: '100%',
              maxHeight: isPagePresentation ? '420px' : '100%'
            }}
          >
            {/* Loading Overlay - shows even when no media source yet */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center text-white bg-black/70 z-10">
                Loading video...
              </div>
            )}
            {frameSettings?.cropMode === 'fit' && (
              <>
                {isVideoMetadataLoading && (
                  <div className="absolute inset-0 flex items-center justify-center text-white bg-black/70 z-10">
                    Loading video dimensions...
                  </div>
                )}
                {!isVideoMetadataLoading && !videoMetadata && (
                  <div className="absolute inset-0 flex items-center justify-center text-white bg-black/70 z-10 text-center px-4">
                    {videoMetadataError || 'Video dimensions unavailable. Canvas Fit preview is disabled.'}
                  </div>
                )}
              </>
            )}

            {/* Hidden audio element for music playback */}
            <audio ref={audioRef} style={{ display: 'none' }} />

              {/* Always render video if we have a media source */}
              {mediaSourceUrl ? (
                <>
                  {/* Blur background layer (only for blur mode) */}
                  {frameSettings?.cropMode === 'blur' && (
                    <video
                      ref={blurVideoRef}
                      src={mediaSourceUrl}
                      className="absolute inset-0 w-full h-full"
                      style={{
                        objectFit: 'cover',
                        filter: 'blur(40px)',
                        opacity: 0.5,
                        transform: 'scale(1.1)', // Slight scale to hide blur edges
                        zIndex: 0
                      }}
                      muted
                      autoPlay={false}
                    />
                  )}

                  <video
                    ref={videoRef}
                    src={mediaSourceUrl}
                    className="absolute"
                    controls={false}
                    onLoadedMetadata={(e) => {
                      if (videoMetadata) return

                      const vid = e.currentTarget
                      if (vid.videoWidth && vid.videoHeight) {
                        console.log('[ClipEditModal] Video metadata fallback from element:', vid.videoWidth, 'x', vid.videoHeight)
                        setVideoMetadata({ width: vid.videoWidth, height: vid.videoHeight })
                        setIsVideoMetadataLoading(false)
                        setVideoMetadataError(null)
                      }
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return

                      if (frameSettings?.cropMode === 'center') {
                        e.preventDefault()
                        setIsDraggingCrop(true)
                      } else if (frameSettings?.cropMode === 'fit') {
                        if (!videoMetadata || isVideoMetadataLoading) return
                        e.preventDefault()
                        setIsDraggingVideo(true)
                        setDragStart({ x: e.clientX, y: e.clientY })
                      }
                    }}
                    style={(() => {
                      const baseStyle: React.CSSProperties = {
                        zIndex: 1
                      }

                      if (!frameSettings) {
                        return baseStyle
                      }

                      if (frameSettings.cropMode === 'center') {
                        return {
                          ...baseStyle,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          objectPosition: `${frameSettings.cropPositionX ?? 50}% ${frameSettings.cropPositionY ?? 50}%`,
                          transform: `scale(${frameSettings.zoomLevel ?? 1})`,
                          cursor: isDraggingCrop ? 'grabbing' : 'grab',
                          border: isDraggingCrop ? '2px dashed rgba(59, 130, 246, 0.5)' : 'none'
                        }
                      }

                      if (frameSettings.cropMode === 'fit') {
                        const container = videoContainerRef.current
                        if (!videoMetadata || !container) {
                          return {
                            ...baseStyle,
                            width: '100%',
                            height: 'auto',
                            opacity: isVideoMetadataLoading ? 0 : 1,
                            pointerEvents: isVideoMetadataLoading ? 'none' : 'auto'
                          }
                        }

                        const zoom = frameSettings.zoomLevel ?? 1
                        const resolution = getAspectResolution(frameSettings.aspectRatio)
                        const previewScaleX = container.offsetWidth / resolution.width || 1
                        const previewScaleY = container.offsetHeight / resolution.height || 1
                        const offsetXOutput = (frameSettings.videoOffsetX ?? 0) * previewScaleX
                        const offsetYOutput = (frameSettings.videoOffsetY ?? 0) * previewScaleY

                        return {
                          ...baseStyle,
                          position: 'absolute',
                          width: '100%',
                          height: 'auto',
                          top: '50%',
                          left: '50%',
                          transformOrigin: 'center center',
                          transform: `translate(-50%, -50%) translate(${offsetXOutput}px, ${offsetYOutput}px) scale(${zoom})`,
                          cursor: isDraggingVideo ? 'grabbing' : 'grab'
                        }
                      }

                      // blur/default fallback
                      return {
                        ...baseStyle,
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain'
                      }
                    })()}
                  />
                  {captionStyle?.enabled && !loading && (() => {
                    // Get clip-relative segments for caption display
                    const clipRelativeSegments = clipTranscriptSegments
                      .filter((seg: any) => seg.start_time >= editedStartTime && seg.end_time <= editedEndTime)
                      .map((seg: any) => ({
                        text: seg.text,
                        start: seg.start_time - editedStartTime,
                        end: seg.end_time - editedStartTime
                      }))

                    // Find active segment based on current video time
                    const activeSegment = clipRelativeSegments.find(
                      (seg: any) => clipRelativeCurrentTime >= seg.start && clipRelativeCurrentTime <= seg.end
                    )

                    if (!activeSegment) return null

                    // Helper function to transform text based on textCase setting
                    const transformText = (text: string) => {
                      if (captionStyle.textCase === 'uppercase') return text.toUpperCase()
                      if (captionStyle.textCase === 'lowercase') return text.toLowerCase()
                      return text
                    }

                    // Calculate word-level display based on highlight style
                    const renderCaption = () => {
                      const words = activeSegment.text.split(' ')
                      const segmentDuration = activeSegment.end - activeSegment.start
                      const timeInSegment = clipRelativeCurrentTime - activeSegment.start

                      if (captionStyle.highlightStyle === 'word') {
                        // Word-by-word: show N words at a time based on wordsPerCaption setting
                        const avgTimePerWord = segmentDuration / words.length
                        const currentWordIndex = Math.floor(timeInSegment / avgTimePerWord)
                        const wordsPerCaption = captionStyle.wordsPerCaption || 3

                        // Show current word plus additional words based on setting
                        const wordsToShow = words.slice(
                          currentWordIndex,
                          Math.min(words.length, currentWordIndex + wordsPerCaption)
                        )

                        // If only showing 1 word, keep it fully highlighted (opacity 1)
                        // If showing 2+ words, use word-by-word highlighting
                        return wordsToShow.map((word: string, idx: number) => {
                          const isActive = idx === 0 // First word in the slice is always the "current" word
                          const shouldHighlight = wordsPerCaption === 1 || isActive

                          return (
                            <span
                              key={idx}
                              style={{
                                opacity: shouldHighlight ? 1 : 0.6,
                                display: 'inline-block',
                                marginRight: '0.25em',
                                transition: 'opacity 0.1s'
                              }}
                            >
                              {transformText(word)}
                            </span>
                          )
                        })
                      } else if (captionStyle.highlightStyle === 'phrase') {
                        // Full sentence: show entire segment
                        return transformText(activeSegment.text)
                      } else {
                        // No highlight: show entire segment without effects
                        return transformText(activeSegment.text)
                      }
                    }

                    // Calculate position based on preset or custom
                    const getPositionStyle = () => {
                      if (captionStyle.position === 'custom' && captionStyle.customX !== undefined && captionStyle.customY !== undefined) {
                        return {
                          left: `${captionStyle.customX}%`,
                          top: `${captionStyle.customY}%`,
                          transform: 'translate(-50%, -50%)'
                        }
                      } else if (captionStyle.position === 'top') {
                        return { top: '8%', left: '50%', transform: 'translateX(-50%)' }
                      } else if (captionStyle.position === 'center') {
                        return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
                      } else {
                        // bottom is default
                        return { bottom: '8%', left: '50%', transform: 'translateX(-50%)' }
                      }
                    }

                    const handleCaptionMouseDown = (e: React.MouseEvent) => {
                      if (e.button !== 0) return // Only left click
                      e.preventDefault()
                      e.stopPropagation()
                      setIsDraggingCaption(true)
                    }

                    return (
                      <div
                        className="absolute pointer-events-auto group"
                        style={{
                          ...getPositionStyle(),
                          cursor: isDraggingCaption ? 'grabbing' : 'grab',
                          zIndex: 30,
                          width: `${captionStyle.maxWidth * 0.8}%`, // Scale width for preview (80% of set value)
                          padding: '8px'
                        }}
                        onMouseDown={handleCaptionMouseDown}
                      >
                        {/* Drag handle indicator - visible on hover */}
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 px-2 py-1 rounded text-white text-xs whitespace-nowrap pointer-events-none">
                          ⇕ Drag to reposition
                        </div>

                        <div
                          style={{
                            fontFamily: captionStyle.font,
                            fontSize: `${Math.max(captionStyle.size * 0.25, 8)}px`, // Scale down for small preview
                            color: captionStyle.color,
                            fontWeight: captionStyle.weight || 400,
                            fontStyle: captionStyle.italic ? 'italic' : 'normal',
                            textShadow: captionStyle.shadow ? '1px 1px 2px rgba(0,0,0,0.8)' : 'none',
                            WebkitTextStroke: captionStyle.outline ? `${Math.max(captionStyle.outlineWidth * 0.25, 0.5)}px ${captionStyle.outlineColor}` : '0px transparent',
                            paintOrder: 'stroke fill',
                            backgroundColor: captionStyle.background ? captionStyle.backgroundColor : 'transparent',
                            backgroundClip: captionStyle.background ? 'padding-box' : undefined,
                            padding: captionStyle.background ? '4px 8px' : '6px 8px',
                            borderRadius: captionStyle.background ? '4px' : '4px',
                            width: '100%',
                            textAlign: 'center',
                            userSelect: 'none',
                            border: isDraggingCaption ? '2px dashed rgba(59, 130, 246, 0.7)' : '2px solid transparent',
                            boxSizing: 'border-box',
                            wordWrap: 'break-word',
                            overflowWrap: 'break-word',
                            boxShadow: isDraggingCaption ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
                            lineHeight: captionStyle.lineHeight,
                            letterSpacing: `${captionStyle.letterSpacing * 0.25}px` // Scale down letter spacing for preview
                          }}
                          className="transition-all group-hover:border-white/30 group-hover:bg-black/10"
                        >
                          {renderCaption()}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Logo Overlay */}
                  {logoSettings?.enabled && logoSettings.logoPath && !loading && (
                    <div
                      className="absolute pointer-events-auto group"
                      style={{
                        left: `${logoSettings.positionX}%`,
                        top: `${logoSettings.positionY}%`,
                        transform: 'translate(-50%, -50%)',
                        cursor: isDraggingLogo ? 'grabbing' : 'grab',
                        zIndex: 25,
                        width: `${logoSettings.scale * 100}%`
                      }}
                      onMouseDown={(e) => {
                        if (e.button === 0) {
                          e.preventDefault()
                          e.stopPropagation()
                          setIsDraggingLogo(true)
                        }
                      }}
                    >
                      {/* Drag handle indicator - visible on hover */}
                      <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 px-2 py-1 rounded text-white text-xs whitespace-nowrap pointer-events-none z-50">
                        ⇕ Drag to reposition
                      </div>

                      <img
                        src={`app-file://${logoSettings.logoPath}`}
                        alt="Logo"
                        style={{
                          width: '100%',
                          height: 'auto',
                          opacity: logoSettings.opacity,
                          userSelect: 'none',
                          pointerEvents: 'none',
                          border: isDraggingLogo ? '2px dashed rgba(59, 130, 246, 0.5)' : 'none',
                          borderRadius: '4px'
                        }}
                        draggable={false}
                      />
                    </div>
                  )}

                  {/* Music Indicator */}
                  {musicSettings?.enabled && musicSettings?.musicPath && !loading && (
                    <div className="absolute top-4 left-4 flex items-center space-x-2 bg-black/50 px-3 py-2 rounded-full" style={{ zIndex: 40 }}>
                      <IoMusicalNotesOutline className="text-white text-lg" />
                      <span className="text-white text-xs">
                        {isPlaying ? 'Playing' : 'Ready'}
                      </span>
                    </div>
                  )}

                  {/* Frame Settings Indicator */}
                  {frameSettings && !loading && (
                    <div className="absolute bottom-20 left-4 flex items-center space-x-2 bg-black/70 px-3 py-1.5 rounded" style={{ zIndex: 40 }}>
                      <IoCropOutline className="text-white text-sm" />
                      <span className="text-white text-xs font-medium">
                        {frameSettings.aspectRatio}
                      </span>
                      <span className="text-white/60 text-xs">•</span>
                      <span className="text-white text-xs">
                        {frameSettings.cropMode === 'center' && 'Center Crop'}
                        {frameSettings.cropMode === 'fit' && 'Scale to Fit'}
                        {frameSettings.cropMode === 'blur' && 'Blur BG'}
                      </span>
                    </div>
                  )}

                  {/* Play/Pause Overlay */}
                  {!loading && (
                    <div className="absolute top-4 right-4" style={{ zIndex: 40 }}>
                      <button
                        onClick={togglePlayPause}
                        className="w-12 h-12 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center transition-colors"
                      >
                        {isPlaying ? (
                          <span className="text-white text-2xl">⏸</span>
                        ) : (
                          <span className="text-white text-2xl ml-1">▶</span>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Seek Bar */}
                  {!loading && (
                    <div className="absolute bottom-4 left-4 right-4 bg-black/50 rounded-lg p-2" style={{ zIndex: 40 }}>
                      <div className="text-white text-xs mb-1 text-center">
                        {formatPreciseTime(clipRelativeCurrentTime)} / {formatPreciseTime(editedEndTime - editedStartTime)}
                      </div>
                      <input
                        type="range"
                        min={editedStartTime}
                        max={editedEndTime}
                        step={0.01}
                        value={Math.max(editedStartTime, Math.min(currentTime, editedEndTime))}
                        onChange={(e) => {
                          seekSourceVideo(parseFloat(e.target.value))
                        }}
                        className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                      />
                    </div>
                  )}
                </>
              ) : !loading && (
                <div className="w-full h-full flex items-center justify-center text-white">
                  Failed to load video
                </div>
              )}
            </div>

            {isPagePresentation && (
              <div className="legacy-editor-panel mt-3 flex-1 overflow-y-auto p-3">
                <div className="space-y-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Clip Summary</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Start</div>
                        <div className="mt-1 font-mono text-sm text-text-primary">{formatPreciseTime(editedStartTime)}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">End</div>
                        <div className="mt-1 font-mono text-sm text-text-primary">{formatPreciseTime(editedEndTime)}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Duration</div>
                        <div className="mt-1 font-mono text-sm text-text-primary">{clipDurationLabel}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Words</div>
                        <div className="mt-1 text-sm text-text-primary">{clipWordCount}</div>
                      </div>
                    </div>
                  </div>

                  {activeTab === 'duration' && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Trim Inspector</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Editing Boundary</div>
                        <div className="mt-1 text-sm font-medium text-text-primary">{activeBoundaryLabel}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Snap Mode</div>
                        <div className="mt-1 text-sm font-medium text-text-primary">{activeSnapLabel}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Anchor</div>
                        <div className="mt-1 text-sm text-text-primary">{activeBoundaryAnchor?.label || activeBoundaryAnchor?.type || 'Free placement'}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Loop Preview</div>
                        <div className="mt-1 text-sm text-text-primary">{isLoopPreviewEnabled ? 'On' : 'Off'}</div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'transcript' && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Transcript</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Editable Segments</div>
                        <div className="mt-1 text-sm text-text-primary">{transcriptSegmentCount}</div>
                      </div>
                      <p className="text-sm leading-relaxed text-text-secondary">
                        Correct transcript text here before caption styling or export.
                      </p>
                    </div>
                  )}

                  {activeTab === 'captions' && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Caption Status</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Enabled</div>
                        <div className="mt-1 text-sm text-text-primary">{captionStyle?.enabled ? 'Yes' : 'No'}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Style</div>
                        <div className="mt-1 text-sm text-text-primary">{captionStyle?.highlightStyle || 'word'}</div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'logo' && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Logo</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Status</div>
                        <div className="mt-1 text-sm text-text-primary">{logoSettings?.enabled ? 'Enabled' : 'Disabled'}</div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'music' && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Music</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Status</div>
                        <div className="mt-1 text-sm text-text-primary">{musicSettings?.enabled ? 'Enabled' : 'Disabled'}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Ducking</div>
                        <div className="mt-1 text-sm text-text-primary">{musicSettings?.duckEnabled ? 'On' : 'Off'}</div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'frame' && frameSettings && (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Frame</div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Aspect Ratio</div>
                        <div className="mt-1 text-sm text-text-primary">{frameSettings.aspectRatio}</div>
                      </div>
                      <div className="rounded-lg border border-border-default bg-bg-secondary/70 px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-text-muted">Crop Mode</div>
                        <div className="mt-1 text-sm text-text-primary">{frameSettings.cropMode}</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border-default bg-bg-secondary flex-shrink-0 w-full">
          <div>
            <Button
              onClick={handleApplyToAll}
              disabled={saving}
              variant="secondary"
              size="sm"
              className="flex items-center space-x-2"
            >
              <IoCopyOutline />
              <span>Apply to All</span>
            </Button>
          </div>

          <div className="flex items-center space-x-3">
            {isPagePresentation && (
              <div className="hidden text-xs text-text-muted md:block">
                {activeSection.shortLabel} workspace
              </div>
            )}
            <Button onClick={handleClose} variant="secondary">
              {isPagePresentation ? 'Back' : 'Cancel'}
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center space-x-2"
            >
              {justSaved ? <IoCheckmarkCircle /> : <IoSaveOutline />}
              <span>{saving ? 'Saving...' : justSaved ? 'Saved!' : 'Save Changes'}</span>
            </Button>
          </div>
        </div>
    </div>
  )
}
