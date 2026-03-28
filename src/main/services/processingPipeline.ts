import { randomUUID } from 'crypto'
import { basename, join } from 'path'
import { BrowserWindow } from 'electron'
import { database } from '../database/database'
import { ffmpegService } from './ffmpegService'
import AIService from './aiService'
import clipCandidateService from './clipCandidateService'
import LocalWhisperService from './localWhisperService'
import { configService } from './configService'
import type {
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload
} from '@shared/types'
import type { AudioChunk } from './clipSelectionTypes'

export interface ProcessingResult {
  projectId: string
  episodeId: string
  clipsFound: number
  processingTime: number
}

class ProcessingPipeline {
  private aiService?: AIService
  private whisperService?: LocalWhisperService
  
  constructor() {
    this.initializeServices()
  }
  
  private initializeServices() {
    const config = configService.getApiConfig()
    
    if (config.openRouterKey) {
      this.aiService = new AIService(config)
    }
    
    // Local Whisper service doesn't need API keys
    try {
      this.whisperService = new LocalWhisperService()
      console.log('Local Whisper service initialized successfully')
    } catch (error) {
      console.error('Failed to initialize Local Whisper service:', error)
    }
  }

  private getFriendlyMediaError(filePath: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'

    if (filePath.includes('/ariadne/imports/')) {
      return 'Could not import a playable media file from that link.'
    }

    if (message.includes('Failed to probe media file')) {
      return 'Could not analyze that media file.'
    }

    return `Failed to analyze media file: ${message}`
  }

  private buildHeuristicAnalysis(transcriptData: { text: string; segments: Array<{ id: number; start: number; end: number; text: string }> }) {
    const candidates = clipCandidateService.generateCandidates(transcriptData.segments).slice(0, 8)

    return {
      potentialClips: candidates.map((candidate, index) => ({
        id: `heuristic_${index + 1}`,
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        duration: candidate.duration,
        contentType: 'insight' as const,
        shareabilityScore: Number(Math.max(1, Math.min(10, candidate.heuristicScore * 1.6)).toFixed(1)),
        keyQuote: candidate.text.slice(0, 180),
        reason: 'Generated from local heuristic ranking because AI ranking was unavailable.',
        contextNeeded: 'low' as const
      }))
    }
  }
  
  /**
   * Process a podcast file through the complete pipeline
   */
  async processEpisode(
    filePath: string,
    projectName?: string,
    window?: BrowserWindow,
    jobId?: string
  ): Promise<ProcessingResult> {
    console.log('Starting processEpisode with file:', filePath)
    const startTime = Date.now()
    let projectId: string
    let episodeId: string
    
    try {
      // Ensure services are initialized
      this.initializeServices()
      
      if (!this.whisperService) {
        throw new Error('Whisper service not available. Please install whisper with: pipx install openai-whisper')
      }
      
      // Step 1: Create project and episode records
      this.sendProgress(window, {
        jobId,
        stage: 'uploading',
        progress: 5,
        stageProgress: 5,
        message: 'Setting up project...'
      })
      
      projectId = await this.createProject(projectName || basename(filePath))
      episodeId = await this.createEpisode(projectId, filePath)
      
      // Step 2: Extract audio and get media info
      console.log('Starting media info extraction for:', filePath)
      this.sendProgress(window, {
        jobId,
        stage: 'extracting',
        progress: 10,
        stageProgress: 0,
        message: 'Analyzing media file...'
      })
      
      let mediaInfo
      try {
        mediaInfo = await ffmpegService.getMediaInfo(filePath)
        console.log('Media info retrieved:', mediaInfo)
      } catch (error) {
        console.error('Failed to get media info:', error)
        throw new Error(this.getFriendlyMediaError(filePath, error))
      }
      
      this.sendProgress(window, {
        jobId,
        stage: 'extracting',
        progress: 15,
        stageProgress: 33,
        message: 'Extracting audio for transcription...'
      })
      
      // Extract audio for Whisper (optimized format)
      console.log('Starting audio extraction...')
      let audioPath
      try {
        audioPath = await ffmpegService.extractAudio(
          filePath,
          undefined,
          (progress) => {
            this.sendProgress(window, {
              jobId,
              stage: 'extracting',
              progress: 15 + (progress * 0.15), // 15-30%
              stageProgress: progress,
              message: 'Extracting audio...'
            })
          }
        )
        console.log('Audio extraction completed. Audio file at:', audioPath)
      } catch (error) {
        console.error('Audio extraction failed:', error)
        throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      // Step 3: Transcribe audio (with chunking for large files)
      console.log('Starting transcription stage...')
      const transcriptionStartedAt = Date.now()
      this.sendProgress(window, {
        jobId,
        stage: 'transcribing',
        progress: 30,
        stageProgress: 0,
        message: 'Transcribing audio with Whisper...',
        timeRemaining: this.estimateTranscriptionTime(mediaInfo.duration),
        thinkingMessage: 'listening carefully...'
      })
      
      let transcription;
      const audioStats = await import('fs').then(fs => fs.promises.stat(audioPath));
      const maxSize = 20 * 1024 * 1024; // 20MB to be safe (Whisper limit is 25MB)
      console.log(`Audio file size: ${audioStats.size} bytes (${(audioStats.size / 1024 / 1024).toFixed(2)} MB)`)
      
      if (audioStats.size > maxSize) {
        // Split large audio file into chunks
        console.log('Large file detected, will split into chunks')
        this.sendProgress(window, {
          jobId,
          stage: 'transcribing',
          progress: 30,
          stageProgress: 0,
          message: 'Large file detected, splitting into chunks...',
          thinkingMessage: 'preparing audio segments...'
        });
        
        console.log('Starting audio file splitting...')
        const chunks = await this.splitAudioFile(audioPath, mediaInfo.duration);
        console.log(`Created ${chunks.length} chunks:`, chunks)
        
        transcription = await this.whisperService.transcribeInChunks(
          chunks,
          {
            model: 'base',
            wordTimestamps: true
          },
          (chunkIndex, chunkProgress, totalProgress, partialText) => {
            const timeRemaining = this.estimateRemainingFromProgress(
              transcriptionStartedAt,
              totalProgress / 100,
              mediaInfo.duration
            )
            this.sendProgress(window, {
              jobId,
              stage: 'transcribing',
              progress: 30 + (totalProgress * 0.35 / 100), // 30-65%
              stageProgress: totalProgress,
              message: `Transcribing chunk ${chunkIndex + 1}/${chunks.length}...`,
              timeRemaining,
              thinkingMessage: this.getThinkingMessage('chunked', chunkIndex),
              partialTranscript: partialText,
              recentTranscriptLines: partialText ? this.extractRecentLines(partialText) : undefined
            })
          }
        );
        
        // Clean up chunk files
        await this.cleanupChunks(chunks);
        
      } else {
        // Small file, process normally
        transcription = await this.whisperService.transcribe(
          audioPath,
          {
            model: 'base',
            wordTimestamps: true
          },
          (progress, partialText) => {
            const timeRemaining = this.estimateRemainingFromProgress(
              transcriptionStartedAt,
              progress / 100,
              mediaInfo.duration
            )
            this.sendProgress(window, {
              jobId,
              stage: 'transcribing',
              progress: 30 + (progress * 0.35), // 30-65%
              stageProgress: progress,
              message: 'Transcribing audio...',
              timeRemaining,
              thinkingMessage: this.getThinkingMessage('transcribing'),
              partialTranscript: partialText,
              recentTranscriptLines: partialText ? this.extractRecentLines(partialText) : undefined
            })
          }
        );
      }
      
      // Step 4: Store transcript in database
      await this.storeTranscript(episodeId, transcription)
      
      // Step 5: AI content analysis with graceful degradation
      this.sendProgress(window, {
        jobId,
        stage: 'analyzing',
        progress: 65,
        stageProgress: 0,
        message: this.aiService
          ? 'Analyzing content for clip suggestions...'
          : 'Transcription completed. Skipping AI clip analysis...'
      })
      
      let analysis: any = null
      let aiAnalysisSucceeded = false
      
      if (!this.aiService) {
        analysis = this.buildHeuristicAnalysis(transcription)
        this.sendProgress(window, {
          jobId,
          stage: 'analyzing',
          progress: 90,
          stageProgress: 100,
          message: 'AI unavailable. Using heuristic clip suggestions.'
        })
      } else {
        try {
          analysis = await this.aiService.analyzeTranscript(
            transcription, // Pass full transcription object with segments
            mediaInfo.duration,
            (progress) => {
              this.sendProgress(window, {
                jobId,
                stage: 'analyzing',
                progress: 65 + (progress * 0.25), // 65-90%
                stageProgress: progress,
                message: 'AI analyzing content...'
              })
            }
          )
          aiAnalysisSucceeded = true
          console.log('AI analysis completed successfully')
        } catch (aiError) {
          console.error('AI analysis failed, proceeding with transcript-only mode:', aiError)
          
          analysis = this.buildHeuristicAnalysis(transcription)
          aiAnalysisSucceeded = false
          
          this.sendProgress(window, {
            jobId,
            stage: 'analyzing',
            progress: 90,
            stageProgress: 100,
            message: 'AI analysis failed. Using heuristic clip suggestions.'
          })
        }
      }
      
      // Step 6: Store clips in database (even if empty)
      const storedClips = await this.storeClips(episodeId, analysis.potentialClips, mediaInfo.resolution)

      // Step 7: Generate content packages (only if we have clips)
      if (aiAnalysisSucceeded && storedClips.length > 0) {
        this.sendProgress(window, {
          jobId,
          stage: 'generating',
          progress: 90,
          stageProgress: 0,
          message: 'Generating titles and descriptions...'
        })

        try {
          await this.generateContentPackages(
            storedClips.slice(0, 10), // Top 10 clips with IDs
            (progress) => {
              this.sendProgress(window, {
                jobId,
                stage: 'generating',
                progress: 90 + (progress * 0.1), // 90-100%
                stageProgress: progress,
                message: 'Generating content packages...'
              })
            }
          )
        } catch (contentError) {
          console.error('Content generation failed, but clips are preserved:', contentError)
          // Continue processing - clips exist even without enhanced content packages
        }
      } else {
        console.log('Skipping content generation - no clips available')
        this.sendProgress(window, {
          jobId,
          stage: 'generating',
          progress: 95,
          stageProgress: 100,
          message: 'Transcript processing completed'
        })
      }
      
      // Step 8: Update episode status
      database.updateEpisodeStatus(episodeId, 'completed')
      
      // Step 9: Add to recent projects
      configService.addRecentProject({
        id: projectId,
        name: projectName || basename(filePath),
        path: filePath
      })
      
      this.sendProgress(window, {
        jobId,
        stage: 'completed',
        progress: 100,
        stageProgress: 100,
        message: `Found ${analysis.potentialClips.length} potential clips!`
      })
      
      const processingTime = (Date.now() - startTime) / 1000
      
      const result: ProcessingResultPayload = {
        jobId,
        projectId,
        episodeId,
        clipsFound: analysis.potentialClips.length,
        processingTime,
        aiAnalysisSucceeded,
        hasTranscript: true
      }
      
      // Send completion event with context about what succeeded/failed
      console.log('Sending processing complete event:', result)
      window?.webContents.send('processing-complete', result)
      
      // Update final progress message based on what was accomplished
      const finalMessage = aiAnalysisSucceeded 
        ? `Found ${analysis.potentialClips.length} potential clips!`
        : analysis.potentialClips.length > 0
          ? `Generated ${analysis.potentialClips.length} heuristic clip suggestions.`
          : `Transcription completed, but no clips were identified.`
        
      this.sendProgress(window, {
        jobId,
        stage: 'completed',
        progress: 100,
        stageProgress: 100,
        message: finalMessage
      })
      
      return result
      
    } catch (error) {
      console.error('Processing pipeline failed:', error)
      
      // Update episode status to error if we got that far
      if (episodeId!) {
        database.updateEpisodeStatus(episodeId, 'error')
      }
      
      const errorPayload: ProcessingErrorPayload = {
        jobId,
        message: error instanceof Error ? error.message : 'Unknown processing error'
      }

      window?.webContents.send('processing-error', errorPayload)
      
      throw error
    }
  }
  
  private async createProject(name: string): Promise<string> {
    const projectId = randomUUID()
    
    database.createProject({
      id: projectId,
      name: name
    })
    
    return projectId
  }
  
  private async createEpisode(projectId: string, filePath: string): Promise<string> {
    const episodeId = randomUUID()
    const fileName = basename(filePath)
    
    // Get media duration
    let duration = 0
    try {
      const mediaInfo = await ffmpegService.getMediaInfo(filePath)
      duration = mediaInfo.duration
    } catch (error) {
      console.warn('Could not get media duration:', error)
    }
    
    database.createEpisode({
      id: episodeId,
      projectId,
      fileName,
      filePath,
      duration
    })
    
    // Validate that episode was created successfully
    const createdEpisode = database.getEpisode(episodeId)
    if (!createdEpisode) {
      throw new Error('Failed to create episode record in database')
    }
    
    console.log('Episode created and validated:', { episodeId, fileName })
    return episodeId
  }
  
  private async storeTranscript(episodeId: string, transcription: any) {
    const segments = transcription.segments.map((segment: any) => ({
      id: randomUUID(),
      episodeId,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text,
      confidence: 1.0, // Whisper doesn't provide confidence scores
      speaker: undefined, // TODO: Add speaker detection
      words: segment.words // Store word-level timestamps if available
    }))

    database.insertTranscriptSegments(segments)
  }
  
  private async storeClips(
    episodeId: string,
    clips: any[],
    sourceResolution?: { width: number; height: number }
  ): Promise<any[]> {
    console.log(`Storing ${clips.length} clips for episode ${episodeId}`)

    const clipsWithIds = clips.map(clip => ({
      id: randomUUID(),
      episodeId,
      startTime: clip.startTime,
      endTime: clip.endTime,
      duration: clip.duration,
      contentType: clip.contentType,
      shareabilityScore: clip.shareabilityScore,
      keyQuote: clip.keyQuote,
      reason: clip.reason,
      contextNeeded: clip.contextNeeded,
      status: clip.shareabilityScore >= configService.getAutoApproveThreshold() ? 'approved' : 'pending',
      videoWidth: sourceResolution?.width ?? null,
      videoHeight: sourceResolution?.height ?? null
    }))

    database.insertClips(clipsWithIds)
    console.log(`Successfully stored ${clipsWithIds.length} clips in database`)

    return clipsWithIds
  }
  
  private async generateContentPackages(
    clips: any[],
    onProgress?: (progress: number) => void
  ) {
    if (!this.aiService) return

    const brandVoice = configService.getBrandVoice()

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i]

      try {
        const clipText = this.extractClipText(clip.id)

        const contentPackage = await this.aiService.generateContentPackage(
          clipText,
          clip.contentType,
          brandVoice.examples.length > 0 ? brandVoice.examples : undefined
        )

        console.log('Generated content package for clip:', clip.id, contentPackage)

        // Store titles in database
        if (contentPackage.titles && contentPackage.titles.length > 0) {
          database.insertClipTitles(clip.id, contentPackage.titles)
          console.log(`Stored ${contentPackage.titles.length} titles for clip ${clip.id}`)
        }

        // Store description in database
        if (contentPackage.description) {
          database.insertClipDescription(clip.id, contentPackage.description, 'general')
          console.log(`Stored description for clip ${clip.id}`)
        }

        onProgress?.(((i + 1) / clips.length) * 100)

      } catch (error) {
        console.error(`Failed to generate content package for clip ${clip.id}:`, error)
        // Continue with other clips
      }
    }
  }
  
  private extractClipText(clipId: string): string {
    const segments = database.getClipTranscriptSegments(clipId) as Array<{ text: string }>
    return segments.map(segment => segment.text).join(' ').trim()
  }
  
  private sendProgress(window: BrowserWindow | undefined, progress: ProcessingProgress) {
    console.log('Sending progress update:', progress)
    window?.webContents.send('processing-update', progress)
  }
  
  private estimateTranscriptionTime(durationInSeconds: number): number {
    // Rough estimate: Whisper processes about 10x faster than real-time
    return Math.ceil(durationInSeconds / 10)
  }

  private estimateRemainingFromProgress(
    startedAt: number,
    progressFraction: number,
    mediaDurationInSeconds: number
  ): number {
    const clampedFraction = Math.max(0.01, Math.min(progressFraction, 0.99))
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))

    if (progressFraction <= 0.02) {
      return this.estimateTranscriptionTime(mediaDurationInSeconds)
    }

    const estimatedTotalSeconds = elapsedSeconds / clampedFraction
    return Math.max(1, Math.ceil(estimatedTotalSeconds - elapsedSeconds))
  }

  private getThinkingMessage(stage: string, chunkIndex?: number): string {
    const messages = {
      transcribing: [
        'listening carefully...',
        'processing audio waves...',
        'understanding speech patterns...',
        'decoding audio signals...',
        'capturing every word...',
        'analyzing vocal patterns...',
        'interpreting language nuances...'
      ],
      chunked: [
        'processing segment...',
        'analyzing audio chunk...',
        'transcribing section...',
        'decoding audio data...',
        'understanding context...'
      ]
    }
    
    const messageArray = stage === 'chunked' ? messages.chunked : messages.transcribing
    const index = chunkIndex !== undefined ? chunkIndex % messageArray.length : Math.floor(Math.random() * messageArray.length)
    return messageArray[index]
  }

  /**
   * Extract the most recent 2-3 lines from transcript for display
   */
  private extractRecentLines(fullText: string): string[] {
    // Split into sentences and take the last 2-3
    const sentences = fullText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0)
    
    // Return last 2-3 sentences, but limit total length
    const recentSentences = sentences.slice(-3)
    const lines: string[] = []
    
    for (const sentence of recentSentences) {
      // Wrap long sentences
      if (sentence.length > 80) {
        const words = sentence.split(' ')
        let currentLine = ''
        
        for (const word of words) {
          if ((currentLine + ' ' + word).length > 80) {
            if (currentLine) lines.push(currentLine)
            currentLine = word
          } else {
            currentLine = currentLine ? currentLine + ' ' + word : word
          }
        }
        if (currentLine) lines.push(currentLine)
      } else {
        lines.push(sentence)
      }
    }
    
    return lines.slice(-2) // Return max 2 lines for clean display
  }

  /**
   * Split large audio file into chunks for Whisper processing
   */
  private async splitAudioFile(audioPath: string, durationInSeconds: number): Promise<AudioChunk[]> {
    const chunkDurationMinutes = 10; // 10-minute chunks
    const chunkDurationSeconds = chunkDurationMinutes * 60;
    const numChunks = Math.ceil(durationInSeconds / chunkDurationSeconds);
    const chunks: AudioChunk[] = [];

    const tempDir = join(require('os').tmpdir(), 'ariadne-chunks-' + Date.now());
    await import('fs').then(fs => fs.promises.mkdir(tempDir, { recursive: true }));

    for (let i = 0; i < numChunks; i++) {
      const startTime = i * chunkDurationSeconds;
      const chunkPath = join(tempDir, `chunk_${i}.wav`);
      const chunkDuration = Math.min(chunkDurationSeconds, durationInSeconds - startTime)
      
      // Extract audio chunk using FFmpeg directly
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = require('fluent-ffmpeg');
        ffmpeg(audioPath)
          .seekInput(startTime)
          .duration(chunkDuration)
          .audioCodec('pcm_s16le')
          .audioChannels(1)
          .audioFrequency(16000)
          .format('wav')
          .output(chunkPath)
          .on('end', () => resolve())
          .on('error', (error: Error) => reject(error))
          .run();
      });
      
      chunks.push({
        path: chunkPath,
        startTime,
        duration: chunkDuration
      });
    }

    return chunks;
  }

  /**
   * Clean up temporary chunk files
   */
  private async cleanupChunks(chunks: AudioChunk[]): Promise<void> {
    const fs = await import('fs');
    
    for (const chunk of chunks) {
      const chunkPath = chunk.path
      try {
        await fs.promises.unlink(chunkPath);
      } catch (error) {
        console.warn('Failed to cleanup chunk file:', chunkPath, error);
      }
    }

    // Try to cleanup the temp directory
    if (chunks.length > 0) {
      const tempDir = require('path').dirname(chunks[0].path);
      try {
        await fs.promises.rmdir(tempDir);
      } catch (error) {
        console.warn('Failed to cleanup temp directory:', tempDir, error);
      }
    }
  }
  
  /**
   * Get processing status for an episode
   */
  getProcessingStatus(episodeId: string): { status: string; progress?: number } {
    const episode = database.getEpisode(episodeId) as any
    if (!episode) {
      throw new Error('Episode not found')
    }
    
    return {
      status: episode.processing_status
    }
  }
  
  /**
   * Cancel processing (if possible)
   */
  cancelProcessing(episodeId: string): void {
    // TODO: Implement cancellation logic
    database.updateEpisodeStatus(episodeId, 'error')
  }
  
  /**
   * Retry failed processing
   */
  async retryProcessing(
    episodeId: string,
    window?: BrowserWindow
  ): Promise<ProcessingResult> {
    const episode = database.getEpisode(episodeId) as any
    if (!episode) {
      throw new Error('Episode not found')
    }
    
    // Reset status
    database.updateEpisodeStatus(episodeId, 'pending')
    
    // Get project name
    const project = database.getProject(episode.project_id) as any
    const projectName = project?.name || 'Retry Project'
    
    return this.processEpisode(episode.file_path, projectName, window)
  }
}

export const processingPipeline = new ProcessingPipeline()
export default processingPipeline
