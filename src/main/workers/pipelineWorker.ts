import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import AIService from '../services/aiService'
import clipCandidateService from '../services/clipCandidateService'
import LocalWhisperService from '../services/localWhisperService'
import type { AudioChunk } from '../services/clipSelectionTypes'
import type {
  PipelineWorkerCandidate,
  PipelineWorkerCommand,
  PipelineWorkerCompletedEvent,
  PipelineWorkerContentPackage,
  PipelineWorkerEvent,
  PipelineWorkerFailureEvent,
  PipelineWorkerPotentialClip,
  PipelineWorkerProgressEvent,
  PipelineWorkerStageCompletedEvent,
  PipelineWorkerStageKey,
  PipelineWorkerStageStartedEvent,
  PipelineWorkerTranscription,
  StartPipelineWorkerCommand,
} from '@shared/types/pipelineWorker'

function postMessage(event: PipelineWorkerEvent) {
  if (typeof process.send === 'function') {
    process.send(event)
  }
}

function postStageStarted(
  workflowJobId: string,
  stage: PipelineWorkerStageKey,
  message: string
) {
  const event: PipelineWorkerStageStartedEvent = {
    type: 'pipeline_stage_started',
    workflowJobId,
    stage,
    message
  }
  postMessage(event)
}

function postProgress(
  workflowJobId: string,
  stage: PipelineWorkerStageKey,
  progress: number,
  message: string,
  extras: Omit<PipelineWorkerProgressEvent, 'type' | 'workflowJobId' | 'stage' | 'progress' | 'message'> = {}
) {
  const event: PipelineWorkerProgressEvent = {
    type: 'pipeline_progress',
    workflowJobId,
    stage,
    progress: Math.round(progress),
    message,
    ...extras
  }
  postMessage(event)
}

function postStageCompleted(
  workflowJobId: string,
  stage: PipelineWorkerStageKey,
  output: Record<string, unknown>
) {
  const event: PipelineWorkerStageCompletedEvent = {
    type: 'pipeline_stage_completed',
    workflowJobId,
    stage,
    output
  }
  postMessage(event)
}

function buildHeuristicAnalysis(
  candidates: PipelineWorkerCandidate[]
) {
  return {
    potentialClips: candidates.slice(0, 8).map((candidate, index) => ({
      id: `heuristic_${index + 1}`,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      duration: candidate.duration,
      contentType: 'insight' as const,
      shareabilityScore: Number(Math.max(1, Math.min(10, candidate.heuristicScore * 1.6)).toFixed(1)),
      keyQuote: candidate.text.slice(0, 180),
      reason: 'Generated from local heuristic ranking because AI ranking was unavailable.',
      contextNeeded: 'low' as const
    }))
  }
}

function estimateTranscriptionTime(durationInSeconds: number): number {
  return Math.ceil(durationInSeconds / 10)
}

function estimateRemainingFromProgress(
  startedAt: number,
  progressFraction: number,
  mediaDurationInSeconds: number
): number {
  const clampedFraction = Math.max(0.01, Math.min(progressFraction, 0.99))
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000))

  if (progressFraction <= 0.02) {
    return estimateTranscriptionTime(mediaDurationInSeconds)
  }

  const estimatedTotalSeconds = elapsedSeconds / clampedFraction
  return Math.max(1, Math.ceil(estimatedTotalSeconds - elapsedSeconds))
}

function extractRecentLines(fullText: string): string[] {
  const sentences = fullText
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0)

  const recentSentences = sentences.slice(-3)
  const lines: string[] = []

  for (const sentence of recentSentences) {
    if (sentence.length > 80) {
      const words = sentence.split(' ')
      let currentLine = ''

      for (const word of words) {
        if ((currentLine + ' ' + word).length > 80) {
          if (currentLine) {
            lines.push(currentLine)
          }
          currentLine = word
        } else {
          currentLine = currentLine ? `${currentLine} ${word}` : word
        }
      }

      if (currentLine) {
        lines.push(currentLine)
      }
    } else {
      lines.push(sentence)
    }
  }

  return lines.slice(-2)
}

async function splitAudioFile(audioPath: string, durationInSeconds: number): Promise<AudioChunk[]> {
  const chunkDurationMinutes = 10
  const chunkDurationSeconds = chunkDurationMinutes * 60
  const numChunks = Math.ceil(durationInSeconds / chunkDurationSeconds)
  const chunks: AudioChunk[] = []
  const tempDir = join(tmpdir(), `ariadne-chunks-${Date.now()}`)

  await fs.mkdir(tempDir, { recursive: true })

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDurationSeconds
    const chunkPath = join(tempDir, `chunk_${i}.wav`)
    const chunkDuration = Math.min(chunkDurationSeconds, durationInSeconds - startTime)

    await new Promise<void>((resolve, reject) => {
      const ffmpeg = require('fluent-ffmpeg')
      ffmpeg(audioPath)
        .seekInput(startTime)
        .duration(chunkDuration)
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .format('wav')
        .output(chunkPath)
        .on('end', () => resolve())
        .on('error', (error: Error) => reject(error))
        .run()
    })

    chunks.push({
      path: chunkPath,
      startTime,
      duration: chunkDuration
    })
  }

  return chunks
}

async function cleanupChunks(chunks: AudioChunk[]) {
  for (const chunk of chunks) {
    try {
      await fs.unlink(chunk.path)
    } catch (error) {
      console.warn('Failed to cleanup chunk file:', chunk.path, error)
    }
  }

  if (chunks.length > 0) {
    try {
      await fs.rmdir(dirname(chunks[0].path))
    } catch (error) {
      console.warn('Failed to cleanup chunk directory:', dirname(chunks[0].path), error)
    }
  }
}

function extractClipText(transcription: PipelineWorkerTranscription, clip: PipelineWorkerPotentialClip) {
  return transcription.segments
    .filter((segment) => segment.end > clip.startTime && segment.start < clip.endTime)
    .map((segment) => segment.text)
    .join(' ')
    .trim()
}

async function generateContentPackages(
  workflowJobId: string,
  aiService: AIService | null,
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  brandVoiceExamples: string[]
): Promise<PipelineWorkerContentPackage[]> {
  if (!aiService || clips.length === 0) {
    return []
  }

  const selectedClips = clips.slice(0, 10)
  const contentPackages: PipelineWorkerContentPackage[] = []

  for (let index = 0; index < selectedClips.length; index++) {
    const clip = selectedClips[index]
    try {
      const clipText = extractClipText(transcription, clip)
      const contentPackage = await aiService.generateContentPackage(
        clipText,
        clip.contentType,
        brandVoiceExamples.length > 0 ? brandVoiceExamples : undefined
      )

      contentPackages.push({
        clipIndex: index,
        titles: contentPackage.titles,
        description: contentPackage.description
      })
    } catch (error) {
      console.error(`Failed to generate content package for clip ${clip.id}:`, error)
    } finally {
      postProgress(
        workflowJobId,
        'content_package_generation',
        ((index + 1) / selectedClips.length) * 100,
        'Generating content packages...'
      )
    }
  }

  return contentPackages
}

async function runPipeline(command: StartPipelineWorkerCommand) {
  const whisperService = new LocalWhisperService()
  const aiService = command.apiConfig?.openRouterKey ? new AIService(command.apiConfig) : null
  const stageOrder: PipelineWorkerStageKey[] = [
    'transcription',
    'clip_generation',
    'clip_ranking',
    'content_package_generation'
  ]
  const startStageIndex = stageOrder.indexOf(command.startStage)

  let currentStage: PipelineWorkerStageKey = command.startStage
  let transcription = command.resumeData?.transcription
  let candidates = command.resumeData?.candidates
  let analysis = command.resumeData?.analysis
  let aiAnalysisSucceeded = command.resumeData?.aiAnalysisSucceeded ?? false
  let contentPackages = command.resumeData?.contentPackages ?? []

  if (startStageIndex <= stageOrder.indexOf('transcription')) {
    currentStage = 'transcription'
    postStageStarted(command.workflowJobId, currentStage, 'Transcribing audio with Whisper...')

    const transcriptionStartedAt = Date.now()
    const audioStats = await fs.stat(command.audioPath)
    const maxSize = 20 * 1024 * 1024

    if (audioStats.size > maxSize) {
      postProgress(
        command.workflowJobId,
        currentStage,
        0,
        'Large file detected, splitting into chunks...',
        { timeRemaining: estimateTranscriptionTime(command.mediaDuration) }
      )

      const chunks = await splitAudioFile(command.audioPath, command.mediaDuration)
      try {
        transcription = await whisperService.transcribeInChunks(
          chunks,
          {
            model: 'base',
            wordTimestamps: true
          },
          (chunkIndex, _chunkProgress, totalProgress, partialText) => {
            postProgress(
              command.workflowJobId,
              currentStage,
              totalProgress,
              `Transcribing chunk ${chunkIndex + 1}/${chunks.length}...`,
              {
                partialTranscript: partialText,
                recentTranscriptLines: partialText ? extractRecentLines(partialText) : undefined,
                timeRemaining: estimateRemainingFromProgress(
                  transcriptionStartedAt,
                  totalProgress / 100,
                  command.mediaDuration
                )
              }
            )
          }
        )
      } finally {
        await cleanupChunks(chunks)
      }
    } else {
      transcription = await whisperService.transcribe(
        command.audioPath,
        {
          model: 'base',
          wordTimestamps: true
        },
        (progress, partialText) => {
          postProgress(
            command.workflowJobId,
            currentStage,
            progress,
            'Transcribing audio...',
            {
              partialTranscript: partialText,
              recentTranscriptLines: partialText ? extractRecentLines(partialText) : undefined,
              timeRemaining: estimateRemainingFromProgress(
                transcriptionStartedAt,
                progress / 100,
                command.mediaDuration
              )
            }
          )
        }
      )
    }

    postStageCompleted(command.workflowJobId, currentStage, {
      segmentCount: transcription.segments.length,
      transcriptLength: transcription.text.length,
      transcription
    })
  }

  if (!transcription) {
    throw new Error('Missing transcription data for pipeline resume')
  }

  if (startStageIndex <= stageOrder.indexOf('clip_generation')) {
    currentStage = 'clip_generation'
    postStageStarted(command.workflowJobId, currentStage, aiService
      ? 'Generating clip candidates from transcript...'
      : 'Generating heuristic clip candidates...')
    postProgress(command.workflowJobId, currentStage, 0, aiService
      ? 'Generating clip candidates from transcript...'
      : 'Generating heuristic clip candidates...')

    candidates = clipCandidateService.generateCandidates(transcription.segments).slice(0, 36)

    postStageCompleted(command.workflowJobId, currentStage, {
      candidateCount: candidates.length,
      candidates
    })
  }

  if (!candidates) {
    throw new Error('Missing clip candidate data for pipeline resume')
  }

  if (startStageIndex <= stageOrder.indexOf('clip_ranking')) {
    currentStage = 'clip_ranking'
    postStageStarted(command.workflowJobId, currentStage, aiService
      ? 'Ranking clip suggestions...'
      : 'Ranking heuristic clip suggestions...')

    if (!aiService) {
      analysis = buildHeuristicAnalysis(candidates)
      aiAnalysisSucceeded = false
      postProgress(command.workflowJobId, currentStage, 100, 'AI unavailable. Using heuristic clip suggestions.')
      postStageCompleted(command.workflowJobId, currentStage, {
        clipCount: analysis.potentialClips.length,
        mode: 'heuristic',
        aiAnalysisSucceeded,
        analysis
      })
    } else {
      try {
        analysis = await aiService.analyzeTranscript(
          transcription,
          command.mediaDuration,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, progress, 'AI analyzing content...')
          }
        )
        aiAnalysisSucceeded = true
        postStageCompleted(command.workflowJobId, currentStage, {
          clipCount: analysis.potentialClips.length,
          mode: 'ai',
          aiAnalysisSucceeded,
          analysis
        })
      } catch (error) {
        analysis = buildHeuristicAnalysis(candidates)
        aiAnalysisSucceeded = false
        postProgress(command.workflowJobId, currentStage, 100, 'AI analysis failed. Using heuristic clip suggestions.')
        postStageCompleted(command.workflowJobId, currentStage, {
          clipCount: analysis.potentialClips.length,
          mode: 'heuristic_fallback',
          aiAnalysisSucceeded,
          analysis,
          aiError: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  }

  if (!analysis) {
    throw new Error('Missing ranked clip analysis for pipeline resume')
  }

  if (startStageIndex <= stageOrder.indexOf('content_package_generation')) {
    currentStage = 'content_package_generation'
    postStageStarted(command.workflowJobId, currentStage, aiAnalysisSucceeded && analysis.potentialClips.length > 0
      ? 'Generating titles and descriptions...'
      : 'Skipping content package generation')

    if (aiAnalysisSucceeded && analysis.potentialClips.length > 0 && aiService) {
      contentPackages = await generateContentPackages(
        command.workflowJobId,
        aiService,
        transcription,
        analysis.potentialClips,
        command.brandVoiceExamples
      )
      postStageCompleted(command.workflowJobId, currentStage, {
        clipCount: contentPackages.length,
        contentPackages
      })
    } else {
      contentPackages = []
      postProgress(command.workflowJobId, currentStage, 100, 'Transcript processing completed')
      postStageCompleted(command.workflowJobId, currentStage, {
        skipped: true,
        aiAnalysisSucceeded,
        clipCount: analysis.potentialClips.length,
        contentPackages
      })
    }
  }

  const completedEvent: PipelineWorkerCompletedEvent = {
    type: 'pipeline_completed',
    workflowJobId: command.workflowJobId,
    transcription,
    analysis,
    aiAnalysisSucceeded,
    contentPackages
  }
  postMessage(completedEvent)
}

process.on('message', async (message: PipelineWorkerCommand) => {
  if (message.type !== 'start_pipeline') {
    return
  }

  try {
    if (!existsSync(message.audioPath)) {
      throw new Error('Audio file not found')
    }

    await runPipeline(message)
  } catch (error) {
    const failedEvent: PipelineWorkerFailureEvent = {
      type: 'pipeline_failed',
      workflowJobId: message.workflowJobId,
      message: error instanceof Error ? error.message : 'Unknown pipeline error',
      errorCode: 'pipeline_failed'
    }
    postMessage(failedEvent)
  }
})
