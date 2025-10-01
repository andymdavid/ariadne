import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  IoFolderOpen, 
  IoCheckmarkCircle, 
  IoCreate, 
  IoCloudUpload, 
  IoLibrary,
  IoSettings,
  IoSearch 
} from 'react-icons/io5'
import { useScreenFlow, useProjectData } from '../stores/projectStore'

export interface StatusMessage {
  id: string
  type: 'status' | 'success' | 'error' | 'info'
  message: string
  timestamp: Date
  icon?: React.ComponentType<any>
}

interface NavigationDockProps {
  onSearchTrigger: () => void
  onCommandModeExit?: () => void
  onCommand?: (command: string) => void
  isCommandMode?: boolean
  episodeId?: string
  isProcessing?: boolean
  sessionMessages?: StatusMessage[]
  onAddMessage?: (message: StatusMessage) => void
  showStatusMode?: boolean
}

interface NavIcon {
  id: string
  icon: React.ComponentType<any>
  label: string
  route: string | ((episodeId?: string) => string)
  requiresEpisode?: boolean
}

export function NavigationDock({ onSearchTrigger, onCommandModeExit, onCommand, isCommandMode = false, episodeId, isProcessing = false, sessionMessages = [], onAddMessage, showStatusMode = false }: NavigationDockProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeScreen, setActiveScreen] = useState<string>('upload')
  const [commandInput, setCommandInput] = useState('')
  const [isExpanding, setIsExpanding] = useState(false)
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [filteredSlashCommands, setFilteredSlashCommands] = useState<any[]>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [localMessages, setLocalMessages] = useState<StatusMessage[]>([])
  const commandInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Use project store for screen flow management
  const { 
    currentScreen,
    completedScreens,
    canAccessScreen, 
    isScreenCompleted, 
    setCurrentScreen
  } = useScreenFlow()
  
  // Get project data including episode ID
  const { currentEpisode } = useProjectData()
  
  // Use episode ID from store if not provided as prop
  const activeEpisodeId = episodeId || currentEpisode?.id

  // Navigation icons using solid React Icons for Fey aesthetic
  const navIcons: NavIcon[] = [
    {
      id: 'upload',
      icon: IoFolderOpen,
      label: 'Upload',
      route: '/'
    },
    {
      id: 'review',
      icon: IoCheckmarkCircle,
      label: 'Review',
      route: (episodeId) => episodeId ? `/review/${episodeId}` : '/',
      requiresEpisode: true
    },
    {
      id: 'content',
      icon: IoCreate,
      label: 'Content',
      route: (episodeId) => episodeId ? `/content/${episodeId}` : '/',
      requiresEpisode: true
    },
    {
      id: 'export',
      icon: IoCloudUpload,
      label: 'Export',
      route: (episodeId) => episodeId ? `/export/${episodeId}` : '/',
      requiresEpisode: true
    },
    {
      id: 'library',
      icon: IoLibrary,
      label: 'Library',
      route: '/library'
    }
  ]

  // Determine active screen from current location and sync with project store
  useEffect(() => {
    const path = location.pathname
    let screen = 'upload'
    
    if (path === '/') {
      screen = 'upload'
    } else if (path.startsWith('/review/')) {
      screen = 'review'
    } else if (path.startsWith('/content/')) {
      screen = 'content'
    } else if (path.startsWith('/export/')) {
      screen = 'export'
    } else if (path === '/library') {
      screen = 'library'
    }
    
    setActiveScreen(screen)
    setCurrentScreen(screen)
  }, [location.pathname, setCurrentScreen])

  // Use session messages from parent or local state
  const displayMessages = sessionMessages.length > 0 ? sessionMessages : localMessages
  
  // Debug: Log when messages change
  useEffect(() => {
    console.log('NavigationDock displayMessages updated:', displayMessages)
  }, [displayMessages])

  // Add a status message
  const addStatusMessage = useCallback((message: string, type: StatusMessage['type'] = 'status', icon?: React.ComponentType<any>) => {
    const newMessage: StatusMessage = {
      id: Date.now().toString(),
      type,
      message,
      timestamp: new Date(),
      icon
    }
    
    // If parent handles session messages, use that; otherwise use local state
    if (onAddMessage) {
      onAddMessage(newMessage)
    } else {
      setLocalMessages(prev => [...prev, newMessage])
    }
  }, [onAddMessage])

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current && isCommandMode && !showSlashCommands) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [displayMessages, isCommandMode, showSlashCommands])

  // Handle 3-phase command mode transition
  useEffect(() => {
    if (isCommandMode) {
      // Phase 1: Icons fade out (handled by CSS)
      // Phase 2: Start expansion after 150ms
      setTimeout(() => {
        setIsExpanding(true)
      }, 150)
      
      // Phase 3: Input appears (handled by CSS with delay)
    } else {
      // Reset states when exiting command mode
      setIsExpanding(false)
      setCommandInput('')
      setShowSlashCommands(false)
      setFilteredSlashCommands([])
    }
  }, [isCommandMode])

  // Handle navigation icon click
  const handleNavClick = (navIcon: NavIcon) => {
    console.log('Navigation click:', {
      screen: navIcon.id,
      label: navIcon.label,
      canAccess: canAccessScreen(navIcon.id),
      isCompleted: isScreenCompleted(navIcon.id),
      completedScreens: Array.from(completedScreens),
      episodeId,
      activeEpisodeId
    })
    
    // Check if screen can be accessed based on workflow completion
    if (!canAccessScreen(navIcon.id)) {
      console.log('Screen not accessible yet:', navIcon.label, {
        canAccess: canAccessScreen(navIcon.id),
        isCompleted: isScreenCompleted(navIcon.id),
        completedScreens: Array.from(completedScreens)
      })
      return
    }
    
    if (navIcon.requiresEpisode && !activeEpisodeId) {
      // Show tooltip or feedback that episode is required
      console.log('Episode required for', navIcon.label, { episodeId, activeEpisodeId })
      return
    }

    const route = typeof navIcon.route === 'function' 
      ? navIcon.route(activeEpisodeId) 
      : navIcon.route
    
    console.log('Navigating to:', route)
    navigate(route)
  }

  // Check if nav icon is disabled
  const isIconDisabled = (navIcon: NavIcon): boolean => {
    // Disable if workflow requirements aren't met or episode is required but missing
    return !canAccessScreen(navIcon.id) || (navIcon.requiresEpisode && !activeEpisodeId)
  }

  // Get context-aware placeholder text
  const getCommandPlaceholder = (): string => {
    if (isProcessing) return 'Type "/cancel" to stop processing...'
    if (commandInput.length > 0) return ''
    
    return 'Press / or ⌘K for commands, Space to type...'
  }

  // Handle command input changes with autocomplete
  const handleCommandInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCommandInput(value)
    
    // Check if it's a slash command
    if (value.startsWith('/')) {
      setShowSlashCommands(true)
      setSuggestions([])
      
      const searchTerm = value.slice(1).toLowerCase()
      const allCommands = getSlashCommands()
      
      // Filter commands based on input
      const filtered = allCommands.filter(cmd => 
        cmd.command.toLowerCase().includes(value.toLowerCase())
      )
      
      setFilteredSlashCommands(filtered)
      setSelectedCommandIndex(0)
      
      // Auto-complete if there's a single unambiguous match (only if typing forward)
      if (searchTerm.length > 1) { // Require at least 2 characters to avoid aggressive completion
        const exactMatches = filtered.filter(cmd => 
          cmd.command.toLowerCase().startsWith(value.toLowerCase())
        )
        
        // If there's exactly one match that starts with our input, auto-complete
        if (exactMatches.length === 1) {
          const match = exactMatches[0]
          const completion = match.command
          
          // Only auto-complete if it's longer than current input and input is growing
          if (completion.length > value.length && commandInputRef.current) {
            // Use a more gentle approach - update the value without forcing selection
            setTimeout(() => {
              if (commandInputRef.current && commandInputRef.current.value === value) {
                commandInputRef.current.value = completion
                commandInputRef.current.setSelectionRange(value.length, completion.length)
                setCommandInput(completion)
              }
            }, 100) // Small delay to allow normal typing
          }
        }
      }
    } else {
      setShowSlashCommands(false)
      setFilteredSlashCommands([])
      // Generate contextual suggestions
      setSuggestions(getContextualSuggestions(value))
    }
  }

  // Get contextual suggestions based on current screen
  const getContextualSuggestions = (input: string): string[] => {
    const suggestions = {
      upload: ['select file', 'browse files', 'drag and drop'],
      processing: ['view progress', 'cancel processing', 'show details'],
      review: [
        'find clips about AI',
        'show controversial moments', 
        'clips under 30 seconds',
        'approve all high scores',
        'reject low scores'
      ],
      content: ['create titles', 'write descriptions', 'select thumbnails'],
      export: ['export all', 'export as instagram', 'export as youtube', 'save project']
    }

    const currentSuggestions = suggestions[activeScreen as keyof typeof suggestions] || suggestions.review
    
    if (!input) return currentSuggestions.slice(0, 3)
    
    return currentSuggestions.filter(suggestion => 
      suggestion.toLowerCase().includes(input.toLowerCase())
    ).slice(0, 3)
  }

  // Handle command input key navigation with autocomplete
  const handleCommandKeyDown = (e: React.KeyboardEvent) => {
    // Handle backspace to clear selection and allow normal editing
    if (e.key === 'Backspace' && commandInputRef.current) {
      const input = commandInputRef.current
      if (input.selectionStart !== input.selectionEnd) {
        // If there's a selection (from autocomplete), just clear it and let normal backspace work
        input.setSelectionRange(input.selectionStart, input.selectionStart)
      }
    }
    
    // Handle slash command navigation
    if (showSlashCommands && filteredSlashCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(prev => 
          prev < filteredSlashCommands.length - 1 ? prev + 1 : 0
        )
        return
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(prev => 
          prev > 0 ? prev - 1 : filteredSlashCommands.length - 1
        )
        return
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const selectedCommand = filteredSlashCommands[selectedCommandIndex]
        setCommandInput(selectedCommand.command)
        return
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selectedCommand = filteredSlashCommands[selectedCommandIndex]
        if (selectedCommand && onCommand) {
          onCommand(selectedCommand.command) // Keep the leading slash
          setCommandInput('')
          setShowSlashCommands(false)
          setFilteredSlashCommands([])
        }
        return
      }
    }
    
    // Regular command handling
    if (e.key === 'Enter' && commandInput.trim()) {
      const commandText = commandInput.startsWith('/') ? commandInput.slice(1) : commandInput
      
      // Add command to status messages
      addStatusMessage(`> ${commandInput}`, 'info')
      
      if (onCommand) {
        onCommand(commandText)
      }
      
      setCommandInput('')
      setShowSlashCommands(false)
      setSuggestions([])
      setFilteredSlashCommands([])
    } else if (e.key === 'Escape') {
      setCommandInput('')
      setShowSlashCommands(false)
      setSuggestions([])
      setFilteredSlashCommands([])
      if (onCommandModeExit) {
        onCommandModeExit()
      }
    }
  }

  // Handle command input focus
  const handleCommandFocus = () => {
    if (commandInput.startsWith('/')) {
      setShowSlashCommands(true)
      const allCommands = getSlashCommands()
      const filtered = allCommands.filter(cmd => 
        cmd.command.toLowerCase().includes(commandInput.toLowerCase())
      )
      setFilteredSlashCommands(filtered)
      setSelectedCommandIndex(0)
    } else {
      setSuggestions(getContextualSuggestions(commandInput))
    }
  }

  // Handle command input blur
  const handleCommandBlur = () => {
    // Delay to allow clicks on suggestions
    setTimeout(() => {
      setShowSlashCommands(false)
      setSuggestions([])
      setFilteredSlashCommands([])
    }, 150)
  }

  // Get available slash commands based on current screen
  const getSlashCommands = () => {
    const commonCommands = [
      { id: 'help', command: '/help', description: 'Show available commands' },
      { id: 'home', command: '/home', description: 'Go to upload screen' },
      { id: 'settings', command: '/settings', description: 'Open settings' },
    ]

    const screenCommands = {
      upload: [
        { id: 'select', command: '/select file', description: 'Choose a file to upload' },
        { id: 'browse', command: '/browse', description: 'Open file browser' },
      ],
      processing: [
        { id: 'status', command: '/status', description: 'View processing progress' },
        { id: 'cancel', command: '/cancel', description: 'Cancel processing' },
      ],
      review: [
        { id: 'find', command: '/find clips about', description: 'Search clips by topic' },
        { id: 'approve', command: '/approve all', description: 'Approve high-scoring clips' },
        { id: 'reject', command: '/reject low scores', description: 'Reject low-scoring clips' },
      ],
      content: [
        { id: 'titles', command: '/create titles', description: 'Generate titles for clips' },
        { id: 'descriptions', command: '/write descriptions', description: 'Generate descriptions' },
        { id: 'thumbnails', command: '/select thumbnails', description: 'Choose thumbnails' },
      ],
      export: [
        { id: 'instagram', command: '/export as instagram', description: 'Export for Instagram Stories' },
        { id: 'youtube', command: '/export as youtube', description: 'Export for YouTube Shorts' },
        { id: 'all', command: '/export all', description: 'Export all approved clips' },
      ]
    }

    const currentCommands = screenCommands[activeScreen as keyof typeof screenCommands] || []
    return [...currentCommands, ...commonCommands]
  }

  return (
    <>
      {/* Status Mode Display (replaces command suggestions) */}
      {isCommandMode && !showSlashCommands && displayMessages.length > 0 && (
        <div className="status-display-dropdown">
          <div className="status-dropdown-header">
            <span className="status-dropdown-title">Session Status</span>
            <span className="status-dropdown-hint">Type <kbd>/</kbd> for commands • <kbd>Esc</kbd> to exit</span>
          </div>
          
          <div className="status-messages-dropdown">
            {displayMessages.map((msg) => {
              const isAICompanion = msg.message.includes('🤖') || msg.message.includes('Activating Ariadne') ||
                                   msg.message.includes('Analyzing your podcast') || msg.message.includes('Extracting audio') || 
                                   msg.message.includes('Transcribing audio') || msg.message.includes('Analyzing content') ||
                                   msg.message.includes('Identifying engaging') || msg.message.includes('🔄')
              const showThinking = isProcessing && msg.type === 'status' && isAICompanion
              
              return (
                <div key={msg.id} className={`status-message-dropdown ${msg.type} ${isAICompanion ? 'ai-companion' : ''}`}>
                  {msg.icon && (
                    <msg.icon className="status-message-icon-dropdown" size={16} />
                  )}
                  <span className="status-message-text-dropdown">
                    {msg.message}
                    {showThinking && <span className="ai-thinking-dots"></span>}
                  </span>
                  <span className="status-message-time-dropdown">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )
            })}
            <div ref={messagesEndRef} />
          </div>
        </div>
      )}

      {/* Command Suggestions - removed since replaced by status mode */}

      {/* Slash Command Palette with Autocomplete */}
      {showSlashCommands && isCommandMode && filteredSlashCommands.length > 0 && (
        <div className="slash-command-palette">
          <div className="command-palette-header">
            <span className="command-palette-title">Available Commands</span>
            <span className="command-palette-hint">↑↓ navigate • Tab complete • Enter execute</span>
          </div>
          
          <div className="command-category">
            <div className="command-category-header">
              {filteredSlashCommands.length === 1 ? 'Match' : `${filteredSlashCommands.length} Matches`}
            </div>
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                className={`slash-command ${index === selectedCommandIndex ? 'selected' : ''}`}
                onMouseDown={() => {
                  setCommandInput(command.command)
                  commandInputRef.current?.focus()
                }}
                onMouseEnter={() => setSelectedCommandIndex(index)}
              >
                <span className="command-label">{command.command}</span>
                <span className="command-description">{command.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Navigation Dock */}
      <div className={`navigation-dock ${isCommandMode ? 'command-mode' : ''} ${isExpanding ? 'expanding' : ''}`}>
        {/* Navigation Icons - Only render in default state */}
        {!isCommandMode && navIcons.map((navIcon) => {
          const IconComponent = navIcon.icon
          const completed = isScreenCompleted(navIcon.id)
          const accessible = canAccessScreen(navIcon.id)
          const disabled = isIconDisabled(navIcon)
          
          return (
            <button
              key={navIcon.id}
              className={`nav-icon ${activeScreen === navIcon.id ? 'active' : ''} ${disabled ? 'disabled' : ''} ${completed ? 'completed' : ''} ${!accessible ? 'inaccessible' : ''}`}
              onClick={() => handleNavClick(navIcon)}
              disabled={disabled}
              title={`${navIcon.label}${completed ? ' (Completed)' : ''}${!accessible ? ' (Locked)' : ''}`}
            >
              <IconComponent className="nav-icon-solid" size={20} />
              {completed && (
                <div className="completion-indicator">
                  <IoCheckmarkCircle size={12} />
                </div>
              )}
            </button>
          )
        })}

        {/* Progress Indicator */}
        <div className="progress-indicator">
          <div 
            className="progress-fill"
            style={{ 
              width: `${getProgressPercentage(activeScreen)}%` 
            }}
          />
        </div>

        {/* Command Input (hidden initially, shown in command mode) */}
        {isCommandMode && (
          <div className="command-input-container">
            {/* Custom placeholder with styled kbd elements */}
            {!commandInput && (
              <div className="custom-placeholder">
                {isProcessing ? (
                  <>Type <kbd>/cancel</kbd> to stop processing...</>
                ) : (
                  <>Press <kbd>/</kbd> or <kbd>⌘K</kbd> for commands, <kbd>Space</kbd> to type...</>
                )}
              </div>
            )}
            <input
              ref={commandInputRef}
              className="command-input active"
              placeholder=""
              value={commandInput}
              onChange={handleCommandInputChange}
              onKeyDown={handleCommandKeyDown}
              onFocus={handleCommandFocus}
              onBlur={handleCommandBlur}
              autoFocus
            />
            {isProcessing && (
              <div className="processing-spinner" style={{ marginLeft: '12px' }} />
            )}
          </div>
        )}
      </div>

      {/* Search Trigger Button */}
      <button 
        className={`search-trigger ${isCommandMode ? 'command-mode' : ''}`}
        onClick={() => {
          if (isCommandMode && onCommandModeExit) {
            onCommandModeExit()
          } else {
            onSearchTrigger()
          }
        }}
        title={isCommandMode ? "Exit command mode (Esc)" : "Search commands (⌘K)"}
      >
        {isCommandMode ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        ) : (
          <IoSearch className="search-icon-solid" size={20} />
        )}
      </button>
    </>
  )
}

// Calculate progress percentage based on current screen
function getProgressPercentage(activeScreen: string): number {
  // Smooth progress calculation with meaningful steps
  const progressSteps = {
    upload: 0,      // Starting point
    review: 33,     // Processing complete, reviewing clips
    content: 66,    // Clips reviewed, creating content
    export: 100,    // Content ready, exporting
    library: 0      // Independent screen
  }
  
  return progressSteps[activeScreen as keyof typeof progressSteps] || 0
}