import type { ClipCandidate, TranscriptSegmentInput, SentenceBoundary } from './clipSelectionTypes'

class ClipCandidateService {
  // Hard boundaries - clips outside these are rejected
  private readonly hardMinDuration = 30
  private readonly hardMaxDuration = 90
  // Soft boundaries - clips outside these are penalized but not rejected
  private readonly softMinDuration = 35
  private readonly softMaxDuration = 75
  private readonly maxCandidates = 60
  private readonly minPreferredCandidates = 18
  private readonly maxSupplementalCandidates = 24

  generateCandidates(segments: TranscriptSegmentInput[]): ClipCandidate[] {
    const usableSegments = segments.filter(segment => segment.text.trim().length > 0)

    // Build sentence boundary index for precise end-point targeting
    const sentenceBoundaries = this.buildSentenceBoundaryIndex(usableSegments)

    // Primary strategy: Generate candidates ending on sentence boundaries
    const sentenceBoundedCandidates = this.generateSentenceBoundedCandidates(
      usableSegments,
      sentenceBoundaries
    )

    // Fallback strategy: If sentence coverage is sparse, add segment-bounded candidates
    let allCandidates = [...sentenceBoundedCandidates]

    if (sentenceBoundedCandidates.length < this.minPreferredCandidates) {
      const segmentBoundedCandidates = this.generateSegmentBoundedCandidates(usableSegments)
      allCandidates.push(...segmentBoundedCandidates)
    }

    // Sort by heuristic score and diversify
    allCandidates.sort((left, right) => right.heuristicScore - left.heuristicScore)
    return this.diversifyCandidates(allCandidates).slice(0, this.maxCandidates)
  }

  private buildSentenceBoundaryIndex(segments: TranscriptSegmentInput[]): SentenceBoundary[] {
    const boundaries: SentenceBoundary[] = []

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex]
      const text = segment.text.trim()

      // Find all terminal punctuation in this segment
      const matches = [...text.matchAll(/[.!?]["']?/g)]

      for (const match of matches) {
        if (match.index === undefined) continue

        const charIndex = match.index + match[0].length
        const sentenceText = text.slice(0, charIndex).trim()

        // Calculate the time for this sentence boundary
        const boundaryTime = this.interpolateBoundaryTime(segment, charIndex, text.length)

        boundaries.push({
          segmentIndex,
          charIndex,
          time: boundaryTime,
          sentenceText,
          punctuation: match[0][0] as '.' | '!' | '?'
        })
      }
    }

    return boundaries.sort((a, b) => a.time - b.time)
  }

  private interpolateBoundaryTime(
    segment: TranscriptSegmentInput,
    charIndex: number,
    totalChars: number
  ): number {
    // If we have word-level timestamps, find the actual word boundary
    if (segment.words && segment.words.length > 0) {
      // Count words up to charIndex
      const textUpToIndex = segment.text.slice(0, charIndex)
      const wordCount = textUpToIndex.split(/\s+/).filter(Boolean).length

      // Find the corresponding word (clamped to available words)
      const wordIndex = Math.min(wordCount - 1, segment.words.length - 1)
      if (wordIndex >= 0) {
        return segment.words[wordIndex].end
      }
    }

    // Fallback: linear interpolation based on character position
    const ratio = charIndex / Math.max(1, totalChars)
    return segment.start + (segment.end - segment.start) * ratio
  }

  private generateSentenceBoundedCandidates(
    segments: TranscriptSegmentInput[],
    boundaries: SentenceBoundary[]
  ): ClipCandidate[] {
    const candidates: ClipCandidate[] = []

    // For each sentence boundary as a potential END point
    for (let endIdx = 0; endIdx < boundaries.length; endIdx++) {
      const endBoundary = boundaries[endIdx]

      // Try each earlier boundary as a potential START point
      for (let startIdx = 0; startIdx < endIdx; startIdx++) {
        const startBoundary = boundaries[startIdx]

        // Calculate duration
        const duration = endBoundary.time - startBoundary.time

        // Skip if outside hard duration limits
        if (duration < this.hardMinDuration || duration > this.hardMaxDuration) {
          continue
        }

        // Build the candidate
        const candidate = this.buildCandidateFromBoundaries(
          segments,
          startBoundary,
          endBoundary,
          duration,
          true // endedOnSentence = true
        )

        if (candidate) {
          candidates.push(candidate)
        }
      }

      // Also try starting from segment beginnings (not just sentence boundaries)
      for (let segIdx = 0; segIdx <= endBoundary.segmentIndex; segIdx++) {
        const startSegment = segments[segIdx]
        const duration = endBoundary.time - startSegment.start

        if (duration < this.hardMinDuration || duration > this.hardMaxDuration) {
          continue
        }

        // Check if this is a natural start point
        const isNaturalStart = this.isNaturalStart(segments, segIdx)
        if (!isNaturalStart) continue

        const candidate = this.buildCandidateFromSegmentAndBoundary(
          segments,
          segIdx,
          endBoundary,
          duration
        )

        if (candidate) {
          candidates.push(candidate)
        }
      }
    }

    return candidates
  }

  private buildCandidateFromBoundaries(
    segments: TranscriptSegmentInput[],
    startBoundary: SentenceBoundary,
    endBoundary: SentenceBoundary,
    duration: number,
    endedOnSentence: boolean
  ): ClipCandidate | null {
    // Get all segments in range
    const windowSegments = segments.slice(
      startBoundary.segmentIndex,
      endBoundary.segmentIndex + 1
    )

    if (windowSegments.length === 0) return null

    // Build full text
    const text = this.buildTextFromBoundaries(segments, startBoundary, endBoundary)
    if (!text.trim()) return null

    const startTime = startBoundary.time
    const endTime = endBoundary.time

    return {
      id: `candidate_sb_${startBoundary.segmentIndex}_${startBoundary.charIndex}_${endBoundary.segmentIndex}_${endBoundary.charIndex}`,
      startTime,
      endTime,
      duration,
      segmentStartIndex: startBoundary.segmentIndex,
      segmentEndIndex: endBoundary.segmentIndex,
      text,
      openingLine: this.extractOpeningLine(text),
      closingLine: this.extractClosingLine(text),
      naturalStart: true, // Started at sentence boundary
      naturalEnd: true,   // Ended at sentence boundary
      heuristicScore: this.scoreCandidateEnhanced(windowSegments, duration, text, endedOnSentence)
    }
  }

  private buildCandidateFromSegmentAndBoundary(
    segments: TranscriptSegmentInput[],
    startSegmentIdx: number,
    endBoundary: SentenceBoundary,
    duration: number
  ): ClipCandidate | null {
    const startSegment = segments[startSegmentIdx]
    const windowSegments = segments.slice(startSegmentIdx, endBoundary.segmentIndex + 1)

    if (windowSegments.length === 0) return null

    // Build text from segment start to boundary
    let text = ''
    for (let i = startSegmentIdx; i < endBoundary.segmentIndex; i++) {
      text += segments[i].text.trim() + ' '
    }
    // Add partial text from end segment up to boundary
    const endSegment = segments[endBoundary.segmentIndex]
    text += endSegment.text.slice(0, endBoundary.charIndex).trim()
    text = text.trim()

    if (!text) return null

    return {
      id: `candidate_seg_${startSegmentIdx}_${endBoundary.segmentIndex}_${endBoundary.charIndex}`,
      startTime: startSegment.start,
      endTime: endBoundary.time,
      duration,
      segmentStartIndex: startSegmentIdx,
      segmentEndIndex: endBoundary.segmentIndex,
      text,
      openingLine: startSegment.text.trim().slice(0, 100),
      closingLine: this.extractClosingLine(text),
      naturalStart: this.isNaturalStart(segments, startSegmentIdx),
      naturalEnd: true, // Ended at sentence boundary
      heuristicScore: this.scoreCandidateEnhanced(windowSegments, duration, text, true)
    }
  }

  private buildTextFromBoundaries(
    segments: TranscriptSegmentInput[],
    startBoundary: SentenceBoundary,
    endBoundary: SentenceBoundary
  ): string {
    let text = ''

    for (let i = startBoundary.segmentIndex; i <= endBoundary.segmentIndex; i++) {
      const segment = segments[i]
      let segmentText = segment.text.trim()

      // Trim start of first segment if boundary is mid-segment
      if (i === startBoundary.segmentIndex && startBoundary.charIndex > 0) {
        segmentText = segmentText.slice(startBoundary.charIndex).trim()
      }

      // Trim end of last segment to boundary
      if (i === endBoundary.segmentIndex) {
        const fullText = segment.text.trim()
        if (i === startBoundary.segmentIndex && startBoundary.charIndex > 0) {
          // Already trimmed the start, need to adjust end index
          const adjustedEndIndex = endBoundary.charIndex - startBoundary.charIndex
          segmentText = segmentText.slice(0, adjustedEndIndex).trim()
        } else {
          segmentText = fullText.slice(0, endBoundary.charIndex).trim()
        }
      }

      text += segmentText + ' '
    }

    return text.trim()
  }

  private extractOpeningLine(text: string): string {
    const firstSentence = text.split(/[.!?]/)[0]
    return (firstSentence || text).slice(0, 100).trim()
  }

  private extractClosingLine(text: string): string {
    const sentences = text.split(/[.!?]/).filter(s => s.trim())
    const lastSentence = sentences[sentences.length - 1] || text
    return lastSentence.slice(-100).trim()
  }

  // Legacy method for fallback when sentence boundaries are sparse
  private generateSegmentBoundedCandidates(segments: TranscriptSegmentInput[]): ClipCandidate[] {
    const candidates: ClipCandidate[] = []

    for (let startIndex = 0; startIndex < segments.length; startIndex++) {
      const startSegment = segments[startIndex]

      for (let endIndex = startIndex; endIndex < segments.length; endIndex++) {
        const endSegment = segments[endIndex]
        const duration = endSegment.end - startSegment.start

        if (duration > this.hardMaxDuration) {
          break
        }

        if (duration < this.hardMinDuration) {
          continue
        }

        const windowSegments = segments.slice(startIndex, endIndex + 1)
        const text = windowSegments.map(segment => segment.text.trim()).join(' ').trim()
        if (!text) {
          continue
        }

        const naturalStart = this.isNaturalStart(segments, startIndex)
        const naturalEnd = this.isNaturalEnd(segments, endIndex)
        const endedOnSentence = /[.!?]["']?$/.test(endSegment.text.trim())

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
          naturalStart,
          naturalEnd,
          heuristicScore: this.scoreCandidateEnhanced(windowSegments, duration, text, endedOnSentence)
        }

        candidates.push(candidate)
      }
    }

    return candidates
  }

  private scoreCandidateEnhanced(
    segments: TranscriptSegmentInput[],
    duration: number,
    text: string,
    endedOnSentence: boolean
  ): number {
    const firstSegment = segments[0]
    const lastSegment = segments[segments.length - 1]
    const normalizedText = text.toLowerCase()

    // Duration scoring with soft preference (ideal around 52.5s for natural pacing)
    const inSoftRange = duration >= this.softMinDuration && duration <= this.softMaxDuration
    const idealDurationScore = inSoftRange
      ? 1 - Math.min(Math.abs(duration - 52.5) / 22.5, 1)
      : 0.4 // Penalty for outside soft range

    const openingHookScore = this.scoreOpeningHook(firstSegment.text)

    // Enhanced ending score: major bonus for sentence boundaries
    const baseEndingScore = /[.!?]["']?$/.test(lastSegment.text.trim()) ? 1 : 0.2
    const endingScore = endedOnSentence ? 1.5 : baseEndingScore

    const fillerPenalty = this.countFillers(normalizedText) * 0.08
    const pronounContextPenalty = this.countContextReferences(normalizedText) * 0.05
    const sentenceCount = text.split(/[.!?]+/).map(part => part.trim()).filter(Boolean).length
    const densityScore = Math.min(sentenceCount / 5, 1)

    const naturalStartBonus = this.looksLikeSentenceStart(firstSegment.text) ? 0.8 : 0
    const naturalEndBonus = endedOnSentence ? 1.2 : 0

    return (
      idealDurationScore * 3 +
      openingHookScore * 2.5 +
      endingScore * 2.5 +  // Increased weight for ending quality
      densityScore * 1.5 +
      naturalStartBonus +
      naturalEndBonus -
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

    const pickCandidate = (candidate: ClipCandidate, maxOverlap = 0.65) => {
      const overlapsTooMuch = selected.some(existing => this.overlapRatio(existing, candidate) > maxOverlap)
      if (!overlapsTooMuch) {
        selected.push(candidate)
      }
    }

    // First pass: prioritize candidates with natural boundaries
    for (const candidate of candidates) {
      if (!candidate.naturalStart || !candidate.naturalEnd) {
        continue
      }
      pickCandidate(candidate)
      if (selected.length >= this.maxCandidates) {
        break
      }
    }

    // Fallback for rough Whisper transcripts with weak punctuation/casing
    if (selected.length < this.minPreferredCandidates) {
      for (const candidate of candidates) {
        if (selected.some(existing => existing.id === candidate.id)) {
          continue
        }

        pickCandidate(candidate, 0.82)
        if (selected.length >= Math.min(this.maxCandidates, this.maxSupplementalCandidates)) {
          break
        }
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

  private isNaturalStart(segments: TranscriptSegmentInput[], index: number): boolean {
    const current = segments[index]
    const previous = segments[index - 1]

    if (!current) return false
    if (!previous) return this.looksLikeSentenceStart(current.text)

    const hasGap = current.start - previous.end >= 0.35
    return hasGap || /[.!?]["']?$/.test(previous.text.trim()) || this.looksLikeSentenceStart(current.text)
  }

  private isNaturalEnd(segments: TranscriptSegmentInput[], index: number): boolean {
    const current = segments[index]
    const next = segments[index + 1]

    if (!current) return false
    if (!next) return this.looksLikeThoughtEnding(current.text)

    const hasGap = next.start - current.end >= 0.35
    if (hasGap) {
      return this.looksLikeThoughtEnding(current.text)
    }

    if (this.looksLikeThoughtEnding(current.text) && this.looksLikeSentenceStart(next.text)) {
      return true
    }

    return false
  }

  private looksLikeSentenceStart(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) {
      return false
    }

    return !/^(and|but|so|because|then)\b/i.test(trimmed)
  }

  private looksLikeThoughtEnding(text: string): boolean {
    const trimmed = text.trim()
    if (!trimmed) {
      return false
    }

    if (/[.!?]["']?$/.test(trimmed)) {
      return true
    }

    const normalized = trimmed.toLowerCase()
    const words = normalized.split(/\s+/).filter(Boolean)
    if (words.length < 8) {
      return false
    }

    const trailingPhrase = words.slice(-3).join(' ')
    if (
      /\b(and|but|or|so|because|then|which|that|if|when|while|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
      /\b(a|an|the|my|your|our|their|this|that|these|those)\s*$/.test(normalized) ||
      /\b(it'?s like|kind of|sort of|you know|i mean)\s*$/.test(trailingPhrase)
    ) {
      return false
    }

    const lastWord = words[words.length - 1]
    if (!lastWord || lastWord.length <= 2) {
      return false
    }

    return true
  }
}

export const clipCandidateService = new ClipCandidateService()
export default clipCandidateService
