import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  isClipApproved,
  isClipPendingReview,
  isClipRejected,
  normalizeClipStatus
} from '@shared/types'
import type { Project, Episode, TranscriptSegment, Clip, ProcessingProgress } from '@shared/types'

const buildRecoveredEpisode = (fileInfo: NonNullable<ProjectState['fileInfo']>): Episode => ({
  id: Date.now().toString(),
  projectId: `recovered-${Date.now()}`,
  fileName: fileInfo.name.replace(/\.[^/.]+$/, ''),
  filePath: fileInfo.path,
  duration: fileInfo.duration || 0,
  createdAt: fileInfo.uploadDate || new Date().toISOString(),
  processingStatus: 'completed'
})

const normalizeClipForState = (clip: Clip): Clip => ({
  ...clip,
  status: normalizeClipStatus(clip.status)
})

const buildClipMetadata = (clips: Clip[]) => ({
  generationDate: new Date().toISOString(),
  totalClips: clips.length,
  approvedCount: clips.filter((clip) => isClipApproved(clip.status)).length,
  rejectedCount: clips.filter((clip) => isClipRejected(clip.status)).length
})

// Saved project interface for library management
export interface SavedProject {
  id: string
  name: string
  filename: string
  dateCreated: string
  lastModified: string
  clipCount: number
  duration: number
  transcriptLength: number
  processingStatus: 'completed' | 'partial'
  fileSize: number
  thumbnailPath?: string
  episode: Episode
  clips: Clip[]
  transcriptSegments: TranscriptSegment[]
  fullTranscript: string
}

// Project state interface for persisting user work
export interface ProjectState {
  // Current project data
  currentProject: Project | null
  currentEpisode: Episode | null
  
  // Saved projects library
  savedProjects: SavedProject[]
  
  // Transcription data
  transcriptSegments: TranscriptSegment[]
  fullTranscript: string
  
  // AI-generated clip suggestions
  clips: Clip[]
  clipsMetadata: {
    generationDate: string
    totalClips: number
    approvedCount: number
    rejectedCount: number
  }
  
  // Original file information
  fileInfo: {
    name: string
    path: string
    size: number
    duration: number
    uploadDate: string
  } | null
  
  // Processing status and progress
  processingStatus: ProcessingProgress['stage']
  processingProgress: number
  lastProcessingUpdate: string | null
  
  // Screen completion tracking
  completedScreens: Set<string>
  currentScreen: string
  
  // Session persistence
  lastSessionDate: string
  workflowData: {
    [key: string]: any // Flexible storage for screen-specific data
  }
}

// Actions interface for project store
interface ProjectActions {
  // Project management
  setCurrentProject: (project: Project) => void
  setCurrentEpisode: (episode: Episode) => void
  clearProject: () => void
  
  // Saved projects management
  cleanupInvalidProjects: () => number
  forceCleanupAllInvalid: () => number
  syncWithDatabase: () => Promise<void>
  saveCurrentProject: (name?: string) => SavedProject
  loadProject: (projectId: string) => void
  deleteProject: (projectId: string) => Promise<void>
  getSavedProjects: () => SavedProject[]
  getSavedProject: (projectId: string) => SavedProject | undefined
  
  // Transcription data management
  setTranscriptSegments: (segments: TranscriptSegment[]) => void
  setFullTranscript: (transcript: string) => void
  addTranscriptSegment: (segment: TranscriptSegment) => void
  
  // Clips management
  setClips: (clips: Clip[]) => void
  updateClip: (clipId: string, updates: Partial<Clip>) => void
  updateClipStatus: (clipId: string, status: Clip['status']) => void
  addClip: (clip: Clip) => void
  removeClip: (clipId: string) => void
  
  // File information
  setFileInfo: (info: ProjectState['fileInfo']) => void
  
  // Processing status
  setProcessingStatus: (status: ProcessingProgress['stage']) => void
  setProcessingProgress: (progress: number) => void
  updateProcessingState: (update: Partial<Pick<ProjectState, 'processingStatus' | 'processingProgress'>>) => void
  
  // Screen completion tracking
  markScreenCompleted: (screen: string) => void
  markScreenIncomplete: (screen: string) => void
  setCurrentScreen: (screen: string) => void
  isScreenCompleted: (screen: string) => boolean
  canAccessScreen: (screen: string) => boolean
  
  // Workflow data management
  setWorkflowData: (key: string, data: any) => void
  getWorkflowData: (key: string) => any
  
  // Session management
  updateSession: () => void
  isValidSession: () => boolean
  
  // Computed getters
  getApprovedClips: () => Clip[]
  getRejectedClips: () => Clip[]
  getPendingClips: () => Clip[]
  getClipsByContentType: (contentType: Clip['contentType']) => Clip[]
  
  // State validation and recovery
  validateState: () => boolean
  recoverSession: () => void
  resetToScreen: (screen: string) => void
  
  // Emergency recovery functions
  emergencyReset: () => void
  emergencyUnlockAll: () => void
}

// Initial state
const initialState: ProjectState = {
  currentProject: null,
  currentEpisode: null,
  savedProjects: [],
  transcriptSegments: [],
  fullTranscript: '',
  clips: [],
  clipsMetadata: {
    generationDate: '',
    totalClips: 0,
    approvedCount: 0,
    rejectedCount: 0
  },
  fileInfo: null,
  processingStatus: 'uploading',
  processingProgress: 0,
  lastProcessingUpdate: null,
  completedScreens: new Set<string>(),
  currentScreen: 'upload',
  lastSessionDate: '',
  workflowData: {}
}

// Screen flow definition
const SCREEN_FLOW = {
  upload: { next: 'review', requires: [] },
  review: { next: 'export', requires: ['upload'] },
  content: { next: 'export', requires: ['upload', 'review'] },
  export: { next: null, requires: ['upload', 'review'] },
  library: { next: null, requires: [] }
}

// Create the project store with persistence
export const useProjectStore = create<ProjectState & ProjectActions>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      // Project management
      setCurrentProject: (project) => {
        set({ currentProject: project })
        get().updateSession()
      },
      
      setCurrentEpisode: (episode) => {
        set({ currentEpisode: episode })
        get().updateSession()
      },
      
      clearProject: () => {
        set((state) => ({
          ...initialState,
          savedProjects: state.savedProjects, // Keep saved projects when clearing current project
          completedScreens: new Set(),
          currentScreen: 'upload',
          lastSessionDate: ''
        }))
      },
      
      // Saved projects management
      cleanupInvalidProjects: () => {
        const state = get()
        const validProjects = state.savedProjects.filter(project => {
          // Keep project if it has:
          // 1. Valid duration (> 0)
          // 2. At least one clip
          // 3. Valid file info
          const isValid =
            project.duration > 0 &&
            project.clipCount > 0 &&
            project.filename &&
            project.filename !== 'unknown.mp4'

          if (!isValid) {
            console.log('🗑️ Cleaning up invalid project:', {
              name: project.name,
              duration: project.duration,
              clipCount: project.clipCount,
              status: project.processingStatus
            })
          }

          return isValid
        })

        const removedCount = state.savedProjects.length - validProjects.length

        if (removedCount > 0) {
          console.log(`🧹 Removed ${removedCount} invalid projects from storage`)
          set({ savedProjects: validProjects })
        } else {
          console.log('✅ No invalid projects found in storage')
        }

        return removedCount
      },

      forceCleanupAllInvalid: () => {
        const state = get()
        console.log('🔥 FORCE CLEANUP: Starting aggressive cleanup of all invalid projects')
        console.log(`📊 Starting with ${state.savedProjects.length} projects`)
        
        // Log ALL projects to see what we're dealing with
        state.savedProjects.forEach((p, i) => {
          console.log(`Project ${i + 1}:`, {
            name: p.name,
            duration: p.duration,
            clipCount: p.clipCount,
            fileSize: p.fileSize,
            transcriptLength: p.transcriptLength,
            hasClips: p.clips?.length || 0,
            hasTranscript: p.fullTranscript?.length || 0,
            hasEpisode: !!p.episode
          })
        })

        // VERY strict filtering - only keep projects with REAL data
        const validProjects = state.savedProjects.filter(project => {
          const hasRealData = 
            project.duration > 0 &&
            project.clipCount > 0 &&
            project.clips && project.clips.length > 0 && // Must have actual clip objects
            project.fullTranscript && project.fullTranscript.length > 100 && // Must have real transcript
            project.episode && project.episode.filePath && // Must have episode with file path
            project.filename !== 'unknown.mp4'

          if (!hasRealData) {
            console.log('❌ REMOVING:', {
              name: project.name,
              reason: !project.clips || project.clips.length === 0 ? 'No clips array' :
                      !project.fullTranscript || project.fullTranscript.length < 100 ? 'No transcript' :
                      !project.episode || !project.episode.filePath ? 'No episode data' :
                      'Other validation failed'
            })
          } else {
            console.log('✅ KEEPING:', project.name)
          }

          return hasRealData
        })

        const removedCount = state.savedProjects.length - validProjects.length
        console.log(`🧹 FORCE CLEANUP: Removed ${removedCount} projects, kept ${validProjects.length}`)
        
        set({ savedProjects: validProjects })
        return removedCount
      },

      syncWithDatabase: async () => {
        try {
          console.log('🔄 Syncing project store with database...')
          
          if (!window.electronAPI?.getRecentProjects) {
            console.warn('⚠️ Database API not available, skipping sync')
            return
          }

          // Fetch fresh data from database
          const dbProjects = await window.electronAPI.getRecentProjects()
          console.log(`📊 Fetched ${dbProjects?.length || 0} projects from database`)

          if (!dbProjects || dbProjects.length === 0) {
            console.log('✅ No projects in database, cleaning store')
            set({ savedProjects: [] })
            return
          }

          // Convert database projects to SavedProject format
          const validProjects: SavedProject[] = dbProjects
            .filter((dbProject: any) => {
              // Only include projects with clips AND valid episode data (filter out partials)
              const hasClips = (dbProject.clip_count || dbProject.clipCount || 0) > 0
              const hasDuration = (dbProject.duration || 0) > 0
              const hasEpisodeId = !!(dbProject.episode_id)
              const hasFilePath = !!(dbProject.file_path)
              
              // Debug logging for ALL projects from database
              console.log('📊 DB Project:', {
                name: dbProject.name,
                id: dbProject.id,
                episode_id: dbProject.episode_id,
                clip_count: dbProject.clip_count,
                duration: dbProject.duration,
                file_name: dbProject.file_name,
                file_path: dbProject.file_path,
                hasClips,
                hasDuration,
                hasEpisodeId,
                hasFilePath,
                willKeep: hasClips && hasDuration && hasEpisodeId && hasFilePath
              })
              
              // Debug logging for filtering
              if (!hasClips || !hasDuration || !hasEpisodeId || !hasFilePath) {
                console.log('🚫 Filtering out invalid project:', {
                  name: dbProject.name,
                  reason: !hasClips ? 'No clips' :
                          !hasDuration ? 'No duration' :
                          !hasEpisodeId ? 'No episode_id' :
                          'No file_path'
                })
              }
              
              return hasClips && hasDuration && hasEpisodeId && hasFilePath
            })
            .map((dbProject: any) => ({
              id: dbProject.episode_id || dbProject.id,
              name: dbProject.name || 'Untitled Project',
              filename: dbProject.file_name || dbProject.filename || 'unknown.mp4',
              dateCreated: dbProject.created_at || dbProject.createdAt || new Date().toISOString(),
              lastModified: dbProject.updated_at || dbProject.updatedAt || new Date().toISOString(),
              clipCount: dbProject.clip_count || dbProject.clipCount || 0,
              duration: dbProject.duration || 0,
              transcriptLength: 0,
              processingStatus: ((dbProject.clip_count || 0) > 0 ? 'completed' : 'partial') as 'completed' | 'partial',
              fileSize: 0, // Note: fileSize not stored in DB, populated from store if available
              thumbnailPath: dbProject.thumbnail_path || dbProject.thumbnailPath || undefined,
              episode: {
                id: dbProject.episode_id || dbProject.id,
                projectId: dbProject.id,
                fileName: dbProject.file_name || dbProject.filename || 'unknown.mp4',
                filePath: dbProject.file_path || dbProject.filePath || '',
                duration: dbProject.duration || 0,
                processingStatus: dbProject.processing_status || dbProject.processingStatus || 'completed',
                createdAt: dbProject.created_at || dbProject.createdAt || new Date().toISOString()
              },
              clips: [],
              transcriptSegments: [],
              fullTranscript: ''
            }))

          console.log(`✅ Validated ${validProjects.length} projects from database`)
          
          // Merge with existing store data (prefer DB data for projects that exist in both)
          const state = get()
          const storeProjectsMap = new Map(state.savedProjects.map(p => [p.id, p]))
          const mergedProjects: SavedProject[] = []

          // Add/update from database
          validProjects.forEach(dbProject => {
            const storeProject = storeProjectsMap.get(dbProject.id)
            if (storeProject) {
              // Merge: prefer store data for richer content (clips, transcripts)
              mergedProjects.push({
                ...dbProject,
                clips: storeProject.clips.length > 0 ? storeProject.clips : dbProject.clips,
                transcriptSegments: storeProject.transcriptSegments.length > 0 ? storeProject.transcriptSegments : dbProject.transcriptSegments,
                fullTranscript: storeProject.fullTranscript || dbProject.fullTranscript,
                transcriptLength: storeProject.transcriptLength || dbProject.transcriptLength
              })
              storeProjectsMap.delete(dbProject.id)
            } else {
              mergedProjects.push(dbProject)
            }
          })

          // Add remaining store projects (not in DB) if they're valid
          // Be stricter: only keep store-only projects if they have meaningful data
          storeProjectsMap.forEach(storeProject => {
            const isValid = 
              storeProject.duration > 0 && 
              storeProject.clipCount > 0 &&
              storeProject.fileSize > 0 && // Must have actual file size
              storeProject.fullTranscript.length > 0 // Must have transcript data
            
            if (isValid) {
              console.log('✅ Keeping store-only project:', storeProject.name)
              mergedProjects.push(storeProject)
            } else {
              console.log('🗑️ Discarding store-only project (incomplete):', {
                name: storeProject.name,
                duration: storeProject.duration,
                clipCount: storeProject.clipCount,
                fileSize: storeProject.fileSize,
                hasTranscript: storeProject.fullTranscript.length > 0
              })
            }
          })

          console.log(`💾 Saving ${mergedProjects.length} merged projects to store`)
          set({ savedProjects: mergedProjects })
          
          // Run cleanup to remove any remaining invalid projects
          get().cleanupInvalidProjects()
          
          console.log('✅ Database sync completed successfully')
        } catch (error) {
          console.error('❌ Failed to sync with database:', error)
          // Don't throw - just log and continue with existing data
        }
      },

      saveCurrentProject: (name) => {
        const state = get()

        console.log('🔥 SAVE PROJECT CALLED:', {
          name,
          currentEpisode: state.currentEpisode?.id,
          fileInfo: !!state.fileInfo,
          clipCount: state.clips.length,
          duration: state.fileInfo?.duration,
          stackTrace: new Error().stack?.split('\n').slice(1, 4).join('\n')
        })

        if (!state.currentEpisode || !state.fileInfo) {
          throw new Error('No active project to save')
        }

        // Prevent saving invalid projects (failed/incomplete processing)
        if (state.clips.length === 0 && state.fileInfo.duration === 0) {
          console.warn('⚠️ Refusing to save invalid project: 0 clips and 0 duration')
          throw new Error('Cannot save project with no clips and no duration')
        }

        // Prevent saving if we have no meaningful data
        if (state.clips.length === 0 && state.fullTranscript.length === 0) {
          console.warn('⚠️ Refusing to save invalid project: no clips and no transcript')
          throw new Error('Cannot save project with no content')
        }
        
        const projectName = name || state.fileInfo.name.replace(/\.[^/.]+$/, '') // Remove file extension
        const savedProject: SavedProject = {
          id: state.currentEpisode.id,
          name: projectName,
          filename: state.fileInfo.name,
          dateCreated: state.fileInfo.uploadDate,
          lastModified: new Date().toISOString(),
          clipCount: state.clips.length,
          duration: state.fileInfo.duration,
          transcriptLength: state.fullTranscript.length,
          processingStatus: state.clips.length > 0 ? 'completed' : 'partial',
          fileSize: state.fileInfo.size,
          episode: state.currentEpisode,
          clips: state.clips,
          transcriptSegments: state.transcriptSegments,
          fullTranscript: state.fullTranscript
        }
        
        set((prevState) => {
          const existingIndex = prevState.savedProjects.findIndex(p => p.id === savedProject.id)
          const isUpdate = existingIndex >= 0
          const updatedProjects = isUpdate
            ? prevState.savedProjects.map((p, i) => i === existingIndex ? savedProject : p)
            : [...prevState.savedProjects, savedProject]
            
          console.log('📦 PROJECT STORE UPDATE:', {
            action: isUpdate ? 'UPDATE' : 'ADD',
            projectId: savedProject.id,
            projectName: savedProject.name,
            totalProjects: updatedProjects.length,
            previousCount: prevState.savedProjects.length
          })
          
          return { savedProjects: updatedProjects }
        })
        
        get().updateSession()
        return savedProject
      },
      
      loadProject: (projectId) => {
        const state = get()
        const savedProject = state.savedProjects.find(p => p.id === projectId)
        
        if (!savedProject) {
          throw new Error('Project not found')
        }
        
        // Load all project data into current state
        set({
          currentProject: { 
            id: savedProject.id, 
            name: savedProject.name, 
            createdAt: savedProject.dateCreated, 
            updatedAt: savedProject.lastModified 
          },
          currentEpisode: savedProject.episode,
          transcriptSegments: savedProject.transcriptSegments,
          fullTranscript: savedProject.fullTranscript,
          clips: savedProject.clips.map(normalizeClipForState),
          clipsMetadata: {
            generationDate: savedProject.dateCreated,
            totalClips: savedProject.clipCount,
            approvedCount: savedProject.clips.filter((clip) => isClipApproved(clip.status)).length,
            rejectedCount: savedProject.clips.filter((clip) => isClipRejected(clip.status)).length
          },
          fileInfo: {
            name: savedProject.filename,
            path: '', // File path may not be valid anymore
            size: savedProject.fileSize,
            duration: savedProject.duration,
            uploadDate: savedProject.dateCreated
          },
          processingStatus: 'completed',
          completedScreens: new Set(['upload', 'review']), // Mark as ready for review
          currentScreen: 'review'
        })
        
        get().updateSession()
      },
      
      deleteProject: async (projectId) => {
        // Delete from database first (cascades to episodes, clips, transcripts)
        try {
          await window.electronAPI?.deleteProject(projectId);
          console.log(`✅ Deleted project ${projectId} from database`);
        } catch (error) {
          console.error(`❌ Failed to delete project ${projectId} from database:`, error);
          // Continue anyway to clean up store
        }
        
        // Then remove from store
        set((state) => ({
          savedProjects: state.savedProjects.filter(
            (p) => p.id !== projectId && p.episode.projectId !== projectId
          )
        }))
        get().updateSession()
      },
      
      getSavedProjects: () => {
        return get().savedProjects
      },
      
      getSavedProject: (projectId) => {
        return get().savedProjects.find(p => p.id === projectId)
      },
      
      // Transcription data management
      setTranscriptSegments: (segments) => {
        set({ transcriptSegments: segments })
        get().updateSession()
      },
      
      setFullTranscript: (transcript) => {
        set({ fullTranscript: transcript })
        get().updateSession()
      },
      
      addTranscriptSegment: (segment) => {
        set((state) => ({
          transcriptSegments: [...state.transcriptSegments, segment]
        }))
        get().updateSession()
      },
      
      // Clips management
      setClips: (clips) => {
        const normalizedClips = clips.map(normalizeClipForState)
        const metadata = buildClipMetadata(normalizedClips)
        set({ clips: normalizedClips, clipsMetadata: metadata })
        get().updateSession()
      },
      
      updateClip: (clipId, updates) => {
        set((state) => {
          const updatedClips = state.clips.map(clip =>
            clip.id === clipId ? normalizeClipForState({ ...clip, ...updates }) : clip
          )
          const metadata = {
            ...state.clipsMetadata,
            approvedCount: updatedClips.filter((clip) => isClipApproved(clip.status)).length,
            rejectedCount: updatedClips.filter((clip) => isClipRejected(clip.status)).length
          }
          return { clips: updatedClips, clipsMetadata: metadata }
        })
        get().updateSession()
      },
      
      updateClipStatus: (clipId, status) => {
        get().updateClip(clipId, { status })
      },
      
      addClip: (clip) => {
        set((state) => {
          const updatedClips = [...state.clips, normalizeClipForState(clip)]
          const metadata = {
            generationDate: state.clipsMetadata.generationDate || new Date().toISOString(),
            totalClips: updatedClips.length,
            approvedCount: updatedClips.filter((clip) => isClipApproved(clip.status)).length,
            rejectedCount: updatedClips.filter((clip) => isClipRejected(clip.status)).length
          }
          return { clips: updatedClips, clipsMetadata: metadata }
        })
        get().updateSession()
      },
      
      removeClip: (clipId) => {
        set((state) => {
          const updatedClips = state.clips.filter(clip => clip.id !== clipId)
          const metadata = {
            ...state.clipsMetadata,
            totalClips: updatedClips.length,
            approvedCount: updatedClips.filter((clip) => isClipApproved(clip.status)).length,
            rejectedCount: updatedClips.filter((clip) => isClipRejected(clip.status)).length
          }
          return { clips: updatedClips, clipsMetadata: metadata }
        })
        get().updateSession()
      },
      
      // File information
      setFileInfo: (info) => {
        set({ fileInfo: info })
        get().updateSession()
      },
      
      // Processing status
      setProcessingStatus: (status) => {
        set({ 
          processingStatus: status,
          lastProcessingUpdate: new Date().toISOString()
        })
      },
      
      setProcessingProgress: (progress) => {
        set({ 
          processingProgress: progress,
          lastProcessingUpdate: new Date().toISOString()
        })
      },
      
      updateProcessingState: (update) => {
        set({
          ...update,
          lastProcessingUpdate: new Date().toISOString()
        })
      },
      
      // Screen completion tracking
      markScreenCompleted: (screen) => {
        console.log('Marking screen as completed:', screen)
        set((state) => {
          const newCompletedScreens = new Set(state.completedScreens)
          newCompletedScreens.add(screen)
          console.log('Updated completed screens:', Array.from(newCompletedScreens))
          return { completedScreens: newCompletedScreens }
        })
        get().updateSession()
      },
      
      markScreenIncomplete: (screen) => {
        set((state) => {
          const newCompletedScreens = new Set(state.completedScreens)
          newCompletedScreens.delete(screen)
          return { completedScreens: newCompletedScreens }
        })
        get().updateSession()
      },
      
      setCurrentScreen: (screen) => {
        set({ currentScreen: screen })
        get().updateSession()
      },
      
      isScreenCompleted: (screen) => {
        return get().completedScreens.has(screen)
      },
      
      canAccessScreen: (screen) => {
        const state = get()
        const screenConfig = SCREEN_FLOW[screen as keyof typeof SCREEN_FLOW]
        
        console.log('Checking access for screen:', screen, {
          screenConfig,
          completedScreens: Array.from(state.completedScreens),
          isCompleted: state.completedScreens.has(screen)
        })
        
        if (!screenConfig) return false
        if (screen === 'upload' || screen === 'settings' || screen === 'library') return true
        
        // Allow access to any completed screen (backward navigation)
        if (state.completedScreens.has(screen)) {
          console.log('Screen accessible (completed):', screen)
          return true
        }
        
        // EMERGENCY BYPASS: If we have transcript data but no clips (AI failed), 
        // allow access to review screen so users aren't stuck
        if (screen === 'review' && state.fullTranscript && state.fileInfo) {
          console.log('Emergency bypass: Review accessible due to transcript completion')
          return true
        }
        
        // EMERGENCY BYPASS: If we have any project data, allow content and export access
        if ((screen === 'content' || screen === 'export') && state.currentEpisode && state.fileInfo) {
          console.log('Emergency bypass: Screen accessible due to episode data')
          return true
        }
        
        // For incomplete screens, check if all required screens are completed (forward navigation)
        const canAccess = screenConfig.requires.every(requiredScreen => 
          state.completedScreens.has(requiredScreen)
        )
        
        console.log('Screen access check result:', screen, canAccess, {
          requires: screenConfig.requires,
          completedRequirements: screenConfig.requires.map(req => ({ 
            screen: req, 
            completed: state.completedScreens.has(req) 
          }))
        })
        
        return canAccess
      },
      
      // Workflow data management
      setWorkflowData: (key, data) => {
        set((state) => ({
          workflowData: { ...state.workflowData, [key]: data }
        }))
        get().updateSession()
      },
      
      getWorkflowData: (key) => {
        return get().workflowData[key]
      },
      
      // Session management
      updateSession: () => {
        set({ lastSessionDate: new Date().toISOString() })
      },
      
      isValidSession: () => {
        const state = get()
        const lastSession = state.lastSessionDate
        if (!lastSession) return false
        
        // Consider session valid if less than 24 hours old
        const sessionAge = Date.now() - new Date(lastSession).getTime()
        return sessionAge < 24 * 60 * 60 * 1000
      },
      
      // Computed getters
      getApprovedClips: () => {
        return get().clips.filter((clip) => isClipApproved(clip.status))
      },
      
      getRejectedClips: () => {
        return get().clips.filter((clip) => isClipRejected(clip.status))
      },
      
      getPendingClips: () => {
        return get().clips.filter((clip) => isClipPendingReview(clip.status))
      },
      
      getClipsByContentType: (contentType) => {
        return get().clips.filter(clip => clip.contentType === contentType)
      },
      
      // State validation and recovery
      validateState: () => {
        const state = get()
        
        console.log('Validating project state:', {
          hasEpisode: !!state.currentEpisode,
          clipCount: state.clips.length,
          transcriptLength: state.fullTranscript.length,
          hasFileInfo: !!state.fileInfo,
          processingStatus: state.processingStatus,
          completedScreens: Array.from(state.completedScreens)
        })
        
        let isValid = true
        
        // Check 1: If we have clips but no episode, try to reconstruct
        if (state.clips.length > 0 && !state.currentEpisode) {
          console.log('State validation: Missing episode with clips, attempting repair...')
          if (state.fileInfo) {
            const reconstructedEpisode = buildRecoveredEpisode(state.fileInfo)
            set({ currentEpisode: reconstructedEpisode })
            console.log('State validation: Reconstructed episode from file info')
          } else {
            console.log('State validation: Cannot repair - no file info available')
            isValid = false
          }
        }
        
        // Check 2: If we have transcript but no episode, try to reconstruct
        if (state.fullTranscript.length > 0 && !state.currentEpisode && state.fileInfo) {
          console.log('State validation: Missing episode with transcript, reconstructing...')
          const reconstructedEpisode = buildRecoveredEpisode(state.fileInfo)
          set({ currentEpisode: reconstructedEpisode })
          console.log('State validation: Reconstructed episode for transcript')
        }
        
        return isValid
      },
      
      // Session recovery from incomplete states
      recoverSession: () => {
        const state = get()
        console.log('Attempting session recovery...')
        
        // Recovery scenario: Have file info but lost episode
        if (state.fileInfo && !state.currentEpisode) {
          const recoveredEpisode = buildRecoveredEpisode(state.fileInfo)
          set({ currentEpisode: recoveredEpisode })
          console.log('Session recovery: Restored episode from file info')
        }
        
        console.log('Session recovery completed')
      },
      
      // EMERGENCY: Reset session if user gets stuck
      emergencyReset: () => {
        console.log('EMERGENCY RESET: Clearing stuck session state')
        set((state) => ({
          ...initialState,
          savedProjects: state.savedProjects, // Preserve saved projects
          completedScreens: new Set(['upload', 'library']), // Allow basic navigation
          currentScreen: 'upload'
        }))
      },
      
      // EMERGENCY: Force unlock all screens for stuck users
      emergencyUnlockAll: () => {
        console.log('EMERGENCY UNLOCK: Enabling all screen access')
        set(() => ({
          completedScreens: new Set(['upload', 'review', 'content', 'export', 'library'])
        }))
      },
      
      resetToScreen: (screen) => {
        const state = get()
        const newCompletedScreens = new Set<string>()
        
        // Keep only screens that come before the target screen
        const screenOrder = ['upload', 'processing', 'review', 'content', 'export']
        const targetIndex = screenOrder.indexOf(screen)
        
        if (targetIndex >= 0) {
          for (let i = 0; i < targetIndex; i++) {
            if (state.completedScreens.has(screenOrder[i])) {
              newCompletedScreens.add(screenOrder[i])
            }
          }
        }
        
        set({
          completedScreens: newCompletedScreens,
          currentScreen: screen
        })
        
        get().updateSession()
      }
    }),
    {
      name: 'ariadne-project-storage',
      storage: createJSONStorage(() => localStorage),
      // Custom serialization to handle Set objects
      serialize: (state) => {
        return JSON.stringify({
          ...state.state,
          completedScreens: Array.from(state.state.completedScreens ?? [])
        })
      },
      deserialize: (str) => {
        const parsed = JSON.parse(str)
        return {
          state: {
            ...parsed,
            completedScreens: new Set(parsed.completedScreens || [])
          },
          version: 0
        }
      },
      // Only persist essential data, not temporary processing state
      partialize: (state) => ({
        currentProject: state.currentProject,
        currentEpisode: state.currentEpisode,
        savedProjects: state.savedProjects,
        transcriptSegments: state.transcriptSegments,
        fullTranscript: state.fullTranscript,
        clips: state.clips,
        clipsMetadata: state.clipsMetadata,
        fileInfo: state.fileInfo,
        currentScreen: state.currentScreen,
        lastSessionDate: state.lastSessionDate
      }),
      version: 1
    }
  )
)

// Export utility hooks for common operations
export const useProjectData = () => {
  const { currentProject, currentEpisode, fileInfo } = useProjectStore()
  return { currentProject, currentEpisode, fileInfo }
}

export const useTranscriptionData = () => {
  const { transcriptSegments, fullTranscript } = useProjectStore()
  return { transcriptSegments, fullTranscript }
}

export const useClipsData = () => {
  const { 
    clips, 
    clipsMetadata, 
    getApprovedClips, 
    getRejectedClips, 
    getPendingClips,
    getClipsByContentType 
  } = useProjectStore()
  
  return { 
    clips, 
    clipsMetadata, 
    getApprovedClips, 
    getRejectedClips, 
    getPendingClips,
    getClipsByContentType 
  }
}

export const useScreenFlow = () => {
  const { 
    completedScreens, 
    currentScreen, 
    canAccessScreen, 
    isScreenCompleted,
    markScreenCompleted,
    markScreenIncomplete,
    setCurrentScreen
  } = useProjectStore()
  
  return { 
    completedScreens, 
    currentScreen, 
    canAccessScreen, 
    isScreenCompleted,
    markScreenCompleted,
    markScreenIncomplete,
    setCurrentScreen
  }
}
