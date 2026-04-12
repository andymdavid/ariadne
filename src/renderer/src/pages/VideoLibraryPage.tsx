import { useEffect, useMemo, useState } from 'react'
import {
  IoFilmOutline,
  IoImageOutline,
  IoRefreshOutline,
  IoSparklesOutline,
  IoTimeOutline
} from 'react-icons/io5'
import type {
  GeneratedVideoAsset,
  GeneratedVideoAspectRatio,
  GeneratedVideoJobEvent,
  GeneratedVideoJob,
  VideoGenerationModelId
} from '@shared/types'
import { MainContentPanel } from '../components/MainContentPanel'

const modelOptions: Array<{ id: VideoGenerationModelId; label: string; description: string }> = [
  { id: 'alibaba/wan-2.6', label: 'Wan 2.6', description: 'Default for stylized and illustrated motion.' },
  { id: 'bytedance/seedance-1-5-pro', label: 'Seedance 1.5 Pro', description: 'Alternative for coherent, composition-preserving motion.' },
  { id: 'google/veo-3.1', label: 'Veo 3.1', description: 'Higher-fidelity cinematic option for later testing.' },
  { id: 'openai/sora-2-pro', label: 'Sora 2 Pro', description: 'Alternative cinematic model with longer durations.' }
]

const modelDurationOptions: Record<VideoGenerationModelId, number[]> = {
  'alibaba/wan-2.6': [5, 10],
  'bytedance/seedance-1-5-pro': [4, 5, 6, 7, 8, 9, 10, 11, 12],
  'google/veo-3.1': [4, 6, 8],
  'openai/sora-2-pro': [4, 8, 12, 16, 20]
}

const upsertById = <T extends { id: string }>(items: T[], nextItem: T) => {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)
  if (existingIndex === -1) {
    return [nextItem, ...items]
  }

  const next = [...items]
  next[existingIndex] = nextItem
  return next
}

export function VideoLibraryPage() {
  const [assets, setAssets] = useState<GeneratedVideoAsset[]>([])
  const [jobs, setJobs] = useState<GeneratedVideoJob[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [draftPrompt, setDraftPrompt] = useState('')
  const [draftStylePrompt, setDraftStylePrompt] = useState('')
  const [draftNegativePrompt, setDraftNegativePrompt] = useState('')
  const [draftModel, setDraftModel] = useState<VideoGenerationModelId>('alibaba/wan-2.6')
  const [draftAspectRatio, setDraftAspectRatio] = useState<GeneratedVideoAspectRatio>('9:16')
  const [draftDurationSeconds, setDraftDurationSeconds] = useState(5)
  const [referenceImagePath, setReferenceImagePath] = useState<string | null>(null)
  const [isSavingDraft, setIsSavingDraft] = useState(false)
  const [startingJobId, setStartingJobId] = useState<string | null>(null)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null)

  useEffect(() => {
    void loadLibrary()
  }, [])

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onVideoGenerationProgress?.((event: GeneratedVideoJobEvent) => {
      setJobs((current) => upsertById(current, event.job))
      if (event.asset) {
        setAssets((current) => upsertById(current, event.asset!))
      }
      setIsLoading(false)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const loadLibrary = async () => {
    try {
      setIsLoading(true)
      const [loadedAssets, loadedJobs] = await Promise.all([
        window.electronAPI?.listGeneratedVideoAssets?.() ?? Promise.resolve([]),
        window.electronAPI?.listGeneratedVideoJobs?.() ?? Promise.resolve([])
      ])
      setAssets(loadedAssets ?? [])
      setJobs(loadedJobs ?? [])
    } catch (error) {
      console.error('Failed to load video library:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const completedAssets = useMemo(
    () => assets.filter((asset) => asset.status === 'completed'),
    [assets]
  )

  const selectedAsset = useMemo(() => {
    if (!assets.length) return null
    return assets.find((asset) => asset.id === selectedAssetId) ?? completedAssets[0] ?? assets[0] ?? null
  }, [assets, completedAssets, selectedAssetId])

  const selectedAssetJob = useMemo(() => {
    if (!selectedAsset?.sourceJobId) return null
    return jobs.find((job) => job.id === selectedAsset.sourceJobId) ?? null
  }, [jobs, selectedAsset])

  const runningJobs = useMemo(
    () => jobs.filter((job) => job.status === 'pending' || job.status === 'running'),
    [jobs]
  )

  const failedJobs = useMemo(
    () => jobs.filter((job) => job.status === 'failed' || job.status === 'cancelled'),
    [jobs]
  )

  useEffect(() => {
    if (!selectedAssetId && assets.length) {
      setSelectedAssetId((completedAssets[0] ?? assets[0]).id)
      return
    }

    if (selectedAssetId && !assets.some((asset) => asset.id === selectedAssetId) && assets.length) {
      setSelectedAssetId((completedAssets[0] ?? assets[0]).id)
    }
  }, [assets, completedAssets, selectedAssetId])

  useEffect(() => {
    if (!runningJobs.length) {
      return
    }

    const interval = window.setInterval(() => {
      void loadLibrary()
    }, 5000)

    return () => window.clearInterval(interval)
  }, [runningJobs.length])

  const selectedModel = modelOptions.find((option) => option.id === draftModel) ?? modelOptions[0]
  const supportedDurations = modelDurationOptions[draftModel] ?? [5]

  useEffect(() => {
    if (!supportedDurations.includes(draftDurationSeconds)) {
      setDraftDurationSeconds(supportedDurations[0])
    }
  }, [draftDurationSeconds, supportedDurations])

  const handleImportReference = async () => {
    try {
      const importedPath = await window.electronAPI?.importVideoReferenceImage?.()
      if (importedPath) {
        setReferenceImagePath(importedPath)
      }
    } catch (error) {
      console.error('Failed to import video reference image:', error)
      alert('Failed to import reference image')
    }
  }

  const handleCreateDraft = async () => {
    if (!draftPrompt.trim()) {
      alert('Base prompt is required')
      return
    }

    try {
      setIsSavingDraft(true)
      await window.electronAPI?.createGeneratedVideoDraft?.({
        prompt: draftPrompt,
        stylePrompt: draftStylePrompt,
        negativePrompt: draftNegativePrompt,
        referenceImagePath,
        modelId: draftModel,
        aspectRatio: draftAspectRatio,
        durationSeconds: draftDurationSeconds
      })
      setDraftPrompt('')
      setDraftStylePrompt('')
      setDraftNegativePrompt('')
      setReferenceImagePath(null)
      await loadLibrary()
    } catch (error) {
      console.error('Failed to create video generation draft:', error)
      alert('Failed to create video generation draft')
    } finally {
      setIsSavingDraft(false)
    }
  }

  const handleStartJob = async (jobId: string) => {
    try {
      setStartingJobId(jobId)
      await window.electronAPI?.startGeneratedVideoJob?.(jobId)
      await loadLibrary()
    } catch (error) {
      console.error('Failed to start generated video job:', error)
      alert(error instanceof Error ? error.message : 'Failed to start generated video job')
    } finally {
      setStartingJobId(null)
    }
  }

  const handleCancelJob = async (jobId: string) => {
    try {
      setCancellingJobId(jobId)
      await window.electronAPI?.cancelGeneratedVideoJob?.(jobId)
      await loadLibrary()
    } catch (error) {
      console.error('Failed to cancel generated video job:', error)
      alert(error instanceof Error ? error.message : 'Failed to cancel generated video job')
    } finally {
      setCancellingJobId(null)
    }
  }

  const handleRetryJob = async (jobId: string) => {
    try {
      setRetryingJobId(jobId)
      await window.electronAPI?.retryGeneratedVideoJob?.(jobId)
      await loadLibrary()
    } catch (error) {
      console.error('Failed to retry generated video job:', error)
      alert(error instanceof Error ? error.message : 'Failed to retry generated video job')
    } finally {
      setRetryingJobId(null)
    }
  }

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex min-h-full flex-col gap-6">
          <div className="app-page-header">
            <div className="app-page-header-shell">
              <div className="app-page-header-content">
                <div className="app-page-title">Video Library</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">
                  Create reusable AI video assets, then assign them as the visual source for specific clips.
                </div>
              </div>
              <div className="app-page-header-actions">
                <div className="app-chip">{completedAssets.length} reusable videos</div>
              </div>
            </div>
          </div>

          <div className="app-page-content-shell grid min-h-0 h-full flex-1 grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)] gap-6">
            <section className="app-section-shell min-h-0">
              <div className="app-section-header">
                <div>
                  <h2 className="app-section-title">Generation setup</h2>
                  <div className="app-page-subtitle !mt-1 !text-sm">
                    This is the shell for the new AI video workflow. Prompting and job execution come next.
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Model</label>
                  <select
                    value={draftModel}
                    onChange={(event) => setDraftModel(event.target.value as VideoGenerationModelId)}
                    className="brand-control-select w-full"
                  >
                    {modelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <div className="text-xs text-text-muted">{selectedModel.description}</div>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Base prompt</label>
                  <textarea
                    value={draftPrompt}
                    onChange={(event) => setDraftPrompt(event.target.value)}
                    className="brand-control-textarea min-h-[140px] w-full"
                    placeholder="Describe the motion, mood, composition, and subject for the generated video..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Style prompt</label>
                  <textarea
                    value={draftStylePrompt}
                    onChange={(event) => setDraftStylePrompt(event.target.value)}
                    className="brand-control-textarea min-h-[100px] w-full"
                    placeholder="Optional: add illustration, painterly, anime, or cinematic style guidance..."
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Negative prompt</label>
                  <textarea
                    value={draftNegativePrompt}
                    onChange={(event) => setDraftNegativePrompt(event.target.value)}
                    className="brand-control-textarea min-h-[90px] w-full"
                    placeholder="Optional: exclude blur, low detail, text artifacts, extra limbs, or unwanted motion..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Aspect ratio</label>
                    <select
                      value={draftAspectRatio}
                      onChange={(event) => setDraftAspectRatio(event.target.value as GeneratedVideoAspectRatio)}
                      className="brand-control-select w-full"
                    >
                      <option value="9:16">9:16</option>
                      <option value="1:1">1:1</option>
                      <option value="16:9">16:9</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs uppercase tracking-[0.18em] text-text-muted">Duration</label>
                    <select
                      value={draftDurationSeconds}
                      onChange={(event) => setDraftDurationSeconds(Number(event.target.value))}
                      className="brand-control-select w-full"
                    >
                      {supportedDurations.map((seconds) => (
                        <option key={seconds} value={seconds}>
                          {seconds}s
                        </option>
                      ))}
                    </select>
                    <div className="text-xs text-text-muted">
                      Native model duration. Current OpenRouter video models top out at 20s, so 30–90s clip coverage will need chaining or looping rather than one direct generation.
                    </div>
                  </div>
                </div>

                <div className="app-empty-state !items-start">
                  <IoImageOutline size={20} className="text-text-muted" />
                  <div className="app-empty-title">Reference image</div>
                  <div className="app-empty-copy">
                    Import a style or composition reference into the app library before generation.
                  </div>
                  <button className="btn-secondary mt-3" onClick={() => void handleImportReference()}>
                    Import reference image
                  </button>
                  {referenceImagePath ? (
                    <div className="mt-2 text-xs text-text-muted">{referenceImagePath.split('/').pop()}</div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    className="btn-primary"
                    onClick={() => void handleCreateDraft()}
                    disabled={isSavingDraft}
                  >
                    {isSavingDraft ? 'Creating draft...' : 'Create draft generation'}
                  </button>
                  <button className="btn-secondary" onClick={() => void loadLibrary()}>
                    <IoRefreshOutline className="mr-2 inline-block align-[-2px]" />
                    Refresh
                  </button>
                </div>
              </div>
            </section>

            <div className="flex min-h-0 flex-col gap-6">
              <section className="app-section-shell min-h-0">
                <div className="app-section-header">
                  <div>
                    <h2 className="app-section-title">Current queue</h2>
                  </div>
                  <div className="text-xs text-text-muted">{runningJobs.length} active</div>
                </div>

                {isLoading ? (
                  <div className="app-empty-state">
                    <div className="app-empty-title">Loading generation queue...</div>
                  </div>
                ) : runningJobs.length === 0 ? (
                  <div className="app-empty-state">
                    <IoSparklesOutline size={20} className="text-text-muted" />
                    <div className="app-empty-title">No generation jobs yet</div>
                    <div className="app-empty-copy">
                      Jobs created here will later track OpenRouter video generation runs and asset downloads.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {runningJobs.map((job) => (
                      <div key={job.id} className="app-list-row">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">{job.prompt || 'Untitled generation job'}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {job.modelId} • {job.aspectRatio} • {job.durationSeconds}s
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="app-chip">{job.status}</div>
                          {job.status === 'pending' ? (
                            <button
                              className="btn-secondary"
                              onClick={() => void handleStartJob(job.id)}
                              disabled={startingJobId === job.id}
                            >
                              {startingJobId === job.id ? 'Starting...' : 'Start'}
                            </button>
                          ) : null}
                          {job.status === 'running' ? (
                            <button
                              className="btn-secondary"
                              onClick={() => void handleCancelJob(job.id)}
                              disabled={cancellingJobId === job.id}
                            >
                              {cancellingJobId === job.id ? 'Cancelling...' : 'Cancel'}
                            </button>
                          ) : null}
                          {(job.status === 'failed' || job.status === 'cancelled') ? (
                            <button
                              className="btn-secondary"
                              onClick={() => void handleRetryJob(job.id)}
                              disabled={retryingJobId === job.id}
                            >
                              {retryingJobId === job.id ? 'Retrying...' : 'Retry'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {failedJobs.length > 0 ? (
                <section className="app-section-shell min-h-0">
                  <div className="app-section-header">
                    <div>
                      <h2 className="app-section-title">Failed or cancelled jobs</h2>
                    </div>
                    <div className="text-xs text-text-muted">{failedJobs.length} attention needed</div>
                  </div>

                  <div className="space-y-2">
                    {failedJobs.map((job) => (
                      <div key={job.id} className="app-list-row">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-text-primary">{job.prompt || 'Untitled generation job'}</div>
                          <div className="mt-1 text-xs text-text-muted">
                            {job.status} • {job.modelId} • {job.aspectRatio} • {job.durationSeconds}s
                          </div>
                          {job.errorMessage ? (
                            <div className="mt-2 text-xs text-red-200">{job.errorMessage}</div>
                          ) : null}
                        </div>
                        <button
                          className="btn-secondary"
                          onClick={() => void handleRetryJob(job.id)}
                          disabled={retryingJobId === job.id}
                        >
                          {retryingJobId === job.id ? 'Retrying...' : 'Retry'}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="app-section-shell min-h-0 flex flex-1 flex-col">
                <div className="app-section-header">
                  <div>
                    <h2 className="app-section-title">Reusable video assets</h2>
                  </div>
                  <div className="text-xs text-text-muted">{assets.length} total</div>
                </div>

                {selectedAsset ? (
                  <div className="mb-4 rounded-[4px] border border-border-subtle bg-bg-secondary p-3">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-text-primary">{selectedAsset.name}</div>
                        <div className="mt-1 text-xs text-text-muted">
                          {selectedAsset.modelId} • {selectedAsset.aspectRatio}
                          {selectedAsset.durationSeconds ? ` • ${selectedAsset.durationSeconds}s` : ''}
                        </div>
                      </div>
                      <div className="app-chip">{selectedAsset.status}</div>
                    </div>

                    {selectedAsset.status === 'completed' && selectedAsset.filePath ? (
                      <video
                        key={selectedAsset.filePath}
                        src={`app-file://${selectedAsset.filePath}`}
                        className="w-full rounded-[4px] border border-border-subtle bg-black"
                        style={{ aspectRatio: selectedAsset.aspectRatio === '16:9' ? '16 / 9' : selectedAsset.aspectRatio === '1:1' ? '1 / 1' : '9 / 16', maxHeight: '460px' }}
                        controls
                        playsInline
                        preload="metadata"
                      />
                    ) : selectedAsset.thumbnailPath ? (
                      <img
                        src={`app-file://${selectedAsset.thumbnailPath}`}
                        alt={selectedAsset.name}
                        className="w-full rounded-[4px] border border-border-subtle object-cover"
                        style={{ aspectRatio: selectedAsset.aspectRatio === '16:9' ? '16 / 9' : selectedAsset.aspectRatio === '1:1' ? '1 / 1' : '9 / 16', maxHeight: '460px' }}
                      />
                    ) : (
                      <div className="app-empty-state !min-h-[220px] rounded-[4px] border border-border-subtle bg-bg-primary">
                        <IoFilmOutline size={20} className="text-text-muted" />
                        <div className="app-empty-title">Preview unavailable</div>
                        <div className="app-empty-copy">
                          Completed generated videos will preview here. Running jobs update in real time.
                        </div>
                      </div>
                    )}

                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-[4px] border border-border-subtle bg-bg-primary p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Prompting</div>
                        <div className="mt-2 text-sm whitespace-pre-wrap text-text-primary">
                          {selectedAsset.prompt || 'No prompt saved'}
                        </div>
                        {selectedAsset.stylePrompt ? (
                          <div className="mt-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Style prompt</div>
                            <div className="mt-2 text-sm whitespace-pre-wrap text-text-primary">{selectedAsset.stylePrompt}</div>
                          </div>
                        ) : null}
                        {selectedAsset.negativePrompt ? (
                          <div className="mt-3">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Negative prompt</div>
                            <div className="mt-2 text-sm whitespace-pre-wrap text-text-primary">{selectedAsset.negativePrompt}</div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-[4px] border border-border-subtle bg-bg-primary p-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Asset metadata</div>
                        <div className="mt-2 space-y-2 text-sm text-text-primary">
                          <div>Model: {selectedAsset.modelId}</div>
                          <div>Status: {selectedAsset.status}</div>
                          <div>Aspect ratio: {selectedAsset.aspectRatio}</div>
                          <div>Duration: {selectedAsset.durationSeconds ? `${selectedAsset.durationSeconds}s` : 'Unknown'}</div>
                          <div>Updated: {new Date(selectedAsset.updatedAt).toLocaleString()}</div>
                          {selectedAsset.referenceImagePath ? (
                            <div>Reference: {selectedAsset.referenceImagePath.split('/').pop()}</div>
                          ) : null}
                          {selectedAsset.filePath ? (
                            <div>File: {selectedAsset.filePath.split('/').pop()}</div>
                          ) : null}
                        </div>
                        {selectedAssetJob?.errorMessage ? (
                          <div className="mt-3 rounded-[4px] border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                            {selectedAssetJob.errorMessage}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {isLoading ? (
                    <div className="app-empty-state">
                      <div className="app-empty-title">Loading video library...</div>
                    </div>
                  ) : assets.length === 0 ? (
                    <div className="app-empty-state">
                      <IoFilmOutline size={20} className="text-text-muted" />
                      <div className="app-empty-title">No saved videos yet</div>
                      <div className="app-empty-copy">
                        Generated outputs will accumulate here and become selectable clip visual sources.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {assets.map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          onClick={() => setSelectedAssetId(asset.id)}
                          className={`app-list-row w-full text-left ${selectedAsset?.id === asset.id ? 'ring-1 ring-border-default' : ''}`}
                        >
                          <div className="app-list-icon">
                            <IoFilmOutline size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-text-primary">{asset.name}</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                              <span>{asset.modelId}</span>
                              <span>•</span>
                              <span>{asset.aspectRatio}</span>
                              {asset.durationSeconds ? (
                                <>
                                  <span>•</span>
                                  <span>{asset.durationSeconds}s</span>
                                </>
                              ) : null}
                            </div>
                            {asset.prompt ? (
                              <div className="mt-1 truncate text-xs text-text-muted">{asset.prompt}</div>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="app-chip">{asset.status}</div>
                            <div className="text-xs text-text-muted">
                              <IoTimeOutline className="inline-block align-[-2px]" /> {new Date(asset.updatedAt).toLocaleDateString()}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
