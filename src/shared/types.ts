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
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
}

export interface TranscriptLine {
  id: string;
  episodeId: string;
  lineIndex: number;
  start: number;
  end: number;
  text: string;
  words?: Array<{
    word: string;
    start: number;
    end: number;
  }>;
  sourceStrategy: string;
  createdAt: string;
  updatedAt: string;
}

export type ClipReviewStatus = 'pending_review' | 'approved_by_user' | 'rejected_by_user';
export type LegacyClipReviewStatus = 'pending' | 'approved' | 'rejected';
export type ClipStatus = ClipReviewStatus | LegacyClipReviewStatus;

export function normalizeClipStatus(status?: string | null): ClipReviewStatus {
  switch (status) {
    case 'approved':
    case 'approved_by_user':
      return 'approved_by_user';
    case 'rejected':
    case 'rejected_by_user':
      return 'rejected_by_user';
    case 'pending':
    case 'pending_review':
    default:
      return 'pending_review';
  }
}

export function isClipApproved(status?: string | null): boolean {
  return normalizeClipStatus(status) === 'approved_by_user';
}

export function isClipRejected(status?: string | null): boolean {
  return normalizeClipStatus(status) === 'rejected_by_user';
}

export function isClipPendingReview(status?: string | null): boolean {
  return normalizeClipStatus(status) === 'pending_review';
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
  status: ClipReviewStatus;
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

export type ClipBoundaryQuality =
  | 'unreviewed'
  | 'usable'
  | 'trim_start'
  | 'trim_end'
  | 'extend_start'
  | 'extend_end'
  | 'reject';

export interface ClipReviewFeedback {
  clipId: string;
  startQuality: ClipBoundaryQuality;
  endQuality: ClipBoundaryQuality;
  notes?: string | null;
  suggestedStartTime?: number | null;
  suggestedEndTime?: number | null;
  updatedAt: string;
}

export interface ClipTranscriptContextLine {
  id: string;
  index: number;
  start: number;
  end: number;
  text: string;
  relation: 'previous' | 'selected' | 'next';
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

export interface ClipMetadataAnalysisDraft {
  primaryTopic: string;
  coreClaim: string;
  supportingPoints: string[];
  audienceAngle: string;
  whyItMatters: string;
  tone: string;
  keyEntities: string[];
  riskFlags: string[];
  sourceExcerptRefs: string[];
  provider: string;
  modelId: string;
  rawResponseJson?: string | null;
}

export interface ClipMetadataAnalysis extends ClipMetadataAnalysisDraft {
  id: string;
  clipId: string;
  createdAt: string;
  updatedAt: string;
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
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  backgroundPaddingX: number;
  backgroundPaddingY: number;
  backgroundRadius: number;
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

export interface BrandTemplateIntroOutroDefaults {
  introPath: string | null;
  outroPath: string | null;
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
  introOutro: BrandTemplateIntroOutroDefaults;
  frame: BrandTemplateFrameDefaults;
  ai: BrandTemplateAiDefaults;
  updatedAt: string;
}

export interface BrandTemplatePreset {
  id: string;
  name: string;
  template: BrandTemplate;
  createdAt: string;
  updatedAt: string;
}

export type PublishingPlatform = 'youtube';

export type PublishingAccountAuthStatus =
  | 'not_connected'
  | 'connected'
  | 'expired'
  | 'revoked'
  | 'error';

export type SlotStrategy = 'fixed' | 'regional_weighted' | 'adaptive';

export type CalendarSlotStatus =
  | 'empty'
  | 'reserved'
  | 'scheduled'
  | 'blocked'
  | 'published';

export type ScheduledPublicationStatus =
  | 'draft'
  | 'waiting_for_export'
  | 'waiting_for_metadata'
  | 'waiting_for_thumbnail'
  | 'ready_to_push'
  | 'scheduling_on_platform'
  | 'scheduled_on_platform'
  | 'published'
  | 'failed'
  | 'cancelled'
  | 'outdated';

export type TargetRegion =
  | 'aus_nz'
  | 'europe'
  | 'united_states'
  | 'global_fallback';

export interface PublishingAccount {
  id: string;
  platform: PublishingPlatform;
  channelId: string;
  channelName: string;
  channelHandle?: string | null;
  timezone: string;
  authStatus: PublishingAccountAuthStatus;
  accessTokenRef?: string | null;
  refreshTokenRef?: string | null;
  tokenExpiresAt?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PostingPlan {
  id: string;
  publishingAccountId: string;
  isDefault: boolean;
  postsPerDay: number;
  activeDays: number[];
  primaryTimezone: string;
  targetRegions: TargetRegion[];
  publishingWindowStart: string;
  publishingWindowEnd: string;
  slotStrategy: SlotStrategy;
  recyclingEnabled: boolean;
  minimumRecycleGapDays: number;
  maxRecyclesPerClip: number;
  freshInventoryThreshold: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarSlot {
  id: string;
  postingPlanId: string;
  scheduledForUtc: string;
  scheduledTimezone: string;
  slotLabel: string;
  slotRegion?: TargetRegion | null;
  status: CalendarSlotStatus;
  scheduledPublicationId?: string | null;
  blockedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledPublication {
  id: string;
  clipId: string;
  publishingAccountId: string;
  calendarSlotId?: string | null;
  exportArtifactId?: string | null;
  contentPackageId?: string | null;
  selectedTitleId?: string | null;
  selectedDescriptionId?: string | null;
  selectedThumbnailId?: string | null;
  platform: PublishingPlatform;
  scheduledForUtc: string;
  scheduledTimezone: string;
  status: ScheduledPublicationStatus;
  isRecycled: boolean;
  sourcePublicationId?: string | null;
  youtubeVideoId?: string | null;
  youtubeVideoUrl?: string | null;
  youtubeUploadStatus?: string | null;
  platformConfirmedPublishAtUtc?: string | null;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicationHistoryEvent {
  id: string;
  scheduledPublicationId: string;
  eventType: string;
  message?: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ClipPublishPreferences {
  clipId: string;
  recycleEnabled: boolean;
  priorityScore: number;
  excludeUntilUtc?: string | null;
  lastPublishedAt?: string | null;
  lastRecycledAt?: string | null;
  recycleCount: number;
  performanceScore: number;
  updatedAt: string;
}

export type VideoGenerationProvider = 'openrouter';

export type VideoGenerationModelId =
  | 'alibaba/wan-2.6'
  | 'bytedance/seedance-1-5-pro'
  | 'google/veo-3.1'
  | 'openai/sora-2-pro';

export type GeneratedVideoAssetStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'archived';

export type GeneratedVideoJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GeneratedVideoAspectRatio = '9:16' | '1:1' | '16:9';

export type ClipVisualSourceType = 'original' | 'generated_video';

export interface GeneratedVideoAsset {
  id: string;
  name: string;
  status: GeneratedVideoAssetStatus;
  provider: VideoGenerationProvider;
  modelId: VideoGenerationModelId;
  prompt: string;
  stylePrompt?: string | null;
  negativePrompt?: string | null;
  referenceImagePath?: string | null;
  sourceJobId?: string | null;
  filePath?: string | null;
  thumbnailPath?: string | null;
  durationSeconds?: number | null;
  aspectRatio: GeneratedVideoAspectRatio;
  width?: number | null;
  height?: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedVideoJob {
  id: string;
  assetId?: string | null;
  provider: VideoGenerationProvider;
  modelId: VideoGenerationModelId;
  prompt: string;
  stylePrompt?: string | null;
  negativePrompt?: string | null;
  referenceImagePath?: string | null;
  aspectRatio: GeneratedVideoAspectRatio;
  durationSeconds: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  status: GeneratedVideoJobStatus;
  progress: number;
  errorMessage?: string | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt: string;
}

export interface ClipVisualSource {
  clipId: string;
  sourceType: ClipVisualSourceType;
  generatedVideoAssetId?: string | null;
  updatedAt: string;
}

export interface ResolvedClipVideoSource {
  clipId: string;
  sourceType: ClipVisualSourceType;
  sourcePath: string;
  generatedVideoAssetId?: string | null;
  asset?: GeneratedVideoAsset | null;
}

export interface GeneratedVideoJobEvent {
  job: GeneratedVideoJob;
  asset?: GeneratedVideoAsset | null;
}
