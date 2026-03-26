import type { ClipCandidate, RankedClipSelection } from './clipSelectionTypes'

class ClipValidationService {
  validateAndRank(
    clips: RankedClipSelection[],
    candidates: ClipCandidate[]
  ): Array<Omit<RankedClipSelection, 'transcriptText' | 'naturalStart' | 'naturalEnd' | 'heuristicScore' | 'validationScore'>> {
    const accepted: RankedClipSelection[] = []
    const candidateMap = new Map(candidates.map(candidate => [candidate.id, candidate]))

    const reranked = clips
      .map(clip => ({
        ...clip,
        validationScore: this.computeValidationScore(clip, candidateMap.get(clip.id))
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

    return accepted.map(({ transcriptText, naturalStart, naturalEnd, heuristicScore, validationScore, ...clip }) => clip)
  }

  private passesValidation(clip: RankedClipSelection): boolean {
    const text = clip.transcriptText.trim()
    const normalizedText = text.toLowerCase()

    if (!clip.naturalStart || !clip.naturalEnd) return false
    if (!this.normalizedIncludes(text, clip.keyQuote)) return false
    if (!/[.!?]["']?\s*$/.test(text)) return false
    if (/^(and|but|so|because|then|which|that|it|this)\b/i.test(text)) return false
    if (clip.contextNeeded === 'high') return false
    if (/\b(as i said|like i said|earlier|before this|previously|that point)\b/.test(normalizedText)) return false

    return true
  }

  private computeValidationScore(clip: RankedClipSelection, candidate?: ClipCandidate): number {
    const text = clip.transcriptText.trim()
    const sentenceCount = text.split(/[.!?]+/).map(part => part.trim()).filter(Boolean).length
    const quoteBonus = this.normalizedIncludes(text, clip.keyQuote) ? 1.2 : 0
    const endingBonus = /[.!?]["']?\s*$/.test(text) ? 1 : 0
    const contextPenalty = clip.contextNeeded === 'medium' ? 0.5 : 0
    const candidateBonus = candidate ? candidate.heuristicScore * 0.35 : 0
    const sentenceDensityBonus = Math.min(sentenceCount / 4, 1)

    return Number((
      clip.shareabilityScore * 0.55 +
      candidateBonus +
      quoteBonus +
      endingBonus +
      sentenceDensityBonus -
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
}

export const clipValidationService = new ClipValidationService()
export default clipValidationService
