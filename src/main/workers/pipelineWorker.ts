import { promises as fs, existsSync } from 'fs'
import { randomUUID } from 'crypto'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import AIService, { CleanedTranscriptUnit, ResolvedClipProposal, SemanticTranscriptUnit, TranscriptBoundaryLine, WordSpanClipSelection } from '../services/aiService'
import { arcSelectionService } from '../services/arcSelectionService'
import ClipSelectionAgentService, { ClipSelectionAgentError } from '../services/clipSelectionAgentService'
import clipCandidateService from '../services/clipCandidateService'
import { canonicalTimelineService } from '../services/canonicalTimelineService'
import { coherentRoughCutService } from '../services/coherentRoughCutService'
import { finalClipValidationService } from '../services/finalClipValidationService'
import type { FinalClipValidationResult } from '../services/finalClipValidationService'
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
  PipelineWorkerSelectionDecision,
  PipelineWorkerStageCompletedEvent,
  PipelineWorkerStageKey,
  PipelineWorkerStageStartedEvent,
  PipelineWorkerTranscription,
  StartPipelineWorkerCommand,
} from '@shared/types/pipelineWorker'
import { isCleanClipEnd } from '../../shared/clipBoundaryQuality'
import { buildEditorialUnits, generateCandidateArcs, summarizeCandidateArcs, summarizeEditorialUnits } from '../../shared/editorialUnits'
import type { CandidateArc } from '../../shared/editorialUnits'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'

const THOUGHT_UNIT_SOFT_BREAK_GAP_SECONDS = 0.5
const THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS = 1.1
const THOUGHT_UNIT_PREFERRED_MAX_DURATION_SECONDS = 24
const THOUGHT_UNIT_PREFERRED_MAX_WORDS = 72
const THOUGHT_UNIT_ABSOLUTE_MAX_DURATION_SECONDS = 34
const THOUGHT_UNIT_ABSOLUTE_MAX_WORDS = 110
const THOUGHT_UNIT_CLAUSE_BREAK_MIN_WORDS = 18
const SEMANTIC_CLIP_MAX_DURATION_SECONDS = 120
const RESOLVED_CLIP_MIN_DURATION_SECONDS = 25
const TRANSCRIPT_MIN_WORD_TIMING_COVERAGE = 0.7
const TRANSCRIPT_MAX_INVALID_WORD_TIMING_RATIO = 0.02
const TRANSCRIPT_MAX_NON_MONOTONIC_WORD_TIMING_RATIO = 0.005

type TranscriptTimingQuality = {
  status: 'pass' | 'warn' | 'fail'
  timedWordCount: number
  estimatedWordCount: number
  wordTimingCoverage: number
  segmentCount: number
  segmentsWithWordTimings: number
  invalidWordTimingCount: number
  nonMonotonicWordTimingCount: number
  longWordDurationCount: number
  largeInterWordGapCount: number
  maxInterWordGapSeconds: number
  issues: string[]
}

function resolveArcTargetClipCount(maxClipsPerEpisode: number, mediaDuration: number) {
  const configuredLimit = Number.isFinite(maxClipsPerEpisode)
    ? Math.max(1, Math.floor(maxClipsPerEpisode))
    : 6
  const durationBasedTarget = Math.max(1, Math.min(6, Math.ceil(mediaDuration / 240)))
  return Math.min(configuredLimit, durationBasedTarget)
}

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

function estimateTranscriptWordCount(transcription: PipelineWorkerTranscription) {
  const text = transcription.text?.trim()
    ? transcription.text
    : transcription.segments.map((segment) => segment.text).join(' ')

  return text.split(/\s+/).map((word) => word.trim()).filter(Boolean).length
}

function assessTranscriptTimingQuality(transcription: PipelineWorkerTranscription): TranscriptTimingQuality {
  const estimatedWordCount = estimateTranscriptWordCount(transcription)
  const timedWords = transcription.segments
    .flatMap((segment) => Array.isArray(segment.words) ? segment.words : [])
    .map((word) => ({
      word: String(word.word ?? '').trim(),
      start: Number(word.start),
      end: Number(word.end)
    }))
    .filter((word) => word.word)
    .sort((left, right) => left.start - right.start)

  let invalidWordTimingCount = 0
  let nonMonotonicWordTimingCount = 0
  let longWordDurationCount = 0
  let largeInterWordGapCount = 0
  let maxInterWordGapSeconds = 0
  let previousEnd: number | null = null

  for (const word of timedWords) {
    const validTiming = Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start
    if (!validTiming) {
      invalidWordTimingCount += 1
      continue
    }

    const duration = word.end - word.start
    if (duration > 3.5) {
      longWordDurationCount += 1
    }

    if (previousEnd !== null) {
      const gap = word.start - previousEnd
      if (gap < -0.05) {
        nonMonotonicWordTimingCount += 1
      }
      if (gap > 2.5) {
        largeInterWordGapCount += 1
        maxInterWordGapSeconds = Math.max(maxInterWordGapSeconds, gap)
      }
    }
    previousEnd = Math.max(previousEnd ?? word.end, word.end)
  }

  const timedWordCount = timedWords.length
  const wordTimingCoverage = estimatedWordCount > 0
    ? Number(Math.min(1, timedWordCount / estimatedWordCount).toFixed(3))
    : 0
  const invalidWordTimingRatio = timedWordCount > 0 ? invalidWordTimingCount / timedWordCount : 1
  const nonMonotonicWordTimingRatio = timedWordCount > 0 ? nonMonotonicWordTimingCount / timedWordCount : 1
  const issues: string[] = []

  if (timedWordCount === 0) {
    issues.push('missing_word_timestamps')
  }
  if (wordTimingCoverage < TRANSCRIPT_MIN_WORD_TIMING_COVERAGE) {
    issues.push('low_word_timing_coverage')
  }
  if (invalidWordTimingRatio > TRANSCRIPT_MAX_INVALID_WORD_TIMING_RATIO) {
    issues.push('invalid_word_timing_ratio')
  }
  if (nonMonotonicWordTimingRatio > TRANSCRIPT_MAX_NON_MONOTONIC_WORD_TIMING_RATIO) {
    issues.push('non_monotonic_word_timings')
  }
  if (largeInterWordGapCount > Math.max(3, timedWordCount * 0.02)) {
    issues.push('frequent_large_inter_word_gaps')
  }

  const hardFailureIssues = new Set([
    'missing_word_timestamps',
    'low_word_timing_coverage',
    'invalid_word_timing_ratio',
    'non_monotonic_word_timings'
  ])
  const status = issues.some((issue) => hardFailureIssues.has(issue))
    ? 'fail'
    : issues.length > 0 || longWordDurationCount > Math.max(3, timedWordCount * 0.02)
      ? 'warn'
      : 'pass'

  return {
    status,
    timedWordCount,
    estimatedWordCount,
    wordTimingCoverage,
    segmentCount: transcription.segments.length,
    segmentsWithWordTimings: transcription.segments.filter((segment) => Array.isArray(segment.words) && segment.words.length > 0).length,
    invalidWordTimingCount,
    nonMonotonicWordTimingCount,
    longWordDurationCount,
    largeInterWordGapCount,
    maxInterWordGapSeconds: Number(maxInterWordGapSeconds.toFixed(3)),
    issues
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

function buildWordSpanClipsFromSelections(
  transcription: PipelineWorkerTranscription,
  selections: WordSpanClipSelection[],
  mediaDuration: number
): {
  clips: PipelineWorkerPotentialClip[]
  rejected: Array<{ startWordIndex: number; endWordIndex: number; reason: string }>
} {
  const words = transcription.segments
    .flatMap((segment) => segment.words ?? [])
    .map((word, index) => ({
      index,
      word: String(word.word ?? '').trim(),
      start: Number(word.start),
      end: Number(word.end)
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((left, right) => left.start - right.start)
  const wordByIndex = new Map(words.map((word) => [word.index, word]))
  const clips: PipelineWorkerPotentialClip[] = []
  const rejected: Array<{ startWordIndex: number; endWordIndex: number; reason: string }> = []

  selections.forEach((selection, index) => {
    const startWord = wordByIndex.get(selection.startWordIndex)
    const endWord = wordByIndex.get(selection.endWordIndex)
    if (!startWord || !endWord) {
      rejected.push({
        startWordIndex: selection.startWordIndex,
        endWordIndex: selection.endWordIndex,
        reason: 'Unknown start or end word index.'
      })
      return
    }

    const startTime = Math.max(0, startWord.start)
    const endTime = Math.min(mediaDuration, endWord.end)
    const duration = Number((endTime - startTime).toFixed(3))
    if (duration < RESOLVED_CLIP_MIN_DURATION_SECONDS || duration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
      rejected.push({
        startWordIndex: selection.startWordIndex,
        endWordIndex: selection.endWordIndex,
        reason: `Duration ${duration.toFixed(1)}s is outside resolved clip bounds.`
      })
      return
    }

    const selectedWords = words
      .filter((word) => word.index >= selection.startWordIndex && word.index <= selection.endWordIndex)
      .map((word) => word.word)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()

    clips.push({
      id: `word_span_${index + 1}`,
      startTime,
      endTime,
      duration,
      contentType: selection.contentType,
      shareabilityScore: selection.shareabilityScore,
      keyQuote: selection.keyQuote || selectedWords.slice(0, 180),
      reason: `${selection.reason} Selected from exact transcript word indexes ${selection.startWordIndex}-${selection.endWordIndex}.`,
      contextNeeded: selection.contextNeeded
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

function buildCanonicalEditorialTimelineSegments(
  transcription: PipelineWorkerTranscription,
  segments: PipelineWorkerTranscription['segments']
): PipelineWorkerTranscription['segments'] {
  return canonicalTimelineService.buildFromTranscription({
    ...transcription,
    text: segments.map((segment) => String(segment.text ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    segments
  }).segments.map((segment, index) => ({
    id: Number.isFinite(Number(segment.id)) ? Number(segment.id) : index,
    start: segment.start,
    end: segment.end,
    text: segment.text,
    words: segment.words
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

function buildClipFromCandidateArc(
  arc: CandidateArc,
  index: number,
  selectionDecisionId: string,
  reason: string
): PipelineWorkerPotentialClip {
  return {
    id: `boundary_arc_fallback_${index + 1}_${arc.id}`,
    selectionDecisionId,
    sourceArcId: arc.id,
    startTime: arc.startTime,
    endTime: arc.endTime,
    duration: arc.duration,
    contentType: arc.scores.emotionalEnergy >= 0.65 ? 'hot_take' : 'insight',
    shareabilityScore: Number(Math.max(1, Math.min(9.2, arc.scores.overall * 10)).toFixed(1)),
    keyQuote: arc.keyQuote,
    reason,
    contextNeeded: arc.scores.contextIndependence >= 0.7 ? 'low' : arc.scores.contextIndependence >= 0.45 ? 'medium' : 'high'
  }
}

async function preflightCandidateArcsForSelection(
  transcription: PipelineWorkerTranscription,
  arcs: CandidateArc[],
  mediaDuration: number,
  preferredTranscriptLines?: TranscriptBoundaryLine[]
) {
  if (arcs.length === 0) {
    return {
      arcs,
      validation: null,
      rejectedArcIds: []
    }
  }

  const preflightClips = arcs.map((arc, index) =>
    buildClipFromCandidateArc(
      arc,
      index,
      `boundary_preflight_${arc.id}`,
      `Boundary preflight for editorial candidate arc ${arc.id}.`
    )
  )
  const validation = await finalClipValidationService.finalizeClipBoundaries(
    transcription,
    preflightClips,
    null,
    mediaDuration,
    preferredTranscriptLines
  )
  const acceptedClipByArcId = new Map(
    validation.clips
      .map((clip) => [clip.sourceArcId, clip] as const)
      .filter((entry): entry is [string, PipelineWorkerPotentialClip] => Boolean(entry[0]))
  )
  const rejectedArcIds = validation.validatorDecisions
    .filter((decision) => decision.status === 'rejected')
    .map((decision) => preflightClips.find((clip) => clip.id === decision.clipId)?.sourceArcId)
    .filter((arcId): arcId is string => Boolean(arcId))

  return {
    arcs: arcs
      .filter((arc) => acceptedClipByArcId.has(arc.id))
      .map((arc) => {
        const acceptedClip = acceptedClipByArcId.get(arc.id)!
        return {
          ...arc,
          startTime: acceptedClip.startTime,
          endTime: acceptedClip.endTime,
          duration: acceptedClip.duration,
          diagnostics: {
            ...arc.diagnostics,
            boundaryPreflightAccepted: true,
            originalStartTime: arc.startTime,
            originalEndTime: arc.endTime
          }
        }
      }),
    validation,
    rejectedArcIds
  }
}

function buildFallbackArcRecoverySelection(
  candidateArcs: CandidateArc[],
  selectionDecisions: PipelineWorkerSelectionDecision[],
  limit = 4
): {
  clips: PipelineWorkerPotentialClip[]
  decisions: PipelineWorkerSelectionDecision[]
} {
  const alreadySelectedArcIds = new Set(
    selectionDecisions
      .filter((decision) => decision.decision === 'selected' || decision.decision === 'fallback_selected')
      .map((decision) => decision.candidateArcId)
      .filter((arcId): arcId is string => Boolean(arcId))
  )
  const existingDecisionByArcId = new Map(
    selectionDecisions
      .filter((decision) => Boolean(decision.candidateArcId))
      .map((decision) => [decision.candidateArcId as string, decision])
  )
  const recoveryArcs = candidateArcs
    .filter((arc) => !alreadySelectedArcIds.has(arc.id))
    .filter((arc) => arc.scores.contextIndependence >= 0.45 && arc.scores.narrativeFlow >= 0.45)
    .slice(0, limit)

  const clips: PipelineWorkerPotentialClip[] = []
  const fallbackDecisionByArcId = new Map<string, PipelineWorkerSelectionDecision>()

  recoveryArcs.forEach((arc, index) => {
    const decisionId = randomUUID()
    const reason = 'Recovered from an alternate candidate arc after all selected arcs failed final boundary validation.'
    clips.push(buildClipFromCandidateArc(arc, index, decisionId, reason))
    fallbackDecisionByArcId.set(arc.id, {
      id: decisionId,
      candidateArcId: arc.id,
      decision: 'fallback_selected',
      rankOrder: index + 1,
      modelScore: existingDecisionByArcId.get(arc.id)?.modelScore ?? Number((arc.scores.overall * 10).toFixed(1)),
      finalScore: Number((arc.scores.overall * 10).toFixed(1)),
      reason,
      validatorResultJson: '{}'
    })
  })

  const selectedRecoveryArcIds = new Set(fallbackDecisionByArcId.keys())
  const decisions = selectionDecisions.map((decision) => {
    if (!decision.candidateArcId || !selectedRecoveryArcIds.has(decision.candidateArcId)) {
      return decision
    }
    return fallbackDecisionByArcId.get(decision.candidateArcId) ?? decision
  })

  for (const [arcId, decision] of fallbackDecisionByArcId.entries()) {
    if (!selectionDecisions.some((existingDecision) => existingDecision.candidateArcId === arcId)) {
      decisions.push(decision)
    }
  }

  return { clips, decisions }
}

function buildResolvedClipRecoverySelection(
  clips: PipelineWorkerPotentialClip[],
  selectionDecisions: PipelineWorkerSelectionDecision[]
): {
  clips: PipelineWorkerPotentialClip[]
  decisions: PipelineWorkerSelectionDecision[]
} {
  const recoveredClips: PipelineWorkerPotentialClip[] = []
  const recoveryDecisions: PipelineWorkerSelectionDecision[] = []

  clips.forEach((clip, index) => {
    const decisionId = randomUUID()
    const reason = 'Recovered from resolved transcript segment proposal after selected candidate arcs failed final boundary validation.'
    recoveredClips.push({
      ...clip,
      selectionDecisionId: decisionId,
      sourceArcId: null,
      reason: `${clip.reason} ${reason}`
    })
    recoveryDecisions.push({
      id: decisionId,
      candidateArcId: null,
      decision: 'fallback_selected',
      rankOrder: index + 1,
      modelScore: clip.shareabilityScore,
      finalScore: clip.shareabilityScore,
      reason,
      validatorResultJson: '{}'
    })
  })

  return {
    clips: recoveredClips,
    decisions: [...selectionDecisions, ...recoveryDecisions]
  }
}

function buildWordSpanSelectionDecisions(
  clips: PipelineWorkerPotentialClip[]
): PipelineWorkerSelectionDecision[] {
  return clips.map((clip, index) => {
    const decisionId = clip.selectionDecisionId ?? randomUUID()
    clip.selectionDecisionId = decisionId
    return {
      id: decisionId,
      candidateArcId: null,
      decision: 'selected',
      rankOrder: index + 1,
      modelScore: clip.shareabilityScore,
      finalScore: clip.shareabilityScore,
      reason: `Selected by word-span clip selector. ${clip.reason}`,
      validatorResultJson: '{}'
    }
  })
}

function applyFinalClipValidationToSelectionDecisions(
  selectionDecisions: PipelineWorkerSelectionDecision[],
  selectedClips: PipelineWorkerPotentialClip[],
  validationResult: FinalClipValidationResult,
  recoveredFromFallback: boolean
): PipelineWorkerSelectionDecision[] {
  if (selectionDecisions.length === 0 || selectedClips.length === 0) {
    return selectionDecisions
  }

  const selectedDecisionSlots = selectionDecisions
    .map((decision, index) => ({ decision, index }))
    .filter(({ decision }) => decision.decision === 'selected' || decision.decision === 'fallback_selected')
    .sort((left, right) => (left.decision.rankOrder ?? Number.MAX_SAFE_INTEGER) - (right.decision.rankOrder ?? Number.MAX_SAFE_INTEGER))

  if (selectedDecisionSlots.length === 0) {
    return selectionDecisions
  }

  const validatorDecisionByClipId = new Map(validationResult.validatorDecisions.map((decision) => [decision.clipId, decision]))
  const rejectedClipByClipId = new Map(validationResult.rejectedClips.map((clip) => [clip.clipId, clip]))
  const wordAdjustmentByClipId = new Map(validationResult.wordAdjustments.map((adjustment) => [adjustment.clipId, adjustment]))
  const selectedDecisionIndexByClipId = new Map<string, number>()

  selectedClips.forEach((clip, index) => {
    if (clip.selectionDecisionId) {
      const selectedDecisionIndex = selectionDecisions.findIndex((decision) => decision.id === clip.selectionDecisionId)
      if (selectedDecisionIndex >= 0) {
        selectedDecisionIndexByClipId.set(clip.id, selectedDecisionIndex)
        return
      }
    }

    if (clip.sourceArcId) {
      const selectedDecisionIndex = selectionDecisions.findIndex((decision) => decision.candidateArcId === clip.sourceArcId)
      if (selectedDecisionIndex >= 0) {
        selectedDecisionIndexByClipId.set(clip.id, selectedDecisionIndex)
        return
      }
    }

    const selectedDecision = selectedDecisionSlots[index]
    if (selectedDecision) {
      selectedDecisionIndexByClipId.set(clip.id, selectedDecision.index)
    }
  })

  return selectionDecisions.map((decision, decisionIndex) => {
    const clipId = [...selectedDecisionIndexByClipId.entries()].find(([, index]) => index === decisionIndex)?.[0]
    if (!clipId) {
      return decision
    }

    const validatorDecision = validatorDecisionByClipId.get(clipId)
    const rejectedClip = rejectedClipByClipId.get(clipId)
    const wordAdjustment = wordAdjustmentByClipId.get(clipId) ?? null

    const validatorResult = validatorDecision
      ? {
          stage: 'final_clip_validator_v1',
          status: validatorDecision.status,
          clipId,
          originalStartTime: validatorDecision.originalStartTime,
          originalEndTime: validatorDecision.originalEndTime,
          validatedStartTime: validatorDecision.validatedStartTime,
          validatedEndTime: validatorDecision.validatedEndTime,
          score: validatorDecision.score,
          alternativesConsidered: validatorDecision.alternativesConsidered,
          openingPreview: validatorDecision.openingPreview,
          endingPreview: validatorDecision.endingPreview,
          reason: validatorDecision.reason,
          topAlternatives: validatorDecision.topAlternatives,
          roughCutStatus: validatorDecision.roughCutStatus,
          boundaryVariantType: validatorDecision.boundaryVariantType,
          repairOperation: validatorDecision.repairOperation,
          fatalIssues: validatorDecision.fatalIssues,
          recoveredFromFallbackBoundaryPass: recoveredFromFallback,
          wordAdjustment
        }
      : rejectedClip
        ? {
            stage: 'final_clip_validator_v1',
            status: 'rejected',
            clipId,
            rejectionCode: rejectedClip.rejectionCode,
            openingPreview: rejectedClip.openingPreview,
            endingPreview: rejectedClip.endingPreview,
            reason: rejectedClip.reason,
            topAlternatives: rejectedClip.topAlternatives,
            roughCutStatus: 'rejected_after_repair',
            recoveredFromFallbackBoundaryPass: recoveredFromFallback,
            wordAdjustment
          }
        : {
            stage: 'final_clip_validator_v1',
            status: 'unknown',
            clipId,
            recoveredFromFallbackBoundaryPass: recoveredFromFallback,
            wordAdjustment
          }

    return {
      ...decision,
      validatorResultJson: JSON.stringify(validatorResult)
    }
  })
}

function getClipOverlapRatio(left: PipelineWorkerPotentialClip, right: PipelineWorkerPotentialClip) {
  const overlapStart = Math.max(left.startTime, right.startTime)
  const overlapEnd = Math.min(left.endTime, right.endTime)
  const overlap = Math.max(0, overlapEnd - overlapStart)
  if (overlap <= 0) {
    return 0
  }

  const shortestDuration = Math.min(left.endTime - left.startTime, right.endTime - right.startTime)
  return shortestDuration > 0 ? overlap / shortestDuration : 0
}

function suppressOverlappingFinalClips(clips: PipelineWorkerPotentialClip[], maxOverlapRatio = 0.5) {
  const ranked = [...clips].sort((left, right) => {
    const shareabilityDelta = right.shareabilityScore - left.shareabilityScore
    if (shareabilityDelta !== 0) return shareabilityDelta
    return left.startTime - right.startTime
  })
  const accepted: PipelineWorkerPotentialClip[] = []
  const suppressed: PipelineWorkerPotentialClip[] = []

  for (const clip of ranked) {
    const overlapsAcceptedClip = accepted.some((acceptedClip) =>
      getClipOverlapRatio(clip, acceptedClip) > maxOverlapRatio
    )
    if (overlapsAcceptedClip) {
      suppressed.push(clip)
      continue
    }
    accepted.push(clip)
  }

  const acceptedIds = new Set(accepted.map((clip) => clip.id))
  return {
    clips: clips.filter((clip) => acceptedIds.has(clip.id)),
    suppressed
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
  let transcriptTimingQuality: TranscriptTimingQuality | null = transcription
    ? assessTranscriptTimingQuality(transcription)
    : null
  let selectionDecisions: PipelineWorkerSelectionDecision[] = command.resumeData?.selectionDecisions ?? []
  let semanticTranscriptSegments: PipelineWorkerTranscription['segments'] | null = transcription
    ? buildCanonicalEditorialTimelineSegments(transcription, transcription.segments)
    : null
  let editorialUnits = semanticTranscriptSegments
    ? buildEditorialUnits(semanticTranscriptSegments)
    : []
  let candidateArcs = editorialUnits.length > 0
    ? generateCandidateArcs(editorialUnits)
    : []
  let boundaryViableCandidateArcs: CandidateArc[] = candidateArcs
  let boundaryPreflightRejectedArcIds: string[] = []
  let clipSelectionSourceMetadata: Record<string, unknown> = {}
  const useLegacySelectorStack = command.runConfigSnapshot.productionSelectorMode === 'legacy'
  const allowLegacyResolvedClipProposal =
    useLegacySelectorStack || command.runConfigSnapshot.enableLegacyResolvedClipProposal
  const allowLegacyTranscriptLineAgent =
    useLegacySelectorStack || command.runConfigSnapshot.enableLegacyTranscriptLineAgent
  const allowLegacyBoundaryProposal =
    useLegacySelectorStack || command.runConfigSnapshot.enableLegacyBoundaryProposal
  const allowLegacyCandidateRanking =
    useLegacySelectorStack || command.runConfigSnapshot.enableLegacyCandidateRanking
  const allowHeuristicSupplementation =
    useLegacySelectorStack || command.runConfigSnapshot.enableHeuristicSupplementation

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
            model: command.runConfigSnapshot.localWhisperModel,
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
          model: command.runConfigSnapshot.localWhisperModel,
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

    transcriptTimingQuality = assessTranscriptTimingQuality(transcription)

    postStageCompleted(command.workflowJobId, currentStage, {
      segmentCount: transcription.segments.length,
      transcriptLength: transcription.text.length,
      language: transcription.language ?? null,
      metadata: {
        executor: 'local_whisper',
        implementationVersion: 'local_whisper_service_v1',
        model: command.runConfigSnapshot.localWhisperModel,
        wordTimestamps: true,
        chunked: audioStats.size > maxSize,
        transcriptTimingQuality
      },
      transcription
    })
  }

  if (!transcription) {
    throw new Error('Missing transcription data for pipeline resume')
  }

  if (!transcriptTimingQuality) {
    transcriptTimingQuality = assessTranscriptTimingQuality(transcription)
  }

  if (command.runConfigSnapshot.productionSelectorMode === 'arc_v1' && transcriptTimingQuality.status === 'fail') {
    throw new Error(`Transcript timing quality failed arc_v1 requirements: ${transcriptTimingQuality.issues.join(', ')}`)
  }

  if (!semanticTranscriptSegments) {
    semanticTranscriptSegments = buildCanonicalEditorialTimelineSegments(transcription, transcription.segments)
  }
  if (editorialUnits.length === 0) {
    editorialUnits = buildEditorialUnits(semanticTranscriptSegments)
  }
  if (candidateArcs.length === 0) {
    candidateArcs = generateCandidateArcs(editorialUnits)
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
    let editorialTimelineSegments = buildCanonicalEditorialTimelineSegments(transcription, normalizedSegments)
    semanticTranscriptSegments = editorialTimelineSegments
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
          editorialTimelineSegments = buildCanonicalEditorialTimelineSegments(transcription, cleanedSegments)
          semanticTranscriptSegments = editorialTimelineSegments
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
            editorialTimelineSegments = buildCanonicalEditorialTimelineSegments(transcription, aiNormalizedSegments)
            semanticTranscriptSegments = editorialTimelineSegments
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

    editorialUnits = buildEditorialUnits(editorialTimelineSegments)
    candidateArcs = generateCandidateArcs(editorialUnits)
    boundaryViableCandidateArcs = candidateArcs
    boundaryPreflightRejectedArcIds = []

    candidates = clipCandidateService.generateCandidates(editorialTimelineSegments).slice(0, 36)

    postStageCompleted(command.workflowJobId, currentStage, {
      candidateCount: candidates.length,
      candidatePreview: candidates.slice(0, 5).map((candidate) => ({
        startTime: candidate.startTime,
        endTime: candidate.endTime,
        heuristicScore: candidate.heuristicScore
      })),
      editorialUnits,
      candidateArcs,
      metadata: {
        executor: 'clip_candidate_service',
        implementationVersion: command.runConfigSnapshot.candidateGeneratorVersion,
        minDuration: 30,
        maxDuration: 90,
        candidateLimit: 36,
        clipSelectionPlatform: command.runConfigSnapshot.clipSelectionPlatform,
        rawSegmentCount: transcription.segments.length,
        normalizedSegmentCount: editorialTimelineSegments.length,
        transcriptTimingQuality,
        transcriptNormalizationVersion,
        transcriptCleanup: transcriptCleanupMetadata,
        editorialUnitBuilderVersion: 'editorial_units_v1',
        editorialUnits: summarizeEditorialUnits(editorialUnits),
        candidateArcGeneratorVersion: 'candidate_arcs_v1',
        candidateArcs: summarizeCandidateArcs(candidateArcs)
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
    const boundaryPreflight = candidateArcs.length > 0
      ? await preflightCandidateArcsForSelection(
          transcription,
          candidateArcs,
          command.mediaDuration,
          semanticTranscriptSegments ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments) : undefined
        )
      : null
    const selectionCandidateArcs = boundaryPreflight?.arcs ?? candidateArcs
    boundaryViableCandidateArcs = selectionCandidateArcs
    boundaryPreflightRejectedArcIds = boundaryPreflight?.rejectedArcIds ?? []
    if (boundaryPreflight) {
      clipSelectionSourceMetadata = {
        ...clipSelectionSourceMetadata,
        boundaryPreflightAttempted: true,
        boundaryPreflightCandidateArcCount: candidateArcs.length,
        boundaryPreflightAcceptedArcCount: selectionCandidateArcs.length,
        boundaryPreflightRejectedArcCount: boundaryPreflight.rejectedArcIds.length,
        boundaryPreflightRejectedArcIds: boundaryPreflight.rejectedArcIds
      }
    }

    if (candidateArcs.length > 0 || editorialUnits.length > 0) {
      postProgress(command.workflowJobId, currentStage, 5, 'Drafting coherent rough cuts...')
      const roughCutSelection = coherentRoughCutService.selectRoughCuts({
        transcription,
        editorialUnits,
        candidateArcs,
        mediaDuration: command.mediaDuration,
        targetClipCount: resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration)
      })

      if (roughCutSelection.clips.length > 0) {
        analysis = { potentialClips: roughCutSelection.clips }
        aiAnalysisSucceeded = Boolean(aiService)
        selectionDecisions = roughCutSelection.decisions
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          selectionSource: 'coherent_rough_cut_service',
          coherentRoughCutAttempted: true,
          coherentRoughCutSucceeded: true,
          coherentRoughCutReport: roughCutSelection.metadata
        }

        postStageCompleted(command.workflowJobId, currentStage, {
          clipCount: analysis.potentialClips.length,
          mode: 'coherent_rough_cut_service',
          aiAnalysisSucceeded,
          selectionDecisions,
          selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
            id: clip.id,
            startTime: clip.startTime,
            endTime: clip.endTime,
            shareabilityScore: clip.shareabilityScore
          })),
          metadata: {
            ...getRankingModelMetadata(command),
            ...clipSelectionSourceMetadata,
            coherentRoughCut: roughCutSelection.metadata,
            editorialUnitBuilderVersion: 'editorial_units_v1',
            candidateArcGeneratorVersion: 'candidate_arcs_v1',
            editorialUnits: summarizeEditorialUnits(editorialUnits),
            candidateArcs: summarizeCandidateArcs(candidateArcs),
            boundaryViableCandidateArcs: summarizeCandidateArcs(selectionCandidateArcs)
          },
          analysis
        })
      } else {
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          coherentRoughCutAttempted: true,
          coherentRoughCutSucceeded: false,
          coherentRoughCutReport: roughCutSelection.metadata
        }
      }
    }

    if (!analysis && !aiService) {
      if (selectionCandidateArcs.length > 0) {
        const arcSelection = await arcSelectionService.selectCandidateArcs(
          selectionCandidateArcs,
          command.mediaDuration,
          resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration),
          null
        )
        analysis = { potentialClips: arcSelection.clips }
        aiAnalysisSucceeded = false
        selectionDecisions = arcSelection.decisions
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          selectionSource: arcSelection.mode,
          selectedArcIds: arcSelection.selectedArcIds,
          candidateArcRankerFailureReason: arcSelection.fallbackReason ?? 'AI unavailable'
        }
        postProgress(command.workflowJobId, currentStage, 100, 'AI unavailable. Using deterministic candidate arcs.')
        postStageCompleted(command.workflowJobId, currentStage, {
          clipCount: analysis.potentialClips.length,
          mode: arcSelection.mode,
          aiAnalysisSucceeded,
          selectionDecisions,
          selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
            id: clip.id,
            startTime: clip.startTime,
            endTime: clip.endTime,
            shareabilityScore: clip.shareabilityScore
          })),
          metadata: {
            executor: 'deterministic_candidate_arcs',
            ...getRankingModelMetadata(command),
            candidateArcRankerVersion: 'candidate_arc_ranker_v1',
            candidateArcRankerFailureReason: arcSelection.fallbackReason ?? 'AI unavailable',
            editorialUnitBuilderVersion: 'editorial_units_v1',
            candidateArcGeneratorVersion: 'candidate_arcs_v1',
            editorialUnits: summarizeEditorialUnits(editorialUnits),
            candidateArcs: summarizeCandidateArcs(candidateArcs),
            boundaryViableCandidateArcs: summarizeCandidateArcs(selectionCandidateArcs),
            ...clipSelectionSourceMetadata,
            selectedArcIds: arcSelection.selectedArcIds,
            selectedArcCount: arcSelection.selectedArcIds.length
          },
          analysis
        })
      } else {
        analysis = buildHeuristicAnalysis(candidates)
        const semanticReview = await finalClipValidationService.applySemanticBoundaryReview(transcription, analysis.potentialClips, null, command.mediaDuration)
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
      }
    }

    if (!analysis && aiService) {
      const activeAiService = aiService
      let agentFailureMetadata: Record<string, unknown> | null = null

      try {
        postProgress(command.workflowJobId, currentStage, 6, 'Selecting exact transcript word spans...')
        const wordSpanSelections = await activeAiService.selectWordSpanClips(
          transcription,
          command.mediaDuration,
          resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration),
          (progress) => {
            postProgress(command.workflowJobId, currentStage, Math.min(6 + progress * 0.34, 40), 'Selecting exact transcript word spans...')
          }
        )
        const wordSpanClips = buildWordSpanClipsFromSelections(
          transcription,
          wordSpanSelections,
          command.mediaDuration
        )

        if (wordSpanClips.clips.length >= 1) {
          analysis = { potentialClips: wordSpanClips.clips }
          aiAnalysisSucceeded = true
          selectionDecisions = buildWordSpanSelectionDecisions(wordSpanClips.clips)
          clipSelectionSourceMetadata = {
            ...clipSelectionSourceMetadata,
            selectionSource: 'word_span_clip_selector',
            wordSpanSelectorAttempted: true,
            wordSpanSelectedCount: wordSpanSelections.length,
            wordSpanAcceptedCount: wordSpanClips.clips.length,
            wordSpanRejectedCount: wordSpanClips.rejected.length,
            wordSpanRejectedPreview: wordSpanClips.rejected.slice(0, 5)
          }

          postStageCompleted(command.workflowJobId, currentStage, {
            clipCount: analysis.potentialClips.length,
            mode: 'word_span_clip_selector',
            aiAnalysisSucceeded,
            selectionDecisions,
            selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
              id: clip.id,
              startTime: clip.startTime,
              endTime: clip.endTime,
              shareabilityScore: clip.shareabilityScore
            })),
            metadata: {
              executor: 'word_span_clip_selector',
              ...getRankingModelMetadata(command),
              ...clipSelectionSourceMetadata
            },
            analysis
          })
        } else {
          throw new Error(`Word span selector returned only ${wordSpanClips.clips.length} usable clips`)
        }
      } catch (wordSpanError) {
        agentFailureMetadata = {
          wordSpanSelectorAttempted: true,
          wordSpanSelectorFailureReason: wordSpanError instanceof Error ? wordSpanError.message : 'Unknown word span selector error'
        }
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          ...agentFailureMetadata
        }
      }

      if (!analysis && selectionCandidateArcs.length > 0) {
        try {
          postProgress(command.workflowJobId, currentStage, 8, 'Ranking editorial candidate arcs...')

          const arcSelection = await arcSelectionService.selectCandidateArcs(
            selectionCandidateArcs,
            command.mediaDuration,
            resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration),
            activeAiService,
            (progress) => {
              postProgress(command.workflowJobId, currentStage, Math.min(8 + progress * 0.32, 40), 'Ranking editorial candidate arcs...')
            }
          )
          const arcClips = arcSelection.clips

          if (arcClips.length >= 1) {
            analysis = { potentialClips: arcClips }
            aiAnalysisSucceeded = arcSelection.aiAnalysisSucceeded
            selectionDecisions = arcSelection.decisions

            postStageCompleted(command.workflowJobId, currentStage, {
              clipCount: analysis.potentialClips.length,
              mode: arcSelection.mode,
              aiAnalysisSucceeded,
              selectionDecisions,
              selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
                id: clip.id,
                startTime: clip.startTime,
                endTime: clip.endTime,
                shareabilityScore: clip.shareabilityScore
              })),
              metadata: {
                executor: 'candidate_arc_ranker',
                ...getRankingModelMetadata(command),
                candidateArcRankerVersion: 'candidate_arc_ranker_v1',
                editorialUnitBuilderVersion: 'editorial_units_v1',
                candidateArcGeneratorVersion: 'candidate_arcs_v1',
                editorialUnits: summarizeEditorialUnits(editorialUnits),
                candidateArcs: summarizeCandidateArcs(candidateArcs),
                boundaryViableCandidateArcs: summarizeCandidateArcs(selectionCandidateArcs),
                ...clipSelectionSourceMetadata,
                selectedArcIds: arcSelection.selectedArcIds,
                selectedArcCount: arcSelection.selectedArcIds.length,
                candidateArcRankerFailureReason: arcSelection.fallbackReason ?? null
              },
              analysis
            })
            clipSelectionSourceMetadata = {
              ...clipSelectionSourceMetadata,
              selectionSource: arcSelection.mode === 'candidate_arc_ranking'
                ? 'candidate_arc_ranker'
                : 'deterministic_candidate_arcs',
              selectedArcIds: arcSelection.selectedArcIds,
              candidateArcRankerFailureReason: arcSelection.fallbackReason ?? null
            }
            if (arcSelection.mode === 'deterministic_candidate_arcs') {
              agentFailureMetadata = {
                candidateArcRankerAttempted: true,
                candidateArcRankerFailureReason: arcSelection.fallbackReason ?? 'Unknown candidate arc ranking error',
                deterministicArcFallbackUsed: true
              }
            }
          }
        } catch (arcRankingError) {
          console.warn('Candidate arc ranking failed, falling back to legacy selection paths:', arcRankingError)
          agentFailureMetadata = {
            candidateArcRankerAttempted: true,
            candidateArcRankerFailureReason: arcRankingError instanceof Error
              ? arcRankingError.message
              : 'Unknown candidate arc ranking error'
          }
        }
      }

      if (!analysis && allowLegacyResolvedClipProposal) {
        try {
          postProgress(command.workflowJobId, currentStage, 10, 'Proposing resolved clip arcs...')

          const resolvedProposals = await activeAiService.proposeResolvedClips(
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
          console.warn('Resolved clip proposal failed:', resolvedProposalError)
          agentFailureMetadata = {
            ...agentFailureMetadata,
            agentAttempted: true,
            resolvedProposalFailureReason: resolvedProposalError instanceof Error
              ? resolvedProposalError.message
              : 'Unknown resolved clip proposal error'
          }
        }
      }

      if (!analysis && allowLegacyTranscriptLineAgent) {
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
          console.warn('Clip selection agent failed:', agentError)
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
        }
      }

      if (!analysis && allowLegacyBoundaryProposal) {
        try {
          postProgress(command.workflowJobId, currentStage, 10, 'AI proposing clip boundaries...')

          const proposedClips = await activeAiService.proposeBoundaries(
            transcription,
            command.mediaDuration,
            (progress) => {
              postProgress(command.workflowJobId, currentStage, progress * 0.5, 'AI proposing clip boundaries...')
            }
          )

          const validatedClips = proposedClips.filter((clip) => clip.validated)

          if (validatedClips.length >= 5) {
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

            const semanticReview = await finalClipValidationService.applySemanticBoundaryReview(transcription, analysis.potentialClips, activeAiService, command.mediaDuration)
            analysis = { potentialClips: semanticReview.clips }
            aiAnalysisSucceeded = true

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
            throw new Error(`Insufficient validated clips from boundary proposal: ${validatedClips.length}`)
          }
        } catch (boundaryError) {
          console.warn('AI boundary proposal failed or was insufficient:', boundaryError)
          agentFailureMetadata = {
            ...agentFailureMetadata,
            boundaryProposalFailureReason: boundaryError instanceof Error ? boundaryError.message : 'Unknown boundary proposal error'
          }
        }
      }

      if (!analysis && allowLegacyCandidateRanking) {
        try {
          postProgress(command.workflowJobId, currentStage, 55, 'Falling back to candidate ranking...')

          analysis = await activeAiService.analyzeTranscript(
            transcription,
            command.mediaDuration,
            candidates,
            (progress) => {
              postProgress(command.workflowJobId, currentStage, 55 + progress * 0.4, 'AI ranking candidates...')
            }
          )
          const semanticReview = await finalClipValidationService.applySemanticBoundaryReview(transcription, analysis.potentialClips, activeAiService, command.mediaDuration)
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
          console.warn('AI candidate ranking failed:', rankingError)
          agentFailureMetadata = {
            ...agentFailureMetadata,
            aiCandidateRankingFailureReason: rankingError instanceof Error ? rankingError.message : 'Unknown candidate ranking error'
          }
        }
      }

      if (!analysis && allowHeuristicSupplementation) {
        analysis = buildHeuristicAnalysis(candidates)
        const semanticReview = await finalClipValidationService.applySemanticBoundaryReview(transcription, analysis.potentialClips, null, command.mediaDuration)
        analysis = { potentialClips: semanticReview.clips }
        aiAnalysisSucceeded = false
        postProgress(command.workflowJobId, currentStage, 100, 'Legacy selector flags enabled. Using heuristic clip suggestions.')
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
          aiError: 'Legacy heuristic supplementation enabled'
        })
      }
    }
  }

  if (!analysis && candidateArcs.length > 0 && boundaryViableCandidateArcs.length === 0) {
    if (aiService) {
      try {
        postProgress(command.workflowJobId, currentStage, 55, 'Finding boundary-viable clips from transcript...')
        const resolvedProposals = await aiService.proposeResolvedClips(
          transcription,
          command.mediaDuration,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, 55 + progress * 0.35, 'Finding boundary-viable clips from transcript...')
          }
        )
        const resolvedClips = buildResolvedClipsFromProposals(
          transcription,
          resolvedProposals,
          command.mediaDuration
        )
        const resolvedRecoverySelection = buildResolvedClipRecoverySelection(
          resolvedClips.clips.slice(0, resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration)),
          selectionDecisions
        )
        analysis = { potentialClips: resolvedRecoverySelection.clips }
        selectionDecisions = resolvedRecoverySelection.decisions
        aiAnalysisSucceeded = resolvedRecoverySelection.clips.length > 0
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          selectionSource: 'resolved_clip_recovery',
          selectedArcIds: [],
          boundaryPreflightRejectedArcIds,
          resolvedClipRecoveryAttempted: true,
          resolvedClipRecoveryProposedCount: resolvedProposals.length,
          resolvedClipRecoveryUsableCount: resolvedClips.clips.length,
          resolvedClipRecoveryRejectedCount: resolvedClips.rejected.length,
          resolvedClipRecoveryRejectedPreview: resolvedClips.rejected.slice(0, 5)
        }
      } catch (resolvedSelectionError) {
        analysis = { potentialClips: [] }
        aiAnalysisSucceeded = false
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          selectedArcIds: [],
          boundaryPreflightRejectedArcIds,
          resolvedClipRecoveryAttempted: true,
          resolvedClipRecoveryFailureReason: resolvedSelectionError instanceof Error ? resolvedSelectionError.message : 'Unknown resolved clip recovery error'
        }
      }
    } else {
      analysis = { potentialClips: [] }
      aiAnalysisSucceeded = false
      clipSelectionSourceMetadata = {
        ...clipSelectionSourceMetadata,
        selectedArcIds: [],
        boundaryPreflightRejectedArcIds
      }
    }
  }

  if (!analysis) {
    throw new Error('Missing ranked clip analysis for pipeline resume')
  }

  if (analysis.potentialClips.length > 0) {
    postProgress(command.workflowJobId, currentStage, 98, 'Finalizing clip boundaries...')
    const selectedClipsBeforeBoundaryValidation = [...analysis.potentialClips]
    let boundaryFinalization = await finalClipValidationService.finalizeClipBoundaries(
      transcription,
      analysis.potentialClips,
      aiService,
      command.mediaDuration,
      semanticTranscriptSegments ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments) : undefined
    )
    const initialBoundaryFinalization = boundaryFinalization
    let fallbackBoundaryFinalization: Awaited<ReturnType<typeof finalClipValidationService.finalizeClipBoundaries>> | null = null
    let fallbackRecoverySelection: ReturnType<typeof buildFallbackArcRecoverySelection> | null = null
    let resolvedRecoveryFinalization: Awaited<ReturnType<typeof finalClipValidationService.finalizeClipBoundaries>> | null = null
    let resolvedRecoverySelection: ReturnType<typeof buildResolvedClipRecoverySelection> | null = null
    let decisionValidationSourceClips = selectedClipsBeforeBoundaryValidation
    let decisionValidationResult = initialBoundaryFinalization
    let recoveredFromBoundaryFallback = false

    if (boundaryFinalization.clips.length === 0 && boundaryViableCandidateArcs.length > 0) {
      fallbackRecoverySelection = buildFallbackArcRecoverySelection(boundaryViableCandidateArcs, selectionDecisions)
      fallbackBoundaryFinalization = await finalClipValidationService.finalizeClipBoundaries(
        transcription,
        fallbackRecoverySelection.clips,
        null,
        command.mediaDuration,
        semanticTranscriptSegments ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments) : undefined
      )

      if (fallbackBoundaryFinalization.clips.length > 0) {
        boundaryFinalization = fallbackBoundaryFinalization
        selectionDecisions = fallbackRecoverySelection.decisions
        decisionValidationSourceClips = fallbackRecoverySelection.clips
        decisionValidationResult = fallbackBoundaryFinalization
        recoveredFromBoundaryFallback = true
      }
    }

    if (boundaryFinalization.clips.length === 0 && aiService) {
      try {
        postProgress(command.workflowJobId, currentStage, 98, 'Recovering complete clip arcs from transcript...')
        const resolvedProposals = await aiService.proposeResolvedClips(
          transcription,
          command.mediaDuration,
          (progress) => {
            postProgress(command.workflowJobId, currentStage, Math.min(98 + progress * 0.01, 99), 'Recovering complete clip arcs from transcript...')
          }
        )
        const resolvedClips = buildResolvedClipsFromProposals(
          transcription,
          resolvedProposals,
          command.mediaDuration
        )
        resolvedRecoverySelection = buildResolvedClipRecoverySelection(
          resolvedClips.clips.slice(0, resolveArcTargetClipCount(command.runConfigSnapshot.maxClipsPerEpisode, command.mediaDuration)),
          selectionDecisions
        )
        resolvedRecoveryFinalization = await finalClipValidationService.finalizeClipBoundaries(
          transcription,
          resolvedRecoverySelection.clips,
          aiService,
          command.mediaDuration,
          semanticTranscriptSegments ? buildTranscriptBoundaryLinesFromSegments(semanticTranscriptSegments) : undefined
        )

        if (resolvedRecoveryFinalization.clips.length > 0) {
          boundaryFinalization = resolvedRecoveryFinalization
          selectionDecisions = resolvedRecoverySelection.decisions
          decisionValidationSourceClips = resolvedRecoverySelection.clips
          decisionValidationResult = resolvedRecoveryFinalization
          recoveredFromBoundaryFallback = true
          clipSelectionSourceMetadata = {
            ...clipSelectionSourceMetadata,
            selectionSource: 'resolved_clip_recovery',
            resolvedClipRecoveryAttempted: true,
            resolvedClipRecoveryProposedCount: resolvedProposals.length,
            resolvedClipRecoveryUsableCount: resolvedClips.clips.length,
            resolvedClipRecoveryRejectedCount: resolvedClips.rejected.length,
            resolvedClipRecoveryRejectedPreview: resolvedClips.rejected.slice(0, 5)
          }
        } else {
          clipSelectionSourceMetadata = {
            ...clipSelectionSourceMetadata,
            resolvedClipRecoveryAttempted: true,
            resolvedClipRecoveryProposedCount: resolvedProposals.length,
            resolvedClipRecoveryUsableCount: resolvedClips.clips.length,
            resolvedClipRecoveryRejectedCount: resolvedClips.rejected.length,
            resolvedClipRecoveryRejectedPreview: resolvedClips.rejected.slice(0, 5)
          }
        }
      } catch (resolvedRecoveryError) {
        clipSelectionSourceMetadata = {
          ...clipSelectionSourceMetadata,
          resolvedClipRecoveryAttempted: true,
          resolvedClipRecoveryFailureReason: resolvedRecoveryError instanceof Error ? resolvedRecoveryError.message : 'Unknown resolved clip recovery error'
        }
      }
    }

    selectionDecisions = applyFinalClipValidationToSelectionDecisions(
      selectionDecisions,
      decisionValidationSourceClips,
      decisionValidationResult,
      recoveredFromBoundaryFallback
    )
    const overlapSuppression = suppressOverlappingFinalClips(boundaryFinalization.clips)
    analysis = { potentialClips: overlapSuppression.clips }

    postStageCompleted(command.workflowJobId, 'clip_ranking', {
      clipCount: analysis.potentialClips.length,
      mode: 'final_boundary_refinement',
      aiAnalysisSucceeded,
      selectionDecisions,
      selectedClipPreview: analysis.potentialClips.slice(0, 5).map((clip) => ({
        id: clip.id,
        startTime: clip.startTime,
        endTime: clip.endTime,
        shareabilityScore: clip.shareabilityScore
      })),
      metadata: {
        executor: 'final_boundary_refiner',
        boundaryRefinementVersion: 'final_clip_validator_v1',
        ...clipSelectionSourceMetadata,
        editorialUnitBuilderVersion: 'editorial_units_v1',
        candidateArcGeneratorVersion: 'candidate_arcs_v1',
        editorialUnits: summarizeEditorialUnits(editorialUnits),
        candidateArcs: summarizeCandidateArcs(candidateArcs),
        reviewedClipCount: boundaryFinalization.semanticReview.reviews.length,
        semanticBoundaryReviewUsedAI: boundaryFinalization.semanticReview.usedAI,
        transcriptLineCount: boundaryFinalization.semanticReview.transcriptLineCount,
        semanticBoundaryReviewFallbackReason: boundaryFinalization.semanticReview.fallbackReason,
        wordBoundaryAdjustmentCount: boundaryFinalization.wordAdjustments.filter((adjustment) => adjustment.changed).length,
        finalBoundaryValidatorAcceptedCount: boundaryFinalization.validatorDecisions.filter((decision) => decision.status === 'accepted').length,
        finalBoundaryValidatorRejectedCount: boundaryFinalization.rejectedClips.length,
        coherentRoughCutsReport: boundaryFinalization.boundaryRepairReport,
        fallbackBoundaryRecoveryAttempted: Boolean(fallbackBoundaryFinalization),
        fallbackBoundaryRecoverySucceeded: Boolean(fallbackBoundaryFinalization && fallbackBoundaryFinalization.clips.length > 0),
        fallbackBoundaryRecoveredArcIds: fallbackBoundaryFinalization && fallbackBoundaryFinalization.clips.length > 0
          ? fallbackBoundaryFinalization.clips.map((clip) => clip.sourceArcId).filter(Boolean)
          : undefined,
        resolvedClipRecoveryAttempted: Boolean(resolvedRecoveryFinalization || clipSelectionSourceMetadata.resolvedClipRecoveryAttempted),
        resolvedClipRecoverySucceeded: Boolean(resolvedRecoveryFinalization && resolvedRecoveryFinalization.clips.length > 0),
        overlapSuppressedClipCount: overlapSuppression.suppressed.length,
        overlapSuppressedClipPreview: overlapSuppression.suppressed.slice(0, 5).map((clip) => ({
          id: clip.id,
          sourceArcId: clip.sourceArcId,
          startTime: clip.startTime,
          endTime: clip.endTime,
          shareabilityScore: clip.shareabilityScore
        })),
        initialFinalBoundaryRejectedCount: fallbackBoundaryFinalization ? initialBoundaryFinalization.rejectedClips.length : undefined,
        reviewPreview: boundaryFinalization.semanticReview.reviews.slice(0, 5),
        wordAdjustmentPreview: boundaryFinalization.wordAdjustments.slice(0, 5),
        finalBoundaryValidatorPreview: boundaryFinalization.validatorDecisions.slice(0, 5),
        finalBoundaryRejectedPreview: boundaryFinalization.rejectedClips.slice(0, 5)
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
    editorialUnits,
    candidateArcs,
    selectionDecisions,
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
