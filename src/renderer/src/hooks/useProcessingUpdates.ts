import { useEffect, useCallback, useRef } from 'react'
import { useProcessingStore } from '../stores/processingStore'
import { useProjectStore } from '../stores/projectStore'
import type { ProcessingErrorPayload, ProcessingProgress, ProcessingResultPayload } from '@shared/types'

function sanitizeProcessingErrorMessage(message: string) {
  if (!message) {
    return 'Processing failed.'
  }

  if (message.includes('ffprobe exited with code')) {
    return 'Could not analyze that media file.'
  }

  if (message.includes('File name too long')) {
    return 'Could not import a playable media file from that link.'
  }

  return message.length > 220 ? `${message.slice(0, 220).trim()}...` : message
}

export function useProcessingUpdates() {
  const { updateProgress, setProcessing, activeJobId, setActiveJobId } = useProcessingStore()
  const { 
    setProcessingStatus, 
    setFullTranscript, 
    setClips,
    markScreenCompleted,
    setCurrentEpisode,
  } = useProjectStore()
  
  // Singleton episode ID to prevent race conditions
  const episodeIdRef = useRef<string | null>(null)
  const uploadStageUnlockedRef = useRef(false)
  const reviewStageUnlockedRef = useRef(false)
  const activeJobIdRef = useRef<string | undefined>(activeJobId)

  const restoreActivePipelineJob = useCallback(async () => {
    if (!window.electronAPI?.getActivePipelineJob) {
      return
    }

    const pathMatch = window.location.pathname.match(/\/(review|content|export)\/([^/]+)/)
    const routeEpisodeId = pathMatch?.[2]
    const state = useProjectStore.getState()
    const response = await window.electronAPI.getActivePipelineJob(
      routeEpisodeId || state.currentEpisode?.id,
      state.currentProject?.id
    )

    if (!response) {
      return
    }

    activeJobIdRef.current = response.jobId
    setActiveJobId(response.jobId)
    setProcessing(response.status === 'pending' || response.status === 'running')
    setProcessingStatus(response.stage)
    updateProgress({
      jobId: response.jobId,
      stage: response.stage,
      progress: response.progress,
      message: response.message
    })

    if (!state.currentEpisode && response.episodeId && window.electronAPI?.getEpisode) {
      try {
        const episode = await window.electronAPI.getEpisode(response.episodeId)
        if (episode) {
          setCurrentEpisode(episode)
        }
      } catch (error) {
        console.error('Failed to restore active episode from durable pipeline job:', error)
      }
    }

    if (!state.fileInfo && response.filePath) {
      state.setFileInfo({
        name: response.filePath.split('/').pop() || response.projectName || 'Unknown File',
        path: response.filePath,
        size: 0,
        duration: state.currentEpisode?.duration || 0,
        uploadDate: response.createdAt
      })
    }
  }, [setActiveJobId, setProcessing, setProcessingStatus, setCurrentEpisode, updateProgress])

  useEffect(() => {
    activeJobIdRef.current = activeJobId
  }, [activeJobId])

  useEffect(() => {
    restoreActivePipelineJob().catch((error) => {
      console.error('Failed to restore active pipeline job:', error)
    })
  }, [restoreActivePipelineJob])

  // Multi-tier auto-save implementation
  const triggerAutoSave = useCallback((level: 'level1' | 'level2' | 'level3', reason: string) => {
    setTimeout(() => {
      try {
        const state = useProjectStore.getState()
        console.log(`AUTO-SAVE ${level.toUpperCase()}:`, reason, {
          hasEpisode: !!state.currentEpisode,
          hasTranscript: state.fullTranscript.length > 0,
          hasFileInfo: !!state.fileInfo,
          hasClips: state.clips.length > 0,
          transcriptLength: state.fullTranscript.length,
          clipCount: state.clips.length
        })
        
        // Determine what data we have and what we can save
        const canSave = state.fileInfo && (
          level === 'level1' || // Just need file info for basic save
          (level === 'level2' && state.fullTranscript.length > 0) || // Need transcript for level 2
          (level === 'level3' && state.clips.length > 0) // Need clips for level 3
        )
        
        if (!canSave) {
          console.log(`Auto-save ${level} skipped - insufficient data for this level`)
          return
        }
        
        // Create or update episode as needed (singleton pattern to prevent duplicates)
        if (!state.currentEpisode && state.fileInfo) {
          // Use singleton episode ID or create one if it doesn't exist
          if (!episodeIdRef.current) {
            episodeIdRef.current = Date.now().toString()
            console.log(`AUTO-SAVE ${level}: Creating singleton episode ID ${episodeIdRef.current}`)
          }
          
          console.log(`AUTO-SAVE ${level}: Creating new episode with ID ${episodeIdRef.current} because no currentEpisode exists`)
          const basicEpisode = {
            id: episodeIdRef.current,
            projectId: state.currentProject?.id ?? 'local-session',
            fileName: state.fileInfo.name,
            filePath: state.fileInfo.path,
            duration: state.fileInfo.duration || 0,
            createdAt: new Date().toISOString(),
            processingStatus: 'pending' as const
          }
          state.setCurrentEpisode(basicEpisode)
          console.log(`AUTO-SAVE ${level}: Created episode`, episodeIdRef.current, 'for reason:', reason)
        } else if (state.currentEpisode) {
          console.log(`AUTO-SAVE ${level}: Using existing episode`, state.currentEpisode.id)
          // Ensure our singleton ref matches the existing episode
          episodeIdRef.current = state.currentEpisode.id
        } else {
          console.log(`AUTO-SAVE ${level}: No episode created - no fileInfo available`)
        }
        
        // Save the project
        const savedProject = state.saveCurrentProject()
        console.log(`AUTO-SAVE ${level.toUpperCase()} SUCCESS:`, {
          projectName: savedProject.name,
          id: savedProject.id,
          transcriptLength: savedProject.transcriptLength,
          clipCount: savedProject.clipCount,
          status: savedProject.processingStatus,
          reason
        })
        
      } catch (error) {
        console.error(`Auto-save ${level} failed:`, error)
      }
    }, level === 'level1' ? 2000 : level === 'level2' ? 1500 : 1000) // Staggered delays
  }, [])

  useEffect(() => {
    // Set up processing update listener
    const cleanup = window.electronAPI?.onProcessingUpdate?.((data: ProcessingProgress) => {
      if (data.jobId) {
        if (!activeJobIdRef.current) {
          activeJobIdRef.current = data.jobId
          setActiveJobId(data.jobId)
        } else if (activeJobIdRef.current !== data.jobId) {
          console.log('Ignoring stale processing update for foreign job:', data.jobId)
          return
        }
      }

      console.log('Received processing update:', data)
      
      // Reset episode ID singleton when a new processing session starts
      if (data.stage === 'uploading' && data.progress <= 10) {
        episodeIdRef.current = null
        uploadStageUnlockedRef.current = false
        reviewStageUnlockedRef.current = false
        if (data.jobId) {
          activeJobIdRef.current = data.jobId
          setActiveJobId(data.jobId)
        }
        console.log('🔄 PROCESSING START: Reset singleton episode ID for new session')
      }
      
      // Debug transcript data specifically
      if (data.recentTranscriptLines) {
        console.log('🎤 TRANSCRIPT LINES:', data.recentTranscriptLines)
      }
      if (data.partialTranscript) {
        console.log('🎤 PARTIAL TRANSCRIPT:', data.partialTranscript)
      }
      
      // Update processing state in project store
      if (data.stage) {
        setProcessingStatus(data.stage)
      }
      
      // Save transcript data as it becomes available
      if (data.partialTranscript) {
        setFullTranscript(data.partialTranscript)
      }
      
      // MULTI-TIER AUTO-SAVE: Save at different processing stages
      if (data.stage === 'transcribing' && data.progress > 30 && !uploadStageUnlockedRef.current) {
        // LEVEL 1: Mark upload complete and save basic project shell
        uploadStageUnlockedRef.current = true
        markScreenCompleted('upload')
        console.log('⏸️ AUTO-SAVE LEVEL 1 DISABLED - debugging duplicate projects')
        // triggerAutoSave('level1', 'File uploaded and transcription started')
      }
      
      if (data.stage === 'analyzing' && !reviewStageUnlockedRef.current) {
        // LEVEL 2: Transcription complete - save transcript data
        reviewStageUnlockedRef.current = true
        markScreenCompleted('review')
        console.log('Transcription completed - Review screen unlocked')
        console.log('⏸️ AUTO-SAVE LEVEL 2 DISABLED - debugging duplicate projects')
        // triggerAutoSave('level2', 'Transcription completed successfully')
      }
      
      // Only update progress, don't force processing state
      // Let the processing state be managed by the actual processing calls
      updateProgress(data)
    })

    // Set up processing complete listener
    const cleanupComplete = window.electronAPI?.onProcessingComplete?.(async (data: ProcessingResultPayload) => {
      if (data.jobId && activeJobIdRef.current && data.jobId !== activeJobIdRef.current) {
        console.log('Ignoring stale processing completion for foreign job:', data.jobId)
        return
      }

      console.log('Processing complete:', data)
      
      // Enhanced database sync: Load complete project data from multiple sources
      try {
        console.log('Syncing project data from database:', {
          projectId: data.projectId,
          episodeId: data.episodeId,
          hasTranscript: data.hasTranscript,
          clipsFound: data.clipsFound,
          aiAnalysisSucceeded: data.aiAnalysisSucceeded
        })
        
        // Priority 1: Load clips from database
        if (data.episodeId && window.electronAPI?.getEpisodeClips) {
          const rawClips = await window.electronAPI.getEpisodeClips(data.episodeId)
          if (rawClips && rawClips.length > 0) {
            // Transform clips to ensure consistent field names (handle both snake_case and camelCase)
            const processedClips = rawClips.map((clip: any) => ({
              id: clip.id,
              episodeId: clip.episodeId || clip.episode_id,
              startTime: Number(clip.startTime || clip.start_time) || 0,
              endTime: Number(clip.endTime || clip.end_time) || 0,
              duration: Number(clip.duration) || 0,
              contentType: clip.contentType || clip.content_type || 'insight',
              shareabilityScore: Number(clip.shareabilityScore || clip.shareability_score) || 0,
              keyQuote: clip.keyQuote || clip.key_quote || 'No quote available',
              reason: clip.reason || 'No reason provided',
              contextNeeded: clip.contextNeeded || clip.context_needed || 'low',
              videoWidth: clip.videoWidth ?? clip.video_width ?? null,
              videoHeight: clip.videoHeight ?? clip.video_height ?? null,
              status: clip.status || 'pending',
              createdAt: clip.createdAt || clip.created_at || new Date().toISOString()
            }))
            setClips(processedClips)
            console.log('DB SYNC: Loaded clips data:', processedClips.length, 'clips')
            
            // Extract episode data from first clip if available
            if (rawClips[0] && rawClips[0].episode) {
              setCurrentEpisode(rawClips[0].episode)
              console.log('DB SYNC: Loaded episode data from clip')
            }
          } else if (data.aiAnalysisSucceeded === false) {
            // AI failed but we might still have episode data
            console.log('DB SYNC: No clips found (AI analysis failed)')
          }
        }
        
        // Priority 2: Load episode from database (critical for navigation)
        let state = useProjectStore.getState()
        if (!state.currentEpisode && data.episodeId && window.electronAPI?.getEpisode) {
          try {
            const episode = await window.electronAPI.getEpisode(data.episodeId)
            if (episode) {
              setCurrentEpisode(episode)
              console.log('DB SYNC: Loaded episode from database:', episode)
            } else {
              console.warn('DB SYNC: Episode not found with ID:', data.episodeId)
            }
          } catch (error) {
            console.error('DB SYNC: Failed to load episode:', error)
          }
        }
        
        // Priority 3: Load project/transcript data
        if (data.projectId && window.electronAPI?.getProject) {
          const project = await window.electronAPI.getProject(data.projectId)
          if (project && project.transcript) {
            setFullTranscript(project.transcript)
            console.log('DB SYNC: Loaded transcript data from project')
          }
        }
        
        // Priority 4: Ensure file info exists for proper saving
        state = useProjectStore.getState()
        if (!state.fileInfo && data.episodeId) {
          // Try to reconstruct file info from available data
          const reconstructedFileInfo = {
            name: state.currentEpisode?.fileName || 'Unknown File',
            path: '', // Path may not be available after processing
            size: 0, // Will be updated if available
            duration: state.currentEpisode?.duration || 0,
            uploadDate: state.currentEpisode?.createdAt || new Date().toISOString()
          }
          state.setFileInfo(reconstructedFileInfo)
          console.log('DB SYNC: Reconstructed file info for saving')
        }
        
      } catch (error) {
        console.error('DB SYNC: Failed to load complete project data:', error)
      }
      
      // Mark processing as completed and enable review screen
      setProcessingStatus('completed')
      markScreenCompleted('upload')
      markScreenCompleted('review')
      
      // LEVEL 3: Full project with clips completed
      triggerAutoSave('level3', 'Full processing completed with clips')
      setProcessing(false)
      setActiveJobId(undefined)
      activeJobIdRef.current = undefined
      
      // Don't immediately reset processing state - let the main process handle navigation
      updateProgress({ 
        stage: 'completed', 
        progress: 100, 
        message: 'Processing complete! Redirecting...' 
      })
      
      // Clean IPC-based processing - no global variable pollution needed
    })

    // Set up processing error listener
    const cleanupError = window.electronAPI?.onProcessingError?.((error: ProcessingErrorPayload | string) => {
      const errorPayload = typeof error === 'string' ? { message: error } : error
      const safeMessage = sanitizeProcessingErrorMessage(errorPayload.message)

      if (errorPayload.jobId && activeJobIdRef.current && errorPayload.jobId !== activeJobIdRef.current) {
        console.log('Ignoring stale processing error for foreign job:', errorPayload.jobId)
        return
      }

      console.error('Processing error:', errorPayload.message)
      setProcessing(false)
      setActiveJobId(undefined)
      activeJobIdRef.current = undefined
      
      // EMERGENCY ERROR HANDLING: Don't reset everything, preserve what we have
      const state = useProjectStore.getState()
      
      // If we got through transcription, preserve that progress
      if (state.fullTranscript.length > 0) {
        console.log('Error occurred but preserving transcription progress')
        markScreenCompleted('upload')
        markScreenCompleted('review')
        
        // Try emergency save of transcript-only project
        setTimeout(() => {
          try {
            if (state.fileInfo && !state.currentEpisode) {
              const basicEpisode = {
                id: Date.now().toString(),
                projectId: state.currentProject?.id ?? 'local-session',
                fileName: state.fileInfo.name,
                filePath: state.fileInfo.path,
                duration: state.fileInfo.duration || 0,
                createdAt: new Date().toISOString(),
                processingStatus: 'error' as const
              }
              state.setCurrentEpisode(basicEpisode)
            }
            
            if (state.currentEpisode && state.fileInfo) {
              const savedProject = state.saveCurrentProject()
              console.log('Emergency save after error:', savedProject.name)
            }
          } catch (saveError) {
            console.error('Emergency save after error failed:', saveError)
          }
        }, 500)
      }
      
      updateProgress({ 
        stage: state.fullTranscript.length > 0 ? 'analyzing' : 'uploading', 
        progress: state.fullTranscript.length > 0 ? 70 : 0, 
        message: `Processing failed: ${safeMessage}. ${state.fullTranscript.length > 0 ? 'Transcript saved - you can review it now.' : 'Please try again.'}` 
      })
    })

    // Return cleanup function
    return () => {
      cleanup?.()
      cleanupComplete?.()
      cleanupError?.()
    }
  }, [setActiveJobId, updateProgress, setProcessing])
}
