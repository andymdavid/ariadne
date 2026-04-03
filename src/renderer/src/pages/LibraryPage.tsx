import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MainContentPanel } from '../components/MainContentPanel'
import { useProjectStore, SavedProject } from '../stores/projectStore'
import { IoPlay, IoTrash, IoCheckmarkCircle, IoWarning, IoRefresh, IoTrashBin } from 'react-icons/io5'

export function LibraryPage() {
  const navigate = useNavigate()
  const { getSavedProjects, loadProject, deleteProject, saveCurrentProject, syncWithDatabase, forceCleanupAllInvalid, currentEpisode, clips, fileInfo } = useProjectStore()
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([])
  const [selectedProject, setSelectedProject] = useState<SavedProject | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Load saved projects from multiple sources on mount
  useEffect(() => {
    const loadProjects = async () => {
      setIsRefreshing(true)
      try {
        // Sync with database first (this is now the primary source of truth)
        await syncWithDatabase()
        
        // Get updated projects from store after sync
        const projects = getSavedProjects()
        console.log('🔍 LIBRARY LOAD: After sync, store has', projects.length, 'projects')
        
        // Sort and update state
        const sortedProjects = projects.sort((a, b) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        )
        setSavedProjects(sortedProjects)
        
      } catch (error) {
        console.error('Library: Failed to load projects:', error)
        // Fallback to just project store data
        const fallbackProjects = getSavedProjects()
        setSavedProjects(fallbackProjects.sort((a, b) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        ))
      } finally {
        setIsRefreshing(false)
      }
    }
    
    loadProjects()
  }, [getSavedProjects, syncWithDatabase])

  // Listen for database cleanup events
  useEffect(() => {
    const cleanup = window.electronAPI?.onDatabaseCleaned?.((result: any) => {
      console.log('🗑️ Database cleaned, refreshing library...', result)
      // Refresh the library after database cleanup
      syncWithDatabase().then(() => {
        const projects = getSavedProjects()
        setSavedProjects(projects.sort((a, b) => 
          new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
        ))
      })
    })

    return cleanup
  }, [syncWithDatabase, getSavedProjects])

  // Auto-save current project if it exists and has clips
  useEffect(() => {
    if (currentEpisode && clips.length > 0 && fileInfo) {
      try {
        saveCurrentProject()
        // Refresh the list to include the newly saved project
        const updatedProjects = getSavedProjects()
        setSavedProjects(updatedProjects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()))
      } catch (error) {
        console.log('No project to auto-save or already saved')
      }
    }
  }, [currentEpisode, clips, fileInfo, saveCurrentProject, getSavedProjects])

  // Manual refresh handler
  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await syncWithDatabase()
      const projects = getSavedProjects()
      setSavedProjects(projects.sort((a, b) => 
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      ))
    } catch (error) {
      console.error('Failed to refresh library:', error)
    } finally {
      setIsRefreshing(false)
    }
  }

  // Manual cleanup handler - removes partial projects from database AND store
  const handleCleanupDatabase = async () => {
    if (!window.confirm('This will remove all partial/incomplete projects from the database AND local storage.\n\nOnly projects with complete data (clips, transcripts, episodes) will be kept.\n\nContinue?')) {
      return
    }
    
    setIsRefreshing(true)
    try {
      console.log('🧹 Running database cleanup...')
      const dbResult = await window.electronAPI?.cleanupDatabase()
      console.log('✅ Database cleanup complete:', dbResult)
      
      // Force aggressive cleanup of store
      console.log('🔥 Running force cleanup on store...')
      const storeRemoved = forceCleanupAllInvalid()
      console.log(`✅ Store cleanup complete: removed ${storeRemoved} invalid projects`)
      
      // Refresh the display
      const projects = getSavedProjects()
      setSavedProjects(projects.sort((a, b) => 
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      ))
      
      alert(`Cleanup complete!\n\nDatabase:\n- ${dbResult.deletedProjects} empty projects\n- ${dbResult.deletedDuplicates || 0} duplicates\n- ${dbResult.deletedInvalidFiles || 0} projects with missing/invalid files\n- ${dbResult.deletedEpisodes} episodes\n- ${dbResult.deletedClips} clips\n\nStore: ${storeRemoved} invalid projects removed\n\nRemaining projects: ${projects.length}`)
    } catch (error) {
      console.error('Failed to cleanup:', error)
      alert('Failed to cleanup: ' + (error instanceof Error ? error.message : 'Unknown error'))
    } finally {
      setIsRefreshing(false)
    }
  }

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
  }

  // Format duration
  const formatDuration = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return '0:00'
    const hours = Math.floor(seconds / 3600)
    const mins = Math.floor((seconds % 3600) / 60)
    const secs = Math.floor(seconds % 60)
    
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Format date
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Handle project loading
  const handleLoadProject = (project: SavedProject) => {
    try {
      loadProject(project.id)
      navigate(`/review/${project.id}`)
    } catch (error) {
      console.error('Failed to load project:', error)
    }
  }

  // Handle project deletion
  const handleDeleteProject = async (projectId: string) => {
    try {
      await deleteProject(projectId)
      setSavedProjects(prev => prev.filter(p => p.id !== projectId))
      setSelectedProject(null)
      setShowDeleteConfirm(null)
      console.log(`✅ Project ${projectId} deleted from database and store`)
    } catch (error) {
      console.error('Failed to delete project:', error)
      alert('Failed to delete project: ' + (error as Error).message)
    }
  }

  // Get status info for project
  const getProjectStatus = (project: SavedProject) => {
    const approvedCount = project.clips.filter(c => c.status === 'approved').length
    const rejectedCount = project.clips.filter(c => c.status === 'rejected').length
    const pendingCount = project.clips.filter(c => c.status === 'pending').length
    
    return { approvedCount, rejectedCount, pendingCount }
  }

  if (savedProjects.length === 0) {
    return (
      <MainContentPanel>
        <div className="app-page flex items-center justify-center">
          <div className="max-w-2xl w-full space-y-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl text-text-muted">📚</div>
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-text-primary">
                  Project Library
                </h1>
                <p className="text-text-muted">
                  Your processed podcasts and clips will appear here
                </p>
              </div>
              <div className="text-sm text-text-muted mt-8">
                Complete a podcast transcription to see your first saved project
              </div>
            </div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel>
      <div className="app-page flex h-full flex-col overflow-hidden">
        <div className="app-page-header">
          <div className="app-page-header-shell">
            <div className="app-page-header-content">
              <div className="app-page-title">Library</div>
              <div className="app-page-subtitle">
                Browse saved projects, inspect their clip breakdown, and manage stored work.
              </div>
            </div>
          </div>
        </div>

        <div className="app-page-content-shell flex min-h-0 flex-1 overflow-hidden py-5">
        {/* Projects List */}
        <div className="w-80 flex-shrink-0 overflow-y-auto border-r border-border-default pr-5">
          <div className="app-section-shell space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-text-primary">
              Saved Projects
            </h2>
            <div className="flex items-center space-x-2">
              <button 
                onClick={handleCleanupDatabase}
                disabled={isRefreshing}
                className="app-icon-button disabled:opacity-50"
                title="Cleanup Database (remove invalid/duplicates)"
              >
                <IoTrashBin className="w-4 h-4 text-text-muted" />
              </button>
              <button 
                onClick={async () => {
                  if (!window.confirm('This will DELETE ALL PROJECTS from the database! This cannot be undone. Continue?')) return;
                  setIsRefreshing(true);
                  try {
                    await window.electronAPI?.nukeAllProjects();
                    await syncWithDatabase();
                    const projects = getSavedProjects();
                    setSavedProjects(projects);
                    alert('All projects nuked! Database is now empty.');
                  } catch (error) {
                    alert('Failed to nuke: ' + (error as Error).message);
                  } finally {
                    setIsRefreshing(false);
                  }
                }}
                className="app-icon-button library-toolbar-button-danger"
                title="Nuke ALL Projects (danger!)"
              >
                <IoTrash className="w-4 h-4 text-text-muted" />
              </button>
              <button 
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="app-icon-button disabled:opacity-50"
                title="Refresh library"
              >
                <IoRefresh className={`w-4 h-4 text-text-muted ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
              <span className="text-sm text-text-muted">
                {savedProjects.length} project{savedProjects.length !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {savedProjects.map((project) => {
            const status = getProjectStatus(project)
            const isSelected = selectedProject?.id === project.id
            
            return (
              <div
                key={project.id}
                className={`app-surface library-project-card p-4 space-y-3 cursor-pointer ${
                  isSelected ? 'library-project-card-selected' : ''
                }`}
                onClick={() => setSelectedProject(project)}
              >
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className={`text-xs font-medium uppercase tracking-wide ${
                      project.processingStatus === 'completed' ? 'text-accent-success' : 'text-accent-warning'
                    }`}>
                      {project.processingStatus}
                    </span>
                    <span className="text-text-muted">•</span>
                    <span className="text-sm text-text-muted">
                      {project.clipCount} clips
                    </span>
                  </div>
                  <div className="flex space-x-1">
                    {project.processingStatus === 'completed' && (
                      <IoCheckmarkCircle className="w-4 h-4 text-accent-success" />
                    )}
                    {project.processingStatus === 'partial' && (
                      <IoWarning className="w-4 h-4 text-accent-warning" />
                    )}
                  </div>
                </div>

                {/* Project name */}
                <h3 className="text-text-primary font-medium leading-tight truncate">
                  {project.name}
                </h3>

                {/* Metadata */}
                <div className="space-y-1 text-sm text-text-muted">
                  <div className="flex items-center justify-between">
                    <span>Duration: {formatDuration(project.duration)}</span>
                    <span>{formatFileSize(project.fileSize)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Modified: {formatDate(project.lastModified)}</span>
                  </div>
                  {status.approvedCount > 0 && (
                    <div className="text-accent-success text-xs">
                      ✓ {status.approvedCount} approved clips
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          </div>
        </div>

        {/* Project Details */}
        <div className="flex flex-1 flex-col overflow-hidden pl-5">
          {selectedProject ? (
            <div className="app-section-shell flex-1 overflow-y-auto">
              <div className="space-y-6">
                {/* Project Header */}
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-semibold text-text-primary">
                      {selectedProject.name}
                    </h3>
                    <p className="text-text-muted mt-1">
                      {selectedProject.filename}
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className="library-status-pill">
                      {selectedProject.processingStatus}
                    </span>
                  </div>
                </div>

                {/* Project Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="app-surface p-4 text-center">
                    <div className="text-2xl font-semibold text-text-primary">
                      {selectedProject.clipCount}
                    </div>
                    <div className="text-sm text-text-muted">Total Clips</div>
                  </div>
                  <div className="app-surface p-4 text-center">
                    <div className="text-2xl font-semibold text-accent-success">
                      {getProjectStatus(selectedProject).approvedCount}
                    </div>
                    <div className="text-sm text-text-muted">Approved</div>
                  </div>
                  <div className="app-surface p-4 text-center">
                    <div className="text-2xl font-semibold text-text-primary">
                      {formatDuration(selectedProject.duration)}
                    </div>
                    <div className="text-sm text-text-muted">Duration</div>
                  </div>
                  <div className="app-surface p-4 text-center">
                    <div className="text-2xl font-semibold text-text-primary">
                      {Math.round(selectedProject.transcriptLength / 1000)}K
                    </div>
                    <div className="text-sm text-text-muted">Words</div>
                  </div>
                </div>

                {/* Project Details */}
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Created</label>
                    <div className="mt-1 text-text-primary">{formatDate(selectedProject.dateCreated)}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-secondary">Last Modified</label>
                    <div className="mt-1 text-text-primary">{formatDate(selectedProject.lastModified)}</div>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text-secondary">File Size</label>
                    <div className="mt-1 text-text-primary">{formatFileSize(selectedProject.fileSize)}</div>
                  </div>
                </div>

                {/* Clip Summary */}
                {selectedProject.clips.length > 0 && (
                  <div>
                    <label className="text-sm font-medium text-text-secondary mb-3 block">Clip Breakdown</label>
                    <div className="space-y-2">
                      {Object.entries(
                        selectedProject.clips.reduce((acc, clip) => {
                          acc[clip.contentType] = (acc[clip.contentType] || 0) + 1
                          return acc
                        }, {} as Record<string, number>)
                      ).map(([type, count]) => (
                        <div key={type} className="flex items-center justify-between text-sm">
                          <span className="text-text-primary capitalize">{type}</span>
                          <span className="text-text-muted">{count} clip{count !== 1 ? 's' : ''}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex space-x-4 pt-4">
                  <button 
                    className="btn-primary"
                    onClick={() => handleLoadProject(selectedProject)}
                  >
                    <IoPlay size={16} />
                    <span>Open Project</span>
                  </button>
                  <button 
                    className="btn-secondary"
                    onClick={() => setShowDeleteConfirm(selectedProject.id)}
                  >
                    <IoTrash size={16} />
                    <span>Delete</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="app-section-shell flex h-full items-center justify-center">
              <div className="text-center space-y-4">
                <div className="text-6xl text-text-muted">📁</div>
                <h3 className="text-xl font-semibold text-text-primary">
                  Select a project to view details
                </h3>
                <p className="text-text-muted max-w-md">
                  Choose a project from the sidebar to see its transcription, clips, and metadata.
                </p>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="app-surface max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              Delete Project
            </h3>
            
            <p className="text-text-muted mb-6">
              Are you sure you want to delete this project? This action cannot be undone.
            </p>
            
            <div className="flex space-x-3">
              <button
                onClick={() => handleDeleteProject(showDeleteConfirm)}
                className="btn-secondary flex-1"
              >
                Delete Project
              </button>
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </MainContentPanel>
  )
}
