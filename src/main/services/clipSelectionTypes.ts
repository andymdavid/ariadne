export interface AudioChunk {
  path: string
  startTime: number
  duration: number
}

export interface TranscriptSegmentInput {
  id: number
  start: number
  end: number
  text: string
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
  heuristicScore: number
}
