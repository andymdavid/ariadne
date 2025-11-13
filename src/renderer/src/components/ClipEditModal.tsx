import React, { useEffect, useRef, useState } from 'react'
import { IoClose, IoSaveOutline, IoCopyOutline, IoMusicalNotesOutline, IoCropOutline, IoCheckmarkCircle } from 'react-icons/io5'
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'
import { CaptionStyleEditor, CaptionStyle } from './CaptionStyleEditor'
import { LogoEditor, LogoSettings } from './LogoEditor'
import { MusicEditor, MusicSettings } from './MusicEditor'
import { FrameEditor } from './FrameEditor'
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
}

type EditorTab = 'duration' | 'transcript' | 'captions' | 'logo' | 'music' | 'frame'

const clampZoom = (value?: number) => Math.max(0.5, Math.min(4, value ?? 1))

export function ClipEditModal({
  isOpen,
  clipId,
  episodeId,
  clipData,
  onClose,
  onSave
}: ClipEditModalProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('duration')
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [clipPath, setClipPath] = useState<string | null>(null)
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
  const [showManualInputs, setShowManualInputs] = useState(false)
  const [allEpisodeSegments, setAllEpisodeSegments] = useState<any[]>([])

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
      loadClipVideo()
      loadCaptionStyle()
      loadLogoSettings()
      loadMusicSettings()
      loadFrameSettings()
    }
  }, [isOpen, clipId])

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
        // Set default logo settings if no edits exist
        setLogoSettings({
          enabled: false,
          logoPath: null,
          positionX: 85,
          positionY: 85,
          scale: 0.15,
          opacity: 0.8
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
      if (existingEdits) {
        setMusicSettings({
          enabled: existingEdits.music_enabled === 1,
          musicPath: existingEdits.music_path || null,
          volume: existingEdits.music_volume ?? 0.3,
          duckVolume: existingEdits.music_duck_volume ?? 0.1,
          duckEnabled: existingEdits.music_duck_enabled === 1,
          fadeIn: existingEdits.music_fade_in ?? 1.0,
          fadeOut: existingEdits.music_fade_out ?? 1.0,
          loop: existingEdits.music_loop === 1
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
        // Set default frame settings if no edits exist
        console.log('[ClipEditModal] No existing edits, using defaults')
        setFrameSettings({ ...DEFAULT_FRAME_SETTINGS })
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
      audio.play().catch(err => console.error('Failed to play audio:', err))
    }

    const handleVideoPause = () => {
      audio.pause()
    }

    const handleVideoSeeked = () => {
      // Sync audio time with video time
      audio.currentTime = video.currentTime
    }

    video.addEventListener('play', handleVideoPlay)
    video.addEventListener('pause', handleVideoPause)
    video.addEventListener('seeked', handleVideoSeeked)

    return () => {
      video.removeEventListener('play', handleVideoPlay)
      video.removeEventListener('pause', handleVideoPause)
      video.removeEventListener('seeked', handleVideoSeeked)
    }
  }, [musicSettings?.enabled, musicSettings?.musicPath])

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

    const isDuringSpeech = clipRelativeSegments.some((seg: any) => {
      const segmentStart = seg.start_time - editedStartTime
      const segmentEnd = seg.end_time - editedStartTime
      return currentTime >= segmentStart && currentTime <= segmentEnd
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
        // Set default caption style
        console.log('[ClipEditModal] No existing edits, using defaults')
        const defaultStyle = {
          enabled: true,
          font: 'Inter',
          size: 48,
          color: '#FFFFFF',
          position: 'bottom',
          customX: undefined,
          customY: undefined,
          bold: true,
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
    if (!video || !clipPath) return

    const handleTimeUpdate = () => setCurrentTime(video.currentTime)
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      setLoading(false)
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
  }, [clipPath])

  const loadClipVideo = async (useEditedTimes = false) => {
    try {
      console.log('loadClipVideo called, useEditedTimes:', useEditedTimes)
      setLoading(true)
      setClipPath(null) // Reset clip path to clear any previous video

      const startTime = useEditedTimes ? editedStartTime : clipData.startTime
      const endTime = useEditedTimes ? editedEndTime : clipData.endTime

      console.log('Calling playClip with:', { episodeId, startTime, endTime, clipId })

      const result = await window.electronAPI?.playClip?.(
        episodeId,
        startTime,
        endTime,
        clipId
      )

      console.log('playClip result:', result)

      if (result?.clipPath) {
        const fullPath = `app-file://${result.clipPath}`
        console.log('Setting clipPath to:', fullPath)
        setClipPath(fullPath)
      } else {
        console.warn('No clipPath in result, stopping loading')
        setLoading(false)
      }
    } catch (error) {
      console.error('Failed to load clip video:', error)
      setLoading(false)
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

  const buildEditsObject = (targetClipId: string, targetStartTime: number, targetEndTime: number) => {
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

  if (!isOpen) return null

  return (
    <div
      className="absolute inset-0 bg-bg-primary rounded-xl border border-border-default shadow-2xl overflow-hidden flex flex-col z-[60]"
      style={{
        width: '100%',
        height: '100%'
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default flex-shrink-0 w-full">
          <h2 className="text-lg font-semibold text-text-primary">Edit Clip</h2>
          <button
            onClick={handleClose}
            className="w-8 h-8 rounded-full bg-bg-tertiary hover:bg-hover-bg flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
          >
            <IoClose className="text-xl" />
          </button>
        </div>

        {/* Main Content Area - Side by Side Layout */}
        <div className="flex-1 flex overflow-hidden min-h-0 w-full">
          {/* Left Panel: Tabs and Content (75%) */}
          <div className="flex flex-col min-h-0 flex-shrink-0" style={{ width: '75%' }}>
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)} className="flex-1 flex flex-col min-h-0">
              {/* Tab Navigation */}
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

              {/* Tab Content */}
              <TabsContent value="duration" className="flex-1 px-4 py-4 overflow-y-auto mt-0 data-[state=inactive]:hidden">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-base font-bold text-text-primary mb-1">Duration & Boundaries</h3>
                    <p className="text-xs text-text-muted">
                      Play the video, pause where you want to trim, then click the trim buttons
                    </p>
                  </div>

                  {/* Trim Controls - Compact */}
                  <div className="flex items-center justify-between gap-3 p-3 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-lg border border-border-default shadow-sm">
                    <Button
                      onClick={() => {
                        const absoluteTime = editedStartTime + currentTime
                        if (editedEndTime - absoluteTime >= 35) {
                          setEditedStartTime(absoluteTime)
                          setHasUnsavedChanges(true)
                        } else {
                          alert('Clip must be at least 35 seconds long. Move forward in the video first.')
                        }
                      }}
                      variant="outline"
                      size="sm"
                      disabled={editedEndTime - (editedStartTime + currentTime) < 35}
                      className="border-green-200 bg-green-50 hover:bg-green-100 text-green-700 hover:text-green-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span className="mr-1.5">◀</span>
                      <span className="font-medium">Trim Left</span>
                    </Button>

                    <div className="text-center px-3">
                      <div className="text-xs text-text-muted">Playhead</div>
                      <div className="text-lg font-mono font-bold text-accent-primary">
                        {formatTime(currentTime)}
                      </div>
                      <div className="text-xs text-text-muted">
                        of {formatTime(editedEndTime - editedStartTime)}
                      </div>
                    </div>

                    <Button
                      onClick={() => {
                        const absoluteTime = editedStartTime + currentTime
                        if (absoluteTime - editedStartTime >= 35) {
                          setEditedEndTime(absoluteTime)
                          setHasUnsavedChanges(true)
                        } else {
                          alert('Clip must be at least 35 seconds long. Move backward in the video first.')
                        }
                      }}
                      variant="outline"
                      size="sm"
                      disabled={editedStartTime + currentTime - editedStartTime < 35}
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
                    const playheadPercent = ((editedStartTime + currentTime - timelineStart) / timelineExtent) * 100

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

                            // Convert to clip-relative time
                            const clipRelativeTime = absoluteTime - editedStartTime

                            // Seek video to this position (clamped to clip bounds)
                            if (videoRef.current) {
                              videoRef.current.currentTime = Math.max(0, Math.min(clipRelativeTime, editedEndTime - editedStartTime))
                            }
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

                  {/* Live Transcript Preview */}
                  {allEpisodeSegments.length > 0 && (() => {
                    // Calculate absolute playhead position in episode
                    const absolutePlayheadTime = editedStartTime + currentTime

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
                          <h4 className="text-sm font-semibold text-text-primary">Live Transcript</h4>
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
                      <Button
                        onClick={() => loadClipVideo(true)}
                        variant="secondary"
                        size="sm"
                        className="flex items-center space-x-2"
                        disabled={loading}
                      >
                        <span>{loading ? 'Loading...' : '🔄 Preview Changes'}</span>
                      </Button>
                    </div>
                  )}

                  {/* Time Display - Always Visible */}
                  <div className="p-5 bg-gradient-to-br from-bg-secondary to-bg-tertiary rounded-xl border border-border-default shadow-sm">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-8">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">Start</div>
                          <div className="text-xl font-mono font-bold text-green-600 dark:text-green-500">{formatTime(editedStartTime)}</div>
                        </div>
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">End</div>
                          <div className="text-xl font-mono font-bold text-red-600 dark:text-red-500">{formatTime(editedEndTime)}</div>
                        </div>
                        <div className="space-y-1 pl-8 border-l-2 border-border-default">
                          <div className="text-xs font-medium text-text-muted uppercase tracking-wide">Duration</div>
                          <div className="text-xl font-mono font-bold text-accent-primary">{formatTime(editedEndTime - editedStartTime)}</div>
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
                            step={0.1}
                            value={editedStartTime.toFixed(1)}
                            onChange={(e) => {
                              const newStart = parseFloat(e.target.value)
                              if (newStart >= 0 && editedEndTime - newStart >= 35) {
                                setEditedStartTime(newStart)
                                setHasUnsavedChanges(true)
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
                            step={0.1}
                            value={editedEndTime.toFixed(1)}
                            onChange={(e) => {
                              const newEnd = parseFloat(e.target.value)
                              if (newEnd - editedStartTime >= 35) {
                                setEditedEndTime(newEnd)
                                setHasUnsavedChanges(true)
                              }
                            }}
                            className="w-full px-3 py-2 bg-bg-primary border border-border-default rounded text-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent-primary"
                          />
                        </div>
                      </div>
                    )}
                  </div>

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

          {/* Right Panel: Video Preview (25%) */}
          <div className="border-l border-border-default bg-bg-secondary flex flex-col items-center justify-center p-4 flex-shrink-0" style={{ width: '25%' }}>
          <div
            ref={videoContainerRef}
            className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center"
            style={{
              aspectRatio: frameSettings?.aspectRatio || '9/16',
              width: '100%',
              maxHeight: '100%'
            }}
          >
            {/* Loading Overlay - shows even when no clipPath yet */}
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

              {/* Always render video if we have a clipPath */}
              {clipPath ? (
                <>
                  {/* Blur background layer (only for blur mode) */}
                  {frameSettings?.cropMode === 'blur' && (
                    <video
                      ref={blurVideoRef}
                      src={clipPath}
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
                    src={clipPath}
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
                      (seg: any) => currentTime >= seg.start && currentTime <= seg.end
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
                      const timeInSegment = currentTime - activeSegment.start

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
                        return wordsToShow.map((word, idx) => {
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
                        {formatTime(currentTime)} / {formatTime(duration)}
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        value={currentTime}
                        onChange={(e) => {
                          if (videoRef.current) {
                            videoRef.current.currentTime = parseFloat(e.target.value)
                          }
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
            <Button onClick={handleClose} variant="secondary">
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className={`flex items-center space-x-2 transition-colors ${
                justSaved ? 'bg-green-600 hover:bg-green-700' : ''
              }`}
            >
              {justSaved ? <IoCheckmarkCircle /> : <IoSaveOutline />}
              <span>{saving ? 'Saving...' : justSaved ? 'Saved!' : 'Save Changes'}</span>
            </Button>
          </div>
        </div>
    </div>
  )
}
