import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import AIService, { CleanedTranscriptUnit, ClipBoundaryReview, ResolvedClipProposal, SemanticTranscriptUnit, TranscriptBoundaryLine } from '../services/aiService'
import ClipSelectionAgentService, { ClipSelectionAgentError } from '../services/clipSelectionAgentService'
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
import { getTrailingBoundaryIssue, isCleanClipEnd } from '../../shared/clipBoundaryQuality'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'

const CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS = 10
const CLIP_REFINEMENT_MAX_SEMANTIC_END_EXTENSION_SECONDS = 24
const CLIP_REFINEMENT_TRAILING_PAD_SECONDS = 0.22
const CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS = 0.45
const CLIP_REFINEMENT_WORD_GUARD_SECONDS = 0.04
const THOUGHT_UNIT_SOFT_BREAK_GAP_SECONDS = 0.5
const THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS = 1.1
const THOUGHT_UNIT_PREFERRED_MAX_DURATION_SECONDS = 24
const THOUGHT_UNIT_PREFERRED_MAX_WORDS = 72
const THOUGHT_UNIT_ABSOLUTE_MAX_DURATION_SECONDS = 34
const THOUGHT_UNIT_ABSOLUTE_MAX_WORDS = 110
const THOUGHT_UNIT_CLAUSE_BREAK_MIN_WORDS = 18
const SEMANTIC_CLIP_MAX_DURATION_SECONDS = 120
const RESOLVED_CLIP_MIN_DURATION_SECONDS = 25

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

function getRankingModelMetadata(command: StartPipelineWorkerCommand) {
  return {
    modelAlias: command.runConfigSnapshot.apiModelAlias,
    modelId: command.runConfigSnapshot.apiModelId,
    clipSelectionPlatform: command.runConfigSnapshot.clipSelectionPlatform,
    promptVersion: command.runConfigSnapshot.rankingPromptVersion,
    implementationVersion: command.runConfigSnapshot.rankingImplementationVersion
  }
}

function getContentModelMetadata(command: StartPipelineWorkerCommand) {
  return {
    modelAlias: command.runConfigSnapshot.apiModelAlias,
    modelId: command.runConfigSnapshot.apiModelId,
    promptVersion: command.runConfigSnapshot.contentPromptVersion,
    implementationVersion: 'ai_service_v1',
    brandVoiceExampleCount: command.runConfigSnapshot.brandVoiceExampleCount
  }
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

function buildTranscriptBoundaryLinesFromSegments(
  segments: PipelineWorkerTranscription['segments']
): Array<TranscriptBoundaryLine & {
  boundaryQuality?: {
    cleanStart: boolean
    cleanEnd: boolean
    forcedBreak: boolean
  }
}> {
  return segments.map((segment, index) => ({
    lineIndex: index,
    start: segment.start,
    end: segment.end,
    text: segment.text,
    boundaryQuality: {
      cleanStart: !startsLikeContinuation(segment.text),
      cleanEnd: isCleanClipEnd(segment.text),
      forcedBreak: false
    }
  }))
}

function buildResolvedClipsFromProposals(
  transcription: PipelineWorkerTranscription,
  proposals: ResolvedClipProposal[],
  mediaDuration: number
): {
  clips: PipelineWorkerPotentialClip[]
  rejected: Array<{ startSegmentId: number; endSegmentId: number; reason: string }>
} {
  const segments = transcription.segments
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.start - right.start)
  const segmentById = new Map(segments.map((segment) => [segment.id, segment]))
  const segmentIndexById = new Map(segments.map((segment, index) => [segment.id, index]))
  const clips: PipelineWorkerPotentialClip[] = []
  const rejected: Array<{ startSegmentId: number; endSegmentId: number; reason: string }> = []

  proposals.forEach((proposal, index) => {
    const startSegment = segmentById.get(proposal.startSegmentId)
    let endSegment = segmentById.get(proposal.endSegmentId)
    if (!startSegment || !endSegment) {
      rejected.push({
        startSegmentId: proposal.startSegmentId,
        endSegmentId: proposal.endSegmentId,
        reason: 'Unknown start or end segment'
      })
      return
    }

    let endIndex = segmentIndexById.get(endSegment.id) ?? -1
    const startIndex = segmentIndexById.get(startSegment.id) ?? -1
    if (startIndex < 0 || endIndex < startIndex) {
      rejected.push({
        startSegmentId: proposal.startSegmentId,
        endSegmentId: proposal.endSegmentId,
        reason: 'Invalid segment order'
      })
      return
    }

    if (proposal.nextSegmentRelation === 'same_idea') {
      while (endIndex < segments.length - 1) {
        const next = segments[endIndex + 1]
        const projectedDuration = next.end - startSegment.start
        if (projectedDuration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
          break
        }
        endIndex += 1
        endSegment = next
        if (isCleanClipEnd(next.text)) {
          break
        }
      }
    }

    const duration = endSegment.end - startSegment.start
    if (duration < RESOLVED_CLIP_MIN_DURATION_SECONDS || duration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
      rejected.push({
        startSegmentId: proposal.startSegmentId,
        endSegmentId: endSegment.id,
        reason: `Duration ${duration.toFixed(1)}s is outside resolved clip bounds`
      })
      return
    }

    const nextSegment = segments[endIndex + 1]
    const endLooksClean = isCleanClipEnd(endSegment.text)
    const nextContinues = nextSegment
      ? shouldContinueThoughtAcrossBoundary(
          endSegment.text,
          nextSegment.text,
          Math.max(0, nextSegment.start - endSegment.end)
        )
      : false

    if (!endLooksClean && nextContinues) {
      rejected.push({
        startSegmentId: proposal.startSegmentId,
        endSegmentId: endSegment.id,
        reason: 'End still appears to continue into next segment'
      })
      return
    }

    clips.push({
      id: `resolved_${index + 1}`,
      startTime: startSegment.start,
      endTime: Math.min(mediaDuration, endSegment.end),
      duration: Number((Math.min(mediaDuration, endSegment.end) - startSegment.start).toFixed(3)),
      contentType: proposal.contentType,
      shareabilityScore: Number(proposal.shareabilityScore.toFixed(1)),
      keyQuote: proposal.keyQuote || segments
        .slice(startIndex, endIndex + 1)
        .map((segment) => segment.text.trim())
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180),
      reason: [
        proposal.reason,
        proposal.endResolutionReason ? `Endpoint: ${proposal.endResolutionReason}` : ''
      ].filter(Boolean).join(' '),
      contextNeeded: 'low'
    })
  })

  return { clips, rejected }
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

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function startsLikeContinuation(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  return (
    /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i.test(trimmed)
  )
}

function endsWithClausePunctuation(text: string) {
  return /[,;:]["']?\s*$/.test(text.trim())
}

function endsWithDanglingPhrase(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return false

  if (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any)\s*$/.test(normalized) ||
    /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
    /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized)
  ) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1] || ''
  return lastWord.length <= 2
}

function looksLikeCompleteThought(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false

  if (endsWithDanglingPhrase(trimmed)) {
    return false
  }

  if (endsWithTerminalPunctuation(trimmed)) {
    return true
  }

  const words = trimmed.split(/\s+/).filter(Boolean)
  return words.length >= 10
}

function shouldContinueThoughtAcrossBoundary(
  currentText: string,
  nextText: string,
  gap: number
) {
  if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS) {
    return false
  }

  if (endsWithTerminalPunctuation(currentText)) {
    return false
  }

  if (endsWithDanglingPhrase(currentText)) {
    return true
  }

  if (startsLikeContinuation(nextText)) {
    return true
  }

  return !looksLikeCompleteThought(currentText)
}

function shouldBreakThoughtUnit(
  currentText: string,
  nextText: string,
  currentDuration: number,
  currentWordCount: number,
  gap: number
) {
  const nextLooksContinuous = shouldContinueThoughtAcrossBoundary(currentText, nextText, gap)
  const currentLooksComplete = looksLikeCompleteThought(currentText)

  if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS && currentLooksComplete) {
    return true
  }

  if (
    endsWithTerminalPunctuation(currentText) &&
    (gap >= 0.16 || !nextLooksContinuous)
  ) {
    return true
  }

  if (
    endsWithClausePunctuation(currentText) &&
    currentWordCount >= THOUGHT_UNIT_CLAUSE_BREAK_MIN_WORDS &&
    !nextLooksContinuous &&
    currentLooksComplete
  ) {
    return true
  }

  if (
    gap >= THOUGHT_UNIT_SOFT_BREAK_GAP_SECONDS &&
    currentWordCount >= 8 &&
    currentLooksComplete &&
    !nextLooksContinuous
  ) {
    return true
  }

  if (
    (currentDuration >= THOUGHT_UNIT_PREFERRED_MAX_DURATION_SECONDS ||
      currentWordCount >= THOUGHT_UNIT_PREFERRED_MAX_WORDS) &&
    (currentLooksComplete || !nextLooksContinuous)
  ) {
    return true
  }

  if (
    currentDuration >= THOUGHT_UNIT_ABSOLUTE_MAX_DURATION_SECONDS ||
    currentWordCount >= THOUGHT_UNIT_ABSOLUTE_MAX_WORDS ||
    gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS * 2
  ) {
    return true
  }

  return false
}

function normalizeTranscriptIntoThoughtUnits(
  transcription: PipelineWorkerTranscription
): PipelineWorkerTranscription['segments'] {
  const rawSegments = transcription.segments
    .filter((segment) => segment.text?.trim())
    .sort((left, right) => left.start - right.start)

  if (rawSegments.length <= 1) {
    return rawSegments
  }

  const lines = buildTranscriptLinesFromSegments(rawSegments)
  if (lines.length === 0) {
    return rawSegments
  }

  return lines.map((line, index) => ({
    id: index,
    start: line.start,
    end: line.end,
    text: line.text,
    words: line.words
  }))
}

function buildSegmentsFromThoughtUnits(
  transcription: PipelineWorkerTranscription,
  units: SemanticTranscriptUnit[]
): PipelineWorkerTranscription['segments'] {
  return units
    .map((unit, index) => {
      const covered = transcription.segments
        .filter((segment) => segment.id >= unit.startSegmentId && segment.id <= unit.endSegmentId)
        .sort((left, right) => left.start - right.start)

      if (covered.length === 0) {
        return null
      }

      return {
        id: index,
        start: covered[0].start,
        end: covered[covered.length - 1].end,
        text: covered.map((segment) => segment.text.trim()).join(' ').replace(/\s+/g, ' ').trim(),
        words: covered.flatMap((segment) => segment.words ?? [])
      }
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
}

function buildSegmentsFromCleanedUnits(
  transcription: PipelineWorkerTranscription,
  units: CleanedTranscriptUnit[]
): PipelineWorkerTranscription['segments'] {
  return units
    .map((unit, index) => {
      const covered = transcription.segments
        .filter((segment) => segment.id >= unit.startSegmentId && segment.id <= unit.endSegmentId)
        .sort((left, right) => left.start - right.start)

      if (covered.length === 0) {
        return null
      }

      return {
        id: index,
        start: covered[0].start,
        end: covered[covered.length - 1].end,
        text: unit.cleanText,
        words: covered.flatMap((segment) => segment.words ?? [])
      }
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment))
}

function endsWithTerminalPunctuation(text: string) {
  return /[.!?]["']?\s*$/.test(text.trim())
}

function getLastOverlappingSegmentIndex(
  segments: PipelineWorkerTranscription['segments'],
  endTime: number
) {
  let index = -1

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start < endTime) {
      index = i
    } else {
      break
    }
  }

  return index
}

function findRefinedSegmentEndTime(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip,
  mediaDuration: number
) {
  const segments = transcription.segments
  const lastSegmentIndex = getLastOverlappingSegmentIndex(segments, clip.endTime)

  if (lastSegmentIndex < 0) {
    return clip.endTime
  }

  let refinedEnd = clip.endTime
  let cleanEnd: number | null = null
  let cursor = lastSegmentIndex

  while (cursor < segments.length) {
    const current = segments[cursor]
    const next = segments[cursor + 1]
    const extension = current.end - clip.endTime
    const projectedDuration = current.end - clip.startTime

    refinedEnd = Math.max(refinedEnd, current.end)

    if (endsWithTerminalPunctuation(current.text)) {
      cleanEnd = refinedEnd
      break
    }

    if (isCleanClipEnd(current.text)) {
      cleanEnd = refinedEnd
      break
    }

    if (!next) {
      break
    }

    const gapToNext = next.start - current.end
    const continuesThought = shouldContinueThoughtAcrossBoundary(current.text, next.text, gapToNext)

    if (gapToNext >= 0.35) {
      break
    }

    if (projectedDuration >= 90) {
      break
    }

    if (continuesThought) {
      if (extension >= CLIP_REFINEMENT_MAX_SEMANTIC_END_EXTENSION_SECONDS) {
        break
      }

      cursor += 1
      continue
    }

    if (extension >= CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS) {
      break
    }

    cursor += 1
  }

  return Math.min(cleanEnd ?? clip.endTime, mediaDuration)
}

function getWordsWithinWindow(
  transcription: PipelineWorkerTranscription,
  startTime: number,
  endTime: number
) {
  return transcription.segments
    .flatMap((segment) => segment.words ?? [])
    .filter((word) =>
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start &&
      word.end > startTime &&
      word.start < endTime
    )
    .sort((left, right) => left.start - right.start)
}

function refineClipBoundaryToWords(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip,
  mediaDuration: number
): {
  clip: PipelineWorkerPotentialClip
  changed: boolean
  originalStartTime: number
  originalEndTime: number
  refinedStartTime: number
  refinedEndTime: number
} {
  const refinedSegmentEnd = findRefinedSegmentEndTime(transcription, clip, mediaDuration)
  const words = getWordsWithinWindow(
    transcription,
    Math.max(0, clip.startTime - 0.25),
    Math.min(mediaDuration, refinedSegmentEnd + CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS)
  )

  if (words.length === 0) {
    const refinedClip = refinedSegmentEnd === clip.endTime
      ? clip
      : {
          ...clip,
          endTime: refinedSegmentEnd,
          duration: Number((refinedSegmentEnd - clip.startTime).toFixed(3))
        }

    return {
      clip: refinedClip,
      changed: refinedClip.startTime !== clip.startTime || refinedClip.endTime !== clip.endTime,
      originalStartTime: clip.startTime,
      originalEndTime: clip.endTime,
      refinedStartTime: refinedClip.startTime,
      refinedEndTime: refinedClip.endTime
    }
  }

  const overlappingWords = words.filter((word) => word.end > clip.startTime && word.start < refinedSegmentEnd)
  const firstWord = overlappingWords[0]
  const lastWord = overlappingWords[overlappingWords.length - 1]

  if (!firstWord || !lastWord) {
    return {
      clip,
      changed: false,
      originalStartTime: clip.startTime,
      originalEndTime: clip.endTime,
      refinedStartTime: clip.startTime,
      refinedEndTime: clip.endTime
    }
  }

  const lastWordIndex = words.findIndex(
    (word) => word.start === lastWord.start && word.end === lastWord.end && word.word === lastWord.word
  )
  const nextWord = lastWordIndex >= 0 ? words[lastWordIndex + 1] : undefined
  const gapToNextWord = nextWord ? nextWord.start - lastWord.end : Number.POSITIVE_INFINITY
  const trailingPad = Math.min(
    CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS,
    gapToNextWord >= CLIP_REFINEMENT_TRAILING_PAD_SECONDS
      ? Math.max(CLIP_REFINEMENT_TRAILING_PAD_SECONDS, gapToNextWord * 0.6)
      : CLIP_REFINEMENT_TRAILING_PAD_SECONDS
  )

  let refinedStart = clip.startTime
  let refinedEnd = Math.min(mediaDuration, lastWord.end + trailingPad)

  if (nextWord) {
    refinedEnd = Math.min(refinedEnd, Math.max(lastWord.end, nextWord.start - CLIP_REFINEMENT_WORD_GUARD_SECONDS))
  }

  refinedStart = Math.min(refinedStart, firstWord.start)
  refinedStart = Math.max(0, refinedStart)

  if (refinedEnd <= refinedStart) {
    return {
      clip,
      changed: false,
      originalStartTime: clip.startTime,
      originalEndTime: clip.endTime,
      refinedStartTime: clip.startTime,
      refinedEndTime: clip.endTime
    }
  }

  const refinedClip = {
    ...clip,
    startTime: refinedStart,
    endTime: refinedEnd,
    duration: Number((refinedEnd - refinedStart).toFixed(3))
  }

  return {
    clip: refinedClip,
    changed: refinedClip.startTime !== clip.startTime || refinedClip.endTime !== clip.endTime,
    originalStartTime: clip.startTime,
    originalEndTime: clip.endTime,
    refinedStartTime: refinedClip.startTime,
    refinedEndTime: refinedClip.endTime
  }
}

function refinePotentialClips(
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  mediaDuration: number
) {
  const refinements = clips.map((clip) => refineClipBoundaryToWords(transcription, clip, mediaDuration))

  return {
    clips: refinements.map((refinement) => refinement.clip),
    adjustments: refinements.map((refinement) => ({
      clipId: refinement.clip.id,
      changed: refinement.changed,
      originalStartTime: refinement.originalStartTime,
      originalEndTime: refinement.originalEndTime,
      refinedStartTime: refinement.refinedStartTime,
      refinedEndTime: refinement.refinedEndTime
    }))
  }
}

function buildClipWindowTextFromWords(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip
) {
  const words = getWordsWithinWindow(transcription, clip.startTime, clip.endTime)
  if (words.length > 0) {
    return words.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
  }

  return extractClipText(transcription, clip)
}

function getClipEndExtensionLimit(clip: PipelineWorkerPotentialClip, mediaDuration: number) {
  return Math.min(
    mediaDuration,
    clip.startTime + SEMANTIC_CLIP_MAX_DURATION_SECONDS,
    clip.endTime + CLIP_REFINEMENT_MAX_SEMANTIC_END_EXTENSION_SECONDS
  )
}

function resolveClipEndWithTrailingPad(
  words: Array<{ start: number; end: number; word: string }>,
  wordIndex: number,
  mediaDuration: number
) {
  const word = words[wordIndex]
  const nextWord = words[wordIndex + 1]
  const gapToNextWord = nextWord ? nextWord.start - word.end : Number.POSITIVE_INFINITY
  const trailingPad = Math.min(
    CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS,
    gapToNextWord >= CLIP_REFINEMENT_TRAILING_PAD_SECONDS
      ? Math.max(CLIP_REFINEMENT_TRAILING_PAD_SECONDS, gapToNextWord * 0.6)
      : CLIP_REFINEMENT_TRAILING_PAD_SECONDS
  )

  let endTime = Math.min(mediaDuration, word.end + trailingPad)
  if (nextWord) {
    endTime = Math.min(endTime, Math.max(word.end, nextWord.start - CLIP_REFINEMENT_WORD_GUARD_SECONDS))
  }

  return endTime
}

function buildAdjustedClipEnd(clip: PipelineWorkerPotentialClip, endTime: number): PipelineWorkerPotentialClip {
  return {
    ...clip,
    endTime,
    duration: Number((endTime - clip.startTime).toFixed(3))
  }
}

function findCleanExtendedClipEnd(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip,
  mediaDuration: number
) {
  const maxEnd = getClipEndExtensionLimit(clip, mediaDuration)
  const words = getWordsWithinWindow(transcription, clip.startTime, maxEnd)

  if (words.length === 0) {
    return null
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (word.end <= clip.endTime + CLIP_REFINEMENT_WORD_GUARD_SECONDS) {
      continue
    }

    const candidateEnd = resolveClipEndWithTrailingPad(words, index, mediaDuration)
    if (candidateEnd <= clip.endTime || candidateEnd - clip.startTime > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
      continue
    }

    const candidateClip = buildAdjustedClipEnd(clip, candidateEnd)
    const candidateText = buildClipWindowTextFromWords(transcription, candidateClip)
    if (isCleanClipEnd(candidateText)) {
      return {
        clip: candidateClip,
        endingPreview: candidateText.split(/\s+/).slice(-18).join(' '),
        reason: 'Extended to the next deterministic clean thought boundary.'
      }
    }
  }

  return null
}

function enforceCleanClipEnds(
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  mediaDuration: number
) {
  const accepted: PipelineWorkerPotentialClip[] = []
  const decisions: Array<{
    clipId: string
    status: 'accepted' | 'extended' | 'rejected'
    originalEndTime: number
    finalEndTime: number | null
    extensionSeconds: number
    endingPreview: string
    reason: string
    trailingBoundaryIssue: string | null
  }> = []
  const rejected: Array<{ clipId: string; endTime: number; endingPreview: string; reason: string; trailingBoundaryIssue: string | null }> = []

  for (const clip of clips) {
    const clipText = buildClipWindowTextFromWords(transcription, clip)
    const endingPreview = clipText.split(/\s+/).slice(-18).join(' ')
    const trailingBoundaryIssue = getTrailingBoundaryIssue(clipText)

    if (isCleanClipEnd(clipText)) {
      accepted.push(clip)
      decisions.push({
        clipId: clip.id,
        status: 'accepted',
        originalEndTime: clip.endTime,
        finalEndTime: clip.endTime,
        extensionSeconds: 0,
        endingPreview,
        reason: 'Clip already ends on a deterministic clean thought boundary.',
        trailingBoundaryIssue
      })
      continue
    }

    const extension = findCleanExtendedClipEnd(transcription, clip, mediaDuration)
    if (extension) {
      accepted.push(extension.clip)
      decisions.push({
        clipId: clip.id,
        status: 'extended',
        originalEndTime: clip.endTime,
        finalEndTime: extension.clip.endTime,
        extensionSeconds: Number((extension.clip.endTime - clip.endTime).toFixed(3)),
        endingPreview: extension.endingPreview,
        reason: extension.reason,
        trailingBoundaryIssue
      })
      continue
    }

    const rejectedClip = {
      clipId: clip.id,
      endTime: clip.endTime,
      endingPreview,
      reason: 'Final clip window could not be extended to a deterministic clean thought boundary within duration limits.',
      trailingBoundaryIssue
    }
    rejected.push(rejectedClip)
    decisions.push({
      clipId: clip.id,
      status: 'rejected',
      originalEndTime: clip.endTime,
      finalEndTime: null,
      extensionSeconds: 0,
      endingPreview,
      reason: rejectedClip.reason,
      trailingBoundaryIssue
    })
  }

  return { accepted, rejected, decisions }
}

async function finalizeClipBoundaries(
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  aiService: AIService | null,
  mediaDuration: number,
  preferredTranscriptLines?: TranscriptBoundaryLine[]
) {
  const semanticReview = await applySemanticBoundaryReview(transcription, clips, aiService, mediaDuration, preferredTranscriptLines)
  const wordRefinement = refinePotentialClips(transcription, semanticReview.clips, mediaDuration)
  const finalClosure = enforceCleanClipEnds(transcription, wordRefinement.clips, mediaDuration)

  return {
    clips: finalClosure.accepted,
    semanticReview,
    wordAdjustments: wordRefinement.adjustments,
    endBoundaryDecisions: finalClosure.decisions,
    rejectedFinalClips: finalClosure.rejected
  }
}

function mapClipsToTranscriptLines(
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  preferredTranscriptLines?: TranscriptBoundaryLine[]
) {
  const transcriptLines: TranscriptBoundaryLine[] = preferredTranscriptLines && preferredTranscriptLines.length > 0
    ? preferredTranscriptLines
    : buildTranscriptLinesFromSegments(transcription.segments).map((line) => ({
        lineIndex: line.lineIndex,
        start: line.start,
        end: line.end,
        text: line.text
      }))

  const findContainingLineIndex = (time: number, prefer: 'start' | 'end') => {
    const exact = transcriptLines.findIndex((line) =>
      prefer === 'start'
        ? time >= line.start && time < line.end + 0.01
        : time > line.start - 0.01 && time <= line.end + 0.01
    )

    if (exact >= 0) {
      return exact
    }

    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY
    transcriptLines.forEach((line, index) => {
      const distance = Math.min(Math.abs(time - line.start), Math.abs(time - line.end))
      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })
    return closestIndex
  }

  const mappedClips = clips.map((clip) => {
    const startLineIndex = findContainingLineIndex(clip.startTime, 'start')
    const endLineIndex = findContainingLineIndex(clip.endTime, 'end')
    return {
      clip,
      startLineIndex,
      endLineIndex: Math.max(startLineIndex, endLineIndex)
    }
  })

  return { transcriptLines, mappedClips }
}

function lineTextLooksIncomplete(text: string) {
  const normalized = text.trim().toLowerCase()
  if (!normalized) {
    return false
  }

  return (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any)\s*$/.test(normalized) ||
    /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
    /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized)
  )
}

function buildHeuristicBoundaryReviews(
  transcriptLines: TranscriptBoundaryLine[],
  mappedClips: Array<{ clip: PipelineWorkerPotentialClip; startLineIndex: number; endLineIndex: number }>
): ClipBoundaryReview[] {
  return mappedClips.map(({ clip, startLineIndex, endLineIndex }) => {
    let reviewedStart = startLineIndex
    let reviewedEnd = endLineIndex

    while (reviewedStart > 0 && startsLikeContinuation(transcriptLines[reviewedStart].text)) {
      const previous = transcriptLines[reviewedStart - 1]
      if (clip.endTime - previous.start > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
        break
      }
      reviewedStart -= 1
    }

    while (reviewedEnd < transcriptLines.length - 1) {
      const current = transcriptLines[reviewedEnd]
      const next = transcriptLines[reviewedEnd + 1]
      const projectedDuration = next.end - transcriptLines[reviewedStart].start

      if (projectedDuration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
        break
      }

      if (!lineTextLooksIncomplete(current.text) && !startsLikeContinuation(next.text)) {
        break
      }

      reviewedEnd += 1
    }

    return {
      clipId: clip.id,
      startLineIndex: reviewedStart,
      endLineIndex: reviewedEnd,
      reason: 'Heuristically adjusted to the nearest coherent transcript-line boundary.'
    }
  })
}

async function applySemanticBoundaryReview(
  transcription: PipelineWorkerTranscription,
  clips: PipelineWorkerPotentialClip[],
  aiService: AIService | null,
  mediaDuration: number,
  preferredTranscriptLines?: TranscriptBoundaryLine[]
) {
  const { transcriptLines, mappedClips } = mapClipsToTranscriptLines(transcription, clips, preferredTranscriptLines)
  if (transcriptLines.length === 0 || mappedClips.length === 0) {
    return {
      clips,
      reviews: [] as ClipBoundaryReview[],
      usedAI: false,
      fallbackReason: 'No transcript lines available for semantic boundary review.',
      transcriptLineCount: 0
    }
  }

  let reviews = buildHeuristicBoundaryReviews(transcriptLines, mappedClips)
  let usedAI = false
  let fallbackReason: string | null = aiService
    ? 'Semantic boundary review fell back to heuristic transcript-line adjustment.'
    : 'AI service unavailable; used heuristic transcript-line adjustment.'

  if (aiService) {
    try {
      const aiReviews = await aiService.reviewClipBoundaries(
        transcriptLines,
        mappedClips.map(({ clip }) => ({
          id: clip.id,
          startTime: clip.startTime,
          endTime: clip.endTime,
          duration: clip.duration,
          keyQuote: clip.keyQuote,
          reason: clip.reason
        })),
        mediaDuration
      )

      if (aiReviews.length > 0) {
        const reviewMap = new Map(aiReviews.map((review) => [review.clipId, review]))
        reviews = reviews.map((review) => reviewMap.get(review.clipId) ?? review)
        usedAI = true
        fallbackReason = null
      }
    } catch (error) {
      fallbackReason = error instanceof Error
        ? error.message
        : 'Unknown semantic boundary review error'
      console.warn('Semantic boundary review failed, using heuristic transcript-line adjustment', error)
    }
  }

  const reviewMap = new Map(reviews.map((review) => [review.clipId, review]))
  const adjustedClips = mappedClips.map(({ clip, startLineIndex, endLineIndex }) => {
    const review = reviewMap.get(clip.id)
    const finalStartLineIndex = review?.startLineIndex ?? startLineIndex
    const finalEndLineIndex = review?.endLineIndex ?? endLineIndex
    const startLine = transcriptLines[finalStartLineIndex]
    const endLine = transcriptLines[finalEndLineIndex]

    if (!startLine || !endLine || endLine.end <= startLine.start) {
      return clip
    }

    const nextDuration = endLine.end - startLine.start
    if (nextDuration < 25 || nextDuration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
      return clip
    }

    return {
      ...clip,
      startTime: startLine.start,
      endTime: Math.min(mediaDuration, endLine.end),
      duration: Number((Math.min(mediaDuration, endLine.end) - startLine.start).toFixed(3)),
      reason: review?.reason || clip.reason
    }
  })

  return {
    clips: adjustedClips,
    reviews,
    usedAI,
    fallbackReason,
    transcriptLineCount: transcriptLines.length
  }
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
        brandVoiceExamples.length > 0 ? brandVoiceExamples : undefined,
        undefined,
        clip.keyQuote
      )

      contentPackages.push({
        clipIndex: index,
        titles: contentPackage.titles,
        description: contentPackage.description,
        metadataAnalysis: null
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
  const clipSelectionAgent = command.apiConfig?.openRouterKey
    ? new ClipSelectionAgentService(command.apiConfig)
    : null
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
  let semanticTranscriptSegments: PipelineWorkerTranscription['segments'] | null = null

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
            model: 'medium',
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
          model: 'medium',
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
      language: transcription.language ?? null,
      metadata: {
        executor: 'local_whisper',
        implementationVersion: 'local_whisper_service_v1',
        model: command.runConfigSnapshot.localWhisperModel,
        wordTimestamps: true,
        chunked: audioStats.size > maxSize
      },
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

    let normalizedSegments = normalizeTranscriptIntoThoughtUnits(transcription)
    let transcriptNormalizationVersion = 'word_thought_lines_v1'
    let transcriptCleanupMetadata: Record<string, unknown> | null = null

    if (aiService) {
      try {
        const cleanedUnits = await aiService.cleanupTranscript(
          transcription,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, Math.min(progress * 0.35, 35), 'Cleaning transcript into editorial units...')
          }
        )
        const cleanedSegments = buildSegmentsFromCleanedUnits(transcription, cleanedUnits)
        if (cleanedSegments.length > 0) {
          normalizedSegments = cleanedSegments
          semanticTranscriptSegments = cleanedSegments
          transcriptNormalizationVersion = 'cleaned_editorial_units_v1'
          transcriptCleanupMetadata = {
            executor: 'ai_transcript_cleanup',
            unitCount: cleanedUnits.length,
            highPotentialUnitCount: cleanedUnits.filter((unit) => unit.clipPotential === 'high').length,
            completeThoughtUnitCount: cleanedUnits.filter((unit) => unit.completeThought).length,
            continuesNextUnitCount: cleanedUnits.filter((unit) => unit.continuesNext).length,
            preview: cleanedUnits.slice(0, 5)
          }
        }
      } catch (cleanupError) {
        console.warn('Transcript cleanup failed, falling back to semantic segmentation', cleanupError)

        try {
          const thoughtUnits = await aiService.segmentTranscriptIntoThoughts(
            transcription,
            (progress) => {
              postProgress(command.workflowJobId, currentStage, Math.min(35 + progress * 0.2, 55), 'Segmenting transcript into complete thoughts...')
            }
          )
          const aiNormalizedSegments = buildSegmentsFromThoughtUnits(transcription, thoughtUnits)
          if (aiNormalizedSegments.length > 0) {
            normalizedSegments = aiNormalizedSegments
            semanticTranscriptSegments = aiNormalizedSegments
            transcriptNormalizationVersion = 'semantic_thought_units_v1'
            transcriptCleanupMetadata = {
              executor: 'semantic_thought_segmentation_fallback',
              cleanupFailureReason: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
              unitCount: thoughtUnits.length
            }
          }
        } catch (error) {
          transcriptCleanupMetadata = {
            executor: 'heuristic_transcript_normalization_fallback',
            cleanupFailureReason: cleanupError instanceof Error ? cleanupError.message : 'Unknown cleanup error',
            semanticSegmentationFailureReason: error instanceof Error ? error.message : 'Unknown semantic segmentation error'
          }
          console.warn('Semantic transcript segmentation failed, falling back to heuristic normalization', error)
        }
      }
    }

    candidates = clipCandidateService.generateCandidates(normalizedSegments).slice(0, 36)

    postStageCompleted(command.workflowJobId, currentStage, {
      candidateCount: candidates.length,
      candidatePreview: candidates.slice(0, 5).map((candidate) => ({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        heuristicScore: candidate.heuristicScore
      })),
      metadata: {
        executor: 'clip_candidate_service',
        implementationVersion: command.runConfigSnapshot.candidateGeneratorVersion,
        minDuration: 30,
        maxDuration: 90,
        candidateLimit: 36,
        clipSelectionPlatform: command.runConfigSnapshot.clipSelectionPlatform,
        rawSegmentCount: transcription.segments.length,
        normalizedSegmentCount: normalizedSegments.length,
        transcriptNormalizationVersion,
        transcriptCleanup: transcriptCleanupMetadata
      },
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
      const semanticReview = await applySemanticBoundaryReview(transcription, analysis.potentialClips, null, command.mediaDuration)
      analysis = { potentialClips: semanticReview.clips }
      aiAnalysisSucceeded = false
      postProgress(command.workflowJobId, currentStage, 100, 'AI unavailable. Using heuristic clip suggestions.')
        postStageCompleted(command.workflowJobId, currentStage, {
          clipCount: analysis.potentialClips.length,
          mode: 'heuristic',
          aiAnalysisSucceeded,
          selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
            id: clip.id,
            startTime: clip.startTime,
            endTime: clip.endTime,
            shareabilityScore: clip.shareabilityScore
          })),
          metadata: {
            executor: 'heuristic_ranker',
            ...getRankingModelMetadata(command),
            boundaryRefinementVersion: 'semantic_line_boundary_v1',
            reviewedClipCount: semanticReview.reviews.length,
            semanticBoundaryReviewUsedAI: semanticReview.usedAI,
            transcriptLineCount: semanticReview.transcriptLineCount,
            semanticBoundaryReviewFallbackReason: semanticReview.fallbackReason,
            reviewPreview: semanticReview.reviews.slice(0, 5)
          },
          analysis
        })
    } else {
      let agentFailureMetadata: Record<string, unknown> | null = null
      try {
        postProgress(command.workflowJobId, currentStage, 10, 'Proposing resolved clip arcs...')

        const resolvedProposals = await aiService.proposeResolvedClips(
          transcription,
          command.mediaDuration,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, Math.min(10 + progress * 0.35, 45), 'Proposing resolved clip arcs...')
          }
        )
        const resolvedClips = buildResolvedClipsFromProposals(
          transcription,
          resolvedProposals,
          command.mediaDuration
        )

        if (resolvedClips.clips.length >= 2) {
          analysis = { potentialClips: resolvedClips.clips }
          aiAnalysisSucceeded = true

          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'resolved_clip_proposal',
            aiAnalysisSucceeded,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              executor: 'resolved_clip_proposal',
              ...getRankingModelMetadata(command),
              proposedClipCount: resolvedProposals.length,
              acceptedClipCount: resolvedClips.clips.length,
              rejectedClipCount: resolvedClips.rejected.length,
              rejectedPreview: resolvedClips.rejected.slice(0, 5)
            },
            analysis
          })
        } else {
          throw new Error(`Resolved clip proposal returned only ${resolvedClips.clips.length} usable clips`)
        }
      } catch (resolvedProposalError) {
        console.warn('Resolved clip proposal failed, falling back to clip selection agent:', resolvedProposalError)
        agentFailureMetadata = {
          agentAttempted: true,
          resolvedProposalFailureReason: resolvedProposalError instanceof Error
            ? resolvedProposalError.message
            : 'Unknown resolved clip proposal error'
        }
      }

      if (!analysis) {
      try {
        postProgress(command.workflowJobId, currentStage, 48, 'Selecting clips with clip selection agent...')

        const transcriptLines = semanticTranscriptSegments
          ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments)
          : buildTranscriptLinesFromSegments(
              transcription.segments.map((segment) => ({
                id: segment.id,
                start: Number(segment.start ?? 0),
                end: Number(segment.end ?? 0),
                text: String(segment.text ?? ''),
                words: Array.isArray(segment.words)
                  ? segment.words.map((word) => ({
                      word: String(word.word ?? '').trim(),
                      start: Number(word.start ?? 0),
                      end: Number(word.end ?? 0)
                    }))
                  : undefined
              }))
            )

        const agentSelection = await clipSelectionAgent!.selectClips({
          transcriptLines: transcriptLines.map((line) => ({
            lineIndex: line.lineIndex,
            start: line.start,
            end: line.end,
            text: line.text,
            boundaryQuality: line.boundaryQuality
          })),
          mediaDuration: command.mediaDuration,
          targetClipCount: Math.max(12, command.runConfigSnapshot.maxClipsPerEpisode)
        })

        if (agentSelection.clips.length >= 1) {
          analysis = { potentialClips: agentSelection.clips }
          aiAnalysisSucceeded = true

          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'clip_selection_agent',
            aiAnalysisSucceeded,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              ...agentSelection.metadata,
              agentAttempted: true,
              agentSelected: true,
              clipSelectionPlatform: command.runConfigSnapshot.clipSelectionPlatform,
              boundaryRefinementVersion: 'clip_selection_agent_v1'
            },
            analysis
          })
        } else {
          throw new Error(`Clip selection agent returned only ${agentSelection.clips.length} usable clips`)
        }
      } catch (agentError) {
        console.warn('Clip selection agent failed, falling back to boundary proposal / candidate ranking:', agentError)
        const clipSelectionFailureMetadata = agentError instanceof ClipSelectionAgentError
          ? {
              agentAttempted: true,
              agentFailureReason: agentError.message,
              agentFailureDetails: agentError.details
            }
          : {
              agentAttempted: true,
              agentFailureReason: agentError instanceof Error ? agentError.message : 'Unknown clip selection agent error'
            }
        agentFailureMetadata = {
          ...agentFailureMetadata,
          ...clipSelectionFailureMetadata
        }

      // Try AI boundary proposal first (gives AI freedom to propose timestamps)
      let usedBoundaryProposal = false
      try {
        postProgress(command.workflowJobId, currentStage, 10, 'AI proposing clip boundaries...')

        const proposedClips = await aiService.proposeBoundaries(
          transcription,
          command.mediaDuration,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, progress * 0.5, 'AI proposing clip boundaries...')
          }
        )

        // Filter to only validated clips
        const validatedClips = proposedClips.filter(clip => clip.validated)

        if (validatedClips.length >= 5) {
          // Boundary proposal succeeded
          console.log(`AI Boundary Proposal succeeded: ${validatedClips.length} validated clips`)

          analysis = {
            potentialClips: validatedClips.map((clip, index) => ({
              id: `ai_proposed_${index + 1}`,
              startTime: clip.startTime,
              endTime: clip.endTime,
              duration: clip.duration,
              contentType: clip.contentType,
              shareabilityScore: clip.shareabilityScore,
              keyQuote: clip.keyQuote,
              reason: clip.reason,
              contextNeeded: 'low' as const
            }))
          }

          const semanticReview = await applySemanticBoundaryReview(transcription, analysis.potentialClips, aiService, command.mediaDuration)
          analysis = { potentialClips: semanticReview.clips }
          aiAnalysisSucceeded = true
          usedBoundaryProposal = true

          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'ai_boundary_proposal',
            aiAnalysisSucceeded,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              executor: 'ai_boundary_proposal',
              ...getRankingModelMetadata(command),
              ...agentFailureMetadata,
              boundaryRefinementVersion: 'semantic_line_boundary_v1',
              proposedClipCount: proposedClips.length,
              validatedClipCount: validatedClips.length,
              reviewedClipCount: semanticReview.reviews.length,
              semanticBoundaryReviewUsedAI: semanticReview.usedAI,
              transcriptLineCount: semanticReview.transcriptLineCount,
              semanticBoundaryReviewFallbackReason: semanticReview.fallbackReason,
              reviewPreview: semanticReview.reviews.slice(0, 5)
            },
            analysis
          })
        } else {
          console.log(`AI Boundary Proposal insufficient: ${validatedClips.length} validated clips, falling back to ranking`)
          throw new Error('Insufficient validated clips from boundary proposal')
        }
      } catch (boundaryError) {
        console.warn('AI boundary proposal failed or insufficient, falling back to candidate ranking:', boundaryError)

        // Fall back to traditional candidate ranking
        try {
          postProgress(command.workflowJobId, currentStage, 55, 'Falling back to candidate ranking...')

          analysis = await aiService.analyzeTranscript(
            transcription,
            command.mediaDuration,
            candidates,
            (progress) => {
              postProgress(command.workflowJobId, currentStage, 55 + progress * 0.4, 'AI ranking candidates...')
            }
          )
          const semanticReview = await applySemanticBoundaryReview(transcription, analysis.potentialClips, aiService, command.mediaDuration)
          analysis = { potentialClips: semanticReview.clips }
          aiAnalysisSucceeded = true

          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'ai_candidate_ranking',
            aiAnalysisSucceeded,
            boundaryProposalFailed: true,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              executor: 'ai_ranker',
              ...getRankingModelMetadata(command),
              ...agentFailureMetadata,
              boundaryRefinementVersion: 'semantic_line_boundary_v1',
              reviewedClipCount: semanticReview.reviews.length,
              semanticBoundaryReviewUsedAI: semanticReview.usedAI,
              transcriptLineCount: semanticReview.transcriptLineCount,
              semanticBoundaryReviewFallbackReason: semanticReview.fallbackReason,
              reviewPreview: semanticReview.reviews.slice(0, 5)
            },
            analysis
          })
        } catch (rankingError) {
          // Both AI methods failed, use heuristic fallback
          analysis = buildHeuristicAnalysis(candidates)
          const semanticReview = await applySemanticBoundaryReview(transcription, analysis.potentialClips, null, command.mediaDuration)
          analysis = { potentialClips: semanticReview.clips }
          aiAnalysisSucceeded = false
          postProgress(command.workflowJobId, currentStage, 100, 'AI analysis failed. Using heuristic clip suggestions.')
          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'heuristic_fallback',
            aiAnalysisSucceeded,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              executor: 'heuristic_fallback',
              ...getRankingModelMetadata(command),
              ...agentFailureMetadata,
              boundaryRefinementVersion: 'semantic_line_boundary_v1',
              reviewedClipCount: semanticReview.reviews.length,
              semanticBoundaryReviewUsedAI: semanticReview.usedAI,
              transcriptLineCount: semanticReview.transcriptLineCount,
              semanticBoundaryReviewFallbackReason: semanticReview.fallbackReason,
              reviewPreview: semanticReview.reviews.slice(0, 5)
            },
            analysis,
            aiError: rankingError instanceof Error ? rankingError.message : 'Unknown error'
          })
        }
      }
      }
      }
    }
  }

  if (!analysis) {
    throw new Error('Missing ranked clip analysis for pipeline resume')
  }

  if (analysis.potentialClips.length > 0) {
    postProgress(command.workflowJobId, currentStage, 98, 'Finalizing clip boundaries...')
    const boundaryFinalization = await finalizeClipBoundaries(
      transcription,
      analysis.potentialClips,
      aiService,
      command.mediaDuration,
      semanticTranscriptSegments ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments) : undefined
    )
    analysis = { potentialClips: boundaryFinalization.clips }

    postStageCompleted(command.workflowJobId, 'clip_ranking', {
      clipCount: analysis.potentialClips.length,
      mode: 'final_boundary_refinement',
      aiAnalysisSucceeded,
      selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
        id: clip.id,
        startTime: clip.startTime,
        endTime: clip.endTime,
        shareabilityScore: clip.shareabilityScore
      })),
      metadata: {
        executor: 'final_boundary_refiner',
        boundaryRefinementVersion: 'semantic_line_plus_word_boundary_v2',
        reviewedClipCount: boundaryFinalization.semanticReview.reviews.length,
        semanticBoundaryReviewUsedAI: boundaryFinalization.semanticReview.usedAI,
        transcriptLineCount: boundaryFinalization.semanticReview.transcriptLineCount,
        semanticBoundaryReviewFallbackReason: boundaryFinalization.semanticReview.fallbackReason,
        wordBoundaryAdjustmentCount: boundaryFinalization.wordAdjustments.filter((adjustment) => adjustment.changed).length,
        endBoundaryExtendedCount: boundaryFinalization.endBoundaryDecisions.filter((decision) => decision.status === 'extended').length,
        finalClosureRejectedCount: boundaryFinalization.rejectedFinalClips.length,
        reviewPreview: boundaryFinalization.semanticReview.reviews.slice(0, 5),
        wordAdjustmentPreview: boundaryFinalization.wordAdjustments.slice(0, 5),
        endBoundaryDecisionPreview: boundaryFinalization.endBoundaryDecisions.slice(0, 5),
        finalClosureRejectedPreview: boundaryFinalization.rejectedFinalClips.slice(0, 5)
      },
      analysis
    })
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
        contentPackagePreview: contentPackages.slice(0, 5).map((contentPackage) => ({
          clipIndex: contentPackage.clipIndex,
          titleCount: contentPackage.titles.length,
          descriptionLength: contentPackage.description.length
        })),
        metadata: {
          executor: 'ai_content_generation',
          ...getContentModelMetadata(command)
        },
        contentPackages
      })
    } else {
      contentPackages = []
      postProgress(command.workflowJobId, currentStage, 100, 'Transcript processing completed')
      postStageCompleted(command.workflowJobId, currentStage, {
        skipped: true,
        aiAnalysisSucceeded,
        clipCount: analysis.potentialClips.length,
        metadata: {
          executor: 'skipped',
          ...getContentModelMetadata(command)
        },
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
    if (message.startStage === 'transcription' && !existsSync(message.audioPath)) {
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
