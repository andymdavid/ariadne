import type { APIConfig } from '@shared/types'

export type PipelineWorkerStageKey =
  | 'transcription'
  | 'clip_generation'
  | 'clip_ranking'
  | 'content_package_generation'

export interface PipelineWorkerWord {
  word: string
  start: number
  end: number
}

export interface PipelineWorkerTranscriptSegment {
  id: number
  start: number
  end: number
  text: string
  words?: PipelineWorkerWord[]
}

export interface PipelineWorkerTranscription {
  text: string
  segments: PipelineWorkerTranscriptSegment[]
  language?: string
}

export interface PipelineWorkerPotentialClip {
  id: string
  startTime: number
  endTime: number
  duration: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  shareabilityScore: number
  keyQuote: string
  reason: string
  contextNeeded: 'low' | 'medium' | 'high'
}

export interface PipelineWorkerContentPackage {
  clipIndex: number
  titles: string[]
  description: string
}

export interface StartPipelineWorkerCommand {
  type: 'start_pipeline'
  workflowJobId: string
  audioPath: string
  mediaDuration: number
  apiConfig: APIConfig | null
  brandVoiceExamples: string[]
}

export interface PipelineWorkerStageStartedEvent {
  type: 'pipeline_stage_started'
  workflowJobId: string
  stage: PipelineWorkerStageKey
  message: string
}

export interface PipelineWorkerProgressEvent {
  type: 'pipeline_progress'
  workflowJobId: string
  stage: PipelineWorkerStageKey
  progress: number
  message: string
  partialTranscript?: string
  recentTranscriptLines?: string[]
  timeRemaining?: number
}

export interface PipelineWorkerStageCompletedEvent {
  type: 'pipeline_stage_completed'
  workflowJobId: string
  stage: PipelineWorkerStageKey
  output: Record<string, unknown>
}

export interface PipelineWorkerCompletedEvent {
  type: 'pipeline_completed'
  workflowJobId: string
  transcription: PipelineWorkerTranscription
  analysis: {
    potentialClips: PipelineWorkerPotentialClip[]
  }
  aiAnalysisSucceeded: boolean
  contentPackages: PipelineWorkerContentPackage[]
}

export interface PipelineWorkerFailureEvent {
  type: 'pipeline_failed'
  workflowJobId: string
  stage?: PipelineWorkerStageKey
  message: string
  errorCode:
    | 'transcription_failed'
    | 'clip_generation_failed'
    | 'clip_ranking_failed'
    | 'content_package_generation_failed'
    | 'pipeline_failed'
}

export type PipelineWorkerCommand = StartPipelineWorkerCommand

export type PipelineWorkerEvent =
  | PipelineWorkerStageStartedEvent
  | PipelineWorkerProgressEvent
  | PipelineWorkerStageCompletedEvent
  | PipelineWorkerCompletedEvent
  | PipelineWorkerFailureEvent
