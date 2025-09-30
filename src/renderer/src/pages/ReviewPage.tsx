import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ClipPlayer } from '../components/ClipPlayer'
import { ClipCarousel } from '../components/ClipCarousel'
import { MainContentPanel } from '../components/MainContentPanel'
import { useClipsData, useProjectStore } from '../stores/projectStore'
import type { Clip as ProjectClip } from '@shared/types'

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
  
  // Use project store for persisted clips data
  const { clips: projectClips } = useClipsData()
  const { updateClipStatus: updateProjectClipStatus, markScreenCompleted } = useProjectStore()
  const [extractingClips, setExtractingClips] = useState<Set<string>>(new Set())
  const [extractionProgress, setExtractionProgress] = useState<{[clipId: string]: number}>({})
  const [playingClip, setPlayingClip] = useState<{clip: Clip, clipPath: string} | null>(null)

  // Fetch clips on component mount
  useEffect(() => {
    const initializeReviewPage = async () => {
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

      // Validate episode exists before loading clips
      try {
        const episode = await window.electronAPI?.getEpisode?.(episodeId)
        if (!episode) {
          console.warn(`Episode ${episodeId} not found, trying as project ID...`)
          const episodeByProject = await window.electronAPI?.getEpisodeByProject?.(episodeId)
          if (!episodeByProject) {
            setError('Episode not found. The episode may have been deleted or the ID is invalid.')
            setLoading(false)
            return
          }
          console.log('Found episode via project ID fallback:', episodeByProject)
        } else {
          console.log('Episode validated:', episode)
        }
      } catch (err) {
        console.error('Failed to validate episode:', err)
      }

      loadClips()
    }

    initializeReviewPage()
  }, [episodeId])

  // Reload clips when project clips change (e.g., after processing completion)
  useEffect(() => {
    if (projectClips && projectClips.length > 0 && clips.length === 0) {
      loadClips()
    }
  }, [projectClips])

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
      console.log('Loading clips for episode:', episodeId)
      
      // First, try to load from project store (persisted data)
      if (projectClips && projectClips.length > 0) {
        console.log('Loading clips from project store:', projectClips)
        const processedClips = projectClips.map((clip: ProjectClip) => ({
          id: clip.id,
          startTime: clip.startTime,
          endTime: clip.endTime,
          duration: clip.duration,
          contentType: clip.contentType,
          shareabilityScore: clip.shareabilityScore,
          keyQuote: clip.keyQuote,
          reason: clip.reason,
          contextNeeded: clip.contextNeeded,
          status: clip.status
        }))
        setClips(processedClips)
        
        // Mark review screen as available since we have clips
        markScreenCompleted('review')
        setLoading(false)
        return
      }
      
      // Fallback to database if no persisted clips
      console.log('Fetching clips from database for episode:', episodeId)
      const clipsData = await window.electronAPI?.getEpisodeClips(episodeId!)
      console.log('Received clips from database:', clipsData)
      
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
        console.log('Processed clips from database:', processedClips)
        setClips(processedClips)
        
        if (processedClips.length > 0) {
          markScreenCompleted('review')
        }
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

  // Handle clip approval
  const handleApprove = async (clipId: string) => {
    try {
      // Update database
      await window.electronAPI?.updateClipStatus(clipId, 'approved')
      
      // Update local state
      setClips(clips.map(clip => 
        clip.id === clipId ? { ...clip, status: 'approved' as const } : clip
      ))
      
      // Update project store
      updateProjectClipStatus(clipId, 'approved')
      
      console.log(`Approved clip: ${clipId}`)
    } catch (err) {
      console.error('Failed to approve clip:', err)
    }
  }

  // Handle clip rejection
  const handleReject = async (clipId: string) => {
    try {
      // Update database
      await window.electronAPI?.updateClipStatus(clipId, 'rejected')
      
      // Update local state
      setClips(clips.map(clip => 
        clip.id === clipId ? { ...clip, status: 'rejected' as const } : clip
      ))
      
      // Update project store
      updateProjectClipStatus(clipId, 'rejected')
      
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
        console.log('Clip validation failed:', {
          clip,
          hasClip: !!clip,
          startTime: clip?.startTime,
          endTime: clip?.endTime,
          episodeId,
          clipKeys: clip ? Object.keys(clip) : 'no clip'
        })
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
    <MainContentPanel>
      <ClipCarousel
        clips={clips}
        selectedClip={selectedClip}
        onSelectClip={handleSelectClip}
        onPlayClip={handlePlayClip}
        onApproveClip={handleApprove}
        onRejectClip={handleReject}
        extractingClips={extractingClips}
        extractionProgress={extractionProgress}
      />

      {/* Native Clip Player */}
      <ClipPlayer
        clipPath={playingClip?.clipPath}
        clipData={playingClip?.clip}
        onClose={() => setPlayingClip(null)}
        isVisible={!!playingClip}
      />
    </MainContentPanel>
  )
}