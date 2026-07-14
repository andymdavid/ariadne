import { join } from 'path'
import { tmpdir } from 'os'
import { promises as fs } from 'fs'
import { randomUUID } from 'crypto'
import { database } from '../database/database'
import { ffmpegService } from './ffmpegService'
import LocalWhisperService from './localWhisperService'

const BOUNDARY_WINDOW_SECONDS = 2.2
const QA_WHISPER_MODEL = 'base'

type BoundaryCheck = {
  status: 'pass' | 'warn' | 'fail'
  expectedWord: string | null
  heardWords: string[]
  reason: string
}

export type ClipBoundaryQaResult = {
  clipId: string
  status: 'pass' | 'warn' | 'fail' | 'skipped'
  head: BoundaryCheck | null
  tail: BoundaryCheck | null
}

const normalizeToken = (token: string) =>
  token.toLowerCase().replace(/[^a-z0-9']/g, '')

const tokenize = (text: string) =>
  text.split(/\s+/).map(normalizeToken).filter(Boolean)

const tokensMatch = (expected: string, heard: string) => {
  if (!expected || !heard) return false
  if (expected === heard) return true
  // Tolerate partial decode of a word at a window edge
  return (
    (expected.length >= 4 && heard.startsWith(expected.slice(0, 4))) ||
    (heard.length >= 4 && expected.startsWith(heard.slice(0, 4)))
  )
}

/**
 * Post-finalization boundary QA: re-transcribe the first/last seconds of each clip
 * from the source media and mechanically verify that the boundary words are intact —
 * the first expected word is heard at the head without intruding speech before it,
 * and the last expected word is heard at the tail without intruding speech after it.
 * This is the "inspect the render" step: every boundary regression this project has
 * shipped would have been caught by this check.
 */
class ClipBoundaryQaService {
  private whisper = new LocalWhisperService()

  async runForEpisodeClips(episodeId: string, clipIds: string[]): Promise<ClipBoundaryQaResult[]> {
    const episode = database.getEpisode(episodeId) as { file_path?: string } | undefined
    if (!episode?.file_path) {
      console.warn('[ClipBoundaryQA] Episode media not found, skipping QA:', episodeId)
      return []
    }

    const results: ClipBoundaryQaResult[] = []
    for (const clipId of clipIds) {
      try {
        const result = await this.runForClip(episode.file_path, clipId)
        results.push(result)
        database.saveClipBoundaryQa(clipId, result.status, JSON.stringify(result))
      } catch (error) {
        console.error('[ClipBoundaryQA] Check failed for clip', clipId, error)
        const failure: ClipBoundaryQaResult = {
          clipId,
          status: 'skipped',
          head: null,
          tail: null
        }
        results.push(failure)
        database.saveClipBoundaryQa(clipId, 'skipped', JSON.stringify({
          error: error instanceof Error ? error.message : 'unknown'
        }))
      }
    }

    const summary = results.reduce<Record<string, number>>((acc, result) => {
      acc[result.status] = (acc[result.status] ?? 0) + 1
      return acc
    }, {})
    console.log('[ClipBoundaryQA] Episode summary:', episodeId, summary)
    return results
  }

  private async runForClip(mediaPath: string, clipId: string): Promise<ClipBoundaryQaResult> {
    const clip = database.getClip(clipId) as { start_time: number; end_time: number } | undefined
    if (!clip) {
      return { clipId, status: 'skipped', head: null, tail: null }
    }

    const segments = database.getClipTranscriptSegments(clipId) as Array<{
      words?: Array<{ word: string; start: number; end: number }>
    }>
    const words = segments
      .flatMap((segment) => segment.words ?? [])
      .filter((word) => word.end > clip.start_time && word.start < clip.end_time)
      .sort((left, right) => left.start - right.start)

    if (words.length === 0) {
      return { clipId, status: 'skipped', head: null, tail: null }
    }

    const expectedFirst = normalizeToken(words[0].word)
    const expectedLast = normalizeToken(words[words.length - 1].word)

    const head = await this.checkBoundary(
      mediaPath,
      clip.start_time,
      'head',
      expectedFirst
    )
    const tail = await this.checkBoundary(
      mediaPath,
      Math.max(0, clip.end_time - BOUNDARY_WINDOW_SECONDS),
      'tail',
      expectedLast
    )

    const status = head.status === 'fail' || tail.status === 'fail'
      ? 'fail'
      : head.status === 'warn' || tail.status === 'warn'
        ? 'warn'
        : 'pass'

    return { clipId, status, head, tail }
  }

  private async checkBoundary(
    mediaPath: string,
    windowStart: number,
    boundary: 'head' | 'tail',
    expectedWord: string
  ): Promise<BoundaryCheck> {
    const tempPath = join(tmpdir(), `ariadne-qa-${randomUUID()}.wav`)
    try {
      await ffmpegService.extractAudioSegment(mediaPath, windowStart, BOUNDARY_WINDOW_SECONDS, tempPath)
      const transcription = await this.whisper.transcribe(tempPath, { model: QA_WHISPER_MODEL })
      const heardWords = tokenize(transcription.text)

      if (heardWords.length === 0) {
        // Silence at a boundary window is fine at the head (lead-in pause) and
        // suspicious at the tail (the final word should be audible in-window).
        return boundary === 'head'
          ? { status: 'pass', expectedWord, heardWords, reason: 'boundary window is silent' }
          : { status: 'warn', expectedWord, heardWords, reason: 'expected final word but window is silent' }
      }

      if (boundary === 'head') {
        const matchIndex = heardWords.findIndex((word) => tokensMatch(expectedWord, word))
        if (matchIndex === -1) {
          return { status: 'fail', expectedWord, heardWords, reason: 'first expected word not heard — onset likely clipped' }
        }
        if (matchIndex > 0) {
          return {
            status: 'warn',
            expectedWord,
            heardWords,
            reason: `${matchIndex} word(s) heard before the expected first word — intruding speech at clip start`
          }
        }
        return { status: 'pass', expectedWord, heardWords, reason: 'clip starts on the expected word' }
      }

      const lastIndexFromEnd = [...heardWords].reverse().findIndex((word) => tokensMatch(expectedWord, word))
      if (lastIndexFromEnd === -1) {
        return { status: 'fail', expectedWord, heardWords, reason: 'last expected word not heard — tail likely clipped' }
      }
      if (lastIndexFromEnd > 0) {
        return {
          status: 'warn',
          expectedWord,
          heardWords,
          reason: `${lastIndexFromEnd} word(s) heard after the expected last word — intruding speech at clip end`
        }
      }
      return { status: 'pass', expectedWord, heardWords, reason: 'clip ends on the expected word' }
    } finally {
      await fs.unlink(tempPath).catch(() => {})
    }
  }
}

export const clipBoundaryQaService = new ClipBoundaryQaService()
export default clipBoundaryQaService
