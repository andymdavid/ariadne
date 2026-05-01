export type BoundaryQuality = {
  startsLikeContinuation: boolean
  endsWithTerminalPunctuation: boolean
  endsWithDanglingPhrase: boolean
  hardIncompleteEnding: boolean
  trailingBoundaryIssue: string | null
  looksLikeCompleteThought: boolean
}

const CONTINUATION_WORD_PATTERN =
  /^(and|but|so|because|then|which|that|it|this|these|those|or|if|when|where|while|who|what|how|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i

const normalize = (text: string) => text.trim().toLowerCase()

const stripTerminalPunctuation = (text: string) =>
  text
    .trim()
    .replace(/[.!?]+["']?\s*$/g, '')
    .trim()

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
  const normalized = normalize(stripTerminalPunctuation(text))
  if (!normalized) return false

  if (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(that'?s|there'?s|it'?s|what'?s|who'?s|where'?s|when'?s|why'?s|how'?s)\s*$/.test(normalized) ||
    /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/.test(normalized) ||
    /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
    /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized) ||
    /\b(very|really|so|quite|pretty|rather|extremely|incredibly|absolutely|totally)\s*$/.test(normalized) ||
    /\b(question|reason|example|case|part|point|bit|way|one)\s*$/.test(normalized) ||
    /\b(depending on|based on|because of|in terms of|when it comes to|as a result of|one of|part of|kind of|sort of)\s+(the|a|an|this|that|these|those|my|your|our|their)?\s*\w{0,24}\s*$/.test(normalized)
  ) {
    return true
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1] || ''
  return lastWord.length <= 2
}

export const getTrailingBoundaryIssue = (text: string): string | null => {
  const normalized = normalize(stripTerminalPunctuation(text))
  if (!normalized) return 'empty'

  const issuePatterns: Array<[RegExp, string]> = [
    [/\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/, 'trailing_connector'],
    [/\b(that'?s|there'?s|it'?s|what'?s|who'?s|where'?s|when'?s|why'?s|how'?s)\s*$/, 'trailing_contraction'],
    [/\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/, 'trailing_determiner'],
    [/\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/, 'trailing_auxiliary'],
    [/\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/, 'trailing_incomplete_phrase'],
    [/\b(depending on|based on|because of|in terms of|when it comes to|as a result of|one of|part of|kind of|sort of)\s+(the|a|an|this|that|these|those|my|your|our|their)?\s*\w{0,24}\s*$/, 'trailing_open_prepositional_phrase'],
    [/\b(very|really|so|quite|pretty|rather|extremely|incredibly|absolutely|totally)\s*$/, 'trailing_modifier'],
    [/\b(question|reason|example|case|part|point|bit|way|one)\s*$/, 'trailing_placeholder_noun']
  ]

  for (const [pattern, reason] of issuePatterns) {
    if (pattern.test(normalized)) {
      return reason
    }
  }

  const words = normalized.split(/\s+/).filter(Boolean)
  const lastWord = words[words.length - 1] || ''
  if (lastWord.length <= 2) {
    return 'trailing_function_word'
  }

  return null
}

export const isHardIncompleteEnding = (text: string) => getTrailingBoundaryIssue(text) !== null

export const looksLikeCompleteThought = (text: string) => {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (isHardIncompleteEnding(trimmed)) return false
  if (endsWithTerminalPunctuation(trimmed)) return true

  const normalized = normalize(trimmed)
  const words = normalized.split(/\s+/).filter(Boolean)
  if (words.length < 18) return false

  if (/\b(because|although|however|but|and then|the question|for some reason)\b[^.!?]{0,100}$/.test(normalized)) {
    return false
  }

  return (
    /\b(that'?s why|that'?s how|that'?s what|which means|the point is|the takeaway|bottom line|so basically|therefore)\b/.test(normalized) ||
    /\b(works|matters|helps|changes|solves|defines|controls|owns|operate|operates|need|should|shouldn'?t|don'?t need)\b[^.!?]{0,80}$/.test(normalized)
  )
}

export const getBoundaryQuality = (text: string): BoundaryQuality => ({
  startsLikeContinuation: startsLikeContinuation(text),
  endsWithTerminalPunctuation: endsWithTerminalPunctuation(text),
  endsWithDanglingPhrase: endsWithDanglingPhrase(text),
  hardIncompleteEnding: isHardIncompleteEnding(text),
  trailingBoundaryIssue: getTrailingBoundaryIssue(text),
  looksLikeCompleteThought: looksLikeCompleteThought(text)
})

export const isCleanClipStart = (text: string) => {
  const trimmed = text.trim()
  return Boolean(trimmed) && !startsLikeContinuation(trimmed)
}

export const isCleanClipEnd = (text: string) => looksLikeCompleteThought(text) && !isHardIncompleteEnding(text)
