import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { IoImagesOutline, IoMusicalNotesOutline, IoTextOutline } from 'react-icons/io5'
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

type EditableTemplateSection = 'caption' | 'logo' | 'music' | 'frame' | 'ai'

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
  const [logos, setLogos] = useState<string[]>([])
  const [musicTracks, setMusicTracks] = useState<string[]>([])
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

  const selectedCaptionPreset = useMemo(
    () => captionPresets.find((preset) => preset.id === template?.caption.presetId) ?? captionPresets[3],
    [template]
  )

  const loadPageState = async () => {
    try {
      setIsLoading(true)
      setLoadError(null)

      const [loadedTemplate, loadedConfig, loadedLogos, loadedMusic] = await Promise.all([
        window.electronAPI?.getBrandTemplate?.() ?? Promise.resolve(undefined),
        window.electronAPI?.getConfig?.() ?? Promise.resolve(undefined),
        window.electronAPI?.listLogos?.(),
        window.electronAPI?.listMusic?.()
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
      setLogos(loadedLogos ?? [])
      setMusicTracks(loadedMusic ?? [])
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

  const patchTemplate = <K extends EditableTemplateSection>(section: K, updates: Partial<BrandTemplate[K]>) => {
    if (!template) return

    const nextTemplate = {
      ...template,
      [section]: {
        ...template[section],
        ...updates
      }
    } as BrandTemplate

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const updateCaptionPreset = (presetId: string) => {
    const preset = captionPresets.find((item) => item.id === presetId)
    if (!preset || !template) return

    const nextTemplate: BrandTemplate = {
      ...template,
      caption: {
        ...template.caption,
        presetId: preset.id,
        text: preset.text
      }
    }

    setTemplate(nextTemplate)
    void persistTemplate(nextTemplate)
  }

  const toggleAiSetting = (key: keyof BrandTemplate['ai']) => {
    if (!template) return
    patchTemplate('ai', { [key]: !template.ai[key] } as Partial<BrandTemplate['ai']>)
  }

  const captionStyle = getCaptionPositionStyle(template?.caption)
  const logoPreviewSize = `${Math.max((template?.logo.scale ?? 0.18) * 100, 12)}%`

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
      <div className="app-page">
        <div className="workspace-shell mx-auto w-full max-w-[1380px]">
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

          <div className="workspace-grid">
            <section className="workspace-panel">
              <div className="workspace-panel-scroll">
                <div className="workspace-panel-header">
                  <div>
                    <div className="workspace-panel-kicker">Settings</div>
                    <h2 className="workspace-panel-title">Current defaults</h2>
                    <p className="workspace-panel-copy">
                      This left rail is the source of truth for what the template currently applies.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="mb-3 text-sm font-medium text-text-muted">Style</div>
                    <div className="workspace-summary-list">
                      <div className="workspace-summary-row">
                        <div>
                          <div className="workspace-summary-row-label">Clip layout</div>
                          <div className="workspace-summary-row-value">
                            {template.frame.aspectRatio} · {template.frame.cropMode}
                          </div>
                        </div>
                      </div>
                      <div className="workspace-summary-row">
                        <div>
                          <div className="workspace-summary-row-label">Caption preset</div>
                          <div className="workspace-summary-row-value">{selectedCaptionPreset.label}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-sm font-medium text-text-muted">Brand</div>
                    <div className="workspace-summary-list">
                      <div className="workspace-summary-row">
                        <div>
                          <div className="workspace-summary-row-label">Logo asset</div>
                          <div className="workspace-summary-row-value">
                            {template.logo.assetPath ? formatName(template.logo.assetPath) : 'No default logo selected'}
                          </div>
                        </div>
                      </div>
                      <div className="workspace-summary-row">
                        <div>
                          <div className="workspace-summary-row-label">Music asset</div>
                          <div className="workspace-summary-row-value">
                            {template.music.assetPath ? formatName(template.music.assetPath) : 'No default track selected'}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 text-sm font-medium text-text-muted">AI Defaults</div>
                    <div className="space-y-2">
                      {aiToggleOrder.map((key) => (
                        <div key={key} className="app-list-row">
                          <span className="text-sm text-text-primary">{aiLabels[key]}</span>
                          <span className={`app-chip ${template.ai[key] ? '' : 'opacity-60'}`}>
                            {template.ai[key] ? 'On' : 'Off'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="workspace-panel">
              <div className="workspace-panel-scroll">
                <div className="workspace-panel-header">
                  <div>
                    <div className="workspace-panel-kicker">Controls</div>
                    <h2 className="workspace-panel-title">Edit template inputs</h2>
                    <p className="workspace-panel-copy">
                      Choose the defaults the preview uses now. Changes still save through the existing
                      template logic.
                    </p>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <div className="mb-3 text-sm font-medium text-text-muted">Caption preset</div>
                    <div className="grid grid-cols-2 gap-3">
                      {captionPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => updateCaptionPreset(preset.id)}
                          className={`rounded-2xl border p-4 text-left transition-colors ${
                            template.caption.presetId === preset.id
                              ? 'border-white bg-white/10'
                              : 'border-border-default bg-[#0d0f13] hover:bg-[#151921]'
                          }`}
                        >
                          <div className="text-sm font-medium text-text-primary">{preset.label}</div>
                          <div className="mt-2 text-xs text-text-secondary">{preset.text || 'Turns captions off in preview'}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-muted">
                      <IoImagesOutline size={16} />
                      Logos from Asset Library
                    </div>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => patchTemplate('logo', { enabled: false, assetPath: null })}
                        className={`app-list-row ${!template.logo.assetPath ? 'border-white/20' : ''}`}
                      >
                        <span className="text-sm text-text-primary">No default logo</span>
                      </button>
                      {logos.map((logoPath) => (
                        <button
                          key={logoPath}
                          type="button"
                          onClick={() => patchTemplate('logo', { enabled: true, assetPath: logoPath })}
                          className={`app-list-row ${template.logo.assetPath === logoPath ? 'border-white/20' : ''}`}
                        >
                          <span className="truncate text-sm text-text-primary">{formatName(logoPath)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-muted">
                      <IoMusicalNotesOutline size={16} />
                      Music from Asset Library
                    </div>
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => patchTemplate('music', { enabled: false, assetPath: null })}
                        className={`app-list-row ${!template.music.assetPath ? 'border-white/20' : ''}`}
                      >
                        <span className="text-sm text-text-primary">No default music</span>
                      </button>
                      {musicTracks.map((trackPath) => (
                        <button
                          key={trackPath}
                          type="button"
                          onClick={() => patchTemplate('music', { enabled: true, assetPath: trackPath })}
                          className={`app-list-row ${template.music.assetPath === trackPath ? 'border-white/20' : ''}`}
                        >
                          <span className="truncate text-sm text-text-primary">{formatName(trackPath)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-muted">
                      <IoTextOutline size={16} />
                      AI defaults
                    </div>
                    <div className="space-y-2">
                      {aiToggleOrder.map((key) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleAiSetting(key)}
                          className="app-list-row"
                        >
                          <span className="text-sm text-text-primary">{aiLabels[key]}</span>
                          <span className={`app-chip ${template.ai[key] ? '' : 'opacity-60'}`}>
                            {template.ai[key] ? 'On' : 'Off'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className="workspace-panel">
              <div className="workspace-panel-scroll">
                <div className="workspace-panel-header">
                  <div>
                    <div className="workspace-panel-kicker">Preview</div>
                    <h2 className="workspace-panel-title">Template output</h2>
                    <p className="workspace-panel-copy">
                      Use the live preview to validate inherited defaults. Drag caption and logo positions to
                      persist them with the current template.
                    </p>
                  </div>
                  <div className="app-chip">Persisted demo canvas</div>
                </div>

                <div className="workspace-preview-shell">
                  <div
                    ref={previewRef}
                    className="relative aspect-[9/16] h-full max-h-[680px] overflow-hidden rounded-[30px] border border-white/10 bg-[#eedec3]"
                  >
                    <img
                      src="https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80"
                      alt="Preview backdrop"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/20" />

                    <div className="absolute left-4 top-4 rounded-full bg-black/35 px-3 py-1 text-[11px] font-medium text-white">
                      Demo
                    </div>

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
            </section>
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

function formatName(path: string) {
  return path.split('/').pop() || path
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
