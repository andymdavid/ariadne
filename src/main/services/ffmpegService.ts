import ffmpeg from 'fluent-ffmpeg'
import { join, dirname, basename, extname } from 'path'
import { mkdirSync, existsSync } from 'fs'
import * as path from 'path'

let electronApp: { getPath: (name: string) => string; isPackaged: boolean; getAppPath: () => string } | undefined
try {
  electronApp = require('electron').app
} catch {
  electronApp = undefined
}

export interface MediaInfo {
  duration: number
  hasVideo: boolean
  hasAudio: boolean
  videoCodec?: string
  audioCodec?: string
  resolution?: { width: number; height: number }
  frameRate?: number
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
  private activeExportCommand: ReturnType<typeof ffmpeg> | null = null
  private tempDir: string
  private fontsDir: string

  constructor() {
    const userDataPath = process.env.ARIADNE_USER_DATA_PATH
      || (electronApp ? electronApp.getPath('userData') : join(process.cwd(), 'tmp'))
    this.tempDir = join(userDataPath, 'temp')
    this.ensureTempDir()

    // Set fonts directory path
    // In development: assets/fonts relative to project root
    // In production: resources/assets/fonts in the app bundle
    const configuredFontsDir = process.env.ARIADNE_FONTS_DIR
    if (configuredFontsDir) {
      this.fontsDir = configuredFontsDir
    } else if (!electronApp || !electronApp.isPackaged) {
      const appPath = process.env.ARIADNE_APP_PATH || process.cwd()
      this.fontsDir = path.join(appPath, 'assets', 'fonts')
    } else {
      this.fontsDir = path.join(process.resourcesPath, 'assets', 'fonts')
    }
    console.log('[FFmpegService] Fonts directory:', this.fontsDir)
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

        const rateValue = videoStream?.avg_frame_rate || videoStream?.r_frame_rate
        if (typeof rateValue === 'string' && rateValue !== '0/0') {
          const [numerator, denominator] = rateValue.split('/').map(Number)
          if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
            info.frameRate = numerator / denominator
          }
        }
        
        resolve(info)
      })
    })
  }
  
  /**
   * Detect silences in the source audio with ffmpeg's silencedetect filter.
   * Whisper word timestamps are contiguous by construction and absorb real pauses
   * into word spans, so cut placement must read the waveform, not the transcript.
   */
  async detectSilences(
    inputPath: string,
    options: { noiseDb?: number; minDurationSeconds?: number } = {}
  ): Promise<Array<{ start: number; end: number }>> {
    const noiseDb = options.noiseDb ?? -26
    const minDuration = options.minDurationSeconds ?? 0.12

    return new Promise((resolve, reject) => {
      const silences: Array<{ start: number; end: number }> = []
      let pendingStart: number | null = null

      ffmpeg(inputPath)
        .noVideo()
        .audioFilters(`silencedetect=noise=${noiseDb}dB:d=${minDuration}`)
        .format('null')
        .output('-')
        .on('stderr', (line: string) => {
          const startMatch = line.match(/silence_start:\s*([\d.]+)/)
          if (startMatch) {
            pendingStart = Number(startMatch[1])
            return
          }
          const endMatch = line.match(/silence_end:\s*([\d.]+)/)
          if (endMatch && pendingStart !== null) {
            silences.push({ start: pendingStart, end: Number(endMatch[1]) })
            pendingStart = null
          }
        })
        .on('end', () => resolve(silences.sort((left, right) => left.start - right.start)))
        .on('error', (error) => reject(new Error(`Silence detection failed: ${error.message}`)))
        .run()
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

  async generateWaveformPeaks(
    inputPath: string,
    startTime: number,
    duration: number,
    sampleCount = 180
  ): Promise<number[]> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (probeError, metadata) => {
        if (probeError) {
          reject(new Error(`Waveform generation failed: ${probeError.message}`))
          return
        }

        const hasAudio = metadata.streams.some((stream) => stream.codec_type === 'audio')
        if (!hasAudio) {
          resolve([])
          return
        }

      const chunks: Buffer[] = []
      const command = ffmpeg(inputPath)
        .noVideo()
        .seekInput(startTime)
        .duration(duration)
        .audioChannels(1)
        .audioFrequency(8000)
        .audioCodec('pcm_f32le')
        .outputOptions(['-map a:0'])
        .format('f32le')

      const stream = command.pipe()

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      stream.on('error', (error: Error) => {
        reject(new Error(`Waveform generation failed: ${error.message}`))
      })

      command.on('error', (error) => {
        reject(new Error(`Waveform generation failed: ${error.message}`))
      })

      command.on('end', () => {
        try {
          const buffer = Buffer.concat(chunks)
          if (buffer.length < 4) {
            resolve([])
            return
          }

          const floatCount = Math.floor(buffer.length / 4)
          const values = new Float32Array(floatCount)
          for (let index = 0; index < floatCount; index += 1) {
            values[index] = buffer.readFloatLE(index * 4)
          }

          const blockSize = Math.max(1, Math.floor(values.length / sampleCount))
          const peaks: number[] = []

          for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
            const start = sampleIndex * blockSize
            const end = Math.min(values.length, start + blockSize)
            let peak = 0

            for (let valueIndex = start; valueIndex < end; valueIndex += 1) {
              peak = Math.max(peak, Math.abs(values[valueIndex] ?? 0))
            }

            peaks.push(peak)
          }

          const maxPeak = Math.max(...peaks, 0)
          if (maxPeak <= 0) {
            resolve(peaks.map(() => 0))
            return
          }

          resolve(peaks.map((peak) => peak / maxPeak))
        } catch (error) {
          reject(error instanceof Error ? error : new Error('Waveform normalization failed'))
        }
      })
      })
    })
  }

  async extractFrame(
    inputPath: string,
    timeSeconds: number,
    outputPath: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const outputDir = dirname(outputPath)
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }

      ffmpeg(inputPath)
        .seekInput(Math.max(0, timeSeconds))
        .frames(1)
        .outputOptions(['-q:v 2'])
        .output(outputPath)
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Frame extraction failed: ${error.message}`)))
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
        // Match the export's boundary micro-fades so previews sound like exports
        .audioFilters([
          'afade=t=in:st=0:d=0.04',
          `afade=t=out:st=${Math.max(0, duration - 0.12).toFixed(3)}:d=0.12`
        ])
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
   * Add captions to video
   */
  async addCaptions(
    inputPath: string,
    outputPath: string,
    captions: string,
    options: {
      fontSize?: number
      fontColor?: string
      backgroundColor?: string
      position?: 'bottom' | 'center' | 'top'
      onProgress?: (progress: number) => void
    } = {}
  ): Promise<string> {
    const fontSize = options.fontSize || 48
    const fontColor = options.fontColor || 'white'
    const backgroundColor = options.backgroundColor || 'black@0.7'

    // Calculate Y position based on position option
    let yPosition: string
    switch (options.position) {
      case 'top':
        yPosition = 'h/8'
        break
      case 'center':
        yPosition = '(h-text_h)/2'
        break
      case 'bottom':
      default:
        yPosition = 'h-h/8'
        break
    }

    return new Promise((resolve, reject) => {
      const drawTextFilter = `drawtext=text='${captions.replace(/'/g, "\\'")}':fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${yPosition}:box=1:boxcolor=${backgroundColor}:boxborderw=10`

      ffmpeg(inputPath)
        .videoFilters(drawTextFilter)
        .videoCodec('libx264')
        .audioCodec('copy')
        .output(outputPath)
        .on('progress', (progress) => {
          options.onProgress?.(progress.percent || 0)
        })
        .on('end', () => resolve(outputPath))
        .on('error', (error) => reject(new Error(`Caption overlay failed: ${error.message}`)))
        .run()
    })
  }

  /**
   * Export clip with advanced settings (captions, logo, music, frame settings)
   */
  async exportReelClip(
    inputPath: string,
    startTime: number,
    duration: number,
    outputPath: string,
    options: {
      captionSegments?: Array<{
        text: string
        start: number
        end: number
        words?: Array<{ word: string; start: number; end: number }>
      }>
      captionOverlayAsset?: {
        videoPath: string
        cleanupPaths: string[]
      }
      captionOverlayFrames?: Array<{
        imagePath: string
        start: number
        end: number
      }>
      captionStyle?: {
        enabled: boolean
        font: string
        size: number
        color: string
        textColor?: string
        highlightColor?: string
        position: string
        customX?: number
        customY?: number
        weight: number // Font weight: 100-900 (Thin to Black)
        italic: boolean
        outline: boolean
        outlineColor: string
        outlineWidth: number
        shadow: boolean
        highlightStyle: string
        background: boolean
        backgroundColor: string
        backgroundOpacity: number
        backgroundPaddingX?: number
        backgroundPaddingY?: number
        backgroundRadius?: number
        textCase: string
        wordsPerCaption: number
        maxWidth: number
        lineHeight: number
        letterSpacing: number
        lineMode?: 'one-line' | 'three-lines'
        shadowColor?: string
        shadowOffsetX?: number
        shadowOffsetY?: number
        shadowBlur?: number
      }
      logoSettings?: {
        enabled: boolean
        logoPath: string | null
        positionX: number
        positionY: number
        scale: number
        opacity: number
      }
      musicSettings?: {
        enabled: boolean
        musicPath: string | null
        volume: number
        duckVolume: number
        duckEnabled: boolean
        fadeIn: number
        fadeOut: number
        loop: boolean
      }
      frameSettings?: {
        aspectRatio: '9:16' | '1:1' | '16:9'
        cropMode: 'center' | 'fit' | 'blur'
        cropPositionX: number
        cropPositionY: number
        zoomLevel?: number
        videoOffsetX?: number
        videoOffsetY?: number
        videoWidth?: number | null
        videoHeight?: number | null
      }
      onProgress?: (progress: number) => void
    } = {}
  ): Promise<string> {
    console.log('[FFmpegService] Starting export with options:', {
      captionSegments: options.captionSegments?.length,
      captionEnabled: options.captionStyle?.enabled,
      logoEnabled: options.logoSettings?.enabled,
      musicEnabled: options.musicSettings?.enabled,
      frameSettings: options.frameSettings
    })

    const frameSettings = options.frameSettings || {
      aspectRatio: '9:16',
      cropMode: 'center',
      cropPositionX: 50,
      cropPositionY: 50
    }

    // Define resolutions for different aspect ratios
    const resolutions = {
      '9:16': { width: 1080, height: 1920 },
      '1:1': { width: 1080, height: 1080 },
      '16:9': { width: 1920, height: 1080 }
    }

    const resolution = resolutions[frameSettings.aspectRatio]

    // Generate ASS subtitle file if captions are enabled and no DOM-rendered overlays were provided
    let assFilePath: string | undefined
    if (
      options.captionStyle?.enabled &&
      options.captionSegments &&
      options.captionSegments.length > 0 &&
      !options.captionOverlayAsset &&
      (!options.captionOverlayFrames || options.captionOverlayFrames.length === 0)
    ) {
      try {
        assFilePath = await this.generateASSSubtitles(
          options.captionSegments,
          options.captionStyle,
          resolution
        )
        console.log('[FFmpegService] Generated ASS subtitle file:', assFilePath)

        // Install font to user library so CoreText can find it
        // On macOS, libass uses CoreText which only looks at registered system fonts
        await this.installFontForUser(options.captionStyle.font, options.captionStyle.weight)
        console.log('[FFmpegService] Font installed to user library')
      } catch (error) {
        console.error('[FFmpegService] Failed to generate subtitles:', error)
      }
    }

    return new Promise((resolve, reject) => {
      let command = ffmpeg(inputPath)
        .seekInput(startTime)
        .duration(duration)
      const stderrLines: string[] = []

      this.activeExportCommand = command

      // Add music as input if enabled
      if (options.musicSettings?.enabled && options.musicSettings.musicPath) {
        command = command.input(options.musicSettings.musicPath)
      }

      // Add logo as input if enabled
      if (options.logoSettings?.enabled && options.logoSettings.logoPath) {
        command = command.input(options.logoSettings.logoPath)
      }

      if (options.captionOverlayAsset?.videoPath) {
        command = command.input(options.captionOverlayAsset.videoPath)
      } else if (options.captionOverlayFrames?.length) {
        for (const overlayFrame of options.captionOverlayFrames) {
          command = command.input(overlayFrame.imagePath)
          command.inputOptions(['-loop 1'])
        }
      }

      // Build complex filter chain
      const filters: string[] = []
      let videoLabel = '[0:v]'
      let audioLabel = '[0:a]'
      let currentVideoOutput = '[v0]'

      // Micro-fades on the source audio so word-snapped cuts don't sound like hard
      // stops — boundaries in continuous speech have no silence to cut in, and a
      // ~120ms fade-out reads as a deliberate edit instead of a chopped word.
      filters.push(
        `[0:a]afade=t=in:st=0:d=0.04,afade=t=out:st=${Math.max(0, duration - 0.12).toFixed(3)}:d=0.12[a_faded]`
      )
      audioLabel = '[a_faded]'

      // Step 1: Apply frame/crop settings
      if (frameSettings.cropMode === 'center') {
        // Center crop mode: crop to aspect ratio using custom position, then scale
        // We need to crop to match target aspect ratio and allow positioning in both X and Y
        const targetAspect = resolution.width / resolution.height

        // Use scale2ref to calculate crop dimensions that maintain target aspect ratio
        // Then use crop with custom positioning
        const cropX = frameSettings.cropPositionX / 100
        const cropY = frameSettings.cropPositionY / 100

        // Calculate crop dimensions: crop to target aspect ratio from center, but offset by position
        // crop=out_w:out_h:x:y where we calculate dimensions to match target aspect
        const cropFilter = `crop='min(iw,ih*${targetAspect})':'min(ih,iw/${targetAspect})':'(iw-min(iw,ih*${targetAspect}))*${cropX}':'(ih-min(ih,iw/${targetAspect}))*${cropY}'`
        const scaleFilter = `scale=${resolution.width}:${resolution.height}`

        console.log(`[FFmpegService] Center crop with position: X=${cropX}, Y=${cropY}`)
        filters.push(`${videoLabel}${cropFilter},${scaleFilter}${currentVideoOutput}`)
      } else if (frameSettings.cropMode === 'fit') {
        const zoom = frameSettings.zoomLevel ?? 1
        const sourceWidth = frameSettings.videoWidth || resolution.width
        const sourceHeight = frameSettings.videoHeight || resolution.height

        const baseScale = resolution.width / sourceWidth

        const scaledWidth = Math.round(sourceWidth * baseScale * zoom)
        const scaledHeight = Math.round(sourceHeight * baseScale * zoom)

        const offsetX = frameSettings.videoOffsetX ?? 0
        const offsetY = frameSettings.videoOffsetY ?? 0

        const centerX = resolution.width / 2
        const centerY = resolution.height / 2
        const posX = Math.round(centerX - scaledWidth / 2 + offsetX)
        const posY = Math.round(centerY - scaledHeight / 2 + offsetY)

        console.log('[FFmpegService] Canvas Fit export:', {
          zoom,
          baseScale,
          sourceWidth,
          sourceHeight,
          scaledWidth,
          scaledHeight,
          posX,
          posY,
          offsetX,
          offsetY
        })

        filters.push(`color=black:s=${resolution.width}x${resolution.height}[bg]`)
        filters.push(`${videoLabel}scale=${scaledWidth}:${scaledHeight}[scaled]`)
        filters.push(`[bg][scaled]overlay=${posX}:${posY}${currentVideoOutput}`)
      } else if (frameSettings.cropMode === 'blur') {
        // Blur background mode: blurred background with fitted video on top
        filters.push(`${videoLabel}split[blur][fg]`)
        filters.push(`[blur]scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=increase,crop=${resolution.width}:${resolution.height},boxblur=20:5[bg]`)
        filters.push(`[fg]scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease[fgscaled]`)
        filters.push(`[bg][fgscaled]overlay=(W-w)/2:(H-h)/2${currentVideoOutput}`)
      }

      videoLabel = currentVideoOutput
      currentVideoOutput = '[v1]'

      // Step 2: Add logo overlay if enabled
      if (options.logoSettings?.enabled && options.logoSettings.logoPath) {
        const logoInputIndex = options.musicSettings?.enabled ? 2 : 1
        const logoScale = options.logoSettings.scale
        const logoOpacity = options.logoSettings.opacity
        const logoX = `W*${options.logoSettings.positionX / 100}-w/2`
        const logoY = `H*${options.logoSettings.positionY / 100}-h/2`
        const targetLogoWidth = Math.max(48, Math.round(resolution.width * logoScale))

        // Scale logo and set opacity
        filters.push(`[${logoInputIndex}:v]scale=${targetLogoWidth}:-1,format=rgba,colorchannelmixer=aa=${logoOpacity}[logo]`)
        // Overlay logo on video
        filters.push(`${videoLabel}[logo]overlay=${logoX}:${logoY}${currentVideoOutput}`)

        videoLabel = currentVideoOutput
        currentVideoOutput = '[v2]'
      }

      // Step 3: Add caption overlays or subtitles
      if (options.captionOverlayAsset?.videoPath) {
        const overlayInputIndex =
          1 +
          (options.musicSettings?.enabled && options.musicSettings.musicPath ? 1 : 0) +
          (options.logoSettings?.enabled && options.logoSettings.logoPath ? 1 : 0)

        filters.push(`[${overlayInputIndex}:v]scale=${resolution.width}:${resolution.height}:flags=lanczos,format=rgba[caption_overlay]`)
        filters.push(`${videoLabel}[caption_overlay]overlay=0:0:eof_action=pass[vout]`)
        videoLabel = '[vout]'
      } else if (options.captionOverlayFrames?.length) {
        const overlayStartIndex =
          1 +
          (options.musicSettings?.enabled && options.musicSettings.musicPath ? 1 : 0) +
          (options.logoSettings?.enabled && options.logoSettings.logoPath ? 1 : 0)

        options.captionOverlayFrames.forEach((overlayFrame, overlayIndex) => {
          const inputIndex = overlayStartIndex + overlayIndex
          const overlayLabel = `[caption_overlay_${overlayIndex}]`
          const nextLabel = `[v_caption_${overlayIndex}]`
          filters.push(`[${inputIndex}:v]scale=${resolution.width}:${resolution.height}:flags=lanczos,format=rgba${overlayLabel}`)
          filters.push(
            `${videoLabel}${overlayLabel}overlay=0:0:enable='between(t,${overlayFrame.start.toFixed(3)},${overlayFrame.end.toFixed(3)})'${nextLabel}`
          )
          videoLabel = nextLabel
        })

        filters.push(`${videoLabel}null[vout]`)
        videoLabel = '[vout]'
      } else if (assFilePath) {
        // ASS subtitles with full styling support
        // Escape path for ffmpeg filter (escape backslashes, then colons, handle spaces)
        const escapedPath = assFilePath
          .replace(/\\/g, '\\\\')
          .replace(/:/g, '\\:')
          .replace(/'/g, "\\'")

        console.log('[FFmpegService] ASS file path:', assFilePath)
        console.log('[FFmpegService] Escaped path:', escapedPath)
        console.log('[FFmpegService] Note: Font file has been copied to subtitle directory')

        // libass automatically scans the subtitle directory for fonts
        // No need to specify fontsdir since we copied the font to the same location
        filters.push(`${videoLabel}ass='${escapedPath}'[vout]`)
        videoLabel = '[vout]'
      } else {
        // No subtitles, just rename the label to vout
        filters.push(`${videoLabel}null[vout]`)
        videoLabel = '[vout]'
      }

      // Step 4: Handle audio mixing if music is enabled
      if (options.musicSettings?.enabled && options.musicSettings.musicPath) {
        const musicVolume = options.musicSettings.volume
        const fadeIn = options.musicSettings.fadeIn
        const fadeOut = options.musicSettings.fadeOut
        const duckEnabled = options.musicSettings.duckEnabled
        const duckVolume = options.musicSettings.duckVolume
        const loop = options.musicSettings.loop

        // Apply looping, volume and fades to music
        let musicFilter = `[1:a]`

        // Add looping if enabled (loop infinitely until video duration is reached)
        if (loop) {
          musicFilter += `aloop=loop=-1:size=2e+09,`
          console.log('[FFmpegService] Music looping enabled')
        }

        musicFilter += `volume=${musicVolume}`
        if (fadeIn > 0) {
          musicFilter += `,afade=t=in:st=0:d=${fadeIn}`
        }
        if (fadeOut > 0) {
          musicFilter += `,afade=t=out:st=${duration - fadeOut}:d=${fadeOut}`
        }
        musicFilter += '[music]'
        filters.push(musicFilter)

        // Mix original audio with music
        if (duckEnabled) {
          // Apply ducking: reduce music volume during speech
          filters.push(`${audioLabel}[music]amix=inputs=2:duration=first:weights='1 ${duckVolume}':normalize=0[aout]`)
        } else {
          // Simple mix without ducking
          filters.push(`${audioLabel}[music]amix=inputs=2:duration=first:normalize=0[aout]`)
        }
      } else {
        // Just copy original audio
        filters.push(`${audioLabel}anull[aout]`)
      }

      console.log('[FFmpegService] Generated filter complex:', filters.join('; '))

      command = command
        .complexFilter(filters)
        .map('[vout]')
        .map('[aout]')
        .videoCodec('libx264')
        .videoBitrate('5000k')
        .audioCodec('aac')
        .audioBitrate('192k')
        .format('mp4')
        .output(outputPath)

      if (options.onProgress) {
        command.on('progress', (progress) => {
          options.onProgress!(progress.percent || 0)
        })
      }

      command
        .on('start', (commandLine) => {
          console.log('[FFmpegService] FFmpeg command:', commandLine)
        })
        .on('stderr', (stderrLine) => {
          stderrLines.push(stderrLine)
          if (stderrLines.length > 80) {
            stderrLines.shift()
          }
          // Log font-related warnings/errors
          if (stderrLine.toLowerCase().includes('font')) {
            console.log('[FFmpegService] Font-related output:', stderrLine)
          }
        })
        .on('end', () => {
          this.activeExportCommand = null
          // Clean up temporary ASS file
          if (assFilePath) {
            try {
              const fs = require('fs')
              fs.unlinkSync(assFilePath)
              console.log('[FFmpegService] Cleaned up ASS subtitle file')
            } catch (error) {
              console.error('[FFmpegService] Failed to clean up ASS file:', error)
            }
          }
          resolve(outputPath)
        })
        .on('error', (error) => {
          this.activeExportCommand = null
          // Clean up temporary ASS file on error
          if (assFilePath) {
            try {
              const fs = require('fs')
              fs.unlinkSync(assFilePath)
            } catch (cleanupError) {
              console.error('[FFmpegService] Failed to clean up ASS file:', cleanupError)
            }
          }
          const stderrSummary = stderrLines
            .filter((line: string) => line.trim())
            .slice(-20)
            .join('\n')
          reject(new Error(
            `Reel export failed: ${error.message}${stderrSummary ? `\n${stderrSummary}` : ''}`
          ))
        })
        .run()
    })
  }

  cancelActiveExport() {
    if (!this.activeExportCommand) {
      return false
    }

    try {
      this.activeExportCommand.kill('SIGKILL')
      this.activeExportCommand = null
      return true
    } catch (error) {
      console.error('[FFmpegService] Failed to cancel active export:', error)
      return false
    }
  }

  /**
   * Install font to user's font library temporarily
   * This is needed for CoreText (macOS) to find custom fonts
   */
  private async installFontForUser(fontFamily: string, weight: number): Promise<void> {
    const { copyFileSync } = require('fs')
    const os = require('os')

    // Get user's fonts directory
    const userFontsDir = join(os.homedir(), 'Library', 'Fonts', 'AriadneTemp')

    // Create directory if it doesn't exist
    if (!existsSync(userFontsDir)) {
      mkdirSync(userFontsDir, { recursive: true })
      console.log('[FFmpegService] Created temporary font directory:', userFontsDir)
    }

    // Get the font file name
    const fontFileName = this.mapWeightToFontFileName(fontFamily, weight)
    const sourcePath = join(this.fontsDir, `${fontFileName}.ttf`)
    const destPath = join(userFontsDir, `${fontFileName}.ttf`)

    // Copy font if not already there
    if (!existsSync(destPath)) {
      if (existsSync(sourcePath)) {
        copyFileSync(sourcePath, destPath)
        console.log('[FFmpegService] Installed font:', destPath)
      } else {
        console.warn('[FFmpegService] Font file not found:', sourcePath)
      }
    } else {
      console.log('[FFmpegService] Font already installed:', destPath)
    }
  }

  /**
   * Map font name to font family name (as it appears in the ASS file)
   * This is the actual font family name, not the filename
   */
  private getFontFamilyName(baseFont: string): string {
    // Most fonts use their base name as the family name
    // Anton font family name is just "Anton" (not "Anton-Regular")
    return baseFont
  }

  /**
   * Map font weight to font file name (for file operations)
   */
  private mapWeightToFontFileName(baseFont: string, weight: number): string {
    // For Inter font, map weight to file names
    if (baseFont === 'Inter') {
      if (weight <= 150) return 'Inter-Thin'
      if (weight <= 250) return 'Inter-ExtraLight'
      if (weight <= 350) return 'Inter-Light'
      if (weight <= 450) return 'Inter-Regular'
      if (weight <= 550) return 'Inter-Medium'
      if (weight <= 650) return 'Inter-SemiBold'
      if (weight <= 750) return 'Inter-Bold'
      if (weight <= 850) return 'Inter-ExtraBold'
      return 'Inter-Black'
    }
    // Anton file name is Anton-Regular.ttf
    if (baseFont === 'Anton') {
      return 'Anton-Regular'
    }
    // For other fonts, return base font name
    return baseFont
  }

  /**
   * Generate ASS subtitle file with full styling support
   */
  private async generateASSSubtitles(
    segments: Array<{
      text: string
      start: number
      end: number
      words?: Array<{ word: string; start: number; end: number }>
    }>,
    style: {
      font: string
      size: number
      color: string
      textColor?: string
      highlightColor?: string
      position: string
      customX?: number
      customY?: number
      weight: number // Font weight: 100-900
      italic: boolean
      outline: boolean
      outlineColor: string
      outlineWidth: number
      shadow: boolean
      background: boolean
      backgroundColor: string
      backgroundOpacity: number
      backgroundPaddingX?: number
      backgroundPaddingY?: number
      backgroundRadius?: number
      textCase: string
      highlightStyle: string
      wordsPerCaption: number
      maxWidth: number
      lineHeight: number
      letterSpacing: number
      lineMode?: 'one-line' | 'three-lines'
      shadowColor?: string
      shadowOffsetX?: number
      shadowOffsetY?: number
      shadowBlur?: number
    },
    resolution: { width: number; height: number }
  ): Promise<string> {
    const { writeFileSync } = require('fs')
    const assPath = join(this.tempDir, `subtitles_${Date.now()}.ass`)
    // Convert hex color to ASS format (BGR with alpha)
    const hexToASSColor = (hex: string, opacity: number = 1): string => {
      const cleanHex = hex.replace('#', '')
      const r = parseInt(cleanHex.substring(0, 2), 16)
      const g = parseInt(cleanHex.substring(2, 4), 16)
      const b = parseInt(cleanHex.substring(4, 6), 16)
      const alpha = Math.round((1 - opacity) * 255)
      return `&H${alpha.toString(16).padStart(2, '0').toUpperCase()}${b.toString(16).padStart(2, '0').toUpperCase()}${g.toString(16).padStart(2, '0').toUpperCase()}${r.toString(16).padStart(2, '0').toUpperCase()}`
    }

    // Calculate position (ASS uses margins and alignment)
    let alignment = 2 // Bottom center by default
    let marginV = Math.round(resolution.height * 0.08) // 8% from bottom

    if (style.position === 'top') {
      alignment = 8 // Top center
      marginV = Math.round(resolution.height * 0.08) // 8% from top
    } else if (style.position === 'center') {
      alignment = 5 // Middle center
      marginV = 0
    } else if (style.position === 'custom' && style.customX !== undefined && style.customY !== undefined) {
      alignment = 5 // Middle center (we'll use \pos tag in text)
      marginV = 0
    }

    const referencePreviewWidth =
      resolution.width === 1920 ? 640 : resolution.width === 1080 && resolution.height === 1080 ? 430 : 310
    const uiToOutputScale = resolution.width / referencePreviewWidth
    const scaledFontSize = Math.max(12, Math.round(style.size * uiToOutputScale))
    const scaledOutlineWidth = style.outline ? Math.max(0, Number(style.outlineWidth || 0) * uiToOutputScale) : 0
    const scaledSpacing = Number(style.letterSpacing || 0) * uiToOutputScale
    const scaledMarginV = alignment === 5 ? 0 : Math.round(marginV * uiToOutputScale)

    const primaryColor = hexToASSColor(style.textColor || style.color, 1)
    const secondaryColor = hexToASSColor(style.highlightColor || style.color, 1)
    const outlineColor = hexToASSColor(style.outlineColor, 1)
    const backgroundColor = style.background ? hexToASSColor(style.backgroundColor, style.backgroundOpacity) : '&H00000000'

    // Use the font family name (not the filename) for the ASS file
    // This is what libass will use to search for the font
    const fontFamilyName = this.getFontFamilyName(style.font)
    const useBoldFlag = (style.font !== 'Inter' && style.font !== 'Anton') && style.weight >= 700 ? '-1' : '0'

    // Build ASS header
    // Note: ScaleX and ScaleY should be 100 to maintain proper font proportions
    // ASS doesn't have direct line-height control like CSS - it's handled by the font itself
    // For word-by-word captions, line-height doesn't matter much anyway

    let assContent = `[Script Info]
Title: Generated Subtitles
ScriptType: v4.00+
WrapStyle: 0
PlayResX: ${resolution.width}
PlayResY: ${resolution.height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamilyName},${scaledFontSize},${primaryColor},&H000000FF,${outlineColor},${backgroundColor},${useBoldFlag},${style.italic ? '-1' : '0'},0,0,100,100,${scaledSpacing},0,${style.background ? '3' : '1'},${scaledOutlineWidth},${style.background ? '4' : (style.shadow ? '2' : '0')},${alignment},10,10,${scaledMarginV},1
Style: Active,${fontFamilyName},${scaledFontSize},${secondaryColor},&H000000FF,${outlineColor},${backgroundColor},${useBoldFlag},${style.italic ? '-1' : '0'},0,0,100,100,${scaledSpacing},0,${style.background ? '3' : '1'},${scaledOutlineWidth},${style.background ? '4' : (style.shadow ? '2' : '0')},${alignment},10,10,${scaledMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`

    console.log(`[FFmpegService] ASS Style Debug:`, {
      fontFamily: fontFamilyName,
      fontSize: style.size,
      scaledFontSize,
      weight: style.weight,
      background: style.background,
      backgroundColor: style.backgroundColor,
      backgroundOpacity: style.backgroundOpacity,
      computedBackColor: backgroundColor,
      borderStyle: style.background ? '3' : '1',
      primaryColor,
      secondaryColor,
      outlineColor
    })

    // Convert timestamp to ASS format (H:MM:SS.CC)
    const formatTime = (seconds: number): string => {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      const s = Math.floor(seconds % 60)
      const cs = Math.floor((seconds % 1) * 100)
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`
    }

    // Transform text based on textCase
    const transformText = (text: string): string => {
      if (style.textCase === 'uppercase') return text.toUpperCase()
      if (style.textCase === 'lowercase') return text.toLowerCase()
      return text
    }

    // Generate subtitle events based on highlightStyle setting
    console.log(`[FFmpegService] Generating captions with highlightStyle: ${style.highlightStyle}, wordsPerCaption: ${style.wordsPerCaption}`)

    for (const segment of segments) {
      const segmentDuration = segment.end - segment.start

      // Determine how to split the text based on highlightStyle
      if (style.highlightStyle === 'word' && Array.isArray(segment.words) && segment.words.length > 0) {
        const transformedWords = segment.words
          .filter((word) => word.word?.trim())
          .map((word) => ({
            ...word,
            word: transformText(word.word)
          }))

        let overrideTags = ''
        if (style.position === 'custom' && style.customX !== undefined && style.customY !== undefined) {
          const x = Math.round((style.customX / 100) * resolution.width)
          const y = Math.round((style.customY / 100) * resolution.height)
          overrideTags = `{\\pos(${x},${y})\\an5}`
        }

        transformedWords.forEach((activeWord, activeIndex) => {
          const styledText = transformedWords
            .map((word, wordIndex) => {
              const escapedWord = word.word.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
              return wordIndex === activeIndex
                ? `{\\rActive}${escapedWord}{\\rDefault}`
                : escapedWord
            })
            .join(' ')

          assContent += `Dialogue: 0,${formatTime(activeWord.start)},${formatTime(activeWord.end)},Default,,0,0,0,,${overrideTags}${styledText}\n`
        })
      } else {
        // Phrase/full sentence mode: show entire segment at once
        let text = transformText(segment.text)

        // Escape text content (before adding ASS control codes)
        text = text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')

        // Add line breaks for long text based on maxWidth
        const wordsPerLine = Math.max(1, Math.floor(style.maxWidth / 10)) // Rough estimate
        const words = text.split(' ')
        if (words.length > wordsPerLine) {
          const lines: string[] = []
          for (let i = 0; i < words.length; i += wordsPerLine) {
            lines.push(words.slice(i, i + wordsPerLine).join(' '))
          }
          text = lines.join('\\N') // \\N is line break in ASS
        }

        // Build ASS override tags (these should NOT be escaped)
        let overrideTags = ''
        if (style.position === 'custom' && style.customX !== undefined && style.customY !== undefined) {
          const x = Math.round((style.customX / 100) * resolution.width)
          const y = Math.round((style.customY / 100) * resolution.height)
          overrideTags = `{\\pos(${x},${y})\\an5}` // \an5 = center alignment for \pos
        }

        const startTime = formatTime(segment.start)
        const endTime = formatTime(segment.end)

        assContent += `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${overrideTags}${text}\n`
      }
    }

    writeFileSync(assPath, assContent, 'utf8')
    console.log('[FFmpegService] Generated ASS file:', assPath)
    console.log('[FFmpegService] ASS content preview (first 500 chars):', assContent.substring(0, 500))
    console.log('[FFmpegService] Total segments in ASS file:', segments.length)
    return assPath
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
