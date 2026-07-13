import { useState, useEffect, useRef } from 'react'
import { IoSaveOutline, IoCopyOutline, IoPlayOutline, IoPauseOutline } from 'react-icons/io5'

interface CaptionEditorProps {
  clipId: string
  episodeId: string
  clipStartTime: number
  clipEndTime: number
  onSave?: (edits: any) => void
  onApplyToAll?: () => void
}

interface CaptionSegment {
  text: string
  start: number
  end: number
  words?: Array<{ word: string; start: number; end: number }>
}

interface CaptionSettings {
  enabled: boolean
  segments: CaptionSegment[]
  font: string
  size: number
  color: string
  position: 'top' | 'center' | 'bottom'
  bold: boolean
  italic: boolean
  outline: boolean
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  highlightStyle: 'word' | 'phrase'
  background: boolean
  backgroundColor: string
  backgroundOpacity: number
}

const defaultSettings: CaptionSettings = {
  enabled: true,
  segments: [],
  font: 'Inter',
  size: 48,
  color: '#FFFFFF',
  position: 'center',
  bold: true,
  italic: false,
  outline: false,
  outlineColor: '#000000',
  outlineWidth: 2,
  shadow: false,
  highlightStyle: 'word',
  background: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.5
}

export function CaptionEditor({ clipId, episodeId, clipStartTime, clipEndTime, onSave, onApplyToAll }: CaptionEditorProps) {
  const [settings, setSettings] = useState<CaptionSettings>(defaultSettings)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [applyingToAll, setApplyingToAll] = useState(false)
  const [clipPath, setClipPath] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [editingSegmentIndex, setEditingSegmentIndex] = useState<number | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)

  // Load existing edits and transcript
  useEffect(() => {
    loadCaptionData()
    loadClipVideo()
  }, [clipId])

  // Sync video time updates
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
    }

    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [clipPath])

  const loadClipVideo = async () => {
    try {
      // Use playClip to extract/get the clip video
      const result = await window.electronAPI?.playClip?.(episodeId, clipStartTime, clipEndTime, clipId)

      if (result?.clipPath) {
        // Convert file path to app-file:// protocol
        setClipPath(`app-file://${result.clipPath}`)
      }
    } catch (error) {
      console.error('Failed to load clip video:', error)
    }
  }

  const loadCaptionData = async () => {
    try {
      setLoading(true)

      console.log('[CaptionEditor] Loading caption data for clip:', clipId)
      console.log('[CaptionEditor] Clip time range:', clipStartTime, 'to', clipEndTime)

      // First, try to load existing clip edits
      const existingEdits = await window.electronAPI?.getClipEdits?.(clipId)
      console.log('[CaptionEditor] Existing edits:', existingEdits)

      let segments: CaptionSegment[] = []

      if (existingEdits && existingEdits.caption_segments) {
        // Use saved segments if they exist
        segments = JSON.parse(existingEdits.caption_segments)
        console.log('[CaptionEditor] Loaded saved segments:', segments.length)
      } else {
        // Otherwise, fetch original transcript segments for this clip
        console.log('[CaptionEditor] Fetching transcript segments from database...')
        const transcriptSegments = await window.electronAPI?.getClipTranscriptSegments?.(clipId)
        console.log('[CaptionEditor] Raw transcript segments:', transcriptSegments)

        if (transcriptSegments && transcriptSegments.length > 0) {
          // Convert episode timestamps to clip-relative timestamps (subtract clip start time),
          // clamping to the clip window and keeping word-level timing so exports stay in sync
          const clipDuration = Math.max(0, clipEndTime - clipStartTime)
          segments = transcriptSegments.map((seg: any) => {
            const words = Array.isArray(seg.words)
              ? seg.words
                  .filter((word: any) =>
                    Number(word.end) > clipStartTime && Number(word.start) < clipEndTime
                  )
                  .map((word: any) => ({
                    word: String(word.word ?? ''),
                    start: Math.max(0, Math.min(clipDuration, Number(word.start) - clipStartTime)),
                    end: Math.max(0, Math.min(clipDuration, Number(word.end) - clipStartTime))
                  }))
              : []

            return {
              text: words.length > 0 ? words.map((word: any) => word.word).join(' ') : seg.text,
              start: Math.max(0, seg.start_time - clipStartTime),
              end: Math.min(clipDuration, seg.end_time - clipStartTime),
              ...(words.length > 0 ? { words } : {})
            }
          })
          console.log('[CaptionEditor] Converted to clip-relative segments:', segments)
        } else {
          console.warn('[CaptionEditor] No transcript segments found!')
        }
      }

      // Set settings (use existing edits or defaults)
      setSettings({
        enabled: existingEdits ? existingEdits.captions_enabled === 1 : defaultSettings.enabled,
        segments,
        font: existingEdits?.caption_font || defaultSettings.font,
        size: existingEdits?.caption_size || defaultSettings.size,
        color: existingEdits?.caption_color || defaultSettings.color,
        position: existingEdits?.caption_position || defaultSettings.position,
        bold: existingEdits ? existingEdits.caption_bold === 1 : defaultSettings.bold,
        italic: existingEdits ? existingEdits.caption_italic === 1 : defaultSettings.italic,
        outline: existingEdits ? existingEdits.caption_outline === 1 : defaultSettings.outline,
        outlineColor: existingEdits?.caption_outline_color || defaultSettings.outlineColor,
        outlineWidth: existingEdits?.caption_outline_width || defaultSettings.outlineWidth,
        shadow: existingEdits ? existingEdits.caption_shadow === 1 : defaultSettings.shadow,
        highlightStyle: existingEdits?.caption_highlight_style || defaultSettings.highlightStyle,
        background: existingEdits ? existingEdits.caption_background === 1 : defaultSettings.background,
        backgroundColor: existingEdits?.caption_background_color || defaultSettings.backgroundColor,
        backgroundOpacity: existingEdits?.caption_background_opacity || defaultSettings.backgroundOpacity
      })

      console.log('[CaptionEditor] Settings configured. Captions enabled:', defaultSettings.enabled)

      setLoading(false)
    } catch (error) {
      console.error('Failed to load caption data:', error)
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)

      const edits = {
        captions_enabled: settings.enabled ? 1 : 0,
        caption_segments: JSON.stringify(settings.segments),
        caption_font: settings.font,
        caption_size: settings.size,
        caption_color: settings.color,
        caption_position: settings.position,
        caption_bold: settings.bold ? 1 : 0,
        caption_italic: settings.italic ? 1 : 0,
        caption_outline: settings.outline ? 1 : 0,
        caption_outline_color: settings.outlineColor,
        caption_outline_width: settings.outlineWidth,
        caption_shadow: settings.shadow ? 1 : 0,
        caption_highlight_style: settings.highlightStyle,
        caption_background: settings.background ? 1 : 0,
        caption_background_color: settings.backgroundColor,
        caption_background_opacity: settings.backgroundOpacity
      }

      await window.electronAPI?.saveClipEdits?.(clipId, edits)

      if (onSave) {
        onSave(edits)
      }

      setSaving(false)
    } catch (error) {
      console.error('Failed to save caption edits:', error)
      setSaving(false)
    }
  }

  // Get active caption segment for current video time
  const getActiveSegment = () => {
    const index = settings.segments.findIndex(
      seg => currentTime >= seg.start && currentTime <= seg.end
    )

    // Debug logging (only log when time changes significantly to avoid spam)
    if (Math.floor(currentTime * 2) !== Math.floor((currentTime - 0.5) * 2)) {
      console.log('[CaptionEditor] Current time:', currentTime.toFixed(2), '| Active segment:', index)
    }

    return index
  }

  const handleCaptionClick = (index: number) => {
    setEditingSegmentIndex(index)
    // Pause video when editing
    if (videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause()
    }
  }

  const handleCaptionEdit = (index: number, newText: string) => {
    const newSegments = [...settings.segments]
    // Drop word-level timing for edited text — the stale words would otherwise
    // override the edited text during word-highlight export
    const { words: _staleWords, ...segment } = newSegments[index]
    newSegments[index] = { ...segment, text: newText }
    setSettings({ ...settings, segments: newSegments })
  }

  const handleCaptionBlur = () => {
    setEditingSegmentIndex(null)
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

  const handleApplyToAll = async () => {
    if (!window.confirm('This will apply the current caption styling to all approved clips. Continue?')) {
      return
    }

    try {
      setApplyingToAll(true)

      // Get all approved clips for this episode
      const approvedClips = await window.electronAPI?.getApprovedClips?.(episodeId)

      if (!approvedClips || approvedClips.length === 0) {
        console.log('No approved clips found')
        setApplyingToAll(false)
        return
      }

      // Apply current styling settings to all clips (but not the transcript text)
      const styleOnlyEdits = {
        captions_enabled: settings.enabled ? 1 : 0,
        caption_font: settings.font,
        caption_size: settings.size,
        caption_color: settings.color,
        caption_position: settings.position,
        caption_bold: settings.bold ? 1 : 0,
        caption_italic: settings.italic ? 1 : 0,
        caption_outline: settings.outline ? 1 : 0,
        caption_outline_color: settings.outlineColor,
        caption_outline_width: settings.outlineWidth,
        caption_shadow: settings.shadow ? 1 : 0,
        caption_highlight_style: settings.highlightStyle,
        caption_background: settings.background ? 1 : 0,
        caption_background_color: settings.backgroundColor,
        caption_background_opacity: settings.backgroundOpacity
      }

      // Apply to each clip
      for (const clip of approvedClips) {
        // Get existing edits for this clip (to preserve transcript segments)
        const existingEdits = await window.electronAPI?.getClipEdits?.(clip.id)

        // Merge style settings with existing edits
        const mergedEdits = {
          ...styleOnlyEdits,
          caption_segments: existingEdits?.caption_segments || null
        }

        await window.electronAPI?.saveClipEdits?.(clip.id, mergedEdits)
      }

      if (onApplyToAll) {
        onApplyToAll()
      }

      setApplyingToAll(false)
      alert('Caption styling applied to all clips successfully!')
    } catch (error) {
      console.error('Failed to apply caption styling to all clips:', error)
      setApplyingToAll(false)
      alert('Failed to apply settings to all clips')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-text-muted">Loading caption data...</div>
      </div>
    )
  }

  const activeSegmentIndex = getActiveSegment()
  const activeSegment = activeSegmentIndex >= 0 ? settings.segments[activeSegmentIndex] : null

  // Debug info
  console.log('[CaptionEditor] Render state:', {
    enabled: settings.enabled,
    segmentCount: settings.segments.length,
    currentTime,
    activeSegmentIndex,
    hasActiveSegment: !!activeSegment
  })

  return (
    <div className="space-y-4">
      {/* Video Player with Caption Overlay */}
      <div className="legacy-editor-panel relative overflow-hidden" style={{ aspectRatio: '9/16', maxHeight: '70vh', margin: '0 auto' }}>
        {clipPath ? (
          <>
            <video
              ref={videoRef}
              src={clipPath}
              className="w-full h-full object-contain"
              controls={false}
            />

            {/* Caption Overlay */}
            {settings.enabled && activeSegment && (
              <div
                className="absolute left-0 right-0 flex items-center justify-center px-8 pointer-events-auto"
                style={{
                  [settings.position === 'top' ? 'top' : settings.position === 'center' ? 'top' : 'bottom']:
                    settings.position === 'center' ? '50%' : '10%',
                  transform: settings.position === 'center' ? 'translateY(-50%)' : 'none'
                }}
              >
                <div
                  contentEditable={editingSegmentIndex === activeSegmentIndex}
                  suppressContentEditableWarning
                  onClick={() => handleCaptionClick(activeSegmentIndex)}
                  onBlur={(e) => {
                    handleCaptionEdit(activeSegmentIndex, e.currentTarget.textContent || '')
                    handleCaptionBlur()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      e.currentTarget.blur()
                    }
                  }}
                  style={{
                    fontFamily: settings.font,
                    fontSize: `${settings.size}px`,
                    color: settings.color,
                    fontWeight: settings.bold ? 'bold' : 'normal',
                    fontStyle: settings.italic ? 'italic' : 'normal',
                    textShadow: settings.shadow ? '2px 2px 4px rgba(0,0,0,0.8)' : 'none',
                    WebkitTextStroke: settings.outline ? `${settings.outlineWidth}px ${settings.outlineColor}` : 'none',
                    backgroundColor: settings.background ? settings.backgroundColor : 'transparent',
                    opacity: settings.background ? settings.backgroundOpacity : 1,
                    padding: settings.background ? '12px 24px' : '0',
                    borderRadius: settings.background ? '8px' : '0',
                    cursor: editingSegmentIndex === activeSegmentIndex ? 'text' : 'pointer',
                    outline: editingSegmentIndex === activeSegmentIndex ? '2px solid #3b82f6' : 'none',
                    maxWidth: '90%',
                    textAlign: 'center'
                  }}
                  className="transition-all"
                >
                  {activeSegment.text}
                </div>
              </div>
            )}

            {/* Play/Pause Overlay */}
            <div className="absolute top-4 right-4">
              <button
                onClick={togglePlayPause}
                className="app-icon-button h-12 w-12 rounded-[5px] bg-black/60 hover:bg-black/70"
              >
                {isPlaying ? (
                  <IoPauseOutline className="text-white text-2xl" />
                ) : (
                  <IoPlayOutline className="text-white text-2xl ml-1" />
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            Loading video...
          </div>
        )}
      </div>

      {/* Compact Controls */}
      <div className="space-y-3">
        {/* Top Row: Enable + Actions */}
        <div className="flex items-center justify-between">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="w-4 h-4 text-accent-primary rounded"
            />
            <span className="text-sm text-text-primary font-medium">Enable Captions</span>
          </label>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleApplyToAll}
              disabled={applyingToAll || saving}
              className="btn-secondary text-sm flex items-center space-x-1 px-3 py-1.5"
              title="Apply caption styling to all approved clips"
            >
              <IoCopyOutline />
              <span>{applyingToAll ? 'Applying...' : 'Apply to All'}</span>
            </button>

            <button
              onClick={handleSave}
              disabled={saving || applyingToAll}
              className="btn-primary text-sm flex items-center space-x-1 px-3 py-1.5"
            >
              <IoSaveOutline />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>

        {settings.enabled && (
          <>
            {/* Styling Controls - Compact Horizontal Layout */}
            <div className="grid grid-cols-4 gap-3">
              {/* Font */}
              <div>
                <label className="block text-xs text-text-muted mb-1">Font</label>
                <select
                  value={settings.font}
                  onChange={(e) => setSettings({ ...settings, font: e.target.value })}
                  className="legacy-editor-select text-sm"
                >
                  <option value="Inter">Inter</option>
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Montserrat">Montserrat</option>
                </select>
              </div>

              {/* Size */}
              <div>
                <label className="block text-xs text-text-muted mb-1">Size: {settings.size}px</label>
                <input
                  type="range"
                  min="24"
                  max="96"
                  step="4"
                  value={settings.size}
                  onChange={(e) => setSettings({ ...settings, size: Number(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs text-text-muted mb-1">Color</label>
                <input
                  type="color"
                  value={settings.color}
                  onChange={(e) => setSettings({ ...settings, color: e.target.value })}
                  className="legacy-editor-color"
                />
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs text-text-muted mb-1">Position</label>
                <select
                  value={settings.position}
                  onChange={(e) => setSettings({ ...settings, position: e.target.value as any })}
                  className="legacy-editor-select text-sm"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                </select>
              </div>
            </div>

            {/* Style Toggles - Compact Row */}
            <div className="flex items-center gap-6 pt-2">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.bold}
                  onChange={(e) => setSettings({ ...settings, bold: e.target.checked })}
                  className="w-3.5 h-3.5 text-accent-primary rounded"
                />
                <span className="text-xs text-text-primary">Bold</span>
              </label>

              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.italic}
                  onChange={(e) => setSettings({ ...settings, italic: e.target.checked })}
                  className="w-3.5 h-3.5 text-accent-primary rounded"
                />
                <span className="text-xs text-text-primary">Italic</span>
              </label>

              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.outline}
                  onChange={(e) => setSettings({ ...settings, outline: e.target.checked })}
                  className="w-3.5 h-3.5 text-accent-primary rounded"
                />
                <span className="text-xs text-text-primary">Outline</span>
              </label>

              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.shadow}
                  onChange={(e) => setSettings({ ...settings, shadow: e.target.checked })}
                  className="w-3.5 h-3.5 text-accent-primary rounded"
                />
                <span className="text-xs text-text-primary">Shadow</span>
              </label>

              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.background}
                  onChange={(e) => setSettings({ ...settings, background: e.target.checked })}
                  className="w-3.5 h-3.5 text-accent-primary rounded"
                />
                <span className="text-xs text-text-primary">Background</span>
              </label>
            </div>

            {/* Advanced Settings - Collapsible */}
            {(settings.outline || settings.background) && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-default">
                {settings.outline && (
                  <>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Outline Color</label>
                      <input
                        type="color"
                        value={settings.outlineColor}
                        onChange={(e) => setSettings({ ...settings, outlineColor: e.target.value })}
                        className="legacy-editor-color"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Width: {settings.outlineWidth}px</label>
                      <input
                        type="range"
                        min="1"
                        max="8"
                        value={settings.outlineWidth}
                        onChange={(e) => setSettings({ ...settings, outlineWidth: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                  </>
                )}

                {settings.background && (
                  <>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">BG Color</label>
                      <input
                        type="color"
                        value={settings.backgroundColor}
                        onChange={(e) => setSettings({ ...settings, backgroundColor: e.target.value })}
                        className="legacy-editor-color"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">Opacity: {Math.round(settings.backgroundOpacity * 100)}%</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={settings.backgroundOpacity}
                        onChange={(e) => setSettings({ ...settings, backgroundOpacity: Number(e.target.value) })}
                        className="w-full"
                      />
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
