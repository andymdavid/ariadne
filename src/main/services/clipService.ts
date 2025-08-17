import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { randomUUID } from 'crypto'
import ffmpeg from 'fluent-ffmpeg'
import { app } from 'electron'

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

    return new Promise((resolve, reject) => {
      ffmpeg(sourceFilePath)
        .seekInput(startTime)
        .duration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .output(clipFilePath)
        .on('start', (commandLine) => {
          console.log('FFmpeg started with command:', commandLine)
        })
        .on('progress', (progress) => {
          if (onProgress) {
            // Calculate percentage based on time processed vs duration
            const percent = Math.min(100, (progress.timemark ? this.parseTimeToSeconds(progress.timemark) / duration * 100 : 0))
            onProgress(percent)
          }
        })
        .on('end', () => {
          console.log('Clip extraction completed:', clipFilePath)
          resolve(clipFilePath)
        })
        .on('error', (error) => {
          console.error('FFmpeg error:', error)
          reject(new Error(`Failed to extract clip: ${error.message}`))
        })
        .run()
    })
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
   * Parse FFmpeg time format (HH:MM:SS.ms) to seconds
   */
  private parseTimeToSeconds(timeString: string): number {
    const parts = timeString.split(':')
    if (parts.length !== 3) return 0
    
    const hours = parseInt(parts[0]) || 0
    const minutes = parseInt(parts[1]) || 0
    const seconds = parseFloat(parts[2]) || 0
    
    return hours * 3600 + minutes * 60 + seconds
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