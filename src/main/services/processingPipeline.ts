import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import { BrowserWindow } from 'electron'
import { database } from '../database/database'
import { ffmpegService } from './ffmpegService'
import { configService } from './configService'
import { pipelineWorkerSupervisor } from './pipelineWorkerSupervisor'
import type {
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload
} from '@shared/types'
import type {
  PipelineWorkerCandidate,
  PipelineWorkerCompletedEvent,
  PipelineWorkerContentPackage,
  PipelineWorkerPotentialClip
} from '@shared/types/pipelineWorker'
import type {
  GetActivePipelineJobResponseDTO,
  PipelineJobViewDTO
} from '@shared/types/pipelineIpc'

export interface ProcessingResult {
  projectId: string
  episodeId: string
  clipsFound: number
  processingTime: number
}

type PipelineStepKey =
  | 'source_resolve_or_import'
  | 'media_probe'
  | 'audio_extract'
  | 'transcription'
  | 'clip_generation'
  | 'clip_ranking'
  | 'content_package_generation'

const PIPELINE_STEP_ORDER: PipelineStepKey[] = [
  'source_resolve_or_import',
  'media_probe',
  'audio_extract',
  'transcription',
  'clip_generation',
  'clip_ranking',
  'content_package_generation'
]

class ProcessingPipeline {
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

  private mapWorkflowStageToUiStage(stage: string | null): ProcessingProgress['stage'] {
    switch (stage) {
      case 'queued':
      case 'source_resolve_or_import':
      case 'uploading':
        return 'uploading'
      case 'media_probe':
      case 'audio_extract':
      case 'extracting':
        return 'extracting'
      case 'transcription':
      case 'transcribing':
        return 'transcribing'
      case 'clip_generation':
      case 'clip_ranking':
      case 'analyzing':
        return 'analyzing'
      case 'content_package_generation':
      case 'generating':
        return 'generating'
      case 'completed':
        return 'completed'
      default:
        return 'uploading'
    }
  }

  getActiveJob(episodeId?: string, projectId?: string): GetActivePipelineJobResponseDTO {
    const workflowJob = database.getActivePipelineWorkflowJob(episodeId, projectId) as {
      id: string
      projectId: string | null
      episodeId: string | null
      status: PipelineJobViewDTO['status']
      stage: string | null
      progress: number
      message: string | null
      inputJson: string
      createdAt: string
      startedAt: string | null
      updatedAt: string
    } | undefined

    if (!workflowJob) {
      return null
    }

    let filePath: string | null = null
    let projectName: string | null = null

    try {
      const parsedInput = JSON.parse(workflowJob.inputJson) as { filePath?: string; projectName?: string }
      filePath = parsedInput.filePath ?? null
      projectName = parsedInput.projectName ?? null
    } catch {
      filePath = null
      projectName = null
    }

    return {
      jobId: workflowJob.id,
      projectId: workflowJob.projectId,
      episodeId: workflowJob.episodeId,
      status: workflowJob.status,
      stage: this.mapWorkflowStageToUiStage(workflowJob.stage),
      progress: workflowJob.progress,
      message: workflowJob.message ?? 'Processing...',
      filePath,
      projectName,
      createdAt: workflowJob.createdAt,
      startedAt: workflowJob.startedAt,
      updatedAt: workflowJob.updatedAt
    }
  }

  async recoverPipelines(window?: BrowserWindow) {
    const recoverableJobs = database.listRecoverablePipelineWorkflowJobs() as Array<{
      id: string
      status: PipelineJobViewDTO['status']
    }>

    for (const job of recoverableJobs) {
      if (pipelineWorkerSupervisor.hasLiveWorker(job.id)) {
        continue
      }

      if (job.status === 'running') {
        database.updateWorkflowJob(job.id, {
          status: 'pending_resume',
          updatedAt: new Date().toISOString()
        })
      }

      if (job.status === 'cancel_requested') {
        continue
      }

      try {
        await this.resumePipelineJob(job.id, window)
      } catch (error) {
        console.error(`Pipeline recovery failed for job ${job.id}:`, error)
      }
    }
  }

  hasLiveWorker() {
    return pipelineWorkerSupervisor.hasAnyLiveWorker()
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
    const workflowJobId = jobId || randomUUID()
    console.log('Starting processEpisode with file:', filePath)
    const startTime = Date.now()
    let projectId: string | undefined
    let episodeId: string | undefined
    let currentStep: PipelineStepKey | null = null
    
    try {
      this.initializeWorkflowJob(workflowJobId, filePath, projectName)
      this.createPipelineStepRuns(workflowJobId)
      
      // Step 1: Create project and episode records
      currentStep = 'source_resolve_or_import'
      this.startPipelineStep(workflowJobId, currentStep, 'Creating project and episode records...')
      this.sendProgress(window, {
        jobId: workflowJobId,
        stage: 'uploading',
        progress: 5,
        stageProgress: 5,
        message: 'Setting up project...'
      })
      
      projectId = await this.createProject(projectName || basename(filePath))
      episodeId = await this.createEpisode(projectId, filePath)
      this.updateWorkflowJobContext(workflowJobId, projectId, episodeId)
      this.createPipelineArtifact(workflowJobId, projectId, episodeId, null, filePath, 'source_media', {
        imported: filePath.includes(`${join(require('os').homedir(), '')}`) ? false : undefined,
        originalFileName: basename(filePath)
      })
      this.completePipelineStep(workflowJobId, currentStep, {
        filePath,
        projectId,
        episodeId
      })
      
      // Step 2: Extract audio and get media info
      console.log('Starting media info extraction for:', filePath)
      currentStep = 'media_probe'
      this.startPipelineStep(workflowJobId, currentStep, 'Analyzing media file...')
      this.sendProgress(window, {
        jobId: workflowJobId,
        stage: 'extracting',
        progress: 10,
        stageProgress: 0,
        message: 'Analyzing media file...'
      })
      
      let mediaInfo
      try {
        mediaInfo = await ffmpegService.getMediaInfo(filePath)
        console.log('Media info retrieved:', mediaInfo)
        this.completePipelineStep(workflowJobId, currentStep, {
          duration: mediaInfo.duration,
          hasVideo: mediaInfo.hasVideo,
          hasAudio: mediaInfo.hasAudio,
          resolution: mediaInfo.resolution ?? null,
          frameRate: mediaInfo.frameRate ?? null
        })
      } catch (error) {
        console.error('Failed to get media info:', error)
        throw new Error(this.getFriendlyMediaError(filePath, error))
      }
      
      currentStep = 'audio_extract'
      this.startPipelineStep(workflowJobId, currentStep, 'Extracting audio for transcription...')
      this.sendProgress(window, {
        jobId: workflowJobId,
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
            this.updatePipelineStepProgress(workflowJobId, currentStep!, progress, 'Extracting audio...')
            this.sendProgress(window, {
              jobId: workflowJobId,
              stage: 'extracting',
              progress: 15 + (progress * 0.15), // 15-30%
              stageProgress: progress,
              message: 'Extracting audio...'
            })
          }
        )
        console.log('Audio extraction completed. Audio file at:', audioPath)
        this.createPipelineArtifact(workflowJobId, projectId, episodeId, null, audioPath, 'extracted_audio', {
          sourceFilePath: filePath
        })
        this.completePipelineStep(workflowJobId, currentStep, {
          audioPath
        })
      } catch (error) {
        console.error('Audio extraction failed:', error)
        throw new Error(`Failed to extract audio: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
      
      currentStep = null
      const workerResult = await this.runHeavyPipelineStages(
        workflowJobId,
        audioPath,
        mediaInfo.duration,
        'transcription',
        {},
        window
      )

      return await this.finalizePipelineResult(
        workflowJobId,
        projectId,
        episodeId,
        filePath,
        projectName || basename(filePath),
        mediaInfo.resolution,
        workerResult,
        startTime,
        window
      )
      
    } catch (error) {
      console.error('Processing pipeline failed:', error)
      const workflowJob = database.getWorkflowJob(workflowJobId) as { status?: string } | undefined
      const alreadyFailed = workflowJob?.status === 'failed'
      
      // Update episode status to error if we got that far
      if (episodeId!) {
        database.updateEpisodeStatus(episodeId, 'error')
      }
      if (currentStep && !alreadyFailed) {
        this.failPipelineStep(
          workflowJobId,
          currentStep,
          error instanceof Error ? error.message : 'Unknown processing error',
          'pipeline_step_failed'
        )
      }
      if (!alreadyFailed) {
        this.failWorkflowJob(
          workflowJobId,
          projectId,
          episodeId,
          error instanceof Error ? error.message : 'Unknown processing error'
        )

        const errorPayload: ProcessingErrorPayload = {
          jobId: workflowJobId,
          message: error instanceof Error ? error.message : 'Unknown processing error'
        }

        window?.webContents.send('processing-error', errorPayload)
      }
      
      throw error
    }
  }

  private async runHeavyPipelineStages(
    workflowJobId: string,
    audioPath: string,
    mediaDuration: number,
    startStage: 'transcription' | 'clip_generation' | 'clip_ranking' | 'content_package_generation',
    resumeData: {
      transcription?: PipelineWorkerCompletedEvent['transcription']
      candidates?: PipelineWorkerCandidate[]
      analysis?: PipelineWorkerCompletedEvent['analysis']
      aiAnalysisSucceeded?: boolean
      contentPackages?: PipelineWorkerContentPackage[]
    },
    window?: BrowserWindow
  ) {
    const apiConfig = configService.getApiConfig()
    return pipelineWorkerSupervisor.runPipeline(
      {
        type: 'start_pipeline',
        workflowJobId,
        audioPath,
        mediaDuration,
        apiConfig: apiConfig.openRouterKey ? apiConfig : null,
        brandVoiceExamples: configService.getBrandVoice().examples,
        startStage,
        resumeData
      },
      { window }
    )
  }

  private async finalizePipelineResult(
    workflowJobId: string,
    projectId: string,
    episodeId: string,
    filePath: string,
    projectName: string,
    sourceResolution: { width: number; height: number } | undefined,
    workerResult: PipelineWorkerCompletedEvent,
    startedAt: number,
    window?: BrowserWindow
  ) {
    await this.storeTranscript(episodeId, workerResult.transcription)
    const storedClips = await this.storeClips(
      episodeId,
      workerResult.analysis.potentialClips,
      sourceResolution
    )
    await this.storeGeneratedContentPackages(storedClips, workerResult.contentPackages)

    database.updateEpisodeStatus(episodeId, 'completed')
    this.completeWorkflowJob(workflowJobId, projectId, episodeId, workerResult.analysis.potentialClips.length)

    configService.addRecentProject({
      id: projectId,
      name: projectName,
      path: filePath
    })

    this.sendProgress(window, {
      jobId: workflowJobId,
      stage: 'completed',
      progress: 100,
      stageProgress: 100,
      message: `Found ${workerResult.analysis.potentialClips.length} potential clips!`
    })

    const processingTime = (Date.now() - startedAt) / 1000
    const result: ProcessingResultPayload = {
      jobId: workflowJobId,
      projectId,
      episodeId,
      clipsFound: workerResult.analysis.potentialClips.length,
      processingTime,
      aiAnalysisSucceeded: workerResult.aiAnalysisSucceeded,
      hasTranscript: true
    }

    window?.webContents.send('processing-complete', result)

    const finalMessage = workerResult.aiAnalysisSucceeded
      ? `Found ${workerResult.analysis.potentialClips.length} potential clips!`
      : workerResult.analysis.potentialClips.length > 0
        ? `Generated ${workerResult.analysis.potentialClips.length} heuristic clip suggestions.`
        : 'Transcription completed, but no clips were identified.'

    this.sendProgress(window, {
      jobId: workflowJobId,
      stage: 'completed',
      progress: 100,
      stageProgress: 100,
      message: finalMessage
    })

    return result
  }

  private parseStepOutput<T>(workflowJobId: string, stepKey: PipelineStepKey): T | null {
    const step = database.getWorkflowStepRunsByJob(workflowJobId)
      .find((candidate: any) => candidate.stepKey === stepKey) as { outputJson?: string | null } | undefined

    if (!step?.outputJson) {
      return null
    }

    try {
      return JSON.parse(step.outputJson) as T
    } catch {
      return null
    }
  }

  private getPipelineArtifactPath(
    workflowJobId: string,
    artifactType: string,
    stepKey: PipelineStepKey,
    expectedPath?: string
  ): string | null {
    const artifacts = database.getArtifactsByWorkflowJob(workflowJobId, artifactType) as Array<{
      id: string
      filePath: string
    }>

    for (const artifact of artifacts) {
      const validation = database.validateArtifact(artifact as any, expectedPath)
      if (validation.isValid) {
        return artifact.filePath
      }

      const now = new Date().toISOString()
      database.invalidateArtifact(artifact.id, now)
      database.createFailureEvent({
        id: randomUUID(),
        jobId: workflowJobId,
        stepRunId: `${workflowJobId}-${stepKey}`,
        scope: `pipeline_resume_validation.${artifactType}`,
        errorCode: validation.errorCode || 'artifact_invalid',
        message: validation.message || 'Pipeline artifact is invalid during resume',
        detailJson: JSON.stringify({
          artifactId: artifact.id,
          artifactType,
          filePath: artifact.filePath,
          expectedPath: expectedPath ?? null
        }),
        createdAt: now
      })
    }

    return null
  }

  private isCompletedStep(workflowJobId: string, stepKey: PipelineStepKey) {
    const step = database.getWorkflowStepRunsByJob(workflowJobId)
      .find((candidate: any) => candidate.stepKey === stepKey) as { status?: string } | undefined
    return step?.status === 'completed'
  }

  private async resumePipelineJob(workflowJobId: string, window?: BrowserWindow) {
    const workflowJob = database.getWorkflowJob(workflowJobId) as {
      id: string
      projectId: string | null
      episodeId: string | null
      inputJson: string
      status: string
      createdAt: string
    } | undefined

    if (!workflowJob?.projectId || !workflowJob.episodeId) {
      return
    }

    let parsedInput: { filePath?: string; projectName?: string } = {}
    try {
      parsedInput = JSON.parse(workflowJob.inputJson)
    } catch {
      parsedInput = {}
    }

    const filePath = parsedInput.filePath
    const sourceMediaPath = filePath
      ? this.getPipelineArtifactPath(workflowJobId, 'source_media', 'source_resolve_or_import', filePath) || filePath
      : null

    if (!sourceMediaPath || !existsSync(sourceMediaPath)) {
      return
    }

    try {
      if (statSync(sourceMediaPath).size <= 0) {
        return
      }
    } catch {
      return
    }

    const audioPath = this.getPipelineArtifactPath(workflowJobId, 'extracted_audio', 'audio_extract')
    if (!audioPath) {
      return
    }

    const mediaProbeOutput = this.parseStepOutput<{
      duration?: number
      resolution?: { width: number; height: number } | null
    }>(workflowJobId, 'media_probe')

    if (!mediaProbeOutput?.duration) {
      return
    }

    const transcriptionOutput = this.parseStepOutput<{ transcription?: PipelineWorkerCompletedEvent['transcription'] }>(
      workflowJobId,
      'transcription'
    )
    const clipGenerationOutput = this.parseStepOutput<{ candidates?: PipelineWorkerCandidate[] }>(
      workflowJobId,
      'clip_generation'
    )
    const clipRankingOutput = this.parseStepOutput<{
      analysis?: PipelineWorkerCompletedEvent['analysis']
      aiAnalysisSucceeded?: boolean
    }>(workflowJobId, 'clip_ranking')
    const contentPackagesOutput = this.parseStepOutput<{
      contentPackages?: PipelineWorkerContentPackage[]
      skipped?: boolean
    }>(
      workflowJobId,
      'content_package_generation'
    )

    const hasTranscription = this.isCompletedStep(workflowJobId, 'transcription') && !!transcriptionOutput?.transcription
    const hasCandidates = this.isCompletedStep(workflowJobId, 'clip_generation') && Array.isArray(clipGenerationOutput?.candidates)
    const hasAnalysis = this.isCompletedStep(workflowJobId, 'clip_ranking') && !!clipRankingOutput?.analysis
    const hasContentPackages = this.isCompletedStep(workflowJobId, 'content_package_generation')
      && (Array.isArray(contentPackagesOutput?.contentPackages) || contentPackagesOutput?.skipped === true)

    const now = new Date().toISOString()
    database.updateWorkflowJob(workflowJobId, {
      status: 'running',
      stage: hasTranscription ? (hasCandidates ? (hasAnalysis ? 'generating' : 'analyzing') : 'analyzing') : 'transcribing',
      message: 'Resuming processing...',
      updatedAt: now
    })

    if (hasTranscription && hasCandidates && hasAnalysis && hasContentPackages) {
      await this.finalizePipelineResult(
        workflowJobId,
        workflowJob.projectId,
        workflowJob.episodeId,
        sourceMediaPath,
        parsedInput.projectName || basename(sourceMediaPath),
        mediaProbeOutput.resolution ?? undefined,
        {
          type: 'pipeline_completed',
          workflowJobId,
          transcription: transcriptionOutput!.transcription!,
          analysis: clipRankingOutput!.analysis!,
          aiAnalysisSucceeded: clipRankingOutput?.aiAnalysisSucceeded ?? false,
          contentPackages: contentPackagesOutput?.contentPackages ?? []
        },
        Date.parse(workflowJob.createdAt) || Date.now(),
        window
      )
      return
    }

    const workerResult = await this.runHeavyPipelineStages(
      workflowJobId,
      audioPath,
      mediaProbeOutput.duration,
      !hasTranscription
        ? 'transcription'
        : !hasCandidates
          ? 'clip_generation'
          : !hasAnalysis
            ? 'clip_ranking'
            : 'content_package_generation',
      {
        transcription: transcriptionOutput?.transcription,
        candidates: clipGenerationOutput?.candidates,
        analysis: clipRankingOutput?.analysis,
        aiAnalysisSucceeded: clipRankingOutput?.aiAnalysisSucceeded,
        contentPackages: contentPackagesOutput?.contentPackages
      },
      window
    )

    await this.finalizePipelineResult(
      workflowJobId,
      workflowJob.projectId,
      workflowJob.episodeId,
      sourceMediaPath,
      parsedInput.projectName || basename(sourceMediaPath),
      mediaProbeOutput.resolution ?? undefined,
      workerResult,
      Date.parse(workflowJob.createdAt) || Date.now(),
      window
    )
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
  
  private async storeTranscript(
    episodeId: string,
    transcription: PipelineWorkerCompletedEvent['transcription']
  ) {
    const existingSegments = database.getTranscriptSegments(episodeId) as Array<unknown>
    if (existingSegments.length > 0) {
      return
    }

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
    clips: PipelineWorkerPotentialClip[],
    sourceResolution?: { width: number; height: number }
  ): Promise<Array<{ id: string } & PipelineWorkerPotentialClip>> {
    const existingClips = database.getClips(episodeId) as Array<any>
    if (existingClips.length > 0) {
      return existingClips.map((clip) => ({
        id: clip.id,
        startTime: Number(clip.start_time ?? clip.startTime) || 0,
        endTime: Number(clip.end_time ?? clip.endTime) || 0,
        duration: Number(clip.duration) || 0,
        contentType: clip.content_type ?? clip.contentType,
        shareabilityScore: Number(clip.shareability_score ?? clip.shareabilityScore) || 0,
        keyQuote: clip.key_quote ?? clip.keyQuote ?? '',
        reason: clip.reason ?? '',
        contextNeeded: clip.context_needed ?? clip.contextNeeded ?? 'low'
      }))
    }

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
  
  private async storeGeneratedContentPackages(
    clips: Array<{ id: string } & PipelineWorkerPotentialClip>,
    contentPackages: PipelineWorkerContentPackage[]
  ) {
    for (const contentPackage of contentPackages) {
      const clip = clips[contentPackage.clipIndex]
      if (!clip) {
        continue
      }

      if (contentPackage.titles.length > 0) {
        database.insertClipTitles(clip.id, contentPackage.titles)
      }

      if (contentPackage.description) {
        database.insertClipDescription(clip.id, contentPackage.description, 'general')
      }
    }
  }
  
  private sendProgress(window: BrowserWindow | undefined, progress: ProcessingProgress) {
    console.log('Sending progress update:', progress)
    if (progress.jobId) {
      database.updateWorkflowJob(progress.jobId, {
        progress: Math.round(progress.progress),
        stage: progress.stage,
        message: progress.message,
        updatedAt: new Date().toISOString()
      })
    }
    window?.webContents.send('processing-update', progress)
  }

  private initializeWorkflowJob(workflowJobId: string, filePath: string, projectName?: string) {
    const now = new Date().toISOString()
    database.createWorkflowJob({
      id: workflowJobId,
      jobType: 'pipeline',
      status: 'pending',
      workerKind: 'pipeline_worker',
      projectId: null,
      episodeId: null,
      clipId: null,
      parentJobId: null,
      progress: 0,
      stage: 'queued',
      message: 'Queued for processing',
      inputJson: JSON.stringify({
        filePath,
        projectName: projectName || basename(filePath)
      }),
      configSnapshotJson: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      attemptCount: 0,
      maxAttempts: 1,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now
    })
  }

  private createPipelineStepRuns(workflowJobId: string) {
    const now = new Date().toISOString()
    PIPELINE_STEP_ORDER.forEach((stepKey, index) => {
      database.createWorkflowStepRun({
        id: `${workflowJobId}-${stepKey}`,
        jobId: workflowJobId,
        stepKey,
        status: 'pending',
        stepOrder: index,
        clipId: null,
        attempt: 1,
        progress: 0,
        message: null,
        inputJson: null,
        outputJson: null,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        createdAt: now,
        updatedAt: now
      })
    })
  }

  private updateWorkflowJobContext(workflowJobId: string, projectId?: string, episodeId?: string) {
    database.updateWorkflowJob(workflowJobId, {
      projectId: projectId ?? null,
      episodeId: episodeId ?? null,
      updatedAt: new Date().toISOString()
    })
  }

  private startPipelineStep(workflowJobId: string, stepKey: PipelineStepKey, message: string) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${workflowJobId}-${stepKey}`, {
      status: 'running',
      progress: 0,
      message,
      startedAt: now,
      updatedAt: now
    })
    database.updateWorkflowJob(workflowJobId, {
      status: 'running',
      stage: stepKey,
      message,
      updatedAt: now
    })
  }

  private updatePipelineStepProgress(workflowJobId: string, stepKey: PipelineStepKey, progress: number, message: string) {
    database.updateWorkflowStepRun(`${workflowJobId}-${stepKey}`, {
      status: 'running',
      progress: Math.round(progress),
      message,
      updatedAt: new Date().toISOString()
    })
  }

  private completePipelineStep(workflowJobId: string, stepKey: PipelineStepKey, output: Record<string, unknown>) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${workflowJobId}-${stepKey}`, {
      status: 'completed',
      progress: 100,
      outputJson: JSON.stringify(output),
      completedAt: now,
      updatedAt: now
    })
  }

  private failPipelineStep(workflowJobId: string, stepKey: PipelineStepKey, message: string, errorCode: string) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${workflowJobId}-${stepKey}`, {
      status: 'failed',
      errorCode,
      errorMessage: message,
      completedAt: now,
      updatedAt: now
    })
    database.createFailureEvent({
      id: randomUUID(),
      jobId: workflowJobId,
      stepRunId: `${workflowJobId}-${stepKey}`,
      scope: `pipeline_main.${stepKey}`,
      errorCode,
      message,
      detailJson: JSON.stringify({
        stage: stepKey
      }),
      createdAt: now
    })
  }

  private completeWorkflowJob(workflowJobId: string, projectId: string, episodeId: string, clipsFound: number) {
    const now = new Date().toISOString()
    database.updateWorkflowJob(workflowJobId, {
      status: 'completed',
      projectId,
      episodeId,
      progress: 100,
      stage: 'completed',
      message: `Processing complete with ${clipsFound} clips`,
      completedAt: now,
      updatedAt: now
    })
  }

  private failWorkflowJob(workflowJobId: string, projectId: string | undefined, episodeId: string | undefined, message: string) {
    const now = new Date().toISOString()
    database.updateWorkflowJob(workflowJobId, {
      status: 'failed',
      projectId: projectId ?? null,
      episodeId: episodeId ?? null,
      stage: 'failed',
      message,
      completedAt: now,
      updatedAt: now
    })
  }

  private createPipelineArtifact(
    workflowJobId: string,
    projectId: string,
    episodeId: string,
    clipId: string | null,
    filePath: string,
    artifactType: string,
    metadata: Record<string, unknown>
  ) {
    database.createArtifact({
      id: randomUUID(),
      artifactType,
      status: 'complete',
      projectId,
      episodeId,
      clipId,
      workflowJobId,
      filePath,
      tempFilePath: null,
      mimeType: null,
      sizeBytes: null,
      checksum: null,
      metadataJson: JSON.stringify(metadata),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    })
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
