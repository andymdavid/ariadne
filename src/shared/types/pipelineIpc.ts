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
