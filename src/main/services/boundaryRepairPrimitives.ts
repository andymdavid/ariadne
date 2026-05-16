import {
  endsWithDanglingPhrase,
  endsWithTerminalPunctuation,
  getLeadingBoundaryIssue,
  looksLikeCompleteThought,
  startsLikeContinuation,
  stripLeadingBoundaryFiller
} from '../../shared/clipBoundaryQuality'
import type {
  PipelineWorkerPotentialClip,
  PipelineWorkerTranscription,
  PipelineWorkerWord
} from '@shared/types/pipelineWorker'

export const DEFAULT_BOUNDARY_GUARD_SECONDS = 0.04
export const DEFAULT_THOUGHT_HARD_BREAK_SECONDS = 1.1

type TimedSpan = {
  startTime: number
  endTime: number
}

export function getWordsWithinWindow(
  transcription: PipelineWorkerTranscription,
  startTime: number,
  endTime: number
): PipelineWorkerWord[] {
  return transcription.segments
    .flatMap((segment) => segment.words ?? [])
    .filter((word) =>
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start &&
      word.end > startTime &&
      word.start < endTime &&
      String(word.word ?? '').trim().length > 0
    )
    .map((word) => ({
      word: String(word.word ?? '').trim(),
      start: Number(word.start),
      end: Number(word.end)
    }))
    .sort((left, right) => left.start - right.start)
}

export function wordsToText(words: PipelineWorkerWord[]) {
  return words.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
}

export function extractTextFromWordsOrSegments(
  transcription: PipelineWorkerTranscription,
  startTime: number,
  endTime: number
) {
  const words = getWordsWithinWindow(transcription, startTime, endTime)
  if (words.length > 0) {
    return wordsToText(words)
  }

  return transcription.segments
    .filter((segment) => segment.end > startTime && segment.start < endTime)
    .map((segment) => segment.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function buildClipWindowTextFromWords(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip
) {
  return extractTextFromWordsOrSegments(transcription, clip.startTime, clip.endTime)
}

export function isRecoverableLeadInStart(text: string) {
  const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase()
  return /^(and\s+i\s+(think|mean|guess|would|can|was|have)|and\s+so\b|but\s+i\b)/.test(normalized)
}

export function shouldContinueThoughtAcrossBoundary(
  currentText: string,
  nextText: string,
  gap: number,
  hardBreakSeconds = DEFAULT_THOUGHT_HARD_BREAK_SECONDS
) {
  if (gap >= hardBreakSeconds) {
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

export function endsWithConversationalAcknowledgementBeforeContinuation(
  currentText: string,
  nextText: string,
  gap: number,
  hardBreakSeconds = DEFAULT_THOUGHT_HARD_BREAK_SECONDS
) {
  if (gap >= hardBreakSeconds) {
    return false
  }

  const current = currentText.trim().toLowerCase()
  const next = stripLeadingBoundaryFiller(nextText).trim()
  if (!current || !next) {
    return false
  }

  return /\b(yeah|yep|yes|right|okay|ok)\s*$/i.test(current)
}

export function getStartLookbackIssue(input: {
  transcription: PipelineWorkerTranscription
  span: TimedSpan
  lookbackSeconds: number
  guardSeconds?: number
  hardBreakSeconds?: number
}) {
  const guardSeconds = input.guardSeconds ?? DEFAULT_BOUNDARY_GUARD_SECONDS
  const hardBreakSeconds = input.hardBreakSeconds ?? DEFAULT_THOUGHT_HARD_BREAK_SECONDS
  const words = getWordsWithinWindow(
    input.transcription,
    Math.max(0, input.span.startTime - input.lookbackSeconds),
    Math.min(input.span.endTime, input.span.startTime + 4)
  )
  const previousWords = words.filter((word) => word.end <= input.span.startTime + guardSeconds).slice(-8)
  const nextWords = words.filter((word) => word.start >= input.span.startTime - guardSeconds).slice(0, 8)

  if (previousWords.length === 0 || nextWords.length === 0) {
    return null
  }

  const gap = nextWords[0].start - previousWords[previousWords.length - 1].end
  if (gap >= hardBreakSeconds) {
    return null
  }

  return shouldContinueThoughtAcrossBoundary(wordsToText(previousWords), wordsToText(nextWords), gap, hardBreakSeconds)
    ? 'leading_continues_previous_thought'
    : null
}

export function getEndLookaheadIssue(input: {
  transcription: PipelineWorkerTranscription
  span: TimedSpan
  lookaheadSeconds: number
  guardSeconds?: number
  hardBreakSeconds?: number
}) {
  const guardSeconds = input.guardSeconds ?? DEFAULT_BOUNDARY_GUARD_SECONDS
  const hardBreakSeconds = input.hardBreakSeconds ?? DEFAULT_THOUGHT_HARD_BREAK_SECONDS
  const mediaEnd = input.transcription.segments[input.transcription.segments.length - 1]?.end ?? input.span.endTime + input.lookaheadSeconds
  const words = getWordsWithinWindow(
    input.transcription,
    Math.max(0, input.span.endTime - 3),
    Math.min(input.span.endTime + input.lookaheadSeconds, mediaEnd)
  )
  const previousWords = words.filter((word) => word.end <= input.span.endTime + guardSeconds).slice(-6)
  const nextWords = words.filter((word) => word.start > input.span.endTime - guardSeconds).slice(0, 6)

  if (previousWords.length === 0 || nextWords.length === 0) {
    return null
  }

  const gap = nextWords[0].start - previousWords[previousWords.length - 1].end
  if (gap >= hardBreakSeconds) {
    return null
  }

  const previousText = wordsToText(previousWords)
  const nextText = wordsToText(nextWords)
  const joined = wordsToText([...previousWords, ...nextWords]).toLowerCase()

  return (
    /\b(depending on|based on|because of|in terms of|when it comes to|as a result of|one of|part of)\s+(the|a|an|this|that|these|those|my|your|our|their)?\s*\w+\s+\w+/.test(joined) ||
    endsWithConversationalAcknowledgementBeforeContinuation(previousText, nextText, gap, hardBreakSeconds) ||
    shouldContinueThoughtAcrossBoundary(previousText, nextText, gap, hardBreakSeconds)
  )
    ? 'lookahead_continues_current_ending'
    : null
}

export function getClipLeadingWords(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip,
  wordCount = 8
) {
  return getWordsWithinWindow(
    transcription,
    Math.max(0, clip.startTime - 0.05),
    Math.min(clip.endTime, clip.startTime + 6)
  ).slice(0, wordCount)
}

export function getClipOpeningPreview(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip,
  wordCount = 12
) {
  return wordsToText(getClipLeadingWords(transcription, clip, wordCount))
}

export function getClipStartBoundaryIssue(
  transcription: PipelineWorkerTranscription,
  clip: PipelineWorkerPotentialClip
) {
  const openingPreview = getClipOpeningPreview(transcription, clip)
  const issue = getLeadingBoundaryIssue(openingPreview)
  if (issue === 'leading_continuation' && isRecoverableLeadInStart(openingPreview)) {
    return null
  }
  return issue
}

export function resolveClipEndWithTrailingPad(input: {
  words: PipelineWorkerWord[]
  wordIndex: number
  mediaDuration: number
  trailingPadSeconds: number
  maxTrailingPadSeconds: number
  guardSeconds: number
}) {
  const word = input.words[input.wordIndex]
  const nextWord = input.words[input.wordIndex + 1]
  const gapToNextWord = nextWord ? nextWord.start - word.end : Number.POSITIVE_INFINITY
  const trailingPad = Math.min(
    input.maxTrailingPadSeconds,
    gapToNextWord >= input.trailingPadSeconds
      ? Math.max(input.trailingPadSeconds, gapToNextWord * 0.6)
      : input.trailingPadSeconds
  )

  let endTime = Math.min(input.mediaDuration, word.end + trailingPad)
  if (nextWord) {
    endTime = Math.min(endTime, Math.max(word.end, nextWord.start - input.guardSeconds))
  }

  return endTime
}
