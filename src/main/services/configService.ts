import Store from 'electron-store'
import { APIConfig, BrandTemplate } from '@shared/types'

interface ConfigSchema {
  apiConfig: APIConfig
  userPreferences: {
    theme: 'dark' | 'light'
    defaultExportFormat: '9:16' | '1:1' | '16:9'
    autoApproveThreshold: number
    maxClipsPerEpisode: number
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
        userPreferences: {
          theme: 'dark',
          defaultExportFormat: '9:16',
          autoApproveThreshold: 8.0,
          maxClipsPerEpisode: 25
        },
        recentProjects: [],
        brandVoice: {
          examples: [],
          preferences: {
            tone: 'conversational',
            style: 'direct'
          }
        },
        brandTemplate: {
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
      },
      encryptionKey: 'ariadne-secure-config' // Basic encryption for API keys
    })
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
  getUserPreferences() {
    return this.store.get('userPreferences')
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
  
  setAutoApproveThreshold(threshold: number): void {
    this.updateUserPreferences({ autoApproveThreshold: threshold })
  }
  
  getAutoApproveThreshold(): number {
    return this.getUserPreferences().autoApproveThreshold
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
    return merged
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
      brandTemplate: this.getBrandTemplate()
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
}

// Export singleton
export const configService = new ConfigService()
export default configService
