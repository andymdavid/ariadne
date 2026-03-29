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
      case 'home':
      case 'upload':
        return this.handleUploadCommands(command)
      case 'review':
        return this.handleReviewCommands(command)
      case 'brand-template':
      case 'asset-library':
      case 'calendar':
      case 'analytics':
        return this.handleGeneralCommands(command)
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
        return { success: true, message: 'Navigating to home', action: 'navigate' }
      case 'brand template':
      case 'brand-template':
      case 'brand':
        this.context.navigate('/brand-template')
        return { success: true, message: 'Opening brand template', action: 'navigate' }
      case 'asset library':
      case 'asset-library':
      case 'assets':
        this.context.navigate('/asset-library')
        return { success: true, message: 'Opening asset library', action: 'navigate' }
      case 'calendar':
        this.context.navigate('/calendar')
        return { success: true, message: 'Opening calendar', action: 'navigate' }
      case 'analytics':
        this.context.navigate('/analytics')
        return { success: true, message: 'Opening analytics', action: 'navigate' }
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
        return { success: false, message: `Command "/${cmd}" not recognized. Try /home, /brand template, /asset library, /calendar, /analytics, or /help`, action: 'error' }
    }
  }

  private isNavigationCommand(command: string): boolean {
    const navPatterns = [
      /^(go to|goto|navigate to|open)\s+(home|upload|brand template|brand|asset library|assets|calendar|analytics|review|export|settings)/,
      /^(next|continue|proceed)$/,
      /^(back|previous|return)$/,
      /^(home|start over)$/
    ]
    return navPatterns.some(pattern => pattern.test(command))
  }

  private handleNavigation(command: string): CommandResult {
    // Go to specific screen
    const gotoMatch = command.match(/^(go to|goto|navigate to|open)\s+(home|upload|brand template|brand|asset library|assets|calendar|analytics|review|export|settings)/)
    if (gotoMatch) {
      const screen = gotoMatch[2]
      switch (screen) {
        case 'home':
        case 'upload':
          this.context.navigate('/')
          return { success: true, message: 'Navigating to home', action: 'navigate' }
        case 'brand template':
        case 'brand':
          this.context.navigate('/brand-template')
          return { success: true, message: 'Opening brand template', action: 'navigate' }
        case 'asset library':
        case 'assets':
          this.context.navigate('/asset-library')
          return { success: true, message: 'Opening asset library', action: 'navigate' }
        case 'calendar':
          this.context.navigate('/calendar')
          return { success: true, message: 'Opening calendar', action: 'navigate' }
        case 'analytics':
          this.context.navigate('/analytics')
          return { success: true, message: 'Opening analytics', action: 'navigate' }
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
      return { success: false, message: 'No active project flow for next-step navigation', action: 'error' }
    }

    switch (this.context.currentScreen) {
      case 'home':
      case 'upload':
        return { success: false, message: 'Please select a file first', action: 'error' }
      case 'review':
        this.context.navigate(`/export/${this.context.episodeId}`)
        return { success: true, message: 'Moving to export screen', action: 'navigate' }
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
        return { success: true, message: 'Returning to home', action: 'navigate' }
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

  private handleReviewCommands(command: string): CommandResult {
    // Content discovery commands
    const findMatch = command.match(/^find clips? (?:about )?(.+)/)
    if (findMatch) {
      const topic = findMatch[1]
      return {
        success: false,
        message: `Clip search commands are not available yet. Review clips directly in the workspace instead of searching for "${topic}".`,
        action: 'error'
      }
    }

    // Show me X moments
    const showMatch = command.match(/^show me (.+) moments?/)
    if (showMatch) {
      const emotion = showMatch[1]
      return {
        success: false,
        message: `Moment filtering is not available yet. Browse clips directly in the workspace to inspect ${emotion} moments.`,
        action: 'error'
      }
    }

    // Duration filtering
    const durationMatch = command.match(/^clips? (?:under|less than|shorter than) (\d+)\s?(seconds?|secs?|minutes?|mins?)?/)
    if (durationMatch) {
      const duration = parseInt(durationMatch[1])
      const unit = durationMatch[2] || 'seconds'
      return {
        success: false,
        message: `Duration filtering is not available yet. Review clips directly instead of filtering under ${duration} ${unit}.`,
        action: 'error'
      }
    }

    // Bulk actions
    if (command.includes('approve all')) {
      return {
        success: false,
        message: 'Bulk approve commands are not available yet. Approve clips individually in the review workspace.',
        action: 'error'
      }
    }

    if (command.includes('reject') && (command.includes('low') || command.includes('bad'))) {
      return {
        success: false,
        message: 'Bulk reject commands are not available yet. Reject clips individually in the review workspace.',
        action: 'error'
      }
    }

    // Individual clip actions
    if (command.includes('play clip') || command.includes('preview')) {
      return { success: true, message: 'Click a clip to preview it', action: 'execute' }
    }

    return { success: false, message: 'Try: "preview" or use "next" to continue to export once review is complete.', action: 'error' }
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
      case 'home':
      case 'upload':
        return 'Available commands: "select file", "drag and drop", "browse", "go to brand template", "validate system"'
      case 'brand-template':
        return 'Available commands: "go to asset library", "go to calendar", "go to analytics", "validate system"'
      case 'review':
        return 'Available commands: "preview", "next", "back", "go to export", "validate system"'
      default:
        return 'Available commands: "help", "go to home", "go to brand template", "go to asset library", "go to calendar", "go to analytics", "validate system"'
    }
  }
}

// Utility function to create command processor with context
export function createCommandProcessor(context: CommandContext): CommandProcessor {
  return new CommandProcessor(context)
}
