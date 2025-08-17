import ffmpeg from 'fluent-ffmpeg'
import { join, dirname, basename, extname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { app } from 'electron'

export interface MediaInfo {
  duration: number
  hasVideo: boolean
  hasAudio: boolean
  videoCodec?: string
  audioCodec?: string
  resolution?: { width: number; height: number }
  bitrate?: number
}

export interface ProcessingOptions {
  outputPath: string
  format: 'mp4' | 'mov' | 'mp3' | 'wav'
  resolution?: { width: number; height: number }
  startTime?: number
  duration?: number
  audioOnly?: boolean
}

class FFmpegService {
  private tempDir: string
  
  constructor() {
    this.tempDir = join(app.getPath('userData'), 'temp')
    this.ensureTempDir()
  }
  
  private ensureTempDir() {
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true })
    }
  }
  
  /**
   * Get media file information
   */
  async getMediaInfo(inputPath: string): Promise<MediaInfo> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (error, metadata) => {
        if (error) {
          reject(new Error(`Failed to probe media file: ${error.message}`))
          return
        }
        
        const videoStream = metadata.streams.find(s => s.codec_type === 'video')
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio')
        
        const info: MediaInfo = {
          duration: metadata.format.duration || 0,
          hasVideo: !!videoStream,
          hasAudio: !!audioStream,
          videoCodec: videoStream?.codec_name,
          audioCodec: audioStream?.codec_name,
          bitrate: metadata.format.bit_rate,
        }
        
        if (videoStream && videoStream.width && videoStream.height) {
          info.resolution = {
            width: videoStream.width,
            height: videoStream.height,
          }
        }
        
        resolve(info)
      })
    })
  }
  
  /**
   * Extract audio from video file
   */
  async extractAudio(
    inputPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const finalOutputPath = outputPath || this.generateTempPath(inputPath, 'wav')
    
    return new Promise((resolve, reject) => {
      const command = ffmpeg(inputPath)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .output(finalOutputPath)
      
      if (onProgress) {
        command.on('progress', (progress) => {
          onProgress(progress.percent || 0)
        })
      }
      
      command
        .on('end', () => resolve(finalOutputPath))
        .on('error', (error) => reject(new Error(`Audio extraction failed: ${error.message}`)))
        .run()
    })
  }
  
  /**
   * Create video clip from source
   */
  async createClip(
    inputPath: string,
    startTime: number,
    duration: number,
    outputPath: string,
    options: {
      format?: 'mp4' | 'mov'
      resolution?: { width: number; height: number }
      addCaptions?: boolean
      addLogo?: boolean
      onProgress?: (progress: number) => void
    } = {}
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .seekInput(startTime)
        .duration(duration)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format(options.format || 'mp4')
        .output(outputPath)
      
      // Apply resolution if specified
      if (options.resolution) {
        command = command.size(`${options.resolution.width}x${options.resolution.height}`)
      }
      
      // Add progress tracking
      if (options.onProgress) {
        command.on('progress', (progress) => {
          options.onProgress!(progress.percent || 0)
        })
      }
      
      command
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Clip creation failed: ${error.message}`)))
        .run()
    })
  }
  
  /**
   * Process multiple clips in batch
   */
  async createClipsBatch(
    inputPath: string,
    clips: Array<{
      id: string
      startTime: number
      duration: number
      outputPath: string
    }>,
    onProgress?: (clipIndex: number, clipProgress: number) => void
  ): Promise<string[]> {
    const results: string[] = []
    
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]
      try {
        const outputPath = await this.createClip(
          inputPath,
          clip.startTime,
          clip.duration,
          clip.outputPath,
          {
            onProgress: (progress) => {
              onProgress?.(i, progress)
            }
          }
        )
        results.push(outputPath)
      } catch (error) {
        console.error(`Failed to create clip ${clip.id}:`, error)
        throw error
      }
    }
    
    return results
  }
  
  /**
   * Apply post-processing effects
   */
  async applyEffects(
    inputPath: string,
    outputPath: string,
    effects: {
      addLogo?: { path: string; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' }
      addBackground?: { color: string }
      fadeIn?: number
      fadeOut?: number
      volume?: number
    },
    onProgress?: (progress: number) => void
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
      
      // Build filter complex
      const filters: string[] = []
      
      if (effects.addBackground) {
        filters.push(`color=${effects.addBackground.color}:size=1080x1920[bg]`)
        filters.push('[0:v][bg]overlay=(W-w)/2:(H-h)/2[v]')
      }
      
      if (effects.addLogo && existsSync(effects.addLogo.path)) {
        // Logo overlay logic would go here
      }
      
      if (effects.fadeIn || effects.fadeOut) {
        let fadeFilter = '[0:v]'
        if (effects.fadeIn) {
          fadeFilter += `fade=in:0:${Math.floor(effects.fadeIn * 30)}`
        }
        if (effects.fadeOut) {
          fadeFilter += `:fade=out:${Math.floor((30 * 60) - (effects.fadeOut * 30))}:${Math.floor(effects.fadeOut * 30)}`
        }
        fadeFilter += '[v]'
        filters.push(fadeFilter)
      }
      
      if (filters.length > 0) {
        command = command.complexFilter(filters)
      }
      
      if (effects.volume && effects.volume !== 1) {
        command = command.audioFilter(`volume=${effects.volume}`)
      }
      
      command
        .output(outputPath)
        .on('progress', (progress) => {
          onProgress?.(progress.percent || 0)
        })
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Effect application failed: ${error.message}`)))
        .run()
    })
  }
  
  /**
   * Generate temporary file path
   */
  private generateTempPath(originalPath: string, extension: string): string {
    const fileName = basename(originalPath, extname(originalPath))
    const timestamp = Date.now()
    return join(this.tempDir, `${fileName}_${timestamp}.${extension}`)
  }
  
  /**
   * Clean up temporary files
   */
  cleanupTemp() {
    // TODO: Implement cleanup logic
    console.log('Cleaning up temporary files...')
  }
}

export const ffmpegService = new FFmpegService()