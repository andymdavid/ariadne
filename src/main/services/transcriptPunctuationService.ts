import type AIService from './aiService'
import type { PipelineWorkerTranscription } from '@shared/types/pipelineWorker'

/**
 * Changes whenever restoration behavior changes. Folded into the media transcript
 * cache fingerprint so transcripts enriched under different rules are never reused.
 * Known accepted limitation: a run without an API key caches the raw transcript
 * under the same fingerprint and won't be re-enriched until the file changes.
 */
export const TRANSCRIPT_ENRICHMENT_SIGNATURE = 'punctuation_restoration_v1'

const BATCH_SIZE = 35

export type PunctuationRestorationResult = {
  transcription: PipelineWorkerTranscription
  diagnostics: {
    restoredSegments: number
    keptOriginalSegments: number
    batchesFailed: number
  }
}

const normalizeToken = (token: string) =>
  token.toLowerCase().replace(/[^a-z0-9']/g, '')

const tokenize = (text: string) =>
  text.split(/\s+/).map((token) => token.trim()).filter(Boolean)

/**
 * LLM punctuation/capitalization restoration for conversational Whisper output.
 *
 * Thought-line building, the dangling-ending heuristics, read-back quotes, and
 * captions all consume the WORD-TOKEN stream (not segment text), and sparse
 * punctuation starves all of them. This pass decorates the existing tokens and
 * never changes them: each restored line is validated token-by-token against the
 * original (normalized), and any line where the word stream differs keeps its
 * original text. Restoration failure at any level degrades to today's behavior.
 */
class TranscriptPunctuationService {
  async restorePunctuation(
    transcription: PipelineWorkerTranscription,
    aiService: AIService
  ): Promise<PunctuationRestorationResult> {
    const diagnostics = { restoredSegments: 0, keptOriginalSegments: 0, batchesFailed: 0 }

    // The restoration basis is the word-token stream when present (lines/captions
    // are built from it); segment text otherwise. Token indexes are per segment.
    const bases = transcription.segments.map((segment) => {
      const wordTokens = (segment.words ?? [])
        .map((word) => String(word.word ?? '').trim())
        .filter(Boolean)
      return wordTokens.length > 0 ? wordTokens.join(' ') : String(segment.text ?? '').trim()
    })

    const restoredBySegment = new Map<number, string>()
    for (let start = 0; start < bases.length; start += BATCH_SIZE) {
      const batch = bases
        .slice(start, start + BATCH_SIZE)
        .map((text, offset) => ({ index: start + offset, text }))
        .filter((line) => line.text)
      if (batch.length === 0) continue

      try {
        const restored = await aiService.restorePunctuationBatch(batch)
        for (const line of batch) {
          const candidate = restored[line.index]
          if (candidate && this.tokensMatch(line.text, candidate)) {
            restoredBySegment.set(line.index, candidate)
          }
        }
      } catch (error) {
        diagnostics.batchesFailed += 1
        console.warn('[TranscriptPunctuation] Batch failed, keeping original text:', error)
      }
    }

    const segments = transcription.segments.map((segment, index) => {
      const restored = restoredBySegment.get(index)
      if (!restored) {
        diagnostics.keptOriginalSegments += 1
        return segment
      }
      diagnostics.restoredSegments += 1

      const restoredTokens = tokenize(restored)
      const words = segment.words ?? []
      const wordTokens = words.map((word) => String(word.word ?? '').trim()).filter(Boolean)

      if (wordTokens.length > 0 && restoredTokens.length === wordTokens.length) {
        let tokenIndex = 0
        const restoredWords = words.map((word) => {
          if (!String(word.word ?? '').trim()) return word
          const token = restoredTokens[tokenIndex]
          tokenIndex += 1
          return { ...word, word: token }
        })
        return { ...segment, text: restored, words: restoredWords }
      }

      // Word stream unavailable or (rare) token-count mismatch against words while
      // matching the text basis: update display text only, leave word tokens raw.
      return { ...segment, text: restored }
    })

    const text = segments
      .map((segment) => String(segment.text ?? '').trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')

    return { transcription: { ...transcription, segments, text }, diagnostics }
  }

  private tokensMatch(original: string, restored: string) {
    const originalTokens = tokenize(original).map(normalizeToken).filter(Boolean)
    const restoredTokens = tokenize(restored).map(normalizeToken).filter(Boolean)
    if (originalTokens.length !== restoredTokens.length) return false
    return originalTokens.every((token, index) => token === restoredTokens[index])
  }
}

export const transcriptPunctuationService = new TranscriptPunctuationService()
export default transcriptPunctuationService
