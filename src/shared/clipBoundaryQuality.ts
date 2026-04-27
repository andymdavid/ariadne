export type BoundaryQuality = {
  startsLikeContinuation: boolean
  endsWithTerminalPunctuation: boolean
  endsWithDanglingPhrase: boolean
  looksLikeCompleteThought: boolean
}

const CONTINUATION_WORD_PATTERN =
  /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i

const normalize = (text: string) => text.trim().toLowerCase()

export const normalizeTranscriptText = (text: string) =>
  text
    .replace(/\s+([,.!?;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

export const endsWithTerminalPunctuation = (text: string) => /[.!?]["']?\s*$/.test(text.trim())

export const startsLikeContinuation = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return false
  return CONTINUATION_WORD_PATTERN.test(trimmed)
}

export const endsWithDanglingPhrase = (text: string) => {
  const normalized = normalize(text)
  if (!normalized) return false

  if (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/.test(normalized) ||
    /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
    /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized) ||
    /\b(very|really|so|quite|pretty|rather|extremely|incredibly|absolutely|totally)\s*$/.test(normalized)
  ) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1] || ''
  const functionalWords = new Set([
    'it', 'is', 'be', 'we', 'he', 'me', 'so', 'do', 'go', 'no', 'up', 'if',
    'or', 'as', 'at', 'by', 'on', 'an', 'am', 'us', 'my'
  ])

  return lastWord.length <= 2 || functionalWords.has(lastWord)
}

export const looksLikeCompleteThought = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (endsWithDanglingPhrase(trimmed)) return false
  if (endsWithTerminalPunctuation(trimmed)) return true
  return trimmed.split(/\s+/).filter(Boolean).length >= 12
}

export const getBoundaryQuality = (text: string): BoundaryQuality => ({
  startsLikeContinuation: startsLikeContinuation(text),
  endsWithTerminalPunctuation: endsWithTerminalPunctuation(text),
  endsWithDanglingPhrase: endsWithDanglingPhrase(text),
  looksLikeCompleteThought: looksLikeCompleteThought(text)
})

export const isCleanClipStart = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !startsLikeContinuation(trimmed)
}

export const isCleanClipEnd = (text: string) => looksLikeCompleteThought(text)
