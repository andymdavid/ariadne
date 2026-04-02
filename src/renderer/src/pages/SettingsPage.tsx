import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { MainContentPanel } from '../components/MainContentPanel'

interface ConfigState {
  openRouterKey: string
  model:
    | 'google-gemini-2.5-flash'
    | 'google-gemini-2.5-pro'
    | 'anthropic-claude-sonnet-4.6'
    | 'openai-gpt-5.4'
    | 'deepseek-r1'
    | 'google-gemini-2.5-flash-lite'
  clipSelectionPlatform: 'youtube_shorts' | 'instagram_reels' | 'tiktok'
  autoApproveThreshold: number
  defaultExportFormat: '9:16' | '1:1' | '16:9'
  isValid: boolean
  errors: string[]
}

const modelOptions: Array<{
  value: ConfigState['model']
  label: string
  badge?: string
  pricing: string
}> = [
  {
    value: 'google-gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    badge: 'Balanced',
    pricing: '~$0.30/M input • ~$2.50/M output'
  },
  {
    value: 'google-gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    badge: 'Quality',
    pricing: '~$1.25/M input • ~$10/M output'
  },
  {
    value: 'anthropic-claude-sonnet-4.6',
    label: 'Claude Sonnet 4.6',
    badge: 'Quality',
    pricing: '~$3/M input • ~$15/M output'
  },
  {
    value: 'openai-gpt-5.4',
    label: 'GPT-5.4',
    badge: 'Quality',
    pricing: '~$2.50/M input • ~$15/M output'
  },
  {
    value: 'google-gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    badge: 'Budget',
    pricing: '~$0.10/M input • ~$0.40/M output'
  },
  {
    value: 'deepseek-r1',
    label: 'DeepSeek R1',
    badge: 'Budget',
    pricing: '~$0.70/M input • ~$2.50/M output'
  }
]

export function SettingsPage() {
  const backgroundImagesEnabled = useSettingsStore((state) => state.backgroundImagesEnabled)
  const toggleBackgroundImages = useSettingsStore((state) => state.toggleBackgroundImages)

  const [config, setConfig] = useState<ConfigState>({
    openRouterKey: '',
    model: 'google-gemini-2.5-flash',
    clipSelectionPlatform: 'youtube_shorts',
    autoApproveThreshold: 8.0,
    defaultExportFormat: '9:16',
    isValid: false,
    errors: []
  })
  const [isSaving, setIsSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    void loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const data = await window.electronAPI?.getConfig()
      if (data) {
        setConfig({
          openRouterKey: data.apiConfig.openRouterKey || '',
          model: data.apiConfig.model || 'google-gemini-2.5-flash',
          clipSelectionPlatform: data.apiConfig.clipSelectionPlatform || 'youtube_shorts',
          autoApproveThreshold: data.userPreferences.autoApproveThreshold || 8.0,
          defaultExportFormat: data.userPreferences.defaultExportFormat || '9:16',
          isValid: data.isConfigured,
          errors: []
        })
      }
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  const validateConfig = async () => {
    try {
      const validation = await window.electronAPI?.validateConfig()
      if (validation) {
        setConfig((prev) => ({
          ...prev,
          isValid: validation.isValid,
          errors: validation.errors
        }))
      }
    } catch (error) {
      console.error('Validation failed:', error)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    setSaveMessage('')

    try {
      await window.electronAPI?.updateApiConfig({
        openRouterKey: config.openRouterKey,
        model: config.model,
        clipSelectionPlatform: config.clipSelectionPlatform
      })

      await window.electronAPI?.updateUserPreferences({
        autoApproveThreshold: config.autoApproveThreshold,
        defaultExportFormat: config.defaultExportFormat
      })

      await validateConfig()

      setSaveMessage('Settings saved successfully!')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save config:', error)
      setSaveMessage('Failed to save settings')
    }

    setIsSaving(false)
  }

  const handleApiKeyChange = (value: string) => {
    setConfig((prev) => ({ ...prev, openRouterKey: value }))
  }

  const handleModelChange = (model: ConfigState['model']) => {
    setConfig((prev) => ({ ...prev, model }))
  }

  const saveToneClass = saveMessage.includes('success') ? 'text-accent-success' : 'text-accent-danger'

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex min-h-full flex-col gap-8">
          <div className="app-page-header">
            <div className="app-page-header-shell">
              <div className="app-page-header-content">
                <div className="app-page-title">Settings</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">
                  Configure models, defaults, and local appearance preferences.
                </div>
              </div>

              <div className="app-page-header-actions">
                <div className="app-chip">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      config.isValid ? 'bg-accent-success' : 'bg-accent-warning'
                    }`}
                  />
                  <span>{config.isValid ? 'Valid' : 'Setup required'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6">
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
              <section className="app-section-shell">
                <div className="app-section-header">
                  <div>
                    <h2 className="app-section-title">AI Configuration</h2>
                  </div>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-text-secondary">
                      OpenRouter API Key
                    </label>
                    <div className="flex gap-2">
                      <input
                        type={showApiKey ? 'text' : 'password'}
                        value={config.openRouterKey}
                        onChange={(e) => handleApiKeyChange(e.target.value)}
                        placeholder="sk-or-..."
                        className="input flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="btn-secondary"
                      >
                        {showApiKey ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      Get your API key from{' '}
                      <a
                        href="https://openrouter.ai/keys"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-primary underline decoration-white/20 underline-offset-4"
                      >
                        openrouter.ai/keys
                      </a>
                    </p>
                  </div>

                  <div>
                    <label className="mb-3 block text-sm font-medium text-text-secondary">
                      AI Model
                    </label>
                    <div className="space-y-2">
                      {modelOptions.map((option) => (
                        <label
                          key={option.value}
                          className={`app-list-row cursor-pointer transition-colors ${
                            config.model === option.value ? 'border-white/12 bg-[#131313]' : ''
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <input
                              type="radio"
                              name="model"
                              checked={config.model === option.value}
                              onChange={() => handleModelChange(option.value)}
                              className="mt-1"
                            />
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-text-primary">{option.label}</span>
                                {option.badge && (
                                  <span className="text-xs text-text-muted">{option.badge}</span>
                                )}
                              </div>
                              <p className="mt-1 text-xs text-text-muted">{option.pricing}</p>
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-text-secondary">
                        Clip Selection Platform
                      </label>
                      <select
                        value={config.clipSelectionPlatform}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            clipSelectionPlatform: e.target.value as ConfigState['clipSelectionPlatform']
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="youtube_shorts">YouTube Shorts</option>
                        <option value="instagram_reels">Instagram Reels</option>
                        <option value="tiktok">TikTok</option>
                      </select>
                      <p className="mt-2 text-xs text-text-muted">
                        Tunes ranking toward platform-specific hooks and endings.
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-text-secondary">
                        Default Export Format
                      </label>
                      <select
                        value={config.defaultExportFormat}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            defaultExportFormat: e.target.value as '9:16' | '1:1' | '16:9'
                          }))
                        }
                        className="input w-full"
                      >
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="16:9">16:9</option>
                      </select>
                    </div>
                  </div>
                </div>
              </section>

              <div className="flex flex-col gap-6">
                <section className="app-section-shell">
                  <div className="app-section-header">
                    <div>
                      <h2 className="app-section-title">Appearance</h2>
                    </div>
                  </div>

                  <div className="app-list-row">
                    <div>
                      <div className="text-sm font-medium text-text-primary">Background images</div>
                      <div className="mt-1 text-xs text-text-muted">
                        Enable landscape backgrounds in the app shell.
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={toggleBackgroundImages}
                      className={`template-settings-toggle ${backgroundImagesEnabled ? 'is-on' : ''}`}
                      aria-label="Toggle background images"
                    >
                      <span className="template-settings-toggle-thumb" />
                    </button>
                  </div>
                </section>

                <section className="app-section-shell">
                  <div className="app-section-header">
                    <div>
                      <h2 className="app-section-title">Processing Preferences</h2>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-text-secondary">
                        Auto-Approve Threshold: {config.autoApproveThreshold.toFixed(1)}
                      </label>
                      <input
                        type="range"
                        min="6.0"
                        max="10.0"
                        step="0.1"
                        value={config.autoApproveThreshold}
                        onChange={(e) =>
                          setConfig((prev) => ({
                            ...prev,
                            autoApproveThreshold: parseFloat(e.target.value)
                          }))
                        }
                        className="w-full"
                      />
                      <p className="mt-2 text-xs text-text-muted">
                        Clips above this threshold will be automatically approved.
                      </p>
                    </div>

                    {config.errors.length > 0 && (
                      <div className="app-surface-muted p-4">
                        <div className="text-sm font-medium text-text-primary">Validation issues</div>
                        <ul className="mt-2 space-y-1 text-xs text-text-muted">
                          {config.errors.map((error) => (
                            <li key={error}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-white/8 pt-4">
              <div className={`text-sm ${saveMessage ? saveToneClass : 'text-text-muted'}`}>
                {saveMessage || 'Changes save to local app config.'}
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={() => void validateConfig()} className="app-action-secondary">
                  Validate Config
                </button>
                <button type="button" onClick={() => void handleSave()} disabled={isSaving} className="app-action-primary">
                  {isSaving ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
