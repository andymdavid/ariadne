import { fork } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { database } from '../database/database'
import type {
  ExtractPreviewClipCommand,
  MediaInfoDTO,
  MediaProgressEvent,
  MediaWorkerCommand,
  MediaWorkerEvent
} from '@shared/types/mediaWorker'

interface MediaDiagnosticsContext {
  workflowJobId: string
  stepRunId?: string | null
  scope: string
}

class MediaWorkerSupervisor {
  async probeMedia(inputPath: string, diagnostics?: MediaDiagnosticsContext): Promise<MediaInfoDTO> {
    const result = await this.runCommand({
      type: 'probe_media',
      requestId: randomUUID(),
      inputPath
    }, undefined, diagnostics)

    if (result.type !== 'probe_media_completed') {
      throw new Error('Unexpected media worker response')
    }

    return result.mediaInfo
  }

  async extractAudio(
    inputPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void,
    diagnostics?: MediaDiagnosticsContext
  ): Promise<string> {
    const result = await this.runCommand(
      {
        type: 'extract_audio',
        requestId: randomUUID(),
        inputPath,
        outputPath
      },
      onProgress,
      diagnostics
    )

    if (result.type !== 'extract_audio_completed') {
      throw new Error('Unexpected media worker response')
    }

    return result.outputPath
  }

  async extractPreviewClip(
    inputPath: string,
    startTime: number,
    duration: number,
    outputPath: string,
    onProgress?: (progress: number) => void,
    diagnostics?: MediaDiagnosticsContext
  ): Promise<string> {
    const command: ExtractPreviewClipCommand = {
      type: 'extract_preview_clip',
      requestId: randomUUID(),
      inputPath,
      startTime,
      duration,
      outputPath
    }

    const result = await this.runCommand(command, onProgress, diagnostics)
    if (result.type !== 'extract_preview_clip_completed') {
      throw new Error('Unexpected media worker response')
    }

    return result.outputPath
  }

  private async runCommand(
    command: MediaWorkerCommand,
    onProgress?: (progress: number) => void,
    diagnostics?: MediaDiagnosticsContext
  ): Promise<Exclude<MediaWorkerEvent, MediaProgressEvent>> {
    const workerPath = this.resolveWorkerPath()
    const now = new Date().toISOString()

    this.recordEvent(diagnostics, `${command.type}.started`, `${command.type} started`, {
      inputPath: 'inputPath' in command ? command.inputPath : null,
      outputPath: 'outputPath' in command ? command.outputPath ?? null : null
    }, now)

    return await new Promise((resolve, reject) => {
      let settled = false
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

      worker.on('message', (message: MediaWorkerEvent) => {
        if (message.requestId !== command.requestId || settled) {
          return
        }

        if (message.type === 'media_progress') {
          this.recordEvent(diagnostics, `${message.operation}.progress`, message.message, {
            progress: message.progress
          })
          onProgress?.(message.progress)
          return
        }

        if (message.type === 'media_failed') {
          settled = true
          this.recordEvent(diagnostics, `${message.operation}.failed`, message.message, {
            errorCode: message.errorCode
          })
          reject(new Error(message.message))
          return
        }

        settled = true
        this.recordEvent(diagnostics, `${message.type}.completed`, `${command.type} completed`, {
          ...message
        })
        resolve(message)
      })

      worker.on('exit', (code) => {
        if (!settled && code !== 0) {
          this.recordEvent(diagnostics, `${command.type}.worker_exit`, `Media worker exited with code ${code}`, {
            exitCode: code
          })
          reject(new Error(`Media worker exited with code ${code}`))
        }
      })

      worker.send(command)
    })
  }

  private resolveWorkerPath() {
    const distPath = join(__dirname, '..', 'workers', 'mediaWorker.js')
    if (existsSync(distPath)) {
      return distPath
    }

    return join(process.cwd(), 'dist', 'main', 'main', 'workers', 'mediaWorker.js')
  }

  private recordEvent(
    diagnostics: MediaDiagnosticsContext | undefined,
    eventType: string,
    message: string,
    detail: Record<string, unknown>,
    createdAt = new Date().toISOString()
  ) {
    if (!diagnostics) {
      return
    }

    database.createWorkflowEvent({
      id: randomUUID(),
      jobId: diagnostics.workflowJobId,
      stepRunId: diagnostics.stepRunId ?? null,
      scope: diagnostics.scope,
      eventType,
      message,
      detailJson: JSON.stringify(detail),
      createdAt
    })
  }
}

export const mediaWorkerSupervisor = new MediaWorkerSupervisor()
