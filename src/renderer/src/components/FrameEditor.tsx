import { useState, useEffect, useRef } from 'react'
import { FrameSettings, DEFAULT_FRAME_SETTINGS } from '@shared/types/frameSettings'

export interface FrameEditorProps {
  clipId: string
  currentSettings: FrameSettings | null
  onSettingsChange: (settings: FrameSettings) => void
}

const aspectRatioOptions = [
  { value: '1:1' as const, label: '1:1', description: 'Square (Instagram Post)' },
  { value: '9:16' as const, label: '9:16', description: 'Vertical (TikTok, Reels, Shorts)' },
  { value: '16:9' as const, label: '16:9', description: 'Landscape (YouTube)' }
]

const clampZoom = (value?: number) => {
  const raw = value ?? 1
  return Math.max(0.5, Math.min(4, raw))
}

const approxEqual = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance

const areFrameSettingsEqual = (a: FrameSettings | null, b: FrameSettings | null) => {
  if (!a || !b) return false
  return (
    a.aspectRatio === b.aspectRatio &&
    a.cropMode === b.cropMode &&
    (a.cropPositionX ?? 50) === (b.cropPositionX ?? 50) &&
    (a.cropPositionY ?? 50) === (b.cropPositionY ?? 50) &&
    clampZoom(a.zoomLevel) === clampZoom(b.zoomLevel) &&
    approxEqual(a.videoOffsetX ?? 0, b.videoOffsetX ?? 0) &&
    approxEqual(a.videoOffsetY ?? 0, b.videoOffsetY ?? 0)
  )
}

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
    label: 'Canvas Fit',
    description: 'Scale video layer with zoom control',
    detail: 'Drag to reposition, zoom slider to scale (CapCut style)',
    visual: (
      <div className="w-12 h-16 border-2 border-accent-primary rounded relative">
        <div className="absolute inset-1 bg-accent-primary/10"></div>
        <div className="absolute inset-x-2 inset-y-0 bg-accent-primary/50"></div>
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
  const [settings, setSettings] = useState<FrameSettings>(
    currentSettings
      ? { ...currentSettings, zoomLevel: currentSettings.zoomLevel ?? DEFAULT_FRAME_SETTINGS.zoomLevel }
      : { ...DEFAULT_FRAME_SETTINGS }
  )
  const [loading, setLoading] = useState(true)
  const isLocalUpdateRef = useRef(false)

  // Load existing frame settings on mount or when prop updates
  useEffect(() => {
    if (currentSettings) {
      setSettings(prev => {
        if (areFrameSettingsEqual(prev, currentSettings)) {
          return prev
        }
        return {
          ...currentSettings,
          zoomLevel: clampZoom(currentSettings.zoomLevel)
        }
      })
      setLoading(false)
    } else {
      loadFrameSettings()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, currentSettings?.aspectRatio, currentSettings?.cropMode, currentSettings?.cropPositionX, currentSettings?.cropPositionY, currentSettings?.zoomLevel, currentSettings?.videoOffsetX, currentSettings?.videoOffsetY])

  // Notify parent of settings changes
  useEffect(() => {
    if (!isLocalUpdateRef.current) return
    onSettingsChange(settings)
    isLocalUpdateRef.current = false
  }, [settings, onSettingsChange])

  const loadFrameSettings = async () => {
    try {
      setLoading(true)
      console.log('[FrameEditor] Loading settings for clip:', clipId)

      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[FrameEditor] Existing edits:', existingEdits)

      if (existingEdits) {
        const normalizedCropMode = existingEdits.crop_mode === 'canvas'
          ? 'fit'
          : (existingEdits.crop_mode || DEFAULT_FRAME_SETTINGS.cropMode)

        setSettings(prev => {
          const next = {
            aspectRatio: (existingEdits.aspect_ratio || DEFAULT_FRAME_SETTINGS.aspectRatio) as FrameSettings['aspectRatio'],
            cropMode: normalizedCropMode as FrameSettings['cropMode'],
            cropPositionX: existingEdits.crop_position_x ?? 50,
            cropPositionY: existingEdits.crop_position_y ?? 50,
            zoomLevel: clampZoom(existingEdits.zoom_level ?? DEFAULT_FRAME_SETTINGS.zoomLevel),
            videoOffsetX: existingEdits.video_offset_x ?? DEFAULT_FRAME_SETTINGS.videoOffsetX,
            videoOffsetY: existingEdits.video_offset_y ?? DEFAULT_FRAME_SETTINGS.videoOffsetY
          }

          if (areFrameSettingsEqual(prev, next)) {
            return prev
          }

          return next
        })
      }

      setLoading(false)
    } catch (error) {
      console.error('[FrameEditor] Failed to load frame settings:', error)
      setLoading(false)
    }
  }

  const updateSettings = (updates: Partial<FrameSettings>) => {
    isLocalUpdateRef.current = true
    setSettings(prev => {
      let next: FrameSettings = {
        ...prev,
        ...updates,
        zoomLevel: updates.zoomLevel !== undefined ? clampZoom(updates.zoomLevel) : prev.zoomLevel
      }

      if (updates.cropMode && updates.cropMode !== prev.cropMode) {
        if (updates.cropMode === 'fit') {
          next = {
            ...next,
            videoOffsetX: 0,
            videoOffsetY: 0,
            zoomLevel: clampZoom(next.zoomLevel)
          }
        } else if (prev.cropMode === 'fit' && updates.cropMode === 'center') {
          next = {
            ...next,
            videoOffsetX: 0,
            videoOffsetY: 0,
            zoomLevel: clampZoom(next.zoomLevel)
          }
        }
      }

      return next
    })
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
          💡 <span className="font-medium">Tip:</span> {settings.cropMode === 'center' || settings.cropMode === 'fit'
            ? 'Drag the video in the preview to adjust framing; use the zoom slider to punch in or reveal more'
            : 'The video preview on the right will update to show how your clip will look with the selected aspect ratio and crop mode'}
        </p>
      </div>

      {/* Zoom Control (Center crop only) */}
      {(settings.cropMode === 'center' || settings.cropMode === 'fit') && (
        <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
          <div className="flex items-center justify-between text-xs font-medium text-text-primary">
            <span>Zoom / Scale</span>
            <span className="text-text-secondary">{(settings.zoomLevel ?? 1).toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="4.0"
            step="0.01"
            value={settings.zoomLevel ?? 1}
            onChange={(e) => updateSettings({ zoomLevel: Number(e.target.value) })}
            className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
          />
          <p className="text-xs text-text-muted">
            1.0x keeps the default framing. Increase to punch in, decrease to reveal more of the original video.
          </p>

          {settings.cropMode === 'fit' && (Math.round(settings.videoOffsetX ?? 0) !== 0 || Math.round(settings.videoOffsetY ?? 0) !== 0) && (
            <div className="text-center">
              <button
                onClick={() => updateSettings({ videoOffsetX: 0, videoOffsetY: 0 })}
                className="text-xs text-accent-primary hover:underline"
              >
                Reset position to center
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
