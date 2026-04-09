import type {
  BrandTemplate,
  BrandTemplatePreset,
  CalendarSlot,
  ClipTrimState,
  PostingPlan,
  PublishingAccount,
  ScheduledPublication,
  TrimBoundaryAnchor
} from '@shared/types'
import type {
  GetActivePipelineJobResponseDTO,
  GetPipelineRunComparisonResponseDTO,
  GetPipelineRunEvaluationsResponseDTO,
  GetPipelineRunResponseDTO,
  GetPipelineRunsForEpisodeResponseDTO,
  ProcessEpisodeResponseDTO,
  ProcessSourceResponseDTO,
  ProcessingCompleteEventDTO,
  ProcessingErrorEventDTO,
  ProcessingUpdateEventDTO,
  SavePipelineRunEvaluationResponseDTO
} from '@shared/types/pipelineIpc'
import type {
  CancelExportJobResponseDTO,
  ClearCompletedExportsResponseDTO,
  ExportOptionsDTO,
  ExportProgressEventDTO,
  GetActiveExportJobResponseDTO,
  GetExportJobResponseDTO,
  StartExportResponseDTO
} from '@shared/types/exportIpc'
import type { GetClipWaveformResponseDTO } from '@shared/types/mediaIpc'
import type {
  GetFailureEventsResponseDTO,
  GetWorkflowEventsResponseDTO,
  GetWorkflowJobResponseDTO
} from '@shared/types/workflowReadIpc'

// Electron API types for renderer process

declare global {
  interface Window {
    electronAPI?: {
      // File operations
      selectFile: () => Promise<string | null>;
      getVersion: () => Promise<string>;
      platform: string;
      
      // Processing operations
      processEpisode: (filePath: string, projectName?: string) => Promise<ProcessEpisodeResponseDTO>;
      processSource: (source: string, projectName?: string) => Promise<ProcessSourceResponseDTO>;
      getActivePipelineJob: (episodeId?: string, projectId?: string) => Promise<GetActivePipelineJobResponseDTO>;
      getPipelineRun: (jobId: string) => Promise<GetPipelineRunResponseDTO>;
      getPipelineRunsForEpisode: (episodeId: string) => Promise<GetPipelineRunsForEpisodeResponseDTO>;
      getPipelineRunComparison: (episodeId: string, jobIds?: string[]) => Promise<GetPipelineRunComparisonResponseDTO>;
      savePipelineRunEvaluation: (episodeId: string, baselineJobId: string, candidateJobId: string, notes?: string) => Promise<SavePipelineRunEvaluationResponseDTO>;
      getPipelineRunEvaluations: (episodeId: string) => Promise<GetPipelineRunEvaluationsResponseDTO>;
      getWorkflowJob: (jobId: string) => Promise<GetWorkflowJobResponseDTO>;
      getWorkflowEvents: (jobId: string) => Promise<GetWorkflowEventsResponseDTO>;
      getFailureEvents: (jobId: string) => Promise<GetFailureEventsResponseDTO>;
      playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) => Promise<any>;
      
      // Database operations
      getRecentProjects: () => Promise<any[]>;
      getProject: (projectId: string) => Promise<any>;
      getEpisode: (episodeId: string) => Promise<any>;
      getEpisodeByProject: (projectId: string) => Promise<any>;
      getEpisodeMediaSource: (episodeId: string) => Promise<{ mediaUrl: string; filePath: string; duration: number; frameRate: number | null }>;
      getClipWaveform: (episodeId: string, startTime: number, duration: number, samples?: number) => Promise<GetClipWaveformResponseDTO>;
      getEpisodeClips: (episodeId: string) => Promise<any[]>;
      getClip: (clipId: string) => Promise<any>;
      getClipTrimState: (clipId: string) => Promise<ClipTrimState | undefined>;
      getTranscriptSegments: (episodeId: string) => Promise<any[]>;
      updateTranscriptSegment: (episodeId: string, segmentIndex: number, text: string) => Promise<any>;
      updateClipStatus: (clipId: string, status: string) => Promise<any>;
      updateClipBoundaries: (clipId: string, startTime: number, endTime: number) => Promise<any>;
      saveClipTrimState: (
        clipId: string,
        inPoint: number,
        outPoint: number,
        inAnchor?: TrimBoundaryAnchor | null,
        outAnchor?: TrimBoundaryAnchor | null
      ) => Promise<any>;
      getApprovedClips: (episodeId: string) => Promise<any[]>;
      cleanupDatabase: () => Promise<any>;
      nukeAllProjects: () => Promise<any>;
      deleteProject: (projectId: string) => Promise<any>;
      
      // Settings operations
      getConfig: () => Promise<any>;
      updateApiConfig: (config: any) => Promise<boolean>;
      updateUserPreferences: (preferences: any) => Promise<boolean>;
      getPublishingAccounts: () => Promise<PublishingAccount[]>;
      savePublishingAccount: (account: Partial<PublishingAccount>) => Promise<PublishingAccount>;
      getPostingPlan: (publishingAccountId: string) => Promise<PostingPlan | undefined>;
      savePostingPlan: (plan: PostingPlan) => Promise<PostingPlan>;
      generateCalendarSlots: (postingPlanId: string, daysForward?: number) => Promise<CalendarSlot[]>;
      getCalendarOverview: (publishingAccountId?: string) => Promise<{
        account: PublishingAccount | null;
        plan: PostingPlan | null;
        slots: CalendarSlot[];
        publications: ScheduledPublication[];
      }>;
      getScheduledPublications: (publishingAccountId: string) => Promise<ScheduledPublication[]>;
      refreshClipScheduling: (clipId: string) => Promise<ScheduledPublication[]>;
      getBrandTemplate: () => Promise<BrandTemplate>;
      updateBrandTemplate: (template: Partial<BrandTemplate>) => Promise<BrandTemplate>;
      getBrandTemplatePresets: () => Promise<{
        presets: BrandTemplatePreset[];
        activePresetId: string;
      }>;
      createBrandTemplatePreset: (name?: string) => Promise<{
        preset: BrandTemplatePreset;
        presets: BrandTemplatePreset[];
        activePresetId: string;
        brandTemplate: BrandTemplate;
      }>;
      setActiveBrandTemplatePreset: (presetId: string) => Promise<{
        preset: BrandTemplatePreset;
        presets: BrandTemplatePreset[];
        activePresetId: string;
        brandTemplate: BrandTemplate;
      }>;
      deleteBrandTemplatePreset: (presetId: string) => Promise<{
        deletedPresetId: string;
        presets: BrandTemplatePreset[];
        activePresetId: string;
        brandTemplate: BrandTemplate;
      }>;
      validateConfig: () => Promise<{ isValid: boolean; errors: string[] }>;

      // Export operations
      exportApprovedClips: (episodeId: string, options: ExportOptionsDTO) => Promise<StartExportResponseDTO>;
      getExportJob: (jobId: string) => Promise<GetExportJobResponseDTO>;
      getActiveExportJob: (episodeId: string) => Promise<GetActiveExportJobResponseDTO>;
      cancelExportJob: (jobId: string) => Promise<CancelExportJobResponseDTO>;
      clearCompletedExports: () => Promise<ClearCompletedExportsResponseDTO>;

      // Content package operations
      getClipTitles: (clipId: string) => Promise<any[]>;
      getClipDescriptions: (clipId: string) => Promise<any[]>;
      getClipThumbnails: (clipId: string) => Promise<any[]>;
      generateClipThumbnails: (clipId: string, count?: number) => Promise<any[]>;
      selectClipTitle: (titleId: string, clipId: string) => Promise<any>;
      selectClipDescription: (descriptionId: string, clipId: string) => Promise<any>;
      selectClipThumbnail: (thumbnailId: string, clipId: string) => Promise<any>;
      getClipEdits: (clipId: string) => Promise<any>;
      saveClipEdits: (clipId: string, edits: any) => Promise<any>;
      deleteClipEdits: (clipId: string) => Promise<any>;
      getClipTranscriptSegments: (clipId: string) => Promise<any[]>;
      uploadLogo: (base64Data: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      listLogos: () => Promise<string[]>;
      uploadMusic: (base64Data: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      listMusic: () => Promise<string[]>;

      // Event listeners
      onProcessingUpdate: (callback: (data: ProcessingUpdateEventDTO) => void) => () => void;
      onProcessingComplete: (callback: (data: ProcessingCompleteEventDTO) => void) => () => void;
      onProcessingError: (callback: (error: ProcessingErrorEventDTO) => void) => () => void;
      onClipExtractionProgress: (callback: (data: any) => void) => () => void;
      onExportProgress: (callback: (job: ExportProgressEventDTO) => void) => () => void;
      onDatabaseCleaned: (callback: (result: any) => void) => () => void;
    };
  }
}

export {}
