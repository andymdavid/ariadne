import { useParams, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { IoCheckmarkCircle, IoClose, IoDownload, IoVideocam, IoWarning } from 'react-icons/io5'
import type { ExportJobDTO } from '@shared/types/exportIpc'
import { MainContentPanel } from '../components/MainContentPanel'

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

interface ClipTitle {
  id: string
  clip_id: string
  title: string
  is_selected: number
  created_at: string
}

export function ExportPage() {
  const { id: episodeId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [approvedClips, setApprovedClips] = useState<Clip[]>([])
  const [clipTitles, setClipTitles] = useState<{ [clipId: string]: string }>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exportJob, setExportJob] = useState<ExportJobDTO | null>(null)

  // Export settings
  const [aspectRatio, setAspectRatio] = useState<'9:16' | '1:1' | '16:9'>('9:16')
  const [includeCaptions, setIncludeCaptions] = useState(true)
  const isExporting = exportJob?.status === 'processing' || exportJob?.status === 'pending'
  const exportError = exportJob?.status === 'failed' ? (exportJob.error || 'Export failed') : null
  const exportStatusLabel = (() => {
    if (!exportJob) return null
    if (exportJob.status === 'completed') return 'Completed'
    if (exportJob.status === 'failed') return exportError?.toLowerCase().includes('cancel') ? 'Cancelled' : 'Failed'
    if (exportJob.status === 'pending') return exportJob.progress > 0 || exportJob.currentClipIndex > 0 ? 'Resuming' : 'Queued'
    return exportJob.currentClipIndex > 0 ? 'Running' : 'Starting'
  })()
  const exportStatusText = (() => {
    if (!exportJob) return `${approvedClips.length} approved clips ready to export`
    if (exportJob.status === 'completed') return `Export complete. ${exportJob.totalClips} clips ready.`
    if (exportJob.status === 'failed') return exportError || 'Export failed'
    if (exportJob.status === 'pending') {
      return exportJob.progress > 0 || exportJob.currentClipIndex > 0
        ? `Resuming clip ${Math.min(exportJob.currentClipIndex + 1, exportJob.totalClips)} of ${exportJob.totalClips}`
        : 'Queued and preparing export...'
    }
    return `Exporting clip ${Math.min(exportJob.currentClipIndex + 1, exportJob.totalClips)} of ${exportJob.totalClips}`
  })()

  useEffect(() => {
    if (!episodeId) {
      setError('No episode ID provided')
      setLoading(false)
      return
    }

    loadActiveExportJob()
    loadApprovedClips()
  }, [episodeId])

  // Listen for export progress
  useEffect(() => {
    const cleanup = window.electronAPI?.onExportProgress?.((job) => {
      console.log('Export progress:', job)
      setExportJob(job)
      if (job.status !== 'failed') {
        setError(null)
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

      const rawClips = await window.electronAPI.getApprovedClips(episodeId!)
      console.log('Loaded approved clips:', rawClips)

      // Map database snake_case to camelCase
      const clips: Clip[] = rawClips.map((clip: any) => ({
        id: clip.id,
        startTime: Number(clip.start_time) || 0,
        endTime: Number(clip.end_time) || 0,
        duration: Number(clip.duration) || 0,
        contentType: clip.content_type || 'unknown',
        shareabilityScore: Number(clip.shareability_score) || 0,
        keyQuote: clip.key_quote || '',
        reason: clip.reason || '',
        status: clip.status || 'approved'
      }))

      setApprovedClips(clips)

      // Fetch titles for each clip
      const titlesMap: { [clipId: string]: string } = {}
      for (const clip of clips) {
        try {
          const titles = await window.electronAPI?.getClipTitles?.(clip.id)
          if (titles && titles.length > 0) {
            // Get the selected title or the first one
            const selectedTitle = titles.find((t: ClipTitle) => t.is_selected === 1) || titles[0]
            titlesMap[clip.id] = selectedTitle.title
          }
        } catch (err) {
          console.log(`No titles found for clip ${clip.id}`)
        }
      }
      setClipTitles(titlesMap)

      setLoading(false)
    } catch (err) {
      console.error('Failed to load approved clips:', err)
      setError(err instanceof Error ? err.message : 'Failed to load clips')
      setLoading(false)
    }
  }

  const loadActiveExportJob = async () => {
    if (!episodeId || !window.electronAPI?.getActiveExportJob) {
      return
    }

    try {
      const activeJob = await window.electronAPI.getActiveExportJob(episodeId)
      if (!activeJob) {
        return
      }

      setExportJob(activeJob)
      setError(null)
    } catch (err) {
      console.error('Failed to load active export job:', err)
    }
  }

  const handleStartExport = async () => {
    if (!episodeId || approvedClips.length === 0) {
      return
    }

    try {
      setError(null)

      console.log('Starting export with settings:', { aspectRatio, includeCaptions })

      const job = await window.electronAPI?.exportApprovedClips(episodeId, {
        aspectRatio,
        includeCaptions
      })

      console.log('Export job created:', job)
      if (job) {
        setExportJob(job)
      }
    } catch (err) {
      console.error('Export failed:', err)
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const handleCancelExport = async () => {
    if (!exportJob) return

    try {
      const cancelled = await window.electronAPI?.cancelExportJob(exportJob.id)
      const refreshedJob = await window.electronAPI?.getExportJob?.(exportJob.id)

      if (refreshedJob) {
        setExportJob(refreshedJob)
      } else if (cancelled) {
        setExportJob({
          ...exportJob,
          status: 'failed',
          error: 'Cancelled by user'
        })
      } else {
        await loadActiveExportJob()
      }
    } catch (err) {
      console.error('Failed to cancel export:', err)
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center">
            <div className="animate-spin text-4xl mb-4">⏳</div>
            <div className="text-text-secondary">Loading approved clips...</div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  if (error && !exportJob) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
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
      </MainContentPanel>
    )
  }

  if (approvedClips.length === 0) {
    return (
      <MainContentPanel>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="max-w-2xl w-full space-y-8 text-center">
            <div className="space-y-4">
              <IoVideocam className="text-6xl text-text-muted mx-auto" />
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold text-text-primary">
                  No Approved Clips
                </h1>
                <p className="text-text-muted">
                  You need to approve clips in the Review page before you can export them.
                </p>
              </div>
              <button
                className="btn-primary"
                onClick={() => navigate(`/review/${episodeId}`)}
              >
                Go to Review
              </button>
            </div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header with settings */}
        <div className="border-b border-border-default p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-text-primary">
                {exportJob ? 'Export Progress' : 'Export Clips'}
              </h2>
              <div className="mt-1 flex items-center gap-2">
                {exportStatusLabel && (
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                    {exportStatusLabel}
                  </span>
                )}
                <p className="text-sm text-text-muted">
                  {exportStatusText}
                </p>
              </div>
            </div>

            {/* Compact Export Settings */}
            {!isExporting && !exportJob && (
              <div className="flex items-center space-x-4">
                {/* Aspect Ratio */}
                <div className="flex items-center space-x-2">
                  <label className="text-sm text-text-muted">Format:</label>
                  <div className="flex space-x-1">
                    {(['9:16', '1:1', '16:9'] as const).map((ratio) => (
                      <button
                        key={ratio}
                        onClick={() => setAspectRatio(ratio)}
                        className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                          aspectRatio === ratio
                            ? 'bg-accent-primary text-white'
                            : 'bg-bg-secondary text-text-muted hover:bg-bg-tertiary'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Captions Toggle */}
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCaptions}
                    onChange={(e) => setIncludeCaptions(e.target.checked)}
                    className="w-4 h-4 rounded border-border-default text-accent-primary"
                  />
                  <span className="text-sm text-text-muted">Captions</span>
                </label>

                {/* Export Button */}
                <button
                  onClick={handleStartExport}
                  disabled={approvedClips.length === 0}
                  className="btn-primary flex items-center space-x-2"
                >
                  <IoDownload />
                  <span>Export {approvedClips.length}</span>
                </button>
              </div>
            )}

            {isExporting && exportJob && (exportJob.status === 'processing' || exportJob.status === 'pending') && (
              <button
                onClick={handleCancelExport}
                className="btn-secondary flex items-center space-x-2"
              >
                <IoClose />
                <span>Cancel Export</span>
              </button>
            )}

            {exportJob && exportJob.status === 'completed' && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => {
                    setExportJob(null)
                  }}
                  className="btn-primary flex items-center space-x-2"
                >
                  <IoDownload />
                  <span>Export Again</span>
                </button>
                <button
                  onClick={() => navigate(`/review/${episodeId}`)}
                  className="btn-secondary"
                >
                  Back to Review
                </button>
              </div>
            )}
          </div>

          {/* Export Progress Bar */}
          {exportJob && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  {exportJob.status === 'pending' && (
                    <>
                      <div className="text-xl">⏳</div>
                      <span className="text-sm text-text-primary">
                        {exportJob.progress > 0 || exportJob.currentClipIndex > 0
                          ? `Resuming export at clip ${Math.min(exportJob.currentClipIndex + 1, exportJob.totalClips)} of ${exportJob.totalClips}`
                          : 'Queued and preparing export'}
                      </span>
                    </>
                  )}
                  {exportJob.status === 'processing' && (
                    <>
                      <div className="animate-spin text-xl">⏳</div>
                      <span className="text-sm text-text-primary">
                        Exporting clip {exportJob.currentClipIndex + 1} of {exportJob.totalClips}
                      </span>
                    </>
                  )}
                  {exportJob.status === 'completed' && (
                    <>
                      <IoCheckmarkCircle className="text-xl text-accent-success" />
                      <span className="text-sm text-accent-success font-medium">
                        Export Complete! {exportJob.totalClips} clips exported
                      </span>
                    </>
                  )}
                  {exportJob.status === 'failed' && (
                    <>
                      <IoWarning className="text-xl text-accent-danger" />
                      <span className="text-sm text-accent-danger">
                        {exportError}
                      </span>
                    </>
                  )}
                </div>
                <div className="text-lg font-bold text-accent-primary">
                  {Math.round(exportJob.progress)}%
                </div>
              </div>

              <div className="w-full bg-bg-tertiary rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all duration-300"
                  style={{ width: `${exportJob.progress}%` }}
                />
              </div>

              {/* Output Paths */}
              {exportJob.status === 'completed' && exportJob.outputPaths.length > 0 && (
                <div className="text-xs text-text-muted">
                  Exported to: {exportJob.outputPaths[0].split('/').slice(0, -1).join('/')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Clips Grid */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-6 gap-y-4">
            {approvedClips.map((clip, index) => {
              const clipTitle = clipTitles[clip.id]

              return (
                <div
                  key={clip.id}
                  className={`clip-card ${
                    exportJob && index === exportJob.currentClipIndex ? 'selected' : ''
                  }`}
                  style={{
                    opacity: exportJob && index < exportJob.currentClipIndex ? '0.5' : undefined,
                    minWidth: '0',
                    maxWidth: '100%',
                    width: '100%',
                    height: 'auto',
                    minHeight: '340px',
                    transform: 'scale(1)',
                    cursor: 'default'
                  }}
                >
                  {/* Status Badge */}
                  {clip.status === 'approved' && (
                    <div className="status-badge approved">✓</div>
                  )}

                  {exportJob && index < exportJob.currentClipIndex && (
                    <div className="absolute top-12 right-12">
                      <IoCheckmarkCircle className="text-xl text-accent-success" />
                    </div>
                  )}

                  {/* Card Header */}
                  <div className="clip-card-header">
                    <span className={`content-type ${clip.contentType}`}>
                      {clip.contentType}
                    </span>
                    <span className="shareability-score">
                      {clip.shareabilityScore}★
                    </span>
                  </div>

                  {/* Title or Quote */}
                  {clipTitle ? (
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-text-primary leading-tight mb-2">
                        {clipTitle}
                      </h3>
                      <p className="text-sm text-text-muted line-clamp-3">
                        {clip.keyQuote}
                      </p>
                    </div>
                  ) : (
                    <blockquote className="clip-quote">
                      "{clip.keyQuote}"
                    </blockquote>
                  )}

                  {/* Metadata */}
                  <div className="clip-metadata">
                    <span className="duration">{formatTime(clip.duration)}</span>
                    <span className="divider">•</span>
                    <span className="timestamp">
                      {formatTime(clip.startTime)} - {formatTime(clip.endTime)}
                    </span>
                  </div>

                  {/* Reason */}
                  <p className="clip-reason">{clip.reason}</p>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
