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
  sourceStrategy: 'word_thought_lines_v1' | 'segment_fallback_lines_v1'
}

const HARD_BREAK_GAP_SECONDS = 1.1
const SOFT_BREAK_GAP_SECONDS = 0.42
const MICRO_BREAK_GAP_SECONDS = 0.2
const TERMINAL_PUNCTUATION_BREAK_GAP_SECONDS = 0.14
const PREFERRED_MAX_DURATION_SECONDS = 10
const PREFERRED_MAX_WORDS = 36
const ABSOLUTE_MAX_DURATION_SECONDS = 16
const ABSOLUTE_MAX_WORDS = 56

const CONTINUATION_WORD_PATTERN =
  /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i

const normalizeLineText = (text: string) =>
  text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

const endsWithTerminalPunctuation = (text: string) => /[.!?]["']?\s*$/.test(text.trim())

const endsWithDanglingPhrase = (text: string) => {
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

const looksLikeCompleteThought = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (endsWithDanglingPhrase(trimmed)) return false
  if (endsWithTerminalPunctuation(trimmed)) return true
  return trimmed.split(/\s+/).filter(Boolean).length >= 10
}

const startsLikeContinuation = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return false
  return CONTINUATION_WORD_PATTERN.test(trimmed)
}

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
      sourceStrategy: 'segment_fallback_lines_v1' as const
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

    lines.push({
      lineIndex: lines.length,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: normalizeLineText(currentWords.map((item) => item.word).join(' ')),
      words: [...currentWords],
      sourceStrategy: 'word_thought_lines_v1'
    })
    currentWords = []
  }

  if (currentWords.length > 0) {
    lines.push({
      lineIndex: lines.length,
      start: currentWords[0].start,
      end: currentWords[currentWords.length - 1].end,
      text: normalizeLineText(currentWords.map((item) => item.word).join(' ')),
      words: [...currentWords],
      sourceStrategy: 'word_thought_lines_v1'
    })
  }

  return lines.filter((line) => line.text.trim())
}
