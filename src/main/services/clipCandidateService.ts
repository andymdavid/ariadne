import type { ClipCandidate, TranscriptSegmentInput } from './clipSelectionTypes'

class ClipCandidateService {
  private readonly minDuration = 35
  private readonly maxDuration = 60
  private readonly maxCandidates = 60

  generateCandidates(segments: TranscriptSegmentInput[]): ClipCandidate[] {
    const usableSegments = segments.filter(segment => segment.text.trim().length > 0)
    const candidates: ClipCandidate[] = []

    for (let startIndex = 0; startIndex < usableSegments.length; startIndex++) {
      const startSegment = usableSegments[startIndex]

      for (let endIndex = startIndex; endIndex < usableSegments.length; endIndex++) {
        const endSegment = usableSegments[endIndex]
        const duration = endSegment.end - startSegment.start

        if (duration > this.maxDuration) {
          break
        }

        if (duration < this.minDuration) {
          continue
        }

        const windowSegments = usableSegments.slice(startIndex, endIndex + 1)
        const text = windowSegments.map(segment => segment.text.trim()).join(' ').trim()
        if (!text) {
          continue
        }

        const candidate: ClipCandidate = {
          id: `candidate_${startIndex}_${endIndex}`,
          startTime: startSegment.start,
          endTime: endSegment.end,
          duration,
          segmentStartIndex: startIndex,
          segmentEndIndex: endIndex,
          text,
          openingLine: startSegment.text.trim(),
          closingLine: endSegment.text.trim(),
          heuristicScore: this.scoreCandidate(windowSegments, duration, text)
        }

        candidates.push(candidate)
      }
    }

    candidates.sort((left, right) => right.heuristicScore - left.heuristicScore)
    return this.diversifyCandidates(candidates).slice(0, this.maxCandidates)
  }

  private scoreCandidate(segments: TranscriptSegmentInput[], duration: number, text: string): number {
    const firstSegment = segments[0]
    const lastSegment = segments[segments.length - 1]
    const normalizedText = text.toLowerCase()

    const idealDurationScore = 1 - Math.min(Math.abs(duration - 47.5) / 12.5, 1)
    const openingHookScore = this.scoreOpeningHook(firstSegment.text)
    const endingScore = /[.!?]["']?$/.test(lastSegment.text.trim()) ? 1 : 0.2
    const fillerPenalty = this.countFillers(normalizedText) * 0.08
    const pronounContextPenalty = this.countContextReferences(normalizedText) * 0.05
    const sentenceCount = text.split(/[.!?]+/).map(part => part.trim()).filter(Boolean).length
    const densityScore = Math.min(sentenceCount / 5, 1)

    return (
      idealDurationScore * 3 +
      openingHookScore * 2.5 +
      endingScore * 2 +
      densityScore * 1.5 -
      fillerPenalty -
      pronounContextPenalty
    )
  }

  private scoreOpeningHook(text: string): number {
    const normalized = text.trim().toLowerCase()

    if (!normalized) return 0
    if (normalized.endsWith('?')) return 1
    if (/^(here'?s|this is|the reason|what|why|how|if you|when you)/.test(normalized)) return 0.9
    if (/(biggest|most important|mistake|surprised|truth|problem|lesson)/.test(normalized)) return 0.85
    if (normalized.split(/\s+/).length <= 6) return 0.55
    return 0.4
  }

  private countFillers(text: string): number {
    const matches = text.match(/\b(um|uh|like|you know|i mean|sort of|kind of)\b/g)
    return matches ? matches.length : 0
  }

  private countContextReferences(text: string): number {
    const matches = text.match(/\b(as i said|like i said|earlier|before this|previously|that point|this point)\b/g)
    return matches ? matches.length : 0
  }

  private diversifyCandidates(candidates: ClipCandidate[]): ClipCandidate[] {
    const selected: ClipCandidate[] = []

    for (const candidate of candidates) {
      const overlapsTooMuch = selected.some(existing => this.overlapRatio(existing, candidate) > 0.65)
      if (!overlapsTooMuch) {
        selected.push(candidate)
      }
      if (selected.length >= this.maxCandidates) {
        break
      }
    }

    return selected
  }

  private overlapRatio(left: ClipCandidate, right: ClipCandidate): number {
    const overlapStart = Math.max(left.startTime, right.startTime)
    const overlapEnd = Math.min(left.endTime, right.endTime)

    if (overlapEnd <= overlapStart) {
      return 0
    }

    const overlap = overlapEnd - overlapStart
    return overlap / Math.min(left.duration, right.duration)
  }
}

export const clipCandidateService = new ClipCandidateService()
export default clipCandidateService
