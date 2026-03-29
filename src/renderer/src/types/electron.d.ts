import type { BrandTemplate, ClipTrimState, TrimBoundaryAnchor } from '@shared/types'
import type {
  ProcessEpisodeResponseDTO,
  ProcessSourceResponseDTO,
  ProcessingCompleteEventDTO,
  ProcessingErrorEventDTO,
  ProcessingUpdateEventDTO
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

      // Content package operations
      getClipTitles: (clipId: string) => Promise<any[]>;
      getClipDescriptions: (clipId: string) => Promise<any[]>;
      selectClipTitle: (titleId: string, clipId: string) => Promise<any>;
      selectClipDescription: (descriptionId: string, clipId: string) => Promise<any>;
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
