import { app, BrowserWindow, ipcMain, dialog, shell, protocol } from 'electron';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { database } from './database/database';
import { processingPipeline } from './services/processingPipeline';
import { configService } from './services/configService';
import { clipService } from './services/clipService';
import { exportService } from './services/exportService';
import { ffmpegService } from './services/ffmpegService';
import type { BrandTemplate, TrimBoundaryAnchor } from '@shared/types';
import type {
  GetActivePipelineJobRequestDTO,
  GetActivePipelineJobResponseDTO,
  ProcessEpisodeRequestDTO,
  ProcessEpisodeResponseDTO,
  ProcessSourceRequestDTO,
  ProcessSourceResponseDTO
} from '@shared/types/pipelineIpc';
import type {
  CancelExportJobRequestDTO,
  CancelExportJobResponseDTO,
  ClearCompletedExportsResponseDTO,
  GetActiveExportJobRequestDTO,
  GetActiveExportJobResponseDTO,
  GetExportJobRequestDTO,
  GetExportJobResponseDTO,
  StartExportRequestDTO,
  StartExportResponseDTO
} from '@shared/types/exportIpc';

// TODO: Add electron-reload for development

let mainWindow: BrowserWindow | null = null;
let activeProcessingJob: { jobId: string; filePath: string } | null = null;
const allowedMediaPaths = new Set<string>();
const execFileAsync = promisify(execFile);

const isDev = process.env.NODE_ENV === 'development';

function looksLikeRemoteUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function needsMediaExtractor(rawUrl: string) {
  try {
    const hostname = new URL(rawUrl).hostname.replace(/^www\./, '').toLowerCase()
    return [
      'youtube.com',
      'youtu.be',
      'rumble.com',
      'm.youtube.com',
      'x.com',
      'twitter.com',
      'instagram.com',
      'tiktok.com'
    ].includes(hostname)
  } catch {
    return false
  }
}

function resolveMediaExtractorBinary() {
  const home = process.env.HOME || ''
  const candidates = [
    process.env.YT_DLP_PATH,
    'yt-dlp',
    'youtube-dl',
    home ? `${home}/Library/Python/3.9/bin/yt-dlp` : '',
    home ? `${home}/Library/Python/3.9/bin/youtube-dl` : '',
    home ? `${home}/.local/bin/yt-dlp` : '',
    '/opt/homebrew/bin/yt-dlp',
    '/usr/local/bin/yt-dlp'
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    if (!candidate.includes('/') || existsSync(candidate)) {
      return candidate
    }
  }

  throw new Error('yt-dlp is required for YouTube and webpage links, but it is not installed.')
}

function normalizeGoogleDriveUrl(rawUrl: string) {
  const url = new URL(rawUrl)
  if (!url.hostname.includes('drive.google.com')) {
    return rawUrl
  }

  const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/)
  const fileId = fileMatch?.[1] || url.searchParams.get('id')
  if (!fileId) {
    return rawUrl
  }

  return `https://drive.google.com/uc?export=download&id=${fileId}`
}

function sanitizeProjectName(value: string) {
  return value
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Imported Episode'
}

function inferProjectNameFromSource(source: string) {
  try {
    const url = new URL(source)
    const lastSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '')
    if (lastSegment) {
      return sanitizeProjectName(lastSegment)
    }
    return sanitizeProjectName(url.hostname.replace(/^www\./, ''))
  } catch {
    const fileName = source.split('/').pop() || source
    return sanitizeProjectName(fileName)
  }
}

async function downloadRemoteMedia(sourceUrl: string) {
  const fs = require('fs')
  const fsPromises = require('fs/promises')
  const http = require('http')
  const https = require('https')
  const path = require('path')

  const resolvedUrl = normalizeGoogleDriveUrl(sourceUrl)
  const importsDir = path.join(app.getPath('userData'), 'imports')
  await fsPromises.mkdir(importsDir, { recursive: true })

  const inferExtension = (contentType?: string) => {
    switch ((contentType || '').split(';')[0].trim().toLowerCase()) {
      case 'audio/mpeg':
        return '.mp3'
      case 'audio/mp4':
      case 'audio/x-m4a':
        return '.m4a'
      case 'audio/wav':
      case 'audio/x-wav':
        return '.wav'
      case 'video/mp4':
        return '.mp4'
      case 'video/quicktime':
        return '.mov'
      default:
        return ''
    }
  }

  const isSupportedMediaType = (contentType?: string) => {
    const normalized = (contentType || '').split(';')[0].trim().toLowerCase()
    return [
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/wav',
      'audio/x-wav',
      'video/mp4',
      'video/quicktime'
    ].includes(normalized)
  }

  const fileNameFromHeaders = (headers: Record<string, string | string[] | undefined>) => {
    const dispositionHeader = headers['content-disposition']
    const disposition = Array.isArray(dispositionHeader) ? dispositionHeader[0] : dispositionHeader
    const utf8Match = disposition?.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1])
    }
    const plainMatch = disposition?.match(/filename="?([^"]+)"?/i)
    return plainMatch?.[1] || null
  }

  const download = (currentUrl: string, redirects = 0): Promise<{ filePath: string; projectName: string }> =>
    new Promise((resolve, reject) => {
      if (redirects > 5) {
        reject(new Error('Too many redirects while downloading source'))
        return
      }

      const client = currentUrl.startsWith('https:') ? https : http
      const request = client.get(
        currentUrl,
        {
          headers: {
            'User-Agent': 'Ariadne/1.0'
          }
        },
        (response: any) => {
          const statusCode = response.statusCode ?? 0

          if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
            response.resume()
            const nextUrl = new URL(response.headers.location, currentUrl).toString()
            download(nextUrl, redirects + 1).then(resolve).catch(reject)
            return
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume()
            reject(new Error(`Source download failed with status ${statusCode}`))
            return
          }

          const contentTypeHeader = response.headers['content-type']
          const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader
          if (!isSupportedMediaType(contentType)) {
            response.resume()
            reject(
              new Error(
                'Unsupported link. Paste a direct media file URL or a Google Drive file link.'
              )
            )
            return
          }

          const headerFileName = fileNameFromHeaders(response.headers)
          const pathnameName = decodeURIComponent(new URL(currentUrl).pathname.split('/').filter(Boolean).pop() || '')
          const rawFileName = headerFileName || pathnameName || `import-${Date.now()}`
          const extFromName = path.extname(rawFileName)
          const extension = extFromName || inferExtension(contentType)
          const baseName = sanitizeProjectName(rawFileName)
          const storedFileName = `${baseName.replace(/\s+/g, '-')}-${Date.now()}${extension}`
          const filePath = path.join(importsDir, storedFileName)
          const writeStream = fs.createWriteStream(filePath)

          response.pipe(writeStream)
          writeStream.on('finish', () => {
            writeStream.close(() => {
              resolve({
                filePath,
                projectName: sanitizeProjectName(rawFileName)
              })
            })
          })
          writeStream.on('error', (error: Error) => {
            reject(error)
          })
        }
      )

      request.on('error', (error: Error) => {
        reject(error)
      })
    })

  return download(resolvedUrl)
}

async function downloadWithMediaExtractor(sourceUrl: string) {
  const fsPromises = require('fs/promises')
  const path = require('path')
  const importsDir = path.join(app.getPath('userData'), 'imports')
  await fsPromises.mkdir(importsDir, { recursive: true })

  const extractorBinary = resolveMediaExtractorBinary()
  const metadataArgs = ['--dump-single-json', '--no-playlist', sourceUrl]
  let metadataStdout: string
  try {
    ;({ stdout: metadataStdout } = await execFileAsync(extractorBinary, metadataArgs, {
      maxBuffer: 20 * 1024 * 1024
    }))
  } catch (error: any) {
    const detail = error?.stderr || error?.stdout || error?.message || 'Unknown extractor error'
    throw new Error(`Could not read media from that link: ${detail}`.trim())
  }

  const metadata = JSON.parse(metadataStdout)
  const downloadArgs = [
    '--no-playlist',
    '--restrict-filenames',
    '-P',
    importsDir,
    '-o',
    '%(title).160B-%(id)s.%(ext)s',
    '--print',
    'after_move:filepath',
    sourceUrl
  ]

  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(extractorBinary, downloadArgs, {
      maxBuffer: 20 * 1024 * 1024
    }))
  } catch (error: any) {
    const detail = error?.stderr || error?.stdout || error?.message || 'Unknown extractor error'
    throw new Error(`Could not download media from that link: ${detail}`.trim())
  }

  const filePath = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop()

  if (!filePath) {
    throw new Error('Media extractor did not return a downloaded file path.')
  }

  try {
    const mediaInfo = await ffmpegService.getMediaInfo(filePath)
    if (!mediaInfo.hasAudio && !mediaInfo.hasVideo) {
      throw new Error('Downloaded file did not contain playable audio or video.')
    }
  } catch (error) {
    await fsPromises.unlink(filePath).catch(() => undefined)
    throw new Error('Could not extract a playable media file from that link.')
  }

  return {
    filePath,
    projectName: sanitizeProjectName(metadata.title || inferProjectNameFromSource(sourceUrl))
  }
}

async function runProcessingJob(filePath: string, projectName?: string) {
  if (activeProcessingJob) {
    throw new Error(`Processing already in progress for job ${activeProcessingJob.jobId}`);
  }

  const jobId = randomUUID();
  activeProcessingJob = { jobId, filePath };

  try {
    return await processingPipeline.processEpisode(filePath, projectName, mainWindow!, jobId);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Processing failed');
  } finally {
    if (activeProcessingJob?.jobId === jobId) {
      activeProcessingJob = null;
    }
  }
}

async function resolveSourceToFile(source: string) {
  if (looksLikeRemoteUrl(source)) {
    if (needsMediaExtractor(source)) {
      return downloadWithMediaExtractor(source)
    }
    const downloaded = await downloadRemoteMedia(source)
    try {
      const mediaInfo = await ffmpegService.getMediaInfo(downloaded.filePath)
      if (!mediaInfo.hasAudio && !mediaInfo.hasVideo) {
        throw new Error('Downloaded file did not contain playable media.')
      }
    } catch (error) {
      const fsPromises = require('fs/promises')
      await fsPromises.unlink(downloaded.filePath).catch(() => undefined)
      throw new Error('Unsupported link. Paste a direct media file URL, Google Drive file link, or use Upload.')
    }
    return downloaded
  }

  return {
    filePath: source,
    projectName: inferProjectNameFromSource(source)
  }
}

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

async function backfillEpisodeFrameRates(batchSize = 25) {
  try {
    let pending = database.getEpisodesMissingFrameRate(batchSize) as Array<{ id: string; file_path: string }>
    if (!pending.length) {
      console.log('[FrameRate] All episodes already have stored frame rate metadata')
      return
    }

    console.log(`[FrameRate] Backfilling frame rate for ${pending.length} episode(s)`)

    while (pending.length) {
      for (const episode of pending) {
        try {
          const mediaInfo = await ffmpegService.getMediaInfo(episode.file_path)
          if (mediaInfo.frameRate && Number.isFinite(mediaInfo.frameRate)) {
            database.updateEpisodeFrameRate(episode.id, mediaInfo.frameRate)
            console.log(`[FrameRate] Stored ${mediaInfo.frameRate.toFixed(3)} fps for episode ${episode.id}`)
          } else {
            console.warn(`[FrameRate] No frame rate available for episode ${episode.id} (${episode.file_path})`)
          }
        } catch (error) {
          console.error(`[FrameRate] Failed to backfill episode ${episode.id}:`, error)
        }
      }

      pending = database.getEpisodesMissingFrameRate(batchSize) as Array<{ id: string; file_path: string }>
      if (pending.length) {
        console.log(`[FrameRate] Continuing backfill, ${pending.length} episode(s) remaining`)
      }
    }

    console.log('[FrameRate] Backfill completed')
  } catch (error) {
    console.error('[FrameRate] Backfill failed:', error)
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
app.whenReady().then(async () => {
  // Register the app-file protocol to serve local files securely
  protocol.registerFileProtocol('app-file', (request, callback) => {
    const rawPath = request.url.replace('app-file://', '')
    const filePath = decodeURIComponent(rawPath)
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

  await createWindow();

  exportService.recoverExports((job) => {
    mainWindow?.webContents.send('export-progress', job)
  }).catch((error) => {
    console.error('Export recovery failed:', error)
  })

  backfillClipDimensions().catch((error) => {
    console.error('[ClipDimensions] Backfill task error:', error)
  })

  backfillEpisodeFrameRates().catch((error) => {
    console.error('[FrameRate] Backfill task error:', error)
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
ipcMain.handle('process-episode', async (_event, request: ProcessEpisodeRequestDTO): Promise<ProcessEpisodeResponseDTO> => {
  return runProcessingJob(request.filePath, request.projectName)
});

ipcMain.handle('process-source', async (_event, request: ProcessSourceRequestDTO): Promise<ProcessSourceResponseDTO> => {
  const resolvedSource = await resolveSourceToFile(request.source)
  return runProcessingJob(resolvedSource.filePath, request.projectName || resolvedSource.projectName)
})

ipcMain.handle('get-active-pipeline-job', (_event, request: GetActivePipelineJobRequestDTO): GetActivePipelineJobResponseDTO => {
  return processingPipeline.getActiveJob(request.episodeId, request.projectId)
})

// Database handlers
ipcMain.handle('get-recent-projects', () => {
  const projects = database.getRecentProjects() as Array<{ file_path?: string | null; thumbnail_path?: string | null }>
  projects.forEach((project) => {
    if (project.file_path) {
      allowedMediaPaths.add(project.file_path)
    }
    if (project.thumbnail_path) {
      allowedMediaPaths.add(project.thumbnail_path)
    }
  })
  return projects
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

ipcMain.handle('get-clip-trim-state', (event, clipId: string) => {
  return database.getClipTrimState(clipId);
});

ipcMain.handle('update-clip-status', (event, clipId: string, status: string) => {
  return database.updateClipStatus(clipId, status);
});

ipcMain.handle('update-clip-boundaries', (event, clipId: string, startTime: number, endTime: number) => {
  return database.updateClipBoundaries(clipId, startTime, endTime);
});

ipcMain.handle(
  'save-clip-trim-state',
  (event, clipId: string, inPoint: number, outPoint: number, inAnchor?: TrimBoundaryAnchor | null, outAnchor?: TrimBoundaryAnchor | null) => {
    return database.saveClipTrimState(clipId, inPoint, outPoint, inAnchor, outAnchor);
  }
);

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
    frameRate: episode.frame_rate ?? null,
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
    brandTemplate: configService.getBrandTemplate(),
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

ipcMain.handle('get-brand-template', () => {
  return configService.getBrandTemplate()
})

ipcMain.handle('update-brand-template', (event, template: Partial<BrandTemplate>) => {
  return configService.updateBrandTemplate(template)
})

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
ipcMain.handle('export-approved-clips', async (_event, request: StartExportRequestDTO): Promise<StartExportResponseDTO> => {
  try {
    const job = await exportService.exportApprovedClips(
      request.episodeId,
      request.options,
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

ipcMain.handle('get-export-job', (_event, request: GetExportJobRequestDTO): GetExportJobResponseDTO => {
  return exportService.getJob(request.jobId)
});

ipcMain.handle('get-active-export-job', (_event, request: GetActiveExportJobRequestDTO): GetActiveExportJobResponseDTO => {
  return exportService.getActiveJobForEpisode(request.episodeId)
});

ipcMain.handle('cancel-export-job', (_event, request: CancelExportJobRequestDTO): CancelExportJobResponseDTO => {
  return exportService.cancelJob(request.jobId)
});

ipcMain.handle('clear-completed-exports', (): ClearCompletedExportsResponseDTO => {
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
