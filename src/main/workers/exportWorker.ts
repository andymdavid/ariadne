import { ffmpegService } from '../services/ffmpegService'
import type {
  ExportWorkerCommand,
  ExportWorkerCompletedEvent,
  ExportWorkerEvent,
  ExportWorkerFailureEvent,
  ExportWorkerProgressEvent,
  StartExportWorkerCommand
} from '@shared/types/exportWorker'

let cancelRequested = false

function postMessage(event: ExportWorkerEvent) {
  if (typeof process.send === 'function') {
    process.send(event)
  }
}

async function runExport(command: StartExportWorkerCommand) {
  cancelRequested = false
  const outputPaths: string[] = []

  for (let i = 0; i < command.tasks.length; i++) {
    const task = command.tasks[i]

    if (cancelRequested) {
      const cancelledEvent: ExportWorkerFailureEvent = {
        type: 'export_failed',
        exportJobId: command.exportJobId,
        workflowJobId: command.workflowJobId,
        clipId: task.clipId,
        clipIndex: task.clipIndex,
        message: 'Cancelled by user',
        errorCode: 'cancelled'
      }
      postMessage(cancelledEvent)
      return
    }

    await ffmpegService.exportReelClip(
      task.sourceMediaPath,
      task.startTime,
      task.duration,
      task.outputPath,
      {
        captionSegments: task.captionSegments,
        captionStyle: task.captionStyle,
        logoSettings: task.logoSettings,
        musicSettings: task.musicSettings,
        frameSettings: task.frameSettings,
        onProgress: (clipProgress) => {
          if (cancelRequested) {
            return
          }

          const progressEvent: ExportWorkerProgressEvent = {
            type: 'export_progress',
            exportJobId: command.exportJobId,
            workflowJobId: command.workflowJobId,
            clipId: task.clipId,
            clipIndex: task.clipIndex,
            totalClips: task.totalClips,
            clipProgress: Math.round(clipProgress),
            overallProgress: Math.round(((task.clipIndex + clipProgress / 100) / task.totalClips) * 100),
            outputPath: task.outputPath
          }
          postMessage(progressEvent)
        }
      }
    )

    outputPaths.push(task.outputPath)
    postMessage({
      type: 'export_clip_complete',
      exportJobId: command.exportJobId,
      workflowJobId: command.workflowJobId,
      clipId: task.clipId,
      clipIndex: task.clipIndex,
      totalClips: task.totalClips,
      outputPath: task.outputPath,
      resolution: task.resolution
    })
  }

  const completedEvent: ExportWorkerCompletedEvent = {
    type: 'export_completed',
    exportJobId: command.exportJobId,
    workflowJobId: command.workflowJobId,
    outputPaths
  }
  postMessage(completedEvent)
}

process.on('message', async (message: ExportWorkerCommand) => {
  if (message.type === 'cancel_export') {
    cancelRequested = true
    return
  }

  if (message.type === 'start_export') {
    try {
      await runExport(message)
    } catch (error) {
      const failedEvent: ExportWorkerFailureEvent = {
        type: 'export_failed',
        exportJobId: message.exportJobId,
        workflowJobId: message.workflowJobId,
        message: error instanceof Error ? error.message : 'Unknown export error',
        errorCode: cancelRequested ? 'cancelled' : 'export_failed'
      }
      postMessage(failedEvent)
    }
  }
})
