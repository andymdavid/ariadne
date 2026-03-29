import type {
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload
} from '@shared/types'

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
