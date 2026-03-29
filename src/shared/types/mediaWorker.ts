export interface MediaInfoDTO {
  duration: number
  hasVideo: boolean
  hasAudio: boolean
  videoCodec?: string
  audioCodec?: string
  resolution?: { width: number; height: number }
  frameRate?: number
  bitrate?: number
}

export interface ProbeMediaCommand {
  type: 'probe_media'
  requestId: string
  inputPath: string
}

export interface ExtractAudioCommand {
  type: 'extract_audio'
  requestId: string
  inputPath: string
  outputPath?: string
}

export interface ExtractPreviewClipCommand {
  type: 'extract_preview_clip'
  requestId: string
  inputPath: string
  startTime: number
  duration: number
  outputPath: string
}

export type MediaWorkerCommand =
  | ProbeMediaCommand
  | ExtractAudioCommand
  | ExtractPreviewClipCommand

export interface MediaProgressEvent {
  type: 'media_progress'
  requestId: string
  operation: 'extract_audio' | 'extract_preview_clip'
  progress: number
  message: string
}

export interface ProbeMediaCompletedEvent {
  type: 'probe_media_completed'
  requestId: string
  mediaInfo: MediaInfoDTO
}

export interface ExtractAudioCompletedEvent {
  type: 'extract_audio_completed'
  requestId: string
  outputPath: string
}

export interface ExtractPreviewClipCompletedEvent {
  type: 'extract_preview_clip_completed'
  requestId: string
  outputPath: string
}

export interface MediaFailedEvent {
  type: 'media_failed'
  requestId: string
  operation: 'probe_media' | 'extract_audio' | 'extract_preview_clip'
  errorCode: 'probe_failed' | 'audio_extract_failed' | 'preview_extract_failed' | 'media_failed'
  message: string
}

export type MediaWorkerEvent =
  | MediaProgressEvent
  | ProbeMediaCompletedEvent
  | ExtractAudioCompletedEvent
  | ExtractPreviewClipCompletedEvent
  | MediaFailedEvent
