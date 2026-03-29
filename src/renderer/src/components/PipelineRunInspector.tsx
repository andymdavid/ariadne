import { useEffect, useMemo, useState } from 'react'
import type {
  GetPipelineRunEvaluationsResponseDTO,
  GetPipelineRunsForEpisodeResponseDTO,
  PipelineComparableRunSummaryDTO,
  PipelineRunDetailDTO
} from '@shared/types/pipelineIpc'
import type {
  FailureEventDTO,
  WorkflowEventDTO,
  WorkflowJobViewDTO
} from '@shared/types/workflowReadIpc'

interface PipelineRunInspectorProps {
  episodeId: string
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'Not finished'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function shortId(value: string) {
  return value.slice(0, 8)
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

export function PipelineRunInspector({ episodeId }: PipelineRunInspectorProps) {
  const [runs, setRuns] = useState<GetPipelineRunsForEpisodeResponseDTO>([])
  const [comparison, setComparison] = useState<PipelineComparableRunSummaryDTO[]>([])
  const [evaluations, setEvaluations] = useState<GetPipelineRunEvaluationsResponseDTO>([])
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedRun, setSelectedRun] = useState<PipelineRunDetailDTO | null>(null)
  const [selectedWorkflowJob, setSelectedWorkflowJob] = useState<WorkflowJobViewDTO | null>(null)
  const [workflowEvents, setWorkflowEvents] = useState<WorkflowEventDTO[]>([])
  const [failureEvents, setFailureEvents] = useState<FailureEventDTO[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const loadInspection = async () => {
      if (!window.electronAPI) {
        return
      }

      setLoading(true)

      try {
        const [runList, comparisonResponse, evaluationList] = await Promise.all([
          window.electronAPI.getPipelineRunsForEpisode(episodeId),
          window.electronAPI.getPipelineRunComparison(episodeId),
          window.electronAPI.getPipelineRunEvaluations(episodeId)
        ])

        if (cancelled) {
          return
        }

        setRuns(runList)
        setComparison(comparisonResponse.runs)
        setEvaluations(evaluationList)

        const defaultJobId = runList[0]?.jobId ?? null
        setSelectedJobId((current) => current ?? defaultJobId)
      } catch (error) {
        console.error('Failed to load pipeline run inspection:', error)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadInspection()

    return () => {
      cancelled = true
    }
  }, [episodeId])

  useEffect(() => {
    let cancelled = false

    const loadRunDetail = async () => {
      if (!selectedJobId || !window.electronAPI?.getPipelineRun) {
        setSelectedRun(null)
        setSelectedWorkflowJob(null)
        setWorkflowEvents([])
        setFailureEvents([])
        return
      }

      try {
        const [run, workflowJob, events, failures] = await Promise.all([
          window.electronAPI.getPipelineRun(selectedJobId),
          window.electronAPI.getWorkflowJob(selectedJobId),
          window.electronAPI.getWorkflowEvents(selectedJobId),
          window.electronAPI.getFailureEvents(selectedJobId)
        ])
        if (!cancelled) {
          setSelectedRun(run)
          setSelectedWorkflowJob(workflowJob)
          setWorkflowEvents(events)
          setFailureEvents(failures)
        }
      } catch (error) {
        console.error('Failed to load pipeline run detail:', error)
      }
    }

    loadRunDetail()

    return () => {
      cancelled = true
    }
  }, [selectedJobId])

  const selectedComparison = useMemo(
    () => comparison.find((run) => run.jobId === selectedJobId) ?? null,
    [comparison, selectedJobId]
  )

  const selectedConfig = parseJson<Record<string, unknown>>(selectedRun?.summary.configSnapshotJson)
  const recentWorkflowEvents = workflowEvents.slice(0, 5)
  const recentFailureEvents = failureEvents.slice(0, 5)

  return (
    <aside className="absolute right-8 top-8 z-20 w-[360px] max-w-[calc(100%-4rem)] rounded-3xl border border-white/8 bg-[#12151b]/92 p-4 text-sm text-text-secondary shadow-2xl backdrop-blur">
      <div className="mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-text-primary">Pipeline Runs</h3>
        <p className="mt-1 text-xs text-text-muted">Read-only inspection for durable runs and saved evaluations.</p>
      </div>

      {loading ? (
        <div className="text-xs text-text-muted">Loading run inspection...</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-text-muted">No recorded pipeline runs for this episode yet.</div>
      ) : (
        <div className="space-y-4">
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {comparison.map((run) => (
              <button
                key={run.jobId}
                type="button"
                onClick={() => setSelectedJobId(run.jobId)}
                className={`w-full rounded-2xl border px-3 py-3 text-left transition-colors ${
                  selectedJobId === run.jobId
                    ? 'border-accent-primary bg-[#171d26] text-text-primary'
                    : 'border-white/8 bg-[#141820] hover:border-white/12 hover:bg-[#171b22]'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-text-primary">{shortId(run.jobId)}</span>
                  <span className="rounded-full bg-white/6 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                    {run.status}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-text-muted">
                  <span>Created</span>
                  <span className="text-right">{formatDateTime(run.createdAt)}</span>
                  <span>Model</span>
                  <span className="truncate text-right">{run.modelId || 'local/heuristic'}</span>
                  <span>Mode</span>
                  <span className="text-right">{run.rankingMode || 'unknown'}</span>
                  <span>Platform</span>
                  <span className="text-right">{run.clipSelectionPlatform || 'unknown'}</span>
                  <span>Clips</span>
                  <span className="text-right">{run.finalClipCount}</span>
                </div>
              </button>
            ))}
          </div>

          {selectedComparison && (
            <div className="rounded-2xl border border-white/8 bg-[#141820] p-3">
              <div className="mb-3 flex items-center justify-between">
                <div className="font-mono text-xs text-text-primary">{shortId(selectedComparison.jobId)}</div>
                <div className="text-[11px] text-text-muted">{formatDateTime(selectedComparison.completedAt)}</div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span>Transcript Segments</span>
                <span className="text-right text-text-primary">{selectedComparison.transcriptSegmentCount}</span>
                <span>Transcript Length</span>
                <span className="text-right text-text-primary">{selectedComparison.transcriptLength}</span>
                <span>Candidates</span>
                <span className="text-right text-text-primary">{selectedComparison.candidateCount}</span>
                <span>Final Clips</span>
                <span className="text-right text-text-primary">{selectedComparison.finalClipCount}</span>
                <span>Content Packages</span>
                <span className="text-right text-text-primary">{selectedComparison.contentPackageCount}</span>
                <span>AI Ranking</span>
                <span className="text-right text-text-primary">{selectedComparison.aiAnalysisSucceeded ? 'yes' : 'no'}</span>
              </div>

              {selectedConfig && (
                <div className="mt-3 rounded-xl bg-black/20 p-2 text-[11px] text-text-muted">
                  <div>Config snapshot</div>
                  <div className="mt-1 text-text-primary">
                    {(selectedConfig.apiModelId as string | undefined) || 'local/heuristic'}
                    {' · '}
                    {(selectedConfig.clipSelectionPlatform as string | undefined) || 'unknown'}
                  </div>
                </div>
              )}

              {selectedComparison.topClipPreview.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Top Clips</div>
                  <div className="space-y-2">
                    {selectedComparison.topClipPreview.slice(0, 3).map((clip) => (
                      <div key={clip.id} className="rounded-xl bg-black/20 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-text-primary">{clip.contentType}</span>
                          <span className="text-[11px] text-text-muted">{clip.shareabilityScore.toFixed(1)}</span>
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-text-secondary">{clip.keyQuote}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedRun && (
                <div className="mt-3 text-[11px] text-text-muted">
                  {selectedRun.steps.length} durable step records · {selectedRun.artifacts.length} artifacts
                </div>
              )}
            </div>
          )}

          {selectedWorkflowJob && (
            <div className="rounded-2xl border border-white/8 bg-[#141820] p-3">
              <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Workflow Diagnostics</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span>Job ID</span>
                <span className="font-mono text-right text-text-primary">{shortId(selectedWorkflowJob.jobId)}</span>
                <span>Job Type</span>
                <span className="text-right text-text-primary">{selectedWorkflowJob.jobType}</span>
                <span>Status</span>
                <span className="text-right text-text-primary">{selectedWorkflowJob.status}</span>
                <span>Stage</span>
                <span className="text-right text-text-primary">{selectedWorkflowJob.stage || 'n/a'}</span>
                <span>Progress</span>
                <span className="text-right text-text-primary">{selectedWorkflowJob.progress}%</span>
                <span>Worker</span>
                <span className="text-right text-text-primary">{selectedWorkflowJob.workerKind}</span>
                <span>Created</span>
                <span className="text-right text-text-primary">{formatDateTime(selectedWorkflowJob.createdAt)}</span>
                <span>Started</span>
                <span className="text-right text-text-primary">{formatDateTime(selectedWorkflowJob.startedAt)}</span>
                <span>Completed</span>
                <span className="text-right text-text-primary">{formatDateTime(selectedWorkflowJob.completedAt)}</span>
              </div>

              <div className="mt-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Recent Events</div>
                {recentWorkflowEvents.length === 0 ? (
                  <div className="text-[11px] text-text-muted">No workflow events recorded.</div>
                ) : (
                  <div className="space-y-2">
                    {recentWorkflowEvents.map((event) => (
                      <div key={event.id} className="rounded-xl bg-black/20 p-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">{event.eventType}</span>
                          <span className="text-text-muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-text-secondary">{event.message || event.scope}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-3">
                <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Recent Failures</div>
                {recentFailureEvents.length === 0 ? (
                  <div className="text-[11px] text-text-muted">No failure events recorded.</div>
                ) : (
                  <div className="space-y-2">
                    {recentFailureEvents.map((event) => (
                      <div key={event.id} className="rounded-xl bg-black/20 p-2 text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">{event.errorCode}</span>
                          <span className="text-text-muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-text-secondary">{event.message}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-white/8 bg-[#141820] p-3">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Saved Evaluations</div>
            {evaluations.length === 0 ? (
              <div className="text-[11px] text-text-muted">No saved evaluation summaries yet.</div>
            ) : (
              <div className="space-y-2">
                {evaluations.slice(0, 5).map((evaluation) => {
                  const summary = parseJson<{ runs?: Array<{ jobId: string; finalClipCount: number; aiAnalysisSucceeded: boolean }> }>(evaluation.summaryJson)
                  return (
                    <div key={evaluation.id} className="rounded-xl bg-black/20 p-2 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-text-primary">
                          {shortId(evaluation.baselineJobId)} vs {shortId(evaluation.candidateJobId)}
                        </span>
                        <span className="text-text-muted">{formatDateTime(evaluation.createdAt)}</span>
                      </div>
                      {summary?.runs && (
                        <div className="mt-1 text-text-secondary">
                          {summary.runs.map((run) => `${shortId(run.jobId)}: ${run.finalClipCount} clips${run.aiAnalysisSucceeded ? ' ai' : ' heuristic'}`).join(' · ')}
                        </div>
                      )}
                      {evaluation.notes && <div className="mt-1 text-text-muted">{evaluation.notes}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </aside>
  )
}
