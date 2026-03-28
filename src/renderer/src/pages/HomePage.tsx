import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IoAddCircleOutline, IoCloudUploadOutline, IoLinkOutline } from 'react-icons/io5'
import { useProcessingStore } from '../stores/processingStore'
import { useProjectStore, type SavedProject } from '../stores/projectStore'
import { TranscriptionProgress } from '../components/TranscriptionProgress'
import { MainContentPanel } from '../components/MainContentPanel'

const featureShortcuts = [
  'Long to shorts',
  'AI Captions',
  'Video editor',
  'Enhance speech',
  'AI Reframe',
  'AI B-Roll',
  'AI hook'
]

export function HomePage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const [sourceLink, setSourceLink] = useState('')
  const [recentProjects, setRecentProjects] = useState<SavedProject[]>([])
  const navigate = useNavigate()
  const { isProcessing, setProcessing, updateProgress, reset, setActiveJobId } = useProcessingStore()
  const { syncWithDatabase, getSavedProjects } = useProjectStore()

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

  return (
    <MainContentPanel>
      <div className="app-page">
        {isProcessing ? (
          <div className="flex h-full items-center justify-center">
            <TranscriptionProgress />
          </div>
        ) : (
          <div className="mx-auto flex h-full max-w-6xl flex-col gap-10">
            <div className="app-page-header">
              <div className="max-w-2xl">
                <div className="app-page-title">Home</div>
                <div className="app-page-subtitle">
                  Generate reels from a link or local file.
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button className="app-chip">Free Trial</button>
              </div>
            </div>

            <div className="mx-auto w-full max-w-xl">
              <div className="app-surface p-5">
                <div className="app-surface-muted flex items-center gap-3 px-4 py-3">
                  <IoLinkOutline className="text-text-muted" size={18} />
                  <input
                    value={sourceLink}
                    onChange={(e) => setSourceLink(e.target.value)}
                    placeholder="Drop a YouTube, Rumble, or podcast link"
                    className="flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted"
                  />
                </div>

                <div className="mt-4 flex items-center gap-6 px-2 text-sm text-text-secondary">
                  <button className="inline-flex items-center gap-2 hover:text-text-primary transition-colors">
                    <IoCloudUploadOutline size={16} />
                    Upload
                  </button>
                  <button className="inline-flex items-center gap-2 hover:text-text-primary transition-colors">
                    Google Drive
                  </button>
                </div>

                <button className="app-action-primary mt-5 w-full justify-center">Get clips in 1 click</button>

                <button className="mt-4 w-full text-center text-sm text-text-secondary underline underline-offset-4">
                  Click here to try a sample project
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-10 pt-2">
              {featureShortcuts.map((feature) => (
                <div key={feature} className="flex flex-col items-center gap-3">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border border-border-default bg-[#12151b] text-sm text-text-primary">
                    ✦
                  </div>
                  <div className="text-sm text-text-secondary">{feature}</div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4">
              <div className="text-sm text-text-muted">All projects ({recentProjects.length})</div>
              <div className="flex items-center gap-3 text-sm text-text-muted">
                <span>0 GB / 100 GB</span>
                <span className="app-chip !px-3 !py-2">Auto-save</span>
                <span className="app-chip !px-3 !py-2">Auto-import</span>
              </div>
            </div>

            <div
              className={`grid grid-cols-3 gap-5 pb-6 ${isDragOver ? 'opacity-70' : ''}`}
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
                  className="app-surface p-3 text-left hover:border-white/20 transition-colors"
                >
                  <div className="flex aspect-video items-end rounded-xl bg-[#171b22] p-3">
                    <div className="text-sm text-text-muted">Demo project</div>
                  </div>
                  <div className="mt-4 text-xl font-medium text-text-primary">
                    {project.name}
                  </div>
                  <div className="mt-2 text-sm text-text-secondary">{project.filename}</div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </MainContentPanel>
  )
}
