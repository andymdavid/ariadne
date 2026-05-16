import { createHash, randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { basename, join } from 'path'
import { BrowserWindow } from 'electron'
import { database } from '../database/database'
import { configService } from './configService'
import { mediaWorkerSupervisor } from './mediaWorkerSupervisor'
import { pipelineWorkerSupervisor } from './pipelineWorkerSupervisor'
import { workflowReadModel } from './workflowReadModel'
import { canonicalTimelineService } from './canonicalTimelineService'
import { clipProjectionService } from './clipProjectionService'
import type {
  ProcessingErrorPayload,
  ProcessingProgress,
  ProcessingResultPayload
} from '@shared/types'
import type {
  PipelineWorkerCandidate,
  PipelineWorkerCompletedEvent,
  PipelineRunConfigSnapshot,
  PipelineWorkerContentPackage,
  PipelineWorkerPotentialClip
} from '@shared/types/pipelineWorker'
import type { CandidateArc, EditorialUnit } from '../../shared/editorialUnits'
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

const LEGACY_SELECTION_RUN_VERSION = 'legacy_pipeline_v1'
const LEGACY_SELECTION_SOURCE = 'legacy_pipeline'
const ARC_SELECTION_RUN_VERSION = 'candidate_arc_ranker_v1'
const ARC_SELECTION_SOURCE = 'candidate_arc_ranker'
const LLM_THREAD_SELECTION_RUN_VERSION = 'llm_thread_selector_v1'
const LLM_THREAD_SELECTION_SOURCE = 'llm_thread_selector'
const DEFAULT_LOCAL_WHISPER_MODEL = 'turbo'

class ProcessingPipeline {
  private readonly mediaTranscriptFingerprintVersion = 'media_transcript_cache_v2'

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

  getActiveJob(episodeId?: string, projectId?: string): GetActivePipelineJobResponseDTO {
    return workflowReadModel.getActivePipelineJob(episodeId, projectId)
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
        this.recordEvent(job.id, null, 'pipeline_recovery', 'job_normalized', 'Normalized stale pipeline job to pending_resume', {
          previousStatus: 'running',
          nextStatus: 'pending_resume'
        })
        database.updateWorkflowJob(job.id, {
          status: 'pending_resume',
          updatedAt: new Date().toISOString()
        })
      }

      if (job.status === 'cancel_requested') {
        continue
      }

      try {
        this.recordEvent(job.id, null, 'pipeline_recovery', 'resume_started', 'Attempting pipeline resume', {})
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
    let selectionRunId: string | undefined
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
      const runConfigSnapshot = this.buildPipelineRunConfigSnapshot()
      selectionRunId = this.startPipelineSelectionRun(workflowJobId, episodeId, runConfigSnapshot)
      this.createPipelineArtifact(workflowJobId, projectId, episodeId, null, filePath, 'source_media', {
        imported: filePath.includes(`${join(require('os').homedir(), '')}`) ? false : undefined,
        originalFileName: basename(filePath)
      })
      this.completePipelineStep(workflowJobId, currentStep, {
        filePath,
        projectId,
        episodeId,
        selectionRunId
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
        mediaInfo = await mediaWorkerSupervisor.probeMedia(filePath, {
          workflowJobId,
          stepRunId: `${workflowJobId}-${currentStep}`,
          scope: 'pipeline_media_probe'
        })
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

      const transcriptCacheKey = this.buildMediaTranscriptFingerprint(filePath, mediaInfo)
      const cachedTranscript = database.getMediaTranscriptCacheByFingerprint(
        transcriptCacheKey.mediaFingerprint
      ) as { transcription?: PipelineWorkerCompletedEvent['transcription'] } | null

      let workerResult: PipelineWorkerCompletedEvent

      if (cachedTranscript?.transcription) {
        this.recordEvent(
          workflowJobId,
          `${workflowJobId}-transcription`,
          'pipeline_transcript_cache',
          'cache_hit',
          'Reusing cached transcript for media fingerprint',
          { mediaFingerprint: transcriptCacheKey.mediaFingerprint }
        )

        currentStep = 'audio_extract'
        this.startPipelineStep(workflowJobId, currentStep, 'Reusing cached transcript...')
        this.completePipelineStep(workflowJobId, currentStep, {
          skipped: true,
          reusedTranscriptCache: true,
          mediaFingerprint: transcriptCacheKey.mediaFingerprint
        })

        currentStep = 'transcription'
        this.startPipelineStep(workflowJobId, currentStep, 'Reusing cached transcript...')
        this.completePipelineStep(workflowJobId, currentStep, {
          transcription: cachedTranscript.transcription,
          reusedTranscriptCache: true,
          mediaFingerprint: transcriptCacheKey.mediaFingerprint
        })

        this.sendProgress(window, {
          jobId: workflowJobId,
          stage: 'transcribing',
          progress: 30,
          stageProgress: 100,
          message: 'Reusing cached transcript...'
        })

        currentStep = null
        workerResult = await this.runHeavyPipelineStages(
          workflowJobId,
          filePath,
          mediaInfo.duration,
          'clip_generation',
          { transcription: cachedTranscript.transcription },
          window
        )
      } else {
        currentStep = 'audio_extract'
        this.startPipelineStep(workflowJobId, currentStep, 'Extracting audio for transcription...')
        this.sendProgress(window, {
          jobId: workflowJobId,
          stage: 'extracting',
          progress: 15,
          stageProgress: 33,
          message: 'Extracting audio for transcription...'
        })

        console.log('Starting audio extraction...')
        let audioPath
        try {
          audioPath = await mediaWorkerSupervisor.extractAudio(
            filePath,
            undefined,
            (progress) => {
              this.updatePipelineStepProgress(workflowJobId, currentStep!, progress, 'Extracting audio...')
              this.sendProgress(window, {
                jobId: workflowJobId,
                stage: 'extracting',
                progress: 15 + (progress * 0.15),
                stageProgress: progress,
                message: 'Extracting audio...'
              })
            },
            {
              workflowJobId,
              stepRunId: `${workflowJobId}-${currentStep}`,
              scope: 'pipeline_audio_extract'
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
        workerResult = await this.runHeavyPipelineStages(
          workflowJobId,
          audioPath,
          mediaInfo.duration,
          'transcription',
          {},
          window
        )

        this.cacheTranscriptForMediaFingerprint(transcriptCacheKey, filePath, workerResult.transcription, mediaInfo)
      }

      return await this.finalizePipelineResult(
        workflowJobId,
        projectId,
        episodeId,
        selectionRunId,
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
      if (selectionRunId) {
        this.failPipelineSelectionRun(
          workflowJobId,
          selectionRunId,
          episodeId,
          currentStep,
          error instanceof Error ? error.message : 'Unknown processing error'
        )
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
      editorialUnits?: NonNullable<PipelineWorkerCompletedEvent['editorialUnits']>
      candidateArcs?: NonNullable<PipelineWorkerCompletedEvent['candidateArcs']>
      selectionDecisions?: NonNullable<PipelineWorkerCompletedEvent['selectionDecisions']>
      analysis?: PipelineWorkerCompletedEvent['analysis']
      aiAnalysisSucceeded?: boolean
      contentPackages?: PipelineWorkerContentPackage[]
    },
    window?: BrowserWindow
  ) {
    const apiConfig = configService.getApiConfig()
    const workflowJob = database.getWorkflowJob(workflowJobId)
    let runConfigSnapshot = this.buildPipelineRunConfigSnapshot()

    if (workflowJob?.configSnapshotJson) {
      try {
        runConfigSnapshot = JSON.parse(workflowJob.configSnapshotJson) as PipelineRunConfigSnapshot
      } catch {
        runConfigSnapshot = this.buildPipelineRunConfigSnapshot()
      }
    }

    this.updateHeavyStageInputs(workflowJobId, audioPath, mediaDuration, startStage, runConfigSnapshot)
    this.recordEvent(workflowJobId, `${workflowJobId}-${startStage}`, 'pipeline_worker_dispatch', 'worker_dispatched', `Dispatching pipeline worker from ${startStage}`, {
      startStage
    })
    return pipelineWorkerSupervisor.runPipeline(
      {
        type: 'start_pipeline',
        workflowJobId,
        audioPath,
        mediaDuration,
        apiConfig: apiConfig.openRouterKey ? apiConfig : null,
        brandVoiceExamples: configService.getBrandVoice().examples,
        runConfigSnapshot,
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
    selectionRunId: string,
    filePath: string,
    projectName: string,
    sourceResolution: { width: number; height: number } | undefined,
    workerResult: PipelineWorkerCompletedEvent,
    startedAt: number,
    window?: BrowserWindow
  ) {
    const namespacedWorkerResult = this.namespaceSelectionArtifacts(selectionRunId, workerResult)
    await this.storeTranscript(episodeId, workerResult.transcription)
    this.storeSelectionArtifacts(selectionRunId, episodeId, namespacedWorkerResult)
    const storedClips = await this.storeClips(
      episodeId,
      namespacedWorkerResult,
      sourceResolution,
      workflowJobId,
      selectionRunId
    )
    await this.storeGeneratedContentPackages(storedClips, namespacedWorkerResult.contentPackages)
    this.completePipelineSelectionRun(workflowJobId, selectionRunId, episodeId, namespacedWorkerResult)

    database.updateEpisodeStatus(episodeId, 'completed')
    this.completeWorkflowJob(workflowJobId, projectId, episodeId, namespacedWorkerResult.analysis.potentialClips.length)

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
      message: `Found ${namespacedWorkerResult.analysis.potentialClips.length} potential clips!`
    })

    const processingTime = (Date.now() - startedAt) / 1000
    const result: ProcessingResultPayload = {
      jobId: workflowJobId,
      projectId,
      episodeId,
      clipsFound: namespacedWorkerResult.analysis.potentialClips.length,
      processingTime,
      aiAnalysisSucceeded: namespacedWorkerResult.aiAnalysisSucceeded,
      hasTranscript: true
    }

    window?.webContents.send('processing-complete', result)

    const finalMessage = namespacedWorkerResult.aiAnalysisSucceeded
      ? `Found ${namespacedWorkerResult.analysis.potentialClips.length} potential clips!`
      : namespacedWorkerResult.analysis.potentialClips.length > 0
        ? `Generated ${namespacedWorkerResult.analysis.potentialClips.length} heuristic clip suggestions.`
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

  private namespaceSelectionArtifacts(
    selectionRunId: string,
    workerResult: PipelineWorkerCompletedEvent
  ): PipelineWorkerCompletedEvent {
    const prefix = `${selectionRunId}:`
    const namespaceId = (id: string | null | undefined) => {
      if (!id) {
        return id
      }
      return id.startsWith(prefix) ? id : `${prefix}${id}`
    }

    const unitIdByOriginal = new Map<string, string>()
    const arcIdByOriginal = new Map<string, string>()

    const editorialUnits = workerResult.editorialUnits?.map((unit) => {
      const id = namespaceId(unit.id) ?? unit.id
      unitIdByOriginal.set(unit.id, id)
      return { ...unit, id }
    })

    const candidateArcs = workerResult.candidateArcs?.map((arc) => {
      const id = namespaceId(arc.id) ?? arc.id
      arcIdByOriginal.set(arc.id, id)
      return {
        ...arc,
        id,
        unitIds: arc.unitIds.map((unitId) => unitIdByOriginal.get(unitId) ?? namespaceId(unitId) ?? unitId)
      }
    })

    const selectionDecisions = workerResult.selectionDecisions?.map((decision) => ({
      ...decision,
      candidateArcId: decision.candidateArcId
        ? arcIdByOriginal.get(decision.candidateArcId) ?? namespaceId(decision.candidateArcId)
        : decision.candidateArcId
    }))

    const potentialClips = workerResult.analysis.potentialClips.map((clip) => ({
      ...clip,
      sourceArcId: clip.sourceArcId
        ? arcIdByOriginal.get(clip.sourceArcId) ?? namespaceId(clip.sourceArcId)
        : clip.sourceArcId
    }))

    return {
      ...workerResult,
      editorialUnits,
      candidateArcs,
      selectionDecisions,
      analysis: {
        ...workerResult.analysis,
        potentialClips
      }
    }
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

    const mediaProbeOutput = this.parseStepOutput<{
      duration?: number
      resolution?: { width: number; height: number } | null
    }>(workflowJobId, 'media_probe')

    if (!mediaProbeOutput?.duration) {
      return
    }

    const selectionRun = database.getPipelineSelectionRunByWorkflowJob(workflowJobId)
    if (!selectionRun) {
      return
    }
    const selectionRunId = selectionRun.id

    const transcriptionOutput = this.parseStepOutput<{ transcription?: PipelineWorkerCompletedEvent['transcription'] }>(
      workflowJobId,
      'transcription'
    )
    const clipGenerationOutput = this.parseStepOutput<{
      candidates?: PipelineWorkerCandidate[]
      editorialUnits?: EditorialUnit[]
      candidateArcs?: CandidateArc[]
    }>(
      workflowJobId,
      'clip_generation'
    )
    const clipRankingOutput = this.parseStepOutput<{
      analysis?: PipelineWorkerCompletedEvent['analysis']
      aiAnalysisSucceeded?: boolean
      selectionDecisions?: NonNullable<PipelineWorkerCompletedEvent['selectionDecisions']>
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
    const audioPath = this.getPipelineArtifactPath(workflowJobId, 'extracted_audio', 'audio_extract')
    const dispatchAudioPath = audioPath || sourceMediaPath

    if ((!dispatchAudioPath || !existsSync(dispatchAudioPath)) || (!audioPath && !hasTranscription)) {
      return
    }

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
        selectionRunId,
        sourceMediaPath,
        parsedInput.projectName || basename(sourceMediaPath),
        mediaProbeOutput.resolution ?? undefined,
        {
          type: 'pipeline_completed',
          workflowJobId,
          transcription: transcriptionOutput!.transcription!,
          editorialUnits: clipGenerationOutput?.editorialUnits,
          candidateArcs: clipGenerationOutput?.candidateArcs,
          selectionDecisions: clipRankingOutput?.selectionDecisions,
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
      dispatchAudioPath,
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
        editorialUnits: clipGenerationOutput?.editorialUnits,
        candidateArcs: clipGenerationOutput?.candidateArcs,
        selectionDecisions: clipRankingOutput?.selectionDecisions,
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
      selectionRunId,
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
      const mediaInfo = await mediaWorkerSupervisor.probeMedia(filePath)
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
    const existingLines = database.getTranscriptLines(episodeId) as Array<unknown>
    if (existingSegments.length > 0 && existingLines.length > 0) {
      return
    }

    const canonicalTimeline = canonicalTimelineService.buildFromTranscription(transcription)

    if (existingSegments.length === 0) {
      database.insertTranscriptSegments(
        canonicalTimelineService.toTranscriptSegmentRows(episodeId, canonicalTimeline)
      )
    }

    if (existingLines.length === 0) {
      const lines = canonicalTimelineService.toTranscriptLineRows(episodeId, canonicalTimeline)

      if (lines.length > 0) {
        database.insertTranscriptLines(lines)
      }
    }
  }

  private buildMediaTranscriptFingerprint(
    filePath: string,
    mediaInfo: {
      duration: number
      frameRate?: number | null
      resolution?: { width: number; height: number } | null
    }
  ) {
    const stats = statSync(filePath)
    const mediaFingerprint = createHash('sha256')
      .update(this.mediaTranscriptFingerprintVersion)
      .update('|')
      .update(String(stats.size))
      .update('|')
      .update(String(Math.round(stats.mtimeMs)))
      .update('|')
      .update(String(Math.round((mediaInfo.duration || 0) * 1000)))
      .update('|')
      .update(String(Math.round((mediaInfo.frameRate || 0) * 1000)))
      .update('|')
      .update(String(mediaInfo.resolution?.width || 0))
      .update('x')
      .update(String(mediaInfo.resolution?.height || 0))
      .update('|')
      .update(this.buildPipelineRunConfigSnapshot().localWhisperModel)
      .digest('hex')

    return {
      mediaFingerprint,
      fingerprintVersion: this.mediaTranscriptFingerprintVersion,
      fileSize: stats.size,
      fileMtimeMs: stats.mtimeMs
    }
  }

  private cacheTranscriptForMediaFingerprint(
    fingerprint: {
      mediaFingerprint: string
      fingerprintVersion: string
      fileSize: number
      fileMtimeMs: number
    },
    filePath: string,
    transcription: PipelineWorkerCompletedEvent['transcription'],
    mediaInfo: {
      duration: number
      frameRate?: number | null
      resolution?: { width: number; height: number } | null
    }
  ) {
    const canonicalTimeline = canonicalTimelineService.buildFromTranscription(transcription)

    database.upsertMediaTranscriptCache({
      mediaFingerprint: fingerprint.mediaFingerprint,
      fingerprintVersion: fingerprint.fingerprintVersion,
      fileName: basename(filePath),
      filePath,
      fileSize: fingerprint.fileSize,
      fileMtimeMs: fingerprint.fileMtimeMs,
      duration: mediaInfo.duration,
      frameRate: mediaInfo.frameRate ?? null,
      resolutionWidth: mediaInfo.resolution?.width ?? null,
      resolutionHeight: mediaInfo.resolution?.height ?? null,
      language: transcription.language ?? null,
      transcription,
      transcriptLines: canonicalTimeline.lines,
      transcriptionModel: this.buildPipelineRunConfigSnapshot().localWhisperModel,
      sourceStrategy: 'local_whisper_service_v1'
    })
  }
  
  private async storeClips(
    episodeId: string,
    workerResult: Pick<PipelineWorkerCompletedEvent, 'analysis' | 'candidateArcs' | 'selectionDecisions'>,
    sourceResolution?: { width: number; height: number },
    workflowJobId?: string,
    selectionRunId?: string
  ): Promise<Array<{ id: string } & PipelineWorkerPotentialClip>> {
    const clips = workerResult.analysis.potentialClips
    console.log(`Storing ${clips.length} clips for episode ${episodeId}`)

    const clipsWithIds = clipProjectionService.projectClips({
      episodeId,
      workflowJobId,
      selectionRunId,
      sourceResolution,
      finalClips: clips,
      candidateArcs: workerResult.candidateArcs,
      selectionDecisions: workerResult.selectionDecisions
    })

    database.replaceActiveClipSetForEpisode(episodeId, clipsWithIds)
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

      if (contentPackage.metadataAnalysis) {
        database.upsertClipMetadataAnalysis(clip.id, contentPackage.metadataAnalysis)
      }

      if (contentPackage.titles.length > 0) {
        database.insertClipTitles(clip.id, contentPackage.titles)
      }

      if (contentPackage.description) {
        database.insertClipDescription(clip.id, contentPackage.description, 'general')
      }
    }
  }

  private storeSelectionArtifacts(
    selectionRunId: string,
    episodeId: string,
    workerResult: Pick<PipelineWorkerCompletedEvent, 'editorialUnits' | 'candidateArcs' | 'selectionDecisions'>
  ) {
    if (Array.isArray(workerResult.editorialUnits)) {
      database.replaceEditorialUnitsForSelectionRun(
        selectionRunId,
        workerResult.editorialUnits.map((unit) => ({
          id: unit.id,
          selectionRunId,
          episodeId,
          startWordIndex: unit.startWordIndex,
          endWordIndex: unit.endWordIndex,
          startTime: unit.startTime,
          endTime: unit.endTime,
          text: unit.text,
          role: unit.role,
          startsCleanly: unit.startsCleanly,
          endsCleanly: unit.endsCleanly,
          continuesPrevious: unit.continuesPrevious,
          continuesNext: unit.continuesNext,
          pauseBeforeSeconds: unit.pauseBeforeSeconds,
          pauseAfterSeconds: unit.pauseAfterSeconds,
          speechRate: unit.speechRate,
          confidence: unit.confidence,
          source: unit.source,
          diagnosticsJson: JSON.stringify(unit.diagnostics ?? {})
        }))
      )
    }

    if (Array.isArray(workerResult.candidateArcs)) {
      database.replaceCandidateArcsForSelectionRun(
        selectionRunId,
        workerResult.candidateArcs.map((arc) => ({
          id: arc.id,
          selectionRunId,
          episodeId,
          startWordIndex: arc.startWordIndex,
          endWordIndex: arc.endWordIndex,
          startTime: arc.startTime,
          endTime: arc.endTime,
          duration: arc.duration,
          unitIdsJson: JSON.stringify(arc.unitIds ?? []),
          topic: arc.topic,
          summary: arc.summary,
          hookText: arc.hookText,
          payoffText: arc.payoffText,
          keyQuote: arc.keyQuote,
          scoresJson: JSON.stringify(arc.scores ?? {}),
          diagnosticsJson: JSON.stringify(arc.diagnostics ?? {})
        }))
      )
    }

    if (Array.isArray(workerResult.selectionDecisions)) {
      database.replaceSelectionDecisionsForSelectionRun(
        selectionRunId,
        workerResult.selectionDecisions.map((decision) => ({
          id: decision.id,
          selectionRunId,
          candidateArcId: decision.candidateArcId ?? null,
          decision: decision.decision,
          rankOrder: decision.rankOrder ?? null,
          modelScore: decision.modelScore ?? null,
          finalScore: decision.finalScore ?? null,
          rejectionCode: decision.rejectionCode ?? null,
          reason: decision.reason ?? null,
          validatorResultJson: decision.validatorResultJson ?? '{}'
        }))
      )
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
    const configSnapshot = this.buildPipelineRunConfigSnapshot()
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
      configSnapshotJson: JSON.stringify(configSnapshot),
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
    this.recordEvent(workflowJobId, null, 'pipeline_job', 'job_created', 'Pipeline job created', {
      filePath,
      projectName: projectName || basename(filePath),
      configSnapshot
    }, now)
  }

  private buildPipelineRunConfigSnapshot(): PipelineRunConfigSnapshot {
    const apiConfig = configService.getApiConfig()
    const userPreferences = configService.getUserPreferences()
    const brandVoice = configService.getBrandVoice()
    const productionSelectorMode = this.normalizeProductionSelectorMode(userPreferences.productionSelectorMode)

    return {
      apiModelAlias: apiConfig.openRouterKey ? apiConfig.model : null,
      apiModelId: apiConfig.openRouterKey ? this.getResolvedModelId(apiConfig.model) : null,
      clipSelectionPlatform: apiConfig.clipSelectionPlatform,
      openRouterConfigured: Boolean(apiConfig.openRouterKey),
      productionSelectorMode,
      enableLegacyResolvedClipProposal: Boolean(userPreferences.enableLegacyResolvedClipProposal),
      enableLegacyTranscriptLineAgent: Boolean(userPreferences.enableLegacyTranscriptLineAgent),
      enableLegacyBoundaryProposal: Boolean(userPreferences.enableLegacyBoundaryProposal),
      enableLegacyCandidateRanking: Boolean(userPreferences.enableLegacyCandidateRanking),
      enableHeuristicSupplementation: Boolean(userPreferences.enableHeuristicSupplementation),
      maxClipsPerEpisode: Number.isFinite(userPreferences.maxClipsPerEpisode) ? userPreferences.maxClipsPerEpisode : 25,
      brandVoiceExampleCount: brandVoice.examples.length,
      brandVoicePreferences: brandVoice.preferences,
      localWhisperModel: DEFAULT_LOCAL_WHISPER_MODEL,
      candidateGeneratorVersion: 'clip_candidate_service_v6',
      rankingPromptVersion: 'candidate_ranking_v1',
      rankingImplementationVersion: 'ai_service_v4',
      contentPromptVersion: 'content_package_v1'
    }
  }

  private getResolvedModelId(model: NonNullable<PipelineRunConfigSnapshot['apiModelAlias']>) {
    switch (model) {
      case 'google-gemini-2.5-flash':
        return 'google/gemini-2.5-flash'
      case 'google-gemini-2.5-pro':
        return 'google/gemini-2.5-pro'
      case 'anthropic-claude-sonnet-4.6':
        return 'anthropic/claude-sonnet-4.5'
      case 'openai-gpt-5.4':
        return 'openai/gpt-5'
      case 'deepseek-r1':
        return 'deepseek/deepseek-r1'
      case 'google-gemini-2.5-flash-lite':
        return 'google/gemini-2.5-flash-lite'
      default:
        return model
    }
  }

  private updateHeavyStageInputs(
    workflowJobId: string,
    audioPath: string,
    mediaDuration: number,
    startStage: 'transcription' | 'clip_generation' | 'clip_ranking' | 'content_package_generation',
    runConfigSnapshot: PipelineRunConfigSnapshot
  ) {
    const now = new Date().toISOString()
    const stageInputs: Array<{
      stepKey: 'transcription' | 'clip_generation' | 'clip_ranking' | 'content_package_generation'
      input: Record<string, unknown>
    }> = [
      {
        stepKey: 'transcription',
        input: {
          executor: 'pipeline_worker',
          implementationVersion: 'local_whisper_service_v1',
          model: runConfigSnapshot.localWhisperModel,
          wordTimestamps: true,
          audioPath,
          mediaDuration,
          resumed: startStage !== 'transcription'
        }
      },
      {
        stepKey: 'clip_generation',
        input: {
          executor: 'pipeline_worker',
          implementationVersion: runConfigSnapshot.candidateGeneratorVersion,
          clipSelectionPlatform: runConfigSnapshot.clipSelectionPlatform
        }
      },
      {
        stepKey: 'clip_ranking',
        input: {
          executor: 'pipeline_worker',
          implementationVersion: runConfigSnapshot.rankingImplementationVersion,
          promptVersion: runConfigSnapshot.rankingPromptVersion,
          modelAlias: runConfigSnapshot.apiModelAlias,
          modelId: runConfigSnapshot.apiModelId,
          clipSelectionPlatform: runConfigSnapshot.clipSelectionPlatform
        }
      },
      {
        stepKey: 'content_package_generation',
        input: {
          executor: 'pipeline_worker',
          implementationVersion: 'ai_service_v1',
          promptVersion: runConfigSnapshot.contentPromptVersion,
          modelAlias: runConfigSnapshot.apiModelAlias,
          modelId: runConfigSnapshot.apiModelId,
          brandVoiceExampleCount: runConfigSnapshot.brandVoiceExampleCount
        }
      }
    ]

    for (const stageInput of stageInputs) {
      database.updateWorkflowStepRun(`${workflowJobId}-${stageInput.stepKey}`, {
        inputJson: JSON.stringify(stageInput.input),
        updatedAt: now
      })
    }
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
    this.recordEvent(workflowJobId, `${workflowJobId}-${stepKey}`, 'pipeline_step', 'stage_started', message, {
      stage: stepKey
    }, now)
  }

  private updatePipelineStepProgress(workflowJobId: string, stepKey: PipelineStepKey, progress: number, message: string) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${workflowJobId}-${stepKey}`, {
      status: 'running',
      progress: Math.round(progress),
      message,
      updatedAt: now
    })
    this.recordEvent(workflowJobId, `${workflowJobId}-${stepKey}`, 'pipeline_step', 'stage_progress', message, {
      stage: stepKey,
      progress
    }, now)
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
    this.recordEvent(workflowJobId, `${workflowJobId}-${stepKey}`, 'pipeline_step', 'stage_completed', `${stepKey} completed`, {
      stage: stepKey
    }, now)
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
    this.recordEvent(workflowJobId, `${workflowJobId}-${stepKey}`, 'pipeline_step', 'stage_failed', message, {
      stage: stepKey,
      errorCode
    }, now)
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
    this.recordEvent(workflowJobId, null, 'pipeline_job', 'job_completed', `Processing complete with ${clipsFound} clips`, {
      projectId,
      episodeId,
      clipsFound
    }, now)
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
    this.recordEvent(workflowJobId, null, 'pipeline_job', 'job_failed', message, {
      projectId: projectId ?? null,
      episodeId: episodeId ?? null
    }, now)
  }

  private startPipelineSelectionRun(
    workflowJobId: string,
    episodeId: string,
    runConfigSnapshot: PipelineRunConfigSnapshot
  ) {
    const selectionRunId = randomUUID()
    const now = new Date().toISOString()
    const selectorVersion = this.resolveSelectionRunVersion(runConfigSnapshot.productionSelectorMode)
    const selectionSource = this.resolveSelectionSourceFromProductionMode(runConfigSnapshot.productionSelectorMode)
    database.createPipelineSelectionRun({
      id: selectionRunId,
      workflowJobId,
      episodeId,
      selectorVersion,
      status: 'running',
      productionMode: runConfigSnapshot.productionSelectorMode,
      summaryJson: JSON.stringify({
        selectionSource,
        selectorVersion,
        workflowJobId,
        episodeId,
        productionMode: runConfigSnapshot.productionSelectorMode,
        status: 'running'
      })
    })
    this.recordEvent(workflowJobId, null, 'selection_run', 'selection_run_started', 'Started clip selection run', {
      selectionRunId,
      selectorVersion,
      productionMode: runConfigSnapshot.productionSelectorMode,
      episodeId
    }, now)
    return selectionRunId
  }

  private completePipelineSelectionRun(
    workflowJobId: string,
    selectionRunId: string,
    episodeId: string,
    workerResult: PipelineWorkerCompletedEvent
  ) {
    const now = new Date().toISOString()
    const clipCount = workerResult.analysis.potentialClips.length
    const existingRun = database.getPipelineSelectionRun(selectionRunId)
    const configuredProductionMode = this.normalizeProductionSelectorMode(existingRun?.productionMode)
    const productionMode = configuredProductionMode
    const selectionSource = this.resolveSelectionSourceFromWorkerResult(workerResult)
    const selectorVersion = this.resolveSelectionRunVersion(productionMode)
    database.updatePipelineSelectionRun(selectionRunId, {
      status: 'completed',
      productionMode,
      selectorVersion,
      summaryJson: JSON.stringify({
        selectionSource,
        configuredProductionMode,
        actualSelectionSource: selectionSource,
        selectorVersion,
        productionMode,
        workflowJobId,
        episodeId,
        clipCount,
        contentPackageCount: workerResult.contentPackages.length,
        aiAnalysisSucceeded: workerResult.aiAnalysisSucceeded,
        status: 'completed'
      }),
      completedAt: now
    })
    this.recordEvent(workflowJobId, null, 'selection_run', 'selection_run_completed', 'Completed clip selection run', {
      selectionRunId,
      episodeId,
      selectionSource,
      configuredProductionMode,
      selectorVersion,
      productionMode,
      clipCount,
      aiAnalysisSucceeded: workerResult.aiAnalysisSucceeded
    }, now)
  }

  private failPipelineSelectionRun(
    workflowJobId: string,
    selectionRunId: string,
    episodeId: string | undefined,
    failedStage: PipelineStepKey | null,
    message: string
  ) {
    const existingRun = database.getPipelineSelectionRun(selectionRunId)
    if (!existingRun || existingRun.status === 'completed' || existingRun.status === 'failed') {
      return
    }

    const now = new Date().toISOString()
    const productionMode = existingRun.productionMode || 'legacy'
    const selectorVersion = this.resolveSelectionRunVersion(productionMode === 'arc_v1' ? 'arc_v1' : 'legacy')
    const selectionSource = this.resolveSelectionSourceFromProductionMode(productionMode === 'arc_v1' ? 'arc_v1' : 'legacy')
    database.updatePipelineSelectionRun(selectionRunId, {
      status: 'failed',
      productionMode,
      selectorVersion,
      summaryJson: JSON.stringify({
        selectionSource,
        selectorVersion,
        productionMode,
        workflowJobId,
        episodeId: episodeId ?? null,
        failedStage,
        errorMessage: message,
        status: 'failed'
      }),
      completedAt: now
    })
    this.recordEvent(workflowJobId, null, 'selection_run', 'selection_run_failed', 'Clip selection run failed', {
      selectionRunId,
      episodeId: episodeId ?? null,
      selectionSource,
      selectorVersion,
      productionMode,
      failedStage,
      errorMessage: message
    }, now)
  }

  private resolveSelectionRunVersion(productionMode: PipelineRunConfigSnapshot['productionSelectorMode']) {
    if (productionMode === 'llm_thread_v1') return LLM_THREAD_SELECTION_RUN_VERSION
    return productionMode === 'arc_v1' ? ARC_SELECTION_RUN_VERSION : LEGACY_SELECTION_RUN_VERSION
  }

  private resolveSelectionSourceFromProductionMode(productionMode: PipelineRunConfigSnapshot['productionSelectorMode']) {
    if (productionMode === 'llm_thread_v1') return LLM_THREAD_SELECTION_SOURCE
    return productionMode === 'arc_v1' ? ARC_SELECTION_SOURCE : LEGACY_SELECTION_SOURCE
  }

  private normalizeProductionSelectorMode(mode: unknown): PipelineRunConfigSnapshot['productionSelectorMode'] {
    return mode === 'legacy' || mode === 'llm_thread_v1' ? mode : 'arc_v1'
  }

  private resolveSelectionSourceFromWorkerResult(workerResult: PipelineWorkerCompletedEvent) {
    const metadataSelectionSource = workerResult.selectionMetadata?.selectionSource
    if (typeof metadataSelectionSource === 'string' && metadataSelectionSource.length > 0) {
      return metadataSelectionSource
    }

    const decisions = workerResult.selectionDecisions ?? []
    if (decisions.some((decision) => decision.decision === 'selected')) {
      return ARC_SELECTION_SOURCE
    }
    if (decisions.some((decision) => decision.decision === 'fallback_selected')) {
      return 'deterministic_candidate_arcs'
    }
    return LEGACY_SELECTION_SOURCE
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

  private recordEvent(
    jobId: string,
    stepRunId: string | null,
    scope: string,
    eventType: string,
    message: string,
    detail: Record<string, unknown>,
    createdAt = new Date().toISOString()
  ) {
    database.createWorkflowEvent({
      id: randomUUID(),
      jobId,
      stepRunId,
      scope,
      eventType,
      message,
      detailJson: JSON.stringify(detail),
      createdAt
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
