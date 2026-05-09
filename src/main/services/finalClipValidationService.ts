import type AIService from './aiService'
import type { ClipBoundaryReview, TranscriptBoundaryLine } from './aiService'
import type { PipelineWorkerPotentialClip, PipelineWorkerTranscription } from '@shared/types/pipelineWorker'
import {
  endsWithDanglingPhrase,
  endsWithTerminalPunctuation,
  getLeadingBoundaryIssue,
  getTrailingBoundaryIssue,
  isCleanClipEnd,
  isCleanClipStart,
  isCleanLocalClipEnd,
  looksLikeCompleteThought,
  startsLikeContinuation,
  stripLeadingBoundaryFiller,
} from '../../shared/clipBoundaryQuality'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'

const CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS = 10
const CLIP_REFINEMENT_MAX_SEMANTIC_END_EXTENSION_SECONDS = 24
const CLIP_REFINEMENT_TRAILING_PAD_SECONDS = 0.22
const CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS = 0.45
const CLIP_REFINEMENT_WORD_GUARD_SECONDS = 0.04
const THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS = 1.1
const SEMANTIC_CLIP_MAX_DURATION_SECONDS = 120
const RESOLVED_CLIP_MIN_DURATION_SECONDS = 25
const BOUNDARY_OPTIMIZER_MIN_SCORE = 45
const BOUNDARY_OPTIMIZER_SOFT_ACCEPT_SCORE = 25
const BOUNDARY_OPTIMIZER_ROUGH_CUT_SCORE = 18
const BOUNDARY_OPTIMIZER_HARD_START_BREAK_SECONDS = 1.1

type BoundaryAnchor = {
  time: number
  type: string
}

type BoundaryVariantScore = {
  clip: PipelineWorkerPotentialClip
  score: number
  cleanStart: boolean
  cleanEnd: boolean
  localEndClean: boolean
  hardEndIssue: string | null
  startBoundaryIssue: string | null
  startLookbackIssue: string | null
  lookaheadIssue: string | null
  endingPreview: string
  openingPreview: string
  movementSeconds: number
  variantType: string
  editOperation: string
  fatalIssues: string[]
}

export interface SemanticBoundaryReviewResult {
  clips: PipelineWorkerPotentialClip[]
  reviews: ClipBoundaryReview[]
  usedAI: boolean
  fallbackReason: string | null
  transcriptLineCount: number
}

export interface WordBoundaryAdjustment {
  clipId: string
  changed: boolean
  originalStartTime: number
  originalEndTime: number
  refinedStartTime: number
  refinedEndTime: number
}

export interface FinalClipValidationDecision {
  clipId: string
  status: 'accepted' | 'rejected'
  originalStartTime: number
  originalEndTime: number
  validatedStartTime: number | null
  validatedEndTime: number | null
  score: number
  alternativesConsidered: number
  openingPreview: string
  endingPreview: string
  reason: string
  topAlternatives: Array<Record<string, unknown>>
  roughCutStatus?: 'reviewable_rough_cut' | 'rejected_after_repair'
  boundaryVariantType?: string
  repairOperation?: string
  fatalIssues?: string[]
}

export interface FinalClipValidationRejectedClip {
  clipId: string
  reason: string
  rejectionCode: 'boundary_optimizer_threshold'
  openingPreview: string
  endingPreview: string
  topAlternatives: Array<Record<string, unknown>>
}

export interface FinalClipValidationResult {
  clips: PipelineWorkerPotentialClip[]
  semanticReview: SemanticBoundaryReviewResult
  wordAdjustments: WordBoundaryAdjustment[]
  validatorDecisions: FinalClipValidationDecision[]
  rejectedClips: FinalClipValidationRejectedClip[]
  boundaryRepairReport: {
    clipsReviewed: number
    boundaryVariantsGenerated: number
    reviewableRoughCuts: number
    rejectedAfterRepair: number
    repairedStartCount: number
    repairedEndCount: number
    abruptStartFailures: number
    unresolvedEndingFailures: number
    missingContextFailures: number
  }
}

class FinalClipValidationService {
  async applySemanticBoundaryReview(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    aiService: AIService | null,
    mediaDuration: number,
    preferredTranscriptLines?: TranscriptBoundaryLine[]
  ): Promise<SemanticBoundaryReviewResult> {
    const { transcriptLines, mappedClips } = this.mapClipsToTranscriptLines(transcription, clips, preferredTranscriptLines)
    if (transcriptLines.length === 0 || mappedClips.length === 0) {
      return {
        clips,
        reviews: [],
        usedAI: false,
        fallbackReason: 'No transcript lines available for semantic boundary review.',
        transcriptLineCount: 0
      }
    }

    let reviews = this.buildHeuristicBoundaryReviews(transcriptLines, mappedClips)
    let usedAI = false
    let fallbackReason: string | null = aiService
      ? 'Semantic boundary review fell back to heuristic transcript-line adjustment.'
      : 'AI service unavailable; used heuristic transcript-line adjustment.'

    if (aiService) {
      try {
        const aiReviews = await aiService.reviewClipBoundaries(
          transcriptLines,
          mappedClips.map(({ clip }) => ({
            id: clip.id,
            startTime: clip.startTime,
            endTime: clip.endTime,
            duration: clip.duration,
            keyQuote: clip.keyQuote,
            reason: clip.reason
          })),
          mediaDuration
        )

        if (aiReviews.length > 0) {
          const reviewMap = new Map(aiReviews.map((review) => [review.clipId, review]))
          reviews = reviews.map((review) => reviewMap.get(review.clipId) ?? review)
          usedAI = true
          fallbackReason = null
        }
      } catch (error) {
        fallbackReason = error instanceof Error
          ? error.message
          : 'Unknown semantic boundary review error'
        console.warn('Semantic boundary review failed, using heuristic transcript-line adjustment', error)
      }
    }

    const reviewMap = new Map(reviews.map((review) => [review.clipId, review]))
    const adjustedClips = mappedClips.map(({ clip, startLineIndex, endLineIndex }) => {
      const review = reviewMap.get(clip.id)
      const finalStartLineIndex = review?.startLineIndex ?? startLineIndex
      const finalEndLineIndex = review?.endLineIndex ?? endLineIndex
      const startLine = transcriptLines[finalStartLineIndex]
      const endLine = transcriptLines[finalEndLineIndex]

      if (!startLine || !endLine || endLine.end <= startLine.start) {
        return clip
      }

      const nextDuration = endLine.end - startLine.start
      if (nextDuration < 25 || nextDuration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
        return clip
      }

      return {
        ...clip,
        startTime: startLine.start,
        endTime: Math.min(mediaDuration, endLine.end),
        duration: Number((Math.min(mediaDuration, endLine.end) - startLine.start).toFixed(3)),
        reason: review?.reason || clip.reason
      }
    })

    return {
      clips: adjustedClips,
      reviews,
      usedAI,
      fallbackReason,
      transcriptLineCount: transcriptLines.length
    }
  }

  async finalizeClipBoundaries(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    aiService: AIService | null,
    mediaDuration: number,
    preferredTranscriptLines?: TranscriptBoundaryLine[]
  ): Promise<FinalClipValidationResult> {
    const semanticReview = await this.applySemanticBoundaryReview(
      transcription,
      clips,
      aiService,
      mediaDuration,
      preferredTranscriptLines
    )
    const wordRefinement = this.refinePotentialClips(transcription, semanticReview.clips, mediaDuration)
    const optimizedClosure = this.optimizeClipBoundaries(transcription, wordRefinement.clips, mediaDuration)

    return {
      clips: optimizedClosure.accepted,
      semanticReview,
      wordAdjustments: wordRefinement.adjustments,
      validatorDecisions: optimizedClosure.decisions,
      rejectedClips: optimizedClosure.rejected,
      boundaryRepairReport: optimizedClosure.report
    }
  }

  private extractClipText(transcription: PipelineWorkerTranscription, clip: PipelineWorkerPotentialClip) {
    return transcription.segments
      .filter((segment) => segment.end > clip.startTime && segment.start < clip.endTime)
      .map((segment) => segment.text)
      .join(' ')
      .trim()
  }

  private shouldContinueThoughtAcrossBoundary(
    currentText: string,
    nextText: string,
    gap: number
  ) {
    if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS) {
      return false
    }

    if (endsWithTerminalPunctuation(currentText)) {
      return false
    }

    if (endsWithDanglingPhrase(currentText)) {
      return true
    }

    if (startsLikeContinuation(nextText)) {
      return true
    }

    return !looksLikeCompleteThought(currentText)
  }

  private endsWithConversationalAcknowledgementBeforeContinuation(
    currentText: string,
    nextText: string,
    gap: number
  ) {
    if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS) {
      return false
    }

    const current = currentText.trim().toLowerCase()
    const next = stripLeadingBoundaryFiller(nextText).trim()
    if (!current || !next) {
      return false
    }

    return /\b(yeah|yep|yes|right|okay|ok)\s*$/i.test(current)
  }

  private getLastOverlappingSegmentIndex(
    segments: PipelineWorkerTranscription['segments'],
    endTime: number
  ) {
    let index = -1

    for (let i = 0; i < segments.length; i += 1) {
      if (segments[i].start < endTime) {
        index = i
      } else {
        break
      }
    }

    return index
  }

  private findRefinedSegmentEndTime(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    mediaDuration: number
  ) {
    const segments = transcription.segments
    const lastSegmentIndex = this.getLastOverlappingSegmentIndex(segments, clip.endTime)

    if (lastSegmentIndex < 0) {
      return clip.endTime
    }

    let refinedEnd = clip.endTime
    let cleanEnd: number | null = null
    let cursor = lastSegmentIndex

    while (cursor < segments.length) {
      const current = segments[cursor]
      const next = segments[cursor + 1]
      const extension = current.end - clip.endTime
      const projectedDuration = current.end - clip.startTime

      refinedEnd = Math.max(refinedEnd, current.end)

      if (endsWithTerminalPunctuation(current.text) || isCleanClipEnd(current.text)) {
        cleanEnd = refinedEnd
        break
      }

      if (!next) {
        break
      }

      const gapToNext = next.start - current.end
      const continuesThought = this.shouldContinueThoughtAcrossBoundary(current.text, next.text, gapToNext)

      if (gapToNext >= 0.35 || projectedDuration >= 90) {
        break
      }

      if (continuesThought) {
        if (extension >= CLIP_REFINEMENT_MAX_SEMANTIC_END_EXTENSION_SECONDS) {
          break
        }

        cursor += 1
        continue
      }

      if (extension >= CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS) {
        break
      }

      cursor += 1
    }

    return Math.min(cleanEnd ?? clip.endTime, mediaDuration)
  }

  private getWordsWithinWindow(
    transcription: PipelineWorkerTranscription,
    startTime: number,
    endTime: number
  ) {
    return transcription.segments
      .flatMap((segment) => segment.words ?? [])
      .filter((word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > word.start &&
        word.end > startTime &&
        word.start < endTime
      )
      .sort((left, right) => left.start - right.start)
  }

  private refineClipBoundaryToWords(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    mediaDuration: number
  ) {
    const refinedSegmentEnd = this.findRefinedSegmentEndTime(transcription, clip, mediaDuration)
    const words = this.getWordsWithinWindow(
      transcription,
      Math.max(0, clip.startTime - 0.25),
      Math.min(mediaDuration, refinedSegmentEnd + CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS)
    )

    if (words.length === 0) {
      const refinedClip = refinedSegmentEnd === clip.endTime
        ? clip
        : {
            ...clip,
            endTime: refinedSegmentEnd,
            duration: Number((refinedSegmentEnd - clip.startTime).toFixed(3))
          }

      return {
        clip: refinedClip,
        changed: refinedClip.startTime !== clip.startTime || refinedClip.endTime !== clip.endTime,
        originalStartTime: clip.startTime,
        originalEndTime: clip.endTime,
        refinedStartTime: refinedClip.startTime,
        refinedEndTime: refinedClip.endTime
      }
    }

    const overlappingWords = words.filter((word) => word.end > clip.startTime && word.start < refinedSegmentEnd)
    const firstWord = overlappingWords[0]
    const lastWord = overlappingWords[overlappingWords.length - 1]

    if (!firstWord || !lastWord) {
      return {
        clip,
        changed: false,
        originalStartTime: clip.startTime,
        originalEndTime: clip.endTime,
        refinedStartTime: clip.startTime,
        refinedEndTime: clip.endTime
      }
    }

    const lastWordIndex = words.findIndex(
      (word) => word.start === lastWord.start && word.end === lastWord.end && word.word === lastWord.word
    )
    const nextWord = lastWordIndex >= 0 ? words[lastWordIndex + 1] : undefined
    const gapToNextWord = nextWord ? nextWord.start - lastWord.end : Number.POSITIVE_INFINITY
    const trailingPad = Math.min(
      CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS,
      gapToNextWord >= CLIP_REFINEMENT_TRAILING_PAD_SECONDS
        ? Math.max(CLIP_REFINEMENT_TRAILING_PAD_SECONDS, gapToNextWord * 0.6)
        : CLIP_REFINEMENT_TRAILING_PAD_SECONDS
    )

    let refinedStart = clip.startTime
    let refinedEnd = Math.min(mediaDuration, lastWord.end + trailingPad)

    if (nextWord) {
      refinedEnd = Math.min(refinedEnd, Math.max(lastWord.end, nextWord.start - CLIP_REFINEMENT_WORD_GUARD_SECONDS))
    }

    refinedStart = Math.min(refinedStart, firstWord.start)
    refinedStart = Math.max(0, refinedStart)

    if (refinedEnd <= refinedStart) {
      return {
        clip,
        changed: false,
        originalStartTime: clip.startTime,
        originalEndTime: clip.endTime,
        refinedStartTime: clip.startTime,
        refinedEndTime: clip.endTime
      }
    }

    const refinedClip = {
      ...clip,
      startTime: refinedStart,
      endTime: refinedEnd,
      duration: Number((refinedEnd - refinedStart).toFixed(3))
    }

    return {
      clip: refinedClip,
      changed: refinedClip.startTime !== clip.startTime || refinedClip.endTime !== clip.endTime,
      originalStartTime: clip.startTime,
      originalEndTime: clip.endTime,
      refinedStartTime: refinedClip.startTime,
      refinedEndTime: refinedClip.endTime
    }
  }

  private refinePotentialClips(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    mediaDuration: number
  ) {
    const refinements = clips.map((clip) => this.refineClipBoundaryToWords(transcription, clip, mediaDuration))

    return {
      clips: refinements.map((refinement) => refinement.clip),
      adjustments: refinements.map((refinement) => ({
        clipId: refinement.clip.id,
        changed: refinement.changed,
        originalStartTime: refinement.originalStartTime,
        originalEndTime: refinement.originalEndTime,
        refinedStartTime: refinement.refinedStartTime,
        refinedEndTime: refinement.refinedEndTime
      }))
    }
  }

  private buildClipWindowTextFromWords(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    const words = this.getWordsWithinWindow(transcription, clip.startTime, clip.endTime)
    if (words.length > 0) {
      return words.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
    }

    return this.extractClipText(transcription, clip)
  }

  private resolveClipEndWithTrailingPad(
    words: Array<{ start: number; end: number; word: string }>,
    wordIndex: number,
    mediaDuration: number
  ) {
    const word = words[wordIndex]
    const nextWord = words[wordIndex + 1]
    const gapToNextWord = nextWord ? nextWord.start - word.end : Number.POSITIVE_INFINITY
    const trailingPad = Math.min(
      CLIP_REFINEMENT_MAX_TRAILING_PAD_SECONDS,
      gapToNextWord >= CLIP_REFINEMENT_TRAILING_PAD_SECONDS
        ? Math.max(CLIP_REFINEMENT_TRAILING_PAD_SECONDS, gapToNextWord * 0.6)
        : CLIP_REFINEMENT_TRAILING_PAD_SECONDS
    )

    let endTime = Math.min(mediaDuration, word.end + trailingPad)
    if (nextWord) {
      endTime = Math.min(endTime, Math.max(word.end, nextWord.start - CLIP_REFINEMENT_WORD_GUARD_SECONDS))
    }

    return endTime
  }

  private getClipLeadingWords(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    wordCount = 8
  ) {
    return this.getWordsWithinWindow(
      transcription,
      Math.max(0, clip.startTime - 0.05),
      Math.min(clip.endTime, clip.startTime + 6)
    ).slice(0, wordCount)
  }

  private clipStartsCleanly(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    const clipText = this.buildClipWindowTextFromWords(transcription, clip)
    const leadingWords = this.getClipLeadingWords(transcription, clip)
    const firstWord = leadingWords[0]
    if (firstWord && firstWord.start < clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS) {
      return false
    }

    const leadingText = leadingWords.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
    const textToCheck = stripLeadingBoundaryFiller(leadingText || clipText)
    return Boolean(textToCheck) && (isCleanClipStart(textToCheck) || this.isRecoverableLeadInStart(leadingText))
  }

  private getClipOpeningPreview(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    wordCount = 12
  ) {
    return this.getClipLeadingWords(transcription, clip, wordCount)
      .map((word) => word.word)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private getClipStartBoundaryIssue(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    const openingPreview = this.getClipOpeningPreview(transcription, clip)
    const issue = getLeadingBoundaryIssue(openingPreview)
    if (issue === 'leading_continuation' && this.isRecoverableLeadInStart(openingPreview)) {
      return null
    }
    return issue
  }

  private getClipStartLookbackIssue(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    const words = this.getWordsWithinWindow(
      transcription,
      Math.max(0, clip.startTime - BOUNDARY_OPTIMIZER_HARD_START_BREAK_SECONDS),
      Math.min(clip.endTime, clip.startTime + 4)
    )
    const previousWords = words.filter((word) => word.end <= clip.startTime + CLIP_REFINEMENT_WORD_GUARD_SECONDS).slice(-8)
    const nextWords = words.filter((word) => word.start >= clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS).slice(0, 8)

    if (previousWords.length === 0 || nextWords.length === 0) {
      return null
    }

    const gap = nextWords[0].start - previousWords[previousWords.length - 1].end
    if (gap >= BOUNDARY_OPTIMIZER_HARD_START_BREAK_SECONDS) {
      return null
    }

    const previousText = previousWords.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
    const nextText = nextWords.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()

    if (this.shouldContinueThoughtAcrossBoundary(previousText, nextText, gap)) {
      return 'leading_continues_previous_thought'
    }

    return null
  }

  private getClipEndLookaheadIssue(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    const words = this.getWordsWithinWindow(
      transcription,
      Math.max(0, clip.endTime - 3),
      Math.min(clip.endTime + 6, clip.endTime + CLIP_REFINEMENT_MAX_END_EXTENSION_SECONDS)
    )
    const previousWords = words.filter((word) => word.end <= clip.endTime + CLIP_REFINEMENT_WORD_GUARD_SECONDS).slice(-6)
    const nextWords = words.filter((word) => word.start > clip.endTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS).slice(0, 6)

    if (previousWords.length === 0 || nextWords.length === 0) {
      return null
    }

    const gap = nextWords[0].start - previousWords[previousWords.length - 1].end
    if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS) {
      return null
    }

    const joined = [...previousWords, ...nextWords].map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
    const previousText = previousWords.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()
    const nextText = nextWords.map((word) => word.word).join(' ').replace(/\s+/g, ' ').trim()

    if (
      /\b(depending on|based on|because of|in terms of|when it comes to|as a result of|one of|part of)\s+(the|a|an|this|that|these|those|my|your|our|their)?\s*\w+\s+\w+/.test(joined) ||
      this.endsWithConversationalAcknowledgementBeforeContinuation(previousText, nextText, gap) ||
      this.shouldContinueThoughtAcrossBoundary(previousText, nextText, gap)
    ) {
      return 'lookahead_continues_current_ending'
    }

    return null
  }

  private uniqueSortedAnchors(anchors: BoundaryAnchor[]) {
    const byTime = new Map<number, BoundaryAnchor>()

    for (const anchor of anchors) {
      if (!Number.isFinite(anchor.time)) continue
      const time = Number(anchor.time.toFixed(3))
      if (!byTime.has(time)) {
        byTime.set(time, { ...anchor, time })
      }
    }

    return [...byTime.values()].sort((left, right) => left.time - right.time)
  }

  private isRecoverableLeadInStart(text: string) {
    const normalized = text.trim().replace(/\s+/g, ' ').toLowerCase()
    return /^(and\s+i\s+(think|mean|guess|would|can|was|have)|and\s+so\b|but\s+i\b)/.test(normalized)
  }

  private getConnectedStartAnchor(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip
  ) {
    if (!this.getClipStartLookbackIssue(transcription, clip)) {
      return null
    }

    const maxLeadInSeconds = 5
    const maxLeadInWords = 10
    const words = this.getWordsWithinWindow(
      transcription,
      Math.max(0, clip.startTime - maxLeadInSeconds),
      Math.min(clip.endTime, clip.startTime + 4)
    )
    const firstInsideIndex = words.findIndex((word) => word.start >= clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS)
    if (firstInsideIndex <= 0) {
      return null
    }

    let anchorIndex = firstInsideIndex
    while (anchorIndex > 0 && firstInsideIndex - anchorIndex < maxLeadInWords) {
      const current = words[anchorIndex]
      const previous = words[anchorIndex - 1]
      const gap = current.start - previous.end
      if (gap >= THOUGHT_UNIT_HARD_BREAK_GAP_SECONDS || clip.startTime - previous.start > maxLeadInSeconds) {
        break
      }
      anchorIndex -= 1
    }

    const anchor = words[anchorIndex]
    return anchor && anchor.start < clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS
      ? anchor.start
      : null
  }

  private buildBoundaryStartAnchors(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    mediaDuration: number
  ) {
    const minStart = Math.max(0, clip.startTime - 24)
    const maxStart = Math.min(clip.endTime - RESOLVED_CLIP_MIN_DURATION_SECONDS, clip.startTime + 8)
    const words = this.getWordsWithinWindow(transcription, minStart, Math.min(mediaDuration, clip.startTime + 10))
    const segmentStarts = transcription.segments
      .filter((segment) => segment.start >= minStart && segment.start <= maxStart)
      .map((segment): BoundaryAnchor => ({
        time: segment.start,
        type: segment.start < clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS
          ? 'previous_segment_start'
          : 'segment_start'
      }))
    const connectedStartAnchor = this.getConnectedStartAnchor(transcription, clip)
    const wordStarts = words
      .filter((word, index) => {
        if (word.start < minStart || word.start > maxStart) return false
        const previous = words[index - 1]
        const gap = previous ? word.start - previous.end : Number.POSITIVE_INFINITY
        const leadingText = words.slice(index, index + 8).map((item) => item.word).join(' ')
        return gap >= 0.22 || isCleanClipStart(leadingText) || this.isRecoverableLeadInStart(leadingText)
      })
      .map((word): BoundaryAnchor => ({
        time: word.start,
        type: word.start < clip.startTime - CLIP_REFINEMENT_WORD_GUARD_SECONDS
          ? 'earlier_clean_word_start'
          : 'clean_word_start'
      }))

    return this.uniqueSortedAnchors([
      { time: clip.startTime, type: 'initial_start' },
      connectedStartAnchor == null
        ? null
        : { time: connectedStartAnchor, type: 'connected_thread_start' },
      ...segmentStarts,
      ...wordStarts
    ].filter((anchor): anchor is BoundaryAnchor => Boolean(anchor)))
  }

  private buildBoundaryEndAnchors(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    mediaDuration: number
  ) {
    const minEnd = Math.max(clip.startTime + RESOLVED_CLIP_MIN_DURATION_SECONDS, clip.endTime - 10)
    const maxEnd = Math.min(mediaDuration, clip.startTime + SEMANTIC_CLIP_MAX_DURATION_SECONDS, clip.endTime + 36)
    const words = this.getWordsWithinWindow(transcription, Math.max(0, minEnd - 8), maxEnd)
    const segmentEnds = transcription.segments
      .filter((segment) => segment.end >= minEnd && segment.end <= maxEnd)
      .map((segment): BoundaryAnchor => ({
        time: segment.end,
        type: segment.end > clip.endTime + CLIP_REFINEMENT_WORD_GUARD_SECONDS
          ? 'next_segment_end'
          : 'segment_end'
      }))
    const wordEnds = words
      .map((word, index) => this.resolveClipEndWithTrailingPad(words, index, mediaDuration))
      .filter((endTime) => endTime >= minEnd && endTime <= maxEnd)
      .map((endTime): BoundaryAnchor => ({
        time: endTime,
        type: endTime > clip.endTime + CLIP_REFINEMENT_WORD_GUARD_SECONDS
          ? 'extended_word_end'
          : 'word_end'
      }))

    return this.uniqueSortedAnchors([{ time: clip.endTime, type: 'initial_end' }, ...segmentEnds, ...wordEnds])
  }

  private scoreOptimizedBoundaryPair(
    transcription: PipelineWorkerTranscription,
    originalClip: PipelineWorkerPotentialClip,
    startAnchor: BoundaryAnchor,
    endAnchor: BoundaryAnchor
  ): BoundaryVariantScore | null {
    const startTime = startAnchor.time
    const endTime = endAnchor.time
    const candidateClip = {
      ...originalClip,
      startTime,
      endTime,
      duration: Number((endTime - startTime).toFixed(3))
    }
    const duration = candidateClip.duration
    if (duration < RESOLVED_CLIP_MIN_DURATION_SECONDS || duration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
      return null
    }

    const text = this.buildClipWindowTextFromWords(transcription, candidateClip)
    if (!text) return null

    const localEndingText = text.split(/\s+/).slice(-12).join(' ')
    const hardEndIssue = getTrailingBoundaryIssue(localEndingText) ?? getTrailingBoundaryIssue(text)
    const lookaheadIssue = this.getClipEndLookaheadIssue(transcription, candidateClip)
    const startBoundaryIssue = this.getClipStartBoundaryIssue(transcription, candidateClip)
    const startLookbackIssue = this.getClipStartLookbackIssue(transcription, candidateClip)
    const cleanStart = !startBoundaryIssue && this.clipStartsCleanly(transcription, candidateClip)
    const cleanEnd = isCleanClipEnd(text) && isCleanLocalClipEnd(localEndingText)
    const localEndClean = isCleanLocalClipEnd(localEndingText)
    const fatalIssues = [
      startBoundaryIssue,
      hardEndIssue,
      startLookbackIssue,
      lookaheadIssue
    ].filter((issue): issue is string => typeof issue === 'string' && issue.length > 0)
    const startMoved = Math.abs(startTime - originalClip.startTime) > CLIP_REFINEMENT_WORD_GUARD_SECONDS
    const endMoved = Math.abs(endTime - originalClip.endTime) > CLIP_REFINEMENT_WORD_GUARD_SECONDS
    const editOperation = [
      startMoved
        ? startTime < originalClip.startTime ? 'expand_left' : 'contract_left'
        : 'keep_start',
      endMoved
        ? endTime > originalClip.endTime ? 'expand_right' : 'contract_right'
        : 'keep_end'
    ].join('+')
    const variantType = `${startAnchor.type}+${endAnchor.type}`

    if (startBoundaryIssue || hardEndIssue) {
      return {
        clip: candidateClip,
        score: -1000,
        cleanStart,
        cleanEnd,
        localEndClean,
        hardEndIssue,
        startBoundaryIssue,
        startLookbackIssue,
        lookaheadIssue,
        endingPreview: text.split(/\s+/).slice(-18).join(' '),
        openingPreview: this.getClipOpeningPreview(transcription, candidateClip),
        movementSeconds: Number((Math.abs(startTime - originalClip.startTime) + Math.abs(endTime - originalClip.endTime)).toFixed(3)),
        variantType,
        editOperation,
        fatalIssues
      }
    }

    const movementPenalty = Math.abs(startTime - originalClip.startTime) * 0.35 + Math.abs(endTime - originalClip.endTime) * 0.25
    const durationPenalty = duration > 90 ? (duration - 90) * 0.4 : duration < 35 ? (35 - duration) * 0.5 : 0

    let score = 0
    if (cleanStart) score += 24
    if (cleanEnd) score += 38
    if (localEndClean) score += 14
    else score -= 18
    if (!hardEndIssue) score += 12
    if (!lookaheadIssue) score += 8
    else score -= 18
    if (startLookbackIssue) score -= 18
    score -= movementPenalty + durationPenalty

    return {
      clip: candidateClip,
      score: Number(score.toFixed(3)),
      cleanStart,
      cleanEnd,
      localEndClean,
      hardEndIssue,
      startBoundaryIssue,
      startLookbackIssue,
      lookaheadIssue,
      endingPreview: text.split(/\s+/).slice(-18).join(' '),
      openingPreview: this.getClipOpeningPreview(transcription, candidateClip),
      movementSeconds: Number((Math.abs(startTime - originalClip.startTime) + Math.abs(endTime - originalClip.endTime)).toFixed(3)),
      variantType,
      editOperation,
      fatalIssues
    }
  }

  private optimizeClipBoundary(
    transcription: PipelineWorkerTranscription,
    clip: PipelineWorkerPotentialClip,
    mediaDuration: number
  ) {
    const startAnchors = this.buildBoundaryStartAnchors(transcription, clip, mediaDuration)
    const endAnchors = this.buildBoundaryEndAnchors(transcription, clip, mediaDuration)
    const scored: BoundaryVariantScore[] = []

    for (const startAnchor of startAnchors) {
      for (const endAnchor of endAnchors) {
        if (endAnchor.time <= startAnchor.time) continue
        const result = this.scoreOptimizedBoundaryPair(transcription, clip, startAnchor, endAnchor)
        if (result) {
          scored.push(result)
        }
      }
    }

    scored.sort((left, right) => right.score - left.score)
    const acceptable = scored.find((item) =>
      item.score >= BOUNDARY_OPTIMIZER_ROUGH_CUT_SCORE &&
      !item.startBoundaryIssue &&
      !item.hardEndIssue &&
      !item.startLookbackIssue &&
      !item.lookaheadIssue
    ) ?? null
    const best = acceptable ?? scored[0] ?? null
    return {
      best,
      alternativesConsidered: scored.length,
      topAlternatives: scored.slice(0, 3).map((item) => ({
        startTime: item.clip.startTime,
        endTime: item.clip.endTime,
        duration: item.clip.duration,
        score: item.score,
        cleanStart: item.cleanStart,
        cleanEnd: item.cleanEnd,
        hardEndIssue: item.hardEndIssue,
        startBoundaryIssue: item.startBoundaryIssue,
        startLookbackIssue: item.startLookbackIssue,
        lookaheadIssue: item.lookaheadIssue,
        fatalIssues: item.fatalIssues,
        variantType: item.variantType,
        editOperation: item.editOperation,
        movementSeconds: item.movementSeconds,
        openingPreview: item.openingPreview,
        endingPreview: item.endingPreview
      }))
    }
  }

  private optimizeClipBoundaries(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    mediaDuration: number
  ) {
    const accepted: PipelineWorkerPotentialClip[] = []
    const decisions: FinalClipValidationDecision[] = []
    let rejected: FinalClipValidationRejectedClip[] = []
    const report = {
      clipsReviewed: clips.length,
      boundaryVariantsGenerated: 0,
      reviewableRoughCuts: 0,
      rejectedAfterRepair: 0,
      repairedStartCount: 0,
      repairedEndCount: 0,
      abruptStartFailures: 0,
      unresolvedEndingFailures: 0,
      missingContextFailures: 0
    }

    for (const clip of clips) {
      const optimization = this.optimizeClipBoundary(transcription, clip, mediaDuration)
      report.boundaryVariantsGenerated += optimization.alternativesConsidered
      const contextClean = Boolean(
        optimization.best &&
        !optimization.best.startBoundaryIssue &&
        !optimization.best.hardEndIssue &&
        !optimization.best.startLookbackIssue &&
        !optimization.best.lookaheadIssue
      )
      const meetsPreferredThreshold = Boolean(
        optimization.best &&
        optimization.best.score >= BOUNDARY_OPTIMIZER_MIN_SCORE
      )
      const softAccepted = Boolean(
        contextClean &&
        optimization.best &&
        optimization.best.score >= BOUNDARY_OPTIMIZER_ROUGH_CUT_SCORE
      )
      if (optimization.best && contextClean && (meetsPreferredThreshold || softAccepted)) {
        const repairedStart = Math.abs(optimization.best.clip.startTime - clip.startTime) > CLIP_REFINEMENT_WORD_GUARD_SECONDS
        const repairedEnd = Math.abs(optimization.best.clip.endTime - clip.endTime) > CLIP_REFINEMENT_WORD_GUARD_SECONDS
        report.reviewableRoughCuts += 1
        if (repairedStart) report.repairedStartCount += 1
        if (repairedEnd) report.repairedEndCount += 1
        accepted.push(optimization.best.clip)
        decisions.push({
          clipId: clip.id,
          status: 'accepted',
          originalStartTime: clip.startTime,
          originalEndTime: clip.endTime,
          validatedStartTime: optimization.best.clip.startTime,
          validatedEndTime: optimization.best.clip.endTime,
          score: optimization.best.score,
          alternativesConsidered: optimization.alternativesConsidered,
          openingPreview: optimization.best.openingPreview,
          endingPreview: optimization.best.endingPreview,
          reason: optimization.best.score >= BOUNDARY_OPTIMIZER_MIN_SCORE
            ? 'Accepted as a coherent rough cut after prepared boundary variant search.'
            : 'Accepted as a coherent rough cut using a lower-scoring prepared boundary variant.',
          topAlternatives: optimization.topAlternatives,
          roughCutStatus: 'reviewable_rough_cut',
          boundaryVariantType: optimization.best.variantType,
          repairOperation: optimization.best.editOperation,
          fatalIssues: []
        })
        continue
      }

      const topAlternative = optimization.topAlternatives[0]
      const fatalIssues = Array.isArray(topAlternative?.fatalIssues)
        ? topAlternative.fatalIssues.filter((issue): issue is string => typeof issue === 'string')
        : []
      report.rejectedAfterRepair += 1
      if (fatalIssues.some((issue) => issue.startsWith('leading_'))) {
        report.abruptStartFailures += 1
      }
      if (fatalIssues.includes('leading_continues_previous_thought')) {
        report.missingContextFailures += 1
      }
      if (fatalIssues.some((issue) => issue.startsWith('trailing_') || issue === 'lookahead_continues_current_ending')) {
        report.unresolvedEndingFailures += 1
      }
      const rejectedClip: FinalClipValidationRejectedClip = {
        clipId: clip.id,
        reason: 'Rejected after prepared boundary repair variants failed to produce a coherent rough cut.',
        rejectionCode: 'boundary_optimizer_threshold',
        openingPreview: typeof topAlternative?.openingPreview === 'string' ? topAlternative.openingPreview : '',
        endingPreview: typeof topAlternative?.endingPreview === 'string' ? topAlternative.endingPreview : '',
        topAlternatives: optimization.topAlternatives
      }
      rejected.push(rejectedClip)
      decisions.push({
        clipId: clip.id,
        status: 'rejected',
        originalStartTime: clip.startTime,
        originalEndTime: clip.endTime,
        validatedStartTime: null,
        validatedEndTime: null,
        score: optimization.best?.score ?? 0,
        alternativesConsidered: optimization.alternativesConsidered,
        openingPreview: rejectedClip.openingPreview,
        endingPreview: rejectedClip.endingPreview,
        reason: rejectedClip.reason,
        topAlternatives: optimization.topAlternatives,
        roughCutStatus: 'rejected_after_repair',
        boundaryVariantType: typeof topAlternative?.variantType === 'string' ? topAlternative.variantType : undefined,
        repairOperation: typeof topAlternative?.editOperation === 'string' ? topAlternative.editOperation : undefined,
        fatalIssues
      })
    }

    if (accepted.length === 0 && clips.length > 0) {
      const recoveredClips = this.recoverBestEffortValidatedClips(transcription, clips, mediaDuration)
      for (const recoveredClip of recoveredClips) {
        accepted.push(recoveredClip)
        rejected = rejected.filter((clip) => clip.clipId !== recoveredClip.id)
        const decision = decisions.find((item) => item.clipId === recoveredClip.id)
        const openingPreview = this.getClipOpeningPreview(transcription, recoveredClip)
        const endingPreview = this.buildClipWindowTextFromWords(transcription, recoveredClip).split(/\s+/).slice(-18).join(' ')

        if (decision) {
          decision.status = 'accepted'
          decision.validatedStartTime = recoveredClip.startTime
          decision.validatedEndTime = recoveredClip.endTime
          decision.score = Math.max(decision.score, BOUNDARY_OPTIMIZER_SOFT_ACCEPT_SCORE)
          decision.openingPreview = openingPreview
          decision.endingPreview = endingPreview
          decision.reason = 'Accepted as a coherent rough cut by best-effort recovery after prepared boundary variants rejected all ranked cuts.'
          decision.roughCutStatus = 'reviewable_rough_cut'
          decision.repairOperation = 'best_effort_recovery'
          decision.fatalIssues = []
        }
      }
      report.reviewableRoughCuts = accepted.length
      report.rejectedAfterRepair = rejected.length
    }

    return { accepted, rejected, decisions, report }
  }

  private recoverBestEffortValidatedClips(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    mediaDuration: number,
    limit = 2
  ) {
    const recovered: PipelineWorkerPotentialClip[] = []

    for (const clip of clips) {
      if (recovered.length >= limit) {
        break
      }

      const duration = clip.endTime - clip.startTime
      if (duration < RESOLVED_CLIP_MIN_DURATION_SECONDS || duration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
        continue
      }

      const text = this.buildClipWindowTextFromWords(transcription, clip)
      if (!text) {
        continue
      }

      const hardStartIssue = this.getClipStartBoundaryIssue(transcription, clip)
      const hardEndIssue = getTrailingBoundaryIssue(text.split(/\s+/).slice(-12).join(' ')) ?? getTrailingBoundaryIssue(text)
      const startLookbackIssue = this.getClipStartLookbackIssue(transcription, clip)
      const lookaheadIssue = this.getClipEndLookaheadIssue(transcription, clip)
      if (hardStartIssue || hardEndIssue || startLookbackIssue || lookaheadIssue) {
        continue
      }

      recovered.push({
        ...clip,
        endTime: Math.min(mediaDuration, clip.endTime),
        duration: Number((Math.min(mediaDuration, clip.endTime) - clip.startTime).toFixed(3)),
        reason: `${clip.reason} Recovered for review after strict boundary optimization rejected all selected arcs.`
      })
    }

    if (recovered.length > 0) {
      return recovered
    }

    return []
  }

  private mapClipsToTranscriptLines(
    transcription: PipelineWorkerTranscription,
    clips: PipelineWorkerPotentialClip[],
    preferredTranscriptLines?: TranscriptBoundaryLine[]
  ) {
    const transcriptLines: TranscriptBoundaryLine[] = preferredTranscriptLines && preferredTranscriptLines.length > 0
      ? preferredTranscriptLines
      : buildTranscriptLinesFromSegments(transcription.segments).map((line) => ({
          lineIndex: line.lineIndex,
          start: line.start,
          end: line.end,
          text: line.text
        }))

    const findContainingLineIndex = (time: number, prefer: 'start' | 'end') => {
      const exact = transcriptLines.findIndex((line) =>
        prefer === 'start'
          ? time >= line.start && time < line.end + 0.01
          : time > line.start - 0.01 && time <= line.end + 0.01
      )

      if (exact >= 0) {
        return exact
      }

      let closestIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY
      transcriptLines.forEach((line, index) => {
        const distance = Math.min(Math.abs(time - line.start), Math.abs(time - line.end))
        if (distance < closestDistance) {
          closestDistance = distance
          closestIndex = index
        }
      })
      return closestIndex
    }

    const mappedClips = clips.map((clip) => {
      const startLineIndex = findContainingLineIndex(clip.startTime, 'start')
      const endLineIndex = findContainingLineIndex(clip.endTime, 'end')
      return {
        clip,
        startLineIndex,
        endLineIndex: Math.max(startLineIndex, endLineIndex)
      }
    })

    return { transcriptLines, mappedClips }
  }

  private lineTextLooksIncomplete(text: string) {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
      return false
    }

    return (
      /\b(and|but|or|so|because|then|which|that|if|when|while|where|to|for|with|of|in|on|at|from|as|than)\s*$/.test(normalized) ||
      /\b(a|an|the|my|your|our|their|his|her|its|this|that|these|those|some|any)\s*$/.test(normalized) ||
      /\b(it'?s like|kind of|sort of|you know|i mean|going to|want to|have to|need to|trying to)\s*$/.test(normalized) ||
      /\b(is|are|was|were|been|being|have|has|had|do|does|did|will|would|could|should|might|must|can)\s*$/.test(normalized)
    )
  }

  private buildHeuristicBoundaryReviews(
    transcriptLines: TranscriptBoundaryLine[],
    mappedClips: Array<{ clip: PipelineWorkerPotentialClip; startLineIndex: number; endLineIndex: number }>
  ): ClipBoundaryReview[] {
    return mappedClips.map(({ clip, startLineIndex, endLineIndex }) => {
      let reviewedStart = startLineIndex
      let reviewedEnd = endLineIndex

      while (reviewedStart > 0 && startsLikeContinuation(transcriptLines[reviewedStart].text)) {
        const previous = transcriptLines[reviewedStart - 1]
        if (clip.endTime - previous.start > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
          break
        }
        reviewedStart -= 1
      }

      while (reviewedEnd < transcriptLines.length - 1) {
        const current = transcriptLines[reviewedEnd]
        const next = transcriptLines[reviewedEnd + 1]
        const projectedDuration = next.end - transcriptLines[reviewedStart].start

        if (projectedDuration > SEMANTIC_CLIP_MAX_DURATION_SECONDS) {
          break
        }

        if (!this.lineTextLooksIncomplete(current.text) && !startsLikeContinuation(next.text)) {
          break
        }

        reviewedEnd += 1
      }

      return {
        clipId: clip.id,
        startLineIndex: reviewedStart,
        endLineIndex: reviewedEnd,
        reason: 'Heuristically adjusted to the nearest coherent transcript-line boundary.'
      }
    })
  }
}

export const finalClipValidationService = new FinalClipValidationService()
export default finalClipValidationService
