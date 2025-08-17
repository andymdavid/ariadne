import { useState, useRef, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export function CommandInterface() {
  const [command, setCommand] = useState('')
  const [isVisible, setIsVisible] = useState(false)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()

  // Get contextual suggestions based on current page
  const getContextualSuggestions = () => {
    const path = location.pathname
    
    if (path === '/') {
      return [
        'Upload a new podcast episode',
        'Open recent project',
        'Open settings',
        'Show help',
      ]
    } else if (path.startsWith('/review/')) {
      return [
        'Find clips about "topic" under 60 seconds',
        'Show me funny moments',
        'Approve all clips',
        'Create titles for approved clips',
      ]
    } else if (path.startsWith('/export/')) {
      return [
        'Export all clips as Instagram Stories',
        'Export selected clips as YouTube Shorts',
        'Show export settings',
      ]
    }
    
    return [
      'Open settings',
      'Go to home',
      'Type a command...'
    ]
  }

  // Toggle command interface with Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsVisible(true)
        setTimeout(() => inputRef.current?.focus(), 100)
      } else if (e.key === 'Escape') {
        setIsVisible(false)
        setCommand('')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Update suggestions when location changes
  useEffect(() => {
    setSuggestions(getContextualSuggestions())
  }, [location.pathname])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!command.trim()) return

    processCommand(command.trim().toLowerCase())
    
    // Close interface
    setIsVisible(false)
    setCommand('')
  }
  
  const processCommand = (cmd: string) => {
    // Navigation commands
    if (cmd.includes('settings') || cmd === 'open settings') {
      navigate('/settings')
    } else if (cmd.includes('home') || cmd === 'go to home') {
      navigate('/')
    } else if (cmd.includes('upload')) {
      navigate('/')
      // Focus on upload area
    } else {
      console.log('Unknown command:', cmd)
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    setCommand(suggestion)
    inputRef.current?.focus()
  }

  if (!isVisible) {
    return (
      <div className="h-12 bg-bg-secondary border-t border-border-default flex items-center justify-center">
        <button
          onClick={() => setIsVisible(true)}
          className="text-sm text-text-muted hover:text-text-secondary transition-colors"
        >
          Press <kbd className="px-2 py-1 bg-bg-tertiary rounded text-xs">⌘K</kbd> for commands
        </button>
      </div>
    )
  }

  return (
    <div className="bg-bg-secondary border-t border-border-default">
      {/* Suggestions */}
      {suggestions.length > 0 && command === '' && (
        <div className="px-4 py-2 border-b border-border-default">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion)}
                className="px-3 py-1 text-sm bg-bg-tertiary hover:bg-hover-bg text-text-secondary hover:text-text-primary rounded-md transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Command input */}
      <form onSubmit={handleSubmit} className="p-4">
        <div className="flex items-center space-x-3">
          <div className="text-accent-primary">{'>'}</div>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Type command or search..."
            className="flex-1 bg-transparent text-text-primary placeholder-text-muted outline-none text-sm"
          />
          <button
            type="button"
            onClick={() => setIsVisible(false)}
            className="text-text-muted hover:text-text-secondary text-sm"
          >
            ESC
          </button>
        </div>
      </form>
    </div>
  )
}