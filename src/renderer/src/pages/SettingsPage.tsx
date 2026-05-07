import { useState, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { MainContentPanel } from '../components/MainContentPanel'
import type { PostingPlan, PublishingAccount, TargetRegion } from '@shared/types'

function getPublishingMetadata(account: Partial<PublishingAccount> | null | undefined) {
  return (account?.metadata ?? {}) as Record<string, unknown>
}

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
    defaultExportFormat: '9:16',
    isValid: false,
    errors: []
  })
  const [isSaving, setIsSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [publishingAccount, setPublishingAccount] = useState<Partial<PublishingAccount> | null>(null)
  const [postingPlan, setPostingPlan] = useState<PostingPlan | null>(null)
  const [isSavingPublishing, setIsSavingPublishing] = useState(false)
  const [isConnectingYoutube, setIsConnectingYoutube] = useState(false)
  const [isRefreshingYoutube, setIsRefreshingYoutube] = useState(false)

  useEffect(() => {
    void loadConfig()
    void loadPublishing()
  }, [])

  const loadConfig = async () => {
    try {
      const data = await window.electronAPI?.getConfig()
      if (data) {
        setConfig({
          openRouterKey: data.apiConfig.openRouterKey || '',
          model: data.apiConfig.model || 'google-gemini-2.5-flash',
          clipSelectionPlatform: data.apiConfig.clipSelectionPlatform || 'youtube_shorts',
          defaultExportFormat: data.userPreferences.defaultExportFormat || '9:16',
          isValid: data.isConfigured,
          errors: []
        })
      }
    } catch (error) {
      console.error('Failed to load config:', error)
    }
  }

  const loadPublishing = async () => {
    try {
      const accounts = (await window.electronAPI?.getPublishingAccounts?.()) ?? []
      const account = accounts[0]
      if (account) {
        setPublishingAccount(account)
        const plan = await window.electronAPI?.getPostingPlan?.(account.id)
        if (plan) {
          setPostingPlan(plan)
        }
      } else {
        setPublishingAccount({
          platform: 'youtube',
          channelName: '',
          channelHandle: '',
          timezone: 'Australia/Perth',
          authStatus: 'not_connected',
          metadata: {}
        })
      }
    } catch (error) {
      console.error('Failed to load publishing config:', error)
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

  const toggleTargetRegion = (region: TargetRegion) => {
    setPostingPlan((prev) => {
      if (!prev) return prev
      const hasRegion = prev.targetRegions.includes(region)
      return {
        ...prev,
        targetRegions: hasRegion
          ? prev.targetRegions.filter((candidate) => candidate !== region)
          : [...prev.targetRegions, region]
      }
    })
  }

  const handleSavePublishing = async () => {
    if (!publishingAccount?.channelName?.trim()) {
      setSaveMessage('Channel name is required for publishing setup')
      return
    }

    setIsSavingPublishing(true)
    try {
      const savedAccount = await window.electronAPI?.savePublishingAccount?.({
        ...publishingAccount,
        channelName: publishingAccount.channelName.trim(),
        channelId: publishingAccount.channelId || publishingAccount.channelHandle || publishingAccount.channelName
      })

      if (!savedAccount) {
        throw new Error('Failed to save publishing account')
      }

      const nextPlan: PostingPlan =
        postingPlan ?? {
          id: crypto.randomUUID(),
          publishingAccountId: savedAccount.id,
          isDefault: true,
          postsPerDay: 5,
          activeDays: [1, 2, 3, 4, 5, 6, 0],
          primaryTimezone: savedAccount.timezone,
          targetRegions: ['aus_nz', 'europe', 'united_states'],
          publishingWindowStart: '08:00',
          publishingWindowEnd: '22:00',
          slotStrategy: 'regional_weighted',
          recyclingEnabled: true,
          minimumRecycleGapDays: 30,
          maxRecyclesPerClip: 3,
          freshInventoryThreshold: 12,
          metadata: {},
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }

      const savedPlan = await window.electronAPI?.savePostingPlan?.({
        ...nextPlan,
        publishingAccountId: savedAccount.id,
        primaryTimezone: publishingAccount.timezone || savedAccount.timezone
      })

      if (savedPlan) {
        setPublishingAccount(savedAccount)
        setPostingPlan(savedPlan)
        await window.electronAPI?.generateCalendarSlots?.(savedPlan.id, 21)
      }

      setSaveMessage('Publishing setup saved successfully!')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to save publishing setup:', error)
      setSaveMessage('Failed to save publishing setup')
    } finally {
      setIsSavingPublishing(false)
    }
  }

  const setPublishingMetadataField = (key: string, value: string) => {
    setPublishingAccount((prev) => ({
      ...(prev ?? {
        platform: 'youtube',
        authStatus: 'not_connected',
        metadata: {}
      }),
      metadata: {
        ...getPublishingMetadata(prev),
        [key]: value
      }
    }))
  }

  const handleConnectYoutube = async () => {
    setSaveMessage('')
    setIsConnectingYoutube(true)

    try {
      const metadata = getPublishingMetadata(publishingAccount)
      const clientId = String(metadata.youtubeOAuthClientId ?? '').trim()
      if (!clientId) {
        setSaveMessage('YouTube OAuth client ID is required before connecting')
        return
      }

      const savedAccount = await window.electronAPI?.savePublishingAccount?.({
        ...publishingAccount,
        platform: 'youtube',
        authStatus: publishingAccount?.authStatus ?? 'not_connected',
        channelName: publishingAccount?.channelName?.trim() || 'YouTube channel',
        channelId:
          publishingAccount?.channelId ||
          publishingAccount?.channelHandle ||
          publishingAccount?.channelName ||
          ''
      })

      if (!savedAccount) {
        throw new Error('Failed to save publishing account before connecting')
      }

      const connectedAccount = await window.electronAPI?.connectYoutubeAccount?.(savedAccount.id)
      if (!connectedAccount) {
        throw new Error('Failed to connect YouTube account')
      }

      setPublishingAccount(connectedAccount)
      setSaveMessage('YouTube account connected successfully!')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to connect YouTube account:', error)
      setSaveMessage('Failed to connect YouTube account')
    } finally {
      setIsConnectingYoutube(false)
    }
  }

  const handleDisconnectYoutube = async () => {
    if (!publishingAccount?.id) {
      return
    }

    setSaveMessage('')
    setIsConnectingYoutube(true)
    try {
      const disconnectedAccount = await window.electronAPI?.disconnectYoutubeAccount?.(publishingAccount.id)
      if (!disconnectedAccount) {
        throw new Error('Failed to disconnect YouTube account')
      }
      setPublishingAccount(disconnectedAccount)
      setSaveMessage('YouTube account disconnected')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to disconnect YouTube account:', error)
      setSaveMessage('Failed to disconnect YouTube account')
    } finally {
      setIsConnectingYoutube(false)
    }
  }

  const handleRefreshYoutube = async () => {
    if (!publishingAccount?.id) {
      return
    }

    setSaveMessage('')
    setIsRefreshingYoutube(true)
    try {
      const refreshedAccount = await window.electronAPI?.refreshYoutubeAccount?.(publishingAccount.id)
      if (!refreshedAccount) {
        throw new Error('Failed to refresh YouTube account')
      }
      setPublishingAccount(refreshedAccount)
      setSaveMessage('YouTube connection refreshed')
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (error) {
      console.error('Failed to refresh YouTube account:', error)
      setSaveMessage(error instanceof Error ? error.message : 'Failed to refresh YouTube account')
    } finally {
      setIsRefreshingYoutube(false)
    }
  }

  const saveToneClass = saveMessage.includes('success') ? 'text-accent-success' : 'text-accent-danger'
  const publishingMetadata = getPublishingMetadata(publishingAccount)
  const isYoutubeConnected = publishingAccount?.authStatus === 'connected'

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

          <div className="app-page-content-shell flex flex-1 flex-col gap-6">
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
                      <h2 className="app-section-title">Publishing Setup</h2>
                    </div>
                  </div>

                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          YouTube OAuth client ID
                        </label>
                        <input
                          type="text"
                          value={String(publishingMetadata.youtubeOAuthClientId ?? '')}
                          onChange={(e) => setPublishingMetadataField('youtubeOAuthClientId', e.target.value)}
                          placeholder="Google OAuth desktop client ID"
                          className="input w-full"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          YouTube OAuth client secret
                        </label>
                        <input
                          type="password"
                          value={String(publishingMetadata.youtubeOAuthClientSecret ?? '')}
                          onChange={(e) => setPublishingMetadataField('youtubeOAuthClientSecret', e.target.value)}
                          placeholder="Optional for desktop OAuth"
                          className="input w-full"
                        />
                      </div>
                    </div>

                    <div className="app-list-row">
                      <div>
                        <div className="text-sm font-medium text-text-primary">YouTube connection</div>
                        <div className="mt-1 text-xs text-text-muted">
                          {isYoutubeConnected
                            ? `Connected${publishingAccount?.channelName ? ` to ${publishingAccount.channelName}` : ''}`
                            : 'Connect once so Ariadne can schedule uploads directly on YouTube.'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="app-chip">
                          {publishingAccount?.authStatus === 'connected'
                            ? 'Connected'
                            : publishingAccount?.authStatus === 'expired'
                              ? 'Expired'
                              : publishingAccount?.authStatus === 'revoked'
                                ? 'Revoked'
                                : publishingAccount?.authStatus === 'error'
                                  ? 'Error'
                                  : 'Not connected'}
                        </div>

                        {isYoutubeConnected ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void handleRefreshYoutube()}
                              disabled={isRefreshingYoutube}
                              className="app-action-secondary"
                            >
                              {isRefreshingYoutube ? 'Refreshing...' : 'Refresh status'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDisconnectYoutube()}
                              disabled={isConnectingYoutube}
                              className="app-action-secondary"
                            >
                              {isConnectingYoutube ? 'Disconnecting...' : 'Disconnect'}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleConnectYoutube()}
                            disabled={isConnectingYoutube}
                            className="app-action-primary"
                          >
                            {isConnectingYoutube ? 'Connecting...' : 'Connect YouTube'}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          YouTube channel name
                        </label>
                        <input
                          type="text"
                          value={publishingAccount?.channelName ?? ''}
                          onChange={(e) =>
                            setPublishingAccount((prev) => ({
                              ...(prev ?? { platform: 'youtube', authStatus: 'not_connected', metadata: {} }),
                              channelName: e.target.value
                            }))
                          }
                          placeholder="Main channel"
                          className="input w-full"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Channel handle
                        </label>
                        <input
                          type="text"
                          value={publishingAccount?.channelHandle ?? ''}
                          onChange={(e) =>
                            setPublishingAccount((prev) => ({
                              ...(prev ?? { platform: 'youtube', authStatus: 'not_connected', metadata: {} }),
                              channelHandle: e.target.value
                            }))
                          }
                          placeholder="@channel"
                          className="input w-full"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Primary timezone
                        </label>
                        <input
                          type="text"
                          value={publishingAccount?.timezone ?? ''}
                          onChange={(e) =>
                            setPublishingAccount((prev) => ({
                              ...(prev ?? { platform: 'youtube', authStatus: 'not_connected', metadata: {} }),
                              timezone: e.target.value
                            }))
                          }
                          placeholder="Australia/Perth"
                          className="input w-full"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Posts per day
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={postingPlan?.postsPerDay ?? 5}
                          onChange={(e) =>
                            setPostingPlan((prev) =>
                              prev
                                ? { ...prev, postsPerDay: Number.parseInt(e.target.value || '5', 10) }
                                : prev
                            )
                          }
                          className="input w-full"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Slot strategy
                        </label>
                        <select
                          value={postingPlan?.slotStrategy ?? 'regional_weighted'}
                          onChange={(e) =>
                            setPostingPlan((prev) =>
                              prev
                                ? { ...prev, slotStrategy: e.target.value as PostingPlan['slotStrategy'] }
                                : prev
                            )
                          }
                          className="input w-full"
                        >
                          <option value="fixed">Fixed</option>
                          <option value="regional_weighted">Regional weighted</option>
                          <option value="adaptive">Adaptive</option>
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Publishing window start
                        </label>
                        <input
                          type="time"
                          value={postingPlan?.publishingWindowStart ?? '08:00'}
                          onChange={(e) =>
                            setPostingPlan((prev) =>
                              prev ? { ...prev, publishingWindowStart: e.target.value } : prev
                            )
                          }
                          className="input w-full"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm font-medium text-text-secondary">
                          Publishing window end
                        </label>
                        <input
                          type="time"
                          value={postingPlan?.publishingWindowEnd ?? '22:00'}
                          onChange={(e) =>
                            setPostingPlan((prev) =>
                              prev ? { ...prev, publishingWindowEnd: e.target.value } : prev
                            )
                          }
                          className="input w-full"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-text-secondary">
                        Target regions
                      </label>
                      <div className="settings-pill-row">
                        {[
                          { value: 'aus_nz' as const, label: 'AUS/NZ' },
                          { value: 'europe' as const, label: 'EUR' },
                          { value: 'united_states' as const, label: 'USA' },
                          { value: 'global_fallback' as const, label: 'Global' }
                        ].map((region) => (
                          <button
                            key={region.value}
                            type="button"
                            onClick={() => toggleTargetRegion(region.value)}
                            className={`settings-pill ${
                              postingPlan?.targetRegions.includes(region.value) ? 'is-active' : ''
                            }`}
                          >
                            {region.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="app-surface-muted p-4 text-xs text-text-muted">
                      Approval-triggered scheduling uses this default plan to reserve the next available slot and
                      prepare YouTube publication records.
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSavePublishing()}
                        disabled={isSavingPublishing}
                        className="app-action-primary"
                      >
                        {isSavingPublishing ? 'Saving...' : 'Save Publishing Setup'}
                      </button>
                    </div>
                  </div>
                </section>

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
                    <div className="app-surface-muted p-4 text-xs text-text-muted">
                      Generated clips now always enter `Review` as pending. Approval is an explicit editorial action rather than a score threshold.
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
