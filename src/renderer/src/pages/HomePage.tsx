import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IoAddCircleOutline, IoCloudUploadOutline, IoClose, IoLinkOutline } from 'react-icons/io5'
import { useProcessingStore } from '../stores/processingStore'
import { useProjectStore, type SavedProject } from '../stores/projectStore'
import { TranscriptionProgress } from '../components/TranscriptionProgress'
import { MainContentPanel } from '../components/MainContentPanel'

function ProjectCardPreview({ project }: { project: SavedProject }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (project.thumbnailPath || !project.episode.filePath || !videoRef.current) {
      return
    }

    const video = videoRef.current
    const handleLoadedMetadata = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        return
      }
      video.currentTime = Math.min(Math.max(video.duration * 0.1, 0.1), 1)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
    }
  }, [project.episode.filePath, project.thumbnailPath])

  if (project.thumbnailPath) {
    return (
      <img
        src={`app-file://${project.thumbnailPath}`}
        alt={project.name}
        className="h-full w-full object-cover"
      />
    )
  }

  if (project.episode.filePath) {
    return (
      <video
        ref={videoRef}
        src={`app-file://${project.episode.filePath}`}
        muted
        playsInline
        preload="metadata"
        className="h-full w-full object-cover"
      />
    )
  }

  return (
    <div className="flex h-full w-full items-end p-3">
      <div className="text-sm text-text-muted">Demo project</div>
    </div>
  )
}

export function HomePage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [sourceLink, setSourceLink] = useState('')
  const [sourceError, setSourceError] = useState('')
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null)
  const [recentProjects, setRecentProjects] = useState<SavedProject[]>([])
  const navigate = useNavigate()
  const { isProcessing, setProcessing, updateProgress, reset, setActiveJobId } = useProcessingStore()
  const { syncWithDatabase, getSavedProjects, deleteProject } = useProjectStore()

  useEffect(() => {
    const loadProjects = async () => {
      try {
        await syncWithDatabase()
      } catch (error) {
        console.error('Failed to sync recent projects:', error)
      }

      const projects = getSavedProjects()
        .slice()
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
        .slice(0, 6)

      setRecentProjects(projects)
    }

    loadProjects()
  }, [getSavedProjects, syncWithDatabase])

  const handleFileSelect = async () => {
    try {
      const filePath = await window.electronAPI?.selectFile()
      if (filePath) {
        startProcessing(filePath)
      }
    } catch (error) {
      console.error('Error selecting file:', error)
    }
  }

  const startProcessing = async (filePath: string) => {
    setSourceError('')
    reset()
    setActiveJobId(undefined)
    setProcessing(true)
    updateProgress({
      stage: 'uploading',
      progress: 0,
      message: 'Starting processing...'
    })

    try {
      const fileName = filePath.split('/').pop() || 'Unknown Episode'
      const projectName = fileName.split('.')[0]

      if (!window.electronAPI?.processEpisode) {
        throw new Error('Processing API not available')
      }

      const processingCompletePromise = new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout

        const cleanup = window.electronAPI?.onProcessingComplete?.((data) => {
          clearTimeout(timeoutId)
          cleanup?.()
          errorCleanup?.()
          resolve(data)
        })

        const errorCleanup = window.electronAPI?.onProcessingError?.((error) => {
          const errorMessage = typeof error === 'string' ? error : error.message
          clearTimeout(timeoutId)
          cleanup?.()
          errorCleanup?.()
          reject(new Error(errorMessage))
        })

        timeoutId = setTimeout(() => {
          cleanup?.()
          errorCleanup?.()
          reject(new Error('Processing timed out after 20 minutes'))
        }, 20 * 60 * 1000)
      })

      const processRequest = window.electronAPI.processEpisode(filePath, projectName).catch((startError) => {
        throw startError
      })

      const result = await Promise.race([processingCompletePromise, processRequest])

      setTimeout(() => {
        const state = useProjectStore.getState()
        if (state.currentEpisode?.id) {
          navigate(`/review/${state.currentEpisode.id}`)
        } else if (result && (result as any).episodeId) {
          navigate(`/review/${(result as any).episodeId}`)
        }
      }, 1500)

      setProcessing(false)
    } catch (error) {
      console.error('Processing error:', error)
      updateProgress({
        stage: 'completed',
        progress: 0,
        message: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
      setProcessing(false)
    }
  }

  const startSourceProcessing = async (source: string) => {
    const trimmedSource = source.trim()
    if (!trimmedSource) {
      setSourceError('Paste a YouTube, Rumble, direct media, or Google Drive link, or use Upload.')
      return
    }

    setSourceError('')
    reset()
    setActiveJobId(undefined)
    setProcessing(true)
    updateProgress({
      stage: 'uploading',
      progress: 0,
      message: 'Starting processing...'
    })

    try {
      if (!window.electronAPI?.processSource) {
        throw new Error('Source processing API not available')
      }

      const processingCompletePromise = new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout

        const cleanup = window.electronAPI?.onProcessingComplete?.((data) => {
          clearTimeout(timeoutId)
          cleanup?.()
          errorCleanup?.()
          resolve(data)
        })

        const errorCleanup = window.electronAPI?.onProcessingError?.((error) => {
          const errorMessage = typeof error === 'string' ? error : error.message
          clearTimeout(timeoutId)
          cleanup?.()
          errorCleanup?.()
          reject(new Error(errorMessage))
        })

        timeoutId = setTimeout(() => {
          cleanup?.()
          errorCleanup?.()
          reject(new Error('Processing timed out after 20 minutes'))
        }, 20 * 60 * 1000)
      })

      const result = await Promise.race([
        processingCompletePromise,
        window.electronAPI.processSource(trimmedSource)
      ])

      setTimeout(() => {
        const state = useProjectStore.getState()
        if (state.currentEpisode?.id) {
          navigate(`/review/${state.currentEpisode.id}`)
        } else if (result && (result as any).episodeId) {
          navigate(`/review/${(result as any).episodeId}`)
        }
      }, 1500)

      setProcessing(false)
    } catch (error) {
      console.error('Processing error:', error)
      setSourceError(error instanceof Error ? error.message : 'Could not process that link.')
      updateProgress({
        stage: 'completed',
        progress: 0,
        message: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
      setProcessing(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const mediaFile = files.find((file) => file.type.startsWith('video/') || file.type.startsWith('audio/'))

    if (mediaFile) {
      const filePath = (mediaFile as any).path
      if (filePath) {
        startProcessing(filePath)
      }
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleOpenProject = (project: SavedProject) => {
    navigate(`/review/${project.id}`)
  }

  const handleDeleteProject = async (event: React.MouseEvent<HTMLButtonElement>, project: SavedProject) => {
    event.stopPropagation()

    const projectId = project.episode.projectId
    const confirmed = window.confirm(`Delete "${project.name}"?`)
    if (!confirmed) {
      return
    }

    try {
      setDeletingProjectId(projectId)
      await deleteProject(projectId)
      const updatedProjects = getSavedProjects()
        .slice()
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime())
        .slice(0, 6)
      setRecentProjects(updatedProjects)
    } finally {
      setDeletingProjectId(null)
    }
  }

  const handleGenerate = async () => {
    if (sourceLink.trim()) {
      await startSourceProcessing(sourceLink)
      return
    }

    await handleFileSelect()
  }

  return (
    <MainContentPanel>
      <div className="app-page">
        {isProcessing ? (
          <div className="flex h-full items-center justify-center">
            <TranscriptionProgress />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 pt-48 pb-10">
            <div className="mx-auto w-full max-w-xl">
              <div className="app-surface p-5">
                <div className="app-surface-muted flex items-center gap-3 px-4 py-3">
                  <IoLinkOutline className="text-text-muted" size={18} />
                  <input
                    value={sourceLink}
                    onChange={(e) => setSourceLink(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleGenerate()
                      }
                    }}
                    placeholder="Paste a YouTube, Rumble, direct media, or Google Drive link"
                    className="flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>

                <div className="mt-4 flex items-center gap-6 px-2 text-sm text-text-secondary">
                  <button
                    type="button"
                    onClick={handleFileSelect}
                    className="inline-flex items-center gap-2 hover:text-text-primary transition-colors"
                  >
                    <IoCloudUploadOutline size={16} />
                    Upload
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  className="app-action-primary mt-5 w-full justify-center"
                >
                  Get clips in 1 click
                </button>

                {sourceError ? (
                  <div className="mt-3 text-sm text-red-400">{sourceError}</div>
                ) : (
                  <div className="mt-3 text-sm text-text-muted">
                    YouTube, Rumble, direct media files, and Google Drive links.
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-text-muted">All projects ({recentProjects.length})</div>
            </div>

            <div
              className={`grid grid-cols-3 gap-5 ${isDragOver ? 'opacity-70' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <button
                type="button"
                onClick={handleFileSelect}
                className="app-surface-muted flex min-h-[190px] flex-col items-center justify-center border-dashed text-center hover:border-accent-primary hover:bg-accent-primary/5 transition-colors"
              >
                <IoAddCircleOutline size={28} className="text-text-muted" />
                <div className="mt-4 text-lg font-medium text-text-primary">Upload local file</div>
                <div className="mt-2 max-w-[220px] text-sm leading-relaxed text-text-secondary">
                  Start a new project from a local video or audio source.
                </div>
              </button>

              {recentProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => handleOpenProject(project)}
                  className="app-surface group relative flex h-full min-h-[320px] flex-col p-3 text-left hover:border-white/20 transition-colors"
                >
                  <button
                    type="button"
                    onClick={(event) => handleDeleteProject(event, project)}
                    disabled={deletingProjectId === project.episode.projectId}
                    className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/55 text-text-secondary opacity-0 transition hover:border-white/20 hover:text-text-primary group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-100"
                    aria-label={`Delete ${project.name}`}
                  >
                    <IoClose size={14} />
                  </button>
                  <div className="aspect-video w-full shrink-0 overflow-hidden rounded-xl bg-[#171b22]">
                    <ProjectCardPreview project={project} />
                  </div>
                  <div className="mt-4 line-clamp-2 min-h-[4.5rem] text-xl font-medium leading-tight text-text-primary">
                    {project.name}
                  </div>
                  <div className="mt-2 line-clamp-2 min-h-[2.75rem] text-sm leading-relaxed text-text-secondary">
                    {project.filename}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </MainContentPanel>
  )
}
