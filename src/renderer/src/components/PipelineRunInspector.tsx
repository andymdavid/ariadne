import { useEffect, useMemo, useState } from 'react'
import type {
  GetPipelineRunEvaluationsResponseDTO,
  GetPipelineRunsForEpisodeResponseDTO,
  PipelineComparableRunSummaryDTO,
  PipelineRunSelectionDecisionDTO,
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

type CoherentRoughCutsReport = {
  clipsReviewed?: number
  boundaryVariantsGenerated?: number
  reviewableRoughCuts?: number
  rejectedAfterRepair?: number
  repairedStartCount?: number
  repairedEndCount?: number
  abruptStartFailures?: number
  unresolvedEndingFailures?: number
  missingContextFailures?: number
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

function formatSeconds(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a'
  }

  return `${value.toFixed(1)}s`
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

function formatCompactValue(value: unknown): string {
  if (value == null) {
    return 'null'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function summarizeDetail(value: Record<string, unknown> | null) {
  if (!value) {
    return null
  }

  const entries = Object.entries(value).slice(0, 4)
  if (entries.length === 0) {
    return null
  }

  return entries
    .map(([key, entryValue]) => `${key}: ${formatCompactValue(entryValue)}`)
    .join(' · ')
}

function formatDecisionLabel(decision: PipelineRunSelectionDecisionDTO['decision']) {
  switch (decision) {
    case 'selected':
      return 'Selected'
    case 'fallback_selected':
      return 'Fallback'
    default:
      return 'Rejected'
  }
}

function getStepOutput(selectedRun: PipelineRunDetailDTO | null, stepKey: string) {
  return parseJson<Record<string, unknown>>(
    selectedRun?.steps.find((step) => step.stepKey === stepKey)?.outputJson
  )
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
  const [isExpanded, setIsExpanded] = useState(false)

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
  const selectedSelection = selectedRun?.selection ?? null
  const selectionSummary = parseJson<Record<string, unknown>>(selectedSelection?.summaryJson)
  const clipRankingOutput = getStepOutput(selectedRun, 'clip_ranking')
  const clipRankingMetadata = clipRankingOutput && typeof clipRankingOutput.metadata === 'object'
    ? clipRankingOutput.metadata as Record<string, unknown>
    : null
  const coherentRoughCutsReport = clipRankingMetadata?.coherentRoughCutsReport &&
    typeof clipRankingMetadata.coherentRoughCutsReport === 'object'
    ? clipRankingMetadata.coherentRoughCutsReport as CoherentRoughCutsReport
    : null
  const selectedDecisions = (selectedSelection?.decisions ?? [])
    .filter((decision) => decision.decision !== 'rejected')
    .sort((left, right) => (left.rankOrder ?? Number.MAX_SAFE_INTEGER) - (right.rankOrder ?? Number.MAX_SAFE_INTEGER))
  const rejectedDecisions = (selectedSelection?.decisions ?? [])
    .filter((decision) => decision.decision === 'rejected')
    .sort((left, right) => (right.finalScore ?? -1) - (left.finalScore ?? -1))
  const recentWorkflowEvents = workflowEvents.slice(0, 5)
  const recentFailureEvents = failureEvents.slice(0, 5)

  return (
    <aside className="inspector-panel text-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.24em] text-text-primary">Run Inspection</h3>
          <p className="mt-1 text-xs text-text-muted">
            Inspect durable pipeline runs, saved evaluations, and workflow diagnostics for this episode.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
          className="inspector-toggle"
        >
          {isExpanded ? 'Hide' : 'Inspect'}
        </button>
      </div>

      {!isExpanded ? (
        <div className="inspector-note text-[11px] text-text-muted">
          Open this panel to compare recorded runs, inspect workflow events, and review saved evaluation summaries.
        </div>
      ) : loading ? (
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
                className={`inspector-item ${
                  selectedJobId === run.jobId
                    ? 'is-active text-text-primary'
                    : ''
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-text-primary">{shortId(run.jobId)}</span>
                  <span className="inspector-pill">
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
            <div className="inspector-card">
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
                <div className="inspector-subcard mt-3 text-[11px] text-text-muted">
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
                      <div key={clip.id} className="inspector-subcard">
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

          {selectedSelection && (
            <div className="inspector-card">
              <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Selection Provenance</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <span>Selection Run</span>
                <span className="font-mono text-right text-text-primary">{shortId(selectedSelection.selectionRunId)}</span>
                <span>Selector</span>
                <span className="text-right text-text-primary">{selectedSelection.selectorVersion}</span>
                <span>Status</span>
                <span className="text-right text-text-primary">{selectedSelection.status}</span>
                <span>Mode</span>
                <span className="text-right text-text-primary">{selectedSelection.productionMode}</span>
                <span>Editorial Units</span>
                <span className="text-right text-text-primary">{selectedSelection.editorialUnitCount}</span>
                <span>Candidate Arcs</span>
                <span className="text-right text-text-primary">{selectedSelection.candidateArcCount}</span>
                <span>Selected</span>
                <span className="text-right text-text-primary">{selectedSelection.selectedCount}</span>
                <span>Fallback Selected</span>
                <span className="text-right text-text-primary">{selectedSelection.fallbackSelectedCount}</span>
                <span>Rejected</span>
                <span className="text-right text-text-primary">{selectedSelection.rejectedCount}</span>
              </div>

              {selectionSummary && (
                <div className="inspector-subcard mt-3 text-[11px] text-text-muted">
                  <div>Selection summary</div>
                  <div className="mt-1 text-text-primary">{summarizeDetail(selectionSummary) ?? 'No summary recorded'}</div>
                </div>
              )}

              {clipRankingMetadata && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Final Validator</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                    <span>Executor</span>
                    <span className="text-right text-text-primary">{String(clipRankingMetadata.executor ?? 'n/a')}</span>
                    <span>Word Adjustments</span>
                    <span className="text-right text-text-primary">{String(clipRankingMetadata.wordBoundaryAdjustmentCount ?? 0)}</span>
                    <span>Accepted</span>
                    <span className="text-right text-text-primary">{String(clipRankingMetadata.finalBoundaryValidatorAcceptedCount ?? 0)}</span>
                    <span>Rejected</span>
                    <span className="text-right text-text-primary">{String(clipRankingMetadata.finalBoundaryValidatorRejectedCount ?? 0)}</span>
                    <span>Recovery Attempted</span>
                    <span className="text-right text-text-primary">{clipRankingMetadata.fallbackBoundaryRecoveryAttempted ? 'yes' : 'no'}</span>
                    <span>Recovery Succeeded</span>
                    <span className="text-right text-text-primary">{clipRankingMetadata.fallbackBoundaryRecoverySucceeded ? 'yes' : 'no'}</span>
                  </div>
                  {coherentRoughCutsReport && (
                    <div className="inspector-subcard mt-3 text-[11px]">
                      <div className="mb-2 uppercase tracking-[0.2em] text-text-muted">Coherent Rough Cuts</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                        <span>Reviewed</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.clipsReviewed ?? 0)}</span>
                        <span>Variants</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.boundaryVariantsGenerated ?? 0)}</span>
                        <span>Rough Cuts</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.reviewableRoughCuts ?? 0)}</span>
                        <span>Rejected After Repair</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.rejectedAfterRepair ?? 0)}</span>
                        <span>Start Repairs</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.repairedStartCount ?? 0)}</span>
                        <span>End Repairs</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.repairedEndCount ?? 0)}</span>
                        <span>Abrupt Starts</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.abruptStartFailures ?? 0)}</span>
                        <span>Unresolved Ends</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.unresolvedEndingFailures ?? 0)}</span>
                        <span>Missing Context</span>
                        <span className="text-right text-text-primary">{String(coherentRoughCutsReport.missingContextFailures ?? 0)}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {selectedDecisions.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Selected Arcs</div>
                  <div className="space-y-2">
                    {selectedDecisions.slice(0, 6).map((decision) => {
                      const scores = parseJson<Record<string, number>>(decision.arc?.scoresJson)
                      const validatorResult = parseJson<Record<string, unknown>>(decision.validatorResultJson)
                      const validatorStatus = typeof validatorResult?.status === 'string' ? validatorResult.status : null
                      return (
                        <div key={decision.id} className="inspector-subcard text-[11px]">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-text-primary">
                              {decision.rankOrder ? `#${decision.rankOrder}` : 'Unranked'} · {formatDecisionLabel(decision.decision)}
                            </span>
                            <span className="text-text-muted">
                              {formatSeconds(decision.arc?.startTime)} - {formatSeconds(decision.arc?.endTime)}
                            </span>
                          </div>
                          <div className="mt-1 text-text-secondary">
                            {decision.arc?.summary || decision.arc?.topic || decision.arc?.keyQuote || decision.reason || 'No arc summary recorded'}
                          </div>
                          <div className="mt-1 text-text-muted">
                            score {decision.finalScore?.toFixed(1) ?? 'n/a'}
                            {scores?.overall != null ? ` · overall ${(Number(scores.overall) * 10).toFixed(1)}` : ''}
                            {scores?.hookStrength != null ? ` · hook ${Number(scores.hookStrength).toFixed(2)}` : ''}
                            {scores?.payoffStrength != null ? ` · payoff ${Number(scores.payoffStrength).toFixed(2)}` : ''}
                          </div>
                          {validatorStatus && (
                            <div className="mt-1 text-text-muted">
                              Validator {validatorStatus}
                              {typeof validatorResult?.score === 'number' ? ` · score ${Number(validatorResult.score).toFixed(1)}` : ''}
                            </div>
                          )}
                          {decision.reason && <div className="mt-1 text-text-muted">{decision.reason}</div>}
                          {(validatorResult && Object.keys(validatorResult).length > 0) && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-text-muted">Validator detail</summary>
                              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-text-muted">
                                {JSON.stringify(validatorResult, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {rejectedDecisions.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Rejected Arcs</div>
                  <div className="space-y-2">
                    {rejectedDecisions.slice(0, 6).map((decision) => (
                      <div key={decision.id} className="inspector-subcard text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">{decision.rejectionCode || formatDecisionLabel(decision.decision)}</span>
                          <span className="text-text-muted">
                            {decision.finalScore?.toFixed(1) ?? 'n/a'}
                            {decision.arc ? ` · ${formatSeconds(decision.arc.startTime)} - ${formatSeconds(decision.arc.endTime)}` : ''}
                          </span>
                        </div>
                        <div className="mt-1 text-text-secondary">
                          {decision.arc?.summary || decision.arc?.topic || decision.arc?.keyQuote || 'No arc summary recorded'}
                        </div>
                        {decision.reason && <div className="mt-1 text-text-muted">{decision.reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedWorkflowJob && (
            <div className="inspector-card">
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
                      <div key={event.id} className="inspector-subcard text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">{event.eventType}</span>
                          <span className="text-text-muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-text-secondary">{event.message || event.scope}</div>
                        {parseJson<Record<string, unknown>>(event.detailJson) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-text-muted">
                              {summarizeDetail(parseJson<Record<string, unknown>>(event.detailJson)) ?? 'View detail'}
                            </summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-text-muted">
                              {JSON.stringify(parseJson<Record<string, unknown>>(event.detailJson), null, 2)}
                            </pre>
                          </details>
                        )}
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
                      <div key={event.id} className="inspector-subcard text-[11px]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-text-primary">{event.errorCode}</span>
                          <span className="text-text-muted">{formatDateTime(event.createdAt)}</span>
                        </div>
                        <div className="mt-1 text-text-secondary">{event.message}</div>
                        {parseJson<Record<string, unknown>>(event.detailJson) && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-text-muted">
                              {summarizeDetail(parseJson<Record<string, unknown>>(event.detailJson)) ?? 'View detail'}
                            </summary>
                            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] text-text-muted">
                              {JSON.stringify(parseJson<Record<string, unknown>>(event.detailJson), null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="inspector-card">
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">Saved Evaluations</div>
            {evaluations.length === 0 ? (
              <div className="text-[11px] text-text-muted">No saved evaluation summaries yet.</div>
            ) : (
              <div className="space-y-2">
                {evaluations.slice(0, 5).map((evaluation) => {
                  const summary = parseJson<{ runs?: Array<{ jobId: string; finalClipCount: number; aiAnalysisSucceeded: boolean }> }>(evaluation.summaryJson)
                  return (
                    <div key={evaluation.id} className="inspector-subcard text-[11px]">
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
