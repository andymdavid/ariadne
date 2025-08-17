import { NavigateFunction } from 'react-router-dom'

export interface ScreenConfig {
  id: string
  title: string
  description: string
  nextScreen?: string
  previousScreen?: string
  allowedCommands: string[]
  requiredData?: string[]
}

export interface ScreenFlow {
  [key: string]: ScreenConfig
}

export const SCREEN_FLOW: ScreenFlow = {
  upload: {
    id: 'upload',
    title: 'Upload Podcast',
    description: 'Select or drag a podcast file to begin processing',
    nextScreen: 'processing',
    allowedCommands: [
      'select file',
      'browse',
      'drag and drop',
      'choose file',
      'upload file'
    ]
  },
  processing: {
    id: 'processing',
    title: 'Processing Content',
    description: 'AI is analyzing your podcast and generating clips',
    nextScreen: 'review',
    previousScreen: 'upload',
    allowedCommands: [
      'view progress',
      'cancel processing',
      'status',
      'stop'
    ],
    requiredData: ['episodeId']
  },
  review: {
    id: 'review',
    title: 'Review Clips',
    description: 'Review AI-generated clips and approve the best ones',
    nextScreen: 'export',
    previousScreen: 'upload',
    allowedCommands: [
      'find clips about',
      'show me',
      'clips under',
      'approve all',
      'reject low scores',
      'play clip',
      'preview',
      'next'
    ],
    requiredData: ['episodeId', 'clips']
  },
  content: {
    id: 'content',
    title: 'Generate Content',
    description: 'Create titles, descriptions, and thumbnails for your clips',
    nextScreen: 'export',
    previousScreen: 'review',
    allowedCommands: [
      'create titles',
      'generate titles',
      'write descriptions',
      'generate descriptions',
      'select thumbnails',
      'next'
    ],
    requiredData: ['episodeId', 'approvedClips']
  },
  export: {
    id: 'export',
    title: 'Export Reels',
    description: 'Export your clips in the perfect format for social media',
    previousScreen: 'review',
    allowedCommands: [
      'export as instagram',
      'export as youtube',
      'export as tiktok',
      'export all',
      'save project',
      'download'
    ],
    requiredData: ['episodeId', 'approvedClips']
  },
  settings: {
    id: 'settings',
    title: 'Settings',
    description: 'Configure your API keys and preferences',
    previousScreen: 'upload',
    allowedCommands: [
      'save settings',
      'reset',
      'test connection',
      'back'
    ]
  }
}

export class ScreenFlowManager {
  private currentScreen: string
  private navigate: NavigateFunction
  private episodeId?: string
  private sessionData: { [key: string]: any } = {}

  constructor(navigate: NavigateFunction, initialScreen: string = 'upload') {
    this.navigate = navigate
    this.currentScreen = initialScreen
  }

  setCurrentScreen(screenId: string) {
    this.currentScreen = screenId
  }

  setEpisodeId(episodeId: string) {
    this.episodeId = episodeId
  }

  setSessionData(key: string, data: any) {
    this.sessionData[key] = data
  }

  getSessionData(key: string) {
    return this.sessionData[key]
  }

  getCurrentScreenConfig(): ScreenConfig {
    return SCREEN_FLOW[this.currentScreen] || SCREEN_FLOW.upload
  }

  getScreenTitle(): string {
    return this.getCurrentScreenConfig().title
  }

  getScreenDescription(): string {
    return this.getCurrentScreenConfig().description
  }

  getAllowedCommands(): string[] {
    return this.getCurrentScreenConfig().allowedCommands
  }

  canNavigateToScreen(targetScreen: string): { canNavigate: boolean; reason?: string } {
    const targetConfig = SCREEN_FLOW[targetScreen]
    if (!targetConfig) {
      return { canNavigate: false, reason: 'Screen does not exist' }
    }

    // Check if required data is available
    if (targetConfig.requiredData) {
      for (const requirement of targetConfig.requiredData) {
        if (requirement === 'episodeId' && !this.episodeId) {
          return { canNavigate: false, reason: 'No episode loaded' }
        }
        if (requirement === 'clips' && !this.sessionData.clips?.length) {
          return { canNavigate: false, reason: 'No clips available' }
        }
        if (requirement === 'approvedClips' && !this.sessionData.approvedClips?.length) {
          return { canNavigate: false, reason: 'No approved clips' }
        }
      }
    }

    return { canNavigate: true }
  }

  navigateToScreen(targetScreen: string): { success: boolean; message: string } {
    const { canNavigate, reason } = this.canNavigateToScreen(targetScreen)
    
    if (!canNavigate) {
      return { success: false, message: reason || 'Cannot navigate to screen' }
    }

    // Perform navigation
    const route = this.getRouteForScreen(targetScreen)
    this.navigate(route)
    this.setCurrentScreen(targetScreen)

    return { 
      success: true, 
      message: `Navigated to ${SCREEN_FLOW[targetScreen].title}` 
    }
  }

  navigateNext(): { success: boolean; message: string } {
    const currentConfig = this.getCurrentScreenConfig()
    
    if (!currentConfig.nextScreen) {
      return { success: false, message: 'No next screen available' }
    }

    return this.navigateToScreen(currentConfig.nextScreen)
  }

  navigatePrevious(): { success: boolean; message: string } {
    const currentConfig = this.getCurrentScreenConfig()
    
    if (!currentConfig.previousScreen) {
      return { success: false, message: 'No previous screen available' }
    }

    return this.navigateToScreen(currentConfig.previousScreen)
  }

  private getRouteForScreen(screenId: string): string {
    switch (screenId) {
      case 'upload':
        return '/'
      case 'processing':
        return this.episodeId ? `/project/${this.episodeId}` : '/'
      case 'review':
        return this.episodeId ? `/review/${this.episodeId}` : '/'
      case 'content':
        return this.episodeId ? `/content/${this.episodeId}` : '/'
      case 'export':
        return this.episodeId ? `/export/${this.episodeId}` : '/'
      case 'settings':
        return '/settings'
      default:
        return '/'
    }
  }

  getScreenFlow(): ScreenFlow {
    return SCREEN_FLOW
  }

  // Get suggested next actions for current screen
  getSuggestedActions(): string[] {
    const config = this.getCurrentScreenConfig()
    const actions: string[] = []

    // Add screen-specific actions
    switch (this.currentScreen) {
      case 'upload':
        actions.push('select file', 'drag and drop')
        break
      case 'review':
        actions.push('find clips about', 'approve all high scores')
        if (config.nextScreen) actions.push('next')
        break
      case 'export':
        actions.push('export as instagram', 'export all')
        break
    }

    // Add navigation actions
    if (config.nextScreen && this.canNavigateToScreen(config.nextScreen).canNavigate) {
      actions.push('next')
    }
    if (config.previousScreen) {
      actions.push('back')
    }

    return actions
  }

  // Check if current screen has all required data
  isScreenReady(): boolean {
    const config = this.getCurrentScreenConfig()
    if (!config.requiredData) return true

    for (const requirement of config.requiredData) {
      if (requirement === 'episodeId' && !this.episodeId) return false
      if (requirement === 'clips' && !this.sessionData.clips?.length) return false
      if (requirement === 'approvedClips' && !this.sessionData.approvedClips?.length) return false
    }

    return true
  }
}