import { randomUUID } from 'crypto'
import { database } from '../database/database'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'

class TranscriptLineService {
  ensureEpisodeTranscriptLines(episodeId: string) {
    const existingLines = database.getTranscriptLines(episodeId) as Array<unknown>
    if (existingLines.length > 0) {
      return existingLines
    }

    const segments = database.getTranscriptSegments(episodeId) as Array<{
      id: string
      start_time?: number
      end_time?: number
      text?: string
      words?: Array<{ word: string; start: number; end: number }>
    }>

    if (!segments.length) {
      return []
    }

    const builtLines = buildTranscriptLinesFromSegments(
      segments.map((segment, index) => ({
        id: segment.id ?? index,
        start: Number(segment.start_time ?? 0),
        end: Number(segment.end_time ?? 0),
        text: String(segment.text ?? ''),
        words: Array.isArray(segment.words) ? segment.words : undefined
      }))
    ).map((line) => ({
      id: randomUUID(),
      episodeId,
      lineIndex: line.lineIndex,
      startTime: line.start,
      endTime: line.end,
      text: line.text,
      words: line.words,
      sourceStrategy: line.sourceStrategy
    }))

    database.replaceTranscriptLinesForEpisode(episodeId, builtLines)
    return database.getTranscriptLines(episodeId)
  }

  getClipTranscriptLines(clipId: string) {
    const clip = database.getClip(clipId) as any
    if (!clip) {
      return []
    }

    this.ensureEpisodeTranscriptLines(String(clip.episode_id))
    return database.getClipTranscriptLines(clipId)
  }
}

export const transcriptLineService = new TranscriptLineService()
export default transcriptLineService
