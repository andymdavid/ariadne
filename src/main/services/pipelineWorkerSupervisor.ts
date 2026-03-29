import { fork, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { database } from '../database/database'
import type { ProcessingProgress } from '@shared/types'
import type {
  PipelineWorkerCommand,
  PipelineWorkerCompletedEvent,
  PipelineWorkerEvent,
  PipelineWorkerFailureEvent,
  PipelineWorkerProgressEvent,
  PipelineWorkerStageCompletedEvent,
  PipelineWorkerStageKey,
  PipelineWorkerStageStartedEvent,
  StartPipelineWorkerCommand
} from '@shared/types/pipelineWorker'

interface RunPipelineOptions {
  window?: BrowserWindow
}

const WORKER_STAGE_KEYS: PipelineWorkerStageKey[] = [
  'transcription',
  'clip_generation',
  'clip_ranking',
  'content_package_generation'
]

class PipelineWorkerSupervisor {
  private workers: Map<string, ChildProcess> = new Map()

  hasLiveWorker(workflowJobId: string) {
    return this.workers.has(workflowJobId)
  }

  hasAnyLiveWorker() {
    return this.workers.size > 0
  }

  async runPipeline(
    command: StartPipelineWorkerCommand,
    options: RunPipelineOptions = {}
  ): Promise<PipelineWorkerCompletedEvent> {
    if (this.workers.has(command.workflowJobId)) {
      throw new Error(`Pipeline worker already running for job ${command.workflowJobId}`)
    }

    const workerPath = this.resolveWorkerPath()
    const worker = fork(workerPath, {
      env: {
        ...process.env,
        ARIADNE_USER_DATA_PATH: app.getPath('userData'),
        ARIADNE_APP_PATH: app.getAppPath(),
        ARIADNE_FONTS_DIR: app.isPackaged
          ? join(process.resourcesPath, 'assets', 'fonts')
          : join(app.getAppPath(), 'assets', 'fonts')
      },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    })

    this.workers.set(command.workflowJobId, worker)
    this.recordEvent(command.workflowJobId, null, 'pipeline_worker', 'worker_started', 'Pipeline worker started', {
      startStage: command.startStage
    })

    return await new Promise<PipelineWorkerCompletedEvent>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        if (this.workers.get(command.workflowJobId) === worker) {
          this.workers.delete(command.workflowJobId)
        }
      }

      worker.on('message', (message: PipelineWorkerEvent) => {
        if (settled) {
          return
        }

        if (message.type === 'pipeline_completed') {
          this.recordEvent(command.workflowJobId, null, 'pipeline_job', 'job_completed', 'Pipeline worker completed', {
            aiAnalysisSucceeded: message.aiAnalysisSucceeded,
            clipsFound: message.analysis.potentialClips.length
          })
          cleanup()
          settled = true
          resolve(message)
          return
        }

        if (message.type === 'pipeline_failed') {
          this.handleFailure(message, options.window)
          cleanup()
          settled = true
          reject(new Error(message.message))
          return
        }

        this.handleEvent(message, options.window)
      })

      worker.on('exit', (code) => {
        cleanup()
        if (!settled) {
          const now = new Date().toISOString()
          database.createFailureEvent({
            id: randomUUID(),
            jobId: command.workflowJobId,
            stepRunId: null,
            scope: 'pipeline_worker.process',
            errorCode: 'pipeline_worker_exit',
            message: `Pipeline worker exited with code ${code}`,
            detailJson: JSON.stringify({ exitCode: code }),
            createdAt: now
          })
          this.recordEvent(command.workflowJobId, null, 'pipeline_worker', 'worker_exit', `Pipeline worker exited with code ${code}`, {
            exitCode: code
          }, now)
          database.updateWorkflowJob(command.workflowJobId, {
            status: 'failed',
            stage: 'failed',
            message: `Pipeline worker exited with code ${code}`,
            completedAt: now,
            updatedAt: now
          })
          settled = true
          reject(new Error(`Pipeline worker exited with code ${code}`))
        }
      })

      worker.send(command as PipelineWorkerCommand)
    })
  }

  private resolveWorkerPath() {
    const distPath = join(__dirname, '..', 'workers', 'pipelineWorker.js')
    if (existsSync(distPath)) {
      return distPath
    }

    return join(process.cwd(), 'dist', 'main', 'main', 'workers', 'pipelineWorker.js')
  }

  private handleEvent(event: Exclude<PipelineWorkerEvent, PipelineWorkerCompletedEvent | PipelineWorkerFailureEvent>, window?: BrowserWindow) {
    if (event.type === 'pipeline_stage_started') {
      this.handleStageStarted(event, window)
      return
    }

    if (event.type === 'pipeline_progress') {
      this.handleProgress(event, window)
      return
    }

    this.handleStageCompleted(event)
  }

  private handleStageStarted(event: PipelineWorkerStageStartedEvent, window?: BrowserWindow) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${event.workflowJobId}-${event.stage}`, {
      status: 'running',
      progress: 0,
      message: event.message,
      startedAt: now,
      updatedAt: now
    })

    database.updateWorkflowJob(event.workflowJobId, {
      status: 'running',
      stage: event.stage,
      message: event.message,
      updatedAt: now
    })
    this.recordEvent(event.workflowJobId, `${event.workflowJobId}-${event.stage}`, 'pipeline_step', 'stage_started', event.message, {
      stage: event.stage
    }, now)

    const progress = this.buildRendererProgress(event.stage, 0, event.message)
    window?.webContents.send('processing-update', {
      jobId: event.workflowJobId,
      ...progress
    } satisfies ProcessingProgress)
  }

  private handleProgress(event: PipelineWorkerProgressEvent, window?: BrowserWindow) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${event.workflowJobId}-${event.stage}`, {
      status: 'running',
      progress: Math.round(event.progress),
      message: event.message,
      updatedAt: now
    })

    const rendererProgress = this.buildRendererProgress(
      event.stage,
      event.progress,
      event.message,
      event.partialTranscript,
      event.recentTranscriptLines,
      event.timeRemaining
    )

    database.updateWorkflowJob(event.workflowJobId, {
      status: 'running',
      stage: rendererProgress.stage,
      progress: Math.round(rendererProgress.progress),
      message: rendererProgress.message,
      updatedAt: now
    })
    this.recordEvent(event.workflowJobId, `${event.workflowJobId}-${event.stage}`, 'pipeline_step', 'stage_progress', event.message, {
      stage: event.stage,
      progress: event.progress,
      timeRemaining: event.timeRemaining ?? null
    }, now)

    window?.webContents.send('processing-update', {
      jobId: event.workflowJobId,
      ...rendererProgress
    } satisfies ProcessingProgress)
  }

  private handleStageCompleted(event: PipelineWorkerStageCompletedEvent) {
    const now = new Date().toISOString()
    database.updateWorkflowStepRun(`${event.workflowJobId}-${event.stage}`, {
      status: 'completed',
      progress: 100,
      outputJson: JSON.stringify(event.output),
      completedAt: now,
      updatedAt: now
    })
    this.recordEvent(event.workflowJobId, `${event.workflowJobId}-${event.stage}`, 'pipeline_step', 'stage_completed', `${event.stage} completed`, {
      stage: event.stage
    }, now)
  }

  private handleFailure(event: PipelineWorkerFailureEvent, window?: BrowserWindow) {
    const now = new Date().toISOString()
    const failedStage = event.stage || this.findCurrentRunningStage(event.workflowJobId)
    const stepRunId = failedStage ? `${event.workflowJobId}-${failedStage}` : null

    if (failedStage) {
      database.updateWorkflowStepRun(`${event.workflowJobId}-${failedStage}`, {
        status: 'failed',
        errorCode: event.errorCode,
        errorMessage: event.message,
        completedAt: now,
        updatedAt: now
      })
    }

    database.createFailureEvent({
      id: randomUUID(),
      jobId: event.workflowJobId,
      stepRunId,
      scope: failedStage ? `pipeline_worker.${failedStage}` : 'pipeline_worker.job',
      errorCode: event.errorCode,
      message: event.message,
      detailJson: JSON.stringify({
        stage: failedStage
      }),
      createdAt: now
    })
    this.recordEvent(event.workflowJobId, stepRunId, failedStage ? 'pipeline_step' : 'pipeline_worker', 'stage_failed', event.message, {
      stage: failedStage,
      errorCode: event.errorCode
    }, now)

    database.updateWorkflowJob(event.workflowJobId, {
      status: 'failed',
      stage: 'failed',
      message: event.message,
      completedAt: now,
      updatedAt: now
    })

    window?.webContents.send('processing-error', {
      jobId: event.workflowJobId,
      message: event.message
    })
  }

  private findCurrentRunningStage(workflowJobId: string): PipelineWorkerStageKey | null {
    const steps = database.getWorkflowStepRunsByJob(workflowJobId) as Array<{ stepKey: string; status: string }>
    const running = steps.find((step) => step.status === 'running' && WORKER_STAGE_KEYS.includes(step.stepKey as PipelineWorkerStageKey))
    return running ? running.stepKey as PipelineWorkerStageKey : null
  }

  private buildRendererProgress(
    workerStage: PipelineWorkerStageKey,
    stageProgress: number,
    message: string,
    partialTranscript?: string,
    recentTranscriptLines?: string[],
    timeRemaining?: number
  ): ProcessingProgress {
    if (workerStage === 'transcription') {
      return {
        stage: 'transcribing',
        progress: 30 + (stageProgress * 0.35),
        stageProgress,
        message,
        timeRemaining,
        thinkingMessage: 'listening carefully...',
        partialTranscript,
        recentTranscriptLines
      }
    }

    if (workerStage === 'clip_generation') {
      return {
        stage: 'analyzing',
        progress: 65 + (stageProgress * 0.1),
        stageProgress,
        message
      }
    }

    if (workerStage === 'clip_ranking') {
      return {
        stage: 'analyzing',
        progress: 75 + (stageProgress * 0.15),
        stageProgress,
        message
      }
    }

    return {
      stage: 'generating',
      progress: 90 + (stageProgress * 0.1),
      stageProgress,
      message
    }
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
}

export const pipelineWorkerSupervisor = new PipelineWorkerSupervisor()
