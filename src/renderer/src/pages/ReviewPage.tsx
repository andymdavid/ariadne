import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ClipPlayer } from '../components/ClipPlayer'

interface Clip {
  id: string
  startTime: number
  endTime: number
  duration: number
  contentType: string
  shareabilityScore: number
  keyQuote: string
  reason: string
  contextNeeded: string
  status: 'pending' | 'approved' | 'rejected'
}

export function ReviewPage() {
  const { id: episodeId } = useParams<{ id: string }>()
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adjustingClip, setAdjustingClip] = useState<Clip | null>(null)
  const [adjustStartTime, setAdjustStartTime] = useState('')
  const [adjustEndTime, setAdjustEndTime] = useState('')
  const [extractingClips, setExtractingClips] = useState<Set<string>>(new Set())
  const [extractionProgress, setExtractionProgress] = useState<{[clipId: string]: number}>({})
  const [playingClip, setPlayingClip] = useState<{clip: Clip, clipPath: string} | null>(null)

  // Fetch clips on component mount
  useEffect(() => {
    if (!episodeId) {
      setError('No episode ID provided')
      setLoading(false)
      return
    }

    // Debug electronAPI availability on component mount
    console.log('ReviewPage mounted - checking electronAPI...')
    console.log('window.electronAPI:', window.electronAPI)
    console.log('typeof window.electronAPI:', typeof window.electronAPI)
    if (window.electronAPI) {
      console.log('electronAPI methods:', Object.keys(window.electronAPI))
      console.log('playClip method:', window.electronAPI.playClip)
    }

    loadClips()
  }, [episodeId])

  // Listen for clip extraction progress
  useEffect(() => {
    const cleanup = window.electronAPI?.onClipExtractionProgress?.((data: any) => {
      setExtractionProgress(prev => ({
        ...prev,
        [data.clipId]: data.progress
      }))
    })

    return cleanup
  }, [])

  const loadClips = async () => {
    try {
      setLoading(true)
      console.log('Fetching clips for episode:', episodeId)
      
      const clipsData = await window.electronAPI?.getEpisodeClips(episodeId!)
      console.log('Received clips:', clipsData)
      console.log('First clip raw data:', clipsData?.[0])
      
      if (clipsData && Array.isArray(clipsData)) {
        const processedClips = clipsData.map((clip: any) => {
          console.log('Processing clip:', clip)
          return {
            id: clip.id,
            startTime: Number(clip.start_time) || 0,
            endTime: Number(clip.end_time) || 0,
            duration: Number(clip.duration) || 0,
            contentType: clip.content_type || clip.contentType || 'unknown',
            shareabilityScore: Number(clip.shareability_score) || clip.shareabilityScore || 0,
            keyQuote: clip.key_quote || clip.keyQuote || 'No quote available',
            reason: clip.reason || 'No reason provided',
            contextNeeded: clip.context_needed || clip.contextNeeded || 'low',
            status: clip.status || 'pending'
          }
        })
        console.log('Processed clips:', processedClips)
        setClips(processedClips)
      } else {
        setClips([])
      }
    } catch (err) {
      console.error('Failed to load clips:', err)
      setError('Failed to load clips')
    } finally {
      setLoading(false)
    }
  }

  // Format time from seconds to MM:SS
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds) || seconds < 0) {
      return '0:00'
    }
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Format timestamp range
  const formatTimestamp = (startTime: number, endTime: number): string => {
    return `${formatTime(startTime)} - ${formatTime(endTime)}`
  }

  // Handle clip approval
  const handleApprove = async (clipId: string) => {
    try {
      await window.electronAPI?.updateClipStatus(clipId, 'approved')
      setClips(clips.map(clip => 
        clip.id === clipId ? { ...clip, status: 'approved' as const } : clip
      ))
      console.log(`Approved clip: ${clipId}`)
    } catch (err) {
      console.error('Failed to approve clip:', err)
    }
  }

  // Handle clip rejection
  const handleReject = async (clipId: string) => {
    try {
      await window.electronAPI?.updateClipStatus(clipId, 'rejected')
      setClips(clips.map(clip => 
        clip.id === clipId ? { ...clip, status: 'rejected' as const } : clip
      ))
      console.log(`Rejected clip: ${clipId}`)
    } catch (err) {
      console.error('Failed to reject clip:', err)
    }
  }

  // Handle clip selection for preview
  const handleSelectClip = (clip: Clip) => {
    try {
      console.log('Selecting clip:', clip)
      setSelectedClip(clip)
      console.log('Selected clip successfully')
    } catch (error) {
      console.error('Error selecting clip:', error)
    }
  }

  // Handle play clip
  const handlePlayClip = async (clip: Clip) => {
    try {
      console.log('Playing clip:', clip)
      console.log('window object exists:', !!window)
      console.log('electronAPI available:', !!window.electronAPI)
      console.log('electronAPI is object:', typeof window.electronAPI)
      
      if (window.electronAPI) {
        console.log('All electronAPI methods:', Object.keys(window.electronAPI))
        console.log('playClip function type:', typeof window.electronAPI.playClip)
        console.log('playClip function exists:', 'playClip' in window.electronAPI)
      } else {
        console.error('electronAPI is not available on window object')
        console.log('window properties:', Object.keys(window))
      }
      
      if (!clip || !clip.startTime || !clip.endTime || !episodeId) {
        alert('Clip data is incomplete - cannot play')
        return
      }

      if (!window.electronAPI || typeof window.electronAPI.playClip !== 'function') {
        alert('playClip function not available. Please restart the application and check the console for errors.')
        return
      }
      
      // Mark clip as being extracted
      setExtractingClips(prev => new Set(prev).add(clip.id))
      setExtractionProgress(prev => ({ ...prev, [clip.id]: 0 }))
      
      try {
        // Call the clip extraction and playback function
        const result = await window.electronAPI.playClip(episodeId, clip.startTime, clip.endTime, clip.id)
        console.log('Clip extraction result:', result)
        
        if (result?.success && result.clipPath) {
          // Open the native in-app player
          console.log('Opening native player with clip path:', result.clipPath)
          setPlayingClip({ clip, clipPath: result.clipPath })
        }
      } finally {
        // Clean up extraction state
        setExtractingClips(prev => {
          const newSet = new Set(prev)
          newSet.delete(clip.id)
          return newSet
        })
        setExtractionProgress(prev => {
          const newProgress = { ...prev }
          delete newProgress[clip.id]
          return newProgress
        })
      }
    } catch (error) {
      console.error('Error extracting/playing clip:', error)
      alert('Error extracting clip: ' + (error instanceof Error ? error.message : 'Unknown error'))
      
      // Clean up extraction state on error
      setExtractingClips(prev => {
        const newSet = new Set(prev)
        newSet.delete(clip.id)
        return newSet
      })
    }
  }

  // Handle adjust clip timing
  const handleAdjustClip = (clip: Clip) => {
    setAdjustingClip(clip)
    setAdjustStartTime(formatTime(clip.startTime))
    setAdjustEndTime(formatTime(clip.endTime))
  }

  // Parse time string (MM:SS) to seconds
  const parseTimeString = (timeStr: string): number => {
    const parts = timeStr.split(':')
    if (parts.length !== 2) return 0
    const minutes = parseInt(parts[0]) || 0
    const seconds = parseInt(parts[1]) || 0
    return minutes * 60 + seconds
  }

  // Save adjusted clip timing
  const handleSaveAdjustment = async () => {
    if (!adjustingClip) return

    try {
      const newStartTime = parseTimeString(adjustStartTime)
      const newEndTime = parseTimeString(adjustEndTime)
      
      if (newStartTime >= newEndTime) {
        alert('End time must be after start time')
        return
      }

      if (newEndTime - newStartTime < 10) {
        alert('Clip must be at least 10 seconds long')
        return
      }

      if (newEndTime - newStartTime > 180) {
        alert('Clip cannot be longer than 3 minutes')
        return
      }

      // Update the clip in the local state
      const updatedClips = clips.map(clip => 
        clip.id === adjustingClip.id 
          ? { 
              ...clip, 
              startTime: newStartTime, 
              endTime: newEndTime, 
              duration: newEndTime - newStartTime 
            }
          : clip
      )
      setClips(updatedClips)

      // Update selected clip if it's the one being adjusted
      if (selectedClip?.id === adjustingClip.id) {
        setSelectedClip({ 
          ...selectedClip, 
          startTime: newStartTime, 
          endTime: newEndTime, 
          duration: newEndTime - newStartTime 
        })
      }

      // TODO: Add API call to save changes to database
      console.log(`Adjusted clip ${adjustingClip.id}: ${newStartTime}s - ${newEndTime}s`)
      
      setAdjustingClip(null)
    } catch (error) {
      console.error('Error adjusting clip:', error)
      alert('Error adjusting clip: ' + error)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-text-primary">Loading clips...</div>
          <div className="text-text-muted">Please wait</div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-text-primary">Error loading clips</div>
          <div className="text-text-muted">{error}</div>
          <button 
            onClick={loadClips}
            className="btn-primary mt-4"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Clip Cards Panel */}
      <div className="w-80 border-r border-border-default p-4 space-y-4 overflow-y-auto flex-shrink-0">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            Suggested Clips
          </h2>
          <span className="text-sm text-text-muted">
            {clips.length} found
          </span>
        </div>

        {clips.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-text-muted">No clips found</div>
            <div className="text-sm text-text-muted mt-1">
              The AI analysis didn't identify any suitable clips
            </div>
          </div>
        ) : (
          clips.map((clip) => (
            <div 
              key={clip.id} 
              className={`card p-4 space-y-3 cursor-pointer transition-all hover:bg-bg-secondary ${
                selectedClip?.id === clip.id ? 'ring-2 ring-accent-primary' : ''
              }`}
              onClick={() => handleSelectClip(clip)}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span className={`text-xs font-medium uppercase tracking-wide ${
                    clip.status === 'approved' ? 'text-accent-success' :
                    clip.status === 'rejected' ? 'text-accent-danger' :
                    'text-accent-warning'
                  }`}>
                    {clip.contentType}
                  </span>
                  <span className="text-text-muted">•</span>
                  <span className="text-sm text-text-muted">
                    {formatTime(clip.duration) || '0:00'}
                  </span>
                  <span className="text-text-muted">•</span>
                  <span className="text-sm text-accent-primary font-medium">
                    {clip.shareabilityScore}★
                  </span>
                </div>
                <div className="flex space-x-1">
                  {clip.status === 'approved' && (
                    <div className="w-2 h-2 bg-accent-success rounded-full" />
                  )}
                  {clip.status === 'rejected' && (
                    <div className="w-2 h-2 bg-accent-danger rounded-full" />
                  )}
                </div>
              </div>

              {/* Quote */}
              <blockquote className="text-text-primary font-medium leading-relaxed">
                "{clip.keyQuote || 'No quote available'}"
              </blockquote>

              {/* Metadata */}
              <div className="space-y-2">
                <div className="text-sm text-text-muted">
                  {formatTimestamp(clip.startTime, clip.endTime) || '0:00 - 0:00'} • {clip.reason || 'No reason provided'}
                </div>
              </div>

              {/* Actions */}
              <div className="flex space-x-2 pt-2">
                <button 
                  className="btn-ghost text-sm"
                  disabled={extractingClips.has(clip.id)}
                  onClick={(e) => {
                    e.stopPropagation()
                    handlePlayClip(clip)
                  }}
                >
                  {extractingClips.has(clip.id) ? (
                    `⏳ Extracting... ${Math.round(extractionProgress[clip.id] || 0)}%`
                  ) : (
                    '🎵 Play Clip'
                  )}
                </button>
                <button 
                  className="btn-ghost text-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAdjustClip(clip)
                  }}
                >
                  ⚙️ Adjust
                </button>
                {clip.status === 'pending' && (
                  <>
                    <button 
                      className="btn-ghost text-sm text-accent-success"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleApprove(clip.id)
                      }}
                    >
                      ✓ Approve
                    </button>
                    <button 
                      className="btn-ghost text-sm text-accent-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleReject(clip.id)
                      }}
                    >
                      ✗ Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Clip Details */}
        <div className="flex-1 p-8 overflow-y-auto">
          {selectedClip ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-2xl font-semibold text-text-primary">
                  Clip Details
                </h3>
                <div className="flex items-center space-x-4">
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${
                    selectedClip.status === 'approved' ? 'bg-accent-success/20 text-accent-success' :
                    selectedClip.status === 'rejected' ? 'bg-accent-danger/20 text-accent-danger' :
                    'bg-accent-warning/20 text-accent-warning'
                  }`}>
                    {selectedClip.status}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="text-sm font-medium text-text-secondary">Content Type</label>
                  <div className="mt-1 text-lg text-text-primary capitalize">{selectedClip.contentType || 'Unknown'}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-secondary">Shareability Score</label>
                  <div className="mt-1 text-lg text-text-primary">{selectedClip.shareabilityScore || 0}/10</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-secondary">Duration</label>
                  <div className="mt-1 text-lg text-text-primary">{formatTime(selectedClip.duration) || '0:00'}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-text-secondary">Timestamp</label>
                  <div className="mt-1 text-lg text-text-primary">
                    {formatTimestamp(selectedClip.startTime, selectedClip.endTime) || '0:00 - 0:00'}
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary">Key Quote</label>
                <blockquote className="mt-2 text-lg text-text-primary font-medium leading-relaxed p-4 bg-bg-secondary rounded-lg border-l-4 border-accent-primary">
                  "{selectedClip.keyQuote || 'No quote available'}"
                </blockquote>
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary">Reason for Selection</label>
                <div className="mt-2 text-text-primary">{selectedClip.reason || 'No reason provided'}</div>
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary">Context Needed</label>
                <div className="mt-1">
                  <span className={`px-2 py-1 rounded text-sm ${
                    (selectedClip.contextNeeded || 'low') === 'low' ? 'bg-green-100 text-green-800' :
                    (selectedClip.contextNeeded || 'low') === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }`}>
                    {selectedClip.contextNeeded || 'low'}
                  </span>
                </div>
              </div>

              <div className="flex space-x-4 pt-4">
                <button 
                  className="btn-primary"
                  disabled={extractingClips.has(selectedClip.id)}
                  onClick={() => handlePlayClip(selectedClip)}
                >
                  {extractingClips.has(selectedClip.id) ? (
                    `⏳ Extracting... ${Math.round(extractionProgress[selectedClip.id] || 0)}%`
                  ) : (
                    '🎵 Play Clip'
                  )}
                </button>
                {selectedClip.status === 'pending' && (
                  <>
                    <button 
                      className="btn-primary bg-green-600 hover:bg-green-700"
                      onClick={() => handleApprove(selectedClip.id)}
                    >
                      ✓ Approve
                    </button>
                    <button 
                      className="btn-secondary bg-red-600 hover:bg-red-700 text-white"
                      onClick={() => handleReject(selectedClip.id)}
                    >
                      ✗ Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4">
                <h3 className="text-xl font-semibold text-text-primary">
                  Select a clip to preview
                </h3>
                <p className="text-text-muted max-w-md">
                  Choose a clip from the sidebar to see detailed information and controls.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Simple Timeline Track */}
        {selectedClip && (
          <div className="h-20 bg-bg-secondary border-t border-border-default p-4">
            <div className="text-sm text-text-muted mb-2">Episode Timeline</div>
            <div className="h-8 bg-bg-tertiary rounded relative">
              <div className="absolute inset-0 flex items-center px-2">
                <div className="text-xs text-text-muted">
                  [{formatTime(0)}] ────────────────────────── [{formatTime(3600)}]
                </div>
              </div>
              {/* Clip indicator */}
              <div 
                className="absolute top-0 h-full bg-accent-primary rounded"
                style={{
                  left: `${(selectedClip.startTime / 3600) * 100}%`,
                  width: `${(selectedClip.duration / 3600) * 100}%`
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Preview Panel */}
      <div className="w-80 border-l border-border-default p-4 flex-shrink-0 overflow-y-auto">
        <h3 className="text-lg font-semibold text-text-primary mb-4">
          Reel Preview
        </h3>
        
        {selectedClip ? (
          <>
            {/* Phone Frame */}
            <div className="mx-auto w-48 h-80 bg-bg-tertiary rounded-2xl p-2 relative">
              <div className="w-full h-full bg-black rounded-xl flex items-center justify-center">
                <div className="text-center text-white">
                  <div className="text-4xl mb-2">🎬</div>
                  <div className="text-sm">Preview</div>
                  <div className="text-xs mt-2 px-2">
                    {formatTime(selectedClip.duration)}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-sm font-medium text-text-secondary">Content Type:</label>
                <div className="mt-1 text-sm text-text-primary capitalize">
                  {selectedClip.contentType}
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium text-text-secondary">Key Quote:</label>
                <div className="mt-1 text-sm text-text-primary italic">
                  "{selectedClip.keyQuote.substring(0, 80)}
                  {selectedClip.keyQuote.length > 80 ? '...' : ''}"
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-text-secondary">Score:</label>
                <div className="mt-1 text-sm text-text-primary">
                  {selectedClip.shareabilityScore}/10
                </div>
              </div>

              <button 
                className="btn-primary w-full mt-4"
                disabled={extractingClips.has(selectedClip.id)}
                onClick={() => handlePlayClip(selectedClip)}
              >
                {extractingClips.has(selectedClip.id) ? (
                  `⏳ Extracting... ${Math.round(extractionProgress[selectedClip.id] || 0)}%`
                ) : (
                  '🎵 Play Clip'
                )}
              </button>

              {selectedClip.status === 'approved' && (
                <button className="btn-primary w-full">
                  Export Reel
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Empty Phone Frame */}
            <div className="mx-auto w-48 h-80 bg-bg-tertiary rounded-2xl p-2 relative">
              <div className="w-full h-full bg-black rounded-xl flex items-center justify-center">
                <div className="text-center text-text-muted">
                  <div className="text-4xl mb-2">📱</div>
                  <div className="text-sm">No Preview</div>
                </div>
              </div>
            </div>

            <div className="mt-4 text-center text-text-muted">
              <div className="text-sm">Select a clip to see preview</div>
            </div>
          </>
        )}
      </div>

      {/* Adjust Clip Modal */}
      {adjustingClip && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-bg-primary border border-border-default rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Adjust Clip Timing
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  Start Time (MM:SS)
                </label>
                <input
                  type="text"
                  value={adjustStartTime}
                  onChange={(e) => setAdjustStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-border-default rounded bg-bg-secondary text-text-primary"
                  placeholder="0:00"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  End Time (MM:SS)
                </label>
                <input
                  type="text"
                  value={adjustEndTime}
                  onChange={(e) => setAdjustEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-border-default rounded bg-bg-secondary text-text-primary"
                  placeholder="0:00"
                />
              </div>
              
              <div className="text-sm text-text-muted">
                Original: {formatTimestamp(adjustingClip.startTime, adjustingClip.endTime)}
              </div>
            </div>
            
            <div className="flex space-x-3 mt-6">
              <button
                onClick={handleSaveAdjustment}
                className="btn-primary flex-1"
              >
                Save Changes
              </button>
              <button
                onClick={() => setAdjustingClip(null)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Native Clip Player */}
      <ClipPlayer
        clipPath={playingClip?.clipPath}
        clipData={playingClip?.clip}
        onClose={() => setPlayingClip(null)}
        isVisible={!!playingClip}
      />
    </div>
  )
}