export interface ExportCaptionSegment {
  text: string
  start: number
  end: number
  words?: Array<{
    word: string
    start: number
    end: number
  }>
}

export interface ExportCaptionOverlayFrame {
  imagePath: string
  start: number
  end: number
}

export interface ExportCaptionStyle {
  enabled: boolean
  font: string
  size: number
  color: string
  textColor?: string
  highlightColor?: string
  position: string
  customX?: number
  customY?: number
  weight: number
  italic: boolean
  underline?: boolean
  outline: boolean
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  highlightStyle: string
  background: boolean
  backgroundColor: string
  backgroundOpacity: number
  backgroundPaddingX?: number
  backgroundPaddingY?: number
  backgroundRadius?: number
  textCase: string
  wordsPerCaption: number
  maxWidth: number
  lineHeight: number
  letterSpacing: number
  lineMode?: 'one-line' | 'three-lines'
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  shadowBlur?: number
}

export interface ExportLogoSettings {
  enabled: boolean
  logoPath: string | null
  positionX: number
  positionY: number
  scale: number
  opacity: number
}

export interface ExportMusicSettings {
  enabled: boolean
  musicPath: string | null
  volume: number
  duckVolume: number
  duckEnabled: boolean
  fadeIn: number
  fadeOut: number
  loop: boolean
}

export interface ExportFrameSettings {
  aspectRatio: '9:16' | '1:1' | '16:9'
  cropMode: 'center' | 'fit' | 'blur'
  cropPositionX: number
  cropPositionY: number
  zoomLevel?: number
  videoOffsetX?: number
  videoOffsetY?: number
  videoWidth?: number | null
  videoHeight?: number | null
}

export interface ExportRenderTask {
  clipId: string
  clipIndex: number
  totalClips: number
  sourceMediaPath: string
  startTime: number
  duration: number
  outputPath: string
  resolution: '9:16' | '1:1' | '16:9'
  captionSegments: ExportCaptionSegment[]
  captionOverlayFrames?: ExportCaptionOverlayFrame[]
  captionStyle?: ExportCaptionStyle
  logoSettings?: ExportLogoSettings
  musicSettings?: ExportMusicSettings
  frameSettings: ExportFrameSettings
}

export interface StartExportWorkerCommand {
  type: 'start_export'
  exportJobId: string
  workflowJobId: string
  tasks: ExportRenderTask[]
}

export interface CancelExportWorkerCommand {
  type: 'cancel_export'
  exportJobId: string
}

export interface ExportWorkerProgressEvent {
  type: 'export_progress'
  exportJobId: string
  workflowJobId: string
  clipId: string
  clipIndex: number
  totalClips: number
  clipProgress: number
  overallProgress: number
  outputPath: string
}

export interface ExportWorkerClipCompleteEvent {
  type: 'export_clip_complete'
  exportJobId: string
  workflowJobId: string
  clipId: string
  clipIndex: number
  totalClips: number
  outputPath: string
  resolution: '9:16' | '1:1' | '16:9'
}

export interface ExportWorkerFailureEvent {
  type: 'export_failed'
  exportJobId: string
  workflowJobId: string
  clipId?: string
  clipIndex?: number
  message: string
  errorCode: 'cancelled' | 'export_failed'
}

export interface ExportWorkerClipFailureEvent {
  type: 'export_clip_failed'
  exportJobId: string
  workflowJobId: string
  clipId: string
  clipIndex: number
  totalClips: number
  message: string
}

export interface ExportWorkerCompletedEvent {
  type: 'export_completed'
  exportJobId: string
  workflowJobId: string
  outputPaths: string[]
}

export type ExportWorkerCommand =
  | StartExportWorkerCommand
  | CancelExportWorkerCommand

export type ExportWorkerEvent =
  | ExportWorkerProgressEvent
  | ExportWorkerClipCompleteEvent
  | ExportWorkerClipFailureEvent
  | ExportWorkerFailureEvent
  | ExportWorkerCompletedEvent
