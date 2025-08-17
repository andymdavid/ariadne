import { useState, useRef, useEffect } from 'react'

interface Command {
  id: string
  label: string
  description: string
  icon: string
  category: string
}

interface CommandBarProps {
  onCommand: (command: string) => void
  currentScreen?: string
  isProcessing?: boolean
}

export function CommandBar({ onCommand, currentScreen = 'review', isProcessing = false }: CommandBarProps) {
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [showSlashCommands, setShowSlashCommands] = useState(false)
  const [filteredCommands, setFilteredCommands] = useState<Command[]>([])
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Context-aware placeholder text
  const getPlaceholder = () => {
    if (isProcessing) return 'Processing...'
    if (input.length > 0) return ''
    
    switch (currentScreen) {
      case 'upload':
        return 'Select file, drag and drop, process episode...'
      case 'processing':
        return 'View progress, cancel processing...'
      case 'review':
        return 'Find clips, approve all, reject low scores...'
      case 'content':
        return 'Create titles, write descriptions, select thumbnails...'
      case 'export':
        return 'Export all, export as instagram, save project...'
      default:
        return 'Find clips, create content, export reels...'
    }
  }

  // Slash commands by screen
  const getSlashCommands = (): Command[] => {
    const commonCommands: Command[] = [
      { id: 'help', label: '/help', description: 'Show available commands', icon: '❓', category: 'General' },
      { id: 'home', label: '/home', description: 'Go to upload screen', icon: '🏠', category: 'Navigation' },
      { id: 'settings', label: '/settings', description: 'Open settings', icon: '⚙️', category: 'Navigation' },
    ]

    const screenCommands: { [key: string]: Command[] } = {
      upload: [
        { id: 'select', label: '/select file', description: 'Choose a file to upload', icon: '📁', category: 'Upload' },
        { id: 'browse', label: '/browse', description: 'Open file browser', icon: '🔍', category: 'Upload' },
      ],
      processing: [
        { id: 'status', label: '/status', description: 'View processing progress', icon: '📊', category: 'Processing' },
        { id: 'cancel', label: '/cancel', description: 'Cancel processing', icon: '⏹️', category: 'Processing' },
      ],
      review: [
        { id: 'find', label: '/find clips about', description: 'Search clips by topic', icon: '🔍', category: 'Search' },
        { id: 'show', label: '/show me', description: 'Filter clips by emotion', icon: '🎭', category: 'Search' },
        { id: 'duration', label: '/clips under', description: 'Filter by duration', icon: '⏱️', category: 'Filter' },
        { id: 'approve', label: '/approve all', description: 'Approve high-scoring clips', icon: '✅', category: 'Actions' },
        { id: 'reject', label: '/reject low scores', description: 'Reject low-scoring clips', icon: '❌', category: 'Actions' },
        { id: 'next', label: '/next', description: 'Go to export screen', icon: '➡️', category: 'Navigation' },
      ],
      content: [
        { id: 'titles', label: '/create titles', description: 'Generate titles for clips', icon: '📝', category: 'Content' },
        { id: 'descriptions', label: '/write descriptions', description: 'Generate descriptions', icon: '📄', category: 'Content' },
        { id: 'thumbnails', label: '/select thumbnails', description: 'Choose thumbnails', icon: '🖼️', category: 'Content' },
        { id: 'next', label: '/next', description: 'Go to export screen', icon: '➡️', category: 'Navigation' },
      ],
      export: [
        { id: 'instagram', label: '/export as instagram', description: 'Export for Instagram Stories', icon: '📱', category: 'Export' },
        { id: 'youtube', label: '/export as youtube', description: 'Export for YouTube Shorts', icon: '📺', category: 'Export' },
        { id: 'tiktok', label: '/export as tiktok', description: 'Export for TikTok', icon: '🎵', category: 'Export' },
        { id: 'all', label: '/export all', description: 'Export all approved clips', icon: '📦', category: 'Export' },
        { id: 'save', label: '/save project', description: 'Save current project', icon: '💾', category: 'Project' },
      ]
    }

    const currentCommands = screenCommands[currentScreen] || []
    return [...currentCommands, ...commonCommands]
  }

  // Context-aware suggestions
  const getSuggestions = (input: string) => {
    const baseCommands = {
      upload: ['select file', 'drag and drop', 'browse'],
      processing: ['view progress', 'cancel processing'],
      review: [
        'find clips about AI',
        'show me controversial moments', 
        'clips under 30 seconds',
        'approve all high scores',
        'reject low scores',
        'next'
      ],
      content: ['create titles', 'write descriptions', 'select thumbnails', 'next'],
      export: ['export all', 'export as instagram', 'export as youtube', 'save project']
    }

    const currentCommands = baseCommands[currentScreen as keyof typeof baseCommands] || baseCommands.review
    
    if (!input) return currentCommands.slice(0, 3)
    
    return currentCommands.filter(cmd => 
      cmd.toLowerCase().includes(input.toLowerCase())
    ).slice(0, 3)
  }

  // Handle input changes
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInput(value)
    setIsTyping(true)
    
    // Check if it's a slash command
    if (value.startsWith('/')) {
      setShowSlashCommands(true)
      const searchTerm = value.slice(1).toLowerCase()
      const commands = getSlashCommands()
      const filtered = commands.filter(cmd => 
        cmd.label.toLowerCase().includes(searchTerm) ||
        cmd.description.toLowerCase().includes(searchTerm)
      )
      setFilteredCommands(filtered)
      setSelectedCommandIndex(0)
      setSuggestions([])
    } else {
      setShowSlashCommands(false)
      setSuggestions(getSuggestions(value))
    }
    
    // Clear typing indicator after delay
    setTimeout(() => setIsTyping(false), 1000)
  }

  // Handle command submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    if (showSlashCommands && filteredCommands.length > 0) {
      // Execute selected slash command
      const selectedCommand = filteredCommands[selectedCommandIndex]
      const commandText = selectedCommand.label.slice(1) // Remove leading slash
      onCommand(commandText)
      setInput('')
      setShowSlashCommands(false)
      setFilteredCommands([])
    } else if (input.trim() && !isProcessing) {
      // Execute regular command
      const commandText = input.startsWith('/') ? input.slice(1) : input
      onCommand(commandText.trim())
      setInput('')
      setSuggestions([])
    }
  }

  // Handle suggestion click
  const handleSuggestionClick = (suggestion: string) => {
    setInput(suggestion)
    inputRef.current?.focus()
  }

  // Handle slash command click
  const handleCommandClick = (command: Command) => {
    setInput(command.label)
    inputRef.current?.focus()
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showSlashCommands && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedCommandIndex(prev => 
          prev < filteredCommands.length - 1 ? prev + 1 : 0
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedCommandIndex(prev => 
          prev > 0 ? prev - 1 : filteredCommands.length - 1
        )
      } else if (e.key === 'Tab') {
        e.preventDefault()
        const selectedCommand = filteredCommands[selectedCommandIndex]
        setInput(selectedCommand.label)
      }
    }
  }

  // Focus management
  const handleFocus = () => {
    setIsFocused(true)
    if (input.startsWith('/')) {
      setShowSlashCommands(true)
      const searchTerm = input.slice(1).toLowerCase()
      const commands = getSlashCommands()
      const filtered = commands.filter(cmd => 
        cmd.label.toLowerCase().includes(searchTerm) ||
        cmd.description.toLowerCase().includes(searchTerm)
      )
      setFilteredCommands(filtered)
    } else {
      setSuggestions(getSuggestions(input))
    }
  }

  const handleBlur = () => {
    // Delay to allow suggestion/command clicks
    setTimeout(() => {
      setIsFocused(false)
      setSuggestions([])
      setShowSlashCommands(false)
      setFilteredCommands([])
    }, 150)
  }

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus command bar
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      
      // Escape to blur command bar
      if (e.key === 'Escape') {
        inputRef.current?.blur()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      {/* Slash Command Palette */}
      {showSlashCommands && filteredCommands.length > 0 && isFocused && (
        <div className="slash-command-palette">
          <div className="command-palette-header">
            <span className="command-palette-title">Commands</span>
            <span className="command-palette-hint">↑↓ navigate • tab complete • enter execute</span>
          </div>
          
          {/* Group commands by category */}
          {Object.entries(
            filteredCommands.reduce((groups, cmd) => {
              const category = cmd.category
              if (!groups[category]) groups[category] = []
              groups[category].push(cmd)
              return groups
            }, {} as { [key: string]: Command[] })
          ).map(([category, commands]) => (
            <div key={category} className="command-category">
              <div className="command-category-header">{category}</div>
              {commands.map((command, index) => {
                const globalIndex = filteredCommands.indexOf(command)
                return (
                  <button
                    key={command.id}
                    className={`slash-command ${globalIndex === selectedCommandIndex ? 'selected' : ''}`}
                    onMouseDown={() => handleCommandClick(command)}
                    onMouseEnter={() => setSelectedCommandIndex(globalIndex)}
                  >
                    <span className="command-icon">{command.icon}</span>
                    <div className="command-content">
                      <span className="command-label">{command.label}</span>
                      <span className="command-description">{command.description}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {/* Regular Suggestions Dropdown */}
      {suggestions.length > 0 && isFocused && !showSlashCommands && (
        <div className="command-suggestions">
          {suggestions.map((suggestion, index) => (
            <button
              key={index}
              className="command-suggestion"
              onMouseDown={() => handleSuggestionClick(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {/* Main Command Bar */}
      <div className={`command-bar ${isFocused ? 'focused' : ''} ${isProcessing ? 'processing' : ''}`}>
        <form onSubmit={handleSubmit} className="command-form">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            disabled={isProcessing}
            className={`command-input ${isTyping ? 'typing' : ''}`}
            autoComplete="off"
            spellCheck={false}
          />
          
          <button
            type="submit"
            disabled={!input.trim() || isProcessing}
            className="nav-button"
            title="Execute command (Enter)"
          >
            {isProcessing ? (
              <div className="processing-spinner" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8.22 2.97a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.44 8.5H3.75a.75.75 0 0 1 0-1.5h7.69L8.22 4.03a.75.75 0 0 1 0-1.06Z"/>
              </svg>
            )}
          </button>
        </form>
      </div>
    </>
  )
}