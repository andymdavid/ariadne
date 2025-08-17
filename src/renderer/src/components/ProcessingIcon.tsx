import { ReactNode } from 'react'

interface ProcessingIconProps {
  stage: 'uploading' | 'extracting' | 'transcribing' | 'analyzing' | 'generating' | 'completed'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
}

export function ProcessingIcon({ stage, size = 'xl', children }: ProcessingIconProps) {
  const sizeClasses = {
    sm: 'text-4xl',
    md: 'text-6xl', 
    lg: 'text-7xl',
    xl: 'text-8xl'
  }

  const ringClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-28 h-28', 
    xl: 'w-32 h-32'
  }

  return (
    <div className="relative flex items-center justify-center">
      {/* Main icon */}
      <div className={`relative z-10 ${sizeClasses[size]} mb-4`}>
        {children}
      </div>
      
      {/* Animated rings for active processing stages */}
      {(stage === 'transcribing' || stage === 'analyzing' || stage === 'generating') && (
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Outer ring */}
          <div 
            className={`${ringClasses[size]} border-2 border-accent-primary/20 rounded-full animate-spin`}
            style={{ animationDuration: '8s', animationDirection: 'reverse' }}
          />
          
          {/* Middle ring */}
          <div 
            className={`absolute ${ringClasses[size]} border-2 border-accent-primary/40 rounded-full animate-spin`}
            style={{ 
              animationDuration: '6s',
              transform: 'scale(0.75)'
            }}
          />
          
          {/* Inner ring */}
          <div 
            className={`absolute ${ringClasses[size]} border-2 border-accent-primary/60 rounded-full animate-spin`}
            style={{ 
              animationDuration: '4s',
              animationDirection: 'reverse',
              transform: 'scale(0.5)'
            }}
          />
        </div>
      )}

      {/* Pulsing rings for transcription */}
      {stage === 'transcribing' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`${ringClasses[size]} border-2 border-accent-primary/30 rounded-full animate-ping`} />
          <div 
            className={`absolute ${ringClasses[size]} border-2 border-accent-primary/50 rounded-full animate-ping`}
            style={{ 
              animationDelay: '0.5s',
              transform: 'scale(0.8)'
            }} 
          />
          <div 
            className={`absolute ${ringClasses[size]} border-2 border-accent-primary/70 rounded-full animate-ping`}
            style={{ 
              animationDelay: '1s',
              transform: 'scale(0.6)'
            }} 
          />
        </div>
      )}

      {/* Floating particles for generating stage */}
      {stage === 'generating' && (
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="absolute w-2 h-2 bg-accent-secondary rounded-full animate-bounce"
              style={{
                left: `${25 + Math.cos(i * Math.PI / 4) * 40}%`,
                top: `${25 + Math.sin(i * Math.PI / 4) * 40}%`,
                animationDelay: `${i * 0.2}s`,
                animationDuration: '2s'
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface MicrophoneIconProps {
  isPulsing?: boolean
  className?: string
}

export function MicrophoneIcon({ isPulsing = false, className = "" }: MicrophoneIconProps) {
  return (
    <div className={`relative ${className}`}>
      <svg 
        width="64" 
        height="64" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`${isPulsing ? 'animate-pulse' : ''} text-accent-primary`}
      >
        <path d="M12 1a4 4 0 0 0-4 4v7a4 4 0 0 0 8 0V5a4 4 0 0 0-4-4z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      
      {/* Sound waves */}
      {isPulsing && (
        <>
          <div className="absolute -right-8 top-1/2 transform -translate-y-1/2">
            <div className="w-4 h-1 bg-accent-primary/60 rounded-full animate-ping" />
          </div>
          <div className="absolute -right-12 top-1/2 transform -translate-y-1/2">
            <div 
              className="w-6 h-1 bg-accent-primary/40 rounded-full animate-ping" 
              style={{ animationDelay: '0.2s' }}
            />
          </div>
          <div className="absolute -right-16 top-1/2 transform -translate-y-1/2">
            <div 
              className="w-8 h-1 bg-accent-primary/20 rounded-full animate-ping" 
              style={{ animationDelay: '0.4s' }}
            />
          </div>
        </>
      )}
    </div>
  )
}

interface BrainIconProps {
  isThinking?: boolean
  className?: string
}

export function BrainIcon({ isThinking = false, className = "" }: BrainIconProps) {
  return (
    <div className={`relative ${className}`}>
      <svg 
        width="64" 
        height="64" 
        viewBox="0 0 24 24" 
        fill="none" 
        stroke="currentColor" 
        strokeWidth="2" 
        strokeLinecap="round" 
        strokeLinejoin="round"
        className={`${isThinking ? 'animate-pulse' : ''} text-accent-primary`}
      >
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"/>
        <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"/>
      </svg>
      
      {/* Thinking particles */}
      {isThinking && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <div className="flex space-x-1">
            <div className="w-1 h-1 bg-accent-primary rounded-full animate-bounce" />
            <div 
              className="w-1 h-1 bg-accent-primary rounded-full animate-bounce" 
              style={{ animationDelay: '0.1s' }}
            />
            <div 
              className="w-1 h-1 bg-accent-primary rounded-full animate-bounce" 
              style={{ animationDelay: '0.2s' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}