export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Episode {
  id: string;
  projectId: string;
  fileName: string;
  filePath: string;
  duration: number;
  frameRate?: number | null;
  createdAt: string;
  processingStatus: 'pending' | 'transcribing' | 'analyzing' | 'completed' | 'error';
}

export interface TranscriptSegment {
  id: string;
  episodeId: string;
  start: number;
  end: number;
  text: string;
  confidence: number;
  speaker?: string;
}

export interface Clip {
  id: string;
  episodeId: string;
  startTime: number;
  endTime: number;
  duration: number;
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical';
  shareabilityScore: number;
  keyQuote: string;
  reason: string;
  contextNeeded: 'low' | 'medium' | 'high';
  videoWidth?: number | null;
  videoHeight?: number | null;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

export type TrimBoundaryType =
  | 'free'
  | 'frame'
  | 'word_start'
  | 'word_end'
  | 'segment_start'
  | 'segment_end'
  | 'silence_start'
  | 'silence_end';

export interface TrimBoundaryAnchor {
  type: TrimBoundaryType;
  sourceId?: string | null;
  time: number;
  confidence?: number | null;
  label?: string | null;
}

export interface ClipTrimState {
  clipId: string;
  inPoint: number;
  outPoint: number;
  inAnchorType?: TrimBoundaryType | null;
  inAnchorSourceId?: string | null;
  inAnchorLabel?: string | null;
  inAnchorConfidence?: number | null;
  outAnchorType?: TrimBoundaryType | null;
  outAnchorSourceId?: string | null;
  outAnchorLabel?: string | null;
  outAnchorConfidence?: number | null;
  updatedAt: string;
}

export interface ContentPackage {
  id: string;
  clipId: string;
  titles: string[];
  description: string;
  thumbnailTimestamp?: number;
  metadata: {
    duration: string;
    contentType: string;
    confidenceScore: number;
  };
  createdAt: string;
}

export interface ProcessingProgress {
  jobId?: string;
  stage: 'uploading' | 'extracting' | 'transcribing' | 'analyzing' | 'generating' | 'completed';
  progress: number;
  stageProgress?: number;
  message: string;
  timeRemaining?: number;
  thinkingMessage?: string;
  estimatedTimeRemaining?: number;
  partialTranscript?: string;
  recentTranscriptLines?: string[];
}

export interface ProcessingResultPayload {
  jobId?: string;
  projectId: string;
  episodeId: string;
  clipsFound: number;
  processingTime: number;
  aiAnalysisSucceeded?: boolean;
  hasTranscript?: boolean;
}

export interface ProcessingErrorPayload {
  jobId?: string;
  message: string;
}

export interface APIConfig {
  openRouterKey?: string;
  whisperEndpoint?: string;
  model:
    | 'google-gemini-2.5-flash'
    | 'google-gemini-2.5-pro'
    | 'anthropic-claude-sonnet-4.6'
    | 'openai-gpt-5.4'
    | 'deepseek-r1'
    | 'google-gemini-2.5-flash-lite';
  clipSelectionPlatform: 'youtube_shorts' | 'instagram_reels' | 'tiktok';
}

export interface BrandTemplateCaptionDefaults {
  presetId: string;
  text: string;
  font: string;
  fontSize: number;
  fontWeight: '500' | '600' | '700' | '800';
  italic: boolean;
  underline: boolean;
  uppercase: boolean;
  position: 'top' | 'center' | 'bottom' | 'custom';
  customX?: number | null;
  customY?: number | null;
  animation: 'box';
  lineMode: 'one-line' | 'three-lines';
  backgroundEnabled: boolean;
  highlightColor: string;
  backgroundColor: string;
  strokeColor: string;
  strokeWidth: number;
  shadowEnabled: boolean;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  shadowBlur: number;
}

export interface BrandTemplateLogoDefaults {
  enabled: boolean;
  assetPath: string | null;
  positionX: number;
  positionY: number;
  scale: number;
  opacity: number;
}

export interface BrandTemplateMusicDefaults {
  enabled: boolean;
  assetPath: string | null;
  volume: number;
  duckEnabled: boolean;
}

export interface BrandTemplateFrameDefaults {
  aspectRatio: '9:16' | '1:1' | '16:9';
  cropMode: 'fit' | 'center' | 'blur';
}

export interface BrandTemplateAiDefaults {
  removeFillerWords: boolean;
  removePauses: boolean;
  keywordHighlighter: boolean;
  emojis: boolean;
  stockBroll: boolean;
}

export interface BrandTemplate {
  caption: BrandTemplateCaptionDefaults;
  logo: BrandTemplateLogoDefaults;
  music: BrandTemplateMusicDefaults;
  frame: BrandTemplateFrameDefaults;
  ai: BrandTemplateAiDefaults;
  updatedAt: string;
}
