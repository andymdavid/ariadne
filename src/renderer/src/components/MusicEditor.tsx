import { useState, useEffect } from 'react'
import { IoMusicalNotesOutline } from 'react-icons/io5'

export interface MusicSettings {
  enabled: boolean
  musicPath: string | null
  volume: number           // Base volume 0 to 1 (default 0.3)
  duckVolume: number      // Duck volume 0 to 0.5 (default 0.1)
  duckEnabled: boolean    // Toggle for ducking feature
  fadeIn: number          // Fade in duration in seconds 0-5 (default 1.0)
  fadeOut: number         // Fade out duration in seconds 0-5 (default 1.0)
  loop: boolean           // Loop if clip is longer than audio
}

export interface MusicEditorProps {
  clipId: string
  currentSettings: MusicSettings | null
  onSettingsChange: (settings: MusicSettings) => void
}

const defaultSettings: MusicSettings = {
  enabled: false,
  musicPath: null,
  volume: 0.3,
  duckVolume: 0.1,
  duckEnabled: true,
  fadeIn: 1.0,
  fadeOut: 1.0,
  loop: true
}

export function MusicEditor({
  clipId,
  currentSettings,
  onSettingsChange
}: MusicEditorProps) {
  const [settings, setSettings] = useState<MusicSettings>(currentSettings || defaultSettings)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [availableMusic, setAvailableMusic] = useState<string[]>([])

  // Load existing music settings on mount
  useEffect(() => {
    loadMusicSettings()
    loadAvailableMusic()
  }, [clipId])

  // Notify parent of settings changes
  useEffect(() => {
    onSettingsChange(settings)
  }, [settings])

  const loadMusicSettings = async () => {
    try {
      setLoading(true)
      console.log('[MusicEditor] Loading settings for clip:', clipId)

      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[MusicEditor] Existing edits:', existingEdits)

      if (existingEdits) {
        setSettings({
          enabled: existingEdits.music_enabled === 1,
          musicPath: existingEdits.music_path || null,
          volume: existingEdits.music_volume ?? defaultSettings.volume,
          duckVolume: existingEdits.music_duck_volume ?? defaultSettings.duckVolume,
          duckEnabled: existingEdits.music_duck_enabled === 1,
          fadeIn: existingEdits.music_fade_in ?? defaultSettings.fadeIn,
          fadeOut: existingEdits.music_fade_out ?? defaultSettings.fadeOut,
          loop: existingEdits.music_loop === 1
        })
      }

      setLoading(false)
    } catch (error) {
      console.error('[MusicEditor] Failed to load music settings:', error)
      setLoading(false)
    }
  }

  const loadAvailableMusic = async () => {
    try {
      const music = await window.electronAPI?.listMusic?.()
      setAvailableMusic(music || [])
    } catch (error) {
      console.error('[MusicEditor] Failed to load available music:', error)
    }
  }

  const updateSettings = (updates: Partial<MusicSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }))
  }

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    await uploadMusic(file)
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

    await uploadMusic(file)
  }

  const uploadMusic = async (file: File) => {
    // Validate file type
    const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a']
    if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a)$/i)) {
      alert('Invalid file type. Please upload MP3, WAV, or M4A.')
      return
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('File too large. Maximum size is 10MB.')
      return
    }

    try {
      setUploading(true)

      // Read file as base64 to send to main process
      const reader = new FileReader()
      reader.onload = async () => {
        const base64Data = reader.result as string

        // Upload via IPC
        const result = await window.electronAPI?.uploadMusic?.(base64Data, file.name)

        if (result?.success && result.path) {
          updateSettings({ musicPath: result.path, enabled: true })
          await loadAvailableMusic()
        } else {
          alert('Failed to upload music')
        }

        setUploading(false)
      }
      reader.readAsDataURL(file)
    } catch (error) {
      console.error('[MusicEditor] Failed to upload music:', error)
      alert('Failed to upload music')
      setUploading(false)
    }
  }

  const selectExistingMusic = (musicPath: string) => {
    updateSettings({ musicPath, enabled: true })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-text-muted">Loading music settings...</div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Background Music</h3>
        <p className="text-xs text-text-muted">
          Add background music with auto-ducking during speech
        </p>
      </div>

      {/* Enable Music Toggle */}
      <label className="flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => updateSettings({ enabled: e.target.checked })}
          className="w-4 h-4 text-accent-primary rounded border-border-default"
        />
        <span className="text-sm text-text-primary font-medium">Enable Background Music</span>
      </label>

      {settings.enabled && (
        <>
          {/* Music Upload */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Audio File</div>

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
              <IoMusicalNotesOutline className="mx-auto text-4xl text-text-muted mb-2" />
              {uploading ? (
                <p className="text-sm text-text-primary">Uploading...</p>
              ) : (
                <>
                  <p className="text-sm text-text-primary mb-1">
                    Drag & drop audio here
                  </p>
                  <p className="text-xs text-text-muted mb-3">
                    or
                  </p>
                  <label className="inline-block px-4 py-2 bg-accent-primary text-white rounded cursor-pointer hover:bg-accent-primary/90 transition-colors">
                    <span className="text-sm">Choose File</span>
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,.mp3,.wav,.m4a"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                  </label>
                  <p className="text-xs text-text-muted mt-2">
                    MP3, WAV, M4A (max 10MB)
                  </p>
                </>
              )}
            </div>

            {/* Current Music */}
            {settings.musicPath && (
              <div className="p-2 bg-bg-primary rounded border border-border-default">
                <div className="text-xs text-text-muted mb-1">Current Music:</div>
                <div className="text-xs text-text-primary font-mono truncate">
                  {settings.musicPath.split('/').pop()}
                </div>
              </div>
            )}

            {/* Available Music */}
            {availableMusic.length > 0 && (
              <div>
                <div className="text-xs text-text-muted mb-2">Previously Uploaded:</div>
                <div className="grid grid-cols-2 gap-2">
                  {availableMusic.map((music, index) => (
                    <button
                      key={index}
                      onClick={() => selectExistingMusic(music)}
                      className={`p-2 rounded border text-xs truncate transition-colors ${
                        settings.musicPath === music
                          ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                          : 'border-border-default bg-bg-primary text-text-secondary hover:bg-bg-tertiary'
                      }`}
                      title={music.split('/').pop()}
                    >
                      {music.split('/').pop()}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Volume Settings */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Volume Settings</div>

            <div className="space-y-3">
              {/* Base Volume Slider */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Base Volume: {Math.round(settings.volume * 100)}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={settings.volume}
                  onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
                <p className="text-xs text-text-muted mt-1">
                  Normal music volume when no speech
                </p>
              </div>

              {/* Duck During Speech Toggle */}
              <label className="flex items-center space-x-2 cursor-pointer mt-4">
                <input
                  type="checkbox"
                  checked={settings.duckEnabled}
                  onChange={(e) => updateSettings({ duckEnabled: e.target.checked })}
                  className="w-4 h-4 text-accent-primary rounded border-border-default"
                />
                <span className="text-sm text-text-primary">Duck During Speech</span>
              </label>

              {/* Duck Volume Slider */}
              {settings.duckEnabled && (
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">
                    Duck Volume: {Math.round(settings.duckVolume * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="0.5"
                    step="0.05"
                    value={settings.duckVolume}
                    onChange={(e) => updateSettings({ duckVolume: Number(e.target.value) })}
                    className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Music volume when speech is detected
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Fade Effects */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Fade Effects</div>

            <div className="space-y-3">
              {/* Fade In Slider */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Fade In: {settings.fadeIn.toFixed(1)}s
                </label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={settings.fadeIn}
                  onChange={(e) => updateSettings({ fadeIn: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>

              {/* Fade Out Slider */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">
                  Fade Out: {settings.fadeOut.toFixed(1)}s
                </label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  step="0.1"
                  value={settings.fadeOut}
                  onChange={(e) => updateSettings({ fadeOut: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>
            </div>
          </div>

          {/* Loop Setting */}
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.loop}
              onChange={(e) => updateSettings({ loop: e.target.checked })}
              className="w-4 h-4 text-accent-primary rounded border-border-default"
            />
            <span className="text-sm text-text-primary">Loop if clip is longer than audio</span>
          </label>

          {/* Tip */}
          <div className="p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-lg">
            <p className="text-xs text-text-secondary">
              💡 <span className="font-medium">Tip:</span> Music will automatically duck (lower volume) during speech segments to ensure dialogue clarity
            </p>
          </div>
        </>
      )}
    </div>
  )
}
