import { useState, useEffect, useRef } from 'react'

interface TranscriptSegment {
  text: string
  start: number
  end: number
}

export interface CaptionStyle {
  enabled: boolean
  font: string
  size: number
  color: string
  position: 'top' | 'center' | 'bottom' | 'custom'
  customX?: number  // Percentage 0-100
  customY?: number  // Percentage 0-100
  weight: number // Font weight: 100-900 (Thin to Black)
  italic: boolean
  outline: boolean
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  highlightStyle: 'word' | 'phrase' | 'none'
  background: boolean
  backgroundColor: string
  backgroundOpacity: number
  textCase: 'normal' | 'uppercase' | 'lowercase'
  wordsPerCaption: number
  maxWidth: number  // Percentage 10-100
  lineHeight: number  // Multiplier 1.0-3.0
  letterSpacing: number  // Pixels -5 to 20
}

export interface CaptionStyleEditorProps {
  clipId: string
  transcriptSegments: TranscriptSegment[]
  currentStyle: CaptionStyle | null
  onStyleChange: (style: CaptionStyle) => void
}

const defaultStyle: CaptionStyle = {
  enabled: true,
  font: 'Inter',
  size: 48,
  color: '#FFFFFF',
  position: 'center',
  customX: undefined,
  customY: undefined,
  weight: 700, // Bold
  italic: false,
  outline: false,
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

export function CaptionStyleEditor({
  clipId,
  transcriptSegments,
  currentStyle,
  onStyleChange
}: CaptionStyleEditorProps) {
  const [style, setStyle] = useState<CaptionStyle>(currentStyle || defaultStyle)
  const isInitialMount = useRef(true)

  // Only sync on initial mount, not on every currentStyle change
  useEffect(() => {
    if (isInitialMount.current && currentStyle) {
      console.log('[CaptionStyleEditor] Initial sync with parent style')
      setStyle(currentStyle)
      isInitialMount.current = false
    }
  }, [])

  // Notify parent of style changes (skip first render)
  // IMPORTANT: Preserve customX/customY from parent (set by dragging)
  useEffect(() => {
    if (!isInitialMount.current) {
      // Merge local style with parent's customX/customY to preserve drag positioning
      const mergedStyle = {
        ...style,
        customX: currentStyle?.customX ?? style.customX,
        customY: currentStyle?.customY ?? style.customY
      }
      console.log('[CaptionStyleEditor] User changed style, notifying parent:', mergedStyle)
      onStyleChange(mergedStyle)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style])

  const updateStyle = (updates: Partial<CaptionStyle>) => {
    console.log('[CaptionStyleEditor] Updating style with:', updates)
    setStyle(prev => ({ ...prev, ...updates }))
  }

  // Get a sample caption for preview
  const previewText = transcriptSegments && transcriptSegments.length > 0
    ? transcriptSegments[0].text
    : 'Apple is a hardware company, but AI is going to become...'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-base font-semibold text-text-primary mb-1">Caption Styling</h3>
        <p className="text-xs text-text-muted">
          Customize caption appearance. Caption text is edited in the Transcript tab.
        </p>
      </div>

      {/* Enable Captions Toggle */}
      <label className="flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          checked={style.enabled}
          onChange={(e) => updateStyle({ enabled: e.target.checked })}
          className="w-4 h-4 text-accent-primary rounded border-border-default"
        />
        <span className="text-sm text-text-primary font-medium">Enable Captions</span>
      </label>

      {style.enabled && (
        <>
          {/* Style Settings Grid */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Style Settings</div>

            <div className="grid grid-cols-2 gap-3">
              {/* Font */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Font</label>
                <select
                  value={style.font}
                  onChange={(e) => updateStyle({ font: e.target.value })}
                  className="w-full px-2 py-1.5 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="Inter">Inter</option>
                  <option value="Anton">Anton</option>
                  <option value="Arial">Arial</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Roboto">Roboto</option>
                  <option value="Montserrat">Montserrat</option>
                  <option value="Poppins">Poppins</option>
                </select>
              </div>

              {/* Position */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Position</label>
                <select
                  value={style.position}
                  onChange={(e) => {
                    const newPosition = e.target.value as any
                    if (newPosition !== 'custom') {
                      updateStyle({ position: newPosition, customX: undefined, customY: undefined })
                    }
                  }}
                  className="w-full px-2 py-1.5 text-sm bg-bg-primary border border-border-default rounded text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="top">Top</option>
                  <option value="center">Center</option>
                  <option value="bottom">Bottom</option>
                  {style.position === 'custom' && (
                    <option value="custom">Custom ({Math.round(style.customX || 50)}%, {Math.round(style.customY || 50)}%)</option>
                  )}
                </select>
                <p className="text-xs text-text-muted mt-1">💡 Drag caption on video to set custom position</p>
              </div>

              {/* Size */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Size: {style.size}px</label>
                <input
                  type="range"
                  min="24"
                  max="96"
                  step="4"
                  value={style.size}
                  onChange={(e) => updateStyle({ size: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>

              {/* Color */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Text Color</label>
                <div className="flex items-center space-x-2">
                  <input
                    type="color"
                    value={style.color}
                    onChange={(e) => updateStyle({ color: e.target.value })}
                    className="w-12 h-8 bg-bg-primary border border-border-default rounded cursor-pointer"
                  />
                  <span className="text-xs font-mono text-text-secondary">{style.color}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Layout & Spacing */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Layout & Spacing</div>

            <div className="grid grid-cols-3 gap-3">
              {/* Max Width */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Max Width: {style.maxWidth}%</label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={style.maxWidth}
                  onChange={(e) => updateStyle({ maxWidth: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>

              {/* Line Height */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Line Height: {style.lineHeight.toFixed(1)}</label>
                <input
                  type="range"
                  min="1.0"
                  max="3.0"
                  step="0.1"
                  value={style.lineHeight}
                  onChange={(e) => updateStyle({ lineHeight: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>

              {/* Letter Spacing */}
              <div>
                <label className="block text-xs text-text-muted mb-1.5">Letter Spacing: {style.letterSpacing}px</label>
                <input
                  type="range"
                  min="-5"
                  max="20"
                  step="1"
                  value={style.letterSpacing}
                  onChange={(e) => updateStyle({ letterSpacing: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
              </div>
            </div>
          </div>

          {/* Text Style Toggles */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Text Style</div>

            <div className="flex flex-wrap gap-4">
              <label className="flex flex-col space-y-1">
                <span className="text-xs text-text-primary">Font Weight</span>
                <select
                  value={style.weight}
                  onChange={(e) => updateStyle({ weight: parseInt(e.target.value) })}
                  className="px-2 py-1 text-xs bg-bg-primary border border-border-default rounded text-text-primary"
                >
                  <option value="100">Thin (100)</option>
                  <option value="200">ExtraLight (200)</option>
                  <option value="300">Light (300)</option>
                  <option value="400">Regular (400)</option>
                  <option value="500">Medium (500)</option>
                  <option value="600">SemiBold (600)</option>
                  <option value="700">Bold (700)</option>
                  <option value="800">ExtraBold (800)</option>
                  <option value="900">Black (900)</option>
                </select>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={style.italic}
                  onChange={(e) => updateStyle({ italic: e.target.checked })}
                  className="w-4 h-4 text-accent-primary rounded border-border-default"
                />
                <span className="text-xs text-text-primary">Italic</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={style.outline}
                  onChange={(e) => updateStyle({ outline: e.target.checked })}
                  className="w-4 h-4 text-accent-primary rounded border-border-default"
                />
                <span className="text-xs text-text-primary">Outline</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={style.shadow}
                  onChange={(e) => updateStyle({ shadow: e.target.checked })}
                  className="w-4 h-4 text-accent-primary rounded border-border-default"
                />
                <span className="text-xs text-text-primary">Shadow</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={style.background}
                  onChange={(e) => updateStyle({ background: e.target.checked })}
                  className="w-4 h-4 text-accent-primary rounded border-border-default"
                />
                <span className="text-xs text-text-primary">Background</span>
              </label>
            </div>

            {/* Text Case */}
            <div className="pt-2 border-t border-border-default">
              <label className="block text-xs text-text-muted mb-2">Text Case</label>
              <div className="flex gap-2">
                <button
                  onClick={() => updateStyle({ textCase: 'normal' })}
                  className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
                    style.textCase === 'normal'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  Normal
                </button>
                <button
                  onClick={() => updateStyle({ textCase: 'uppercase' })}
                  className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
                    style.textCase === 'uppercase'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  UPPERCASE
                </button>
                <button
                  onClick={() => updateStyle({ textCase: 'lowercase' })}
                  className={`flex-1 px-3 py-1.5 text-xs rounded transition-colors ${
                    style.textCase === 'lowercase'
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-primary'
                  }`}
                >
                  lowercase
                </button>
              </div>
            </div>

            {/* Outline Settings */}
            {style.outline && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-default">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Outline Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={style.outlineColor}
                      onChange={(e) => updateStyle({ outlineColor: e.target.value })}
                      className="w-12 h-8 bg-bg-primary border border-border-default rounded cursor-pointer"
                    />
                    <span className="text-xs font-mono text-text-secondary">{style.outlineColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Width: {style.outlineWidth}px</label>
                  <input
                    type="range"
                    min="1"
                    max="8"
                    value={style.outlineWidth}
                    onChange={(e) => updateStyle({ outlineWidth: Number(e.target.value) })}
                    className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                  />
                </div>
              </div>
            )}

            {/* Background Settings */}
            {style.background && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border-default">
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Background Color</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={style.backgroundColor}
                      onChange={(e) => updateStyle({ backgroundColor: e.target.value })}
                      className="w-12 h-8 bg-bg-primary border border-border-default rounded cursor-pointer"
                    />
                    <span className="text-xs font-mono text-text-secondary">{style.backgroundColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1.5">Opacity: {Math.round(style.backgroundOpacity * 100)}%</label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={style.backgroundOpacity}
                    onChange={(e) => updateStyle({ backgroundOpacity: Number(e.target.value) })}
                    className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Highlight Style */}
          <div className="space-y-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
            <div className="text-xs font-medium text-text-primary mb-2">Highlight Style</div>

            <div className="flex gap-3">
              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="highlightStyle"
                  checked={style.highlightStyle === 'word'}
                  onChange={() => updateStyle({ highlightStyle: 'word' })}
                  className="w-4 h-4 text-accent-primary"
                />
                <span className="text-xs text-text-primary">Word-by-word</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="highlightStyle"
                  checked={style.highlightStyle === 'phrase'}
                  onChange={() => updateStyle({ highlightStyle: 'phrase' })}
                  className="w-4 h-4 text-accent-primary"
                />
                <span className="text-xs text-text-primary">Full sentence</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="radio"
                  name="highlightStyle"
                  checked={style.highlightStyle === 'none'}
                  onChange={() => updateStyle({ highlightStyle: 'none' })}
                  className="w-4 h-4 text-accent-primary"
                />
                <span className="text-xs text-text-primary">No highlight</span>
              </label>
            </div>

            {/* Words Per Caption Slider */}
            {style.highlightStyle === 'word' && (
              <div className="pt-3 border-t border-border-default">
                <label className="block text-xs text-text-muted mb-1.5">
                  Words Per Caption: {style.wordsPerCaption} {style.wordsPerCaption === 1 ? 'word' : 'words'}
                </label>
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={style.wordsPerCaption}
                  onChange={(e) => updateStyle({ wordsPerCaption: Number(e.target.value) })}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent-primary"
                />
                <div className="flex justify-between text-xs text-text-muted mt-1">
                  <span>1</span>
                  <span>8</span>
                </div>
              </div>
            )}
          </div>

          {/* Tips */}
          <div className="p-3 bg-accent-primary/5 border border-accent-primary/20 rounded-lg space-y-2">
            <p className="text-xs text-text-secondary">
              💡 <span className="font-medium">Tip:</span> Drag the caption on the video preview to reposition it
            </p>
            <p className="text-xs text-text-secondary">
              📝 <span className="font-medium">Note:</span> Edit caption text in the Transcript tab
            </p>
          </div>
        </>
      )}
    </div>
  )
}
