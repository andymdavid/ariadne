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
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-bg-primary border border-border-default rounded-lg max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">Clip Preview</h3>
            {clipData && (
              <p className="text-sm text-text-muted mt-1">
                "{clipData.keyQuote.substring(0, 60)}..."
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl"
          >
            ✕
          </button>
        </div>

        {/* Video Player */}
        <div className="p-6">
          <div className="relative bg-black rounded-lg overflow-hidden mb-4">
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <div className="text-white">Loading clip...</div>
              </div>
            )}
            
            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black">
                <div className="text-red-400 text-center">
                  <div className="text-lg mb-2">⚠️</div>
                  <div>{error}</div>
                  <div className="text-sm mt-2">Path: {clipPath}</div>
                </div>
              </div>
            )}

            <video
              ref={videoRef}
              className="w-full h-[400px] object-contain"
              controls={false}
              preload="auto"
            />
          </div>

          {/* Controls */}
          <div className="space-y-4">
            {/* Play/Pause and Time */}
            <div className="flex items-center space-x-4">
              <button
                onClick={togglePlayPause}
                disabled={isLoading || !!error}
                className="w-12 h-12 bg-accent-primary hover:bg-accent-primary/80 rounded-full flex items-center justify-center text-white disabled:opacity-50"
              >
                {isPlaying ? '⏸️' : '▶️'}
              </button>
              
              <div className="text-sm text-text-muted">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
              
              {clipData && (
                <div className="text-sm text-text-muted">
                  Original: {formatTime(clipData.startTime)} - {formatTime(clipData.endTime)}
                </div>
              )}
            </div>

            {/* Seek Bar */}
            <div className="space-y-2">
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

            {/* Volume */}
            <div className="flex items-center space-x-2">
              <span className="text-sm text-text-muted">🔊</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={volume}
                onChange={handleVolumeChange}
                className="w-24 h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer slider"
              />
              <span className="text-sm text-text-muted w-8">{Math.round(volume * 100)}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}