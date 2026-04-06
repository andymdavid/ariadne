import type { ClipCandidate, RankedClipSelection } from './clipSelectionTypes'

class ClipValidationService {
  validateAndRank(
    clips: RankedClipSelection[],
    candidates: ClipCandidate[]
  ): Array<Omit<RankedClipSelection, 'candidateId' | 'transcriptText' | 'naturalStart' | 'naturalEnd' | 'heuristicScore' | 'validationScore'>> {
    const accepted: RankedClipSelection[] = []
    const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))

    const reranked = clips
      .map(clip => ({
        ...clip,
        validationScore: this.computeValidationScore(clip, candidateMap.get(clip.candidateId))
      }))
      .filter(clip => this.passesValidation(clip))
      .sort((left, right) => {
        if (right.validationScore !== left.validationScore) {
          return right.validationScore - left.validationScore
        }
        return right.shareabilityScore - left.shareabilityScore
      })

    for (const clip of reranked) {
      const overlapsTooMuch = accepted.some(existing => this.overlapRatio(existing, clip) > 0.5)
      if (!overlapsTooMuch) {
        accepted.push(clip)
      }
    }

    return accepted.map(({ candidateId, transcriptText, naturalStart, naturalEnd, heuristicScore, validationScore, ...clip }) => clip)
  }

  private passesValidation(clip: RankedClipSelection): boolean {
    const text = clip.transcriptText.trim()
    const normalizedText = text.toLowerCase()

    if (!clip.naturalStart || !clip.naturalEnd) return false
    if (!this.normalizedIncludes(text, clip.keyQuote)) return false
    if (!this.looksLikeThoughtEnding(text)) return false
    if (/^(and|but|so|because|then|which|that|it|this)\b/i.test(text)) return false
    if (clip.contextNeeded === 'high') return false
    if (/\b(as i said|like i said|earlier|before this|previously|that point)\b/.test(normalizedText)) return false

    return true
  }

  private computeValidationScore(clip: RankedClipSelection, candidate?: ClipCandidate): number {
    const text = clip.transcriptText.trim()
    const sentenceCount = text.split(/[.!?]+/).map(part => part.trim()).filter(Boolean).length
    const quoteBonus = this.normalizedIncludes(text, clip.keyQuote) ? 1.2 : 0
    const endingBonus = this.looksLikeThoughtEnding(text) ? 1 : 0
    const contextPenalty = clip.contextNeeded === 'medium' ? 0.5 : 0
    const candidateBonus = candidate ? candidate.heuristicScore * 0.35 : 0
    const sentenceDensityBonus = Math.min(sentenceCount / 4, 1)

    // NEW: Semantic resolution scoring
    const semanticResolution = this.computeSemanticResolutionScore(text)

    return Number((
      clip.shareabilityScore * 0.50 +  // Slightly reduced to make room for semantic score
      candidateBonus +
      quoteBonus +
      endingBonus +
      sentenceDensityBonus +
      semanticResolution * 1.5 -  // Weighted semantic resolution
      contextPenalty
    ).toFixed(3))
  }

  private overlapRatio(
    left: { startTime: number; endTime: number; duration: number },
    right: { startTime: number; endTime: number; duration: number }
  ): number {
    const overlapStart = Math.max(left.startTime, right.startTime)
    const overlapEnd = Math.min(left.endTime, right.endTime)

    if (overlapEnd <= overlapStart) {
      return 0
    }

    const overlap = overlapEnd - overlapStart
    return overlap / Math.min(left.duration, right.duration)
  }

  private normalizedIncludes(haystack: string, needle: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
    return normalize(haystack).includes(normalize(needle))
  }

  private looksLikeThoughtEnding(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) {
      return false
    }

    // Strong positive: terminal punctuation
    if (/[.!?]["']?\s*$/.test(trimmed)) {
      // But check if the ending is semantically incomplete
      if (this.isIncompleteEnding(trimmed)) {
        return false
      }
      return true
    }

    // No terminal punctuation: apply strict heuristics
    const normalized = trimmed.toLowerCase()
    const words = normalized.split(/\s+/).filter(Boolean)

    if (words.length < 10) {  // Increased from 8
      return false
    }

    const lastWord = words[words.length - 1]
    const secondLastWord = words[words.length - 2] || ''
    const trailingPhrase = words.slice(-4).join(' ')

    // Expanded rejection patterns for dangling/incomplete endings
    const danglingPatterns = [
      // Conjunctions and connectors
      /\b(and|but|or|so|because|then|which|that|if|when|while|although|however|therefore|moreover|furthermore)\s*$/,
      // Prepositions
      /\b(to|for|with|of|in|on|at|from|as|than|about|into|through|during|before|after|between|under|over)\s*$/,
      // Articles and determiners
      /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any|each|every|no)\s*$/,
      // Incomplete phrases
      /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/,
      // Adjective setups (something is about to be described)
      /\b(very|really|so|quite|pretty|rather|extremely|incredibly|absolutely|totally)\s*$/,
      // Verb setups (incomplete actions)
      /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/
    ]

    for (const pattern of danglingPatterns) {
      if (pattern.test(normalized)) {
        return false
      }
    }

    // Reject short/functional last words
    if (lastWord.length <= 2) {
      return false
    }

    // Reject common functional words that shouldn't end clips
    const functionalWords = [
      'it', 'is', 'be', 'we', 'he', 'me', 'so', 'do', 'go', 'no', 'up', 'if',
      'or', 'as', 'at', 'by', 'on', 'an', 'am', 'us', 'my'
    ]
    if (functionalWords.includes(lastWord)) {
      return false
    }

    return true
  }

  private isIncompleteEnding(text: string): boolean {
    const normalized = text.toLowerCase().trim()

    // Get the last sentence for analysis
    const sentences = normalized.split(/[.!?]+/).filter(s => s.trim())
    const lastSentence = sentences[sentences.length - 1] || ''

    // Abstract/vague endings that suggest more should follow
    const incompletePatterns = [
      // Abstract adjectives without resolution
      /\b(important|interesting|fascinating|significant|key|crucial|essential|critical|relevant)\s*[.!?]?\s*$/,
      // Generic nouns without specificity
      /\b(thing|things|stuff|part|aspect|point|idea|concept|factor|element)\s*[.!?]?\s*$/,
      // Comparative without completion
      /\b(like|similar|different|same|other|another|next|previous|following)\s*[.!?]?\s*$/,
      // Temporal markers that suggest continuation
      /\b(here|there|now|then|today|tomorrow|yesterday)\s*[.!?]?\s*$/,
      // Ordinal markers suggesting a list continues
      /\b(first|second|third|finally|lastly|next|also|additionally)\s*[.!?]?\s*$/,
      // Vague pronouns without clear referent
      /\b(something|somewhere|someone|somehow|sometime)\s*[.!?]?\s*$/
    ]

    for (const pattern of incompletePatterns) {
      if (pattern.test(lastSentence)) {
        return true
      }
    }

    return false
  }

  /**
   * Compute a semantic resolution score based on whether the clip has a satisfying conclusion
   */
  private computeSemanticResolutionScore(text: string): number {
    const normalized = text.toLowerCase()
    let score = 0

    // Conclusion indicators (positive signals)
    const conclusionPatterns = [
      // Summary phrases
      { pattern: /\b(so that's|and that's|which means|the point is|bottom line|in short|to sum up)\b/, weight: 0.3 },
      // Explanatory conclusions
      { pattern: /\b(that's why|that's how|that's what|this is why|this is how|this is what)\b/, weight: 0.3 },
      // Key takeaways
      { pattern: /\b(the lesson|the takeaway|the key|the answer|the solution|the secret)\b/, weight: 0.25 },
      // Resolution verbs
      { pattern: /\b(proved|demonstrated|showed|confirmed|realized|learned|discovered|found)\b/, weight: 0.2 },
      // Action completions
      { pattern: /\b(works|matters|counts|helps|changed|transformed|improved|solved|fixed)\b/, weight: 0.2 }
    ]

    for (const { pattern, weight } of conclusionPatterns) {
      if (pattern.test(normalized)) {
        score += weight
      }
    }

    // Questions can be good closers (rhetorical or thought-provoking)
    if (/\?["']?\s*$/.test(text)) {
      score += 0.25
    }

    // Exclamations indicate emphasis/closure
    if (/!["']?\s*$/.test(text)) {
      score += 0.15
    }

    // Strong declarative endings
    if (/\b(period|full stop|end of story|that's it|done)\b/.test(normalized)) {
      score += 0.2
    }

    // Penalize open-ended structures that suggest more is coming
    const openEndedPatterns = [
      { pattern: /\b(but|however|although|yet|still)\s+[^.!?]*$/, weight: -0.4 },
      { pattern: /\b(on the other hand|at the same time|meanwhile)\b/, weight: -0.3 },
      { pattern: /\b(first of all|to begin with|for starters)\b(?!.*\b(finally|lastly|in conclusion)\b)/, weight: -0.25 }
    ]

    for (const { pattern, weight } of openEndedPatterns) {
      if (pattern.test(normalized)) {
        score += weight // weight is negative
      }
    }

    // Clamp to 0-1 range
    return Math.max(0, Math.min(1, score))
  }
}

export const clipValidationService = new ClipValidationService()
export default clipValidationService
