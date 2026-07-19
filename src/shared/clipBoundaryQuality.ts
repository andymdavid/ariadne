export type BoundaryQuality = {
  startsLikeContinuation: boolean
  leadingBoundaryIssue: string | null
  endsWithTerminalPunctuation: boolean
  endsWithDanglingPhrase: boolean
  hardIncompleteEnding: boolean
  trailingBoundaryIssue: string | null
  looksLikeCompleteThought: boolean
}

const CONTINUATION_WORD_PATTERN =
  /^(and|but|so|because|then|which|that|it|this|these|those|or|than|as|to|for|with|of|in|on|at|from|by|about|into|over|after|before)\b/i

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

export const stripLeadingBoundaryFiller = (text: string) =>
  text
    .trim()
    .replace(/^((yeah|yep|yes|no|right|okay|ok|well|like|so|um|uh|ah|you know|i mean|sort of|kind of)[,\s]+)+/i, '')
    .trim()

export const startsLikeContinuation = (text: string) => {
  const trimmed = stripLeadingBoundaryFiller(text)
  if (!trimmed) return false
  return CONTINUATION_WORD_PATTERN.test(trimmed)
}

export const getLeadingBoundaryIssue = (text: string): string | null => {
  const trimmed = stripLeadingBoundaryFiller(text)
  if (!trimmed) return 'empty'

  const normalized = normalize(trimmed)

  if (CONTINUATION_WORD_PATTERN.test(normalized)) {
    return 'leading_continuation'
  }

  if (/^(i\s*m\s+sorry|im\s+sorry|sorry)\b/.test(normalized)) {
    return 'leading_repair_aside'
  }

  if (/^(who knows|either way|anyway|for some reason)\b/.test(normalized)) {
    return 'leading_aside'
  }

  if (/^(gonna|going|wanna|want|need|trying|able|owned|doing|done|way)\b/.test(normalized)) {
    return 'leading_fragment'
  }

  if (/^(he|she|they|them|it|this|that|these|those|there)\b/.test(normalized)) {
    return 'leading_unresolved_reference'
  }

  return null
}

export const endsWithDanglingPhrase = (text: string) => {
  const normalized = normalize(stripTerminalPunctuation(text))
  if (!normalized) return false

  if (
    /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
    /\b(therefore|and so|so then|which means|that means|this means)\s*$/.test(normalized) ||
    /\b(that'?s|there'?s|it'?s|what'?s|who'?s|where'?s|when'?s|why'?s|how'?s)\s*$/.test(normalized) ||
    /\b(i|we|you|they|he|she|it|that|there|this|who)'(ll|re|ve|d|m)\s*$/.test(normalized) ||
    /\b(i|we|you|they|he|she|it)\s+(just|really|actually|basically|only|always|never|also)\s*$/.test(normalized) ||
    /\b(just|really|basically|actually|literally|even)\s*$/.test(normalized) ||
    // Trailing filler "like" — but not clause-final "looks/feels/sounds/seems like"
    /(?<!\b(?:looks?|feels?|sounds?|seems?)\s)\blike\s*$/.test(normalized) ||
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
    [/\b(therefore|and so|so then|which means|that means|this means)\s*$/, 'trailing_inference_marker'],
    [/\b(that'?s|there'?s|it'?s|what'?s|who'?s|where'?s|when'?s|why'?s|how'?s)\s*$/, 'trailing_contraction'],
    [/\b(that'?s|this is|that is|it'?s|what'?s|here'?s|there'?s)\s+(what|where|when|why|how|who|which)\s*$/, 'trailing_unresolved_reference'],
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

export const isCleanLocalClipEnd = (text: string) => {
  const normalized = normalize(stripTerminalPunctuation(text))
  if (!normalized || getTrailingBoundaryIssue(normalized)) return false

  if (/\b(that'?s|this is|that is|it'?s|what'?s|here'?s|there'?s)\s+(what|where|when|why|how|who|which)\s*$/.test(normalized)) {
    return false
  }

  if (endsWithTerminalPunctuation(text)) {
    return true
  }

  return (
    /\b(true|right|exactly|yeah|yes|no|done|finished|complete|matters|works|helps|changes|solves|defines|controls|owns|operates|operate)\s*$/.test(normalized) ||
    /\b(that'?s why|that'?s how|which means|the point is|the takeaway|bottom line|so basically)\b[^.!?]{0,80}$/.test(normalized) ||
    /\b(wrong|right|better|best)\s+way\s+to\b[^.!?]{0,90}$/.test(normalized)
  )
}

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
    /\b(that'?s why|that'?s how|that'?s what|which means|the point is|the takeaway|bottom line|so basically)\b/.test(normalized) ||
    /\b(works|matters|helps|changes|solves|defines|controls|owns|operate|operates|need|should|shouldn'?t|don'?t need)\b[^.!?]{0,80}$/.test(normalized) ||
    /\b(wrong|right|better|best)\s+way\s+to\b[^.!?]{0,90}$/.test(normalized)
  )
}

export const getBoundaryQuality = (text: string): BoundaryQuality => ({
  startsLikeContinuation: startsLikeContinuation(text),
  leadingBoundaryIssue: getLeadingBoundaryIssue(text),
  endsWithTerminalPunctuation: endsWithTerminalPunctuation(text),
  endsWithDanglingPhrase: endsWithDanglingPhrase(text),
  hardIncompleteEnding: isHardIncompleteEnding(text),
  trailingBoundaryIssue: getTrailingBoundaryIssue(text),
  looksLikeCompleteThought: looksLikeCompleteThought(text)
})

export const isCleanClipStart = (text: string) => {
  const trimmed = stripLeadingBoundaryFiller(text)
  return Boolean(trimmed) && getLeadingBoundaryIssue(trimmed) === null
}

export const isCleanClipEnd = (text: string) => looksLikeCompleteThought(text) && isCleanLocalClipEnd(text)
