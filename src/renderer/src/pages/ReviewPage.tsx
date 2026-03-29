import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { IoArrowBack } from 'react-icons/io5'
import { ClipCarousel } from '../components/ClipCarousel'
import { MainContentPanel } from '../components/MainContentPanel'
import { PipelineRunInspector } from '../components/PipelineRunInspector'
import { useClipsData, useProjectStore } from '../stores/projectStore'
import type { Clip as ProjectClip } from '@shared/types'

export function ReviewPage() {
  const navigate = useNavigate()
  const { id: episodeId } = useParams<{ id: string }>()
  const [resolvedEpisodeId, setResolvedEpisodeId] = useState<string | null>(episodeId ?? null)
  const [clips, setClips] = useState<ProjectClip[]>([])
  const [selectedClip, setSelectedClip] = useState<ProjectClip | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  
  // Use project store for persisted clips data
  const { clips: projectClips } = useClipsData()
  const { updateClipStatus: updateProjectClipStatus, markScreenCompleted } = useProjectStore()
  const [extractingClips] = useState<Set<string>>(new Set())
  const [extractionProgress, setExtractionProgress] = useState<{[clipId: string]: number}>({})

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
          setResolvedEpisodeId(episodeByProject.id)
        } else {
          console.log('Episode validated:', episode)
          setResolvedEpisodeId(episode.id)
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
            videoWidth: clip.videoWidth ?? null,
            videoHeight: clip.videoHeight ?? null,
            status: clip.status,
            episodeId: clip.episodeId,
            createdAt: clip.createdAt
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
            videoWidth: clip.video_width ?? clip.videoWidth ?? null,
            videoHeight: clip.video_height ?? clip.videoHeight ?? null,
            status: (clip.status || 'pending') as ProjectClip['status'],
            episodeId: clip.episode_id || episodeId || '',
            createdAt: clip.created_at || new Date().toISOString()
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
  const handleNavigateToClip = (clip: ProjectClip) => {
    setSelectedClip(clip)
  }

  // Handle clip selection for preview - opens edit modal
  const handleSelectClip = (clip: ProjectClip) => {
    try {
      setSelectedClip(clip)
      if (!episodeId) return
      navigate(`/content/${episodeId}/${clip.id}`)
    } catch (error) {
      console.error('Error selecting clip:', error)
    }
  }

  // Handle play clip - now opens edit modal
  const handlePlayClip = async (clip: ProjectClip) => {
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
      <div className="relative h-full w-full">
        {resolvedEpisodeId && <PipelineRunInspector episodeId={resolvedEpisodeId} />}
        <button
          type="button"
          onClick={() => navigate('/')}
          className="absolute left-8 top-8 z-20 inline-flex items-center gap-2 rounded-full border border-white/8 bg-[#12151b]/88 px-3 py-2 text-sm text-text-secondary transition-colors hover:border-white/12 hover:bg-[#171b22] hover:text-text-primary"
        >
          <IoArrowBack size={15} />
          <span>Back</span>
        </button>
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
          isModalOpen={false}
        />
      </div>
    </MainContentPanel>
  )
}
