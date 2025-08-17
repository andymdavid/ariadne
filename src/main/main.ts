import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import { join } from 'path';
import { existsSync, createReadStream } from 'fs';
import { database } from './database/database';
import { processingPipeline } from './services/processingPipeline';
import { configService } from './services/configService';
import { clipService } from './services/clipService';

// TODO: Add electron-reload for development

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV === 'development';

function createWindow(): void {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1200,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, 'preload.js'),
    },
    titleBarStyle: 'hiddenInset',
    show: false,
    backgroundColor: '#0d1117', // Match our dark theme
  });

  // Load the app
  if (isDev) {
    // Wait a bit for Vite server to be ready, then load
    setTimeout(() => {
      mainWindow?.loadURL('http://localhost:5173').catch((err) => {
        console.error('Failed to load Vite URL:', err);
        // Fallback: try to load built files
        const indexPath = join(__dirname, '../renderer/index.html');
        if (existsSync(indexPath)) {
          mainWindow?.loadFile(indexPath);
        }
      });
      mainWindow?.webContents.openDevTools();
    }, 1000);
  } else {
    const indexPath = join(__dirname, '../renderer/index.html');
    if (existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      console.error('Could not find index.html at', indexPath);
    }
  }

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    console.log('Ariadne window is ready and shown');
  });

  // Also show window after DOM is ready as backup
  mainWindow.webContents.once('dom-ready', () => {
    if (!mainWindow?.isVisible()) {
      mainWindow?.show();
      console.log('Ariadne window shown after DOM ready');
    }
  });

  // Handle load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', validatedURL, 'Error:', errorDescription);
    mainWindow?.show(); // Show window even on load failure
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Register custom protocol for serving local files
app.whenReady().then(() => {
  // Register the app-file protocol to serve local files securely
  protocol.registerFileProtocol('app-file', (request, callback) => {
    const filePath = request.url.replace('app-file://', '')
    console.log('Serving file via app-file protocol:', filePath)
    
    // Security check: ensure the file exists and is in a safe location
    if (existsSync(filePath) && (filePath.includes(app.getPath('userData')) || filePath.includes('/tmp/'))) {
      callback({ path: filePath })
    } else {
      console.error('File not found or not in safe location:', filePath)
      callback({ error: -6 }) // FILE_NOT_FOUND
    }
  })
  
  createWindow();

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
  try {
    const result = await processingPipeline.processEpisode(filePath, projectName, mainWindow!);
    return result;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Processing failed');
  }
});

// Database handlers
ipcMain.handle('get-recent-projects', () => {
  return configService.getRecentProjects();
});

ipcMain.handle('get-project', (event, projectId: string) => {
  return database.getProject(projectId);
});

ipcMain.handle('get-episode-clips', (event, episodeId: string) => {
  return database.getClips(episodeId);
});

ipcMain.handle('update-clip-status', (event, clipId: string, status: string) => {
  return database.updateClipStatus(clipId, status);
});

ipcMain.handle('get-approved-clips', (event, episodeId: string) => {
  return database.getApprovedClips(episodeId);
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
    // Get episode to find original file path
    const episode = database.getEpisode(episodeId) as any
    if (!episode) {
      throw new Error('Episode not found')
    }
    
    console.log(`Extracting and playing clip from ${startTime}s to ${endTime}s`)
    
    // Check if clip already exists
    if (clipService.clipExists(episodeId, clipId, startTime, endTime)) {
      const clipPath = clipService.getClipPath(episodeId, clipId, startTime, endTime)
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
        episodeId,
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

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});