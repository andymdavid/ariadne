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
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
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
  stage: 'uploading' | 'extracting' | 'transcribing' | 'analyzing' | 'generating' | 'completed';
  progress: number;
  message: string;
  timeRemaining?: number;
  thinkingMessage?: string;
  estimatedTimeRemaining?: number;
  partialTranscript?: string;
  recentTranscriptLines?: string[];
}

export interface APIConfig {
  openRouterKey?: string;
  whisperEndpoint?: string;
  model: 'deepseek-r1' | 'claude-sonnet-4';
}