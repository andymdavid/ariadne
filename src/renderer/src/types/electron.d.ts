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
      getEpisodeClips: (episodeId: string) => Promise<any[]>;
      updateClipStatus: (clipId: string, status: string) => Promise<any>;
      getApprovedClips: (episodeId: string) => Promise<any[]>;
      
      // Settings operations
      getConfig: () => Promise<any>;
      updateApiConfig: (config: any) => Promise<boolean>;
      updateUserPreferences: (preferences: any) => Promise<boolean>;
      validateConfig: () => Promise<{ isValid: boolean; errors: string[] }>;
      
      // Event listeners
      onProcessingUpdate: (callback: (data: any) => void) => () => void;
      onProcessingComplete: (callback: (data: any) => void) => () => void;
      onProcessingError: (callback: (error: string) => void) => () => void;
      onClipExtractionProgress: (callback: (data: any) => void) => () => void;
    };
  }
}

export {}