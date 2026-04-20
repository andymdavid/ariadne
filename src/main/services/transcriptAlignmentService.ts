import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ffmpegService } from './ffmpegService'
import LocalWhisperService from './localWhisperService'
import { database } from '../database/database'

type TranscriptWord = {
  word: string
  start: number
  end: number
}

type TranscriptLine = {
  id: string
  line_index?: number
  start_time: number
  end_time: number
  text: string
  words?: TranscriptWord[]
}

const normalizeWordToken = (value: string) =>
  value
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/gi, '')

const alignLineWords = (
  text: string,
  sourceWords: TranscriptWord[],
  lineStart: number,
  lineEnd: number,
  sourceCursor: number
) => {
  const targetWords = text.split(/\s+/).map((word) => word.trim()).filter(Boolean)
  if (targetWords.length === 0) {
    return { words: [] as TranscriptWord[], nextCursor: sourceCursor }
  }

  const usableSourceWords = sourceWords.filter(
    (word) =>
      word.word?.trim() &&
      Number.isFinite(word.start) &&
      Number.isFinite(word.end) &&
      word.end > word.start
  )

  if (usableSourceWords.length === 0) {
    const totalDuration = Math.max(lineEnd - lineStart, 0.01)
    const wordDuration = totalDuration / targetWords.length
    return {
      words: targetWords.map((word, index) => ({
        word,
        start: lineStart + index * wordDuration,
        end: index === targetWords.length - 1 ? lineEnd : lineStart + (index + 1) * wordDuration
      })),
      nextCursor: sourceCursor
    }
  }

  const matches = new Array<number>(targetWords.length).fill(-1)
  let scanCursor = Math.max(0, sourceCursor)

  targetWords.forEach((word, targetIndex) => {
    const normalizedTarget = normalizeWordToken(word)
    while (scanCursor < usableSourceWords.length) {
      const normalizedSource = normalizeWordToken(usableSourceWords[scanCursor].word)
      if (normalizedTarget.length > 0 && normalizedTarget === normalizedSource) {
        matches[targetIndex] = scanCursor
        scanCursor += 1
        return
      }
      scanCursor += 1
    }
  })

  const alignedWords = targetWords.map((word, targetIndex) => {
    const matchedSourceIndex = matches[targetIndex]
    if (matchedSourceIndex >= 0) {
      const matchedWord = usableSourceWords[matchedSourceIndex]
      return {
        word,
        start: matchedWord.start,
        end: matchedWord.end
      }
    }

    let previousMatchedTarget = targetIndex - 1
    while (previousMatchedTarget >= 0 && matches[previousMatchedTarget] < 0) {
      previousMatchedTarget -= 1
    }

    let nextMatchedTarget = targetIndex + 1
    while (nextMatchedTarget < matches.length && matches[nextMatchedTarget] < 0) {
      nextMatchedTarget += 1
    }

    const gapStart =
      previousMatchedTarget >= 0
        ? usableSourceWords[matches[previousMatchedTarget]].end
        : lineStart
    const gapEnd =
      nextMatchedTarget < matches.length
        ? usableSourceWords[matches[nextMatchedTarget]].start
        : lineEnd
    const unmatchedStart = previousMatchedTarget + 1
    const unmatchedEndExclusive =
      nextMatchedTarget < matches.length ? nextMatchedTarget : targetWords.length
    const unmatchedCount = Math.max(1, unmatchedEndExclusive - unmatchedStart)
    const unmatchedIndex = targetIndex - unmatchedStart
    const sliceDuration = Math.max(gapEnd - gapStart, 0.01)
    const wordDuration = sliceDuration / unmatchedCount
    const start = gapStart + unmatchedIndex * wordDuration
    const end =
      targetIndex === unmatchedEndExclusive - 1
        ? gapEnd
        : Math.min(gapEnd, start + wordDuration)

    return {
      word,
      start,
      end: Math.max(end, start + 0.01)
    }
  })

  const lastMatchedSourceIndex = Math.max(...matches)
  return {
    words: alignedWords,
    nextCursor: lastMatchedSourceIndex >= 0 ? lastMatchedSourceIndex + 1 : sourceCursor
  }
}

class TranscriptAlignmentService {
  async realignClipTranscript(clipId: string) {
    const clip = database.getClip(clipId) as any
    if (!clip) {
      throw new Error('Clip not found')
    }

    const episode = database.getEpisode(clip.episode_id) as any
    if (!episode?.file_path) {
      throw new Error('Episode media source not found')
    }

    const transcriptLines = database.getClipTranscriptLines(clipId) as TranscriptLine[]
    if (!transcriptLines.length) {
      return []
    }

    const tempBase = join(tmpdir(), `ariadne-align-${clipId}-${randomUUID()}`)
    const clipMediaPath = `${tempBase}.mp4`
    const whisperService = new LocalWhisperService()

    try {
      await ffmpegService.createClip(
        episode.file_path,
        Number(clip.start_time),
        Math.max(0.1, Number(clip.end_time) - Number(clip.start_time)),
        clipMediaPath,
        { format: 'mp4' }
      )

      const transcription = await whisperService.transcribe(clipMediaPath, {
        model: 'medium',
        wordTimestamps: true
      })

      const clipRelativeWords = (transcription.segments || [])
        .flatMap((segment) => segment.words || [])
        .map((word) => ({
          word: String(word.word || ''),
          start: Number(word.start ?? 0),
          end: Number(word.end ?? 0)
        }))
        .filter((word) => word.word.trim() && word.end > word.start)

      let sourceCursor = 0
      for (const line of transcriptLines) {
        const lineStart = Number(line.start_time ?? 0) - Number(clip.start_time)
        const lineEnd = Number(line.end_time ?? 0) - Number(clip.start_time)
        const aligned = alignLineWords(
          String(line.text || ''),
          clipRelativeWords,
          Math.max(0, lineStart),
          Math.max(Math.max(0, lineStart) + 0.01, lineEnd),
          sourceCursor
        )
        sourceCursor = aligned.nextCursor

        await database.updateTranscriptLine(
          clip.episode_id,
          Number(line.line_index ?? 0),
          String(line.text || ''),
          aligned.words.map((word) => ({
            word: word.word,
            start: word.start + Number(clip.start_time),
            end: word.end + Number(clip.start_time)
          }))
        )
      }

      return database.getClipTranscriptLines(clipId)
    } finally {
      await fs.rm(clipMediaPath, { force: true }).catch(() => undefined)
    }
  }
}

export const transcriptAlignmentService = new TranscriptAlignmentService()
