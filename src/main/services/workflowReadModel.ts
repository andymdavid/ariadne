import { database } from '../database/database'
import type { ExportJobDTO } from '@shared/types/exportIpc'
import type {
  GetPipelineRunResponseDTO,
  GetPipelineRunsForEpisodeResponseDTO,
  PipelineJobViewDTO,
  PipelineRunArtifactDTO,
  PipelineRunDetailDTO,
  PipelineRunStageDTO,
  PipelineRunSummaryDTO
} from '@shared/types/pipelineIpc'
import type {
  FailureEventDTO,
  WorkflowEventDTO,
  WorkflowJobViewDTO
} from '@shared/types/workflowReadIpc'

class WorkflowReadModel {
  getActiveExportJobByEpisode(episodeId: string): ExportJobDTO | undefined {
    const exportJob = database.getActiveExportJobForEpisode(episodeId)
    if (!exportJob) {
      return undefined
    }

    return this.getExportJobById(exportJob.id)
  }

  getExportJobById(jobId: string): ExportJobDTO | undefined {
    const view = database.getDurableExportView(jobId)
    if (!view.job) {
      return undefined
    }

    const outputPaths = view.outputs
      .filter((output) => output.status === 'completed' && !!output.filePath)
      .map((output) => output.filePath)

    let status: ExportJobDTO['status']
    switch (view.job.status) {
      case 'running':
        status = 'processing'
        break
      case 'completed':
        status = 'completed'
        break
      case 'failed':
      case 'cancelled':
      case 'cancel_requested':
        status = 'failed'
        break
      default:
        status = 'pending'
        break
    }

    return {
      id: view.job.id,
      episodeId: view.job.episodeId,
      clipIds: JSON.parse(view.job.clipIdsJson || '[]'),
      status,
      progress: view.job.progress,
      currentClipIndex: view.job.currentClipIndex,
      totalClips: view.job.totalClips,
      outputPaths,
      error: view.job.errorMessage || undefined
    }
  }

  getActivePipelineJob(episodeId?: string, projectId?: string): PipelineJobViewDTO | null {
    const workflowJob = database.getActivePipelineWorkflowJob(episodeId, projectId) as {
      id: string
      projectId: string | null
      episodeId: string | null
      status: PipelineJobViewDTO['status']
      stage: string | null
      progress: number
      message: string | null
      inputJson: string
      createdAt: string
      startedAt: string | null
      updatedAt: string
    } | undefined

    if (!workflowJob) {
      return null
    }

    let filePath: string | null = null
    let projectName: string | null = null

    try {
      const parsedInput = JSON.parse(workflowJob.inputJson) as { filePath?: string; projectName?: string }
      filePath = parsedInput.filePath ?? null
      projectName = parsedInput.projectName ?? null
    } catch {
      filePath = null
      projectName = null
    }

    return {
      jobId: workflowJob.id,
      projectId: workflowJob.projectId,
      episodeId: workflowJob.episodeId,
      status: workflowJob.status,
      stage: this.mapWorkflowStageToUiStage(workflowJob.stage),
      progress: workflowJob.progress,
      message: workflowJob.message ?? 'Processing...',
      filePath,
      projectName,
      createdAt: workflowJob.createdAt,
      startedAt: workflowJob.startedAt,
      updatedAt: workflowJob.updatedAt
    }
  }

  getPipelineRunById(jobId: string): GetPipelineRunResponseDTO {
    const workflowJob = database.getWorkflowJob(jobId)
    if (!workflowJob || workflowJob.jobType !== 'pipeline') {
      return null
    }

    return {
      summary: this.mapPipelineRunSummary(workflowJob),
      steps: database.getWorkflowStepRunsByJob(jobId).map((step): PipelineRunStageDTO => ({
        stepRunId: step.id,
        stepKey: step.stepKey,
        status: step.status,
        progress: step.progress,
        message: step.message,
        inputJson: step.inputJson,
        outputJson: step.outputJson,
        errorCode: step.errorCode,
        errorMessage: step.errorMessage,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        updatedAt: step.updatedAt
      })),
      artifacts: database.getArtifactsByWorkflowJob(jobId).map((artifact): PipelineRunArtifactDTO => ({
        id: artifact.id,
        artifactType: artifact.artifactType,
        status: artifact.status,
        filePath: artifact.filePath,
        metadataJson: artifact.metadataJson,
        createdAt: artifact.createdAt,
        completedAt: artifact.completedAt
      }))
    }
  }

  getPipelineRunsForEpisode(episodeId: string): GetPipelineRunsForEpisodeResponseDTO {
    return database
      .getPipelineWorkflowJobsForEpisode(episodeId)
      .map((workflowJob) => this.mapPipelineRunSummary(workflowJob))
  }

  getWorkflowJobById(jobId: string): WorkflowJobViewDTO | null {
    const workflowJob = database.getWorkflowJob(jobId)
    if (!workflowJob) {
      return null
    }

    return {
      jobId: workflowJob.id,
      jobType: workflowJob.jobType,
      status: workflowJob.status,
      workerKind: workflowJob.workerKind,
      projectId: workflowJob.projectId,
      episodeId: workflowJob.episodeId,
      clipId: workflowJob.clipId,
      parentJobId: workflowJob.parentJobId,
      progress: workflowJob.progress,
      stage: workflowJob.stage,
      message: workflowJob.message,
      inputJson: workflowJob.inputJson,
      configSnapshotJson: workflowJob.configSnapshotJson,
      leaseOwner: workflowJob.leaseOwner,
      leaseExpiresAt: workflowJob.leaseExpiresAt,
      heartbeatAt: workflowJob.heartbeatAt,
      attemptCount: workflowJob.attemptCount,
      maxAttempts: workflowJob.maxAttempts,
      startedAt: workflowJob.startedAt,
      completedAt: workflowJob.completedAt,
      createdAt: workflowJob.createdAt,
      updatedAt: workflowJob.updatedAt
    }
  }

  getWorkflowEvents(jobId: string): WorkflowEventDTO[] {
    return database.getWorkflowEventsByJob(jobId).map((event) => ({
      id: event.id,
      jobId: event.jobId,
      stepRunId: event.stepRunId,
      scope: event.scope,
      eventType: event.eventType,
      message: event.message,
      detailJson: event.detailJson,
      createdAt: event.createdAt
    }))
  }

  getFailureEvents(jobId: string): FailureEventDTO[] {
    return database.getFailureEventsByJob(jobId).map((event) => ({
      id: event.id,
      jobId: event.jobId,
      stepRunId: event.stepRunId,
      scope: event.scope,
      errorCode: event.errorCode,
      message: event.message,
      detailJson: event.detailJson,
      createdAt: event.createdAt
    }))
  }

  private mapWorkflowStageToUiStage(stage: string | null): PipelineJobViewDTO['stage'] {
    switch (stage) {
      case 'queued':
      case 'source_resolve_or_import':
      case 'uploading':
        return 'uploading'
      case 'media_probe':
      case 'audio_extract':
      case 'extracting':
        return 'extracting'
      case 'transcription':
      case 'transcribing':
        return 'transcribing'
      case 'clip_generation':
      case 'clip_ranking':
      case 'analyzing':
        return 'analyzing'
      case 'content_package_generation':
      case 'generating':
        return 'generating'
      case 'completed':
        return 'completed'
      default:
        return 'uploading'
    }
  }

  private mapPipelineRunSummary(workflowJob: {
    id: string
    episodeId: string | null
    projectId: string | null
    status: PipelineJobViewDTO['status']
    createdAt: string
    completedAt: string | null
    updatedAt: string
    startedAt: string | null
    configSnapshotJson: string | null
  }): PipelineRunSummaryDTO {
    const stepRuns = database.getWorkflowStepRunsByJob(workflowJob.id)

    return {
      jobId: workflowJob.id,
      episodeId: workflowJob.episodeId,
      projectId: workflowJob.projectId,
      status: workflowJob.status,
      createdAt: workflowJob.createdAt,
      completedAt: workflowJob.completedAt,
      updatedAt: workflowJob.updatedAt,
      startedAt: workflowJob.startedAt,
      configSnapshotJson: workflowJob.configSnapshotJson,
      heavyStageOutputSummaryJson: JSON.stringify({
        transcription: this.extractStageSummary(stepRuns, 'transcription'),
        clipGeneration: this.extractStageSummary(stepRuns, 'clip_generation'),
        clipRanking: this.extractStageSummary(stepRuns, 'clip_ranking'),
        contentPackageGeneration: this.extractStageSummary(stepRuns, 'content_package_generation')
      })
    }
  }

  private extractStageSummary(
    stepRuns: Array<{ stepKey: string; status: string; outputJson: string | null }>,
    stepKey: string
  ) {
    const step = stepRuns.find((candidate) => candidate.stepKey === stepKey)
    if (!step) {
      return null
    }

    if (!step.outputJson) {
      return { status: step.status }
    }

    try {
      const parsed = JSON.parse(step.outputJson) as Record<string, unknown>
      const { transcription, candidates, analysis, contentPackages, ...summary } = parsed
      return {
        status: step.status,
        ...summary
      }
    } catch {
      return { status: step.status }
    }
  }
}

export const workflowReadModel = new WorkflowReadModel()
