import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProcessingStore } from '../stores/processingStore'
import { TranscriptionProgress } from '../components/TranscriptionProgress'

export function HomePage() {
  const [isDragOver, setIsDragOver] = useState(false)
  const navigate = useNavigate()
  const { isProcessing, setProcessing, updateProgress, reset } = useProcessingStore()

  // Set up IPC listeners for processing updates
  useEffect(() => {
    if (!window.electronAPI) {
      console.warn('electronAPI not available')
      return
    }

    console.log('Setting up IPC listeners for processing updates')

    const cleanupUpdate = window.electronAPI.onProcessingUpdate((data) => {
      console.log('Processing update received:', data)
      updateProgress(data)
    })

    const cleanupComplete = window.electronAPI.onProcessingComplete((data) => {
      console.log('Processing complete:', data)
      updateProgress({
        stage: 'completed',
        progress: 100,
        message: `Found ${data.clipsFound} potential clips!`
      })
    })

    const cleanupError = window.electronAPI.onProcessingError((error) => {
      console.error('Processing error:', error)
      updateProgress({
        stage: 'completed',
        progress: 0,
        message: `Processing failed: ${error}`
      })
      setProcessing(false)
    })

    return () => {
      cleanupUpdate()
      cleanupComplete()
      cleanupError()
    }
  }, [])

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
      
      // Start real processing pipeline
      const result = await window.electronAPI?.processEpisode(filePath, projectName)
      
      if (result) {
        console.log('Processing completed:', result)
        
        // Navigate to review page with actual episode ID
        setTimeout(() => {
          navigate(`/review/${result.episodeId}`)
        }, 2000) // Give user time to see completion
      }

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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const files = Array.from(e.dataTransfer.files)
    const mediaFile = files.find(file => 
      file.type.startsWith('video/') || file.type.startsWith('audio/')
    )
    
    if (mediaFile) {
      // In browser context, we don't have access to file paths
      // This would need to be handled differently in production
      startProcessing(mediaFile.name)
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
    <div className="flex-1 flex items-center justify-center p-8 h-full overflow-hidden">
      <div className="max-w-2xl w-full space-y-8 text-center">
        {/* Header - Hidden during processing */}
        {!isProcessing && (
          <div className="space-y-4">
            <h1 className="text-4xl font-bold text-text-primary">
              Welcome to Ariadne
            </h1>
            <p className="text-xl text-text-secondary">
              Your thread through content
            </p>
            <p className="text-text-muted max-w-md mx-auto">
              Transform your podcast episodes into ready-to-publish social media reels 
              with AI-powered content analysis and editing.
            </p>
          </div>
        )}

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
              <button
                onClick={handleFileSelect}
                className="btn-primary"
              >
                Select File
              </button>
            </div>
          </div>
        )}

        {/* Supported formats - Hidden during processing */}
        {!isProcessing && (
          <div className="text-sm text-text-muted">
            Supported formats: MP4, MOV, MP3, WAV, M4A, AAC (up to 3GB)
          </div>
        )}

        {/* Recent projects - Hidden during processing */}
        {!isProcessing && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-text-secondary">Recent Projects</h3>
            <div className="text-text-muted">
              No recent projects yet. Upload your first podcast to get started!
            </div>
          </div>
        )}
      </div>
    </div>
  )
}