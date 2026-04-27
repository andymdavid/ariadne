import {
  endsWithTerminalPunctuation,
  looksLikeCompleteThought,
  normalizeTranscriptText,
  startsLikeContinuation
} from './clipBoundaryQuality'

export type TranscriptLineWord = {
  word: string
  start: number
  end: number
}

export type TranscriptLineSegmentInput = {
  id: number | string
  start: number
  end: number
  text: string
  words?: TranscriptLineWord[]
}

export type TranscriptLineDraft = {
  lineIndex: number
  start: number
  end: number
  text: string
  words: TranscriptLineWord[]
  sourceStrategy: 'word_thought_lines_v1' | 'word_forced_lines_v1' | 'segment_fallback_lines_v1'
  boundaryQuality: {
    cleanStart: boolean
    cleanEnd: boolean
    forcedBreak: boolean
  }
}

const HARD_BREAK_GAP_SECONDS = 1.1
const SOFT_BREAK_GAP_SECONDS = 0.42
const MICRO_BREAK_GAP_SECONDS = 0.2
const TERMINAL_PUNCTUATION_BREAK_GAP_SECONDS = 0.14
const PREFERRED_MAX_DURATION_SECONDS = 10
const PREFERRED_MAX_WORDS = 36
const ABSOLUTE_MAX_DURATION_SECONDS = 16
const ABSOLUTE_MAX_WORDS = 56

const normalizeLineText = normalizeTranscriptText

const buildBoundaryQuality = (text: string, forcedBreak: boolean) => ({
  cleanStart: !startsLikeContinuation(text),
  cleanEnd: looksLikeCompleteThought(text) && !forcedBreak,
  forcedBreak
})

const flattenWords = (segments: TranscriptLineSegmentInput[]) =>
  segments
    .flatMap((segment) => segment.words ?? [])
    .map((word) => ({
      word: String(word.word ?? '').trim(),
      start: Number(word.start ?? 0),
      end: Number(word.end ?? 0)
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
    .sort((left, right) => left.start - right.start)

const buildSegmentFallbackLines = (segments: TranscriptLineSegmentInput[]): TranscriptLineDraft[] =>
  segments
    .filter((segment) => segment.text.trim())
    .sort((left, right) => left.start - right.start)
    .map((segment, index) => ({
      lineIndex: index,
      start: segment.start,
      end: segment.end,
      text: normalizeLineText(segment.text),
      words: (segment.words ?? []).map((word) => ({
        word: String(word.word ?? '').trim(),
        start: Number(word.start ?? segment.start),
        end: Number(word.end ?? segment.end)
      })),
      sourceStrategy: 'segment_fallback_lines_v1' as const,
      boundaryQuality: buildBoundaryQuality(segment.text, false)
    }))

const shouldBreakLine = (
  currentWords: TranscriptLineWord[],
  nextWord: TranscriptLineWord | undefined
) => {
  if (!currentWords.length) return false
  if (!nextWord) return true

  const currentText = normalizeLineText(currentWords.map((word) => word.word).join(' '))
  const currentDuration = currentWords[currentWords.length - 1].end - currentWords[0].start
  const currentWordCount = currentWords.length
  const gap = Math.max(0, nextWord.start - currentWords[currentWords.length - 1].end)
  const currentLooksComplete = looksLikeCompleteThought(currentText)
  const nextLooksContinuous = startsLikeContinuation(nextWord.word)

  if (gap >= HARD_BREAK_GAP_SECONDS && currentLooksComplete) {
    return true
  }

  if (
    endsWithTerminalPunctuation(currentText) &&
    (gap >= TERMINAL_PUNCTUATION_BREAK_GAP_SECONDS || !nextLooksContinuous)
  ) {
    return true
  }

  if (
    gap >= SOFT_BREAK_GAP_SECONDS &&
    currentLooksComplete &&
    !nextLooksContinuous
  ) {
    return true
  }

  if (
    (currentDuration >= PREFERRED_MAX_DURATION_SECONDS || currentWordCount >= PREFERRED_MAX_WORDS) &&
    currentLooksComplete &&
    !nextLooksContinuous
  ) {
    return true
  }

  if (
    gap >= MICRO_BREAK_GAP_SECONDS &&
    currentWordCount >= 18 &&
    currentDuration >= 6 &&
    currentLooksComplete
  ) {
    return true
  }

  if (
    currentDuration >= 8 &&
    currentWordCount >= 24 &&
    currentLooksComplete &&
    !nextLooksContinuous
  ) {
    return true
  }

  if (currentDuration >= ABSOLUTE_MAX_DURATION_SECONDS || currentWordCount >= ABSOLUTE_MAX_WORDS) {
    return true
  }

  return false
}

export const buildTranscriptLinesFromSegments = (
  segments: TranscriptLineSegmentInput[]
): TranscriptLineDraft[] => {
  const words = flattenWords(segments)
  if (words.length === 0) {
    return buildSegmentFallbackLines(segments)
  }

  const lines: TranscriptLineDraft[] = []
  let currentWords: TranscriptLineWord[] = []

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    currentWords.push(word)

    if (!shouldBreakLine(currentWords, words[index + 1])) {
      continue
    }

    const text = normalizeLineText(currentWords.map((item) => item.word).join(' '))
    const forcedBreak = !looksLikeCompleteThought(text)
    lines.push({
      lineIndex: lines.length,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text,
      words: [...currentWords],
      sourceStrategy: forcedBreak ? 'word_forced_lines_v1' : 'word_thought_lines_v1',
      boundaryQuality: buildBoundaryQuality(text, forcedBreak)
    })
    currentWords = []
  }

  if (currentWords.length > 0) {
    const text = normalizeLineText(currentWords.map((item) => item.word).join(' '))
    const forcedBreak = !looksLikeCompleteThought(text)
    lines.push({
      lineIndex: lines.length,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text,
      words: [...currentWords],
      sourceStrategy: forcedBreak ? 'word_forced_lines_v1' : 'word_thought_lines_v1',
      boundaryQuality: buildBoundaryQuality(text, forcedBreak)
    })
  }

  return lines.filter((line) => line.text.trim())
}
