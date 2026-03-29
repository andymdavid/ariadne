import type {
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload
} from '@shared/types'

export type PipelineJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'pending_resume'

export interface ProcessEpisodeRequestDTO {
  filePath: string
  projectName?: string
}

export type ProcessEpisodeResponseDTO = ProcessingResultPayload

export interface ProcessSourceRequestDTO {
  source: string
  projectName?: string
}

export type ProcessSourceResponseDTO = ProcessingResultPayload

export type ProcessingUpdateEventDTO = ProcessingProgress

export type ProcessingCompleteEventDTO = ProcessingResultPayload

export type ProcessingErrorEventDTO = ProcessingErrorPayload

export interface PipelineJobViewDTO {
  jobId: string
  projectId: string | null
  episodeId: string | null
  status: PipelineJobStatus
  stage: ProcessingProgress['stage']
  progress: number
  message: string
  filePath: string | null
  projectName: string | null
  createdAt: string
  startedAt: string | null
  updatedAt: string
}

export interface GetActivePipelineJobRequestDTO {
  episodeId?: string
  projectId?: string
}

export type GetActivePipelineJobResponseDTO = PipelineJobViewDTO | null

export interface PipelineRunStageDTO {
  stepRunId: string
  stepKey: string
  status: string
  progress: number
  message: string | null
  inputJson: string | null
  outputJson: string | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export interface PipelineRunArtifactDTO {
  id: string
  artifactType: string
  status: string
  filePath: string
  metadataJson: string
  createdAt: string
  completedAt: string | null
}

export interface PipelineRunSummaryDTO {
  jobId: string
  episodeId: string | null
  projectId: string | null
  status: PipelineJobStatus
  createdAt: string
  completedAt: string | null
  updatedAt: string
  startedAt: string | null
  configSnapshotJson: string | null
  heavyStageOutputSummaryJson: string
}

export interface PipelineRunDetailDTO {
  summary: PipelineRunSummaryDTO
  steps: PipelineRunStageDTO[]
  artifacts: PipelineRunArtifactDTO[]
}

export interface GetPipelineRunsForEpisodeRequestDTO {
  episodeId: string
}

export type GetPipelineRunsForEpisodeResponseDTO = PipelineRunSummaryDTO[]

export interface GetPipelineRunRequestDTO {
  jobId: string
}

export type GetPipelineRunResponseDTO = PipelineRunDetailDTO | null
