// Electron API types for renderer process

declare global {
  interface Window {
    electronAPI?: {
      // File operations
      selectFile: () => Promise<string | null>;
      getVersion: () => Promise<string>;
      platform: string;
      
      // Processing operations
      processEpisode: (filePath: string, projectName?: string) => Promise<any>;
      playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) => Promise<any>;
      
      // Database operations
      getRecentProjects: () => Promise<any[]>;
      getProject: (projectId: string) => Promise<any>;
      getEpisode: (episodeId: string) => Promise<any>;
      getEpisodeByProject: (projectId: string) => Promise<any>;
      getEpisodeClips: (episodeId: string) => Promise<any[]>;
      getClip: (clipId: string) => Promise<any>;
      updateClipStatus: (clipId: string, status: string) => Promise<any>;
      getApprovedClips: (episodeId: string) => Promise<any[]>;
      cleanupDatabase: () => Promise<any>;
      nukeAllProjects: () => Promise<any>;
      deleteProject: (projectId: string) => Promise<any>;
      
      // Settings operations
      getConfig: () => Promise<any>;
      updateApiConfig: (config: any) => Promise<boolean>;
      updateUserPreferences: (preferences: any) => Promise<boolean>;
      validateConfig: () => Promise<{ isValid: boolean; errors: string[] }>;

      // Export operations
      exportApprovedClips: (episodeId: string, options: any) => Promise<any>;
      getExportJob: (jobId: string) => Promise<any>;
      cancelExportJob: (jobId: string) => Promise<boolean>;
      clearCompletedExports: () => Promise<{ success: boolean }>;

      // Content package operations
      getClipTitles: (clipId: string) => Promise<any[]>;
      getClipDescriptions: (clipId: string) => Promise<any[]>;
      selectClipTitle: (titleId: string, clipId: string) => Promise<any>;
      selectClipDescription: (descriptionId: string, clipId: string) => Promise<any>;

      // Event listeners
      onProcessingUpdate: (callback: (data: any) => void) => () => void;
      onProcessingComplete: (callback: (data: any) => void) => () => void;
      onProcessingError: (callback: (error: string) => void) => () => void;
      onClipExtractionProgress: (callback: (data: any) => void) => () => void;
      onExportProgress: (callback: (job: any) => void) => () => void;
      onDatabaseCleaned: (callback: (result: any) => void) => () => void;
    };
  }
}

export {}
