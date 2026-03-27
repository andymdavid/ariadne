import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProcessingStore } from '../stores/processingStore'
import { useProjectStore } from '../stores/projectStore'
import { TranscriptionProgress } from '../components/TranscriptionProgress'
import { MainContentPanel } from '../components/MainContentPanel'

export function HomePage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const navigate = useNavigate()
  const { isProcessing, setProcessing, updateProgress, reset, setActiveJobId } = useProcessingStore()
  // IPC listeners are now handled by useProcessingUpdates hook in App.tsx


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
    // Reset store and set initial state
    reset()
    setActiveJobId(undefined)
    setProcessing(true)
    updateProgress({
      stage: 'uploading',
      progress: 0,
      message: 'Starting processing...'
    })
    
    try {
      // Extract project name from file path
      const fileName = filePath.split('/').pop() || 'Unknown Episode'
      const projectName = fileName.split('.')[0]
      
      // Clean IPC-based processing without race conditions
      if (!window.electronAPI?.processEpisode) {
        throw new Error('Processing API not available')
      }
      
      // Set up completion handler before starting processing
      const processingCompletePromise = new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout
        
        // Set up completion listener
        const cleanup = window.electronAPI?.onProcessingComplete?.((data) => {
          console.log('Processing completed via IPC:', data)
          clearTimeout(timeoutId)
          cleanup?.() // Remove listener
          errorCleanup?.()
          resolve(data)
        })
        
        // Set up error listener  
        const errorCleanup = window.electronAPI?.onProcessingError?.((error) => {
          const errorMessage = typeof error === 'string' ? error : error.message
          console.error('Processing failed via IPC:', error)
          clearTimeout(timeoutId)
          cleanup?.()
          errorCleanup?.()
          reject(new Error(errorMessage))
        })
        
        // Timeout after 20 minutes (AI analysis can take longer for long episodes)
        timeoutId = setTimeout(() => {
          console.error('Processing timed out after 20 minutes')
          cleanup?.()
          errorCleanup?.()
          reject(new Error('Processing timed out after 20 minutes'))
        }, 20 * 60 * 1000)
      })
      
      const processRequest = window.electronAPI
        .processEpisode(filePath, projectName)
        .catch((startError) => {
          console.error('Failed to start processing:', startError)
          throw startError
        })

      console.log('Processing started, waiting for completion...')
      
      // Wait for completion via IPC events, but still surface immediate IPC invoke failures.
      const result = await Promise.race([processingCompletePromise, processRequest])
      
      console.log('Processing completed successfully:', result)
      
      // Navigation to review screen after processing completion
      // Wait briefly for auto-save to complete and set currentEpisode
      setTimeout(() => {
        const state = useProjectStore.getState()
        if (state.currentEpisode?.id) {
          console.log('Navigating to review screen for episode:', state.currentEpisode.id)
          navigate(`/review/${state.currentEpisode.id}`)
        } else {
          console.warn('No episode ID available for navigation after processing completion')
          // Fallback: try to get episode ID from processing result
          if (result && (result as any).episodeId) {
            console.log('Using episode ID from processing result:', (result as any).episodeId)
            navigate(`/review/${(result as any).episodeId}`)
          }
        }
      }, 1500) // Wait for auto-save to complete (1000ms + buffer)
      
      setProcessing(false)

    } catch (error) {
      console.error('Processing error:', error)
      updateProgress({
        stage: 'completed',
        progress: 0,
        message: `Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      })
      setProcessing(false)
    }
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)

    const files = Array.from(e.dataTransfer.files)
    const mediaFile = files.find(file =>
      file.type.startsWith('video/') || file.type.startsWith('audio/')
    )

    if (mediaFile) {
      // In Electron, we can get the file path from the File object
      const filePath = (mediaFile as any).path
      if (filePath) {
        startProcessing(filePath)
      } else {
        console.error('Could not get file path from dropped file')
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

  return (
    <MainContentPanel>
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-2xl w-full space-y-8 text-center">
          {/* Upload Area or Progress Display */}
          {isProcessing ? (
            <TranscriptionProgress />
          ) : (
            <div
              className={`
                border-2 border-dashed rounded-lg p-12 transition-all duration-200
                ${isDragOver 
                  ? 'border-accent-primary bg-accent-primary/5' 
                  : 'border-border-default hover:border-accent-primary/50 hover:bg-accent-primary/5'
                }
              `}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="space-y-4">
                <div className="text-6xl text-text-muted">📎</div>
                <div className="space-y-2">
                  <p className="text-lg font-medium text-text-primary">
                    Drop your podcast file here
                  </p>
                  <p className="text-text-muted">
                    or click to browse
                  </p>
                </div>
                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleFileSelect}
                    className="btn-primary"
                  >
                    Select File
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </MainContentPanel>
  )
}
