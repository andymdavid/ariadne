import { ffmpegService } from '../services/ffmpegService'
import type {
  ExportWorkerCommand,
  ExportWorkerClipFailureEvent,
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
  let failedClipCount = 0

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

    try {
      const resolution =
        task.resolution === '16:9'
          ? { width: 1920, height: 1080 }
          : task.resolution === '1:1'
            ? { width: 1080, height: 1080 }
            : { width: 1080, height: 1920 }
      let lastClipProgress = 0

      postMessage({
        type: 'export_progress',
        exportJobId: command.exportJobId,
        workflowJobId: command.workflowJobId,
        clipId: task.clipId,
        clipIndex: task.clipIndex,
        totalClips: task.totalClips,
        clipProgress: 0,
        overallProgress: Math.round((task.clipIndex / task.totalClips) * 100),
        outputPath: task.outputPath
      })

      await ffmpegService.exportReelClip(
        task.sourceMediaPath,
        task.startTime,
        task.duration,
        task.outputPath,
        {
          captionSegments: task.captionSegments,
          captionOverlayFrames: task.captionOverlayFrames,
          captionStyle: task.captionStyle,
          logoSettings: task.logoSettings,
          musicSettings: task.musicSettings,
          frameSettings: task.frameSettings,
          onProgress: (clipProgress) => {
            if (cancelRequested) {
              return
            }

            const stableClipProgress = Math.max(lastClipProgress, Math.round(clipProgress))
            lastClipProgress = stableClipProgress

            const progressEvent: ExportWorkerProgressEvent = {
              type: 'export_progress',
              exportJobId: command.exportJobId,
              workflowJobId: command.workflowJobId,
              clipId: task.clipId,
              clipIndex: task.clipIndex,
              totalClips: task.totalClips,
              clipProgress: stableClipProgress,
              overallProgress: Math.round(((task.clipIndex + stableClipProgress / 100) / task.totalClips) * 100),
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
    } catch (error) {
      failedClipCount += 1
      const failedEvent: ExportWorkerClipFailureEvent = {
        type: 'export_clip_failed',
        exportJobId: command.exportJobId,
        workflowJobId: command.workflowJobId,
        clipId: task.clipId,
        clipIndex: task.clipIndex,
        totalClips: task.totalClips,
        message: error instanceof Error ? error.message : 'Unknown clip export error'
      }
      postMessage(failedEvent)
    }
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
    ffmpegService.cancelActiveExport()
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
