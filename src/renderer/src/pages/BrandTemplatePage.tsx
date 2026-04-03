import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  IoAddOutline,
  IoCloudUploadOutline,
  IoChevronDown,
  IoChevronForward,
  IoGridOutline,
  IoImagesOutline,
  IoMusicalNotes,
  IoMusicalNotesOutline,
  IoResizeOutline,
  IoScanOutline,
  IoSquareOutline,
  IoTextOutline,
  IoTrashOutline
} from 'react-icons/io5'
import type { BrandTemplate, BrandTemplatePreset } from '@shared/types'
import { MainContentPanel } from '../components/MainContentPanel'

const captionPresets = [
  {
    id: 'none',
    label: 'No captions',
    text: '',
    font: 'Inter',
    fontWeight: '700' as const,
    highlightColor: '#111111',
    backgroundColor: '#ffffff'
  },
  {
    id: 'karaoke',
    label: 'Karaoke',
    text: 'TO GET STARTED',
    font: 'Inter',
    fontWeight: '800' as const,
    highlightColor: '#ffffff',
    backgroundColor: '#111111'
  },
  {
    id: 'beasty',
    label: 'Beasty',
    text: 'Build clips that hook fast',
    font: 'Inter',
    fontWeight: '800' as const,
    highlightColor: '#111111',
    backgroundColor: '#ffffff'
  },
  {
    id: 'deep-diver',
    label: 'Deep Diver',
    text: 'One Line',
    font: 'Inter',
    fontWeight: '700' as const,
    highlightColor: '#111111',
    backgroundColor: '#ffffff'
  },
  {
    id: 'youshaei',
    label: 'Youshaei',
    text: 'TO GET STARTED',
    font: 'Inter',
    fontWeight: '700' as const,
    highlightColor: '#59f0c2',
    backgroundColor: '#111111'
  },
  {
    id: 'pod-p',
    label: 'Pod P',
    text: 'TO GET',
    font: 'Inter',
    fontWeight: '800' as const,
    highlightColor: '#ff4fe1',
    backgroundColor: '#111111'
  }
] as const

const captionFontOptions = [
  'Inter',
  'Poppins',
  'Montserrat',
  'Oswald',
  'Anton',
  'Bebas Neue',
  'Archivo Black',
  'Barlow Condensed'
] as const
const captionTabOptions = ['presets', 'font', 'effects'] as const
const captionPositionOptions = [
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'custom', label: 'Custom' }
] as const

const aspectRatioOptions: Array<BrandTemplate['frame']['aspectRatio']> = ['9:16', '1:1', '16:9']

const cropModeOptions: Array<{
  value: BrandTemplate['frame']['cropMode']
  label: string
  icon: typeof IoResizeOutline
}> = [
  { value: 'fit', label: 'Fill', icon: IoResizeOutline },
  { value: 'center', label: 'Center', icon: IoScanOutline },
  { value: 'blur', label: 'Blur', icon: IoGridOutline }
]

const cropModeSummaryLabel: Record<BrandTemplate['frame']['cropMode'], string> = {
  fit: 'fill',
  center: 'center',
  blur: 'blur'
}

const SAFE_AREA_PERCENT = 6
const CENTER_SNAP_THRESHOLD_PERCENT = 2.5

const defaultBrandTemplate: BrandTemplate = {
  caption: {
    presetId: 'deep-diver',
    text: 'One Line',
    font: 'Inter',
    fontSize: 30,
    fontWeight: '700',
    italic: false,
    underline: false,
    uppercase: false,
    position: 'bottom',
    customX: null,
    customY: null,
    animation: 'box',
    lineMode: 'one-line',
    backgroundEnabled: true,
    highlightColor: '#111111',
    backgroundColor: '#ffffff',
    backgroundPaddingX: 24,
    backgroundPaddingY: 12,
    backgroundRadius: 16,
    strokeColor: '#000000',
    strokeWidth: 0,
    shadowEnabled: false,
    shadowColor: '#000000',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    shadowBlur: 0
  },
  logo: {
    enabled: false,
    assetPath: null,
    positionX: 84,
    positionY: 12,
    scale: 0.18,
    opacity: 0.9
  },
  music: {
    enabled: false,
    assetPath: null,
    volume: 0.3,
    duckEnabled: true
  },
  introOutro: {
    introPath: null,
    outroPath: null
  },
  frame: {
    aspectRatio: '9:16',
    cropMode: 'fit'
  },
  ai: {
    removeFillerWords: false,
    removePauses: false,
    keywordHighlighter: false,
    emojis: true,
    stockBroll: false
  },
  updatedAt: new Date().toISOString()
}

export function BrandTemplatePage() {
  const [template, setTemplate] = useState<BrandTemplate | null>(null)
  const [presets, setPresets] = useState<BrandTemplatePreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string>('')
  const [logos, setLogos] = useState<string[]>([])
  const [musicTracks, setMusicTracks] = useState<string[]>([])
  const [activeMenu, setActiveMenu] = useState<'layout' | 'caption' | 'overlay' | 'intro-outro' | 'music' | null>(null)
  const [activeCaptionTab, setActiveCaptionTab] = useState<(typeof captionTabOptions)[number]>('presets')
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [showSavedState, setShowSavedState] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDraggingCaption, setIsDraggingCaption] = useState(false)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const [isResizingLogo, setIsResizingLogo] = useState(false)
  const [isLogoSelected, setIsLogoSelected] = useState(false)
  const [dragGuides, setDragGuides] = useState({ horizontal: false, vertical: false })
  const [isPresetMenuOpen, setIsPresetMenuOpen] = useState(false)
  const [isDemoPlaying, setIsDemoPlaying] = useState(false)
  const [demoPhase, setDemoPhase] = useState<'intro' | 'demo' | 'outro'>('demo')
  const [captionWordIndex, setCaptionWordIndex] = useState(0)
  const [demoProgress, setDemoProgress] = useState(0)
  const previewRef = useRef<HTMLDivElement>(null)
  const presetMenuRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const demoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const savedStateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void loadPageState()
  }, [])

  useEffect(() => {
    return () => {
      clearDemoTimers()
      stopMediaPlayback()
      if (savedStateTimeoutRef.current) {
        clearTimeout(savedStateTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !template) return

    audio.volume = template.music.volume

    if (!template.music.enabled || !template.music.assetPath) {
      audio.pause()
      audio.currentTime = 0
      return
    }

    if (isDemoPlaying && audio.paused) {
      void audio.play().catch(() => {
        // Ignore autoplay failures; visual preview should still continue.
      })
    }
  }, [isDemoPlaying, template?.music.assetPath, template?.music.enabled, template?.music.volume, template])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!presetMenuRef.current) return
      if (!presetMenuRef.current.contains(event.target as Node)) {
        setIsPresetMenuOpen(false)
      }
    }

    if (isPresetMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isPresetMenuOpen])

  useEffect(() => {
    if (!template) return

    const getSnappedPosition = (rawX: number, rawY: number, bounds: { minX: number; maxX: number; minY: number; maxY: number }) => {
      const vertical = Math.abs(rawX - 50) <= CENTER_SNAP_THRESHOLD_PERCENT
      const horizontal = Math.abs(rawY - 50) <= CENTER_SNAP_THRESHOLD_PERCENT

      setDragGuides({ horizontal, vertical })

      return {
        x: clamp(vertical ? 50 : rawX, bounds.minX, bounds.maxX),
        y: clamp(horizontal ? 50 : rawY, bounds.minY, bounds.maxY)
      }
    }

    const handleMouseMove = (event: MouseEvent) => {
      if (!previewRef.current) return

      const rect = previewRef.current.getBoundingClientRect()
      const rawX = ((event.clientX - rect.left) / rect.width) * 100
      const rawY = ((event.clientY - rect.top) / rect.height) * 100

      if (isDraggingCaption) {
        const nextPosition = getSnappedPosition(rawX, rawY, {
          minX: SAFE_AREA_PERCENT,
          maxX: 100 - SAFE_AREA_PERCENT,
          minY: SAFE_AREA_PERCENT,
          maxY: 100 - SAFE_AREA_PERCENT
        })

        setTemplate((current) =>
          current
            ? {
                ...current,
                caption: {
                  ...current.caption,
                  position: 'custom',
                  customX: nextPosition.x,
                  customY: nextPosition.y
                }
              }
            : current
        )
      }

      if (isDraggingLogo) {
        const nextPosition = getSnappedPosition(rawX, rawY, {
          minX: SAFE_AREA_PERCENT,
          maxX: 100 - SAFE_AREA_PERCENT,
          minY: SAFE_AREA_PERCENT,
          maxY: 100 - SAFE_AREA_PERCENT
        })

        setTemplate((current) =>
          current
            ? {
                ...current,
                logo: {
                  ...current.logo,
                  positionX: nextPosition.x,
                  positionY: nextPosition.y
                }
              }
            : current
        )
      }

      if (isResizingLogo && template?.logo.enabled && template.logo.assetPath) {
        const centerX = rect.left + (rect.width * template.logo.positionX) / 100
        const centerY = rect.top + (rect.height * template.logo.positionY) / 100
        const halfSizePx = Math.max(
          Math.abs(event.clientX - centerX),
          Math.abs(event.clientY - centerY)
        )
        const nextScale = clamp((halfSizePx * 2) / rect.width, 0.08, 0.62)

        setTemplate((current) =>
          current
            ? {
                ...current,
                logo: {
                  ...current.logo,
                  scale: nextScale
                }
              }
            : current
        )
      }
    }

    const handleMouseUp = () => {
      if (isDraggingCaption || isDraggingLogo || isResizingLogo) {
        setIsDraggingCaption(false)
        setIsDraggingLogo(false)
        setIsResizingLogo(false)
        setDragGuides({ horizontal: false, vertical: false })
        void persistTemplate()
      }
    }

    if (isDraggingCaption || isDraggingLogo || isResizingLogo) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingCaption, isDraggingLogo, isResizingLogo, template])

  const selectedCaptionPreset =
    captionPresets.find((preset) => preset.id === template?.caption.presetId) ?? captionPresets[3]
  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? null

  const applyTemplateState = (resolvedTemplate: BrandTemplate) => {
    setTemplate({
      ...defaultBrandTemplate,
      ...resolvedTemplate,
      caption: {
        ...defaultBrandTemplate.caption,
        ...resolvedTemplate.caption
      },
      logo: {
        ...defaultBrandTemplate.logo,
        ...resolvedTemplate.logo
      },
      music: {
        ...defaultBrandTemplate.music,
        ...resolvedTemplate.music
      },
      introOutro: {
        ...defaultBrandTemplate.introOutro,
        ...resolvedTemplate.introOutro
      },
      frame: {
        ...defaultBrandTemplate.frame,
        ...resolvedTemplate.frame
      },
      ai: {
        ...defaultBrandTemplate.ai,
        ...resolvedTemplate.ai
      }
    })
  }

  const loadPageState = async () => {
    try {
      setIsLoading(true)
      setLoadError(null)

      const [loadedTemplate, loadedConfig, presetState, loadedLogos, loadedMusic] = await Promise.all([
        window.electronAPI?.getBrandTemplate?.() ?? Promise.resolve(undefined),
        window.electronAPI?.getConfig?.() ?? Promise.resolve(undefined),
        window.electronAPI?.getBrandTemplatePresets?.() ?? Promise.resolve({ presets: [], activePresetId: '' }),
        window.electronAPI?.listLogos?.() ?? Promise.resolve([]),
        window.electronAPI?.listMusic?.() ?? Promise.resolve([])
      ])

      const resolvedTemplate = loadedTemplate ?? loadedConfig?.brandTemplate ?? defaultBrandTemplate
      const resolvedPresets =
        presetState.presets.length > 0
          ? presetState.presets
          : [
              {
                id: 'default-preset',
                name: 'Preset template 1',
                template: resolvedTemplate,
                createdAt: resolvedTemplate.updatedAt,
                updatedAt: resolvedTemplate.updatedAt
              }
            ]

      applyTemplateState(resolvedTemplate)
      setPresets(resolvedPresets)
      setActivePresetId(presetState.activePresetId || resolvedPresets[0]?.id || '')
      setLogos(loadedLogos ?? [])
      setMusicTracks(loadedMusic ?? [])
    } catch (error) {
      console.error('Failed to load brand template:', error)
      applyTemplateState(defaultBrandTemplate)
      setPresets([
        {
          id: 'default-preset',
          name: 'Preset template 1',
          template: defaultBrandTemplate,
          createdAt: defaultBrandTemplate.updatedAt,
          updatedAt: defaultBrandTemplate.updatedAt
        }
      ])
      setActivePresetId('default-preset')
      setLoadError(error instanceof Error ? error.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }

  const persistTemplate = async (nextTemplate?: BrandTemplate) => {
    const payload = nextTemplate ?? template
    if (!payload) return

    try {
      setIsSaving(true)
      const saved = await window.electronAPI?.updateBrandTemplate?.(payload)
      if (saved) {
        applyTemplateState(saved)
        setShowSavedState(true)
        if (savedStateTimeoutRef.current) {
          clearTimeout(savedStateTimeoutRef.current)
        }
        savedStateTimeoutRef.current = setTimeout(() => {
          setShowSavedState(false)
        }, 1600)
      }
    } catch (error) {
      console.error('Failed to save brand template:', error)
    } finally {
      setIsSaving(false)
    }
  }

  const updateFrame = (updates: Partial<BrandTemplate['frame']>) => {
    if (!template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      frame: {
        ...template.frame,
        ...updates
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const updateCaption = (updates: Partial<BrandTemplate['caption']>) => {
    if (!template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      caption: {
        ...template.caption,
        ...updates
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const updateLogo = (updates: Partial<BrandTemplate['logo']>) => {
    if (!template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      logo: {
        ...template.logo,
        ...updates
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const updateIntroOutro = (updates: Partial<BrandTemplate['introOutro']>) => {
    if (!template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      introOutro: {
        ...template.introOutro,
        ...updates
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const updateMusic = (updates: Partial<BrandTemplate['music']>) => {
    if (!template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      music: {
        ...template.music,
        ...updates
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const handleCreatePreset = async () => {
    try {
      const response = await window.electronAPI?.createBrandTemplatePreset?.()
      if (!response) return
      setPresets(response.presets)
      setActivePresetId(response.activePresetId)
      applyTemplateState(response.brandTemplate)
      setIsPresetMenuOpen(true)
    } catch (error) {
      console.error('Failed to create brand template preset:', error)
    }
  }

  const handleSelectPreset = async (presetId: string) => {
    if (!presetId || presetId === activePresetId) return

    try {
      const response = await window.electronAPI?.setActiveBrandTemplatePreset?.(presetId)
      if (!response) return
      setPresets(response.presets)
      setActivePresetId(response.activePresetId)
      applyTemplateState(response.brandTemplate)
      setIsPresetMenuOpen(false)
    } catch (error) {
      console.error('Failed to switch brand template preset:', error)
    }
  }

  const handleDeletePreset = async (presetId: string) => {
    try {
      const response = await window.electronAPI?.deleteBrandTemplatePreset?.(presetId)
      if (!response) return
      setPresets(response.presets)
      setActivePresetId(response.activePresetId)
      applyTemplateState(response.brandTemplate)
      setIsPresetMenuOpen(true)
    } catch (error) {
      console.error('Failed to delete brand template preset:', error)
    }
  }

  const handleSavePreset = async () => {
    if (!template) return
    await persistTemplate(template)
  }

  const pickIntroOutroFile = async (kind: 'introPath' | 'outroPath') => {
    const filePath = await window.electronAPI?.selectFile?.()
    if (!filePath) return
    updateIntroOutro({ [kind]: filePath } as Partial<BrandTemplate['introOutro']>)
  }

  const clearDemoTimers = () => {
    if (demoTimeoutRef.current) {
      clearTimeout(demoTimeoutRef.current)
      demoTimeoutRef.current = null
    }
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current)
      demoIntervalRef.current = null
    }
  }

  const stopMediaPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.currentTime = 0
    }
  }

  const stopDemoPlayback = () => {
    clearDemoTimers()
    stopMediaPlayback()
    setIsDemoPlaying(false)
    setDemoPhase('demo')
    setCaptionWordIndex(0)
    setDemoProgress(0)
  }

  const startDemoPhase = () => {
    clearDemoTimers()
    setDemoPhase('demo')
    setDemoProgress(0)
    setCaptionWordIndex(0)

    const words = getCaptionWords(template?.caption ?? defaultBrandTemplate.caption)
    const stepCount = Math.max(words.length, 1)
    let currentStep = 0
    const demoDurationMs = 5000
    const stepIntervalMs = Math.max(Math.floor(demoDurationMs / stepCount), 1)

    demoIntervalRef.current = setInterval(() => {
      currentStep += 1
      setCaptionWordIndex(Math.min(currentStep, Math.max(words.length - 1, 0)))
      setDemoProgress(Math.min((currentStep / stepCount) * 100, 100))
    }, stepIntervalMs)

    demoTimeoutRef.current = setTimeout(() => {
      clearDemoTimers()
      if (template?.introOutro.outroPath) {
        setDemoPhase('outro')
        setDemoProgress(100)
        const video = videoRef.current
        if (video) {
          video.currentTime = 0
          void video.play().catch(() => {
            stopDemoPlayback()
          })
        } else {
          stopDemoPlayback()
        }
      } else {
        stopDemoPlayback()
      }
    }, demoDurationMs)
  }

  const startDemoPlayback = () => {
    if (isDemoPlaying) {
      stopDemoPlayback()
      return
    }

    setIsDemoPlaying(true)
    setCaptionWordIndex(0)
    setDemoProgress(0)

    if (template?.music.enabled && template.music.assetPath && audioRef.current) {
      audioRef.current.currentTime = 0
      audioRef.current.volume = template.music.volume
      void audioRef.current.play().catch(() => {
        // Ignore autoplay failures; the rest of the preview should still run.
      })
    }

    if (template?.introOutro.introPath && videoRef.current) {
      setDemoPhase('intro')
      videoRef.current.currentTime = 0
      void videoRef.current.play().catch(() => {
        startDemoPhase()
      })
      return
    }

    startDemoPhase()
  }

  const applyCaptionPreset = (presetId: (typeof captionPresets)[number]['id']) => {
    const preset = captionPresets.find((item) => item.id === presetId)
    if (!preset) return

    updateCaption({
      presetId: preset.id,
      text: preset.text,
      font: preset.font,
      fontWeight: preset.fontWeight,
      backgroundEnabled: preset.id !== 'none',
      highlightColor: preset.highlightColor,
      backgroundColor: preset.backgroundColor
    })
  }

  const captionStyle = getCaptionPositionStyle(template?.caption)
  const logoPreviewSize = `${Math.max((template?.logo.scale ?? 0.18) * 100, 12)}%`
  const previewAspectRatio = toCssAspectRatio(template?.frame.aspectRatio ?? defaultBrandTemplate.frame.aspectRatio)
  const previewMaxWidth = getPreviewMaxWidth(template?.frame.aspectRatio ?? defaultBrandTemplate.frame.aspectRatio)
  const previewImageStyle = getPreviewImageStyle(template?.frame.cropMode ?? defaultBrandTemplate.frame.cropMode)
  const previewCaptionText = formatPreviewCaptionText(
    template?.caption ?? defaultBrandTemplate.caption,
    captionWordIndex
  )
  const previewCaptionCardStyle = getPreviewCaptionCardStyle(template?.caption ?? defaultBrandTemplate.caption)
  const previewCaptionTextStyle = getPreviewCaptionTextStyle(template?.caption ?? defaultBrandTemplate.caption)
  const activeVideoPath =
    demoPhase === 'intro'
      ? template?.introOutro.introPath ?? null
      : demoPhase === 'outro'
        ? template?.introOutro.outroPath ?? null
        : null
  const musicSelected = Boolean(template?.music.enabled && template.music.assetPath)

  if (isLoading) {
    return (
      <MainContentPanel>
        <div className="app-page">
          <div className="flex h-full items-center justify-center text-text-muted">Loading brand template...</div>
        </div>
      </MainContentPanel>
    )
  }

  if (!template) {
    return (
      <MainContentPanel>
        <div className="app-page">
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <div className="text-lg font-medium text-text-primary">Brand template failed to load</div>
            <div className="max-w-md text-sm text-text-secondary">
              {loadError || 'Template state was unavailable.'}
            </div>
            <button type="button" className="app-action-secondary" onClick={() => void loadPageState()}>
              Retry
            </button>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel>
      <div className="app-page flex h-full flex-col overflow-hidden pb-0">
        <div className="mx-auto flex h-full w-full max-w-[1380px] flex-col">
          <div className="app-page-header">
            <div className="app-page-header-shell max-w-[1380px] grid grid-cols-[1fr_auto_1fr] gap-4">
                <div className="app-page-header-content">
                  <div className="app-page-title">Brand Template</div>
                  <div className="app-page-separator">|</div>
                  <div className="app-page-subtitle">
                    Setup your Reel template.
                  </div>
                </div>

                <div ref={presetMenuRef} className="relative flex items-center justify-self-center">
                  <button
                    type="button"
                    className="brand-preset-trigger"
                    onClick={() => setIsPresetMenuOpen((current) => !current)}
                    aria-haspopup="dialog"
                    aria-expanded={isPresetMenuOpen}
                  >
                    <span className="brand-preset-trigger-label">
                      * {activePreset?.name ?? 'Preset template 1'}
                    </span>
                    <IoChevronDown
                      size={18}
                      className={`transition-transform duration-200 ${isPresetMenuOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isPresetMenuOpen ? (
                    <div className="brand-preset-dropdown">
                      <button
                        type="button"
                        className="brand-preset-card brand-preset-create-card"
                        onClick={() => void handleCreatePreset()}
                      >
                        <div className="brand-preset-create-icon">
                          <IoAddOutline size={36} />
                        </div>
                        <div className="brand-preset-create-label">Create new template</div>
                      </button>

                      {presets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          className={`brand-preset-card ${
                            preset.id === activePresetId ? 'is-active' : ''
                          }`}
                          onClick={() => void handleSelectPreset(preset.id)}
                        >
                          <div className="brand-preset-card-preview">
                            <div className="brand-preset-card-ratio">{preset.template.frame.aspectRatio}</div>
                            <div className="brand-preset-card-caption">
                              {formatPresetCardText(preset.template.caption)}
                            </div>
                            <div className="brand-preset-card-meta">Logo, Intro, and more...</div>
                          </div>
                          <div className="brand-preset-card-footer">
                            <div className="brand-preset-card-name">{preset.name}</div>
                            <div className="brand-preset-card-footer-right">
                              <div className="brand-preset-card-swatches">
                                {getPresetSwatches(preset.template).map((color) => (
                                  <span
                                    key={`${preset.id}-${color}`}
                                    className="brand-preset-card-swatch"
                                    style={{ backgroundColor: color }}
                                  />
                                ))}
                              </div>
                              {presets.length > 1 ? (
                                <button
                                  type="button"
                                  className="brand-preset-delete"
                                  aria-label={`Delete ${preset.name}`}
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    void handleDeletePreset(preset.id)
                                  }}
                                >
                                  <IoTrashOutline size={14} />
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="app-page-header-actions justify-self-end">
                  <button
                    type="button"
                    className="app-action-primary brand-header-save-button"
                    disabled={isSaving}
                    onClick={() => void handleSavePreset()}
                  >
                    {isSaving ? 'Saving...' : showSavedState ? 'Saved' : 'Save template'}
                  </button>
                </div>
            </div>
          </div>

          <div className="app-page-content-shell">
            <div className="brand-template-body">
              <div className="brand-template-menus">
              <section className="workspace-panel brand-settings-panel w-[320px] shrink-0">
                <div className="workspace-panel-scroll">
                  <div className="workspace-panel-header">
                    <div>
                      <h2 className="workspace-panel-title !mt-0">Setting</h2>
                    </div>
                  </div>

                  <div className="template-settings-divider" />

                  <div className="template-settings-menu">
                    <div>
                      <div className="template-settings-group-label">Style</div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          className={`template-settings-row template-settings-row-button ${
                          activeMenu === 'layout' ? 'is-active' : ''
                        }`}
                        onClick={() => setActiveMenu(activeMenu === 'layout' ? null : 'layout')}
                        >
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-icon">
                              <IoResizeOutline size={15} />
                            </div>
                            <div className="template-settings-row-title">Clip layout</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <span className="template-settings-row-value truncate">
                              {template.frame.aspectRatio} {cropModeSummaryLabel[template.frame.cropMode]} template
                            </span>
                            <IoChevronForward size={15} />
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`template-settings-row template-settings-row-button ${
                            activeMenu === 'caption' ? 'is-active' : ''
                          }`}
                          onClick={() => setActiveMenu(activeMenu === 'caption' ? null : 'caption')}
                        >
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-icon">
                              <IoTextOutline size={15} />
                            </div>
                            <div className="template-settings-row-title">Caption</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <span className="template-settings-row-value truncate">{selectedCaptionPreset.label}</span>
                            <IoChevronForward size={15} />
                          </div>
                        </button>
                      </div>
                    </div>

                    <div>
                      <div className="template-settings-group-label">Brand</div>
                      <div className="space-y-1">
                        <button
                          type="button"
                          className={`template-settings-row template-settings-row-button ${
                            activeMenu === 'overlay' ? 'is-active' : ''
                          }`}
                          onClick={() => setActiveMenu(activeMenu === 'overlay' ? null : 'overlay')}
                        >
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-icon">
                              <IoImagesOutline size={15} />
                            </div>
                            <div className="template-settings-row-title">Overlay</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <span className="template-settings-row-value truncate">
                              {template.logo.assetPath ? formatName(template.logo.assetPath) : 'overlay/original'}
                            </span>
                            <IoChevronForward size={15} />
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`template-settings-row template-settings-row-button ${
                            activeMenu === 'intro-outro' ? 'is-active' : ''
                          }`}
                          onClick={() => setActiveMenu(activeMenu === 'intro-outro' ? null : 'intro-outro')}
                        >
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-title">Intro/outro</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <IoChevronForward size={15} />
                          </div>
                        </button>
                        <button
                          type="button"
                          className={`template-settings-row template-settings-row-button ${
                            activeMenu === 'music' ? 'is-active' : ''
                          }`}
                          onClick={() => setActiveMenu(activeMenu === 'music' ? null : 'music')}
                        >
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-title">Music</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <span className="template-settings-row-value truncate">
                              {template.music.assetPath ? formatName(template.music.assetPath) : 'No music'}
                            </span>
                            <IoChevronForward size={15} />
                          </div>
                        </button>
                      </div>
                    </div>

                  </div>
                </div>
              </section>

              {activeMenu === 'layout' ? (
                <section className="workspace-panel brand-settings-panel w-[320px] shrink-0">
                  <div className="workspace-panel-scroll">
                    <div className="workspace-panel-header">
                      <div>
                        <h2 className="workspace-panel-title !mt-0">Layout</h2>
                      </div>
                    </div>

                    <div className="template-settings-divider" />

                    <div className="template-layout-menu">
                      <div>
                        <div className="template-settings-group-label">Aspect ratio:</div>
                        <div className="template-option-grid">
                          {aspectRatioOptions.map((ratio) => (
                            <button
                              key={ratio}
                              type="button"
                              className={`template-option-chip ${
                                template.frame.aspectRatio === ratio ? 'is-active' : ''
                              }`}
                              onClick={() => updateFrame({ aspectRatio: ratio })}
                            >
                              <IoSquareOutline size={14} />
                              <span>{ratio}</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div className="template-settings-group-label">Layout</div>
                        <div className="template-option-grid template-option-grid-wide">
                          {cropModeOptions.map((option) => {
                            const Icon = option.icon
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`template-option-chip ${
                                  template.frame.cropMode === option.value ? 'is-active' : ''
                                }`}
                                onClick={() => updateFrame({ cropMode: option.value })}
                              >
                                <Icon size={14} />
                                <span>{option.label}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeMenu === 'caption' ? (
                <section className="workspace-panel brand-settings-panel brand-settings-flyout-scroll w-[320px] shrink-0 overflow-hidden">
                  <div className="workspace-panel-scroll">
                    <div className="workspace-panel-header">
                      <div>
                        <h2 className="workspace-panel-title !mt-0">Caption</h2>
                      </div>
                    </div>

                    <div className="template-settings-divider" />

                    <div className="template-caption-tabs">
                      {captionTabOptions.map((tab) => (
                        <button
                          key={tab}
                          type="button"
                          className={`template-caption-tab ${activeCaptionTab === tab ? 'is-active' : ''}`}
                          onClick={() => setActiveCaptionTab(tab)}
                        >
                          {tab === 'presets' ? 'Presets' : tab === 'font' ? 'Font' : 'Effects'}
                        </button>
                      ))}
                    </div>

                    <div className="template-settings-divider" />

                    {activeCaptionTab === 'presets' ? (
                      <div className="template-caption-preset-grid">
                        {captionPresets.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            className={`template-caption-preset-card ${
                              template.caption.presetId === preset.id ? 'is-active' : ''
                            }`}
                            onClick={() => applyCaptionPreset(preset.id)}
                          >
                            <div
                              className="template-caption-preset-preview"
                              style={{
                                background: preset.backgroundColor,
                                color: preset.highlightColor,
                                fontFamily: getFontFamilyValue(preset.font),
                                fontWeight: preset.fontWeight
                              }}
                            >
                              {preset.text || '∅'}
                            </div>
                            <div className="template-caption-preset-label">{preset.label}</div>
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {activeCaptionTab === 'font' ? (
                      <div className="template-layout-menu">
                        <div>
                          <div className="template-settings-group-label">Font settings</div>
                          <div className="template-form-stack">
                            <select
                              className="template-form-select"
                              value={template.caption.font}
                              onChange={(event) => updateCaption({ font: event.target.value })}
                            >
                              {captionFontOptions.map((font) => (
                                <option key={font} value={font}>
                                  {font}
                                </option>
                              ))}
                            </select>

                            <div className="template-form-row">
                              <input
                                className="template-form-input"
                                type="number"
                                min={18}
                                max={72}
                                value={template.caption.fontSize}
                                onChange={(event) => updateCaption({ fontSize: Number(event.target.value) || 30 })}
                              />
                              <select
                                className="template-form-select"
                                value={template.caption.fontWeight}
                                onChange={(event) =>
                                  updateCaption({ fontWeight: event.target.value as BrandTemplate['caption']['fontWeight'] })
                                }
                              >
                                <option value="500">Medium</option>
                                <option value="600">Semi Bold</option>
                                <option value="700">Bold</option>
                                <option value="800">Extra Bold</option>
                              </select>
                            </div>

                            <div className="template-inline-actions">
                              <button
                                type="button"
                                className={`template-inline-chip ${template.caption.italic ? 'is-active' : ''}`}
                                onClick={() => updateCaption({ italic: !template.caption.italic })}
                              >
                                Italic
                              </button>
                              <button
                                type="button"
                                className={`template-inline-chip ${template.caption.underline ? 'is-active' : ''}`}
                                onClick={() => updateCaption({ underline: !template.caption.underline })}
                              >
                                Underline
                              </button>
                            </div>

                            <div className="template-form-row template-form-row-spread">
                              <span className="template-settings-group-label !mb-0">Uppercase</span>
                              <button
                                type="button"
                                className={`template-settings-toggle ${template.caption.uppercase ? 'is-on' : ''}`}
                                onClick={() => updateCaption({ uppercase: !template.caption.uppercase })}
                                aria-label="Toggle uppercase"
                              >
                                <span className="template-settings-toggle-thumb" />
                              </button>
                            </div>

                            <div className="template-form-row">
                              <ColorField
                                label="Stroke"
                                value={template.caption.strokeColor}
                                onChange={(value) => updateCaption({ strokeColor: value })}
                              />
                              <input
                                className="template-form-input"
                                type="number"
                                min={0}
                                max={8}
                                value={template.caption.strokeWidth}
                                onChange={(event) => updateCaption({ strokeWidth: Number(event.target.value) || 0 })}
                              />
                            </div>

                            <div className="template-form-row template-form-row-spread">
                              <span className="template-settings-group-label !mb-0">Font shadows</span>
                              <button
                                type="button"
                                className={`template-settings-toggle ${template.caption.shadowEnabled ? 'is-on' : ''}`}
                                onClick={() => updateCaption({ shadowEnabled: !template.caption.shadowEnabled })}
                                aria-label="Toggle font shadow"
                              >
                                <span className="template-settings-toggle-thumb" />
                              </button>
                            </div>

                            {template.caption.shadowEnabled ? (
                              <>
                                <div className="template-form-row">
                                  <ColorField
                                    label="Shadow"
                                    value={template.caption.shadowColor}
                                    onChange={(value) => updateCaption({ shadowColor: value })}
                                  />
                                  <input
                                    className="template-form-input"
                                    type="number"
                                    value={template.caption.shadowOffsetX}
                                    onChange={(event) => updateCaption({ shadowOffsetX: Number(event.target.value) || 0 })}
                                  />
                                  <input
                                    className="template-form-input"
                                    type="number"
                                    value={template.caption.shadowOffsetY}
                                    onChange={(event) => updateCaption({ shadowOffsetY: Number(event.target.value) || 0 })}
                                  />
                                  <input
                                    className="template-form-input"
                                    type="number"
                                    min={0}
                                    value={template.caption.shadowBlur}
                                    onChange={(event) => updateCaption({ shadowBlur: Number(event.target.value) || 0 })}
                                  />
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {activeCaptionTab === 'effects' ? (
                      <div className="template-layout-menu">
                        <div>
                          <div className="template-settings-group-label">Position</div>
                          <div className="template-option-grid template-option-grid-wide">
                            {captionPositionOptions.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                className={`template-option-chip ${
                                  template.caption.position === option.value ? 'is-active' : ''
                                }`}
                                onClick={() => updateCaption({ position: option.value })}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div>
                          <div className="template-settings-group-label">Animation</div>
                          <select
                            className="template-form-select"
                            value={template.caption.animation}
                            onChange={(event) =>
                              updateCaption({ animation: event.target.value as BrandTemplate['caption']['animation'] })
                            }
                          >
                            <option value="box">Box</option>
                          </select>
                        </div>

                        <div>
                          <div className="template-settings-group-label">Lines</div>
                          <div className="template-option-grid template-option-grid-wide">
                            <button
                              type="button"
                              className={`template-option-chip ${
                                template.caption.lineMode === 'three-lines' ? 'is-active' : ''
                              }`}
                              onClick={() => updateCaption({ lineMode: 'three-lines' })}
                            >
                              Three lines
                            </button>
                            <button
                              type="button"
                              className={`template-option-chip ${
                                template.caption.lineMode === 'one-line' ? 'is-active' : ''
                              }`}
                              onClick={() => updateCaption({ lineMode: 'one-line' })}
                            >
                              One line
                            </button>
                          </div>
                        </div>

                        <div className="template-form-row template-form-row-spread">
                          <span className="template-settings-group-label !mb-0">Highlighted word color</span>
                          <ColorField
                            label="Highlight"
                            value={template.caption.highlightColor}
                            onChange={(value) => updateCaption({ highlightColor: value })}
                          />
                        </div>

                        <div className="template-form-row template-form-row-spread">
                          <span className="template-settings-group-label !mb-0">Text background</span>
                          <button
                            type="button"
                            className={`template-settings-toggle ${template.caption.backgroundEnabled ? 'is-on' : ''}`}
                            onClick={() => updateCaption({ backgroundEnabled: !template.caption.backgroundEnabled })}
                            aria-label="Toggle text background"
                          >
                            <span className="template-settings-toggle-thumb" />
                          </button>
                        </div>

                        <div className="template-form-row template-form-row-spread">
                          <span className="template-settings-group-label !mb-0">Background color</span>
                          <ColorField
                            label="Background"
                            value={template.caption.backgroundColor}
                            onChange={(value) => updateCaption({ backgroundColor: value })}
                            disabled={!template.caption.backgroundEnabled}
                          />
                        </div>

                        <div>
                          <div className="template-settings-group-label">Background spread</div>
                          <div className="template-form-row">
                            <input
                              className="template-form-input"
                              type="number"
                              min={0}
                              max={48}
                              value={template.caption.backgroundPaddingX}
                              onChange={(event) =>
                                updateCaption({ backgroundPaddingX: Number(event.target.value) || 0 })
                              }
                              disabled={!template.caption.backgroundEnabled}
                            />
                            <input
                              className="template-form-input"
                              type="number"
                              min={0}
                              max={32}
                              value={template.caption.backgroundPaddingY}
                              onChange={(event) =>
                                updateCaption({ backgroundPaddingY: Number(event.target.value) || 0 })
                              }
                              disabled={!template.caption.backgroundEnabled}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="template-settings-group-label">Corner rounding</div>
                          <input
                            className="template-form-input"
                            type="number"
                            min={0}
                            max={40}
                            value={template.caption.backgroundRadius}
                            onChange={(event) =>
                              updateCaption({ backgroundRadius: Number(event.target.value) || 0 })
                            }
                            disabled={!template.caption.backgroundEnabled}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {activeMenu === 'overlay' ? (
                <section className="workspace-panel brand-settings-panel w-[320px] shrink-0">
                  <div className="workspace-panel-scroll">
                    <div className="workspace-panel-header">
                      <div>
                        <h2 className="workspace-panel-title !mt-0">Overlay</h2>
                      </div>
                    </div>

                    <div className="template-settings-divider" />

                    <div className="template-layout-menu pt-5">
                      <button
                        type="button"
                        className={`template-asset-row ${!template.logo.assetPath ? 'is-active' : ''}`}
                        onClick={() =>
                            updateLogo({
                              enabled: false,
                              assetPath: null
                            })
                          }
                      >
                        <div className="template-asset-row-main">
                          <div className="template-settings-row-icon">
                            <IoImagesOutline size={16} />
                          </div>
                          <span className="truncate">No overlay</span>
                        </div>
                      </button>

                      {logos.map((logoPath) => (
                        <button
                          key={logoPath}
                          type="button"
                          className={`template-asset-row ${
                            template.logo.assetPath === logoPath ? 'is-active' : ''
                          }`}
                          onClick={() =>
                            updateLogo({
                              enabled: true,
                              assetPath: logoPath
                            })
                          }
                        >
                          <div className="template-asset-row-main">
                            <div className="template-settings-row-icon">
                              <IoImagesOutline size={16} />
                            </div>
                            <span className="truncate">{formatName(logoPath)}</span>
                          </div>
                          {template.logo.assetPath === logoPath ? <IoTrashOutline size={18} /> : null}
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : null}

              {activeMenu === 'intro-outro' ? (
                <section className="workspace-panel brand-settings-panel w-[320px] shrink-0">
                  <div className="workspace-panel-scroll">
                    <div className="workspace-panel-header">
                      <div>
                        <h2 className="workspace-panel-title !mt-0">Intro/outro</h2>
                      </div>
                    </div>

                    <div className="template-settings-divider" />

                    <div className="template-layout-menu pt-5">
                      <button
                        type="button"
                        className="template-upload-row"
                        onClick={() => void pickIntroOutroFile('introPath')}
                      >
                        <div className="template-upload-row-main">
                          <IoCloudUploadOutline size={22} />
                          <span>{template.introOutro.introPath ? formatName(template.introOutro.introPath) : 'Upload intro'}</span>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="template-upload-row"
                        onClick={() => void pickIntroOutroFile('outroPath')}
                      >
                        <div className="template-upload-row-main">
                          <IoCloudUploadOutline size={22} />
                          <span>{template.introOutro.outroPath ? formatName(template.introOutro.outroPath) : 'Upload outro'}</span>
                        </div>
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}

              {activeMenu === 'music' ? (
                <section className="workspace-panel brand-settings-panel w-[320px] shrink-0">
                  <div className="workspace-panel-scroll">
                    <div className="workspace-panel-header">
                      <div>
                        <h2 className="workspace-panel-title !mt-0">Music</h2>
                      </div>
                    </div>

                    <div className="template-settings-divider" />

                    <div className="template-layout-menu pt-5">
                      <button
                        type="button"
                        className={`template-asset-row ${!template.music.assetPath ? 'is-active' : ''}`}
                        onClick={() =>
                          updateMusic({
                            enabled: false,
                            assetPath: null
                          })
                        }
                      >
                        <div className="template-asset-row-main">
                          <div className="template-settings-row-icon">
                            <IoMusicalNotesOutline size={16} />
                          </div>
                          <span className="truncate">No music</span>
                        </div>
                      </button>

                      {musicTracks.map((trackPath) => (
                        <button
                          key={trackPath}
                          type="button"
                          className={`template-asset-row ${
                            template.music.assetPath === trackPath ? 'is-active' : ''
                          }`}
                          onClick={() =>
                            updateMusic({
                              enabled: true,
                              assetPath: trackPath
                            })
                          }
                        >
                          <div className="template-asset-row-main">
                            <div className="template-settings-row-icon">
                              <IoMusicalNotesOutline size={16} />
                            </div>
                            <span className="truncate">{formatName(trackPath)}</span>
                          </div>
                        </button>
                      ))}

                      <div className={`template-volume-card ${!template.music.assetPath ? 'is-disabled' : ''}`}>
                        <div className="template-volume-header">
                          <span className="template-volume-label">Volume</span>
                          <span className="template-volume-value">
                            {Math.round((template.music.volume ?? 0) * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          step="1"
                          value={Math.round((template.music.volume ?? 0) * 100)}
                          disabled={!template.music.assetPath}
                          onChange={(event) =>
                            updateMusic({
                              enabled: Boolean(template.music.assetPath),
                              volume: Number(event.target.value) / 100
                            })
                          }
                          className="template-volume-slider"
                          aria-label="Music volume"
                        />
                      </div>
                    </div>
                  </div>
                </section>
              ) : null}
              </div>

              <div className="brand-template-preview-stage">
              <div
                ref={previewRef}
                className={`brand-template-preview-frame relative overflow-hidden transition-transform duration-200 ${
                  activeMenu ? 'translate-x-4' : '-translate-x-2'
                }`}
                style={{
                  aspectRatio: previewAspectRatio,
                  maxWidth: previewMaxWidth
                }}
                onMouseDown={() => setIsLogoSelected(false)}
              >
                    {activeVideoPath ? (
                      <video
                        ref={videoRef}
                        key={activeVideoPath}
                        src={`app-file://${activeVideoPath}`}
                        className="absolute inset-0 z-[1] h-full w-full object-cover"
                        muted={false}
                        playsInline
                        onEnded={() => {
                          if (demoPhase === 'intro') {
                            startDemoPhase()
                          } else {
                            stopDemoPlayback()
                          }
                        }}
                      />
                    ) : null}

                    {template.frame.cropMode === 'blur' ? (
                      <>
                        <img
                          src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl"
                        />
                        <div className="brand-template-preview-dim" />
                      </>
                    ) : null}
                    <div className="brand-template-preview-media" />
                    <img
                      src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
                      alt="Preview backdrop"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={previewImageStyle}
                    />
                    <div className="brand-template-preview-gradient" />
                    <div
                      className={`brand-template-preview-safe-area ${
                        isDraggingCaption || isDraggingLogo ? 'is-active' : ''
                      }`}
                      style={{
                        inset: `${SAFE_AREA_PERCENT}%`
                      }}
                    />

                    {dragGuides.vertical ? <div className="brand-template-preview-guide is-vertical" /> : null}
                    {dragGuides.horizontal ? <div className="brand-template-preview-guide is-horizontal" /> : null}

                    {musicSelected ? (
                      <div className="brand-template-preview-audio-indicator absolute right-4 top-4 z-20">
                        <IoMusicalNotes size={16} />
                      </div>
                    ) : null}

                    {template.logo.enabled && template.logo.assetPath && (
                      <div
                        className="absolute z-20 select-none"
                        style={{
                          left: `${template.logo.positionX}%`,
                          top: `${template.logo.positionY}%`,
                          transform: 'translate(-50%, -50%)',
                          width: logoPreviewSize,
                          cursor: isDraggingLogo ? 'grabbing' : 'grab'
                        }}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          event.stopPropagation()
                          setIsLogoSelected(true)
                          setIsDraggingLogo(true)
                        }}
                      >
                        <div
                          className={`relative rounded-md ${
                            isDraggingLogo || isLogoSelected ? 'ring-2 ring-white/80' : ''
                          }`}
                        >
                          <img
                            src={`app-file://${template.logo.assetPath}`}
                            alt="Brand logo"
                            className="block w-full pointer-events-none"
                            style={{ opacity: template.logo.opacity }}
                            draggable={false}
                          />
                          {isLogoSelected ? (
                            <>
                              <div className="absolute inset-0 border border-white/80" />
                              {[
                                'left-0 top-0 -translate-x-1/2 -translate-y-1/2',
                                'right-0 top-0 translate-x-1/2 -translate-y-1/2',
                                'left-0 bottom-0 -translate-x-1/2 translate-y-1/2',
                                'right-0 bottom-0 translate-x-1/2 translate-y-1/2'
                              ].map((handleClass) => (
                                <button
                                  key={handleClass}
                                  type="button"
                                  className={`absolute h-5 w-5 rounded-full border-2 border-white bg-[#09090b] ${handleClass}`}
                                  onMouseDown={(event) => {
                                    if (event.button !== 0) return
                                    event.preventDefault()
                                    event.stopPropagation()
                                    setIsLogoSelected(true)
                                    setIsDraggingLogo(false)
                                    setIsResizingLogo(true)
                                  }}
                                  aria-label="Resize overlay"
                                />
                              ))}
                            </>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {template.caption.presetId !== 'none' && demoPhase === 'demo' && (
                      <div
                        className="absolute z-20 max-w-[78%] cursor-grab select-none"
                        style={captionStyle}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          setIsDraggingCaption(true)
                        }}
                      >
                        <div
                          className={`rounded-2xl px-6 py-3 text-center shadow-lg ${isDraggingCaption ? 'ring-2 ring-white/80' : ''}`}
                          style={previewCaptionCardStyle}
                        >
                          <span style={previewCaptionTextStyle}>
                            {previewCaptionText.highlighted}
                            {previewCaptionText.remaining ? (
                              <>
                                {' '}
                                <span className="text-black/35">{previewCaptionText.remaining}</span>
                              </>
                            ) : null}
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="absolute bottom-5 left-5 right-5 flex items-center gap-3">
                      <button
                        type="button"
                        className="brand-template-preview-play-button"
                        onClick={(event) => {
                          event.stopPropagation()
                          startDemoPlayback()
                        }}
                      >
                        {isDemoPlaying ? '■' : '▶'}
                      </button>
                      <div className="brand-template-preview-progress-track">
                        <div
                          className="brand-template-preview-progress-fill"
                          style={{ width: `${Math.max(demoProgress, 6)}%` }}
                        />
                      </div>
                    </div>

                    <audio
                      ref={audioRef}
                      src={template.music.assetPath ? `app-file://${template.music.assetPath}` : undefined}
                      preload="auto"
                    />
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}

function getCaptionPositionStyle(
  caption: BrandTemplate['caption'] | undefined
): CSSProperties {
  if (!caption) {
    return { left: '50%', bottom: '14%', transform: 'translateX(-50%)' }
  }

  if (caption.position === 'custom' && caption.customX != null && caption.customY != null) {
    return {
      left: `${caption.customX}%`,
      top: `${caption.customY}%`,
      transform: 'translate(-50%, -50%)'
    }
  }

  if (caption.position === 'top') {
    return { left: '50%', top: '16%', transform: 'translateX(-50%)' }
  }

  if (caption.position === 'center') {
    return { left: '50%', top: '52%', transform: 'translate(-50%, -50%)' }
  }

  return { left: '50%', bottom: '14%', transform: 'translateX(-50%)' }
}

function toCssAspectRatio(aspectRatio: BrandTemplate['frame']['aspectRatio']) {
  return aspectRatio.replace(':', ' / ')
}

function getFontFamilyValue(fontFamily: string) {
  return `"${fontFamily}", "Hedvig Letters Sans", system-ui, sans-serif`
}

function getPreviewMaxWidth(aspectRatio: BrandTemplate['frame']['aspectRatio']) {
  if (aspectRatio === '16:9') return 640
  if (aspectRatio === '1:1') return 430
  return 310
}

function getPreviewImageStyle(cropMode: BrandTemplate['frame']['cropMode']): CSSProperties {
  if (cropMode === 'blur') {
    return {
      objectFit: 'contain',
      padding: '4%',
      zIndex: 1
    }
  }

  if (cropMode === 'center') {
    return {
      objectFit: 'cover',
      objectPosition: 'center center',
      transform: 'scale(1.12)'
    }
  }

  return {
    objectFit: 'cover',
    objectPosition: 'center center'
  }
}

function getCaptionWords(caption: BrandTemplate['caption']) {
  const source = caption.uppercase ? caption.text.toUpperCase() : caption.text
  return source.split(' ').filter(Boolean)
}

function formatPreviewCaptionText(caption: BrandTemplate['caption'], activeWordIndex = 0) {
  const words = getCaptionWords(caption)
  const source = words.join(' ')
  if (!source) return { highlighted: '', remaining: '' }

  if (caption.lineMode === 'three-lines') {
    const chunkSize = Math.max(1, Math.ceil(words.length / 3))
    const lines = [
      words.slice(0, chunkSize).join(' '),
      words.slice(chunkSize, chunkSize * 2).join(' '),
      words.slice(chunkSize * 2).join(' ')
    ].filter(Boolean)
    return {
      highlighted: lines[0] ?? '',
      remaining: lines.slice(1).join('\n')
    }
  }

  const safeIndex = clamp(activeWordIndex, 0, Math.max(words.length - 1, 0))
  const highlighted = words[safeIndex] ?? ''
  const rest = words.filter((_, index) => index !== safeIndex)
  return {
    highlighted,
    remaining: rest.join(' ')
  }
}

function getPreviewCaptionCardStyle(caption: BrandTemplate['caption']): CSSProperties {
  return {
    background: caption.backgroundEnabled ? withOpacity(caption.backgroundColor, 0.88) : 'transparent',
    padding: `${caption.backgroundPaddingY}px ${caption.backgroundPaddingX}px`,
    borderRadius: `${caption.backgroundRadius}px`
  }
}

function getPreviewCaptionTextStyle(caption: BrandTemplate['caption']): CSSProperties {
  const textShadow = caption.shadowEnabled
    ? `${caption.shadowOffsetX}px ${caption.shadowOffsetY}px ${caption.shadowBlur}px ${caption.shadowColor}`
    : undefined

  return {
    display: 'inline-block',
    whiteSpace: caption.lineMode === 'three-lines' ? 'pre-line' : 'normal',
    fontFamily: getFontFamilyValue(caption.font),
    fontSize: `${caption.fontSize}px`,
    fontWeight: caption.fontWeight,
    fontStyle: caption.italic ? 'italic' : 'normal',
    textDecoration: caption.underline ? 'underline' : 'none',
    color: caption.highlightColor,
    WebkitTextStroke:
      caption.strokeWidth > 0 ? `${caption.strokeWidth}px ${caption.strokeColor}` : undefined,
    textShadow
  }
}

function formatPresetCardText(caption: BrandTemplate['caption']) {
  const words = getCaptionWords(caption)
  if (words.length === 0) return 'No captions'
  return words.slice(0, 3).join(' ')
}

function getPresetSwatches(template: BrandTemplate) {
  return [
    template.caption.backgroundColor,
    template.caption.highlightColor,
    template.caption.strokeColor,
    template.music.enabled ? '#39FF3A' : '#111111'
  ]
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return '#ffffff'
  const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized.toUpperCase() : null
}

function withOpacity(hex: string, alpha: number) {
  const normalized = normalizeHexColor(hex) ?? '#FFFFFF'
  const r = parseInt(normalized.slice(1, 3), 16)
  const g = parseInt(normalized.slice(3, 5), 16)
  const b = parseInt(normalized.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function ColorField({
  label,
  value,
  onChange,
  disabled = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const inputId = useId()
  const normalizedValue = normalizeHexColor(value) ?? '#FFFFFF'

  return (
    <div className={`template-color-field ${disabled ? 'is-disabled' : ''}`}>
      <label htmlFor={inputId} className="template-color-swatch" style={{ background: normalizedValue }}>
        <input
          id={inputId}
          className="template-color-native"
          type="color"
          value={normalizedValue}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          disabled={disabled}
          aria-label={label}
        />
      </label>
      <input
        className="template-form-input template-color-hex"
        type="text"
        value={normalizedValue}
        onChange={(event) => {
          const nextValue = normalizeHexColor(event.target.value)
          if (nextValue) onChange(nextValue)
        }}
        disabled={disabled}
        aria-label={`${label} hex value`}
      />
    </div>
  )
}

function formatName(path: string) {
  return path.split('/').pop() || path
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
