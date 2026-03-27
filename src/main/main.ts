import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import { database } from './database/database';
import { processingPipeline } from './services/processingPipeline';
import { configService } from './services/configService';
import { clipService } from './services/clipService';
import { exportService } from './services/exportService';
import { ffmpegService } from './services/ffmpegService';

// TODO: Add electron-reload for development

let mainWindow: BrowserWindow | null = null;
let activeProcessingJob: { jobId: string; filePath: string } | null = null;
const allowedMediaPaths = new Set<string>();

const isDev = process.env.NODE_ENV === 'development';

async function backfillClipDimensions(batchSize = 25) {
  try {
    let pending = database.getClipsMissingVideoDimensions(batchSize) as Array<{ id: string; episode_id: string; file_path: string }>;
    if (!pending.length) {
      console.log('[ClipDimensions] All clips already have stored dimensions');
      return;
    }

    console.log(`[ClipDimensions] Backfilling video dimensions for ${pending.length} clip(s)`);

    while (pending.length) {
      for (const clip of pending) {
        try {
          const mediaInfo = await ffmpegService.getMediaInfo(clip.file_path);
          const resolution = mediaInfo.resolution;
          if (resolution?.width && resolution?.height) {
            database.updateClipVideoDimensions(clip.id, resolution.width, resolution.height);
            console.log(`[ClipDimensions] Stored ${resolution.width}x${resolution.height} for clip ${clip.id}`);
          } else {
            console.warn(`[ClipDimensions] No video stream found for clip ${clip.id} (${clip.file_path})`);
          }
        } catch (error) {
          console.error(`[ClipDimensions] Failed to backfill clip ${clip.id}:`, error);
        }
      }

      pending = database.getClipsMissingVideoDimensions(batchSize) as Array<{ id: string; episode_id: string; file_path: string }>;
      if (pending.length) {
        console.log(`[ClipDimensions] Continuing backfill, ${pending.length} clip(s) remaining`);
      }
    }

    console.log('[ClipDimensions] Backfill completed');
  } catch (error) {
    console.error('[ClipDimensions] Backfill failed:', error);
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = join(__dirname, '../../../renderer/index.html');
    console.log('Attempting to load built index.html from:', indexPath);
    if (existsSync(indexPath)) {
      await mainWindow.loadFile(indexPath);
    } else {
      console.error('Built index.html not found at', indexPath);
    }
  }

  mainWindow.webContents.openDevTools();
}

// Register custom protocol for serving local files
app.whenReady().then(() => {
  // Register the app-file protocol to serve local files securely
  protocol.registerFileProtocol('app-file', (request, callback) => {
    const filePath = request.url.replace('app-file://', '')
    console.log('Serving file via app-file protocol:', filePath)
    
    // Security check: ensure the file exists and is in a safe location
    if (
      existsSync(filePath) &&
      (
        filePath.includes(app.getPath('userData')) ||
        filePath.includes('/tmp/') ||
        allowedMediaPaths.has(filePath)
      )
    ) {
      callback({ path: filePath })
    } else {
      console.error('File not found or not in safe location:', filePath)
      callback({ error: -6 }) // FILE_NOT_FOUND
    }
  })

  // Run database cleanup on startup to fix any corrupted data
  try {
    console.log('Running database cleanup on startup...')
    const cleanupResult = database.cleanupDuplicateProjects()
    console.log('Database cleanup result:', cleanupResult)
  } catch (error) {
    console.error('Database cleanup failed:', error)
  }

  createWindow();

  backfillClipDimensions().catch((error) => {
    console.error('[ClipDimensions] Backfill task error:', error)
  })

  app.on('activate', () => {
    // On macOS, re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC handlers
ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
    filters: [
      {
        name: 'Media Files',
        extensions: ['mp4', 'mov', 'mp3', 'wav', 'm4a', 'aac'],
      },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Processing handlers
ipcMain.handle('process-episode', async (event, filePath: string, projectName?: string) => {
  if (activeProcessingJob) {
    throw new Error(`Processing already in progress for job ${activeProcessingJob.jobId}`);
  }

  const jobId = randomUUID();
  activeProcessingJob = { jobId, filePath };

  try {
    const result = await processingPipeline.processEpisode(filePath, projectName, mainWindow!, jobId);
    return result;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Processing failed');
  } finally {
    if (activeProcessingJob?.jobId === jobId) {
      activeProcessingJob = null;
    }
  }
});

// Database handlers
ipcMain.handle('get-recent-projects', () => {
  return database.getRecentProjects();
});

ipcMain.handle('get-project', (event, projectId: string) => {
  return database.getProject(projectId);
});

ipcMain.handle('get-episode-clips', (event, episodeId: string) => {
  return database.getClips(episodeId);
});

ipcMain.handle('get-clip', (event, clipId: string) => {
  return database.getClip(clipId);
});

ipcMain.handle('update-clip-status', (event, clipId: string, status: string) => {
  return database.updateClipStatus(clipId, status);
});

ipcMain.handle('update-clip-boundaries', (event, clipId: string, startTime: number, endTime: number) => {
  return database.updateClipBoundaries(clipId, startTime, endTime);
});

ipcMain.handle('get-approved-clips', (event, episodeId: string) => {
  return database.getApprovedClips(episodeId);
});

ipcMain.handle('cleanup-database', () => {
  const result = database.cleanupDuplicateProjects();
  // Notify renderer that cleanup completed so it can refresh
  mainWindow?.webContents.send('database-cleaned', result);
  return result;
});

// Get episode (with fallback to project ID)
ipcMain.handle('get-episode', (event, episodeId: string) => {
  return database.getEpisode(episodeId);
});

ipcMain.handle('get-episode-by-project', (event, projectId: string) => {
  return database.getEpisodeByProjectId(projectId);
});

ipcMain.handle('get-episode-media-source', (event, episodeId: string) => {
  let episode = database.getEpisode(episodeId) as any;

  if (!episode) {
    episode = database.getEpisodeByProjectId(episodeId) as any;
  }

  if (!episode?.file_path) {
    throw new Error('Episode media source not found');
  }

  allowedMediaPaths.add(episode.file_path);

  return {
    mediaUrl: `app-file://${episode.file_path}`,
    filePath: episode.file_path,
    duration: episode.duration || 0,
  };
});

ipcMain.handle('get-transcript-segments', (event, episodeId: string) => {
  return database.getTranscriptSegments(episodeId);
});

ipcMain.handle('update-transcript-segment', (event, episodeId: string, segmentIndex: number, text: string) => {
  return database.updateTranscriptSegment(episodeId, segmentIndex, text);
});

// Settings handlers
ipcMain.handle('get-config', () => {
  return {
    apiConfig: configService.getApiConfig(),
    userPreferences: configService.getUserPreferences(),
    isConfigured: configService.isConfigured()
  };
});

ipcMain.handle('update-api-config', (event, config: any) => {
  configService.updateApiConfig(config);
  return true;
});

ipcMain.handle('update-user-preferences', (event, preferences: any) => {
  configService.updateUserPreferences(preferences);
  return true;
});

ipcMain.handle('validate-config', () => {
  return configService.validateConfig();
});

// Clip playback - extract and play actual clip
ipcMain.handle('play-clip', async (event, episodeId: string, startTime: number, endTime: number, clipId: string) => {
  try {
    console.log('play-clip called with episodeId:', episodeId)
    
    // Get episode to find original file path (with fallback)
    let episode = database.getEpisode(episodeId) as any
    console.log('Database lookup result:', episode ? 'Episode found' : 'Episode not found')
    
    if (!episode) {
      // Fallback: Try treating episodeId as projectId
      console.log('Attempting fallback: treating episodeId as projectId')
      episode = database.getEpisodeByProjectId(episodeId) as any
      
      if (episode) {
        console.log('Fallback successful: Found episode via projectId')
      } else {
        // Debug: Let's see what episodes are actually in the database
        const allEpisodes = database.getAllEpisodes()
        console.log('Available episodes in database:', allEpisodes)
        throw new Error('Episode not found')
      }
    }
    
    console.log(`Extracting and playing clip from ${startTime}s to ${endTime}s`)
    console.log('Using episode:', { id: episode.id, fileName: episode.file_name })
    
    // Use the actual episode ID for clip operations
    const actualEpisodeId = episode.id
    
    // Check if clip already exists
    if (clipService.clipExists(actualEpisodeId, clipId, startTime, endTime)) {
      const clipPath = clipService.getClipPath(actualEpisodeId, clipId, startTime, endTime)
      console.log('Using existing clip:', clipPath)
      return { success: true, message: 'Using existing clip', clipPath }
    }
    
    // Extract the clip
    console.log('Extracting new clip from:', episode.file_path)
    const clipPath = await clipService.extractClip(
      episode.file_path,
      {
        startTime,
        endTime,
        episodeId: actualEpisodeId,
        clipId
      },
      (progress) => {
        // Send progress updates to renderer
        mainWindow?.webContents.send('clip-extraction-progress', {
          clipId,
          progress,
          message: `Extracting clip... ${Math.round(progress)}%`
        })
      }
    )
    
    // Return the clip path for in-app playback
    console.log('Clip ready for playback:', clipPath)
    
    return { 
      success: true, 
      message: 'Clip extracted successfully',
      clipPath 
    }
  } catch (error) {
    console.error('Failed to extract/play clip:', error)
    throw new Error(`Failed to play clip: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
});

// Export handlers
ipcMain.handle('export-approved-clips', async (event, episodeId: string, options: any) => {
  try {
    const job = await exportService.exportApprovedClips(
      episodeId,
      options,
      (job) => {
        // Send progress updates to renderer
        mainWindow?.webContents.send('export-progress', job)
      }
    )
    return job
  } catch (error) {
    console.error('Export failed:', error)
    throw new Error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
});

ipcMain.handle('get-export-job', (event, jobId: string) => {
  return exportService.getJob(jobId)
});

ipcMain.handle('cancel-export-job', (event, jobId: string) => {
  return exportService.cancelJob(jobId)
});

ipcMain.handle('clear-completed-exports', () => {
  exportService.clearCompletedJobs()
  return { success: true }
});

// Content package handlers
ipcMain.handle('get-clip-titles', (event, clipId: string) => {
  return database.getClipTitles(clipId)
});

ipcMain.handle('get-clip-descriptions', (event, clipId: string) => {
  return database.getClipDescriptions(clipId)
});

ipcMain.handle('select-clip-title', (event, titleId: string, clipId: string) => {
  return database.selectClipTitle(titleId, clipId)
});

ipcMain.handle('select-clip-description', (event, descriptionId: string, clipId: string) => {
  return database.selectClipDescription(descriptionId, clipId)
});

// Clip edits handlers (for Editor screen)
ipcMain.handle('get-clip-edits', (event, clipId: string) => {
  return database.getClipEdits(clipId)
});

ipcMain.handle('save-clip-edits', (event, clipId: string, edits: any) => {
  return database.saveClipEdits(clipId, edits)
});

ipcMain.handle('delete-clip-edits', (event, clipId: string) => {
  return database.deleteClipEdits(clipId)
});

ipcMain.handle('get-clip-transcript-segments', (event, clipId: string) => {
  return database.getClipTranscriptSegments(clipId)
});

// Logo handlers
ipcMain.handle('upload-logo', async (event, base64Data: string, fileName: string) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // Get logos directory
    const logosDir = path.join(app.getPath('userData'), 'logos');

    // Create logos directory if it doesn't exist
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
    }

    // Extract base64 data (remove data:image/...;base64, prefix)
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data');
    }

    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Generate unique filename
    const timestamp = Date.now();
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    const uniqueFileName = `${baseName}_${timestamp}${ext}`;
    const logoPath = path.join(logosDir, uniqueFileName);

    // Write file
    fs.writeFileSync(logoPath, buffer);

    console.log('Logo uploaded successfully:', logoPath);

    return {
      success: true,
      path: logoPath
    };
  } catch (error: any) {
    console.error('Failed to upload logo:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
});

ipcMain.handle('list-logos', async () => {
  try {
    const fs = require('fs');
    const path = require('path');

    const logosDir = path.join(app.getPath('userData'), 'logos');

    // Create directory if it doesn't exist
    if (!fs.existsSync(logosDir)) {
      fs.mkdirSync(logosDir, { recursive: true });
      return [];
    }

    // Read directory
    const files = fs.readdirSync(logosDir);

    // Filter to only image files and return full paths
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.svg', '.webp'];
    const logoPaths = files
      .filter((file: string) => imageExtensions.includes(path.extname(file).toLowerCase()))
      .map((file: string) => path.join(logosDir, file));

    return logoPaths;
  } catch (error) {
    console.error('Failed to list logos:', error);
    return [];
  }
});

// Music upload handler
ipcMain.handle('upload-music', async (event, base64Data: string, fileName: string) => {
  try {
    const fs = require('fs');
    const path = require('path');

    // Get music directory
    const musicDir = path.join(app.getPath('userData'), 'music');

    // Create music directory if it doesn't exist
    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
    }

    // Extract base64 data (remove data:audio/...;base64, prefix)
    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 data');
    }

    const base64Content = matches[2];
    const buffer = Buffer.from(base64Content, 'base64');

    // Generate unique filename
    const timestamp = Date.now();
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    const uniqueFileName = `${baseName}_${timestamp}${ext}`;
    const musicPath = path.join(musicDir, uniqueFileName);

    // Write file
    fs.writeFileSync(musicPath, buffer);

    console.log('Music uploaded successfully:', musicPath);

    return {
      success: true,
      path: musicPath
    };
  } catch (error: any) {
    console.error('Failed to upload music:', error);
    return {
      success: false,
      error: error?.message || 'Unknown error'
    };
  }
});

ipcMain.handle('list-music', async () => {
  try {
    const fs = require('fs');
    const path = require('path');

    const musicDir = path.join(app.getPath('userData'), 'music');

    // Create directory if it doesn't exist
    if (!fs.existsSync(musicDir)) {
      fs.mkdirSync(musicDir, { recursive: true });
      return [];
    }

    // Read directory
    const files = fs.readdirSync(musicDir);

    // Filter to only audio files and return full paths
    const audioExtensions = ['.mp3', '.wav', '.m4a'];
    const musicPaths = files
      .filter((file: string) => audioExtensions.includes(path.extname(file).toLowerCase()))
      .map((file: string) => path.join(musicDir, file));

    return musicPaths;
  } catch (error) {
    console.error('Failed to list music:', error);
    return [];
  }
});

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Nuke all projects (complete wipe for debugging)
ipcMain.handle('nuke-all-projects', () => {
  return database.nukeAllProjects();
});

// Delete a single project
ipcMain.handle('delete-project', (event, projectId: string) => {
  return database.deleteProject(projectId);
});
