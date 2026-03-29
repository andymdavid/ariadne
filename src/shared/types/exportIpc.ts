export type ExportJobStatus = 'pending' | 'processing' | 'completed' | 'failed'

export type ExportOutputStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface ExportOptionsDTO {
  aspectRatio: '9:16' | '1:1' | '16:9'
  includeCaptions: boolean
}

export interface ExportOutputDTO {
  id: string
  clipId: string
  filePath: string
  format: string
  resolution: string
  status: ExportOutputStatus
  metadata?: Record<string, unknown>
  error?: string
  createdAt: string
}

export interface ExportJobDTO {
  id: string
  episodeId: string
  clipIds: string[]
  status: ExportJobStatus
  progress: number
  currentClipIndex: number
  totalClips: number
  outputPaths: string[]
  error?: string
}

export interface ExportJobViewDTO {
  job: ExportJobDTO
  outputs?: ExportOutputDTO[]
}

export interface StartExportRequestDTO {
  episodeId: string
  options: ExportOptionsDTO
}

export type StartExportResponseDTO = ExportJobDTO

export interface GetExportJobRequestDTO {
  jobId: string
}

export type GetExportJobResponseDTO = ExportJobDTO | undefined

export interface CancelExportJobRequestDTO {
  jobId: string
}

export type CancelExportJobResponseDTO = boolean

export interface ClearCompletedExportsResponseDTO {
  success: boolean
}

export type ExportProgressEventDTO = ExportJobDTO
