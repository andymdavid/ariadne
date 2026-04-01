import { existsSync, statSync } from 'fs'
import { ffmpegService } from '../services/ffmpegService'
import type {
  ExtractAudioCommand,
  ExtractPreviewClipCommand,
  GenerateWaveformCommand,
  MediaFailedEvent,
  MediaProgressEvent,
  MediaWorkerCommand,
  MediaWorkerEvent,
  ProbeMediaCommand
} from '@shared/types/mediaWorker'

function emit(event: MediaWorkerEvent) {
  if (process.send) {
    process.send(event)
  }
}

function assertOutputFile(path: string, errorMessage: string) {
  if (!existsSync(path)) {
    throw new Error(errorMessage)
  }

  if (statSync(path).size <= 0) {
    throw new Error(errorMessage)
  }
}

async function handleProbeMedia(command: ProbeMediaCommand) {
  const mediaInfo = await ffmpegService.getMediaInfo(command.inputPath)
  emit({
    type: 'probe_media_completed',
    requestId: command.requestId,
    mediaInfo
  })
}

async function handleExtractAudio(command: ExtractAudioCommand) {
  const outputPath = await ffmpegService.extractAudio(
    command.inputPath,
    command.outputPath,
    (progress) => {
      emit({
        type: 'media_progress',
        requestId: command.requestId,
        operation: 'extract_audio',
        progress,
        message: 'Extracting audio...'
      } satisfies MediaProgressEvent)
    }
  )

  assertOutputFile(outputPath, 'Extracted audio file was not created correctly')

  emit({
    type: 'extract_audio_completed',
    requestId: command.requestId,
    outputPath
  })
}

async function handleExtractPreviewClip(command: ExtractPreviewClipCommand) {
  const outputPath = await ffmpegService.createClip(
    command.inputPath,
    command.startTime,
    command.duration,
    command.outputPath,
    {
      format: 'mp4',
      onProgress: (progress) => {
        emit({
          type: 'media_progress',
          requestId: command.requestId,
          operation: 'extract_preview_clip',
          progress,
          message: 'Extracting clip...'
        } satisfies MediaProgressEvent)
      }
    }
  )

  assertOutputFile(outputPath, 'Preview clip file was not created correctly')

  emit({
    type: 'extract_preview_clip_completed',
    requestId: command.requestId,
    outputPath
  })
}

async function handleGenerateWaveform(command: GenerateWaveformCommand) {
  const peaks = await ffmpegService.generateWaveformPeaks(
    command.inputPath,
    command.startTime,
    command.duration,
    command.samples
  )

  emit({
    type: 'generate_waveform_completed',
    requestId: command.requestId,
    peaks
  })
}

async function handleCommand(command: MediaWorkerCommand) {
  if (command.type === 'probe_media') {
    await handleProbeMedia(command)
    return
  }

  if (command.type === 'extract_audio') {
    await handleExtractAudio(command)
    return
  }

  if (command.type === 'generate_waveform') {
    await handleGenerateWaveform(command)
    return
  }

  await handleExtractPreviewClip(command)
}

process.on('message', async (message: MediaWorkerCommand) => {
  try {
    await handleCommand(message)
    process.exit(0)
  } catch (error) {
    const failure: MediaFailedEvent = {
      type: 'media_failed',
      requestId: message.requestId,
      operation: message.type,
      errorCode:
        message.type === 'probe_media'
          ? 'probe_failed'
          : message.type === 'extract_audio'
            ? 'audio_extract_failed'
            : message.type === 'generate_waveform'
              ? 'waveform_failed'
            : 'preview_extract_failed',
      message: error instanceof Error ? error.message : 'Unknown media worker error'
    }
    emit(failure)
    process.exit(1)
  }
})
