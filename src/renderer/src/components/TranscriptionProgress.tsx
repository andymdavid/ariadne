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
  const { stage, progress, stageProgress, message, timeRemaining, recentTranscriptLines } = useProcessingStore()
  
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

  const resolvedStageProgress = Math.max(0, Math.min(100, stageProgress ?? progress))
  const normalizedMessage = message?.toLowerCase() || ''
  const isQueued = normalizedMessage.includes('queued')
  const isRecovered = normalizedMessage.includes('resum') || normalizedMessage.includes('pending_resume')

  const showDualProgress = stage === 'transcribing' || stage === 'analyzing' || stage === 'generating'

  const getOverallLabel = () => `${Math.round(progress)}% overall`

  const getStageLabel = () => {
    switch (stage) {
      case 'transcribing':
        return `${Math.round(resolvedStageProgress)}% of transcription`
      case 'analyzing':
        return `${Math.round(resolvedStageProgress)}% of analysis`
      case 'generating':
        return `${Math.round(resolvedStageProgress)}% of generation`
      default:
        return `${Math.round(progress)}% complete`
    }
  }

  const getInlineStatus = () => {
    const parts: string[] = []

    if (isQueued) {
      parts.push('Queued')
    } else if (isRecovered) {
      parts.push('Resuming')
    }

    if (showDualProgress) {
      parts.push(getStageLabel())
      parts.push(getOverallLabel())
    } else {
      parts.push(getStageLabel())
    }

    const eta = formatTimeRemaining(timeRemaining)
    if (eta) {
      parts.push(`ETA ${eta.replace(' remaining', '')}`)
    }

    return parts.join(' • ')
  }

  const getStageTitle = () => {
    if (isQueued) {
      return 'Queued'
    }

    if (isRecovered) {
      return `Resuming ${stageLabels[stage]}`
    }

    return stageLabels[stage]
  }

  const statusMessage = message
    || (isQueued ? 'Waiting for processing to start...' : null)
    || (isRecovered ? 'Restoring durable processing state...' : null)

  const statusRows = (() => {
    const rows: Array<{ label: string; tone?: 'active' | 'done' }> = []

    if (stage === 'uploading' || stage === 'extracting' || stage === 'transcribing' || stage === 'analyzing' || stage === 'generating') {
      rows.push({ label: 'Preparing source media', tone: stage === 'uploading' ? 'active' : 'done' })
    }

    if (stage === 'extracting' || stage === 'transcribing' || stage === 'analyzing' || stage === 'generating' || stage === 'completed') {
      rows.push({ label: 'Audio extraction complete', tone: stage === 'extracting' ? 'active' : 'done' })
    }

    if (stage === 'transcribing' || stage === 'analyzing' || stage === 'generating' || stage === 'completed') {
      rows.push({ label: statusMessage || 'Transcribing audio', tone: stage === 'transcribing' ? 'active' : 'done' })
    }

    if (stage === 'analyzing' || stage === 'generating' || stage === 'completed') {
      rows.push({ label: 'Ranking clip candidates', tone: stage === 'analyzing' ? 'active' : 'done' })
    }

    if (stage === 'generating' || stage === 'completed') {
      rows.push({ label: 'Generating content package', tone: stage === 'generating' ? 'active' : 'done' })
    }

    if (stage === 'completed') {
      rows.push({ label: 'Ready for review', tone: 'done' })
    }

    return rows
  })()

  return (
    <div className="app-page-content-shell flex w-full flex-col gap-6 pt-20 pb-10">
      <section className="app-section-shell processing-shell">
        <div className="processing-shell-header">
          <div className="processing-shell-title-row">
            <span className="processing-shell-emoji">{stageEmojis[stage]}</span>
            <h2 className="processing-shell-title">{getStageTitle()}</h2>
          </div>

          {statusMessage ? (
            <p className="processing-shell-copy">
              {statusMessage}
            </p>
          ) : null}

          <div className="processing-shell-inline-status">{getInlineStatus()}</div>
        </div>

        <div className="processing-progress-stack">
          {showDualProgress ? (
            <div className="processing-progress-block">
              <div className="processing-progress-labels">
                <span>Current stage</span>
                <span>{getStageLabel()}</span>
              </div>
              <div className="processing-progress-track processing-progress-track-sm">
                <div
                  className="processing-progress-fill"
                  style={{ width: `${Math.max(resolvedStageProgress, 1)}%` }}
                />
              </div>
            </div>
          ) : null}

          <div className="processing-progress-block">
            <div className="processing-progress-labels">
              <span>Overall progress</span>
              <span>{getOverallLabel()}</span>
            </div>
            <div className="processing-progress-track">
              <div
                className="processing-progress-fill"
                style={{ width: `${Math.max(progress, 1)}%` }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="app-section-shell processing-status-shell">
        <div className="app-section-header !mb-4">
          <div>
            <h2 className="app-section-title !mt-0">Session status</h2>
          </div>
          {timeRemaining ? (
            <div className="app-chip">{formatTimeRemaining(timeRemaining)}</div>
          ) : null}
        </div>

        <div className="processing-status-list">
          {statusRows.map((row, index) => (
            <div key={`${row.label}-${index}`} className="processing-status-row">
              <div className="processing-status-row-main">
                <span className={`processing-status-dot ${row.tone === 'done' ? 'is-done' : row.tone === 'active' ? 'is-active' : ''}`} />
                <span>{row.label}</span>
              </div>
            </div>
          ))}

          {(recentTranscriptLines || []).slice(-4).map((line, index) => (
            <div key={`transcript-${index}`} className="processing-status-row">
              <div className="processing-status-row-main">
                <span className="processing-status-dot is-active" />
                <span className="truncate">{line}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
