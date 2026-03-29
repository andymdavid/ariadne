import { fork, ChildProcess } from 'child_process'
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
  }

  private handleFailure(event: PipelineWorkerFailureEvent, window?: BrowserWindow) {
    const now = new Date().toISOString()
    const failedStage = event.stage || this.findCurrentRunningStage(event.workflowJobId)

    if (failedStage) {
      database.updateWorkflowStepRun(`${event.workflowJobId}-${failedStage}`, {
        status: 'failed',
        errorCode: event.errorCode,
        errorMessage: event.message,
        completedAt: now,
        updatedAt: now
      })
    }

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
}

export const pipelineWorkerSupervisor = new PipelineWorkerSupervisor()
