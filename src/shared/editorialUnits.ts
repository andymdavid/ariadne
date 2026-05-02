import {
  getLeadingBoundaryIssue,
  getTrailingBoundaryIssue,
  looksLikeCompleteThought,
  normalizeTranscriptText,
  startsLikeContinuation
} from './clipBoundaryQuality'

export type TimelineWord = {
  word: string
  start: number
  end: number
  segmentId?: number | string
  wordIndex: number
}

export type EditorialUnitRole =
  | 'hook'
  | 'setup'
  | 'claim'
  | 'example'
  | 'escalation'
  | 'payoff'
  | 'transition'
  | 'aside'
  | 'filler'

export type EditorialUnitSource = 'deterministic' | 'ai_refined' | 'manual'

export type EditorialUnit = {
  id: string
  episodeId?: string
  startWordIndex: number
  endWordIndex: number
  startTime: number
  endTime: number
  text: string
  speakerId?: string
  topicId?: string
  role: EditorialUnitRole
  startsCleanly: boolean
  endsCleanly: boolean
  continuesPrevious: boolean
  continuesNext: boolean
  pauseBeforeSeconds: number | null
  pauseAfterSeconds: number | null
  audioEnergy: number | null
  speechRate: number
  confidence: number
  source: EditorialUnitSource
  diagnostics: {
    leadingBoundaryIssue: string | null
    trailingBoundaryIssue: string | null
    forcedBreak: boolean
    wordCount: number
  }
}

export type CandidateArcScore = {
  hookStrength: number
  contextIndependence: number
  narrativeFlow: number
  payoffStrength: number
  density: number
  novelty: number
  audioBoundaryQuality: number
  emotionalEnergy: number
  visualSuitability: number
  captionQuality: number
  durationFit: number
  overall: number
}

export type CandidateArc = {
  id: string
  unitIds: string[]
  startWordIndex: number
  endWordIndex: number
  startTime: number
  endTime: number
  duration: number
  topic: string
  summary: string
  hookText: string
  payoffText: string
  keyQuote: string
  scores: CandidateArcScore
  diagnostics: Record<string, unknown>
}

export type EditorialUnitSegmentInput = {
  id: number | string
  start: number
  end: number
  text: string
  words?: Array<{
    word: string
    start: number
    end: number
  }>
}

export type BuildEditorialUnitsOptions = {
  episodeId?: string
}

const HARD_PAUSE_SECONDS = 1.1
const SOFT_PAUSE_SECONDS = 0.45
const PREFERRED_MAX_DURATION_SECONDS = 26
const PREFERRED_MAX_WORDS = 86
const ABSOLUTE_MAX_DURATION_SECONDS = 42
const ABSOLUTE_MAX_WORDS = 140

const terminalPunctuationPattern = /[.!?]["']?\s*$/

const cleanWord = (word: string) => String(word ?? '').trim()

const normalizeUnitText = (text: string) => normalizeTranscriptText(text)

const synthesizeWordsForSegment = (
  segment: EditorialUnitSegmentInput,
  startingWordIndex: number
): TimelineWord[] => {
  const words = String(segment.text || '').split(/\s+/).map(cleanWord).filter(Boolean)
  if (!words.length) return []

  const duration = Math.max(0.01, Number(segment.end) - Number(segment.start))
  const wordDuration = duration / words.length

  return words.map((word, index) => ({
    word,
    start: Number(segment.start) + wordDuration * index,
    end: Number(segment.start) + wordDuration * (index + 1),
    segmentId: segment.id,
    wordIndex: startingWordIndex + index
  }))
}

export const buildTimelineWords = (segments: EditorialUnitSegmentInput[]): TimelineWord[] => {
  const words: TimelineWord[] = []

  for (const segment of segments) {
    if (Array.isArray(segment.words) && segment.words.length > 0) {
      for (const word of segment.words) {
        const text = cleanWord(word.word)
        const start = Number(word.start)
        const end = Number(word.end)
        if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue

        words.push({
          word: text,
          start,
          end,
          segmentId: segment.id,
          wordIndex: words.length
        })
      }
      continue
    }

    words.push(...synthesizeWordsForSegment(segment, words.length))
  }

  return words
    .sort((left, right) => left.start - right.start)
    .map((word, index) => ({
      ...word,
      wordIndex: index
    }))
}

const textFromWords = (words: TimelineWord[]) => normalizeUnitText(words.map((word) => word.word).join(' '))

const getPause = (left: TimelineWord | undefined, right: TimelineWord | undefined) => {
  if (!left || !right) return null
  return Math.max(0, Number((right.start - left.end).toFixed(3)))
}

const textEndsWithTerminalPunctuation = (text: string) => terminalPunctuationPattern.test(text.trim())

const looksLikeQuestion = (text: string) =>
  /\b(why|what|how|when|where|who|should|could|would|do you|can you)\b/i.test(text)

const classifyRole = (
  text: string,
  startsCleanly: boolean,
  endsCleanly: boolean,
  leadingIssue: string | null
): EditorialUnitRole => {
  const normalized = text.toLowerCase()
  const wordCount = text.split(/\s+/).filter(Boolean).length

  if (leadingIssue === 'leading_repair_aside' || leadingIssue === 'leading_aside' || /\b(who knows|either way|i'?m sorry|sorry)\b/.test(normalized)) {
    return 'aside'
  }

  if (wordCount <= 5 || /^(yeah|yep|yes|no|right|okay|ok|well|like)\b/.test(normalized)) {
    return 'filler'
  }

  if (/\b(this is the conversation|part of the problem|moving on|anyway|let'?s talk)\b/.test(normalized)) {
    return 'transition'
  }

  if (endsCleanly && /\b(therefore|that'?s why|that'?s how|so that'?s|the point is|the takeaway|bottom line|you need to|we should|we shouldn'?t|don'?t need to)\b/.test(normalized)) {
    return 'payoff'
  }

  if (/\b(for example|for instance|like when|it'?s like|because|if you|when you)\b/.test(normalized)) {
    return 'example'
  }

  if (/\b(but|however|whereas|instead|the problem|the question|regulatory|capture|evil|ridiculous)\b/.test(normalized)) {
    return 'escalation'
  }

  if (startsCleanly && (looksLikeQuestion(text) || /\b(you need|you should|you can|i think|the thing is|what you have)\b/.test(normalized))) {
    return 'hook'
  }

  return 'claim'
}

const shouldBreakUnit = (
  currentWords: TimelineWord[],
  nextWord: TimelineWord | undefined
) => {
  if (!currentWords.length) return false
  if (!nextWord) return true

  const currentText = textFromWords(currentWords)
  const duration = currentWords[currentWords.length - 1].end - currentWords[0].start
  const wordCount = currentWords.length
  const pauseAfter = getPause(currentWords[currentWords.length - 1], nextWord) ?? 0
  const trailingIssue = getTrailingBoundaryIssue(currentText)
  const complete = looksLikeCompleteThought(currentText)
  const nextContinues = startsLikeContinuation(nextWord.word)

  if (trailingIssue) {
    return false
  }

  if (pauseAfter >= HARD_PAUSE_SECONDS && complete) {
    return true
  }

  if (textEndsWithTerminalPunctuation(currentText) && !nextContinues) {
    return true
  }

  if (pauseAfter >= SOFT_PAUSE_SECONDS && complete && !nextContinues) {
    return true
  }

  if ((duration >= PREFERRED_MAX_DURATION_SECONDS || wordCount >= PREFERRED_MAX_WORDS) && complete && !nextContinues) {
    return true
  }

  if (duration >= ABSOLUTE_MAX_DURATION_SECONDS || wordCount >= ABSOLUTE_MAX_WORDS) {
    return complete
  }

  return false
}

const buildUnit = (
  id: number,
  words: TimelineWord[],
  previousWord: TimelineWord | undefined,
  nextWord: TimelineWord | undefined,
  options: BuildEditorialUnitsOptions
): EditorialUnit => {
  const text = textFromWords(words)
  const leadingIssue = getLeadingBoundaryIssue(text)
  const trailingIssue = getTrailingBoundaryIssue(text)
  const startsCleanly = leadingIssue === null
  const endsCleanly = trailingIssue === null && looksLikeCompleteThought(text)
  const pauseBeforeSeconds = getPause(previousWord, words[0])
  const pauseAfterSeconds = getPause(words[words.length - 1], nextWord)
  const continuesPrevious =
    Boolean(leadingIssue) ||
    (pauseBeforeSeconds !== null && pauseBeforeSeconds < SOFT_PAUSE_SECONDS && startsLikeContinuation(text))
  const continuesNext =
    Boolean(trailingIssue) ||
    Boolean(nextWord && pauseAfterSeconds !== null && pauseAfterSeconds < SOFT_PAUSE_SECONDS && startsLikeContinuation(nextWord.word))
  const duration = Math.max(0.01, words[words.length - 1].end - words[0].start)
  const speechRate = Number((words.length / duration).toFixed(3))
  const forcedBreak = !endsCleanly
  const confidence = Number(Math.max(0.25, Math.min(0.98, 0.72 + (startsCleanly ? 0.08 : -0.1) + (endsCleanly ? 0.12 : -0.14) + (forcedBreak ? -0.12 : 0))).toFixed(3))

  return {
    id: `unit_${id + 1}`,
    episodeId: options.episodeId,
    startWordIndex: words[0].wordIndex,
    endWordIndex: words[words.length - 1].wordIndex,
    startTime: Number(words[0].start.toFixed(3)),
    endTime: Number(words[words.length - 1].end.toFixed(3)),
    text,
    role: classifyRole(text, startsCleanly, endsCleanly, leadingIssue),
    startsCleanly,
    endsCleanly,
    continuesPrevious,
    continuesNext,
    pauseBeforeSeconds,
    pauseAfterSeconds,
    audioEnergy: null,
    speechRate,
    confidence,
    source: 'deterministic',
    diagnostics: {
      leadingBoundaryIssue: leadingIssue,
      trailingBoundaryIssue: trailingIssue,
      forcedBreak,
      wordCount: words.length
    }
  }
}

export const buildEditorialUnits = (
  segments: EditorialUnitSegmentInput[],
  options: BuildEditorialUnitsOptions = {}
): EditorialUnit[] => {
  const words = buildTimelineWords(segments)
  if (!words.length) return []

  const units: EditorialUnit[] = []
  let currentWords: TimelineWord[] = []

  for (let index = 0; index < words.length; index += 1) {
    currentWords.push(words[index])

    if (!shouldBreakUnit(currentWords, words[index + 1])) {
      continue
    }

    const previousWord = words[currentWords[0].wordIndex - 1]
    const nextWord = words[index + 1]
    units.push(buildUnit(units.length, currentWords, previousWord, nextWord, options))
    currentWords = []
  }

  if (currentWords.length > 0) {
    const lastWord = currentWords[currentWords.length - 1]
    const previousWord = words[currentWords[0].wordIndex - 1]
    const nextWord = words[lastWord.wordIndex + 1]
    units.push(buildUnit(units.length, currentWords, previousWord, nextWord, options))
  }

  return units.filter((unit) => unit.text.trim())
}

export const summarizeEditorialUnits = (units: EditorialUnit[]) => ({
  unitCount: units.length,
  cleanStartCount: units.filter((unit) => unit.startsCleanly).length,
  cleanEndCount: units.filter((unit) => unit.endsCleanly).length,
  roleCounts: units.reduce<Record<string, number>>((counts, unit) => {
    counts[unit.role] = (counts[unit.role] ?? 0) + 1
    return counts
  }, {}),
  forcedBreakCount: units.filter((unit) => unit.diagnostics.forcedBreak).length,
  preview: units.slice(0, 8).map((unit) => ({
    id: unit.id,
    startTime: unit.startTime,
    endTime: unit.endTime,
    role: unit.role,
    startsCleanly: unit.startsCleanly,
    endsCleanly: unit.endsCleanly,
    continuesPrevious: unit.continuesPrevious,
    continuesNext: unit.continuesNext,
    text: unit.text
  }))
})
