import { useState, useEffect } from 'react'
import { IoCloudUploadOutline } from 'react-icons/io5'

export interface LogoSettings {
  enabled: boolean
  logoPath: string | null
  positionX: number  // Percentage 0-100 (default 85 for bottom-right)
  positionY: number  // Percentage 0-100 (default 85 for bottom-right)
  scale: number      // 0.1 to 0.3 (10% to 30% of video width)
  opacity: number    // 0 to 1
}

export interface LogoEditorProps {
  clipId: string
  currentSettings: LogoSettings | null
  onSettingsChange: (settings: LogoSettings) => void
}

const defaultSettings: LogoSettings = {
  enabled: false,
  logoPath: null,
  positionX: 85,  // Bottom-right default (85% from left)
  positionY: 85,  // Bottom-right default (85% from top)
  scale: 0.15,
  opacity: 0.8
}

export function LogoEditor({
  clipId,
  currentSettings,
  onSettingsChange
}: LogoEditorProps) {
  const [settings, setSettings] = useState<LogoSettings>(currentSettings || defaultSettings)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [availableLogos, setAvailableLogos] = useState<string[]>([])

  // Load existing logo settings on mount
  useEffect(() => {
    loadLogoSettings()
    loadAvailableLogos()
  }, [clipId])

  // Notify parent of settings changes
  useEffect(() => {
    onSettingsChange(settings)
  }, [settings])

  const loadLogoSettings = async () => {
    try {
      setLoading(true)
      console.log('[LogoEditor] Loading settings for clip:', clipId)

      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[LogoEditor] Existing edits:', existingEdits)

      if (existingEdits) {
        setSettings({
          enabled: existingEdits.logo_enabled === 1,
          logoPath: existingEdits.logo_path || null,
          positionX: existingEdits.logo_position_x ?? defaultSettings.positionX,
          positionY: existingEdits.logo_position_y ?? defaultSettings.positionY,
          scale: existingEdits.logo_scale || defaultSettings.scale,
          opacity: existingEdits.logo_opacity || defaultSettings.opacity
        })
      }

      setLoading(false)
    } catch (error) {
      console.error('[LogoEditor] Failed to load logo settings:', error)
      setLoading(false)
    }
  }

  const loadAvailableLogos = async () => {
    try {
      const logos = await window.electronAPI?.listLogos?.()
      setAvailableLogos(logos || [])
    } catch (error) {
      console.error('[LogoEditor] Failed to load available logos:', error)
    }
  }

  const updateSettings = (updates: Partial<LogoSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }))
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    await uploadLogo(file)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    await uploadLogo(file)
  }

  const uploadLogo = async (file: File) => {
    // Validate file type
    const validTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      alert('Invalid file type. Please upload PNG, SVG, JPG, or WebP.')
      return
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      alert('File too large. Maximum size is 2MB.')
      return
    }

    try {
      setUploading(true)

      // Read file as base64 to send to main process
      const reader = new FileReader()
      reader.onload = async () => {
        const base64Data = reader.result as string

        // Upload via IPC
        const result = await window.electronAPI?.uploadLogo?.(base64Data, file.name)

        if (result?.success && result.path) {
          updateSettings({ logoPath: result.path, enabled: true })
          await loadAvailableLogos()
        } else {
          alert('Failed to upload logo')
        }

        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('[LogoEditor] Failed to upload logo:', error)
      alert('Failed to upload logo')
      setUploading(false)
    }
  }

  const selectExistingLogo = (logoPath: string) => {
    updateSettings({ logoPath, enabled: true })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-text-muted">Loading logo settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Logo & Watermark</h3>
        <p className="text-xs text-text-muted">
          Add a logo or watermark overlay to your video
        </p>
      </div>

      {/* Enable Logo Toggle */}
      <label className="flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => updateSettings({ enabled: e.target.checked })}
          className="w-4 h-4 text-accent-primary rounded border-border-default"
        />
        <span className="text-sm text-text-primary font-medium">Enable Logo</span>
      </label>

      {settings.enabled && (
        <>
          {/* Logo Upload */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Logo File</div>

            {/* Drag & Drop Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive
                  ? 'border-accent-primary bg-accent-primary/5'
                  : 'border-border-default bg-bg-tertiary'
              }`}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <IoCloudUploadOutline className="mx-auto text-4xl text-text-muted mb-2" />
              {uploading ? (
                <p className="text-sm text-text-primary">Uploading...</p>
              ) : (
                <>
                  <p className="text-sm text-text-primary mb-1">
                    Drag & drop logo here
                  </p>
                  <p className="text-xs text-text-muted mb-3">
                    or
                  </p>
                  <label className="inline-block px-4 py-2 bg-accent-primary text-white rounded cursor-pointer hover:bg-accent-primary/90 transition-colors">
                    <span className="text-sm">Choose File</span>
                    <input
                      type="file"
                      accept="image/png,image/svg+xml,image/jpeg,image/jpg,image/webp"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-text-muted mt-2">
                    PNG, SVG, JPG, WebP (max 2MB)
                  </p>
                </>
              )}
            </div>

            {/* Current Logo */}
            {settings.logoPath && (
              <div className="p-2 bg-bg-primary rounded border border-border-default">
                <div className="text-xs text-text-muted mb-1">Current Logo:</div>
                <div className="text-xs text-text-primary font-mono truncate">
                  {settings.logoPath.split('/').pop()}
                </div>
              </div>
            )}

            {/* Available Logos */}
            {availableLogos.length > 0 && (
              <div>
                <div className="text-xs text-text-muted mb-2">Previously Uploaded:</div>
                <div className="grid grid-cols-3 gap-2">
                  {availableLogos.map((logo, index) => (
                    <button
                      key={index}
                      onClick={() => selectExistingLogo(logo)}
                      className={`p-2 rounded border text-xs truncate transition-colors ${
                        settings.logoPath === logo
                          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                          : 'border-border-default bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                      }`}
                      title={logo.split('/').pop()}
                    >
                      {logo.split('/').pop()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Size & Opacity Controls */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Size & Opacity</div>

            <div className="space-y-3">
              {/* Size Slider */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Size: {Math.round(settings.scale * 100)}% of video width
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="0.3"
                  step="0.01"
                  value={settings.scale}
                  onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>

              {/* Opacity Slider */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Opacity: {Math.round(settings.opacity * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.opacity}
                  onChange={(e) => updateSettings({ opacity: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>
            </div>
          </div>

          {/* Tip */}
          <div className="p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-lg">
            <p className="text-xs text-text-secondary">
              💡 <span className="font-medium">Tip:</span> Drag your logo on the video preview to position it exactly where you want
            </p>
          </div>
        </>
      )}
    </div>
  )
}
