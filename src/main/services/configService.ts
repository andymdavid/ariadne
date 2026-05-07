import Store from 'electron-store'
import type { APIConfig, BrandTemplate, BrandTemplatePreset } from '@shared/types'

function createDefaultBrandTemplate(): BrandTemplate {
  return {
    caption: {
      presetId: 'deep-diver',
      text: 'One Line',
      font: 'Inter',
      fontSize: 30,
      fontWeight: '700',
      italic: false,
      underline: false,
      uppercase: false,
      position: 'bottom',
      customX: null,
      customY: null,
      animation: 'box',
      lineMode: 'one-line',
      backgroundEnabled: true,
      textColor: '#5F5F5F',
      highlightColor: '#111111',
      backgroundColor: '#ffffff',
      backgroundPaddingX: 24,
      backgroundPaddingY: 12,
      backgroundRadius: 16,
      strokeColor: '#000000',
      strokeWidth: 0,
      shadowEnabled: false,
      shadowColor: '#000000',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      shadowBlur: 0
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
    introOutro: {
      introPath: null,
      outroPath: null
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
}

function createPresetId() {
  return `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneBrandTemplate(template: BrandTemplate): BrandTemplate {
  return JSON.parse(JSON.stringify(template)) as BrandTemplate
}

function createBrandTemplatePreset(
  name: string,
  template: BrandTemplate,
  id = createPresetId()
): BrandTemplatePreset {
  const now = new Date().toISOString()
  return {
    id,
    name,
    template: cloneBrandTemplate(template),
    createdAt: now,
    updatedAt: now
  }
}

interface ConfigSchema {
  apiConfig: APIConfig
  userPreferences: {
    theme: 'dark' | 'light'
    defaultExportFormat: '9:16' | '1:1' | '16:9'
    // Deprecated legacy setting retained for config compatibility during migration.
    autoApproveThreshold: number
    maxClipsPerEpisode: number
    productionSelectorMode: 'legacy' | 'arc_v1'
    enableLegacyResolvedClipProposal: boolean
    enableLegacyTranscriptLineAgent: boolean
    enableLegacyBoundaryProposal: boolean
    enableLegacyCandidateRanking: boolean
    enableHeuristicSupplementation: boolean
  }
  recentProjects: Array<{
    id: string
    name: string
    path: string
    lastOpened: string
  }>
  brandVoice: {
    examples: string[]
    preferences: {
      tone: 'casual' | 'professional' | 'conversational'
      style: 'direct' | 'storytelling' | 'question_based'
    }
  }
  brandTemplate: BrandTemplate
  brandTemplatePresets: BrandTemplatePreset[]
  activeBrandTemplatePresetId: string
}

function createDefaultUserPreferences(): ConfigSchema['userPreferences'] {
  return {
    theme: 'dark',
    defaultExportFormat: '9:16',
    autoApproveThreshold: 8.0,
    maxClipsPerEpisode: 25,
    productionSelectorMode: 'arc_v1',
    enableLegacyResolvedClipProposal: false,
    enableLegacyTranscriptLineAgent: false,
    enableLegacyBoundaryProposal: false,
    enableLegacyCandidateRanking: false,
    enableHeuristicSupplementation: false
  }
}

class ConfigService {
  private store: Store<ConfigSchema>
  
  constructor() {
    this.store = new Store<ConfigSchema>({
      name: 'ariadne-config',
      defaults: {
        apiConfig: {
          openRouterKey: undefined,
          whisperEndpoint: undefined,
          model: 'google-gemini-2.5-flash',
          clipSelectionPlatform: 'youtube_shorts'
        },
        userPreferences: createDefaultUserPreferences(),
        recentProjects: [],
        brandVoice: {
          examples: [],
          preferences: {
            tone: 'conversational',
            style: 'direct'
          }
        },
        brandTemplate: createDefaultBrandTemplate(),
        brandTemplatePresets: [],
        activeBrandTemplatePresetId: ''
      },
      encryptionKey: 'ariadne-secure-config' // Basic encryption for API keys
    })

    this.ensureBrandTemplatePresetState()
  }
  
  // API Configuration
  getApiConfig(): APIConfig {
    return this.store.get('apiConfig')
  }
  
  updateApiConfig(config: Partial<APIConfig>): void {
    const currentConfig = this.getApiConfig()
    this.store.set('apiConfig', { ...currentConfig, ...config })
  }
  
  setOpenRouterKey(key: string): void {
    this.updateApiConfig({ openRouterKey: key })
  }
  
  getOpenRouterKey(): string | undefined {
    return this.getApiConfig().openRouterKey
  }
  
  setModel(model: APIConfig['model']): void {
    this.updateApiConfig({ model })
  }
  
  getModel(): APIConfig['model'] {
    return this.getApiConfig().model
  }

  setClipSelectionPlatform(platform: APIConfig['clipSelectionPlatform']): void {
    this.updateApiConfig({ clipSelectionPlatform: platform })
  }

  getClipSelectionPlatform(): APIConfig['clipSelectionPlatform'] {
    return this.getApiConfig().clipSelectionPlatform
  }
  
  // User Preferences
  getUserPreferences(): ConfigSchema['userPreferences'] {
    const defaults = createDefaultUserPreferences()
    const stored = this.store.get('userPreferences') ?? defaults
    const merged: ConfigSchema['userPreferences'] = {
      ...defaults,
      ...stored,
      productionSelectorMode: stored.productionSelectorMode === 'legacy' ? 'legacy' : 'arc_v1',
      enableLegacyResolvedClipProposal: Boolean(stored.enableLegacyResolvedClipProposal),
      enableLegacyTranscriptLineAgent: Boolean(stored.enableLegacyTranscriptLineAgent),
      enableLegacyBoundaryProposal: Boolean(stored.enableLegacyBoundaryProposal),
      enableLegacyCandidateRanking: Boolean(stored.enableLegacyCandidateRanking),
      enableHeuristicSupplementation: Boolean(stored.enableHeuristicSupplementation)
    }

    if (JSON.stringify(stored) !== JSON.stringify(merged)) {
      this.store.set('userPreferences', merged)
    }

    return merged
  }
  
  updateUserPreferences(preferences: Partial<ConfigSchema['userPreferences']>): void {
    const current = this.getUserPreferences()
    this.store.set('userPreferences', { ...current, ...preferences })
  }
  
  setTheme(theme: 'dark' | 'light'): void {
    this.updateUserPreferences({ theme })
  }
  
  getTheme(): 'dark' | 'light' {
    return this.getUserPreferences().theme
  }
  
  setDefaultExportFormat(format: '9:16' | '1:1' | '16:9'): void {
    this.updateUserPreferences({ defaultExportFormat: format })
  }
  
  getDefaultExportFormat(): '9:16' | '1:1' | '16:9' {
    return this.getUserPreferences().defaultExportFormat
  }
  
  // Recent Projects
  getRecentProjects() {
    return this.store.get('recentProjects')
  }
  
  addRecentProject(project: {
    id: string
    name: string
    path: string
  }): void {
    const recent = this.getRecentProjects()
    const updated = [
      {
        ...project,
        lastOpened: new Date().toISOString()
      },
      ...recent.filter(p => p.id !== project.id)
    ].slice(0, 10) // Keep only 10 most recent
    
    this.store.set('recentProjects', updated)
  }
  
  removeRecentProject(projectId: string): void {
    const recent = this.getRecentProjects()
    this.store.set('recentProjects', recent.filter(p => p.id !== projectId))
  }
  
  // Brand Voice
  getBrandVoice() {
    return this.store.get('brandVoice')
  }
  
  addBrandVoiceExample(example: string): void {
    const brandVoice = this.getBrandVoice()
    const updatedExamples = [...brandVoice.examples, example].slice(-20) // Keep last 20
    
    this.store.set('brandVoice', {
      ...brandVoice,
      examples: updatedExamples
    })
  }
  
  updateBrandVoicePreferences(
    preferences: Partial<ConfigSchema['brandVoice']['preferences']>
  ): void {
    const brandVoice = this.getBrandVoice()
    this.store.set('brandVoice', {
      ...brandVoice,
      preferences: { ...brandVoice.preferences, ...preferences }
    })
  }

  getBrandTemplate(): BrandTemplate {
    return this.store.get('brandTemplate')
  }

  updateBrandTemplate(template: Partial<BrandTemplate>): BrandTemplate {
    const current = this.getBrandTemplate()
    const merged: BrandTemplate = {
      ...current,
      ...template,
      caption: {
        ...current.caption,
        ...template.caption
      },
      logo: {
        ...current.logo,
        ...template.logo
      },
      music: {
        ...current.music,
        ...template.music
      },
      introOutro: {
        ...current.introOutro,
        ...template.introOutro
      },
      frame: {
        ...current.frame,
        ...template.frame
      },
      ai: {
        ...current.ai,
        ...template.ai
      },
      updatedAt: new Date().toISOString()
    }

    this.store.set('brandTemplate', merged)
    this.updateActiveBrandTemplatePresetTemplate(merged)
    return merged
  }

  getBrandTemplatePresets(): BrandTemplatePreset[] {
    return this.store.get('brandTemplatePresets', [])
  }

  getActiveBrandTemplatePresetId(): string {
    return this.store.get('activeBrandTemplatePresetId', '')
  }

  getActiveBrandTemplatePreset(): BrandTemplatePreset | null {
    const activeId = this.getActiveBrandTemplatePresetId()
    const preset = this.getBrandTemplatePresets().find((item) => item.id === activeId)
    return preset ?? null
  }

  createBrandTemplatePreset(name: string, template?: BrandTemplate): BrandTemplatePreset {
    const baseTemplate = cloneBrandTemplate(template ?? this.getBrandTemplate())
    const preset = createBrandTemplatePreset(name, baseTemplate)
    const presets = [...this.getBrandTemplatePresets(), preset]
    this.store.set('brandTemplatePresets', presets)
    this.store.set('activeBrandTemplatePresetId', preset.id)
    this.store.set('brandTemplate', preset.template)
    return preset
  }

  setActiveBrandTemplatePreset(presetId: string): BrandTemplatePreset {
    const presets = this.getBrandTemplatePresets()
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) {
      throw new Error('Brand template preset not found')
    }

    this.store.set('activeBrandTemplatePresetId', preset.id)
    this.store.set('brandTemplate', cloneBrandTemplate(preset.template))
    return preset
  }

  deleteBrandTemplatePreset(presetId: string): {
    deletedPresetId: string
    presets: BrandTemplatePreset[]
    activePresetId: string
    brandTemplate: BrandTemplate
  } {
    const presets = this.getBrandTemplatePresets()
    if (presets.length <= 1) {
      throw new Error('At least one preset must remain')
    }

    const nextPresets = presets.filter((preset) => preset.id !== presetId)
    if (nextPresets.length === presets.length) {
      throw new Error('Brand template preset not found')
    }

    const currentActiveId = this.getActiveBrandTemplatePresetId()
    const nextActivePreset =
      currentActiveId === presetId
        ? nextPresets[0]
        : nextPresets.find((preset) => preset.id === currentActiveId) ?? nextPresets[0]

    this.store.set('brandTemplatePresets', nextPresets)
    this.store.set('activeBrandTemplatePresetId', nextActivePreset.id)
    this.store.set('brandTemplate', cloneBrandTemplate(nextActivePreset.template))

    return {
      deletedPresetId: presetId,
      presets: nextPresets,
      activePresetId: nextActivePreset.id,
      brandTemplate: cloneBrandTemplate(nextActivePreset.template)
    }
  }
  
  // Validation
  isConfigured(): boolean {
    const config = this.getApiConfig()
    return !!(config.openRouterKey)
  }
  
  validateConfig(): { isValid: boolean; errors: string[] } {
    const errors: string[] = []
    const config = this.getApiConfig()
    
    if (!config.openRouterKey) {
      errors.push('OpenRouter API key is required')
    }
    
    if (config.openRouterKey && config.openRouterKey.length < 10) {
      errors.push('OpenRouter API key appears to be invalid')
    }
    
    return {
      isValid: errors.length === 0,
      errors
    }
  }
  
  // Export/Import
  exportConfig(): ConfigSchema {
    return {
      apiConfig: {
        ...this.getApiConfig(),
        openRouterKey: undefined // Don't export API keys
      },
      userPreferences: this.getUserPreferences(),
      recentProjects: [], // Don't export recent projects
      brandVoice: this.getBrandVoice(),
      brandTemplate: this.getBrandTemplate(),
      brandTemplatePresets: this.getBrandTemplatePresets(),
      activeBrandTemplatePresetId: this.getActiveBrandTemplatePresetId()
    }
  }
  
  importConfig(config: Partial<ConfigSchema>): void {
    if (config.userPreferences) {
      this.updateUserPreferences(config.userPreferences)
    }
    
    if (config.brandVoice) {
      this.store.set('brandVoice', config.brandVoice)
    }

    if (config.brandTemplate) {
      this.store.set('brandTemplate', config.brandTemplate)
    }

    if (config.brandTemplatePresets) {
      this.store.set('brandTemplatePresets', config.brandTemplatePresets)
    }

    if (config.activeBrandTemplatePresetId) {
      this.store.set('activeBrandTemplatePresetId', config.activeBrandTemplatePresetId)
    }

    this.ensureBrandTemplatePresetState()
    
    // Don't import API config or recent projects for security
  }
  
  // Development helpers
  isDevelopment(): boolean {
    return process.env.NODE_ENV === 'development'
  }
  
  getModelForEnvironment(): APIConfig['model'] {
    if (this.isDevelopment()) {
      return 'google-gemini-2.5-flash' // Balanced default for development
    }
    return this.getModel()
  }
  
  // Cost tracking
  addUsage(operation: 'transcription' | 'analysis' | 'generation', cost: number): void {
    const usage = this.store.get('usage', { 
      daily: { [new Date().toDateString()]: 0 },
      monthly: { [new Date().toISOString().slice(0, 7)]: 0 },
      total: 0
    })
    
    const today = new Date().toDateString()
    const thisMonth = new Date().toISOString().slice(0, 7)
    
    usage.daily[today] = (usage.daily[today] || 0) + cost
    usage.monthly[thisMonth] = (usage.monthly[thisMonth] || 0) + cost
    usage.total += cost
    
    this.store.set('usage', usage)
  }
  
  getUsage() {
    return this.store.get('usage', { 
      daily: {},
      monthly: {},
      total: 0
    })
  }
  
  // Reset config (for testing/debugging)
  reset(): void {
    this.store.clear()
  }

  private updateActiveBrandTemplatePresetTemplate(template: BrandTemplate): void {
    const activeId = this.getActiveBrandTemplatePresetId()
    if (!activeId) return

    const presets = this.getBrandTemplatePresets()
    const updatedPresets = presets.map((preset) =>
      preset.id === activeId
        ? {
            ...preset,
            template: cloneBrandTemplate(template),
            updatedAt: new Date().toISOString()
          }
        : preset
    )

    this.store.set('brandTemplatePresets', updatedPresets)
  }

  private ensureBrandTemplatePresetState(): void {
    const currentTemplate = this.store.get('brandTemplate', createDefaultBrandTemplate())
    const currentPresets = this.store.get('brandTemplatePresets', [])
    const activePresetId = this.store.get('activeBrandTemplatePresetId', '')

    if (currentPresets.length === 0) {
      const defaultPreset = createBrandTemplatePreset('Preset template 1', currentTemplate, 'default-preset')
      this.store.set('brandTemplatePresets', [defaultPreset])
      this.store.set('activeBrandTemplatePresetId', defaultPreset.id)
      this.store.set('brandTemplate', cloneBrandTemplate(defaultPreset.template))
      return
    }

    const resolvedActivePreset = currentPresets.find((preset) => preset.id === activePresetId) ?? currentPresets[0]
    this.store.set('activeBrandTemplatePresetId', resolvedActivePreset.id)
    this.store.set('brandTemplate', cloneBrandTemplate(resolvedActivePreset.template))
  }
}

// Export singleton
export const configService = new ConfigService()
export default configService
