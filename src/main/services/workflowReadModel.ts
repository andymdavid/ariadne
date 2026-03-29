import { database } from '../database/database'
import type { ExportJobDTO } from '@shared/types/exportIpc'
import type { PipelineJobViewDTO } from '@shared/types/pipelineIpc'
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
      .filter((output: any) => output.status === 'completed' && output.filePath)
      .map((output: any) => output.filePath)

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

  getWorkflowJobById(jobId: string): WorkflowJobViewDTO | null {
    const workflowJob = database.getWorkflowJob(jobId) as any
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
    return (database.getWorkflowEventsByJob(jobId) as any[]).map((event) => ({
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
    return (database.getFailureEventsByJob(jobId) as any[]).map((event) => ({
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
}

export const workflowReadModel = new WorkflowReadModel()
