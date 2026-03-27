import { useEffect, useState } from 'react'
import { useProcessingStore } from '../stores/processingStore'

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
  const { stage, progress, message, timeRemaining } = useProcessingStore()
  
  const [currentThinkingMessage, setCurrentThinkingMessage] = useState('')
  const [messageIndex, setMessageIndex] = useState(0)

  // Cycle through thinking messages with smooth transitions
  useEffect(() => {
    const stageMessages = thinkingMessages[stage as keyof typeof thinkingMessages] || []
    if (stageMessages.length === 0) return

    // Set initial message
    if (!currentThinkingMessage) {
      setCurrentThinkingMessage(stageMessages[0])
    }

    const interval = setInterval(() => {
      setTimeout(() => {
        // Change message after fade out
        setMessageIndex((prev) => (prev + 1) % stageMessages.length)
        setCurrentThinkingMessage(stageMessages[(messageIndex + 1) % stageMessages.length])
      }, 300) // Fade duration
      
    }, 2500) // Change message every 2.5 seconds
    
    return () => clearInterval(interval)
  }, [stage, messageIndex, currentThinkingMessage])

  // Handle stage transitions with animation
  useEffect(() => {
    const stageMessages = thinkingMessages[stage as keyof typeof thinkingMessages] || []
    if (stageMessages.length > 0) {
      setCurrentThinkingMessage(stageMessages[0])
      setMessageIndex(0)
    }
  }, [stage])


  const formatTimeRemaining = (seconds?: number) => {
    if (!seconds) return null
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s remaining`
    }
    return `${remainingSeconds}s remaining`
  }

  const getProgressLabel = () => {
    if (stage === 'transcribing' || stage === 'analyzing' || stage === 'generating') {
      return `${Math.round(progress)}% overall`
    }
    return `${Math.round(progress)}% complete`
  }

  return (
    <div className="max-w-2xl w-full space-y-6 text-center">
      {/* Clean Minimal Header */}
      <div className="space-y-2">
        <div className="flex items-center justify-center space-x-3">
          <span className="text-2xl">{stageEmojis[stage]}</span>
          <h2 className="text-lg font-medium text-text-primary">
            {stageLabels[stage]}
          </h2>
        </div>
        
        {message && (
          <p className="text-sm text-text-secondary">
            {message}
          </p>
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
          <span>{getProgressLabel()}</span>
          {timeRemaining && (
            <span>{formatTimeRemaining(timeRemaining)}</span>
          )}
        </div>
      </div>


    </div>
  )
}
