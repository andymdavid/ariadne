import { database } from '../database/database'
import { canonicalTimelineService } from './canonicalTimelineService'

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

    const canonicalTimeline = canonicalTimelineService.buildFromStoredSegments(segments)
    const builtLines = canonicalTimelineService.toTranscriptLineRows(episodeId, canonicalTimeline)

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
