import { contextBridge, ipcRenderer } from 'electron';
import type { BrandTemplate, ClipTrimState, ProcessingErrorPayload, ProcessingProgress, ProcessingResultPayload, TrimBoundaryAnchor } from '@shared/types';
import type {
  GetActivePipelineJobRequestDTO,
  GetActivePipelineJobResponseDTO,
  ProcessEpisodeRequestDTO,
  ProcessEpisodeResponseDTO,
  ProcessSourceRequestDTO,
  ProcessSourceResponseDTO,
  ProcessingCompleteEventDTO,
  ProcessingErrorEventDTO,
  ProcessingUpdateEventDTO
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
  playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) =>
    ipcRenderer.invoke('play-clip', episodeId, startTime, endTime, clipId),
  
  // Database operations
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  getProject: (projectId: string) => ipcRenderer.invoke('get-project', projectId),
  getEpisode: (episodeId: string) => ipcRenderer.invoke('get-episode', episodeId),
  getEpisodeByProject: (projectId: string) => ipcRenderer.invoke('get-episode-by-project', projectId),
  getEpisodeMediaSource: (episodeId: string) => ipcRenderer.invoke('get-episode-media-source', episodeId),
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
  getBrandTemplate: () => ipcRenderer.invoke('get-brand-template'),
  updateBrandTemplate: (template: Partial<BrandTemplate>) =>
    ipcRenderer.invoke('update-brand-template', template),
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
  selectClipTitle: (titleId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-title', titleId, clipId),
  selectClipDescription: (descriptionId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-description', descriptionId, clipId),

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
      playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) => Promise<any>;
      
      // Database operations
      getRecentProjects: () => Promise<any[]>;
      getProject: (projectId: string) => Promise<any>;
      getEpisode: (episodeId: string) => Promise<any>;
      getEpisodeByProject: (projectId: string) => Promise<any>;
      getEpisodeMediaSource: (episodeId: string) => Promise<{ mediaUrl: string; filePath: string; duration: number; frameRate: number | null }>;
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
