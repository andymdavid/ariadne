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

export type GenerateCandidateArcsOptions = {
  minDurationSeconds?: number
  maxDurationSeconds?: number
  maxArcs?: number
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

const clampScore = (score: number) => Number(Math.max(0, Math.min(1, score)).toFixed(3))

const getDurationFit = (duration: number) => {
  if (duration < 25 || duration > 120) return 0
  if (duration >= 35 && duration <= 85) return 1
  if (duration < 35) return clampScore((duration - 25) / 10)
  return clampScore(1 - (duration - 85) / 35)
}

const getTextDensity = (text: string, duration: number) => {
  const words = text.split(/\s+/).filter(Boolean)
  if (!words.length || duration <= 0) return 0
  const wordsPerSecond = words.length / duration
  return clampScore((wordsPerSecond - 1.2) / 1.25)
}

const hasHookLanguage = (text: string) =>
  /\b(why|what|how|should|need|problem|question|if you|when you|the thing is|the point|actually|ridiculous|different|control|own)\b/i.test(text)

const hasPayoffLanguage = (text: string) =>
  /\b(therefore|that'?s why|that'?s how|so that'?s|the point is|bottom line|you need to|we should|we shouldn'?t|don'?t need to|that'?s ridiculous|you can|you won'?t|operate|controls|own that)\b/i.test(text)

const summarizeArcTopic = (units: EditorialUnit[]) => {
  const text = units.map((unit) => unit.text).join(' ').toLowerCase()
  if (/\b(claude|anthropic|model|ai|agent|agents)\b/.test(text)) return 'AI workflow ownership'
  if (/\b(business|small business|operate|processes)\b/.test(text)) return 'business operations'
  if (/\b(software|workflow|scripts|system)\b/.test(text)) return 'software systems'
  return 'general insight'
}

const summarizeArc = (units: EditorialUnit[]) => {
  const firstClaim = units.find((unit) => ['hook', 'claim', 'payoff'].includes(unit.role))
  return firstClaim?.text.slice(0, 180) ?? units[0]?.text.slice(0, 180) ?? ''
}

const getKeyQuote = (units: EditorialUnit[]) => {
  const bestUnit = units
    .filter((unit) => unit.role !== 'filler' && unit.role !== 'transition')
    .sort((left, right) => {
      const rightScore = (right.role === 'payoff' ? 2 : 0) + (right.role === 'claim' ? 1 : 0) + right.confidence
      const leftScore = (left.role === 'payoff' ? 2 : 0) + (left.role === 'claim' ? 1 : 0) + left.confidence
      return rightScore - leftScore
    })[0]

  return bestUnit?.text.slice(0, 220) ?? units.map((unit) => unit.text).join(' ').slice(0, 220)
}

const scoreCandidateArc = (units: EditorialUnit[], duration: number): CandidateArcScore => {
  const text = units.map((unit) => unit.text).join(' ')
  const firstUnit = units[0]
  const lastUnit = units[units.length - 1]
  const meaningfulUnits = units.filter((unit) => unit.role !== 'filler' && unit.role !== 'transition')
  const payoffUnits = units.filter((unit) => unit.role === 'payoff')
  const asideRatio = units.filter((unit) => unit.role === 'aside' || unit.role === 'filler').length / Math.max(1, units.length)

  const hookStrength = clampScore(
    (firstUnit.startsCleanly ? 0.35 : 0) +
    (['hook', 'claim', 'escalation'].includes(firstUnit.role) ? 0.3 : 0) +
    (hasHookLanguage(firstUnit.text) ? 0.25 : 0) +
    (firstUnit.continuesPrevious ? -0.25 : 0) +
    (firstUnit.role === 'aside' || firstUnit.role === 'filler' ? -0.35 : 0)
  )

  const contextIndependence = clampScore(
    (firstUnit.startsCleanly ? 0.35 : 0) +
    (!firstUnit.continuesPrevious ? 0.35 : 0) +
    (asideRatio <= 0.25 ? 0.2 : -0.2) +
    (/\b(this|that|those|they|he|she)\b/i.test(firstUnit.text.split(/\s+/).slice(0, 8).join(' ')) ? -0.2 : 0)
  )

  const narrativeFlow = clampScore(
    (meaningfulUnits.length >= 2 ? 0.25 : 0) +
    (meaningfulUnits.length >= 3 ? 0.2 : 0) +
    (units.some((unit) => unit.role === 'claim') ? 0.15 : 0) +
    (units.some((unit) => unit.role === 'example' || unit.role === 'escalation') ? 0.15 : 0) +
    (payoffUnits.length > 0 ? 0.2 : 0) +
    (asideRatio <= 0.2 ? 0.05 : -0.15)
  )

  const payoffStrength = clampScore(
    (lastUnit.endsCleanly ? 0.3 : 0) +
    (!lastUnit.continuesNext ? 0.15 : 0) +
    (lastUnit.role === 'payoff' ? 0.25 : 0) +
    (payoffUnits.length > 0 ? 0.15 : 0) +
    (hasPayoffLanguage(lastUnit.text) || hasPayoffLanguage(text) ? 0.15 : 0)
  )

  const density = getTextDensity(text, duration)
  const durationFit = getDurationFit(duration)
  const audioBoundaryQuality = clampScore(
    (firstUnit.pauseBeforeSeconds === null || firstUnit.pauseBeforeSeconds >= 0.25 ? 0.4 : 0.2) +
    (lastUnit.pauseAfterSeconds === null || lastUnit.pauseAfterSeconds >= 0.25 ? 0.4 : 0.2) +
    (firstUnit.startsCleanly && lastUnit.endsCleanly ? 0.2 : 0)
  )
  const emotionalEnergy = clampScore(
    (/\b(ridiculous|evil|wrong|never|always|really|exactly|control|turn your business off)\b/i.test(text) ? 0.45 : 0.2) +
    (units.some((unit) => unit.role === 'escalation') ? 0.25 : 0) +
    (payoffUnits.length > 0 ? 0.15 : 0)
  )
  const visualSuitability = 0.5
  const captionQuality = clampScore((firstUnit.startsCleanly ? 0.3 : 0) + (lastUnit.endsCleanly ? 0.4 : 0) + (durationFit * 0.3))
  const novelty = clampScore((/\b(control|own|ridiculous|turn your business off|regulatory capture)\b/i.test(text) ? 0.55 : 0.3) + (payoffUnits.length > 0 ? 0.2 : 0))

  const overall = clampScore(
    hookStrength * 0.16 +
    contextIndependence * 0.14 +
    narrativeFlow * 0.18 +
    payoffStrength * 0.18 +
    density * 0.08 +
    novelty * 0.08 +
    audioBoundaryQuality * 0.07 +
    emotionalEnergy * 0.05 +
    visualSuitability * 0.02 +
    captionQuality * 0.02 +
    durationFit * 0.02
  )

  return {
    hookStrength,
    contextIndependence,
    narrativeFlow,
    payoffStrength,
    density,
    novelty,
    audioBoundaryQuality,
    emotionalEnergy,
    visualSuitability,
    captionQuality,
    durationFit,
    overall
  }
}

const shouldConsiderArc = (
  units: EditorialUnit[],
  duration: number,
  options: Required<Pick<GenerateCandidateArcsOptions, 'minDurationSeconds' | 'maxDurationSeconds'>>
) => {
  if (duration < options.minDurationSeconds || duration > options.maxDurationSeconds) return false
  const firstUnit = units[0]
  const lastUnit = units[units.length - 1]
  if (!firstUnit || !lastUnit) return false
  if (!firstUnit.startsCleanly || firstUnit.role === 'aside' || firstUnit.role === 'filler') return false
  if (!lastUnit.endsCleanly) return false
  if (units.some((unit) => unit.role === 'aside')) return false
  const nonEditorialCount = units.filter((unit) => unit.role === 'filler' || unit.role === 'transition').length
  return nonEditorialCount / Math.max(1, units.length) <= 0.3
}

export const generateCandidateArcs = (
  units: EditorialUnit[],
  options: GenerateCandidateArcsOptions = {}
): CandidateArc[] => {
  const minDurationSeconds = options.minDurationSeconds ?? 25
  const maxDurationSeconds = options.maxDurationSeconds ?? 120
  const maxArcs = options.maxArcs ?? 60
  const arcs: CandidateArc[] = []

  for (let startIndex = 0; startIndex < units.length; startIndex += 1) {
    for (let endIndex = startIndex; endIndex < units.length; endIndex += 1) {
      const arcUnits = units.slice(startIndex, endIndex + 1)
      const firstUnit = arcUnits[0]
      const lastUnit = arcUnits[arcUnits.length - 1]
      const duration = Number((lastUnit.endTime - firstUnit.startTime).toFixed(3))

      if (duration > maxDurationSeconds) break
      if (!shouldConsiderArc(arcUnits, duration, { minDurationSeconds, maxDurationSeconds })) continue

      const scores = scoreCandidateArc(arcUnits, duration)
      arcs.push({
        id: `arc_${arcs.length + 1}`,
        unitIds: arcUnits.map((unit) => unit.id),
        startWordIndex: firstUnit.startWordIndex,
        endWordIndex: lastUnit.endWordIndex,
        startTime: firstUnit.startTime,
        endTime: lastUnit.endTime,
        duration,
        topic: summarizeArcTopic(arcUnits),
        summary: summarizeArc(arcUnits),
        hookText: firstUnit.text,
        payoffText: lastUnit.text,
        keyQuote: getKeyQuote(arcUnits),
        scores,
        diagnostics: {
          unitCount: arcUnits.length,
          roleSequence: arcUnits.map((unit) => unit.role),
          startsCleanly: firstUnit.startsCleanly,
          endsCleanly: lastUnit.endsCleanly,
          firstUnitId: firstUnit.id,
          lastUnitId: lastUnit.id
        }
      })
    }
  }

  return arcs
    .sort((left, right) => right.scores.overall - left.scores.overall)
    .slice(0, maxArcs)
    .map((arc, index) => ({
      ...arc,
      id: `arc_${index + 1}`
    }))
}

export const summarizeCandidateArcs = (arcs: CandidateArc[]) => ({
  arcCount: arcs.length,
  preview: arcs.slice(0, 8).map((arc) => ({
    id: arc.id,
    startTime: arc.startTime,
    endTime: arc.endTime,
    duration: arc.duration,
    topic: arc.topic,
    overall: arc.scores.overall,
    hookStrength: arc.scores.hookStrength,
    narrativeFlow: arc.scores.narrativeFlow,
    payoffStrength: arc.scores.payoffStrength,
    unitIds: arc.unitIds,
    hookText: arc.hookText,
    payoffText: arc.payoffText
  }))
})
