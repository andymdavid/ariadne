import { useEffect, useRef, useState } from 'react'

interface ClipPlayerProps {
  clipPath?: string
  clipData?: {
    id: string
    keyQuote: string
    startTime: number
    endTime: number
    duration: number
  }
  onClose: () => void
  isVisible: boolean
}

export function ClipPlayer({ clipPath, clipData, onClose, isVisible }: ClipPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (clipPath && videoRef.current && isVisible) {
      const video = videoRef.current
      
      const handleLoadStart = () => {
        setIsLoading(true)
        setError(null)
      }
      
      const handleCanPlay = () => {
        setIsLoading(false)
        setDuration(video.duration)
      }
      
      const handleTimeUpdate = () => {
        setCurrentTime(video.currentTime)
      }
      
      const handlePlay = () => setIsPlaying(true)
      const handlePause = () => setIsPlaying(false)
      
      const handleError = () => {
        setIsLoading(false)
        setError('Failed to load video clip')
        console.error('Video loading error:', video.error)
      }

      video.addEventListener('loadstart', handleLoadStart)
      video.addEventListener('canplay', handleCanPlay)
      video.addEventListener('timeupdate', handleTimeUpdate)
      video.addEventListener('play', handlePlay)
      video.addEventListener('pause', handlePause)
      video.addEventListener('error', handleError)

      // Load the video
      video.src = `app-file://${clipPath}`
      video.load()

      return () => {
        video.removeEventListener('loadstart', handleLoadStart)
        video.removeEventListener('canplay', handleCanPlay)
        video.removeEventListener('timeupdate', handleTimeUpdate)
        video.removeEventListener('play', handlePlay)
        video.removeEventListener('pause', handlePause)
        video.removeEventListener('error', handleError)
      }
    }
  }, [clipPath, isVisible])

  const togglePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value)
    if (videoRef.current) {
      videoRef.current.currentTime = time
      setCurrentTime(time)
    }
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value)
    setVolume(vol)
    if (videoRef.current) {
      videoRef.current.volume = vol
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (!isVisible) return null

  return (
    <div className="absolute inset-0 bg-bg-primary z-50 flex items-center justify-center p-8">
      {/* Close Button - Top Right */}
      <button
        onClick={onClose}
        className="absolute top-6 right-6 w-10 h-10 rounded-full bg-bg-tertiary hover:bg-hover-bg border border-border-default flex items-center justify-center text-text-muted hover:text-text-primary transition-colors z-10"
      >
        ✕
      </button>

      {/* Split Screen Layout */}
      <div className="flex items-center justify-center gap-8 h-full max-w-7xl w-full">
        {/* Left Side - 9:16 Phone Preview */}
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm font-medium text-text-secondary">Reel Preview</div>

          {/* Phone Frame - 9:16 aspect ratio */}
          <div className="phone-frame">
            <div className="phone-screen">
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-white text-sm">Loading...</div>
                </div>
              )}

              {error && (
                <div className="absolute inset-0 flex items-center justify-center bg-black">
                  <div className="text-red-400 text-center px-4">
                    <div className="text-2xl mb-2">⚠️</div>
                    <div className="text-xs">{error}</div>
                  </div>
                </div>
              )}

              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                controls={false}
                preload="auto"
              />
            </div>
          </div>

          <div className="text-xs text-text-muted">9:16 Format (1080×1920)</div>
        </div>

        {/* Right Side - Controls & Info */}
        <div className="flex-1 max-w-md space-y-6">
          {/* Header */}
          <div>
            <h3 className="text-2xl font-semibold text-text-primary mb-2">Clip Preview</h3>
            {clipData && (
              <p className="text-sm text-text-secondary leading-relaxed">
                "{clipData.keyQuote}"
              </p>
            )}
          </div>

          {/* Clip Info */}
          {clipData && (
            <div className="space-y-3 p-4 bg-bg-secondary rounded-lg border border-border-default">
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Duration</span>
                <span className="text-text-primary font-medium">{formatTime(clipData.duration)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-secondary">Original Timestamp</span>
                <span className="text-text-primary font-medium">
                  {formatTime(clipData.startTime)} - {formatTime(clipData.endTime)}
                </span>
              </div>
            </div>
          )}

          {/* Playback Controls */}
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <button
                onClick={togglePlayPause}
                disabled={isLoading || !!error}
                className="w-14 h-14 bg-accent-primary hover:bg-blue-600 rounded-full flex items-center justify-center text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg"
              >
                {isPlaying ? (
                  <span className="text-xl">⏸</span>
                ) : (
                  <span className="text-xl ml-1">▶</span>
                )}
              </button>

              <div className="flex-1">
                <div className="text-sm text-text-primary font-medium mb-1">
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  disabled={isLoading || !!error}
                  className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
            </div>

            {/* Volume Control */}
            <div className="flex items-center gap-3 p-3 bg-bg-secondary rounded-lg border border-border-default">
              <span className="text-text-secondary">🔊</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={volume}
                onChange={handleVolumeChange}
                className="flex-1 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer slider"
              />
              <span className="text-sm text-text-primary font-medium w-12 text-right">
                {Math.round(volume * 100)}%
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              className="flex-1 btn-secondary"
            >
              Close
            </button>
            <button
              className="flex-1 btn-primary"
              disabled={isLoading || !!error}
            >
              Export Reel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}