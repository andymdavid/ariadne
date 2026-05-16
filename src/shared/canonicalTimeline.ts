export type CanonicalSemanticSource =
  | 'whisper'
  | 'uploaded_srt'
  | 'uploaded_vtt'
  | 'uploaded_txt'
  | 'aligned_txt'

export type CanonicalTimingSource =
  | 'whisper'
  | 'uploaded_word_timing'
  | 'uploaded_segment_timing'
  | 'whisper_alignment'
  | 'interpolated'
  | 'none'

export type CanonicalTranscriptInputMode =
  | 'whisper_generated'
  | 'timed_word_transcript'
  | 'timed_segment_transcript'
  | 'untimed_verbatim_transcript'
  | 'untimed_cleaned_transcript'
  | 'speaker_notes_or_summary'
  | 'mismatched_transcript'

export type CanonicalTimedWord = {
  id: string
  lineId: string | null
  word: string
  startTime: number
  endTime: number
  speaker: string | null
  timingSource: CanonicalTimingSource
}

export type CanonicalTranscriptLine = {
  id: string
  index: number
  startTime: number | null
  endTime: number | null
  speaker: string | null
  text: string
  wordIds: string[]
  semanticSource: CanonicalSemanticSource
  timingSource: CanonicalTimingSource
}

export type CanonicalTranscriptSegment = {
  id: number
  start: number
  end: number
  text: string
  words?: Array<{
    word: string
    start: number
    end: number
  }>
}

export type TranscriptSourceMetadata = {
  transcriptInputMode: CanonicalTranscriptInputMode
  semanticTextSource: CanonicalSemanticSource
  timingSource: CanonicalTimingSource
  speakerSource: CanonicalSemanticSource | null
  sourceStrategy: string
}

export type TranscriptQualityReport = {
  lineCount: number
  timedWordCount: number
  linesWithTiming: number
  wordTimingCoverage: number
  hasSpeakers: boolean
  issues: string[]
}

export type CanonicalConversationalTimeline = {
  mediaDuration: number
  segments: CanonicalTranscriptSegment[]
  lines: CanonicalTranscriptLine[]
  words: CanonicalTimedWord[]
  sourceMetadata: TranscriptSourceMetadata
  quality: TranscriptQualityReport
}
