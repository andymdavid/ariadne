import { NavigateFunction } from 'react-router-dom'
import { runSystemValidation } from '../utils/systemValidation'

export interface CommandResult {
  success: boolean
  message: string
  action?: 'navigate' | 'filter' | 'execute' | 'error'
  data?: any
}

export interface CommandContext {
  currentScreen: string
  navigate: NavigateFunction
  episodeId?: string
  clips?: any[]
  setClipsFilter?: (filter: any) => void
  onApproveAll?: () => void
  onRejectLowScores?: () => void
  onExport?: (format?: string) => void
}

export class CommandProcessor {
  private context: CommandContext

  constructor(context: CommandContext) {
    this.context = context
  }

  updateContext(context: Partial<CommandContext>) {
    this.context = { ...this.context, ...context }
  }

  async processCommand(input: string): Promise<CommandResult> {
    const command = input.toLowerCase().trim()

    console.log('Processing command:', command, 'on screen:', this.context.currentScreen)

    // Slash commands (shorthand navigation)
    if (command.startsWith('/')) {
      return this.handleSlashCommand(command)
    }

    // Navigation commands (work from any screen)
    if (this.isNavigationCommand(command)) {
      return this.handleNavigation(command)
    }

    // Screen-specific commands
    switch (this.context.currentScreen) {
      case 'upload':
        return this.handleUploadCommands(command)
      case 'processing':
        return this.handleProcessingCommands(command)
      case 'review':
        return this.handleReviewCommands(command)
      case 'content':
        return this.handleContentCommands(command)
      case 'export':
        return this.handleExportCommands(command)
      default:
        return this.handleGeneralCommands(command)
    }
  }

  private handleSlashCommand(command: string): CommandResult {
    const cmd = command.slice(1) // Remove the leading slash

    switch (cmd) {
      case 'settings':
        this.context.navigate('/settings')
        return { success: true, message: 'Opening settings', action: 'navigate' }
      case 'home':
      case 'upload':
        this.context.navigate('/')
        return { success: true, message: 'Navigating to upload screen', action: 'navigate' }
      case 'library':
        this.context.navigate('/library')
        return { success: true, message: 'Opening library', action: 'navigate' }
      case 'review':
        if (this.context.episodeId) {
          this.context.navigate(`/review/${this.context.episodeId}`)
          return { success: true, message: 'Navigating to review screen', action: 'navigate' }
        }
        return { success: false, message: 'No episode available to review', action: 'error' }
      case 'content':
        if (this.context.episodeId) {
          this.context.navigate(`/content/${this.context.episodeId}`)
          return { success: true, message: 'Navigating to content screen', action: 'navigate' }
        }
        return { success: false, message: 'No episode available', action: 'error' }
      case 'export':
        if (this.context.episodeId) {
          this.context.navigate(`/export/${this.context.episodeId}`)
          return { success: true, message: 'Navigating to export screen', action: 'navigate' }
        }
        return { success: false, message: 'No episode available to export', action: 'error' }
      case 'help':
        const helpText = this.getContextualHelp()
        return { success: true, message: helpText, action: 'execute' }
      default:
        return { success: false, message: `Command "/${cmd}" not recognized. Try /settings, /home, /library, or /help`, action: 'error' }
    }
  }

  private isNavigationCommand(command: string): boolean {
    const navPatterns = [
      /^(go to|goto|navigate to|open)\s+(upload|processing|review|content|export|settings)/,
      /^(next|continue|proceed)$/,
      /^(back|previous|return)$/,
      /^(home|start over)$/
    ]
    return navPatterns.some(pattern => pattern.test(command))
  }

  private handleNavigation(command: string): CommandResult {
    // Go to specific screen
    const gotoMatch = command.match(/^(go to|goto|navigate to|open)\s+(upload|processing|review|content|export|settings)/)
    if (gotoMatch) {
      const screen = gotoMatch[2]
      switch (screen) {
        case 'upload':
          this.context.navigate('/')
          return { success: true, message: 'Navigating to upload screen', action: 'navigate' }
        case 'settings':
          this.context.navigate('/settings')
          return { success: true, message: 'Opening settings', action: 'navigate' }
        case 'review':
          if (this.context.episodeId) {
            this.context.navigate(`/review/${this.context.episodeId}`)
            return { success: true, message: 'Navigating to review screen', action: 'navigate' }
          }
          return { success: false, message: 'No episode available to review', action: 'error' }
        case 'export':
          if (this.context.episodeId) {
            this.context.navigate(`/export/${this.context.episodeId}`)
            return { success: true, message: 'Navigating to export screen', action: 'navigate' }
          }
          return { success: false, message: 'No episode available to export', action: 'error' }
      }
    }

    // Next/Back navigation
    if (command === 'next' || command === 'continue' || command === 'proceed') {
      return this.handleNextNavigation()
    }

    if (command === 'back' || command === 'previous' || command === 'return') {
      return this.handleBackNavigation()
    }

    if (command === 'home' || command === 'start over') {
      this.context.navigate('/')
      return { success: true, message: 'Returning to home screen', action: 'navigate' }
    }

    return { success: false, message: 'Navigation command not recognized', action: 'error' }
  }

  private handleNextNavigation(): CommandResult {
    if (!this.context.episodeId) {
      return { success: false, message: 'No active episode for navigation', action: 'error' }
    }

    switch (this.context.currentScreen) {
      case 'upload':
        // Should trigger processing
        return { success: false, message: 'Please select a file first', action: 'error' }
      case 'processing':
        return { success: false, message: 'Processing in progress, please wait', action: 'error' }
      case 'review':
        this.context.navigate(`/export/${this.context.episodeId}`)
        return { success: true, message: 'Moving to export screen', action: 'navigate' }
      case 'export':
        return { success: false, message: 'Export is the final step', action: 'error' }
      default:
        return { success: false, message: 'Cannot navigate forward from this screen', action: 'error' }
    }
  }

  private handleBackNavigation(): CommandResult {
    switch (this.context.currentScreen) {
      case 'export':
        if (this.context.episodeId) {
          this.context.navigate(`/review/${this.context.episodeId}`)
          return { success: true, message: 'Returning to review screen', action: 'navigate' }
        }
        break
      case 'review':
        this.context.navigate('/')
        return { success: true, message: 'Returning to upload screen', action: 'navigate' }
      case 'settings':
        this.context.navigate('/')
        return { success: true, message: 'Returning to home screen', action: 'navigate' }
    }
    return { success: false, message: 'Cannot navigate back from this screen', action: 'error' }
  }

  private handleUploadCommands(command: string): CommandResult {
    if (command.includes('select file') || command.includes('choose file') || command.includes('browse')) {
      // Trigger file selection
      return { success: true, message: 'Opening file browser...', action: 'execute', data: { action: 'selectFile' } }
    }

    if (command.includes('drag') || command.includes('drop')) {
      return { success: true, message: 'You can drag and drop files onto the upload area', action: 'execute' }
    }

    return { success: false, message: 'Try: "select file", "drag and drop", or "browse"', action: 'error' }
  }

  private handleProcessingCommands(command: string): CommandResult {
    if (command.includes('cancel') || command.includes('stop')) {
      return { success: true, message: 'Processing cancelled', action: 'execute', data: { action: 'cancelProcessing' } }
    }

    if (command.includes('progress') || command.includes('status')) {
      return { success: true, message: 'Showing processing progress', action: 'execute' }
    }

    return { success: false, message: 'Try: "cancel processing" or "view progress"', action: 'error' }
  }

  private handleReviewCommands(command: string): CommandResult {
    // Content discovery commands
    const findMatch = command.match(/^find clips? (?:about )?(.+)/)
    if (findMatch) {
      const topic = findMatch[1]
      return { 
        success: true, 
        message: `Searching for clips about "${topic}"`, 
        action: 'filter', 
        data: { action: 'searchClips', topic } 
      }
    }

    // Show me X moments
    const showMatch = command.match(/^show me (.+) moments?/)
    if (showMatch) {
      const emotion = showMatch[1]
      return { 
        success: true, 
        message: `Filtering for ${emotion} moments`, 
        action: 'filter', 
        data: { action: 'filterByEmotion', emotion } 
      }
    }

    // Duration filtering
    const durationMatch = command.match(/^clips? (?:under|less than|shorter than) (\d+)\s?(seconds?|secs?|minutes?|mins?)?/)
    if (durationMatch) {
      const duration = parseInt(durationMatch[1])
      const unit = durationMatch[2] || 'seconds'
      const seconds = unit.startsWith('min') ? duration * 60 : duration
      return { 
        success: true, 
        message: `Showing clips under ${duration} ${unit}`, 
        action: 'filter', 
        data: { action: 'filterByDuration', maxDuration: seconds } 
      }
    }

    // Bulk actions
    if (command.includes('approve all')) {
      const scoreMatch = command.match(/approve all (?:clips? )?(?:with )?(?:high )?scores?(?: (?:above|over) (\d+))?/)
      const minScore = scoreMatch ? parseInt(scoreMatch[1]) || 7 : 7
      return { 
        success: true, 
        message: `Approving all clips with scores ${minScore}+`, 
        action: 'execute', 
        data: { action: 'approveHighScores', minScore } 
      }
    }

    if (command.includes('reject') && (command.includes('low') || command.includes('bad'))) {
      const scoreMatch = command.match(/reject (?:all )?(?:clips? )?(?:with )?(?:low )?scores?(?: (?:below|under) (\d+))?/)
      const maxScore = scoreMatch ? parseInt(scoreMatch[1]) || 5 : 5
      return { 
        success: true, 
        message: `Rejecting clips with scores ${maxScore} and below`, 
        action: 'execute', 
        data: { action: 'rejectLowScores', maxScore } 
      }
    }

    // Individual clip actions
    if (command.includes('play clip') || command.includes('preview')) {
      return { success: true, message: 'Click a clip to preview it', action: 'execute' }
    }

    return { success: false, message: 'Try: "find clips about AI", "approve all high scores", "clips under 30 seconds"', action: 'error' }
  }

  private handleContentCommands(command: string): CommandResult {
    if (command.includes('create titles') || command.includes('generate titles')) {
      return { 
        success: true, 
        message: 'Generating titles for approved clips', 
        action: 'execute', 
        data: { action: 'generateTitles' } 
      }
    }

    if (command.includes('write descriptions') || command.includes('generate descriptions')) {
      return { 
        success: true, 
        message: 'Writing descriptions for clips', 
        action: 'execute', 
        data: { action: 'generateDescriptions' } 
      }
    }

    if (command.includes('thumbnails')) {
      return { 
        success: true, 
        message: 'Selecting thumbnails for clips', 
        action: 'execute', 
        data: { action: 'selectThumbnails' } 
      }
    }

    return { success: false, message: 'Try: "create titles", "write descriptions", or "select thumbnails"', action: 'error' }
  }

  private handleExportCommands(command: string): CommandResult {
    // Export format commands
    if (command.includes('instagram') || command.includes('ig') || command.includes('stories')) {
      return { 
        success: true, 
        message: 'Exporting as Instagram Stories (9:16)', 
        action: 'execute', 
        data: { action: 'export', format: 'instagram' } 
      }
    }

    if (command.includes('youtube') || command.includes('yt') || command.includes('shorts')) {
      return { 
        success: true, 
        message: 'Exporting as YouTube Shorts (9:16)', 
        action: 'execute', 
        data: { action: 'export', format: 'youtube' } 
      }
    }

    if (command.includes('tiktok') || command.includes('tt')) {
      return { 
        success: true, 
        message: 'Exporting as TikTok format (9:16)', 
        action: 'execute', 
        data: { action: 'export', format: 'tiktok' } 
      }
    }

    if (command.includes('export all') || command.includes('export everything')) {
      return { 
        success: true, 
        message: 'Exporting all approved clips', 
        action: 'execute', 
        data: { action: 'exportAll' } 
      }
    }

    if (command.includes('save project') || command.includes('save')) {
      return { 
        success: true, 
        message: 'Saving project', 
        action: 'execute', 
        data: { action: 'saveProject' } 
      }
    }

    return { success: false, message: 'Try: "export as instagram", "export all", or "save project"', action: 'error' }
  }

  private handleGeneralCommands(command: string): CommandResult {
    // Help command
    if (command.includes('help') || command === '?') {
      const helpText = this.getContextualHelp()
      return { success: true, message: helpText, action: 'execute' }
    }

    // System validation command
    if (command.includes('validate') || command.includes('validation') || command.includes('system check') || command.includes('health check')) {
      try {
        const result = runSystemValidation()
        const summary = result.isValid 
          ? `✅ System validation PASSED - All systems operational`
          : `❌ System validation FAILED - ${result.errors.length} errors, ${result.warnings.length} warnings`
        
        return { 
          success: result.isValid, 
          message: summary, 
          action: 'execute',
          data: { action: 'systemValidation', result }
        }
      } catch (error) {
        return { 
          success: false, 
          message: `System validation failed: ${error}`, 
          action: 'error' 
        }
      }
    }

    // Clear command
    if (command === 'clear' || command === 'reset') {
      return { success: true, message: 'Cleared', action: 'execute' }
    }

    return { success: false, message: `Command "${command}" not recognized. Type "help" for available commands.`, action: 'error' }
  }

  private getContextualHelp(): string {
    switch (this.context.currentScreen) {
      case 'upload':
        return 'Available commands: "select file", "drag and drop", "browse", "validate system"'
      case 'review':
        return 'Available commands: "find clips about [topic]", "approve all high scores", "clips under [duration]", "next", "validate system"'
      case 'export':
        return 'Available commands: "export as instagram", "export all", "save project", "validate system"'
      default:
        return 'Available commands: "help", "next", "back", "go to [screen]", "validate system"'
    }
  }
}

// Utility function to create command processor with context
export function createCommandProcessor(context: CommandContext): CommandProcessor {
  return new CommandProcessor(context)
}