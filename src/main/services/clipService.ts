import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import { mediaWorkerSupervisor } from './mediaWorkerSupervisor'

interface ClipExtractionOptions {
  startTime: number
  endTime: number
  episodeId: string
  clipId: string
}

export class ClipService {
  private clipsDir: string

  constructor() {
    // Create clips directory in user data
    this.clipsDir = join(app.getPath('userData'), 'clips')
    if (!existsSync(this.clipsDir)) {
      mkdirSync(this.clipsDir, { recursive: true })
    }
  }

  /**
   * Extract a clip from the source video/audio file
   */
  async extractClip(
    sourceFilePath: string, 
    options: ClipExtractionOptions,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const { startTime, endTime, episodeId, clipId } = options
    const duration = endTime - startTime
    
    // Generate clip filename
    const clipFileName = `${episodeId}_${clipId}_${startTime}s-${endTime}s.mp4`
    const clipFilePath = join(this.clipsDir, clipFileName)
    
    // Check if clip already exists
    if (existsSync(clipFilePath)) {
      console.log('Clip already exists:', clipFilePath)
      return clipFilePath
    }

    console.log(`Extracting clip from ${startTime}s to ${endTime}s (${duration}s duration)`)
    console.log('Source file:', sourceFilePath)
    console.log('Output file:', clipFilePath)

    const extractedClipPath = await mediaWorkerSupervisor.extractPreviewClip(
      sourceFilePath,
      startTime,
      duration,
      clipFilePath,
      onProgress
    )

    console.log('Clip extraction completed:', extractedClipPath)
    return extractedClipPath
  }

  /**
   * Get the path for a clip (returns existing path if already extracted)
   */
  getClipPath(episodeId: string, clipId: string, startTime: number, endTime: number): string {
    const clipFileName = `${episodeId}_${clipId}_${startTime}s-${endTime}s.mp4`
    return join(this.clipsDir, clipFileName)
  }

  /**
   * Check if a clip has already been extracted
   */
  clipExists(episodeId: string, clipId: string, startTime: number, endTime: number): boolean {
    const clipPath = this.getClipPath(episodeId, clipId, startTime, endTime)
    return existsSync(clipPath)
  }

  /**
   * Clean up old clip files (optional maintenance function)
   */
  async cleanupOldClips(maxAgeHours: number = 24): Promise<void> {
    const fs = await import('fs')
    const maxAge = maxAgeHours * 60 * 60 * 1000 // Convert to milliseconds
    const now = Date.now()

    try {
      const files = await fs.promises.readdir(this.clipsDir)
      
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          const filePath = join(this.clipsDir, file)
          const stats = await fs.promises.stat(filePath)
          
          if (now - stats.mtime.getTime() > maxAge) {
            await fs.promises.unlink(filePath)
            console.log('Cleaned up old clip:', file)
          }
        }
      }
    } catch (error) {
      console.warn('Failed to cleanup old clips:', error)
    }
  }
}

export const clipService = new ClipService()
