export interface AudioChunk {
  path: string
  startTime: number
  duration: number
}

export interface TranscriptWord {
  word: string
  start: number
  end: number
}

export interface TranscriptSegmentInput {
  id: number
  start: number
  end: number
  text: string
  words?: TranscriptWord[]
}

export interface ClipCandidate {
  id: string
  startTime: number
  endTime: number
  duration: number
  segmentStartIndex: number
  segmentEndIndex: number
  text: string
  openingLine: string
  closingLine: string
  naturalStart: boolean
  naturalEnd: boolean
  heuristicScore: number
}

export interface SentenceBoundary {
  segmentIndex: number
  charIndex: number      // Character index within segment text where sentence ends
  time: number           // End time of the terminal word
  sentenceText: string   // The sentence text up to this boundary
  punctuation: '.' | '!' | '?'
}

export interface RankedClipSelection {
  id: string
  candidateId: string
  startTime: number
  endTime: number
  duration: number
  contentType: 'insight' | 'story' | 'advice' | 'hot_take' | 'humor' | 'technical'
  shareabilityScore: number
  keyQuote: string
  reason: string
  contextNeeded: 'low' | 'medium' | 'high'
  transcriptText: string
  naturalStart: boolean
  naturalEnd: boolean
  heuristicScore: number
  validationScore: number
}
