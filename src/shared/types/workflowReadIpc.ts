export interface WorkflowJobViewDTO {
  jobId: string
  jobType: string
  status: string
  workerKind: string
  projectId: string | null
  episodeId: string | null
  clipId: string | null
  parentJobId: string | null
  progress: number
  stage: string | null
  message: string | null
  inputJson: string
  configSnapshotJson: string | null
  leaseOwner: string | null
  leaseExpiresAt: string | null
  heartbeatAt: string | null
  attemptCount: number
  maxAttempts: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowEventDTO {
  id: string
  jobId: string
  stepRunId: string | null
  scope: string
  eventType: string
  message: string | null
  detailJson: string
  createdAt: string
}

export interface FailureEventDTO {
  id: string
  jobId: string
  stepRunId: string | null
  scope: string
  errorCode: string
  message: string
  detailJson: string
  createdAt: string
}

export interface GetWorkflowJobRequestDTO {
  jobId: string
}

export type GetWorkflowJobResponseDTO = WorkflowJobViewDTO | null

export interface GetWorkflowEventsRequestDTO {
  jobId: string
}

export type GetWorkflowEventsResponseDTO = WorkflowEventDTO[]

export interface GetFailureEventsRequestDTO {
  jobId: string
}

export type GetFailureEventsResponseDTO = FailureEventDTO[]
