import { fork } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import type {
  ExtractPreviewClipCommand,
  MediaInfoDTO,
  MediaProgressEvent,
  MediaWorkerCommand,
  MediaWorkerEvent
} from '@shared/types/mediaWorker'

class MediaWorkerSupervisor {
  async probeMedia(inputPath: string): Promise<MediaInfoDTO> {
    const result = await this.runCommand({
      type: 'probe_media',
      requestId: randomUUID(),
      inputPath
    })

    if (result.type !== 'probe_media_completed') {
      throw new Error('Unexpected media worker response')
    }

    return result.mediaInfo
  }

  async extractAudio(
    inputPath: string,
    outputPath?: string,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const result = await this.runCommand(
      {
        type: 'extract_audio',
        requestId: randomUUID(),
        inputPath,
        outputPath
      },
      onProgress
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
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const command: ExtractPreviewClipCommand = {
      type: 'extract_preview_clip',
      requestId: randomUUID(),
      inputPath,
      startTime,
      duration,
      outputPath
    }

    const result = await this.runCommand(command, onProgress)
    if (result.type !== 'extract_preview_clip_completed') {
      throw new Error('Unexpected media worker response')
    }

    return result.outputPath
  }

  private async runCommand(
    command: MediaWorkerCommand,
    onProgress?: (progress: number) => void
  ): Promise<Exclude<MediaWorkerEvent, MediaProgressEvent>> {
    const workerPath = this.resolveWorkerPath()

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
          onProgress?.(message.progress)
          return
        }

        if (message.type === 'media_failed') {
          settled = true
          reject(new Error(message.message))
          return
        }

        settled = true
        resolve(message)
      })

      worker.on('exit', (code) => {
        if (!settled && code !== 0) {
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
}

export const mediaWorkerSupervisor = new MediaWorkerSupervisor()
