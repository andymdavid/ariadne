import { useEffect, useState } from 'react'

interface AudioWaveformProps {
  isActive?: boolean
  barCount?: number
  className?: string
}

export function AudioWaveform({ 
  isActive = true, 
  barCount = 32, 
  className = "" 
}: AudioWaveformProps) {
  const [heights, setHeights] = useState<number[]>([])
  
  useEffect(() => {
    // Initialize with random heights
    setHeights(Array.from({ length: barCount }, () => Math.random() * 60 + 10))
  }, [barCount])

  useEffect(() => {
    if (!isActive) return

    const interval = setInterval(() => {
      setHeights(prev => prev.map((height, index) => {
        // Create wave-like motion across bars
        const wave = Math.sin((Date.now() / 200) + (index * 0.3)) * 20 + 30
        const randomVariation = (Math.random() - 0.5) * 15
        const newHeight = Math.max(8, Math.min(70, wave + randomVariation))
        
        // Smooth transition
        return height + (newHeight - height) * 0.1
      }))
    }, 50) // 20 FPS for smooth animation

    return () => clearInterval(interval)
  }, [isActive])

  return (
    <div className={`flex items-end justify-center space-x-1 h-20 ${className}`}>
      {heights.map((height, index) => (
        <div
          key={index}
          className="bg-gradient-to-t from-accent-primary to-accent-secondary rounded-full transition-all duration-75 ease-out"
          style={{
            width: '3px',
            height: `${height}px`,
            opacity: isActive ? 0.8 : 0.3,
            filter: isActive ? 'blur(0px)' : 'blur(1px)'
          }}
        />
      ))}
    </div>
  )
}

interface FloatingParticlesProps {
  count?: number
  className?: string
}

export function FloatingParticles({ count = 12, className = "" }: FloatingParticlesProps) {
  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="absolute w-1 h-1 bg-accent-primary/30 rounded-full animate-pulse"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${2 + Math.random() * 2}s`
          }}
        />
      ))}
    </div>
  )
}