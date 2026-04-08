import { useEffect, useRef, useState } from 'react'
import type { Clip } from '@shared/types'

interface ClipCarouselProps {
  clips: Clip[]
  selectedClip: Clip | null
  publicationStatusByClipId?: Record<string, string>
  onSelectClip: (clip: Clip) => void
  onNavigateClip?: (clip: Clip) => void
  onPlayClip: (clip: Clip) => void
  onApproveClip: (clipId: string) => void
  onRejectClip: (clipId: string) => void
  extractingClips: Set<string>
  extractionProgress: { [clipId: string]: number }
  isModalOpen?: boolean
}

export function ClipCarousel({
  clips,
  selectedClip,
  publicationStatusByClipId = {},
  onSelectClip,
  onNavigateClip,
  onPlayClip,
  onApproveClip,
  onRejectClip,
  extractingClips,
  extractionProgress,
  isModalOpen = false
}: ClipCarouselProps) {
  const carouselRef = useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Format time from seconds to MM:SS
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds) || seconds < 0) {
      return '0:00'
    }
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Scroll to center the selected card
  useEffect(() => {
    if (!carouselRef.current || clips.length === 0) return

    const carousel = carouselRef.current
    const cards = carousel.querySelectorAll('.clip-card')
    const selectedCard = cards[selectedIndex] as HTMLElement

    if (selectedCard) {
      const cardRect = selectedCard.getBoundingClientRect()
      const carouselRect = carousel.getBoundingClientRect()
      const cardCenter = cardRect.left + cardRect.width / 2
      const carouselCenter = carouselRect.left + carouselRect.width / 2
      const scrollOffset = cardCenter - carouselCenter

      carousel.scrollBy({
        left: scrollOffset,
        behavior: 'smooth'
      })
    }
  }, [selectedIndex, clips.length])

  // Update selected index when selected clip changes
  useEffect(() => {
    if (selectedClip) {
      const index = clips.findIndex(clip => clip.id === selectedClip.id)
      if (index !== -1) {
        setSelectedIndex(index)
      }
    }
  }, [selectedClip, clips])

  // Handle card click
  const handleCardClick = (clip: Clip, index: number) => {
    setSelectedIndex(index)
    onSelectClip(clip)
  }

  // Navigate with arrow keys - global listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input, modal is open, or focused on a textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        isModalOpen
      ) {
        return
      }

      if (e.key === 'ArrowLeft' && selectedIndex > 0) {
        e.preventDefault()
        const newIndex = selectedIndex - 1
        setSelectedIndex(newIndex)
        // Use onNavigateClip if provided, otherwise fall back to onSelectClip
        if (onNavigateClip) {
          onNavigateClip(clips[newIndex])
        } else {
          onSelectClip(clips[newIndex])
        }
      } else if (e.key === 'ArrowRight' && selectedIndex < clips.length - 1) {
        e.preventDefault()
        const newIndex = selectedIndex + 1
        setSelectedIndex(newIndex)
        // Use onNavigateClip if provided, otherwise fall back to onSelectClip
        if (onNavigateClip) {
          onNavigateClip(clips[newIndex])
        } else {
          onSelectClip(clips[newIndex])
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, clips, onSelectClip, onNavigateClip, isModalOpen])

  if (clips.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="text-6xl">🎬</div>
          <h3 className="text-xl font-semibold text-text-primary">
            No clips found
          </h3>
          <p className="text-text-muted">
            The AI analysis didn't identify any suitable clips
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="clip-carousel-container">
      <div
        ref={carouselRef}
        className="clip-carousel"
      >
        {clips.map((clip, index) => {
          const isSelected = index === selectedIndex
          const isExtracting = extractingClips.has(clip.id)

          return (
            <div
              key={clip.id}
              className={`clip-card ${isSelected ? 'selected' : ''}`}
              onClick={() => handleCardClick(clip, index)}
            >
              {/* Status Indicator */}
              {clip.status !== 'pending' && (
                <div className={`status-badge ${clip.status}`}>
                  {clip.status === 'approved' ? '✓' : '✗'}
                </div>
              )}

              {publicationStatusByClipId[clip.id] && (
                <div className={`status-badge publication publication-${publicationStatusByClipId[clip.id]}`}>
                  {publicationStatusByClipId[clip.id].split('_').join(' ')}
                </div>
              )}

              {/* Card Header */}
              <div className="clip-card-header">
                <span className={`content-type ${clip.contentType}`}>
                  {clip.contentType}
                </span>
                <span className="shareability-score">
                  {clip.shareabilityScore}★
                </span>
              </div>

              {/* Key Quote */}
              <blockquote className="clip-quote">
                "{clip.keyQuote}"
              </blockquote>

              {/* Metadata */}
              <div className="clip-metadata">
                <span className="duration">{formatTime(clip.duration)}</span>
                <span className="divider">•</span>
                <span className="timestamp">
                  {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                </span>
              </div>

              {/* Reason */}
              <p className="clip-reason">{clip.reason}</p>

              {/* Actions - Only show on selected card */}
              {isSelected && (
                <div className="clip-actions">
                  <button
                    className="btn-primary btn-sm"
                    disabled={isExtracting}
                    onClick={(e) => {
                      e.stopPropagation()
                      onPlayClip(clip)
                    }}
                  >
                    {isExtracting
                      ? `Extracting... ${Math.round(extractionProgress[clip.id] || 0)}%`
                      : '🎵 Play'}
                  </button>

                  {clip.status === 'pending' && (
                    <>
                      <button
                        className="btn-approve btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onApproveClip(clip.id)
                        }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        className="btn-reject btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRejectClip(clip.id)
                        }}
                      >
                        ✗ Reject
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Navigation Hint */}
      <div className="carousel-hint">
        <span>← → Use arrow keys to navigate</span>
        <span className="clip-counter">
          {selectedIndex + 1} / {clips.length}
        </span>
      </div>
    </div>
  )
}
