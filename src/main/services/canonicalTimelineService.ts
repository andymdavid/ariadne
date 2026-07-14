import type {
  CanonicalConversationalTimeline,
  CanonicalSilence,
  CanonicalTranscriptSegment,
  CanonicalTimedWord,
  CanonicalTranscriptLine
} from '../../shared/canonicalTimeline'
import type { StructuredConversationLine } from './aiService'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'
import type { PipelineWorkerTranscriptSegment, PipelineWorkerTranscription } from '@shared/types/pipelineWorker'

class CanonicalTimelineService {
  buildFromTranscription(
    transcription: PipelineWorkerTranscription,
    silences?: CanonicalSilence[]
  ): CanonicalConversationalTimeline {
    const mediaDuration = transcription.segments.reduce(
      (duration, segment) => Math.max(duration, Number(segment.end ?? 0)),
      0
    )
    return this.buildFromWhisperTranscription({ transcription, mediaDuration, silences })
  }

  buildFromWhisperTranscription(input: {
    transcription: PipelineWorkerTranscription
    mediaDuration: number
    silences?: CanonicalSilence[]
  }): CanonicalConversationalTimeline {
    const segments = this.normalizeSegments(input.transcription.segments)
    // Thought-aware lines (sentence/pause-shaped) — NOT raw Whisper segments. Whisper
    // segments are ~5s acoustic chunks that split sentences mid-phrase, and any clip
    // boundary chosen from them inherits that. See docs/clip-boundary-redesign-plan.md.
    const transcriptLines = buildTranscriptLinesFromSegments(input.transcription.segments)
    const canonicalWords: CanonicalTimedWord[] = []
    const wordIdByKey = new Map<string, string>()

    for (const segment of input.transcription.segments) {
      for (const word of segment.words ?? []) {
        if (!word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) {
          continue
        }

        const id = `word_${canonicalWords.length + 1}`
        canonicalWords.push({
          id,
          lineId: null,
          word: word.word.trim(),
          startTime: Number(word.start),
          endTime: Number(word.end),
          speaker: null,
          timingSource: 'whisper'
        })
        wordIdByKey.set(this.wordKey(word.word, word.start, word.end), id)
      }
    }

    const lines: CanonicalTranscriptLine[] = transcriptLines.map((line) => {
      const wordIds = line.words
        .map((word) => wordIdByKey.get(this.wordKey(word.word, word.start, word.end)))
        .filter((id): id is string => Boolean(id))
      const lineId = `line_${line.lineIndex}`

      for (const wordId of wordIds) {
        const canonicalWord = canonicalWords.find((word) => word.id === wordId)
        if (canonicalWord) {
          canonicalWord.lineId = lineId
        }
      }

      return {
        id: lineId,
        index: line.lineIndex,
        startTime: Number.isFinite(line.start) ? Number(line.start) : null,
        endTime: Number.isFinite(line.end) ? Number(line.end) : null,
        speaker: null,
        text: line.text,
        wordIds,
        semanticSource: 'whisper',
        timingSource: wordIds.length > 0 ? 'whisper' : 'none'
      }
    })

    const linesWithTiming = lines.filter((line) => line.startTime !== null && line.endTime !== null).length
    const estimatedWordCount = input.transcription.text.split(/\s+/).filter(Boolean).length
    const issues: string[] = []
    if (lines.length === 0) issues.push('no_canonical_lines')
    if (canonicalWords.length === 0) issues.push('no_timed_words')

    return {
      mediaDuration: input.mediaDuration,
      segments,
      lines,
      words: canonicalWords,
      silences: input.silences ?? [],
      sourceMetadata: {
        transcriptInputMode: 'whisper_generated',
        semanticTextSource: 'whisper',
        timingSource: canonicalWords.length > 0 ? 'whisper' : 'none',
        speakerSource: null,
        sourceStrategy: 'whisper_thought_lines_v1'
      },
      quality: {
        lineCount: lines.length,
        timedWordCount: canonicalWords.length,
        linesWithTiming,
        wordTimingCoverage: estimatedWordCount > 0 ? Math.min(1, canonicalWords.length / estimatedWordCount) : 0,
        hasSpeakers: false,
        issues
      }
    }
  }

  buildFromStructuredConversation(input: {
    transcription: PipelineWorkerTranscription
    mediaDuration: number
    structuredLines: StructuredConversationLine[]
    silences?: CanonicalSilence[]
  }): CanonicalConversationalTimeline {
    const segments = this.normalizeSegments(input.transcription.segments)
    const canonicalWords: CanonicalTimedWord[] = []
    const wordIdByKey = new Map<string, string>()

    for (const segment of input.transcription.segments) {
      for (const word of segment.words ?? []) {
        if (!word.word.trim() || !Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) {
          continue
        }

        const id = `word_${canonicalWords.length + 1}`
        canonicalWords.push({
          id,
          lineId: null,
          word: word.word.trim(),
          startTime: Number(word.start),
          endTime: Number(word.end),
          speaker: null,
          timingSource: 'whisper'
        })
        wordIdByKey.set(this.wordKey(word.word, word.start, word.end), id)
      }
    }

    const lines: CanonicalTranscriptLine[] = input.structuredLines
      .map((structuredLine, index): CanonicalTranscriptLine | null => {
        const coveredSegments = segments.filter((segment) =>
          segment.id >= structuredLine.startSegmentId &&
          segment.id <= structuredLine.endSegmentId
        )
        if (coveredSegments.length === 0) {
          return null
        }

        const wordIds = coveredSegments
          .flatMap((segment) => segment.words ?? [])
          .map((word) => wordIdByKey.get(this.wordKey(word.word, word.start, word.end)))
          .filter((id): id is string => Boolean(id))
        const firstSegment = coveredSegments[0]
        const lastSegment = coveredSegments[coveredSegments.length - 1]
        const lineId = `structured_line_${index}`

        for (const wordId of wordIds) {
          const canonicalWord = canonicalWords.find((word) => word.id === wordId)
          if (canonicalWord) {
            canonicalWord.lineId = lineId
            canonicalWord.speaker = structuredLine.speaker
          }
        }

        return {
          id: lineId,
          index,
          startTime: wordIds.length > 0
            ? canonicalWords.find((word) => word.id === wordIds[0])?.startTime ?? firstSegment.start
            : firstSegment.start,
          endTime: wordIds.length > 0
            ? canonicalWords.find((word) => word.id === wordIds[wordIds.length - 1])?.endTime ?? lastSegment.end
            : lastSegment.end,
          speaker: structuredLine.speaker,
          text: structuredLine.text,
          wordIds,
          semanticSource: 'whisper',
          timingSource: wordIds.length > 0 ? 'whisper' : 'none'
        }
      })
      .filter((line): line is CanonicalTranscriptLine => Boolean(line))

    if (lines.length === 0) {
      return this.buildFromWhisperTranscription({
        transcription: input.transcription,
        mediaDuration: input.mediaDuration,
        silences: input.silences
      })
    }

    const linesWithTiming = lines.filter((line) => line.startTime !== null && line.endTime !== null).length
    const estimatedWordCount = input.transcription.text.split(/\s+/).filter(Boolean).length
    return {
      mediaDuration: input.mediaDuration,
      segments,
      lines,
      words: canonicalWords,
      silences: input.silences ?? [],
      sourceMetadata: {
        transcriptInputMode: 'whisper_generated',
        semanticTextSource: 'whisper',
        timingSource: canonicalWords.length > 0 ? 'whisper' : 'none',
        speakerSource: null,
        sourceStrategy: 'conversation_structuring_v1'
      },
      quality: {
        lineCount: lines.length,
        timedWordCount: canonicalWords.length,
        linesWithTiming,
        wordTimingCoverage: estimatedWordCount > 0 ? Math.min(1, canonicalWords.length / estimatedWordCount) : 0,
        hasSpeakers: lines.some((line) => Boolean(line.speaker)),
        issues: []
      }
    }
  }

  buildFromStoredSegments(segments: Array<{
    id: string | number
    start_time?: number
    end_time?: number
    startTime?: number
    endTime?: number
    text?: string
    words?: Array<{ word: string; start: number; end: number }>
  }>): CanonicalConversationalTimeline {
    const normalizedSegments = segments.map((segment, index): PipelineWorkerTranscriptSegment => ({
      id: Number.isFinite(Number(segment.id)) ? Number(segment.id) : index,
      start: Number(segment.start_time ?? segment.startTime ?? 0),
      end: Number(segment.end_time ?? segment.endTime ?? 0),
      text: String(segment.text ?? ''),
      words: segment.words
    }))
    return this.buildFromTranscription({
      text: normalizedSegments.map((segment) => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
      segments: normalizedSegments
    })
  }

  toTranscriptSegmentRows(episodeId: string, timeline: CanonicalConversationalTimeline) {
    return timeline.segments.map((segment, index) => ({
      id: `${episodeId}_segment_${index}`,
      episodeId,
      startTime: segment.start,
      endTime: segment.end,
      text: segment.text,
      confidence: 1,
      speaker: undefined,
      words: segment.words
    }))
  }

  toTranscriptLineRows(episodeId: string, timeline: CanonicalConversationalTimeline) {
    const wordById = new Map(timeline.words.map((word) => [word.id, word]))
    return timeline.lines
      .filter((line) => line.startTime !== null && line.endTime !== null && line.text.trim())
      .map((line) => ({
        id: `${episodeId}_${line.id}`,
        episodeId,
        lineIndex: line.index,
        startTime: line.startTime ?? 0,
        endTime: line.endTime ?? line.startTime ?? 0,
        text: line.text,
        words: line.wordIds
          .map((wordId) => wordById.get(wordId))
          .filter((word): word is CanonicalTimedWord => Boolean(word))
          .map((word) => ({
            word: word.word,
            start: word.startTime,
            end: word.endTime
          })),
        sourceStrategy: timeline.sourceMetadata.sourceStrategy
      }))
  }

  private wordKey(word: string, start: number, end: number) {
    return `${word.trim()}|${Number(start).toFixed(3)}|${Number(end).toFixed(3)}`
  }

  private normalizeSegments(segments: PipelineWorkerTranscriptSegment[]): CanonicalTranscriptSegment[] {
    return segments
      .filter((segment) => String(segment.text ?? '').trim())
      .sort((left, right) => Number(left.start ?? 0) - Number(right.start ?? 0))
      .map((segment, index) => ({
        id: Number.isFinite(Number(segment.id)) ? Number(segment.id) : index,
        start: Number(segment.start ?? 0),
        end: Number(segment.end ?? 0),
        text: String(segment.text ?? '').replace(/\s+/g, ' ').trim(),
        words: (segment.words ?? [])
          .filter((word) =>
            String(word.word ?? '').trim() &&
            Number.isFinite(word.start) &&
            Number.isFinite(word.end) &&
            word.end > word.start
          )
          .map((word) => ({
            word: String(word.word ?? '').trim(),
            start: Number(word.start),
            end: Number(word.end)
          }))
      }))
  }
}

export const canonicalTimelineService = new CanonicalTimelineService()
export default canonicalTimelineService
