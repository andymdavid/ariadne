import { randomUUID } from 'crypto'
import { buildTranscriptLinesFromSegments, type TranscriptLineDraft, type TranscriptLineSegmentInput, type TranscriptLineWord } from '../../shared/transcriptLines'
import type { PipelineWorkerTranscription } from '@shared/types/pipelineWorker'

type CanonicalTimelineSource = 'whisper_transcription_v1' | 'stored_transcript_segments_v1'

type StoredTranscriptSegment = {
  id?: string | number
  start_time?: number
  end_time?: number
  text?: string
  words?: Array<{ word: string; start: number; end: number }>
}

export interface CanonicalTimelineSegment {
  id: string
  start: number
  end: number
  text: string
  words: TranscriptLineWord[]
}

export interface CanonicalTimelineLine extends TranscriptLineDraft {}

export interface CanonicalTimeline {
  source: CanonicalTimelineSource
  text: string
  duration: number
  wordCount: number
  segments: CanonicalTimelineSegment[]
  lines: CanonicalTimelineLine[]
}

class CanonicalTimelineService {
  buildFromTranscription(transcription: PipelineWorkerTranscription): CanonicalTimeline {
    return this.buildTimeline(
      transcription.segments.map((segment, index) => ({
        id: segment.id ?? index,
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        text: String(segment.text ?? ''),
        words: Array.isArray(segment.words)
          ? segment.words.map((word) => ({
              word: String(word.word ?? '').trim(),
              start: Number(word.start ?? 0),
              end: Number(word.end ?? 0)
            }))
          : undefined
      })),
      String(transcription.text ?? ''),
      'whisper_transcription_v1'
    )
  }

  buildFromStoredSegments(segments: StoredTranscriptSegment[]): CanonicalTimeline {
    return this.buildTimeline(
      segments.map((segment, index) => ({
        id: segment.id ?? index,
        start: Number(segment.start_time ?? 0),
        end: Number(segment.end_time ?? 0),
        text: String(segment.text ?? ''),
        words: Array.isArray(segment.words)
          ? segment.words.map((word) => ({
              word: String(word.word ?? '').trim(),
              start: Number(word.start ?? 0),
              end: Number(word.end ?? 0)
            }))
          : undefined
      })),
      segments.map((segment) => String(segment.text ?? '').trim()).filter(Boolean).join(' '),
      'stored_transcript_segments_v1'
    )
  }

  toTranscriptSegmentRows(episodeId: string, timeline: CanonicalTimeline) {
    return timeline.segments.map((segment) => ({
      id: randomUUID(),
      episodeId,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text,
      confidence: 1.0,
      speaker: undefined,
      words: segment.words.length > 0 ? segment.words : undefined
    }))
  }

  toTranscriptLineRows(episodeId: string, timeline: CanonicalTimeline) {
    return timeline.lines.map((line) => ({
      id: randomUUID(),
      episodeId,
      lineIndex: line.lineIndex,
      startTime: line.start,
      endTime: line.end,
      text: line.text,
      words: line.words,
      sourceStrategy: line.sourceStrategy
    }))
  }

  private buildTimeline(
    segments: TranscriptLineSegmentInput[],
    transcriptionText: string,
    source: CanonicalTimelineSource
  ): CanonicalTimeline {
    const normalizedSegments = segments
      .map((segment, index) => ({
        id: String(segment.id ?? index),
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        text: String(segment.text ?? '').trim(),
        words: Array.isArray(segment.words)
          ? segment.words
              .map((word) => ({
                word: String(word.word ?? '').trim(),
                start: Number(word.start ?? 0),
                end: Number(word.end ?? 0)
              }))
              .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end > word.start)
          : []
      }))
      .filter((segment) => segment.text || segment.words.length > 0)
      .sort((left, right) => left.start - right.start)

    const lines = buildTranscriptLinesFromSegments(
      normalizedSegments.map((segment) => ({
        id: segment.id,
        start: segment.start,
        end: segment.end,
        text: segment.text,
        words: segment.words
      }))
    )

    const duration =
      normalizedSegments.length > 0
        ? Math.max(0, normalizedSegments[normalizedSegments.length - 1].end - normalizedSegments[0].start)
        : 0

    const wordCount = normalizedSegments.reduce((total, segment) => total + segment.words.length, 0)

    return {
      source,
      text: transcriptionText.trim(),
      duration,
      wordCount,
      segments: normalizedSegments,
      lines
    }
  }
}

export const canonicalTimelineService = new CanonicalTimelineService()
export default canonicalTimelineService
