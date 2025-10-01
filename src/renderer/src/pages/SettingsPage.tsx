import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { MainContentPanel } from '../components/MainContentPanel'

interface ConfigState {
  openRouterKey: string
  model: 'deepseek-r1' | 'claude-sonnet-4'
  autoApproveThreshold: number
  defaultExportFormat: '9:16' | '1:1' | '16:9'
  isValid: boolean
  errors: string[]
}

export function SettingsPage() {
  const backgroundImagesEnabled = useSettingsStore((state) => state.backgroundImagesEnabled)
  const toggleBackgroundImages = useSettingsStore((state) => state.toggleBackgroundImages)

  const [config, setConfig] = useState<ConfigState>({
    openRouterKey: '',
    model: 'deepseek-r1',
    autoApproveThreshold: 8.0,
    defaultExportFormat: '9:16',
    isValid: false,
    errors: []
  })
  const [isSaving, setIsSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      const data = await window.electronAPI?.getConfig()
      if (data) {
        setConfig({
          openRouterKey: data.apiConfig.openRouterKey || '',
          model: data.apiConfig.model || 'deepseek-r1',
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
        setConfig(prev => ({
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
      // Update API config
      await window.electronAPI?.updateApiConfig({
        openRouterKey: config.openRouterKey,
        model: config.model
      })
      
      // Update user preferences
      await window.electronAPI?.updateUserPreferences({
        autoApproveThreshold: config.autoApproveThreshold,
        defaultExportFormat: config.defaultExportFormat
      })
      
      // Validate
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
    setConfig(prev => ({ ...prev, openRouterKey: value }))
  }

  const handleModelChange = (model: 'deepseek-r1' | 'claude-sonnet-4') => {
    setConfig(prev => ({ ...prev, model }))
  }

  return (
    <MainContentPanel>
      <div className="flex-1 p-8 overflow-y-auto flex flex-col justify-center">
        {/* Header with inline status */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-text-primary mb-1">Settings</h1>
            <p className="text-text-secondary text-sm">
              Configure Ariadne for optimal performance and your workflow
            </p>
          </div>
          {/* Compact Configuration Status */}
          <div className="flex items-center space-x-2 px-3 py-1.5 rounded-full bg-bg-tertiary/50">
            <div className={`w-2 h-2 rounded-full ${
              config.isValid ? 'bg-accent-success' : 'bg-accent-warning'
            }`} />
            <span className="text-xs text-text-secondary">
              {config.isValid ? 'Valid' : 'Setup Required'}
            </span>
          </div>
        </div>

        {/* Three Card Horizontal Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Card 1 - AI Configuration */}
          <div className="settings-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-text-primary">AI Configuration</h2>

            <div className="space-y-4">
              {/* OpenRouter API Key */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  OpenRouter API Key
                </label>
                <div className="flex space-x-2">
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
                    {showApiKey ? '🙈' : '👁️'}
                  </button>
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Get your API key from{' '}
                  <a
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent-primary hover:underline"
                  >
                    openrouter.ai/keys
                  </a>
                </p>
              </div>

              {/* Model Selection */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  AI Model
                </label>
                <div className="space-y-2">
                  <label className="flex items-center space-x-3">
                    <input
                      type="radio"
                      name="model"
                      checked={config.model === 'deepseek-r1'}
                      onChange={() => handleModelChange('deepseek-r1')}
                      className="text-accent-primary"
                    />
                    <div>
                      <span className="text-text-primary">DeepSeek R1</span>
                      <span className="text-sm text-accent-success ml-2">(Recommended)</span>
                      <p className="text-xs text-text-muted">
                        ~$0.14/1M tokens • Fast and cost-effective
                      </p>
                    </div>
                  </label>
                  <label className="flex items-center space-x-3">
                    <input
                      type="radio"
                      name="model"
                      checked={config.model === 'claude-sonnet-4'}
                      onChange={() => handleModelChange('claude-sonnet-4')}
                      className="text-accent-primary"
                    />
                    <div>
                      <span className="text-text-primary">Claude Sonnet 4</span>
                      <span className="text-sm text-accent-warning ml-2">(Production)</span>
                      <p className="text-xs text-text-muted">
                        ~$3/1M tokens • Highest quality
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 - Appearance */}
          <div className="settings-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-text-primary">Appearance</h2>

            <div className="space-y-4">
              {/* Background Images Toggle */}
              <div className="flex items-center justify-between p-4 bg-bg-tertiary rounded-lg">
                <div className="flex-1">
                  <h3 className="text-sm font-medium text-text-primary mb-1">
                    Background Images
                  </h3>
                  <p className="text-xs text-text-muted">
                    Enable landscape backgrounds
                  </p>
                </div>
                <button
                  onClick={toggleBackgroundImages}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    backgroundImagesEnabled ? 'bg-accent-primary' : 'bg-border-default'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      backgroundImagesEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Card 3 - Processing Preferences */}
          <div className="settings-card p-6 space-y-6">
            <h2 className="text-xl font-semibold text-text-primary">Processing Preferences</h2>

            <div className="space-y-4">
              {/* Auto-Approve Threshold */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Auto-Approve Threshold: {config.autoApproveThreshold.toFixed(1)}
                </label>
                <input
                  type="range"
                  min="6.0"
                  max="10.0"
                  step="0.1"
                  value={config.autoApproveThreshold}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    autoApproveThreshold: parseFloat(e.target.value)
                  }))}
                  className="w-full"
                />
                <p className="text-xs text-text-muted mt-1">
                  Clips with scores above this threshold will be automatically approved
                </p>
              </div>

              {/* Default Export Format */}
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-2">
                  Default Export Format
                </label>
                <select
                  value={config.defaultExportFormat}
                  onChange={(e) => setConfig(prev => ({
                    ...prev,
                    defaultExportFormat: e.target.value as '9:16' | '1:1' | '16:9'
                  }))}
                  className="input"
                >
                  <option value="9:16">9:16 (Instagram Stories, TikTok)</option>
                  <option value="1:1">1:1 (Instagram Post)</option>
                  <option value="16:9">16:9 (YouTube Shorts)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Actions - Full Width at Bottom */}
        <div className="flex items-center justify-between">
          <div>
            {saveMessage && (
              <span className={`text-sm ${
                saveMessage.includes('success') 
                  ? 'text-accent-success' 
                  : 'text-accent-danger'
              }`}>
                {saveMessage}
              </span>
            )}
          </div>
          
          <div className="flex space-x-3">
            <button
              onClick={validateConfig}
              className="btn-secondary"
            >
              Validate Config
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-primary"
            >
              {isSaving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}