import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrandTemplate,
  BrandTemplatePreset,
  CalendarSlot,
  ClipTrimState,
  PostingPlan,
  PublicationHistoryEvent,
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload,
  PublishingAccount,
  ScheduledPublication,
  TrimBoundaryAnchor
} from '@shared/types';
import type {
  GetActivePipelineJobRequestDTO,
  GetActivePipelineJobResponseDTO,
  GetPipelineRunComparisonRequestDTO,
  GetPipelineRunComparisonResponseDTO,
  GetPipelineRunEvaluationsRequestDTO,
  GetPipelineRunEvaluationsResponseDTO,
  GetPipelineRunRequestDTO,
  GetPipelineRunResponseDTO,
  GetPipelineRunsForEpisodeRequestDTO,
  GetPipelineRunsForEpisodeResponseDTO,
  ProcessEpisodeRequestDTO,
  ProcessEpisodeResponseDTO,
  ProcessSourceRequestDTO,
  ProcessSourceResponseDTO,
  ProcessingCompleteEventDTO,
  ProcessingErrorEventDTO,
  ProcessingUpdateEventDTO,
  SavePipelineRunEvaluationRequestDTO,
  SavePipelineRunEvaluationResponseDTO
} from '@shared/types/pipelineIpc'
import type {
  CancelExportJobRequestDTO,
  CancelExportJobResponseDTO,
  ClearCompletedExportsResponseDTO,
  ExportJobDTO,
  ExportOptionsDTO,
  ExportProgressEventDTO,
  GetActiveExportJobRequestDTO,
  GetActiveExportJobResponseDTO,
  GetExportJobRequestDTO,
  GetExportJobResponseDTO,
  StartExportRequestDTO,
  StartExportResponseDTO
} from '@shared/types/exportIpc';
import type {
  GetClipWaveformRequestDTO,
  GetClipWaveformResponseDTO
} from '@shared/types/mediaIpc';
import type {
  GetFailureEventsRequestDTO,
  GetFailureEventsResponseDTO,
  GetWorkflowEventsRequestDTO,
  GetWorkflowEventsResponseDTO,
  GetWorkflowJobRequestDTO,
  GetWorkflowJobResponseDTO
} from '@shared/types/workflowReadIpc'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
console.log('Preload script executing...');

const electronAPI = {
  // File operations
  selectFile: () => ipcRenderer.invoke('select-file'),
  
  // App info
  getVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Platform info
  platform: process.platform,
  
  // Processing operations
  processEpisode: (filePath: string, projectName?: string) => 
    ipcRenderer.invoke(
      'process-episode',
      { filePath, projectName } satisfies ProcessEpisodeRequestDTO
    ) as Promise<ProcessEpisodeResponseDTO>,
  processSource: (source: string, projectName?: string) =>
    ipcRenderer.invoke(
      'process-source',
      { source, projectName } satisfies ProcessSourceRequestDTO
    ) as Promise<ProcessSourceResponseDTO>,
  getActivePipelineJob: (episodeId?: string, projectId?: string) =>
    ipcRenderer.invoke(
      'get-active-pipeline-job',
      { episodeId, projectId } satisfies GetActivePipelineJobRequestDTO
    ) as Promise<GetActivePipelineJobResponseDTO>,
  getPipelineRun: (jobId: string) =>
    ipcRenderer.invoke(
      'get-pipeline-run',
      { jobId } satisfies GetPipelineRunRequestDTO
    ) as Promise<GetPipelineRunResponseDTO>,
  getPipelineRunsForEpisode: (episodeId: string) =>
    ipcRenderer.invoke(
      'get-pipeline-runs-for-episode',
      { episodeId } satisfies GetPipelineRunsForEpisodeRequestDTO
    ) as Promise<GetPipelineRunsForEpisodeResponseDTO>,
  getPipelineRunComparison: (episodeId: string, jobIds?: string[]) =>
    ipcRenderer.invoke(
      'get-pipeline-run-comparison',
      { episodeId, jobIds } satisfies GetPipelineRunComparisonRequestDTO
    ) as Promise<GetPipelineRunComparisonResponseDTO>,
  savePipelineRunEvaluation: (episodeId: string, baselineJobId: string, candidateJobId: string, notes?: string) =>
    ipcRenderer.invoke(
      'save-pipeline-run-evaluation',
      { episodeId, baselineJobId, candidateJobId, notes } satisfies SavePipelineRunEvaluationRequestDTO
    ) as Promise<SavePipelineRunEvaluationResponseDTO>,
  getPipelineRunEvaluations: (episodeId: string) =>
    ipcRenderer.invoke(
      'get-pipeline-run-evaluations',
      { episodeId } satisfies GetPipelineRunEvaluationsRequestDTO
    ) as Promise<GetPipelineRunEvaluationsResponseDTO>,
  getWorkflowJob: (jobId: string) =>
    ipcRenderer.invoke(
      'get-workflow-job',
      { jobId } satisfies GetWorkflowJobRequestDTO
    ) as Promise<GetWorkflowJobResponseDTO>,
  getWorkflowEvents: (jobId: string) =>
    ipcRenderer.invoke(
      'get-workflow-events',
      { jobId } satisfies GetWorkflowEventsRequestDTO
    ) as Promise<GetWorkflowEventsResponseDTO>,
  getFailureEvents: (jobId: string) =>
    ipcRenderer.invoke(
      'get-failure-events',
      { jobId } satisfies GetFailureEventsRequestDTO
    ) as Promise<GetFailureEventsResponseDTO>,
  playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) =>
    ipcRenderer.invoke('play-clip', episodeId, startTime, endTime, clipId),
  
  // Database operations
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  getProject: (projectId: string) => ipcRenderer.invoke('get-project', projectId),
  getEpisode: (episodeId: string) => ipcRenderer.invoke('get-episode', episodeId),
  getEpisodeByProject: (projectId: string) => ipcRenderer.invoke('get-episode-by-project', projectId),
  getEpisodeMediaSource: (episodeId: string) => ipcRenderer.invoke('get-episode-media-source', episodeId),
  getClipWaveform: (episodeId: string, startTime: number, duration: number, samples?: number) =>
    ipcRenderer.invoke(
      'get-clip-waveform',
      { episodeId, startTime, duration, samples } satisfies GetClipWaveformRequestDTO
    ) as Promise<GetClipWaveformResponseDTO>,
  getEpisodeClips: (episodeId: string) => ipcRenderer.invoke('get-episode-clips', episodeId),
  getClip: (clipId: string) => ipcRenderer.invoke('get-clip', clipId),
  getClipTrimState: (clipId: string) => ipcRenderer.invoke('get-clip-trim-state', clipId),
  getTranscriptSegments: (episodeId: string) => ipcRenderer.invoke('get-transcript-segments', episodeId),
  updateTranscriptSegment: (episodeId: string, segmentIndex: number, text: string) =>
    ipcRenderer.invoke('update-transcript-segment', episodeId, segmentIndex, text),
  updateClipStatus: (clipId: string, status: string) =>
    ipcRenderer.invoke('update-clip-status', clipId, status),
  updateClipBoundaries: (clipId: string, startTime: number, endTime: number) =>
    ipcRenderer.invoke('update-clip-boundaries', clipId, startTime, endTime),
  saveClipTrimState: (clipId: string, inPoint: number, outPoint: number, inAnchor?: TrimBoundaryAnchor | null, outAnchor?: TrimBoundaryAnchor | null) =>
    ipcRenderer.invoke('save-clip-trim-state', clipId, inPoint, outPoint, inAnchor, outAnchor),
  getApprovedClips: (episodeId: string) => ipcRenderer.invoke('get-approved-clips', episodeId),
  cleanupDatabase: () => ipcRenderer.invoke('cleanup-database'),
  nukeAllProjects: () => ipcRenderer.invoke('nuke-all-projects'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),
  
  // Settings operations
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateApiConfig: (config: any) => ipcRenderer.invoke('update-api-config', config),
  updateUserPreferences: (preferences: any) =>
    ipcRenderer.invoke('update-user-preferences', preferences),
  getPublishingAccounts: () =>
    ipcRenderer.invoke('get-publishing-accounts') as Promise<PublishingAccount[]>,
  savePublishingAccount: (account: Partial<PublishingAccount>) =>
    ipcRenderer.invoke('save-publishing-account', account) as Promise<PublishingAccount>,
  connectYoutubeAccount: (accountId: string) =>
    ipcRenderer.invoke('connect-youtube-account', accountId) as Promise<PublishingAccount>,
  disconnectYoutubeAccount: (accountId: string) =>
    ipcRenderer.invoke('disconnect-youtube-account', accountId) as Promise<PublishingAccount>,
  refreshYoutubeAccount: (accountId: string) =>
    ipcRenderer.invoke('refresh-youtube-account', accountId) as Promise<PublishingAccount>,
  getPostingPlan: (publishingAccountId: string) =>
    ipcRenderer.invoke('get-posting-plan', publishingAccountId) as Promise<PostingPlan | undefined>,
  savePostingPlan: (plan: PostingPlan) =>
    ipcRenderer.invoke('save-posting-plan', plan) as Promise<PostingPlan>,
  generateCalendarSlots: (postingPlanId: string, daysForward?: number) =>
    ipcRenderer.invoke('generate-calendar-slots', postingPlanId, daysForward) as Promise<CalendarSlot[]>,
  getCalendarOverview: (publishingAccountId?: string) =>
    ipcRenderer.invoke('get-calendar-overview', publishingAccountId) as Promise<{
      account: PublishingAccount | null
      plan: PostingPlan | null
      slots: CalendarSlot[]
      publications: ScheduledPublication[]
    }>,
  getScheduledPublications: (publishingAccountId: string) =>
    ipcRenderer.invoke('get-scheduled-publications', publishingAccountId) as Promise<ScheduledPublication[]>,
  refreshClipScheduling: (clipId: string) =>
    ipcRenderer.invoke('refresh-clip-scheduling', clipId) as Promise<ScheduledPublication[]>,
  pushScheduledPublication: (publicationId: string) =>
    ipcRenderer.invoke('push-scheduled-publication', publicationId) as Promise<ScheduledPublication>,
  pushReadyPublications: (publishingAccountId?: string) =>
    ipcRenderer.invoke('push-ready-publications', publishingAccountId) as Promise<ScheduledPublication[]>,
  retryScheduledPublication: (publicationId: string) =>
    ipcRenderer.invoke('retry-scheduled-publication', publicationId) as Promise<ScheduledPublication>,
  getPublicationHistory: (publicationId: string) =>
    ipcRenderer.invoke('get-publication-history', publicationId) as Promise<PublicationHistoryEvent[]>,
  getBrandTemplate: () => ipcRenderer.invoke('get-brand-template'),
  updateBrandTemplate: (template: Partial<BrandTemplate>) =>
    ipcRenderer.invoke('update-brand-template', template),
  getBrandTemplatePresets: () => ipcRenderer.invoke('get-brand-template-presets') as Promise<{
    presets: BrandTemplatePreset[]
    activePresetId: string
  }>,
  createBrandTemplatePreset: (name?: string) =>
    ipcRenderer.invoke('create-brand-template-preset', name) as Promise<{
      preset: BrandTemplatePreset
      presets: BrandTemplatePreset[]
      activePresetId: string
      brandTemplate: BrandTemplate
    }>,
  setActiveBrandTemplatePreset: (presetId: string) =>
    ipcRenderer.invoke('set-active-brand-template-preset', presetId) as Promise<{
      preset: BrandTemplatePreset
      presets: BrandTemplatePreset[]
      activePresetId: string
      brandTemplate: BrandTemplate
    }>,
  deleteBrandTemplatePreset: (presetId: string) =>
    ipcRenderer.invoke('delete-brand-template-preset', presetId) as Promise<{
      deletedPresetId: string
      presets: BrandTemplatePreset[]
      activePresetId: string
      brandTemplate: BrandTemplate
    }>,
  validateConfig: () => ipcRenderer.invoke('validate-config'),

  // Export operations
  exportApprovedClips: (episodeId: string, options: ExportOptionsDTO) =>
    ipcRenderer.invoke(
      'export-approved-clips',
      { episodeId, options } satisfies StartExportRequestDTO
    ) as Promise<StartExportResponseDTO>,
  getExportJob: (jobId: string) =>
    ipcRenderer.invoke(
      'get-export-job',
      { jobId } satisfies GetExportJobRequestDTO
    ) as Promise<GetExportJobResponseDTO>,
  getActiveExportJob: (episodeId: string) =>
    ipcRenderer.invoke(
      'get-active-export-job',
      { episodeId } satisfies GetActiveExportJobRequestDTO
    ) as Promise<GetActiveExportJobResponseDTO>,
  cancelExportJob: (jobId: string) =>
    ipcRenderer.invoke(
      'cancel-export-job',
      { jobId } satisfies CancelExportJobRequestDTO
    ) as Promise<CancelExportJobResponseDTO>,
  clearCompletedExports: () =>
    ipcRenderer.invoke('clear-completed-exports') as Promise<ClearCompletedExportsResponseDTO>,

  // Content package operations
  getClipTitles: (clipId: string) => ipcRenderer.invoke('get-clip-titles', clipId),
  getClipDescriptions: (clipId: string) => ipcRenderer.invoke('get-clip-descriptions', clipId),
  getClipThumbnails: (clipId: string) => ipcRenderer.invoke('get-clip-thumbnails', clipId),
  generateClipThumbnails: (clipId: string, count?: number) => ipcRenderer.invoke('generate-clip-thumbnails', clipId, count),
  selectClipTitle: (titleId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-title', titleId, clipId),
  selectClipDescription: (descriptionId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-description', descriptionId, clipId),
  selectClipThumbnail: (thumbnailId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-thumbnail', thumbnailId, clipId),

  // Clip edits operations (for Editor screen)
  getClipEdits: (clipId: string) => ipcRenderer.invoke('get-clip-edits', clipId),
  saveClipEdits: (clipId: string, edits: any) => ipcRenderer.invoke('save-clip-edits', clipId, edits),
  deleteClipEdits: (clipId: string) => ipcRenderer.invoke('delete-clip-edits', clipId),
  getClipTranscriptSegments: (clipId: string) => ipcRenderer.invoke('get-clip-transcript-segments', clipId),

  // Logo operations
  uploadLogo: (base64Data: string, fileName: string) => ipcRenderer.invoke('upload-logo', base64Data, fileName),
  listLogos: () => ipcRenderer.invoke('list-logos'),

  // Music operations
  uploadMusic: (base64Data: string, fileName: string) => ipcRenderer.invoke('upload-music', base64Data, fileName),
  listMusic: () => ipcRenderer.invoke('list-music'),

  // Event listeners for IPC
  onProcessingUpdate: (callback: (data: ProcessingUpdateEventDTO) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: ProcessingUpdateEventDTO) => callback(data);
    ipcRenderer.on('processing-update', listener);
    // Return cleanup function
    return () => ipcRenderer.removeListener('processing-update', listener);
  },
  
  onProcessingComplete: (callback: (data: ProcessingCompleteEventDTO) => void) => {
    const listener = (_: Electron.IpcRendererEvent, data: ProcessingCompleteEventDTO) => callback(data);
    ipcRenderer.on('processing-complete', listener);
    return () => ipcRenderer.removeListener('processing-complete', listener);
  },
  
  onProcessingError: (callback: (error: ProcessingErrorEventDTO) => void) => {
    const listener = (_: Electron.IpcRendererEvent, error: ProcessingErrorEventDTO) => callback(error);
    ipcRenderer.on('processing-error', listener);
    return () => ipcRenderer.removeListener('processing-error', listener);
  },
  
  onClipExtractionProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('clip-extraction-progress', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('clip-extraction-progress');
  },

  onExportProgress: (callback: (job: ExportProgressEventDTO) => void) => {
    const listener = (_: Electron.IpcRendererEvent, job: ExportProgressEventDTO) => callback(job);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.removeListener('export-progress', listener);
  },

  onDatabaseCleaned: (callback: (result: any) => void) => {
    ipcRenderer.on('database-cleaned', (_, result) => callback(result));
    return () => ipcRenderer.removeAllListeners('database-cleaned');
  },
};

console.log('electronAPI object created:', Object.keys(electronAPI));
console.log('playClip function exists:', typeof electronAPI.playClip);

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type definitions for the exposed API
declare global {
  interface Window {
    electronAPI: {
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

      // Clip edits operations (for Editor screen)
      getClipEdits: (clipId: string) => Promise<any>;
      saveClipEdits: (clipId: string, edits: any) => Promise<any>;
      deleteClipEdits: (clipId: string) => Promise<any>;
      getClipTranscriptSegments: (clipId: string) => Promise<any[]>;

      // Logo operations
      uploadLogo: (base64Data: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      listLogos: () => Promise<string[]>;

      // Music operations
      uploadMusic: (base64Data: string, fileName: string) => Promise<{ success: boolean; path?: string; error?: string }>;
      listMusic: () => Promise<string[]>;

      // Event listeners
      onProcessingUpdate: (callback: (data: ProcessingUpdateEventDTO) => void) => () => void;
      onProcessingComplete: (callback: (data: ProcessingCompleteEventDTO) => void) => () => void;
      onProcessingError: (callback: (error: ProcessingErrorEventDTO) => void) => () => void;
      onClipExtractionProgress: (callback: (data: any) => void) => () => void;
      onExportProgress: (callback: (job: ExportJobDTO) => void) => () => void;
      onDatabaseCleaned: (callback: (result: any) => void) => () => void;
    };
  }
}
