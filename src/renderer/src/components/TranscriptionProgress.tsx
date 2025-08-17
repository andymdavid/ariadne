import { useEffect, useState } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { AudioWaveform } from './AudioWaveform'
import { ProcessingIcon, MicrophoneIcon, BrainIcon } from './ProcessingIcon'

const thinkingMessages = {
  transcribing: [
    'listening carefully...',
    'processing audio waves...',
    'understanding speech patterns...',
    'decoding audio signals...',
    'capturing every word...',
    'analyzing vocal patterns...',
    'interpreting language nuances...',
    'parsing acoustic features...',
    'recognizing speech patterns...',
    'converting sound to text...',
    'processing phonemes...',
    'analyzing frequency bands...',
    'detecting speaker changes...',
    'understanding prosody...',
    'mapping audio segments...',
    'filtering background noise...'
  ],
  extracting: [
    'extracting audio data...',
    'optimizing audio format...',
    'processing media file...',
    'preparing audio stream...',
    'analyzing file structure...',
    'converting audio channels...'
  ],
  analyzing: [
    'analyzing content structure...',
    'identifying key moments...',
    'detecting emotional peaks...',
    'finding compelling segments...',
    'measuring engagement levels...',
    'evaluating content quality...'
  ],
  generating: [
    'crafting descriptions...',
    'generating titles...',
    'optimizing for engagement...',
    'creating content packages...',
    'polishing final output...',
    'preparing deliverables...'
  ]
}

const stageEmojis = {
  uploading: '📤',
  extracting: '🎵',
  transcribing: '🧠',
  analyzing: '🔍',
  generating: '✨',
  completed: '✅'
}

const stageLabels = {
  uploading: 'Uploading',
  extracting: 'Extracting Audio',
  transcribing: 'Transcribing',
  analyzing: 'Analyzing Content',
  generating: 'Generating Clips',
  completed: 'Complete'
}

export function TranscriptionProgress() {
  const { stage, progress, message, timeRemaining, thinkingMessage, recentTranscriptLines } = useProcessingStore()
  const [currentThinkingMessage, setCurrentThinkingMessage] = useState('')
  const [messageIndex, setMessageIndex] = useState(0)
  const [displayedLines, setDisplayedLines] = useState<string[]>([])
  const [typewriterText, setTypewriterText] = useState('')
  const [isMessageFading, setIsMessageFading] = useState(false)
  const [stageTransition, setStageTransition] = useState(false)

  // Cycle through thinking messages with smooth transitions
  useEffect(() => {
    const stageMessages = thinkingMessages[stage as keyof typeof thinkingMessages] || []
    if (stageMessages.length === 0) return

    // Set initial message
    if (!currentThinkingMessage) {
      setCurrentThinkingMessage(stageMessages[0])
    }

    const interval = setInterval(() => {
      // Start fade out
      setIsMessageFading(true)
      
      setTimeout(() => {
        // Change message after fade out
        setMessageIndex((prev) => (prev + 1) % stageMessages.length)
        setCurrentThinkingMessage(stageMessages[(messageIndex + 1) % stageMessages.length])
        
        // Fade back in
        setIsMessageFading(false)
      }, 300) // Fade duration
      
    }, 2500) // Change message every 2.5 seconds
    
    return () => clearInterval(interval)
  }, [stage, messageIndex, currentThinkingMessage])

  // Handle stage transitions with animation
  useEffect(() => {
    setStageTransition(true)
    
    const timer = setTimeout(() => {
      setStageTransition(false)
    }, 500)
    
    const stageMessages = thinkingMessages[stage as keyof typeof thinkingMessages] || []
    if (stageMessages.length > 0) {
      setCurrentThinkingMessage(stageMessages[0])
      setMessageIndex(0)
      setIsMessageFading(false)
    }
    
    return () => clearTimeout(timer)
  }, [stage])

  // Handle new transcript lines with typewriter effect
  useEffect(() => {
    if (recentTranscriptLines && recentTranscriptLines.length > 0) {
      const newLine = recentTranscriptLines[recentTranscriptLines.length - 1]
      
      // Only animate if it's a genuinely new line
      if (!displayedLines.includes(newLine)) {
        setDisplayedLines(prev => {
          const updated = [...prev, newLine].slice(-2) // Keep only last 2 lines
          return updated
        })
        
        // Start typewriter effect for the new line
        setTypewriterText('')
        let i = 0
        const typeInterval = setInterval(() => {
          if (i < newLine.length) {
            setTypewriterText(newLine.substring(0, i + 1))
            i++
          } else {
            clearInterval(typeInterval)
          }
        }, 30) // 30ms per character for smooth typing
        
        return () => clearInterval(typeInterval)
      }
    }
  }, [recentTranscriptLines])

  // Reset transcript display when stage changes
  useEffect(() => {
    if (stage !== 'transcribing') {
      setDisplayedLines([])
      setTypewriterText('')
    }
  }, [stage])

  const displayMessage = thinkingMessage || currentThinkingMessage

  const formatTimeRemaining = (seconds?: number) => {
    if (!seconds) return null
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s remaining`
    }
    return `${remainingSeconds}s remaining`
  }

  return (
    <div className={`max-w-2xl w-full space-y-8 text-center transition-all duration-500 ${
      stageTransition ? 'scale-95 opacity-75' : 'scale-100 opacity-100'
    }`}>
      {/* Enhanced Animated Icon */}
      <ProcessingIcon stage={stage}>
        {stage === 'extracting' && <MicrophoneIcon isPulsing className="text-accent-primary" />}
        {stage === 'transcribing' && <BrainIcon isThinking className="text-accent-primary" />}
        {stage === 'analyzing' && <span className="text-accent-primary">🔍</span>}
        {stage === 'generating' && <span className="text-accent-primary">✨</span>}
        {stage === 'uploading' && <span>{stageEmojis[stage]}</span>}
        {stage === 'completed' && (
          <div className="relative">
            <span className="text-6xl animate-bounce">✅</span>
            {/* Celebration particles */}
            <div className="absolute inset-0 pointer-events-none">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 bg-green-400 rounded-full animate-ping"
                  style={{
                    left: `${30 + Math.cos(i * Math.PI / 6) * 60}%`,
                    top: `${30 + Math.sin(i * Math.PI / 6) * 60}%`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: '1s'
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </ProcessingIcon>

      {/* Stage and Main Message */}
      <div className="space-y-4">
        <h2 className="text-3xl font-bold text-text-primary">
          {stageLabels[stage]}
        </h2>
        
        <p className="text-xl text-text-secondary">
          {message}
        </p>

        {/* Thinking Message (for active processing stages) */}
        {(stage === 'extracting' || stage === 'transcribing' || stage === 'analyzing' || stage === 'generating') && (
          <div className="flex items-center justify-center space-x-2 text-text-muted">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-accent-primary rounded-full animate-bounce" />
              <div className="w-2 h-2 bg-accent-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
              <div className="w-2 h-2 bg-accent-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
            </div>
            <span 
              className={`font-medium italic transition-opacity duration-300 ${
                isMessageFading ? 'opacity-0' : 'opacity-100'
              }`}
            >
              {thinkingMessage || currentThinkingMessage}
            </span>
          </div>
        )}
      </div>

      {/* Progress Bar */}
      <div className="space-y-3">
        <div className="w-full bg-bg-tertiary rounded-full h-3 shadow-inner">
          <div 
            className="bg-gradient-to-r from-accent-primary to-accent-secondary h-3 rounded-full transition-all duration-500 ease-out shadow-sm"
            style={{ width: `${Math.max(progress, 1)}%` }}
          />
        </div>
        
        <div className="flex justify-between items-center text-sm text-text-muted">
          <span>{Math.round(progress)}% complete</span>
          {timeRemaining && (
            <span>{formatTimeRemaining(timeRemaining)}</span>
          )}
        </div>
      </div>

      {/* Real-time Transcript Preview (during transcription) */}
      {stage === 'transcribing' && (displayedLines.length > 0 || typewriterText) && (
        <div className="bg-bg-tertiary/50 border border-border-default rounded-lg p-6 max-w-2xl mx-auto">
          <div className="flex items-center space-x-2 mb-3">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-text-muted">Live Transcription</span>
          </div>
          
          <div className="space-y-2 font-mono text-sm">
            {/* Previous completed lines */}
            {displayedLines.slice(0, -1).map((line, index) => (
              <div key={index} className="text-text-secondary opacity-75 transition-opacity duration-500">
                "{line}"
              </div>
            ))}
            
            {/* Current typing line */}
            {typewriterText && (
              <div className="text-text-primary">
                "{typewriterText}"
                <span className="animate-pulse">|</span>
              </div>
            )}
            
            {/* Fallback for completed current line */}
            {!typewriterText && displayedLines.length > 0 && (
              <div className="text-text-primary">
                "{displayedLines[displayedLines.length - 1]}"
              </div>
            )}
          </div>
        </div>
      )}

      {/* Enhanced Audio Wave Visualization */}
      {(stage === 'extracting' || stage === 'transcribing') && (
        <AudioWaveform 
          isActive={stage === 'transcribing'} 
          barCount={stage === 'transcribing' ? 40 : 20}
          className="transition-all duration-1000"
        />
      )}

      {/* Stage Progress Indicators */}
      <div className="flex justify-center space-x-4">
        {Object.keys(stageLabels).map((stageKey) => {
          const isActive = stageKey === stage
          const isCompleted = Object.keys(stageLabels).indexOf(stageKey) < Object.keys(stageLabels).indexOf(stage)
          
          return (
            <div key={stageKey} className="flex flex-col items-center space-y-1">
              <div className={`
                w-3 h-3 rounded-full transition-all duration-300
                ${isActive 
                  ? 'bg-accent-primary scale-125 animate-pulse' 
                  : isCompleted 
                    ? 'bg-accent-primary' 
                    : 'bg-bg-tertiary'
                }
              `} />
              <span className={`
                text-xs transition-colors duration-300
                ${isActive ? 'text-accent-primary font-medium' : 'text-text-muted'}
              `}>
                {stageLabels[stageKey as keyof typeof stageLabels]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}