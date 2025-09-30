import { useState, useEffect, useRef, useCallback } from 'react'
import { IoCheckmarkCircle, IoCloudUpload, IoCreate, IoFlash } from 'react-icons/io5'

export interface StatusMessage {
  id: string
  type: 'status' | 'success' | 'error' | 'info'
  message: string
  timestamp: Date
  icon?: React.ComponentType<any>
}

interface CommandDisplayProps {
  isProcessing?: boolean
  onCommand?: (command: string) => void
  onFileSelect?: () => void
  sessionMessages?: StatusMessage[]
  onAddMessage?: (message: StatusMessage) => void
}

interface SlashCommand {
  id: string
  command: string
  description: string
}

export function CommandDisplay({ isProcessing = false, onCommand, onFileSelect, sessionMessages = [], onAddMessage }: CommandDisplayProps) {
  const [isCommandMode, setIsCommandMode] = useState(false)
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [commandInput, setCommandInput] = useState('')
  const [statusMessages, setStatusMessages] = useState<StatusMessage[]>([])
  const [filteredSlashCommands, setFilteredSlashCommands] = useState<SlashCommand[]>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  
  const inputRef = useRef<HTMLInputElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  
  // Use session messages from parent or local state
  const displayMessages = sessionMessages.length > 0 ? sessionMessages : statusMessages

  // Initialize with welcome message only if no session messages exist
  useEffect(() => {
    if (sessionMessages.length === 0 && statusMessages.length === 0) {
      addStatusMessage('Welcome to Ariadne - Your thread through content', 'info')
      addStatusMessage('Ready to process your podcast content', 'status')
    }
  }, [sessionMessages.length, statusMessages.length])

  // Add a new status message
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
      setStatusMessages(prev => [...prev, newMessage])
    }
  }, [onAddMessage])

  // Scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [displayMessages])

  // Get available slash commands
  const getSlashCommands = (): SlashCommand[] => {
    return [
      { id: 'select', command: '/select file', description: 'Choose a file to upload' },
      { id: 'browse', command: '/browse', description: 'Open file browser' },
      { id: 'help', command: '/help', description: 'Show available commands' },
      { id: 'clear', command: '/clear', description: 'Clear status messages' },
    ]
  }

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setCommandInput(value)

    if (value.startsWith('/')) {
      const searchTerm = value.slice(1).toLowerCase()
      const allCommands = getSlashCommands()
      
      const filtered = allCommands.filter(cmd => 
        cmd.command.toLowerCase().includes(value.toLowerCase())
      )
      
      setFilteredSlashCommands(filtered)
      setSelectedCommandIndex(0)

      // Auto-complete for single unambiguous match
      if (searchTerm.length > 1) {
        const exactMatches = filtered.filter(cmd => 
          cmd.command.toLowerCase().startsWith(value.toLowerCase())
        )
        
        if (exactMatches.length === 1) {
          const match = exactMatches[0]
          const completion = match.command
          
          if (completion.length > value.length && inputRef.current) {
            setTimeout(() => {
              if (inputRef.current && inputRef.current.value === value) {
                inputRef.current.value = completion
                inputRef.current.setSelectionRange(value.length, completion.length)
                setCommandInput(completion)
              }
            }, 100)
          }
        }
      }
    } else {
      setFilteredSlashCommands([])
    }
  }

  // Handle key navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Handle backspace to clear selection
    if (e.key === 'Backspace' && inputRef.current) {
      const input = inputRef.current
      if (input.selectionStart !== input.selectionEnd) {
        input.setSelectionRange(input.selectionStart, input.selectionStart)
      }
    }

    // Handle slash command navigation
    if (commandInput.startsWith('/') && filteredSlashCommands.length > 0) {
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
        if (selectedCommand) {
          setCommandInput(selectedCommand.command)
        }
        return
      }
    }

    // Handle command execution
    if (e.key === 'Enter' && commandInput.trim()) {
      e.preventDefault()
      executeCommand(commandInput)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      exitCommandMode()
    }
  }

  // Execute a command
  const executeCommand = (command: string) => {
    const commandText = command.startsWith('/') ? command.slice(1) : command
    
    // Add command to status messages
    addStatusMessage(`> ${command}`, 'info')
    
    // Handle built-in commands
    if (commandText === 'clear') {
      if (onAddMessage) {
        // If using session messages, we can't clear them here - just notify
        addStatusMessage('Session history maintained across screens', 'info')
      } else {
        setStatusMessages([])
        addStatusMessage('Status messages cleared', 'success')
      }
    } else if (commandText === 'help') {
      addStatusMessage('Available commands: /select file, /browse, /clear, /help', 'info')
    } else if (commandText.startsWith('select file') || commandText === 'browse') {
      addStatusMessage('Opening file browser...', 'status', IoCloudUpload)
      if (onFileSelect) {
        onFileSelect()
      }
    } else {
      // Pass other commands to parent
      if (onCommand) {
        onCommand(commandText)
      }
    }
    
    // Clear input and exit command mode
    setCommandInput('')
    setFilteredSlashCommands([])
    exitCommandMode()
  }

  // Enter command mode with smooth transition
  const enterCommandMode = () => {
    if (isTransitioning) return
    
    setIsTransitioning(true)
    setIsCommandMode(true)
    
    // Focus input after transition completes
    setTimeout(() => {
      inputRef.current?.focus()
      setIsTransitioning(false)
    }, 350) // Match CSS transition duration
  }

  // Exit command mode with smooth transition
  const exitCommandMode = () => {
    if (isTransitioning) return
    
    setIsTransitioning(true)
    setCommandInput('')
    setFilteredSlashCommands([])
    
    // Complete transition
    setTimeout(() => {
      setIsCommandMode(false)
      setIsTransitioning(false)
    }, 300) // Match CSS transition duration
  }

  // Handle global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Only handle if not already in an input (except for our component)
      const isInputFocused = document.activeElement instanceof HTMLInputElement || 
                            document.activeElement instanceof HTMLTextAreaElement
      const isOurInput = document.activeElement === inputRef.current

      // Cmd/Ctrl + K to toggle command mode (universal shortcut)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (isCommandMode) {
          exitCommandMode()
        } else {
          enterCommandMode()
        }
        return
      }

      // Forward slash to enter command mode (when not focused in other inputs)
      if (e.key === '/' && !isCommandMode && !isInputFocused) {
        e.preventDefault()
        enterCommandMode()
        return
      }

      // Escape to exit command mode
      if (e.key === 'Escape') {
        if (isCommandMode) {
          e.preventDefault()
          exitCommandMode()
        }
        return
      }

      // Space to enter command mode (when not in inputs)
      if (e.key === ' ' && !isCommandMode && !isInputFocused && !isOurInput) {
        e.preventDefault()
        enterCommandMode()
        return
      }

      // Tab to cycle between states (when in command mode but no slash commands visible)
      if (e.key === 'Tab' && isCommandMode && !commandInput.startsWith('/') && filteredSlashCommands.length === 0) {
        e.preventDefault()
        exitCommandMode()
        return
      }
    }

    document.addEventListener('keydown', handleGlobalKeyDown)
    return () => document.removeEventListener('keydown', handleGlobalKeyDown)
  }, [isCommandMode, commandInput, filteredSlashCommands.length])

  // Add processing lifecycle messages to session history
  useEffect(() => {
    if (isProcessing) {
      addStatusMessage('File uploaded successfully', 'success', IoCheckmarkCircle)
      
      setTimeout(() => {
        addStatusMessage('Starting transcription...', 'status', IoFlash)
      }, 1000)
      
      setTimeout(() => {
        addStatusMessage('Analyzing content for clips...', 'status', IoCreate)
      }, 3000)
      
      setTimeout(() => {
        addStatusMessage('Processing audio segments...', 'status', IoFlash)
      }, 5000)
    }
  }, [isProcessing, addStatusMessage])

  return (
    <div className="command-display-container">
      {/* Slash Command Dropdown */}
      {isCommandMode && commandInput.startsWith('/') && filteredSlashCommands.length > 0 && (
        <div className="command-dropdown">
          <div className="command-dropdown-header">
            <span className="dropdown-title">Available Commands</span>
            <span className="dropdown-hint">↑↓ navigate • Tab complete • Enter execute</span>
          </div>
          <div className="command-list">
            {filteredSlashCommands.map((command, index) => (
              <button
                key={command.id}
                className={`dropdown-command ${index === selectedCommandIndex ? 'selected' : ''}`}
                onMouseDown={() => {
                  setCommandInput(command.command)
                  inputRef.current?.focus()
                }}
                onMouseEnter={() => setSelectedCommandIndex(index)}
              >
                <span className="command-text">{command.command}</span>
                <span className="command-desc">{command.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Main Display Box */}
      <div className={`command-display-box ${isCommandMode ? 'command-mode' : 'status-mode'} ${isTransitioning ? 'transitioning' : ''}`}>
        {isCommandMode ? (
          /* Command State */
          <div className="command-state">
            <input
              ref={inputRef}
              type="text"
              value={commandInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type a command or '/' for command list..."
              className="command-input-field"
              autoComplete="off"
            />
          </div>
        ) : (
          /* Status State */
          <div className="status-state">
            <div className="status-messages">
              {displayMessages.map((msg) => (
                <div key={msg.id} className={`status-message ${msg.type}`}>
                  {msg.icon && (
                    <msg.icon className="status-icon" size={16} />
                  )}
                  <span className="status-text">{msg.message}</span>
                  <span className="status-time">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
            
            {/* Status Mode Prompt with Keyboard Shortcuts */}
            <div className="status-prompt" onClick={enterCommandMode}>
              <span className="prompt-text">
                Press <kbd>/</kbd> or <kbd>⌘K</kbd> for commands, <kbd>Space</kbd> to type...
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}