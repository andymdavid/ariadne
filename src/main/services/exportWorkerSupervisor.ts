import { fork, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { database } from '../database/database'
import type {
  CancelExportWorkerCommand,
  ExportWorkerCommand,
  ExportWorkerEvent,
  StartExportWorkerCommand
} from '@shared/types/exportWorker'

class ExportWorkerSupervisor {
  private workers: Map<string, ChildProcess> = new Map()

  hasLiveWorker(exportJobId: string) {
    return this.workers.has(exportJobId)
  }

  async startExport(
    command: StartExportWorkerCommand,
    onJobUpdated?: (exportJobId: string) => void
  ) {
    if (this.hasLiveWorker(command.exportJobId)) {
      return
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

    this.workers.set(command.exportJobId, worker)

    worker.on('message', (message: ExportWorkerEvent) => {
      this.handleWorkerEvent(message, onJobUpdated)
    })

    worker.on('exit', () => {
      this.workers.delete(command.exportJobId)
    })

    worker.send(command as ExportWorkerCommand)
  }

  cancelExport(exportJobId: string) {
    const worker = this.workers.get(exportJobId)
    if (!worker) {
      return false
    }

    const command: CancelExportWorkerCommand = {
      type: 'cancel_export',
      exportJobId
    }
    worker.send(command)
    return true
  }

  private resolveWorkerPath() {
    const distPath = join(__dirname, '..', 'workers', 'exportWorker.js')
    if (existsSync(distPath)) {
      return distPath
    }

    return join(process.cwd(), 'dist', 'main', 'main', 'workers', 'exportWorker.js')
  }

  private handleWorkerEvent(event: ExportWorkerEvent, onJobUpdated?: (exportJobId: string) => void) {
    if (event.type === 'export_progress') {
      const now = new Date().toISOString()
      database.updateWorkflowJob(event.workflowJobId, {
        status: 'running',
        stage: 'rendering',
        message: `Exporting clip ${event.clipIndex + 1} of ${event.totalClips}`,
        progress: event.overallProgress,
        updatedAt: now
      })
      database.updateExportJob(event.exportJobId, {
        status: 'running',
        currentClipIndex: event.clipIndex,
        progress: event.overallProgress,
        updatedAt: now
      })
      database.updateWorkflowStepRunByJobAndClip(event.workflowJobId, event.clipId, {
        status: 'running',
        progress: event.clipProgress,
        updatedAt: now
      })
      database.updateExportOutputByJobAndClip(event.exportJobId, event.clipId, {
        status: 'rendering'
      })
      onJobUpdated?.(event.exportJobId)
      return
    }

    if (event.type === 'export_clip_complete') {
      const now = new Date().toISOString()
      const exportJob = database.getExportJobRecord(event.exportJobId)
      const episode = exportJob ? database.getEpisode(exportJob.episodeId) as any : null
      const artifactId = randomUUID()

      database.createArtifact({
        id: artifactId,
        artifactType: 'export_mp4',
        status: 'complete',
        projectId: episode?.project_id ?? null,
        episodeId: exportJob?.episodeId ?? null,
        clipId: event.clipId,
        workflowJobId: event.workflowJobId,
        filePath: event.outputPath,
        tempFilePath: null,
        mimeType: 'video/mp4',
        sizeBytes: null,
        checksum: null,
        metadataJson: JSON.stringify({
          exportJobId: event.exportJobId,
          clipId: event.clipId,
          resolution: event.resolution
        }),
        createdAt: now,
        updatedAt: now,
        completedAt: now
      })

      database.updateExportOutputByJobAndClip(event.exportJobId, event.clipId, {
        artifactId,
        filePath: event.outputPath,
        format: 'mp4',
        resolution: event.resolution,
        status: 'completed',
        errorMessage: null
      })
      database.updateWorkflowStepRunByJobAndClip(event.workflowJobId, event.clipId, {
        status: 'completed',
        progress: 100,
        outputJson: JSON.stringify({ outputPath: event.outputPath, artifactId }),
        completedAt: now,
        updatedAt: now
      })
      database.updateExportJob(event.exportJobId, {
        currentClipIndex: event.clipIndex,
        progress: Math.round(((event.clipIndex + 1) / event.totalClips) * 100),
        updatedAt: now
      })
      database.updateWorkflowJob(event.workflowJobId, {
        progress: Math.round(((event.clipIndex + 1) / event.totalClips) * 100),
        updatedAt: now
      })
      onJobUpdated?.(event.exportJobId)
      return
    }

    if (event.type === 'export_failed') {
      const now = new Date().toISOString()
      const errorMessage = event.message

      if (event.clipId) {
        database.updateWorkflowStepRunByJobAndClip(event.workflowJobId, event.clipId, {
          status: 'failed',
          errorCode: event.errorCode,
          errorMessage,
          completedAt: now,
          updatedAt: now
        })
        database.updateExportOutputByJobAndClip(event.exportJobId, event.clipId, {
          status: 'failed',
          errorMessage
        })
      }

      database.updateWorkflowJob(event.workflowJobId, {
        status: 'failed',
        stage: 'failed',
        message: errorMessage,
        completedAt: now,
        updatedAt: now
      })
      database.updateExportJob(event.exportJobId, {
        status: 'failed',
        errorMessage,
        completedAt: now,
        updatedAt: now
      })
      onJobUpdated?.(event.exportJobId)
      return
    }

    if (event.type === 'export_completed') {
      const now = new Date().toISOString()
      database.updateWorkflowJob(event.workflowJobId, {
        status: 'completed',
        stage: 'completed',
        message: 'Export complete',
        progress: 100,
        completedAt: now,
        updatedAt: now
      })
      database.updateExportJob(event.exportJobId, {
        status: 'completed',
        progress: 100,
        completedAt: now,
        updatedAt: now
      })
      onJobUpdated?.(event.exportJobId)
    }
  }
}

export const exportWorkerSupervisor = new ExportWorkerSupervisor()
