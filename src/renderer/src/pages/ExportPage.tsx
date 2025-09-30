import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { IoCheckmarkCircle, IoClose, IoDownload, IoSettings, IoTime, IoVideocam, IoWarning } from 'react-icons/io5'

interface Clip {
  id: string
  startTime: number
  endTime: number
  duration: number
  contentType: string
  shareabilityScore: number
  keyQuote: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
}

interface ExportJob {
  id: string
  episodeId: string
  clipIds: string[]
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress: number
  currentClipIndex: number
  totalClips: number
  outputPaths: string[]
  error?: string
}

export function ExportPage() {
  const { id: episodeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [approvedClips, setApprovedClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportJob, setExportJob] = useState<ExportJob | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // Export settings
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1' | '16:9'>('9:16')
  const [includeCaptions, setIncludeCaptions] = useState(true)

  useEffect(() => {
    if (!episodeId) {
      setError('No episode ID provided')
      setLoading(false)
      return
    }

    loadApprovedClips()
  }, [episodeId])

  // Listen for export progress
  useEffect(() => {
    const cleanup = window.electronAPI?.onExportProgress?.((job: ExportJob) => {
      console.log('Export progress:', job)
      setExportJob(job)

      if (job.status === 'completed') {
        setIsExporting(false)
      } else if (job.status === 'failed') {
        setIsExporting(false)
        setError(job.error || 'Export failed')
      }
    })

    return cleanup
  }, [])

  const loadApprovedClips = async () => {
    try {
      setLoading(true)
      console.log('Loading approved clips for episode:', episodeId)

      if (!window.electronAPI?.getApprovedClips) {
        throw new Error('Export API not available')
      }

      const clips = await window.electronAPI.getApprovedClips(episodeId!)
      console.log('Loaded approved clips:', clips)

      setApprovedClips(clips)
      setLoading(false)
    } catch (err) {
      console.error('Failed to load approved clips:', err)
      setError(err instanceof Error ? err.message : 'Failed to load clips')
      setLoading(false)
    }
  }

  const handleStartExport = async () => {
    if (!episodeId || approvedClips.length === 0) {
      return
    }

    try {
      setIsExporting(true)
      setError(null)

      console.log('Starting export with settings:', { aspectRatio, includeCaptions })

      const job = await window.electronAPI?.exportApprovedClips(episodeId, {
        aspectRatio,
        includeCaptions
      })

      console.log('Export job created:', job)
      setExportJob(job)
    } catch (err) {
      console.error('Export failed:', err)
      setError(err instanceof Error ? err.message : 'Export failed')
      setIsExporting(false)
    }
  }

  const handleCancelExport = async () => {
    if (!exportJob) return

    try {
      await window.electronAPI?.cancelExportJob(exportJob.id)
      setIsExporting(false)
      setExportJob(null)
    } catch (err) {
      console.error('Failed to cancel export:', err)
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const getEstimatedDuration = (): string => {
    const totalDuration = approvedClips.reduce((sum, clip) => sum + clip.duration, 0)
    // Rough estimate: 2x duration for processing
    const estimatedMinutes = Math.ceil((totalDuration * 2) / 60)
    return `~${estimatedMinutes} min`
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin text-4xl mb-4">⏳</div>
          <div className="text-text-secondary">Loading approved clips...</div>
        </div>
      </div>
    )
  }

  if (error && !exportJob) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-md">
          <IoWarning className="text-5xl text-accent-danger mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-text-primary mb-2">Error</h2>
          <p className="text-text-secondary mb-6">{error}</p>
          <button
            className="btn-primary"
            onClick={() => navigate(`/review/${episodeId}`)}
          >
            Back to Review
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex h-full overflow-hidden">
      {/* Left Panel - Export Settings */}
      <div className="w-96 border-r border-border-default p-6 space-y-6 overflow-y-auto flex-shrink-0">
        <div>
          <h2 className="text-2xl font-semibold text-text-primary mb-2">
            Export Settings
          </h2>
          <p className="text-sm text-text-muted">
            Configure your export options
          </p>
        </div>

        {/* Aspect Ratio Selection */}
        <div>
          <label className="block text-sm font-medium text-text-secondary mb-3">
            Aspect Ratio
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
              <button
                key={ratio}
                onClick={() => setAspectRatio(ratio)}
                disabled={isExporting}
                className={`p-4 rounded-lg border-2 transition-all ${
                  aspectRatio === ratio
                    ? 'border-accent-primary bg-accent-primary/10'
                    : 'border-border-default hover:border-border-hover'
                }`}
              >
                <div className="text-center">
                  <div className="text-lg font-semibold text-text-primary mb-1">
                    {ratio}
                  </div>
                  <div className="text-xs text-text-muted">
                    {ratio === '9:16' && 'Stories'}
                    {ratio === '1:1' && 'Square'}
                    {ratio === '16:9' && 'Landscape'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="space-y-3">
          <label className="flex items-center space-x-3 p-3 rounded-lg hover:bg-bg-secondary cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={includeCaptions}
              onChange={(e) => setIncludeCaptions(e.target.checked)}
              disabled={isExporting}
              className="w-5 h-5 rounded border-border-default text-accent-primary focus:ring-2 focus:ring-accent-primary"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-text-primary">
                Include Captions
              </div>
              <div className="text-xs text-text-muted">
                Overlay key quote on video
              </div>
            </div>
          </label>
        </div>

        {/* Export Summary */}
        <div className="card p-4 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary">
            Export Summary
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted">Approved Clips:</span>
              <span className="text-text-primary font-medium">
                {approvedClips.length}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Total Duration:</span>
              <span className="text-text-primary font-medium">
                {formatTime(approvedClips.reduce((sum, clip) => sum + clip.duration, 0))}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Estimated Time:</span>
              <span className="text-text-primary font-medium">
                {getEstimatedDuration()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Format:</span>
              <span className="text-text-primary font-medium">
                MP4 ({aspectRatio})
              </span>
            </div>
          </div>
        </div>

        {/* Export Button */}
        {!isExporting && !exportJob && (
          <button
            onClick={handleStartExport}
            disabled={approvedClips.length === 0}
            className="w-full btn-primary py-4 text-lg font-semibold flex items-center justify-center space-x-2"
          >
            <IoDownload className="text-xl" />
            <span>Export {approvedClips.length} Clips</span>
          </button>
        )}

        {isExporting && exportJob && exportJob.status === 'processing' && (
          <button
            onClick={handleCancelExport}
            className="w-full btn-secondary py-4 text-lg font-semibold flex items-center justify-center space-x-2"
          >
            <IoClose className="text-xl" />
            <span>Cancel Export</span>
          </button>
        )}

        {exportJob && exportJob.status === 'completed' && (
          <div className="space-y-3">
            <button
              onClick={() => {
                setExportJob(null)
                setIsExporting(false)
              }}
              className="w-full btn-primary py-4 text-lg font-semibold flex items-center justify-center space-x-2"
            >
              <IoDownload className="text-xl" />
              <span>Export Again</span>
            </button>
            <button
              onClick={() => navigate(`/review/${episodeId}`)}
              className="w-full btn-secondary py-3 flex items-center justify-center space-x-2"
            >
              <span>Back to Review</span>
            </button>
          </div>
        )}
      </div>

      {/* Right Panel - Clips List and Progress */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-border-default p-6">
          <h2 className="text-2xl font-semibold text-text-primary mb-1">
            {exportJob ? 'Export Progress' : 'Approved Clips'}
          </h2>
          <p className="text-sm text-text-muted">
            {exportJob
              ? `Exporting ${exportJob.currentClipIndex + 1} of ${exportJob.totalClips} clips`
              : `${approvedClips.length} clips ready for export`}
          </p>
        </div>

        {/* Export Progress */}
        {exportJob && (
          <div className="p-6 border-b border-border-default bg-bg-secondary">
            <div className="space-y-4">
              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {exportJob.status === 'processing' && (
                    <>
                      <div className="animate-spin text-2xl">⏳</div>
                      <div>
                        <div className="text-lg font-semibold text-text-primary">
                          Exporting...
                        </div>
                        <div className="text-sm text-text-muted">
                          Clip {exportJob.currentClipIndex + 1} of {exportJob.totalClips}
                        </div>
                      </div>
                    </>
                  )}
                  {exportJob.status === 'completed' && (
                    <>
                      <IoCheckmarkCircle className="text-3xl text-accent-success" />
                      <div>
                        <div className="text-lg font-semibold text-accent-success">
                          Export Complete!
                        </div>
                        <div className="text-sm text-text-muted">
                          {exportJob.totalClips} clips exported successfully
                        </div>
                      </div>
                    </>
                  )}
                  {exportJob.status === 'failed' && (
                    <>
                      <IoWarning className="text-3xl text-accent-danger" />
                      <div>
                        <div className="text-lg font-semibold text-accent-danger">
                          Export Failed
                        </div>
                        <div className="text-sm text-text-muted">
                          {exportJob.error || 'Unknown error occurred'}
                        </div>
                      </div>
                    </>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-3xl font-bold text-accent-primary">
                    {Math.round(exportJob.progress)}%
                  </div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-bg-tertiary rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all duration-300"
                  style={{ width: `${exportJob.progress}%` }}
                />
              </div>

              {/* Output Paths */}
              {exportJob.status === 'completed' && exportJob.outputPaths.length > 0 && (
                <div className="mt-4">
                  <div className="text-sm font-medium text-text-secondary mb-2">
                    Exported Files:
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {exportJob.outputPaths.map((path, index) => (
                      <div
                        key={index}
                        className="text-xs text-text-muted bg-bg-tertiary p-2 rounded font-mono truncate"
                        title={path}
                      >
                        {path.split('/').pop()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clips List */}
        <div className="flex-1 overflow-y-auto p-6">
          {approvedClips.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <IoVideocam className="text-6xl text-text-muted mb-4" />
              <h3 className="text-xl font-semibold text-text-primary mb-2">
                No Approved Clips
              </h3>
              <p className="text-text-muted mb-6 max-w-md">
                You need to approve clips in the Review page before you can export them.
              </p>
              <button
                className="btn-primary"
                onClick={() => navigate(`/review/${episodeId}`)}
              >
                Go to Review
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {approvedClips.map((clip, index) => (
                <div
                  key={clip.id}
                  className={`card p-5 space-y-3 transition-all ${
                    exportJob && index < exportJob.currentClipIndex
                      ? 'opacity-50'
                      : exportJob && index === exportJob.currentClipIndex
                      ? 'ring-2 ring-accent-primary'
                      : ''
                  }`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="text-lg font-bold text-text-muted">
                        #{index + 1}
                      </span>
                      <span className="text-xs font-medium uppercase tracking-wide text-accent-success">
                        {clip.contentType}
                      </span>
                      <span className="text-text-muted">•</span>
                      <span className="text-sm text-text-muted">
                        {formatTime(clip.duration)}
                      </span>
                      <span className="text-text-muted">•</span>
                      <span className="text-sm text-accent-primary font-medium">
                        {clip.shareabilityScore}★
                      </span>
                    </div>
                    {exportJob && index < exportJob.currentClipIndex && (
                      <IoCheckmarkCircle className="text-xl text-accent-success" />
                    )}
                    {exportJob && index === exportJob.currentClipIndex && (
                      <div className="animate-spin text-xl">⏳</div>
                    )}
                  </div>

                  {/* Quote */}
                  <blockquote className="text-text-primary leading-relaxed">
                    "{clip.keyQuote}"
                  </blockquote>

                  {/* Metadata */}
                  <div className="text-sm text-text-muted">
                    {clip.reason}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}