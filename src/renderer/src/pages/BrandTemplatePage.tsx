import { useEffect, useId, useRef, useState } from 'react'
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
  const [activeMenu, setActiveMenu] = useState<'layout' | 'caption' | null>(null)
  const [activeCaptionTab, setActiveCaptionTab] = useState<(typeof captionTabOptions)[number]>('presets')
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
  const previewCaptionText = formatPreviewCaptionText(template?.caption ?? defaultBrandTemplate.caption)
  const previewCaptionCardStyle = getPreviewCaptionCardStyle(template?.caption ?? defaultBrandTemplate.caption)
  const previewCaptionTextStyle = getPreviewCaptionTextStyle(template?.caption ?? defaultBrandTemplate.caption)

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
                <section className="workspace-panel brand-settings-panel h-[calc(100vh-140px)] w-[320px] shrink-0 overflow-hidden">
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
                <section className="workspace-panel brand-settings-panel h-[calc(100vh-140px)] w-[320px] shrink-0 overflow-hidden">
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
                                fontFamily: preset.font,
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

function formatPreviewCaptionText(caption: BrandTemplate['caption']) {
  const source = caption.uppercase ? caption.text.toUpperCase() : caption.text
  if (!source) return { highlighted: '', remaining: '' }

  if (caption.lineMode === 'three-lines') {
    const words = source.split(' ')
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

  const [highlighted, ...rest] = source.split(' ')
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
    fontFamily: caption.font,
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
