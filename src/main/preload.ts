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
  getEpisodeClips: (episodeId: string) => ipcRenderer.invoke('get-episode-clips', episodeId),
  updateClipStatus: (clipId: string, status: string) => 
    ipcRenderer.invoke('update-clip-status', clipId, status),
  getApprovedClips: (episodeId: string) => ipcRenderer.invoke('get-approved-clips', episodeId),
  
  // Settings operations
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateApiConfig: (config: any) => ipcRenderer.invoke('update-api-config', config),
  updateUserPreferences: (preferences: any) => 
    ipcRenderer.invoke('update-user-preferences', preferences),
  validateConfig: () => ipcRenderer.invoke('validate-config'),
  
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