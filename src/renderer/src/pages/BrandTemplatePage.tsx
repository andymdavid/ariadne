import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  IoChevronForward,
  IoGridOutline,
  IoImagesOutline,
  IoResizeOutline,
  IoScanOutline,
  IoSquareOutline,
  IoTextOutline
} from 'react-icons/io5'
import type { BrandTemplate } from '@shared/types'
import { MainContentPanel } from '../components/MainContentPanel'

const captionPresets = [
  { id: 'none', label: 'No captions', text: '' },
  { id: 'karaoke', label: 'Karaoke', text: 'TO GET STARTED' },
  { id: 'beasty', label: 'Beasty', text: 'Build clips that hook fast' },
  { id: 'deep-diver', label: 'Deep Diver', text: 'One Line' },
  { id: 'youshaei', label: 'Youshaei', text: 'Sharp ideas only' },
  { id: 'pod-p', label: 'Pod P', text: 'Talk to camera' }
] as const

const aiToggleOrder: Array<keyof BrandTemplate['ai']> = [
  'removeFillerWords',
  'removePauses',
  'keywordHighlighter',
  'emojis',
  'stockBroll'
]

const aiLabels: Record<keyof BrandTemplate['ai'], string> = {
  removeFillerWords: 'Remove filler words',
  removePauses: 'Remove pauses',
  keywordHighlighter: 'AI keywords highlighter',
  emojis: 'AI emojis',
  stockBroll: 'Auto-generate stock B-roll'
}

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

const defaultBrandTemplate: BrandTemplate = {
  caption: {
    presetId: 'deep-diver',
    text: 'One Line',
    font: 'Inter',
    position: 'bottom',
    customX: null,
    customY: null
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
  const [activeMenu, setActiveMenu] = useState<'layout' | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isDraggingCaption, setIsDraggingCaption] = useState(false)
  const [isDraggingLogo, setIsDraggingLogo] = useState(false)
  const previewRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void loadPageState()
  }, [])

  useEffect(() => {
    if (!template) return

    const handleMouseMove = (event: MouseEvent) => {
      if (!previewRef.current) return

      const rect = previewRef.current.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * 100
      const y = ((event.clientY - rect.top) / rect.height) * 100

      if (isDraggingCaption) {
        setTemplate((current) =>
          current
            ? {
                ...current,
                caption: {
                  ...current.caption,
                  position: 'custom',
                  customX: clamp(x, 10, 90),
                  customY: clamp(y, 10, 90)
                }
              }
            : current
        )
      }

      if (isDraggingLogo) {
        setTemplate((current) =>
          current
            ? {
                ...current,
                logo: {
                  ...current.logo,
                  positionX: clamp(x, 8, 92),
                  positionY: clamp(y, 8, 92)
                }
              }
            : current
        )
      }
    }

    const handleMouseUp = () => {
      if (isDraggingCaption || isDraggingLogo) {
        setIsDraggingCaption(false)
        setIsDraggingLogo(false)
        void persistTemplate()
      }
    }

    if (isDraggingCaption || isDraggingLogo) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [isDraggingCaption, isDraggingLogo, template])

  const selectedCaptionPreset =
    captionPresets.find((preset) => preset.id === template?.caption.presetId) ?? captionPresets[3]

  const loadPageState = async () => {
    try {
      setIsLoading(true)
      setLoadError(null)

      const [loadedTemplate, loadedConfig] = await Promise.all([
        window.electronAPI?.getBrandTemplate?.() ?? Promise.resolve(undefined),
        window.electronAPI?.getConfig?.() ?? Promise.resolve(undefined)
      ])

      const resolvedTemplate = loadedTemplate ?? loadedConfig?.brandTemplate ?? defaultBrandTemplate

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
        frame: {
          ...defaultBrandTemplate.frame,
          ...resolvedTemplate.frame
        },
        ai: {
          ...defaultBrandTemplate.ai,
          ...resolvedTemplate.ai
        }
      })
    } catch (error) {
      console.error('Failed to load brand template:', error)
      setTemplate(defaultBrandTemplate)
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
        setTemplate(saved)
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

  const captionStyle = getCaptionPositionStyle(template?.caption)
  const logoPreviewSize = `${Math.max((template?.logo.scale ?? 0.18) * 100, 12)}%`
  const previewAspectRatio = toCssAspectRatio(template?.frame.aspectRatio ?? defaultBrandTemplate.frame.aspectRatio)
  const previewMaxWidth = getPreviewMaxWidth(template?.frame.aspectRatio ?? defaultBrandTemplate.frame.aspectRatio)
  const previewImageStyle = getPreviewImageStyle(template?.frame.cropMode ?? defaultBrandTemplate.frame.cropMode)

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
            <div className="mx-auto w-full max-w-[1380px]">
              <div className="flex items-center justify-between gap-4">
                <div className="app-page-header-content">
                  <div className="app-page-title">Brand Template</div>
                  <div className="app-page-separator">|</div>
                  <div className="app-page-subtitle">
                    Setup your Reel template.
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  {loadError ? <div className="app-chip">Using fallback defaults</div> : null}
                  <button
                    type="button"
                    className="app-action-primary"
                    disabled={isSaving}
                    onClick={() => void persistTemplate()}
                  >
                    Save template
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid flex-1 items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="ml-[-16px] flex items-start justify-start gap-2">
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
                        <div className="template-settings-row">
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
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="template-settings-group-label">Brand</div>
                      <div className="space-y-1">
                        <div className="template-settings-row">
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
                        </div>
                        <div className="template-settings-row">
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-title">Intro/outro</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <IoChevronForward size={15} />
                          </div>
                        </div>
                        <div className="template-settings-row">
                          <div className="template-settings-row-main">
                            <div className="template-settings-row-title">Music</div>
                          </div>
                          <div className="template-settings-row-meta">
                            <IoChevronForward size={15} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="template-settings-group-label">AI</div>
                      <div className="space-y-1">
                        {aiToggleOrder.map((key) => (
                          <div key={key} className="template-settings-row template-settings-row-toggle">
                            <div className="template-settings-row-main">
                              <div className="template-settings-row-icon template-settings-row-icon-subtle">
                                {key === 'removeFillerWords' && <span>✳</span>}
                                {key === 'removePauses' && <span>◌</span>}
                                {key === 'keywordHighlighter' && <span>⌁</span>}
                                {key === 'emojis' && <span>☺</span>}
                                {key === 'stockBroll' && <span>▣</span>}
                              </div>
                              <div className="template-settings-row-title">{aiLabels[key]}</div>
                            </div>
                            <div
                              className={`template-settings-toggle ${template.ai[key] ? 'is-on' : ''}`}
                              aria-hidden="true"
                            >
                              <span className="template-settings-toggle-thumb" />
                            </div>
                          </div>
                        ))}
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
            </div>

            <div className="flex min-h-[720px] items-center justify-center">
              <div
                ref={previewRef}
                className={`relative w-full overflow-hidden bg-[#eedec3] transition-transform duration-200 ${
                  activeMenu === 'layout' ? 'translate-x-6' : '-translate-x-10'
                }`}
                style={{
                  aspectRatio: previewAspectRatio,
                  maxWidth: previewMaxWidth
                }}
              >
                    {template.frame.cropMode === 'blur' ? (
                      <>
                        <img
                          src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
                          alt=""
                          aria-hidden="true"
                          className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl"
                        />
                        <div className="absolute inset-0 bg-black/18" />
                      </>
                    ) : null}
                    <img
                      src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
                      alt="Preview backdrop"
                      className="absolute inset-0 h-full w-full object-cover"
                      style={previewImageStyle}
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20" />

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
                          setIsDraggingLogo(true)
                        }}
                      >
                        <div className={`rounded-md ${isDraggingLogo ? 'ring-2 ring-white/80' : ''}`}>
                          <img
                            src={`app-file://${template.logo.assetPath}`}
                            alt="Brand logo"
                            className="block w-full pointer-events-none"
                            style={{ opacity: template.logo.opacity }}
                            draggable={false}
                          />
                        </div>
                      </div>
                    )}

                    {template.caption.presetId !== 'none' && (
                      <div
                        className="absolute z-20 max-w-[78%] cursor-grab select-none"
                        style={captionStyle}
                        onMouseDown={(event) => {
                          if (event.button !== 0) return
                          event.preventDefault()
                          setIsDraggingCaption(true)
                        }}
                      >
                        <div className={`rounded-2xl bg-white/88 px-6 py-3 text-center shadow-lg ${isDraggingCaption ? 'ring-2 ring-white/80' : ''}`}>
                          <span
                            className="text-[30px] font-semibold text-black"
                            style={{ fontFamily: template.caption.font }}
                          >
                            {template.caption.text.split(' ')[0]}{' '}
                            <span className="text-black/18">{template.caption.text.split(' ').slice(1).join(' ')}</span>
                          </span>
                        </div>
                      </div>
                    )}

                    <div className="absolute bottom-5 left-5 right-5 flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white">▶</div>
                      <div className="h-1.5 flex-1 rounded-full bg-white/20">
                        <div className="h-full w-20 rounded-full bg-white/60" />
                      </div>
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

function formatName(path: string) {
  return path.split('/').pop() || path
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
