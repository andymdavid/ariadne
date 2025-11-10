import { useState, useEffect } from 'react'
import { IoCropOutline } from 'react-icons/io5'

export interface FrameSettings {
  aspectRatio: '9:16' | '1:1' | '16:9'
  cropMode: 'center' | 'fit' | 'blur'
  cropPositionX?: number  // For center crop mode (percentage 0-100, default 50)
  cropPositionY?: number  // For center crop mode (percentage 0-100, default 50)
}

export interface FrameEditorProps {
  clipId: string
  currentSettings: FrameSettings | null
  onSettingsChange: (settings: FrameSettings) => void
}

const defaultSettings: FrameSettings = {
  aspectRatio: '9:16',
  cropMode: 'center'
}

const aspectRatioOptions = [
  { value: '1:1' as const, label: '1:1', description: 'Square (Instagram Post)' },
  { value: '9:16' as const, label: '9:16', description: 'Vertical (TikTok, Reels, Shorts)' },
  { value: '16:9' as const, label: '16:9', description: 'Landscape (YouTube)' }
]

const cropModeOptions = [
  {
    value: 'center' as const,
    label: 'Center Crop',
    description: 'Scale and crop to fill frame',
    detail: 'Video fills entire frame (sides may be cut off)',
    visual: (
      <div className="w-12 h-16 border-2 border-accent-primary rounded flex items-center justify-center bg-accent-primary/20">
        <div className="w-full h-full bg-accent-primary/40"></div>
      </div>
    )
  },
  {
    value: 'fit' as const,
    label: 'Scale to Fit',
    description: 'Show entire video with bars',
    detail: 'Video fits within frame (bars on top/bottom or sides)',
    visual: (
      <div className="w-12 h-16 border-2 border-accent-primary rounded flex items-center justify-center bg-bg-tertiary">
        <div className="w-8 h-8 bg-accent-primary/40 border border-accent-primary/60"></div>
      </div>
    )
  },
  {
    value: 'blur' as const,
    label: 'Blur Background',
    description: 'Fill empty space with blur',
    detail: 'Blurred video behind (no black bars)',
    visual: (
      <div className="w-12 h-16 border-2 border-accent-primary rounded flex items-center justify-center bg-gradient-to-b from-accent-primary/10 to-accent-primary/20 backdrop-blur-sm relative overflow-hidden">
        <div className="absolute inset-0 bg-accent-primary/5 backdrop-blur"></div>
        <div className="w-8 h-8 bg-accent-primary/40 border border-accent-primary/60 relative z-10"></div>
      </div>
    )
  }
]

export function FrameEditor({
  clipId,
  currentSettings,
  onSettingsChange
}: FrameEditorProps) {
  const [settings, setSettings] = useState<FrameSettings>(currentSettings || defaultSettings)
  const [loading, setLoading] = useState(true)

  // Load existing frame settings on mount
  useEffect(() => {
    loadFrameSettings()
  }, [clipId])

  // Notify parent of settings changes
  useEffect(() => {
    onSettingsChange(settings)
  }, [settings])

  const loadFrameSettings = async () => {
    try {
      setLoading(true)
      console.log('[FrameEditor] Loading settings for clip:', clipId)

      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[FrameEditor] Existing edits:', existingEdits)

      if (existingEdits) {
        setSettings({
          aspectRatio: (existingEdits.aspect_ratio || defaultSettings.aspectRatio) as '9:16' | '1:1' | '16:9',
          cropMode: (existingEdits.crop_mode || defaultSettings.cropMode) as 'center' | 'fit' | 'blur'
        })
      }

      setLoading(false)
    } catch (error) {
      console.error('[FrameEditor] Failed to load frame settings:', error)
      setLoading(false)
    }
  }

  const updateSettings = (updates: Partial<FrameSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-text-muted">Loading frame settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Aspect Ratio & Framing</h3>
        <p className="text-xs text-text-muted">
          Configure how your video will be cropped and displayed
        </p>
      </div>

      {/* Aspect Ratio Selection */}
      <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
        <div className="text-xs font-medium text-text-primary mb-2">Aspect Ratio</div>

        <div className="grid grid-cols-3 gap-3">
          {aspectRatioOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => updateSettings({ aspectRatio: option.value })}
              className={`p-3 rounded-lg border-2 transition-all ${
                settings.aspectRatio === option.value
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border-default bg-bg-tertiary hover:bg-bg-primary'
              }`}
            >
              <div className="flex flex-col items-center space-y-2">
                {/* Visual representation */}
                <div className="flex items-center justify-center w-full h-12">
                  {option.value === '1:1' && (
                    <div className={`w-10 h-10 border-2 rounded ${
                      settings.aspectRatio === option.value ? 'border-accent-primary bg-accent-primary/20' : 'border-text-muted bg-bg-primary'
                    }`}></div>
                  )}
                  {option.value === '9:16' && (
                    <div className={`w-7 h-12 border-2 rounded ${
                      settings.aspectRatio === option.value ? 'border-accent-primary bg-accent-primary/20' : 'border-text-muted bg-bg-primary'
                    }`}></div>
                  )}
                  {option.value === '16:9' && (
                    <div className={`w-12 h-7 border-2 rounded ${
                      settings.aspectRatio === option.value ? 'border-accent-primary bg-accent-primary/20' : 'border-text-muted bg-bg-primary'
                    }`}></div>
                  )}
                </div>

                {/* Label */}
                <div className="text-center">
                  <div className={`text-sm font-semibold ${
                    settings.aspectRatio === option.value ? 'text-accent-primary' : 'text-text-primary'
                  }`}>
                    {option.label}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {option.description}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Crop Mode Selection */}
      <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
        <div className="text-xs font-medium text-text-primary mb-2">Crop Mode</div>

        <div className="space-y-3">
          {cropModeOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => updateSettings({ cropMode: option.value })}
              className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                settings.cropMode === option.value
                  ? 'border-accent-primary bg-accent-primary/10'
                  : 'border-border-default bg-bg-tertiary hover:bg-bg-primary'
              }`}
            >
              <div className="flex items-start space-x-3">
                {/* Radio indicator */}
                <div className="flex-shrink-0 mt-1">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    settings.cropMode === option.value
                      ? 'border-accent-primary'
                      : 'border-text-muted'
                  }`}>
                    {settings.cropMode === option.value && (
                      <div className="w-2 h-2 rounded-full bg-accent-primary"></div>
                    )}
                  </div>
                </div>

                {/* Visual preview */}
                <div className="flex-shrink-0">
                  {option.visual}
                </div>

                {/* Description */}
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${
                    settings.cropMode === option.value ? 'text-accent-primary' : 'text-text-primary'
                  }`}>
                    {option.label}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {option.description}
                  </div>
                  <div className="text-xs text-text-secondary mt-1 opacity-75">
                    {option.detail}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Info Box */}
      <div className="p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-lg">
        <p className="text-xs text-text-secondary">
          💡 <span className="font-medium">Tip:</span> {settings.cropMode === 'center'
            ? 'In Center Crop mode, drag the video in the preview to adjust the crop position'
            : 'The video preview on the right will update to show how your clip will look with the selected aspect ratio and crop mode'}
        </p>
      </div>
    </div>
  )
}
