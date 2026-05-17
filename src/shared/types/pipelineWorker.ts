import type { APIConfig, ClipMetadataAnalysisDraft } from '@shared/types'
import type { CandidateArc, EditorialUnit } from '../editorialUnits'

export type PipelineWorkerStageKey =
  | 'transcription'
  | 'clip_generation'
  | 'clip_ranking'
  | 'content_package_generation'

export interface PipelineRunConfigSnapshot {
  apiModelAlias: APIConfig['model'] | null
  apiModelId: string | null
  clipSelectionPlatform: APIConfig['clipSelectionPlatform']
  openRouterConfigured: boolean
  productionSelectorMode: 'legacy' | 'arc_v1' | 'llm_thread_v1'
  enableLegacyResolvedClipProposal: boolean
  enableLegacyTranscriptLineAgent: boolean
  enableLegacyBoundaryProposal: boolean
  enableLegacyCandidateRanking: boolean
  enableHeuristicSupplementation: boolean
  maxClipsPerEpisode: number
  brandVoiceExampleCount: number
  brandVoicePreferences: {
    tone: 'casual' | 'professional' | 'conversational'
    style: 'direct' | 'storytelling' | 'question_based'
  }
  localWhisperModel: string
  candidateGeneratorVersion: string
  rankingPromptVersion: string
  rankingImplementationVersion: string
  contentPromptVersion: string
  uploadedTranscriptPath?: string | null
  uploadedTranscriptFileName?: string | null
  uploadedTranscriptKind?: 'txt' | 'srt' | 'vtt' | null
}

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
  selectionDecisionId?: string | null
  sourceArcId?: string | null
  startTime: number
  endTime: number
  duration: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  shareabilityScore: number
  keyQuote: string
  reason: string
  contextNeeded: 'low' | 'medium' | 'high'
}

export interface PipelineWorkerCandidate {
  id: string
  startTime: number
  endTime: number
  duration: number
  text: string
  segmentStartIndex: number
  segmentEndIndex: number
  openingLine: string
  closingLine: string
  naturalStart: boolean
  naturalEnd: boolean
  heuristicScore: number
}

export interface PipelineWorkerContentPackage {
  clipIndex: number
  titles: string[]
  description: string
  metadataAnalysis: ClipMetadataAnalysisDraft | null
}

export interface PipelineWorkerSelectionDecision {
  id: string
  candidateArcId?: string | null
  decision: 'selected' | 'rejected' | 'fallback_selected'
  rankOrder?: number | null
  modelScore?: number | null
  finalScore?: number | null
  rejectionCode?: string | null
  reason?: string | null
  validatorResultJson?: string | null
}

export interface StartPipelineWorkerCommand {
  type: 'start_pipeline'
  workflowJobId: string
  audioPath: string
  mediaDuration: number
  apiConfig: APIConfig | null
  brandVoiceExamples: string[]
  runConfigSnapshot: PipelineRunConfigSnapshot
  startStage: PipelineWorkerStageKey
  resumeData?: {
    transcription?: PipelineWorkerTranscription
    candidates?: PipelineWorkerCandidate[]
    editorialUnits?: EditorialUnit[]
    candidateArcs?: CandidateArc[]
    selectionDecisions?: PipelineWorkerSelectionDecision[]
    analysis?: {
      potentialClips: PipelineWorkerPotentialClip[]
    }
    aiAnalysisSucceeded?: boolean
    contentPackages?: PipelineWorkerContentPackage[]
  }
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
  editorialUnits?: EditorialUnit[]
  candidateArcs?: CandidateArc[]
  selectionDecisions?: PipelineWorkerSelectionDecision[]
  selectionMetadata?: Record<string, unknown>
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
