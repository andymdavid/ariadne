import { contextBridge, ipcRenderer } from 'electron';

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
    ipcRenderer.invoke('process-episode', filePath, projectName),
  playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) =>
    ipcRenderer.invoke('play-clip', episodeId, startTime, endTime, clipId),
  
  // Database operations
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  getProject: (projectId: string) => ipcRenderer.invoke('get-project', projectId),
  getEpisode: (episodeId: string) => ipcRenderer.invoke('get-episode', episodeId),
  getEpisodeByProject: (projectId: string) => ipcRenderer.invoke('get-episode-by-project', projectId),
  getEpisodeClips: (episodeId: string) => ipcRenderer.invoke('get-episode-clips', episodeId),
  updateClipStatus: (clipId: string, status: string) =>
    ipcRenderer.invoke('update-clip-status', clipId, status),
  getApprovedClips: (episodeId: string) => ipcRenderer.invoke('get-approved-clips', episodeId),
  cleanupDatabase: () => ipcRenderer.invoke('cleanup-database'),
  nukeAllProjects: () => ipcRenderer.invoke('nuke-all-projects'),
  deleteProject: (projectId: string) => ipcRenderer.invoke('delete-project', projectId),
  
  // Settings operations
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateApiConfig: (config: any) => ipcRenderer.invoke('update-api-config', config),
  updateUserPreferences: (preferences: any) =>
    ipcRenderer.invoke('update-user-preferences', preferences),
  validateConfig: () => ipcRenderer.invoke('validate-config'),

  // Export operations
  exportApprovedClips: (episodeId: string, options: any) =>
    ipcRenderer.invoke('export-approved-clips', episodeId, options),
  getExportJob: (jobId: string) => ipcRenderer.invoke('get-export-job', jobId),
  cancelExportJob: (jobId: string) => ipcRenderer.invoke('cancel-export-job', jobId),
  clearCompletedExports: () => ipcRenderer.invoke('clear-completed-exports'),

  // Content package operations
  getClipTitles: (clipId: string) => ipcRenderer.invoke('get-clip-titles', clipId),
  getClipDescriptions: (clipId: string) => ipcRenderer.invoke('get-clip-descriptions', clipId),
  selectClipTitle: (titleId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-title', titleId, clipId),
  selectClipDescription: (descriptionId: string, clipId: string) =>
    ipcRenderer.invoke('select-clip-description', descriptionId, clipId),

  // Event listeners for IPC
  onProcessingUpdate: (callback: (data: any) => void) => {
    ipcRenderer.on('processing-update', (_, data) => callback(data));
    // Return cleanup function
    return () => ipcRenderer.removeAllListeners('processing-update');
  },
  
  onProcessingComplete: (callback: (data: any) => void) => {
    ipcRenderer.on('processing-complete', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('processing-complete');
  },
  
  onProcessingError: (callback: (error: string) => void) => {
    ipcRenderer.on('processing-error', (_, error) => callback(error));
    return () => ipcRenderer.removeAllListeners('processing-error');
  },
  
  onClipExtractionProgress: (callback: (data: any) => void) => {
    ipcRenderer.on('clip-extraction-progress', (_, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('clip-extraction-progress');
  },

  onExportProgress: (callback: (job: any) => void) => {
    ipcRenderer.on('export-progress', (_, job) => callback(job));
    return () => ipcRenderer.removeAllListeners('export-progress');
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
      processEpisode: (filePath: string, projectName?: string) => Promise<any>;
      playClip: (episodeId: string, startTime: number, endTime: number, clipId: string) => Promise<any>;
      
      // Database operations
      getRecentProjects: () => Promise<any[]>;
      getProject: (projectId: string) => Promise<any>;
      getEpisode: (episodeId: string) => Promise<any>;
      getEpisodeByProject: (projectId: string) => Promise<any>;
      getEpisodeClips: (episodeId: string) => Promise<any[]>;
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
      
      // Event listeners
      onProcessingUpdate: (callback: (data: any) => void) => () => void;
      onProcessingComplete: (callback: (data: any) => void) => () => void;
      onProcessingError: (callback: (error: string) => void) => () => void;
      onClipExtractionProgress: (callback: (data: any) => void) => () => void;
      onDatabaseCleaned: (callback: (result: any) => void) => () => void;
    };
  }
}