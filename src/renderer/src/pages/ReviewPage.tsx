import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ClipEditModal } from '../components/ClipEditModal'
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

  // State for edit modal
  const [editingClip, setEditingClip] = useState<Clip | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

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

  // Handle clip selection without opening modal (for arrow keys)
  const handleNavigateToClip = (clip: Clip) => {
    setSelectedClip(clip)
  }

  // Handle clip selection for preview - opens edit modal
  const handleSelectClip = (clip: Clip) => {
    try {
      console.log('Selecting clip for editing:', clip)
      setSelectedClip(clip)
      setEditingClip(clip)
      setIsEditModalOpen(true)
      console.log('Opened edit modal for clip')
    } catch (error) {
      console.error('Error selecting clip:', error)
    }
  }

  // Handle closing edit modal
  const handleCloseEditModal = () => {
    setIsEditModalOpen(false)
    setEditingClip(null)
    // Refresh clips to show any updates
    loadClips()
  }

  // Handle saving clip edits
  const handleSaveClipEdits = async () => {
    console.log('Clip edits saved successfully')
    // Refresh clips list to show updated status
    await loadClips()
  }

  // Handle play clip - now opens edit modal
  const handlePlayClip = async (clip: Clip) => {
    // Close any open modals and open the edit modal
    handleSelectClip(clip)
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
        onNavigateClip={handleNavigateToClip}
        onPlayClip={handlePlayClip}
        onApproveClip={handleApprove}
        onRejectClip={handleReject}
        extractingClips={extractingClips}
        extractionProgress={extractionProgress}
        isModalOpen={isEditModalOpen}
      />

      {/* Edit Modal (for both Play button and clicking on clip card) */}
      {isEditModalOpen && editingClip && episodeId && (
        <ClipEditModal
          isOpen={isEditModalOpen}
          clipId={editingClip.id}
          episodeId={episodeId}
          clipData={{
            id: editingClip.id,
            keyQuote: editingClip.keyQuote,
            startTime: editingClip.startTime,
            endTime: editingClip.endTime,
            duration: editingClip.duration
          }}
          onClose={handleCloseEditModal}
          onSave={handleSaveClipEdits}
        />
      )}
    </MainContentPanel>
  )
}