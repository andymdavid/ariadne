import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef, useCallback } from 'react'
import { 
  IoHome, 
  IoCreate, 
  IoLibrary,
  IoCalendar,
  IoAnalytics,
  IoSettings,
  IoChevronForward,
  IoChevronBack
} from 'react-icons/io5'
import { useScreenFlow } from '../stores/projectStore'

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
  route: string
}

export function NavigationDock({ onSearchTrigger: _onSearchTrigger, onCommandModeExit, onCommand, isCommandMode = false, episodeId: _episodeId, isProcessing = false, sessionMessages = [], onAddMessage }: NavigationDockProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [activeScreen, setActiveScreen] = useState<string>('home')
  const [isExpanded, setIsExpanded] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [, setSuggestions] = useState<string[]>([])
  const [filteredSlashCommands, setFilteredSlashCommands] = useState<any[]>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const [localMessages, setLocalMessages] = useState<StatusMessage[]>([])
  const messageCounterRef = useRef(0)
  const commandInputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Use project store for screen flow management
  const { setCurrentScreen } = useScreenFlow()

  // Navigation icons using solid React Icons for Fey aesthetic
  const navIcons: NavIcon[] = [
    {
      id: 'home',
      icon: IoHome,
      label: 'Home',
      route: '/'
    },
    {
      id: 'brand-template',
      icon: IoCreate,
      label: 'Brand Template',
      route: '/brand-template'
    },
    {
      id: 'asset-library',
      icon: IoLibrary,
      label: 'Asset Library',
      route: '/asset-library'
    },
    {
      id: 'calendar',
      icon: IoCalendar,
      label: 'Calendar',
      route: '/calendar'
    },
    {
      id: 'analytics',
      icon: IoAnalytics,
      label: 'Analytics',
      route: '/analytics'
    },
    {
      id: 'settings',
      icon: IoSettings,
      label: 'Settings',
      route: '/settings'
    }
  ]

  // Determine active screen from current location and sync with project store
  useEffect(() => {
    const path = location.pathname
    let screen = 'home'
    
    if (path === '/' || path.startsWith('/review/') || path.startsWith('/content/') || path.startsWith('/export/')) {
      screen = 'home'
    } else if (path === '/brand-template') {
      screen = 'brand-template'
    } else if (path === '/asset-library') {
      screen = 'asset-library'
    } else if (path === '/calendar') {
      screen = 'calendar'
    } else if (path === '/analytics') {
      screen = 'analytics'
    } else if (path === '/settings') {
      screen = 'settings'
    }
    
    setActiveScreen(screen)
    setCurrentScreen(screen)
  }, [location.pathname, setCurrentScreen])

  useEffect(() => {
    document.documentElement.style.setProperty('--nav-dock-width', isExpanded ? '220px' : '72px')

    return () => {
      document.documentElement.style.setProperty('--nav-dock-width', '72px')
    }
  }, [isExpanded])

  // Use session messages from parent or local state
  const displayMessages = sessionMessages.length > 0 ? sessionMessages : localMessages
  
  // Debug: Log when messages change
  useEffect(() => {
    console.log('NavigationDock displayMessages updated:', displayMessages)
  }, [displayMessages])

  // Add a status message
  const addStatusMessage = useCallback((message: string, type: StatusMessage['type'] = 'status', icon?: React.ComponentType<any>) => {
    messageCounterRef.current += 1
    const newMessage: StatusMessage = {
      id: `${Date.now()}-${messageCounterRef.current}`,
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

  useEffect(() => {
    if (!isCommandMode) {
      setCommandInput('')
      setShowSlashCommands(false)
      setFilteredSlashCommands([])
    }
  }, [isCommandMode])

  // Handle navigation icon click
  const handleNavClick = (navIcon: NavIcon) => {
    console.log('Navigating to:', navIcon.route)
    navigate(navIcon.route)
  }

  // Handle command input changes with autocomplete
  const handleCommandInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCommandInput(value)
    
    // Check if it's a slash command
    if (value.startsWith('/')) {
      setShowSlashCommands(true)
      
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
      home: ['select file', 'browse files', 'open recent project'],
      'brand-template': ['caption defaults', 'overlay defaults', 'music defaults'],
      'asset-library': ['logos', 'music', 'fonts'],
      calendar: ['schedule post', 'upload local video'],
      analytics: ['top clips', 'best hooks', 'performance summary']
    }

    const currentSuggestions = suggestions[activeScreen as keyof typeof suggestions] || suggestions.home
    
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
      { id: 'home', command: '/home', description: 'Go to home' },
      { id: 'brand', command: '/brand template', description: 'Open brand template' },
      { id: 'assets', command: '/asset library', description: 'Open asset library' },
      { id: 'calendar', command: '/calendar', description: 'Open calendar' },
      { id: 'analytics', command: '/analytics', description: 'Open analytics' },
      { id: 'settings', command: '/settings', description: 'Open settings' },
    ]

    const screenCommands = {
      home: [
        { id: 'select', command: '/select file', description: 'Choose a file to upload' },
        { id: 'browse', command: '/browse', description: 'Open file browser' },
      ],
      'brand-template': [
        { id: 'captions', command: '/caption defaults', description: 'Edit shared caption styling' },
        { id: 'overlay', command: '/overlay defaults', description: 'Adjust logo and CTA defaults' },
      ],
      'asset-library': [
        { id: 'logos', command: '/logos', description: 'Manage reusable logos and overlays' },
        { id: 'music', command: '/music', description: 'Manage reusable music assets' },
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

      <div
        className={`fixed left-0 top-0 bottom-0 z-30 flex flex-col border-r border-border-default bg-[#0b0c10] px-3 py-4 transition-[width] duration-200 ${
          isExpanded ? 'w-[220px]' : 'w-[72px]'
        }`}
      >
        <div className={`flex items-center ${isExpanded ? 'justify-between gap-3 px-1 pb-5' : 'justify-center pb-5'}`}>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-[5px] border border-white/8 bg-[#13151b] text-text-primary transition-colors hover:bg-[#171a21]"
            title="Home"
          >
            <span className="text-sm font-semibold tracking-[0.18em]">A</span>
          </button>

          {isExpanded && (
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-[0.22em] text-text-muted">Ariadne</div>
              <div className="mt-1 text-sm text-text-secondary">Navigation</div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            className="flex h-10 w-10 items-center justify-center rounded-[5px] border border-white/8 bg-[#13151b] text-text-secondary transition-colors hover:bg-[#171a21] hover:text-text-primary"
            title={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isExpanded ? <IoChevronBack size={16} /> : <IoChevronForward size={16} />}
          </button>
        </div>

        <div className="flex-1 space-y-1.5">
          {navIcons.map((navIcon) => {
            const IconComponent = navIcon.icon

            return (
              <button
                key={navIcon.id}
                type="button"
                onClick={() => handleNavClick(navIcon)}
                className={`flex w-full items-center rounded-[5px] border text-left transition-colors ${
                  activeScreen === navIcon.id
                    ? 'border-white/12 bg-[#171a20] text-text-primary'
                    : 'border-transparent bg-transparent text-text-secondary hover:border-white/8 hover:bg-[#12151a] hover:text-text-primary'
                } ${isExpanded ? 'gap-3 px-3 py-3' : 'justify-center px-0 py-3'}`}
                title={navIcon.label}
              >
                <IconComponent size={18} />
                {isExpanded && <span className="text-sm font-medium">{navIcon.label}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {isCommandMode && !isProcessing && displayMessages.length === 0 && (
        <div
          className="fixed top-6 z-40 w-[560px] rounded-2xl border border-border-default bg-bg-primary/95 p-4 shadow-2xl backdrop-blur-xl"
          style={{ left: 'calc(var(--nav-dock-width, 72px) + 24px)' }}
        >
          <div className="command-input-container">
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
        </div>
      )}
    </>
  )
}
