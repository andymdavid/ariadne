import { randomUUID } from 'crypto'
import type { CanonicalConversationalTimeline, CanonicalSilence, CanonicalTimedWord, CanonicalTranscriptLine } from '../../shared/canonicalTimeline'
import {
  getEndLookaheadIssue,
  getStartLookbackIssue,
  resolveClipEndWithTrailingPad
} from './boundaryRepairPrimitives'
import AIService, { AIServiceError } from './aiService'
import type {
  ThreadCoherenceReview,
  ThreadCandidateSelection,
  ThreadDiscoveryDiagnostics,
  ThreadDiscoveryLine,
  ThreadRepairFeedback,
  ThreadSemanticGuide
} from './aiService'
import type {
  PipelineWorkerPotentialClip,
  PipelineWorkerSelectionDecision,
  PipelineWorkerTranscription
} from '@shared/types/pipelineWorker'
import type { SelectionZeroOutputStage } from '@shared/types/pipelineWorker'

type VerificationIssue =
  | 'missing_timing'
  | 'duration_too_short'
  | 'duration_too_long'
  | 'ungrounded_text'
  | 'leading_continues_previous_thought'
  | 'lookahead_continues_current_ending'

type VerificationResult = {
  status: 'accepted' | 'needs_repair' | 'rejected'
  startTime: number | null
  endTime: number | null
  duration: number | null
  issues: VerificationIssue[]
  issueClasses: {
    hardMechanicalInvalid: VerificationIssue[]
    semanticRepairNeeded: VerificationIssue[]
  }
}

type CandidateEvaluation = {
  originalCandidate: ThreadCandidateSelection
  candidate: ThreadCandidateSelection
  verification: VerificationResult
  repairAttempts: number
  repairError: string | null
  deterministicRepairApplied: boolean
  deterministicRepairReason: string | null
  deterministicRepairFailureCode: string | null
  coherenceReview: ThreadCoherenceReview | null
  coherenceReviewError: string | null
  clip: PipelineWorkerPotentialClip | null
  reviewableWithWarningsClip: PipelineWorkerPotentialClip | null
  boundaryWarningStatus: 'none' | 'soft_start_accepted' | 'repaired' | 'accepted_with_override' | 'reviewable_with_warnings' | 'unresolved_rejected'
}

export type LlmThreadSelectorResult = {
  clips: PipelineWorkerPotentialClip[]
  decisions: PipelineWorkerSelectionDecision[]
  metadata: {
    executor: 'llm_thread_selector_service'
    implementationVersion: 'llm_thread_v1'
    configuredSelectorMode: 'llm_thread_v1'
    primarySelectorMode: 'llm_thread_v1'
    finalSelectionSource: 'llm_thread_selector'
    fallbackAttempted: false
    fallbackSource: null
    fallbackReason: null
    transcriptInputMode: string
    semanticTextSource: string
    timingSource: string
    speakerSource: string | null
    uploadedTranscriptGuide: {
      source: string
      fileName: string | null
      speakerLabels: string[]
      textPreviewLength: number
    } | null
    chunksProcessed: number
    threadCandidatesDiscovered: number
    threadCandidatesAccepted: number
    threadCandidatesRepaired: number
    threadCandidatesRejected: number
    llmDiscoveryError: string | null
    llmDiscoveryFailureCategory: string | null
    llmRepairError: string | null
    llmRepairFailureCategory: string | null
    llmRepairAttemptsExhausted: boolean
    mechanicalVariantsGenerated: number
    mechanicalVariantCeiling: number
    discoveryDiagnostics: Array<ThreadDiscoveryDiagnostics & { chunkId: string }>
    discoveryRetryAttempted: boolean
    discoveryChunksAttempted: number
    discoveryChunksSucceeded: number
    discoveryChunksFailed: number
    discoveryParseFailures: number
    partialDiscoveryFailure: boolean
    failedDiscoveryChunkIds: string[]
    coherenceReviewsAttempted: number
    coherenceReviewsAccepted: number
    llmCoherenceReviewError: string | null
    llmCoherenceReviewFailureCategory: string | null
    zeroOutputStage: string | null
    zeroOutputSubreason: string | null
    salvageAttempted: boolean
    salvageSource: 'llm_thread_zero_output_salvage' | null
    salvageAcceptedCount: number
    salvageRejectedCount: number
    reviewableWithWarningsCount: number
    finalClipsAccepted: number
    finalClipsRejected: number
    rejectedPreview: Array<Record<string, unknown>>
    selectedPreview: Array<Record<string, unknown>>
  }
}

const MIN_CLIP_SECONDS = 25
const MAX_CLIP_SECONDS = 150
// A boundary with no adjacent detected silence is a "hard handoff": there is no
// clean place to cut, so we try to move the cut to a nearby pause instead.
const BOUNDARY_POLISH_MAX_LINE_SHIFT = 2
const BOUNDARY_HEAD_PAD_SECONDS = 0.15
const BOUNDARY_TAIL_PAD_SECONDS = 0.22
const BOUNDARY_MAX_TAIL_PAD_SECONDS = 0.45
const BOUNDARY_WORD_GUARD_SECONDS = 0.04
const DISCOVERY_CHUNK_LINE_COUNT = 80
const DISCOVERY_CHUNK_OVERLAP = 10
const MAX_REPAIR_ATTEMPTS = 2
const VARIANT_GUARD_LIMIT = 2000

class LlmThreadSelectorService {
  async selectThreads(input: {
    timeline: CanonicalConversationalTimeline
    transcription: PipelineWorkerTranscription
    aiService: AIService
    targetClipCount: number
    semanticGuide?: ThreadSemanticGuide | null
    onProgress?: (progress: number) => void
  }): Promise<LlmThreadSelectorResult> {
    const chunks = this.buildLineChunks(input.timeline.lines)
    const discovered: ThreadCandidateSelection[] = []
    const discoveryDiagnostics: Array<ThreadDiscoveryDiagnostics & { chunkId: string }> = []
    let discoveryRetryAttempted = false
    let llmDiscoveryError: string | null = null
    let llmDiscoveryFailureCategory: string | null = null
    let discoveryChunksSucceeded = 0
    let discoveryChunksFailed = 0
    let discoveryParseFailures = 0
    const failedDiscoveryChunkIds: string[] = []

    input.onProgress?.(10)
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]
      const chunkId = `chunk_${index + 1}`
      try {
        const discovery = await input.aiService.discoverThreadCandidates({
          chunkId,
          mediaDuration: input.timeline.mediaDuration,
          minDurationSeconds: MIN_CLIP_SECONDS,
          maxDurationSeconds: MAX_CLIP_SECONDS,
          lines: chunk.map((line) => this.toDiscoveryLine(line)),
          semanticGuide: input.semanticGuide ?? null
        })
        discoveryDiagnostics.push({ chunkId, ...discovery.diagnostics })
        let candidates = discovery.candidates

        if (candidates.length === 0 && !llmDiscoveryError) {
          discoveryRetryAttempted = true
          const retry = await input.aiService.discoverThreadCandidates({
            chunkId: `${chunkId}_broad_retry`,
            mediaDuration: input.timeline.mediaDuration,
            minDurationSeconds: MIN_CLIP_SECONDS,
            maxDurationSeconds: MAX_CLIP_SECONDS,
            lines: chunk.map((line) => this.toDiscoveryLine(line)),
            broadDiscovery: true,
            semanticGuide: input.semanticGuide ?? null
          })
          discoveryDiagnostics.push({ chunkId: `${chunkId}_broad_retry`, ...retry.diagnostics })
          candidates = retry.candidates
        }

        discoveryChunksSucceeded += 1
        discovered.push(...candidates)
      } catch (error) {
        const firstError = error instanceof Error ? error.message : 'Unknown LLM discovery error'
        const firstFailureCategory = this.resolveAiFailureCategory(error)
        llmDiscoveryError = llmDiscoveryError ?? firstError
        llmDiscoveryFailureCategory = llmDiscoveryFailureCategory ?? firstFailureCategory
        if (firstFailureCategory === 'schema_parse_failure') {
          discoveryParseFailures += 1
        }
        discoveryDiagnostics.push({
          chunkId,
          responsePreview: '',
          rawCandidateCount: 0,
          validCandidateCount: 0,
          invalidCandidateCount: 0,
          invalidReasons: [firstError]
        })
        discoveryRetryAttempted = true
        try {
          const retry = await input.aiService.discoverThreadCandidates({
            chunkId: `${chunkId}_strict_json_retry`,
            mediaDuration: input.timeline.mediaDuration,
            minDurationSeconds: MIN_CLIP_SECONDS,
            maxDurationSeconds: MAX_CLIP_SECONDS,
            lines: chunk.map((line) => this.toDiscoveryLine(line)),
            broadDiscovery: true,
            strictJsonRetry: true,
            semanticGuide: input.semanticGuide ?? null
          })
          discoveryDiagnostics.push({ chunkId: `${chunkId}_strict_json_retry`, ...retry.diagnostics })
          discoveryChunksSucceeded += 1
          discovered.push(...retry.candidates)
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? retryError.message : 'Unknown LLM discovery retry error'
          const retryCategory = this.resolveAiFailureCategory(retryError)
          llmDiscoveryError = llmDiscoveryError ?? retryMessage
          llmDiscoveryFailureCategory = llmDiscoveryFailureCategory ?? retryCategory
          discoveryChunksFailed += 1
          failedDiscoveryChunkIds.push(chunkId)
          if (retryCategory === 'schema_parse_failure') {
            discoveryParseFailures += 1
          }
          discoveryDiagnostics.push({
            chunkId: `${chunkId}_strict_json_retry`,
            responsePreview: '',
            rawCandidateCount: 0,
            validCandidateCount: 0,
            invalidCandidateCount: 0,
            invalidReasons: [retryMessage]
          })
        }
      }
      input.onProgress?.(10 + ((index + 1) / Math.max(1, chunks.length)) * 35)
    }

    const uniqueCandidates = this.dedupeCandidates(discovered)
    const evaluations: CandidateEvaluation[] = []
    let llmRepairError: string | null = null
    let llmRepairFailureCategory: string | null = null
    let llmCoherenceReviewError: string | null = null
    let llmCoherenceReviewFailureCategory: string | null = null
    let llmRepairAttemptsExhausted = false
    let mechanicalVariantsGenerated = 0
    let coherenceReviewsAttempted = 0

    for (let index = 0; index < uniqueCandidates.length; index += 1) {
      const candidate = uniqueCandidates[index]
      const originalCandidate = candidate
      let currentCandidate = candidate
      let verification = this.verifyCandidate(input.timeline, input.transcription, currentCandidate)
      let repairAttempts = 0
      let repairError: string | null = null
      let deterministicRepairApplied = false
      let deterministicRepairReason: string | null = null
      let deterministicRepairFailureCode: string | null = null
      let previousRepairFeedback: ThreadRepairFeedback | null = null
      let coherenceReview: ThreadCoherenceReview | null = null
      let coherenceReviewError: string | null = null

      while (this.canAttemptLlmRepair(verification) && repairAttempts < MAX_REPAIR_ATTEMPTS) {
        repairAttempts += 1
        mechanicalVariantsGenerated += 1
        if (mechanicalVariantsGenerated > VARIANT_GUARD_LIMIT) {
          return this.buildResult(input.timeline, evaluations, {
            llmDiscoveryError,
            llmRepairError,
            llmRepairAttemptsExhausted,
            mechanicalVariantsGenerated,
            discoveryDiagnostics,
            discoveryRetryAttempted,
            discoveryChunksAttempted: chunks.length,
            discoveryChunksSucceeded,
            discoveryChunksFailed,
            discoveryParseFailures,
            partialDiscoveryFailure: discoveryChunksFailed > 0 && discovered.length > 0,
            failedDiscoveryChunkIds,
            coherenceReviewsAttempted,
            llmCoherenceReviewError,
            llmDiscoveryFailureCategory,
            llmRepairFailureCategory,
            llmCoherenceReviewFailureCategory,
            zeroOutputStage: 'mechanical_validation_failed',
            zeroOutputSubreason: 'selector_unhealthy_variant_explosion'
          })
        }

        try {
          const repair = await input.aiService.repairThreadCandidate({
            candidate: currentCandidate,
            issues: verification.issues,
            surroundingLines: this.getSurroundingLines(input.timeline.lines, currentCandidate).map((line) => this.toDiscoveryLine(line)),
            minDurationSeconds: MIN_CLIP_SECONDS,
            maxDurationSeconds: MAX_CLIP_SECONDS,
            previousRepairFeedback
          })

          if (repair.status === 'unrecoverable' || repair.startLineIndex === null || repair.endLineIndex === null) {
            repairError = repair.reason
            break
          }

          currentCandidate = {
            ...currentCandidate,
            startLineIndex: repair.startLineIndex,
            endLineIndex: repair.endLineIndex,
            reason: `${currentCandidate.reason} Repair: ${repair.reason}`
          }
          verification = this.verifyCandidate(input.timeline, input.transcription, currentCandidate)
          previousRepairFeedback = this.toRepairFeedback(currentCandidate, verification)
        } catch (error) {
          repairError = error instanceof Error ? error.message : 'Unknown LLM repair error'
          llmRepairError = repairError
          llmRepairFailureCategory = this.resolveAiFailureCategory(error)
          break
        }
      }

      if (this.canAttemptDeterministicRepair(verification)) {
        const deterministicRepair = this.applyDeterministicLineRepair(
          input.timeline,
          input.transcription,
          currentCandidate,
          verification,
          VARIANT_GUARD_LIMIT - mechanicalVariantsGenerated
        )
        mechanicalVariantsGenerated += deterministicRepair.variantsEvaluated
        if (mechanicalVariantsGenerated > VARIANT_GUARD_LIMIT) {
          return this.buildResult(input.timeline, evaluations, {
            llmDiscoveryError,
            llmRepairError,
            llmRepairAttemptsExhausted,
            mechanicalVariantsGenerated,
            discoveryDiagnostics,
            discoveryRetryAttempted,
            discoveryChunksAttempted: chunks.length,
            discoveryChunksSucceeded,
            discoveryChunksFailed,
            discoveryParseFailures,
            partialDiscoveryFailure: discoveryChunksFailed > 0 && discovered.length > 0,
            failedDiscoveryChunkIds,
            coherenceReviewsAttempted,
            llmCoherenceReviewError,
            llmDiscoveryFailureCategory,
            llmRepairFailureCategory,
            llmCoherenceReviewFailureCategory,
            zeroOutputStage: 'mechanical_validation_failed',
            zeroOutputSubreason: 'selector_unhealthy_variant_explosion'
          })
        }

        if (deterministicRepair.repairedCandidate) {
          currentCandidate = deterministicRepair.repairedCandidate
          verification = deterministicRepair.verification
          deterministicRepairApplied = true
          deterministicRepairReason = deterministicRepair.reason
        } else {
          deterministicRepairReason = deterministicRepair.reason
          deterministicRepairFailureCode = deterministicRepair.failureCode
          repairError = [repairError, deterministicRepair.reason].filter(Boolean).join(' | ') || null
        }
      }

      if (this.canAskModelToConfirmCoherence(verification)) {
        coherenceReviewsAttempted += 1
        try {
          coherenceReview = await input.aiService.reviewThreadCandidateCoherence({
            candidate: currentCandidate,
            issues: verification.issues,
            selectedLines: this.getSelectedLines(input.timeline.lines, currentCandidate).map((line) => this.toDiscoveryLine(line)),
            surroundingLines: this.getSurroundingLines(input.timeline.lines, currentCandidate).map((line) => this.toDiscoveryLine(line)),
            minDurationSeconds: MIN_CLIP_SECONDS,
            maxDurationSeconds: MAX_CLIP_SECONDS
          })
          if (coherenceReview.status === 'accepted') {
            verification = this.verification(
              'accepted',
              verification.startTime,
              verification.endTime,
              verification.duration,
              verification.issues,
              verification.issueClasses.hardMechanicalInvalid,
              verification.issueClasses.semanticRepairNeeded
            )
          }
        } catch (error) {
          coherenceReviewError = error instanceof Error ? error.message : 'Unknown LLM coherence review error'
          llmCoherenceReviewError = coherenceReviewError
          llmCoherenceReviewFailureCategory = this.resolveAiFailureCategory(error)
        }
      }

      if (verification.status !== 'accepted' && (repairAttempts >= MAX_REPAIR_ATTEMPTS || repairError)) {
        llmRepairAttemptsExhausted = true
      }

      if (verification.status === 'accepted') {
        const polish = this.polishBoundaryHandoffs(input.timeline, input.transcription, currentCandidate)
        if (polish) {
          currentCandidate = polish.candidate
          verification = polish.verification
        }
      }

      const clip = verification.status === 'accepted'
        ? this.buildClip(currentCandidate, verification)
        : null
      const reviewableWithWarningsClip = !clip && this.canSurfaceWithWarnings(currentCandidate, verification, coherenceReview, coherenceReviewError)
        ? this.buildClip(currentCandidate, verification, 'reviewable_with_warnings')
        : null
      const boundaryWarningStatus = this.resolveBoundaryWarningStatus(verification, coherenceReview, clip, reviewableWithWarningsClip)

      evaluations.push({
        originalCandidate,
        candidate: currentCandidate,
        verification,
        repairAttempts,
        repairError,
        deterministicRepairApplied,
        deterministicRepairReason,
        deterministicRepairFailureCode,
        coherenceReview,
        coherenceReviewError,
        clip,
        reviewableWithWarningsClip,
        boundaryWarningStatus
      })
      input.onProgress?.(45 + ((index + 1) / Math.max(1, uniqueCandidates.length)) * 45)
    }

    return this.buildResult(input.timeline, evaluations, {
      llmDiscoveryError,
      llmRepairError,
      llmRepairAttemptsExhausted,
      mechanicalVariantsGenerated,
      discoveryDiagnostics,
      discoveryRetryAttempted,
      discoveryChunksAttempted: chunks.length,
      discoveryChunksSucceeded,
      discoveryChunksFailed,
      discoveryParseFailures,
      partialDiscoveryFailure: discoveryChunksFailed > 0 && discovered.length > 0,
      failedDiscoveryChunkIds,
      coherenceReviewsAttempted,
      llmCoherenceReviewError,
      llmDiscoveryFailureCategory,
      llmRepairFailureCategory,
      llmCoherenceReviewFailureCategory,
      zeroOutputStage: null,
      zeroOutputSubreason: null,
      targetClipCount: input.targetClipCount,
      semanticGuide: input.semanticGuide ?? null
    })
  }

  private resolveAiFailureCategory(error: unknown) {
    if (error instanceof AIServiceError) return error.category
    const message = error instanceof Error ? error.message : String(error ?? '')
    return /json|parse|schema|invalid .*response/i.test(message) ? 'schema_parse_failure' : null
  }

  private buildLineChunks(lines: CanonicalTranscriptLine[]) {
    if (lines.length <= DISCOVERY_CHUNK_LINE_COUNT) {
      return lines.length > 0 ? [lines] : []
    }

    const chunks: CanonicalTranscriptLine[][] = []
    for (let start = 0; start < lines.length; start += DISCOVERY_CHUNK_LINE_COUNT - DISCOVERY_CHUNK_OVERLAP) {
      chunks.push(lines.slice(start, start + DISCOVERY_CHUNK_LINE_COUNT))
    }
    return chunks
  }

  private toDiscoveryLine(line: CanonicalTranscriptLine): ThreadDiscoveryLine {
    return {
      index: line.index,
      startTime: line.startTime,
      endTime: line.endTime,
      speaker: line.speaker,
      text: line.text
    }
  }

  private dedupeCandidates(candidates: ThreadCandidateSelection[]) {
    const byRange = new Map<string, ThreadCandidateSelection>()
    for (const candidate of candidates) {
      const key = `${candidate.startLineIndex}:${candidate.endLineIndex}`
      const existing = byRange.get(key)
      if (!existing || candidate.confidence > existing.confidence) {
        byRange.set(key, candidate)
      }
    }
    return [...byRange.values()].sort((left, right) => right.confidence - left.confidence)
  }

  private verifyCandidate(
    timeline: CanonicalConversationalTimeline,
    transcription: PipelineWorkerTranscription,
    candidate: ThreadCandidateSelection
  ): VerificationResult {
    const startLine = timeline.lines.find((line) => line.index === candidate.startLineIndex)
    const endLine = timeline.lines.find((line) => line.index === candidate.endLineIndex)
    const issues: VerificationIssue[] = []
    const hardMechanicalInvalid: VerificationIssue[] = []
    const semanticRepairNeeded: VerificationIssue[] = []

    if (!startLine || !endLine || startLine.startTime === null || endLine.endTime === null) {
      issues.push('missing_timing')
      hardMechanicalInvalid.push('missing_timing')
      return this.verification('rejected', null, null, null, issues, hardMechanicalInvalid, semanticRepairNeeded)
    }

    const startTime = startLine.startTime
    const endTime = endLine.endTime
    const duration = Number((endTime - startTime).toFixed(3))
    if (duration < MIN_CLIP_SECONDS) {
      issues.push('duration_too_short')
      hardMechanicalInvalid.push('duration_too_short')
    }
    if (duration > MAX_CLIP_SECONDS) {
      issues.push('duration_too_long')
      hardMechanicalInvalid.push('duration_too_long')
    }

    const selectedText = timeline.lines
      .filter((line) => line.index >= candidate.startLineIndex && line.index <= candidate.endLineIndex)
      .map((line) => line.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!selectedText) {
      issues.push('ungrounded_text')
      hardMechanicalInvalid.push('ungrounded_text')
    }

    const startLookbackIssue = getStartLookbackIssue({
      transcription,
      span: { startTime, endTime },
      lookbackSeconds: 1.1
    })
    if (startLookbackIssue === 'leading_continues_previous_thought') {
      issues.push(startLookbackIssue)
      semanticRepairNeeded.push(startLookbackIssue)
    }

    const lookaheadIssue = getEndLookaheadIssue({
      transcription,
      span: { startTime, endTime },
      lookaheadSeconds: 10
    })
    if (lookaheadIssue === 'lookahead_continues_current_ending') {
      issues.push(lookaheadIssue)
      semanticRepairNeeded.push(lookaheadIssue)
    }

    if (hardMechanicalInvalid.length > 0) {
      return this.verification('rejected', startTime, endTime, duration, issues, hardMechanicalInvalid, semanticRepairNeeded)
    }
    if (semanticRepairNeeded.length > 0 || !candidate.selfContained) {
      return this.verification('needs_repair', startTime, endTime, duration, issues, hardMechanicalInvalid, semanticRepairNeeded)
    }
    return this.verification('accepted', startTime, endTime, duration, issues, hardMechanicalInvalid, semanticRepairNeeded)
  }

  private verification(
    status: VerificationResult['status'],
    startTime: number | null,
    endTime: number | null,
    duration: number | null,
    issues: VerificationIssue[],
    hardMechanicalInvalid: VerificationIssue[],
    semanticRepairNeeded: VerificationIssue[]
  ): VerificationResult {
    return {
      status,
      startTime,
      endTime,
      duration,
      issues,
      issueClasses: {
        hardMechanicalInvalid,
        semanticRepairNeeded
      }
    }
  }

  private canAttemptLlmRepair(verification: VerificationResult) {
    if (verification.status === 'accepted') return false
    if (verification.status === 'needs_repair') return true
    const hardIssues = verification.issueClasses.hardMechanicalInvalid
    return hardIssues.length > 0 &&
      hardIssues.every((issue) => issue === 'duration_too_long' || issue === 'duration_too_short')
  }

  private canAttemptDeterministicRepair(verification: VerificationResult) {
    if (verification.status === 'accepted') return false
    if (verification.status === 'needs_repair') return true
    return verification.issues.includes('duration_too_long') &&
      (verification.issues.includes('leading_continues_previous_thought') ||
        verification.issues.includes('lookahead_continues_current_ending'))
  }

  private toRepairFeedback(candidate: ThreadCandidateSelection, verification: VerificationResult): ThreadRepairFeedback {
    return {
      attemptedStartLineIndex: candidate.startLineIndex,
      attemptedEndLineIndex: candidate.endLineIndex,
      attemptedDurationSeconds: verification.duration,
      issues: verification.issues
    }
  }

  private getSurroundingLines(lines: CanonicalTranscriptLine[], candidate: ThreadCandidateSelection) {
    const startIndex = Math.max(0, candidate.startLineIndex - 8)
    const endIndex = Math.min(lines.length - 1, candidate.endLineIndex + 8)
    return lines.filter((line) => line.index >= startIndex && line.index <= endIndex)
  }

  private getSelectedLines(lines: CanonicalTranscriptLine[], candidate: ThreadCandidateSelection) {
    return lines.filter((line) => line.index >= candidate.startLineIndex && line.index <= candidate.endLineIndex)
  }

  private canAskModelToConfirmCoherence(verification: VerificationResult) {
    if (verification.status !== 'needs_repair') return false
    if (verification.issueClasses.hardMechanicalInvalid.length > 0) return false
    return verification.duration !== null &&
      verification.duration >= MIN_CLIP_SECONDS &&
      verification.duration <= MAX_CLIP_SECONDS &&
      verification.issueClasses.semanticRepairNeeded.length > 0
  }

  private applyDeterministicLineRepair(
    timeline: CanonicalConversationalTimeline,
    transcription: PipelineWorkerTranscription,
    candidate: ThreadCandidateSelection,
    verification: VerificationResult,
    remainingVariantBudget: number
  ): {
    repairedCandidate: ThreadCandidateSelection | null
    verification: VerificationResult
    variantsEvaluated: number
    reason: string
    failureCode: string | null
  } {
    const sortedLines = [...timeline.lines].sort((left, right) => left.index - right.index)
    const startPosition = sortedLines.findIndex((line) => line.index === candidate.startLineIndex)
    const endPosition = sortedLines.findIndex((line) => line.index === candidate.endLineIndex)
    if (startPosition === -1 || endPosition === -1 || endPosition < startPosition) {
      return {
        repairedCandidate: null,
        verification,
        variantsEvaluated: 0,
        reason: 'Deterministic repair skipped because the candidate line range was not found.',
        failureCode: 'ungrounded_text'
      }
    }

    const needsEarlierStart = verification.issues.includes('leading_continues_previous_thought')
    const needsLaterEnd = verification.issues.includes('lookahead_continues_current_ending')
    if (verification.issues.includes('duration_too_long')) {
      return this.contractOverlongLineRange(
        timeline,
        transcription,
        candidate,
        verification,
        sortedLines,
        startPosition,
        endPosition,
        remainingVariantBudget
      )
    }

    if (!needsEarlierStart && !needsLaterEnd) {
      return {
        repairedCandidate: null,
        verification,
        variantsEvaluated: 0,
        reason: 'Deterministic repair skipped because no semantic boundary issue was present.',
        failureCode: 'semantic_repair_not_required'
      }
    }

    const maxLineExpansion = 8
    const startPositions = needsEarlierStart
      ? this.range(Math.max(0, startPosition - maxLineExpansion), startPosition).reverse()
      : [startPosition]
    const endPositions = needsLaterEnd
      ? this.range(endPosition, Math.min(sortedLines.length - 1, endPosition + maxLineExpansion))
      : [endPosition]

    let variantsEvaluated = 0
    let bestRejected: VerificationResult | null = null
    let bestRejectedCandidate: ThreadCandidateSelection | null = null
    const attempts: Array<{ startPosition: number; endPosition: number; movement: number }> = []

    for (const proposedStartPosition of startPositions) {
      for (const proposedEndPosition of endPositions) {
        if (proposedEndPosition < proposedStartPosition) continue
        attempts.push({
          startPosition: proposedStartPosition,
          endPosition: proposedEndPosition,
          movement: Math.abs(startPosition - proposedStartPosition) + Math.abs(endPosition - proposedEndPosition)
        })
      }
    }

    attempts.sort((left, right) => left.movement - right.movement)

    for (const attempt of attempts) {
      if (variantsEvaluated >= remainingVariantBudget) break
      variantsEvaluated += 1
      const repairedCandidate: ThreadCandidateSelection = {
        ...candidate,
        startLineIndex: sortedLines[attempt.startPosition].index,
        endLineIndex: sortedLines[attempt.endPosition].index,
        reason: `${candidate.reason} Deterministic line expansion repaired semantic boundary warnings.`
      }
      const repairedVerification = this.verifyCandidate(timeline, transcription, repairedCandidate)
      if (repairedVerification.status === 'accepted') {
        return {
          repairedCandidate,
          verification: repairedVerification,
          variantsEvaluated,
          reason: `Expanded line range from ${candidate.startLineIndex}-${candidate.endLineIndex} to ${repairedCandidate.startLineIndex}-${repairedCandidate.endLineIndex}.`,
          failureCode: null
        }
      }

      if (
        !bestRejected ||
        this.verificationScore(repairedVerification) > this.verificationScore(bestRejected)
      ) {
        bestRejected = repairedVerification
        bestRejectedCandidate = repairedCandidate
      }
    }

    const bestRange = bestRejectedCandidate
      ? `${bestRejectedCandidate.startLineIndex}-${bestRejectedCandidate.endLineIndex}`
      : `${candidate.startLineIndex}-${candidate.endLineIndex}`
    const bestIssues = bestRejected?.issues.join(', ') || verification.issues.join(', ') || 'unknown issue'
    return {
      repairedCandidate: null,
      verification,
      variantsEvaluated,
      reason: `Deterministic line repair found no accepted range; best attempted range ${bestRange} still failed: ${bestIssues}.`,
      failureCode: this.deterministicFailureCode(bestRejected ?? verification)
    }
  }

  private contractOverlongLineRange(
    timeline: CanonicalConversationalTimeline,
    transcription: PipelineWorkerTranscription,
    candidate: ThreadCandidateSelection,
    verification: VerificationResult,
    sortedLines: CanonicalTranscriptLine[],
    startPosition: number,
    endPosition: number,
    remainingVariantBudget: number
  ): {
    repairedCandidate: ThreadCandidateSelection | null
    verification: VerificationResult
    variantsEvaluated: number
    reason: string
    failureCode: string | null
  } {
    const attempts: Array<{ startPosition: number; endPosition: number; duration: number; movement: number }> = []
    for (let proposedStartPosition = startPosition; proposedStartPosition <= endPosition; proposedStartPosition += 1) {
      for (let proposedEndPosition = endPosition; proposedEndPosition >= proposedStartPosition; proposedEndPosition -= 1) {
        const startLine = sortedLines[proposedStartPosition]
        const endLine = sortedLines[proposedEndPosition]
        if (startLine.startTime === null || endLine.endTime === null) continue
        const duration = endLine.endTime - startLine.startTime
        if (duration < MIN_CLIP_SECONDS || duration > MAX_CLIP_SECONDS) continue
        attempts.push({
          startPosition: proposedStartPosition,
          endPosition: proposedEndPosition,
          duration,
          movement: Math.abs(startPosition - proposedStartPosition) + Math.abs(endPosition - proposedEndPosition)
        })
      }
    }

    attempts.sort((left, right) => {
      const durationDifference = right.duration - left.duration
      return Math.abs(durationDifference) > 0.001 ? durationDifference : left.movement - right.movement
    })

    let variantsEvaluated = 0
    let bestRejected: VerificationResult | null = null
    let bestRejectedCandidate: ThreadCandidateSelection | null = null
    for (const attempt of attempts) {
      if (variantsEvaluated >= remainingVariantBudget) break
      variantsEvaluated += 1
      const repairedCandidate: ThreadCandidateSelection = {
        ...candidate,
        startLineIndex: sortedLines[attempt.startPosition].index,
        endLineIndex: sortedLines[attempt.endPosition].index,
        reason: `${candidate.reason} Deterministic contraction kept the repaired parent thread within duration limits.`
      }
      const repairedVerification = this.verifyCandidate(timeline, transcription, repairedCandidate)
      if (repairedVerification.status === 'accepted') {
        return {
          repairedCandidate,
          verification: repairedVerification,
          variantsEvaluated,
          reason: `Contracted overlong range from ${candidate.startLineIndex}-${candidate.endLineIndex} to ${repairedCandidate.startLineIndex}-${repairedCandidate.endLineIndex}.`,
          failureCode: null
        }
      }

      if (
        !bestRejected ||
        this.verificationScore(repairedVerification) > this.verificationScore(bestRejected)
      ) {
        bestRejected = repairedVerification
        bestRejectedCandidate = repairedCandidate
      }
    }

    const bestRange = bestRejectedCandidate
      ? `${bestRejectedCandidate.startLineIndex}-${bestRejectedCandidate.endLineIndex}`
      : `${candidate.startLineIndex}-${candidate.endLineIndex}`
    const bestIssues = bestRejected?.issues.join(', ') || verification.issues.join(', ') || 'unknown issue'
    return {
      repairedCandidate: null,
      verification,
      variantsEvaluated,
      reason: `Deterministic contraction found no accepted range; best attempted range ${bestRange} still failed: ${bestIssues}.`,
      failureCode: this.deterministicFailureCode(bestRejected ?? verification)
    }
  }

  /**
   * Best-effort acoustic polish for accepted candidates. When a boundary lands on a
   * hard handoff (no silence between the boundary word and its neighbour, so any cut
   * placement clips a phoneme or steals the next speaker's onset), try shifting the
   * line range slightly to a boundary with a real pause. Never changes acceptance:
   * a variant is adopted only if it independently verifies as accepted AND both of
   * its boundaries clear the handoff threshold; otherwise the original stands.
   */
  private polishBoundaryHandoffs(
    timeline: CanonicalConversationalTimeline,
    transcription: PipelineWorkerTranscription,
    candidate: ThreadCandidateSelection
  ): { candidate: ThreadCandidateSelection; verification: VerificationResult } | null {
    // Hardness is acoustic: a boundary is a hard handoff when no detected silence
    // sits adjacent to the boundary word. Whisper word gaps cannot answer this.
    if (timeline.silences.length === 0) return null
    const gaps = this.getLineRangeBoundaryGaps(timeline, candidate.startLineIndex, candidate.endLineIndex)
    if (!gaps) return null

    const startIsHard = !this.findAdjacentSilence(timeline.silences, 'start', gaps.firstWord.startTime)
    const endIsHard = !this.findAdjacentSilence(timeline.silences, 'end', gaps.lastWord.endTime)
    if (!startIsHard && !endIsHard) return null

    const sortedLines = [...timeline.lines].sort((left, right) => left.index - right.index)
    const startPosition = sortedLines.findIndex((line) => line.index === candidate.startLineIndex)
    const endPosition = sortedLines.findIndex((line) => line.index === candidate.endLineIndex)
    if (startPosition === -1 || endPosition === -1) return null

    const positionsAround = (position: number, moveable: boolean) =>
      moveable
        ? this.range(
            Math.max(0, position - BOUNDARY_POLISH_MAX_LINE_SHIFT),
            Math.min(sortedLines.length - 1, position + BOUNDARY_POLISH_MAX_LINE_SHIFT)
          )
        : [position]

    const attempts: Array<{ startPosition: number; endPosition: number; movement: number }> = []
    for (const proposedStart of positionsAround(startPosition, startIsHard)) {
      for (const proposedEnd of positionsAround(endPosition, endIsHard)) {
        if (proposedEnd < proposedStart) continue
        if (proposedStart === startPosition && proposedEnd === endPosition) continue
        attempts.push({
          startPosition: proposedStart,
          endPosition: proposedEnd,
          movement: Math.abs(proposedStart - startPosition) + Math.abs(proposedEnd - endPosition)
        })
      }
    }
    attempts.sort((left, right) => left.movement - right.movement)

    for (const attempt of attempts) {
      const startLineIndex = sortedLines[attempt.startPosition].index
      const endLineIndex = sortedLines[attempt.endPosition].index
      const attemptGaps = this.getLineRangeBoundaryGaps(timeline, startLineIndex, endLineIndex)
      if (!attemptGaps) continue
      if (
        !this.findAdjacentSilence(timeline.silences, 'start', attemptGaps.firstWord.startTime) ||
        !this.findAdjacentSilence(timeline.silences, 'end', attemptGaps.lastWord.endTime)
      ) {
        continue
      }

      const variant: ThreadCandidateSelection = {
        ...candidate,
        startLineIndex,
        endLineIndex,
        reason: `${candidate.reason} Boundary polish moved the cut to the nearest pause.`
      }
      const variantVerification = this.verifyCandidate(timeline, transcription, variant)
      if (variantVerification.status !== 'accepted') continue
      return { candidate: variant, verification: variantVerification }
    }

    return null
  }

  /**
   * Find a detected silence adjacent to a boundary word edge. Adjacency is strict:
   * the silence must begin (end boundary) or end (start boundary) within a small
   * window of the word edge, so extending into it can never cross other speech.
   */
  private findAdjacentSilence(
    silences: CanonicalSilence[],
    boundary: 'start' | 'end',
    wordEdge: number
  ): CanonicalSilence | null {
    let best: CanonicalSilence | null = null
    for (const silence of silences) {
      if (boundary === 'start') {
        if (silence.end < wordEdge - 0.35 || silence.end > wordEdge + 0.15) continue
        if (!best || Math.abs(silence.end - wordEdge) < Math.abs(best.end - wordEdge)) best = silence
      } else {
        if (silence.start < wordEdge - 0.15 || silence.start > wordEdge + 0.35) continue
        if (!best || Math.abs(silence.start - wordEdge) < Math.abs(best.start - wordEdge)) best = silence
      }
    }
    return best
  }

  private getLineRangeBoundaryGaps(
    timeline: CanonicalConversationalTimeline,
    startLineIndex: number,
    endLineIndex: number
  ) {
    const wordById = new Map(timeline.words.map((word) => [word.id, word]))
    const selectedWords = timeline.lines
      .filter((line) => line.index >= startLineIndex && line.index <= endLineIndex)
      .sort((left, right) => left.index - right.index)
      .flatMap((line) => line.wordIds)
      .map((wordId) => wordById.get(wordId))
      .filter((word): word is CanonicalTimedWord => Boolean(word))

    const firstWord = selectedWords[0]
    const lastWord = selectedWords[selectedWords.length - 1]
    if (!firstWord || !lastWord) return null

    const firstIndex = timeline.words.indexOf(firstWord)
    const lastIndex = timeline.words.indexOf(lastWord)
    const previousWord = firstIndex > 0 ? timeline.words[firstIndex - 1] : undefined
    const nextWord =
      lastIndex >= 0 && lastIndex + 1 < timeline.words.length ? timeline.words[lastIndex + 1] : undefined

    return {
      firstWord,
      lastWord,
      previousWord,
      nextWord,
      leadingGap: previousWord ? firstWord.startTime - previousWord.endTime : Number.POSITIVE_INFINITY,
      trailingGap: nextWord ? nextWord.startTime - lastWord.endTime : Number.POSITIVE_INFINITY
    }
  }

  private deterministicFailureCode(verification: VerificationResult) {
    if (verification.issues.includes('duration_too_long')) return 'duration_too_long'
    if (verification.issues.includes('duration_too_short')) return 'duration_too_short'
    if (verification.issues.includes('missing_timing')) return 'missing_timing'
    if (verification.issues.includes('ungrounded_text')) return 'ungrounded_text'
    const hasLeadingIssue = verification.issues.includes('leading_continues_previous_thought')
    const hasEndingIssue = verification.issues.includes('lookahead_continues_current_ending')
    if (hasLeadingIssue && hasEndingIssue) return 'needs_parent_thread_expansion'
    if (hasLeadingIssue) return 'leading_context_required'
    if (hasEndingIssue) return 'unresolved_ending'
    return 'no_clean_boundary'
  }

  private range(start: number, end: number) {
    const values: number[] = []
    for (let value = start; value <= end; value += 1) {
      values.push(value)
    }
    return values
  }

  private verificationScore(verification: VerificationResult) {
    if (verification.status === 'accepted') return 100
    if (verification.status === 'needs_repair') return 50 - verification.issues.length
    return 10 - verification.issues.length
  }

  private canSurfaceWithWarnings(
    candidate: ThreadCandidateSelection,
    verification: VerificationResult,
    coherenceReview: ThreadCoherenceReview | null,
    coherenceReviewError: string | null
  ) {
    if (verification.issueClasses.hardMechanicalInvalid.length > 0) return false
    if (verification.startTime === null || verification.endTime === null || verification.duration === null) return false
    if (verification.duration < MIN_CLIP_SECONDS || verification.duration > MAX_CLIP_SECONDS) return false

    const hasEndingWarning = verification.issues.includes('lookahead_continues_current_ending')
    const onlySemanticWarnings = verification.issues.every((issue) => (
      issue === 'leading_continues_previous_thought' ||
      issue === 'lookahead_continues_current_ending'
    ))
    if (verification.issues.length === 0) return false
    if (!onlySemanticWarnings) return false

    if (coherenceReview?.status === 'accepted') {
      return true
    }

    if (coherenceReview?.status === 'rejected') {
      return false
    }

    if (coherenceReviewError && candidate.confidence >= 0.82 && !hasEndingWarning) {
      return true
    }

    return candidate.confidence >= 0.88 && !hasEndingWarning
  }

  private resolveBoundaryWarningStatus(
    verification: VerificationResult,
    coherenceReview: ThreadCoherenceReview | null,
    acceptedClip: PipelineWorkerPotentialClip | null,
    reviewableWithWarningsClip: PipelineWorkerPotentialClip | null
  ): CandidateEvaluation['boundaryWarningStatus'] {
    if (reviewableWithWarningsClip) {
      return 'reviewable_with_warnings'
    }
    if (acceptedClip) {
      if (verification.issues.length === 0) {
        return 'none'
      }
      if (verification.issues.includes('leading_continues_previous_thought') &&
        !verification.issues.includes('lookahead_continues_current_ending')) {
        return 'soft_start_accepted'
      }
      if (coherenceReview?.boundaryWarningStatus === 'repaired') {
        return 'repaired'
      }
      return 'accepted_with_override'
    }
    if (coherenceReview?.boundaryWarningStatus) {
      return coherenceReview.boundaryWarningStatus
    }
    if (verification.issues.length === 0) {
      return 'none'
    }
    if (verification.issues.includes('leading_continues_previous_thought') &&
      !verification.issues.includes('lookahead_continues_current_ending')) {
      return 'soft_start_accepted'
    }
    return 'unresolved_rejected'
  }

  private buildClip(
    candidate: ThreadCandidateSelection,
    verification: VerificationResult,
    mode: 'accepted' | 'reviewable_with_warnings' = 'accepted'
  ): PipelineWorkerPotentialClip {
    const selectionDecisionId = randomUUID()
    return {
      id: `llm_thread_${candidate.id}_${selectionDecisionId.slice(0, 8)}`,
      selectionDecisionId,
      sourceArcId: null,
      startTime: verification.startTime ?? 0,
      endTime: verification.endTime ?? 0,
      duration: verification.duration ?? 0,
      contentType: this.inferContentType(candidate),
      shareabilityScore: Number(Math.max(1, Math.min(9.4, 6.8 + candidate.confidence * 2)).toFixed(1)),
      keyQuote: candidate.expectedPayoff || candidate.title,
      reason: mode === 'reviewable_with_warnings'
        ? `LLM thread rough cut accepted for review with boundary warnings: ${candidate.reason}`
        : `LLM thread rough cut: ${candidate.reason}`,
      contextNeeded: mode === 'reviewable_with_warnings'
        ? 'medium'
        : candidate.selfContained ? 'low' : 'medium'
    }
  }

  private inferContentType(candidate: ThreadCandidateSelection): PipelineWorkerPotentialClip['contentType'] {
    const text = `${candidate.title} ${candidate.reason} ${candidate.expectedPayoff ?? ''}`.toLowerCase()
    if (/\b(wrong|ridiculous|hot take|shouldn'?t|don'?t)\b/.test(text)) return 'hot_take'
    if (/\b(how|should|need to|have to|advice|lesson)\b/.test(text)) return 'advice'
    if (/\b(story|when we|i remember)\b/.test(text)) return 'story'
    return 'insight'
  }

  private buildResult(
    timeline: CanonicalConversationalTimeline,
    evaluations: CandidateEvaluation[],
    options: {
      llmDiscoveryError: string | null
      llmDiscoveryFailureCategory: string | null
      llmRepairError: string | null
      llmRepairFailureCategory: string | null
      llmRepairAttemptsExhausted: boolean
      mechanicalVariantsGenerated: number
      discoveryDiagnostics: Array<ThreadDiscoveryDiagnostics & { chunkId: string }>
      discoveryRetryAttempted: boolean
      discoveryChunksAttempted: number
      discoveryChunksSucceeded: number
      discoveryChunksFailed: number
      discoveryParseFailures: number
      partialDiscoveryFailure: boolean
      failedDiscoveryChunkIds: string[]
      coherenceReviewsAttempted: number
      llmCoherenceReviewError: string | null
      llmCoherenceReviewFailureCategory: string | null
      zeroOutputStage: SelectionZeroOutputStage | null
      zeroOutputSubreason: string | null
      targetClipCount?: number
      semanticGuide?: ThreadSemanticGuide | null
    }
  ): LlmThreadSelectorResult {
    const targetClipCount = options.targetClipCount ?? 25
    const accepted = evaluations
      .filter((evaluation) => evaluation.clip)
      .sort((left, right) => right.candidate.confidence - left.candidate.confidence)
    const selected = this.suppressOverlaps(accepted, targetClipCount)
    const finalization = this.finalizeMechanicalClips(timeline, selected.map((evaluation) => ({
      evaluation,
      clip: evaluation.clip!
    })))
    const salvageCandidates = finalization.accepted.length === 0
      ? this.suppressWarningOverlaps(
        evaluations
          .filter((evaluation) => evaluation.reviewableWithWarningsClip)
          .sort((left, right) => right.candidate.confidence - left.candidate.confidence),
        Math.min(3, targetClipCount)
      )
      : []
    const salvageFinalization = salvageCandidates.length > 0
      ? this.finalizeMechanicalClips(timeline, salvageCandidates.map((evaluation) => ({
        evaluation,
        clip: evaluation.reviewableWithWarningsClip!
      })))
      : { accepted: [], rejected: [] }
    const finalAccepted = finalization.accepted.length > 0
      ? finalization.accepted
      : salvageFinalization.accepted
    const finalRejected = [
      ...finalization.rejected,
      ...salvageFinalization.rejected
    ]
    const selectedEvaluations = new Set(finalAccepted.map((item) => item.evaluation))
    const mechanicalRejectionByEvaluation = new Map(finalRejected.map((item) => [item.evaluation, item.reason]))
    const salvageAcceptedEvaluations = new Set(salvageFinalization.accepted.map((item) => item.evaluation))
    const salvageAttempted = finalization.accepted.length === 0 && salvageCandidates.length > 0
    const semanticBoundaryRejectedCount = evaluations.filter((evaluation) => (
      evaluation.verification.issueClasses.hardMechanicalInvalid.length === 0 &&
      evaluation.verification.issueClasses.semanticRepairNeeded.length > 0 &&
      !evaluation.clip &&
      !evaluation.reviewableWithWarningsClip
    )).length
    const zeroOutputStage = options.zeroOutputStage ??
      (finalAccepted.length > 0
        ? null
        : evaluations.length === 0 && options.llmDiscoveryError
          ? 'llm_discovery_failed'
        : evaluations.length === 0
          ? 'llm_discovery_no_candidates'
            : options.llmRepairAttemptsExhausted || options.llmRepairError
              ? 'repair_failed'
              : accepted.length > 0 && finalization.accepted.length === 0
                ? 'mechanical_validation_failed'
                : selected.length === 0 && accepted.length > 0
                  ? 'portfolio_suppression'
                  : 'mechanical_validation_failed')
    const zeroOutputSubreason = options.zeroOutputSubreason ??
      this.resolveZeroOutputSubreason({
        finalAcceptedCount: finalAccepted.length,
        evaluations,
        options,
        finalRejected,
        semanticBoundaryRejectedCount,
        salvageAttempted
      })

    const finalizerByEvaluation = new Map<CandidateEvaluation, Record<string, unknown>>([
      ...finalAccepted.map((item) => [item.evaluation, item.finalizer] as const),
      ...finalRejected.map((item) => [item.evaluation, item.finalizer] as const)
    ])

    return {
      clips: finalAccepted.map((item) => item.clip),
      decisions: evaluations.map((evaluation, index) => ({
        id: evaluation.clip?.selectionDecisionId ?? evaluation.reviewableWithWarningsClip?.selectionDecisionId ?? randomUUID(),
        candidateArcId: null,
        decision: selectedEvaluations.has(evaluation) ? 'selected' : 'rejected',
        rankOrder: index + 1,
        modelScore: evaluation.candidate.confidence * 10,
        finalScore: evaluation.clip?.shareabilityScore ?? evaluation.reviewableWithWarningsClip?.shareabilityScore ?? 0,
        rejectionCode: selectedEvaluations.has(evaluation)
          ? undefined
          : mechanicalRejectionByEvaluation.get(evaluation) ?? 'llm_thread_verification_failed',
        reason: selectedEvaluations.has(evaluation)
          ? salvageAcceptedEvaluations.has(evaluation)
            ? `Selected by llm_thread_v1 zero-output salvage with boundary warnings: ${evaluation.candidate.reason}`
            : evaluation.candidate.reason
          : `Rejected by llm_thread_v1: ${mechanicalRejectionByEvaluation.get(evaluation) ?? (evaluation.verification.issues.join(', ') || evaluation.repairError || 'not selected')}`,
        validatorResultJson: JSON.stringify({
          stage: 'llm_thread_v1',
          originalCandidate: evaluation.originalCandidate,
          candidate: evaluation.candidate,
          originalLineRange: {
            startLineIndex: evaluation.originalCandidate.startLineIndex,
            endLineIndex: evaluation.originalCandidate.endLineIndex
          },
          finalLineRange: {
            startLineIndex: evaluation.candidate.startLineIndex,
            endLineIndex: evaluation.candidate.endLineIndex
          },
          verification: evaluation.verification,
          repairAttempts: evaluation.repairAttempts,
          repairError: evaluation.repairError,
          deterministicRepairApplied: evaluation.deterministicRepairApplied,
          deterministicRepairReason: evaluation.deterministicRepairReason,
          deterministicRepairFailureCode: evaluation.deterministicRepairFailureCode,
          coherenceReview: evaluation.coherenceReview,
          coherenceReviewError: evaluation.coherenceReviewError,
          boundaryWarningStatus: evaluation.boundaryWarningStatus,
          reviewableWithWarnings: Boolean(evaluation.reviewableWithWarningsClip),
          selectedViaSalvage: salvageAcceptedEvaluations.has(evaluation),
          mechanicalFinalizer: finalizerByEvaluation.get(evaluation) ?? null
        })
      })),
      metadata: {
        executor: 'llm_thread_selector_service',
        implementationVersion: 'llm_thread_v1',
        configuredSelectorMode: 'llm_thread_v1',
        primarySelectorMode: 'llm_thread_v1',
        finalSelectionSource: 'llm_thread_selector',
        fallbackAttempted: false,
        fallbackSource: null,
        fallbackReason: null,
        transcriptInputMode: timeline.sourceMetadata.transcriptInputMode,
        semanticTextSource: timeline.sourceMetadata.semanticTextSource,
        timingSource: timeline.sourceMetadata.timingSource,
        speakerSource: timeline.sourceMetadata.speakerSource,
        uploadedTranscriptGuide: options.semanticGuide
          ? {
            source: options.semanticGuide.source,
            fileName: options.semanticGuide.fileName,
            speakerLabels: options.semanticGuide.speakerLabels,
            textPreviewLength: options.semanticGuide.textPreview.length
          }
          : null,
        chunksProcessed: this.buildLineChunks(timeline.lines).length,
        threadCandidatesDiscovered: evaluations.length,
        threadCandidatesAccepted: finalAccepted.length,
        threadCandidatesRepaired: evaluations.filter((evaluation) => (evaluation.repairAttempts > 0 || evaluation.deterministicRepairApplied) && selectedEvaluations.has(evaluation)).length,
        threadCandidatesRejected: evaluations.filter((evaluation) => !selectedEvaluations.has(evaluation)).length,
        llmDiscoveryError: options.llmDiscoveryError,
        llmDiscoveryFailureCategory: options.llmDiscoveryFailureCategory,
        llmRepairError: options.llmRepairError,
        llmRepairFailureCategory: options.llmRepairFailureCategory,
        llmRepairAttemptsExhausted: options.llmRepairAttemptsExhausted,
        mechanicalVariantsGenerated: options.mechanicalVariantsGenerated,
        mechanicalVariantCeiling: VARIANT_GUARD_LIMIT,
        discoveryDiagnostics: options.discoveryDiagnostics,
        discoveryRetryAttempted: options.discoveryRetryAttempted,
        discoveryChunksAttempted: options.discoveryChunksAttempted,
        discoveryChunksSucceeded: options.discoveryChunksSucceeded,
        discoveryChunksFailed: options.discoveryChunksFailed,
        discoveryParseFailures: options.discoveryParseFailures,
        partialDiscoveryFailure: options.partialDiscoveryFailure,
        failedDiscoveryChunkIds: options.failedDiscoveryChunkIds,
        coherenceReviewsAttempted: options.coherenceReviewsAttempted,
        coherenceReviewsAccepted: evaluations.filter((evaluation) => evaluation.coherenceReview?.status === 'accepted' && selectedEvaluations.has(evaluation)).length,
        llmCoherenceReviewError: options.llmCoherenceReviewError,
        llmCoherenceReviewFailureCategory: options.llmCoherenceReviewFailureCategory,
        zeroOutputStage,
        zeroOutputSubreason,
        salvageAttempted,
        salvageSource: salvageAttempted ? 'llm_thread_zero_output_salvage' : null,
        salvageAcceptedCount: salvageFinalization.accepted.length,
        salvageRejectedCount: salvageFinalization.rejected.length,
        reviewableWithWarningsCount: evaluations.filter((evaluation) => evaluation.reviewableWithWarningsClip).length,
        finalClipsAccepted: finalAccepted.length,
        finalClipsRejected: evaluations.length - finalAccepted.length,
        selectedPreview: finalAccepted.slice(0, 5).map((item) => ({
          candidateId: item.evaluation.candidate.id,
          startTime: item.clip.startTime,
          endTime: item.clip.endTime,
          originalLineRange: `${item.evaluation.originalCandidate.startLineIndex}-${item.evaluation.originalCandidate.endLineIndex}`,
          finalLineRange: `${item.evaluation.candidate.startLineIndex}-${item.evaluation.candidate.endLineIndex}`,
          mechanicalFinalizer: item.finalizer,
          deterministicRepairApplied: item.evaluation.deterministicRepairApplied,
          coherenceReview: item.evaluation.coherenceReview,
          boundaryWarningStatus: item.evaluation.boundaryWarningStatus,
          reviewableWithWarnings: Boolean(item.evaluation.reviewableWithWarningsClip),
          selectedViaSalvage: salvageAcceptedEvaluations.has(item.evaluation),
          confidence: item.evaluation.candidate.confidence,
          title: item.evaluation.candidate.title
        })),
        rejectedPreview: [
          ...finalRejected.map((item) => ({
            candidateId: item.evaluation.candidate.id,
            issues: [item.reason],
            issueClasses: item.evaluation.verification.issueClasses,
            repairAttempts: item.evaluation.repairAttempts,
            repairError: item.evaluation.repairError,
            deterministicRepairApplied: item.evaluation.deterministicRepairApplied,
            deterministicRepairReason: item.evaluation.deterministicRepairReason,
            deterministicRepairFailureCode: item.evaluation.deterministicRepairFailureCode,
            coherenceReview: item.evaluation.coherenceReview,
            coherenceReviewError: item.evaluation.coherenceReviewError,
            boundaryWarningStatus: item.evaluation.boundaryWarningStatus,
            reviewableWithWarnings: Boolean(item.evaluation.reviewableWithWarningsClip),
            originalLineRange: `${item.evaluation.originalCandidate.startLineIndex}-${item.evaluation.originalCandidate.endLineIndex}`,
            finalLineRange: `${item.evaluation.candidate.startLineIndex}-${item.evaluation.candidate.endLineIndex}`,
            title: item.evaluation.candidate.title,
            mechanicalFinalizer: item.finalizer
          })),
          ...evaluations.filter((evaluation) => !evaluation.clip).map((evaluation) => ({
            candidateId: evaluation.candidate.id,
            issues: evaluation.verification.issues,
            issueClasses: evaluation.verification.issueClasses,
            repairAttempts: evaluation.repairAttempts,
            repairError: evaluation.repairError,
            deterministicRepairApplied: evaluation.deterministicRepairApplied,
            deterministicRepairReason: evaluation.deterministicRepairReason,
            deterministicRepairFailureCode: evaluation.deterministicRepairFailureCode,
            coherenceReview: evaluation.coherenceReview,
            coherenceReviewError: evaluation.coherenceReviewError,
            boundaryWarningStatus: evaluation.boundaryWarningStatus,
            reviewableWithWarnings: Boolean(evaluation.reviewableWithWarningsClip),
            originalLineRange: `${evaluation.originalCandidate.startLineIndex}-${evaluation.originalCandidate.endLineIndex}`,
            finalLineRange: `${evaluation.candidate.startLineIndex}-${evaluation.candidate.endLineIndex}`,
            title: evaluation.candidate.title
          }))
        ].slice(0, 8)
      }
    }
  }

  private resolveZeroOutputSubreason(input: {
    finalAcceptedCount: number
    evaluations: CandidateEvaluation[]
    options: {
      llmDiscoveryError: string | null
      llmRepairError: string | null
      llmRepairAttemptsExhausted: boolean
      discoveryChunksFailed: number
      discoveryParseFailures: number
      partialDiscoveryFailure: boolean
      llmCoherenceReviewError: string | null
    }
    finalRejected: Array<{ reason: string }>
    semanticBoundaryRejectedCount: number
    salvageAttempted: boolean
  }) {
    if (input.finalAcceptedCount > 0) return null
    if (input.evaluations.length === 0 && input.options.llmDiscoveryError) {
      return input.options.discoveryParseFailures > 0
        ? 'all_discovery_chunks_failed_parse_or_retry'
        : 'all_discovery_chunks_failed'
    }
    if (input.options.partialDiscoveryFailure && input.semanticBoundaryRejectedCount > 0) {
      return 'partial_discovery_failure_and_all_surviving_candidates_failed_boundaries'
    }
    if (input.options.llmCoherenceReviewError) {
      return 'llm_coherence_parse_failed_or_review_failed'
    }
    if (input.options.llmRepairAttemptsExhausted || input.options.llmRepairError) {
      return input.semanticBoundaryRejectedCount > 0
        ? 'all_candidates_failed_semantic_boundary_repair'
        : 'repair_attempts_exhausted'
    }
    if (input.semanticBoundaryRejectedCount > 0) {
      return input.salvageAttempted
        ? 'same_mode_salvage_failed_mechanical_finalization'
        : 'semantic_boundary_gate_rejected_all_candidates'
    }
    if (input.finalRejected.length > 0) {
      return input.finalRejected[0]?.reason ?? 'mechanical_finalization_rejected_all_candidates'
    }
    return 'no_mechanically_valid_candidates_to_surface'
  }

  private finalizeMechanicalClips(
    timeline: CanonicalConversationalTimeline,
    items: Array<{ evaluation: CandidateEvaluation; clip: PipelineWorkerPotentialClip }>
  ) {
    const wordByLineId = new Map<string, typeof timeline.words>()
    for (const line of timeline.lines) {
      wordByLineId.set(line.id, [])
    }
    for (const word of timeline.words) {
      if (!word.lineId) continue
      const words = wordByLineId.get(word.lineId)
      if (words) words.push(word)
    }

    const accepted: Array<{
      evaluation: CandidateEvaluation
      clip: PipelineWorkerPotentialClip
      finalizer: Record<string, unknown>
    }> = []
    const rejected: Array<{
      evaluation: CandidateEvaluation
      reason: string
      finalizer: Record<string, unknown>
    }> = []

    for (const item of items) {
      const selectedLines = this.getSelectedLines(timeline.lines, item.evaluation.candidate)
      const selectedWords = selectedLines.flatMap((line) => wordByLineId.get(line.id) ?? [])
      const firstWord = selectedWords[0]
      const lastWord = selectedWords[selectedWords.length - 1]

      if (!firstWord || !lastWord) {
        rejected.push({
          evaluation: item.evaluation,
          reason: 'mechanical_finalizer_missing_word_grounding',
          finalizer: { status: 'rejected', reason: 'missing_word_grounding' }
        })
        continue
      }

      // Cut placement authority: the acoustic silence map. Whisper word timestamps
      // absorb real pauses into word spans, so when a detected silence sits adjacent
      // to the boundary word we cut inside the silence. Only when no adjacent silence
      // exists (genuine crosstalk) do we fall back to guarded word-snap pads — those
      // cuts rely on the export micro-fades to read as deliberate.
      const firstWordIndex = timeline.words.indexOf(firstWord)
      const lastWordIndex = timeline.words.indexOf(lastWord)
      const previousWord = firstWordIndex > 0 ? timeline.words[firstWordIndex - 1] : undefined
      const nextWord =
        lastWordIndex >= 0 && lastWordIndex + 1 < timeline.words.length
          ? timeline.words[lastWordIndex + 1]
          : undefined
      const leadingGap = previousWord ? firstWord.startTime - previousWord.endTime : Number.POSITIVE_INFINITY
      const trailingGap = nextWord ? nextWord.startTime - lastWord.endTime : Number.POSITIVE_INFINITY

      const startSilence = this.findAdjacentSilence(timeline.silences, 'start', firstWord.startTime)
      const endSilence = this.findAdjacentSilence(timeline.silences, 'end', lastWord.endTime)

      let startTime: number
      if (startSilence) {
        const silenceDuration = startSilence.end - startSilence.start
        startTime = Math.max(
          0,
          startSilence.start,
          startSilence.end - Math.min(0.3, Math.max(0.1, silenceDuration * 0.5))
        )
      } else {
        const headPad = Math.min(BOUNDARY_HEAD_PAD_SECONDS, Math.max(0, leadingGap - BOUNDARY_WORD_GUARD_SECONDS))
        startTime = Math.max(0, firstWord.startTime - headPad)
      }

      let endTime: number
      if (endSilence) {
        const silenceDuration = endSilence.end - endSilence.start
        endTime = Math.min(
          timeline.mediaDuration,
          endSilence.end,
          endSilence.start + Math.min(BOUNDARY_MAX_TAIL_PAD_SECONDS, Math.max(0.12, silenceDuration * 0.5))
        )
      } else {
        endTime = Math.min(
          timeline.mediaDuration,
          resolveClipEndWithTrailingPad({
            words: [
              { word: lastWord.word, start: lastWord.startTime, end: lastWord.endTime },
              ...(nextWord ? [{ word: nextWord.word, start: nextWord.startTime, end: nextWord.endTime }] : [])
            ],
            wordIndex: 0,
            mediaDuration: timeline.mediaDuration,
            trailingPadSeconds: BOUNDARY_TAIL_PAD_SECONDS,
            maxTrailingPadSeconds: BOUNDARY_MAX_TAIL_PAD_SECONDS,
            guardSeconds: BOUNDARY_WORD_GUARD_SECONDS
          })
        )
      }
      const duration = Number((endTime - startTime).toFixed(3))
      if (duration < MIN_CLIP_SECONDS || duration > MAX_CLIP_SECONDS || endTime <= startTime) {
        rejected.push({
          evaluation: item.evaluation,
          reason: duration < MIN_CLIP_SECONDS ? 'mechanical_finalizer_duration_too_short' : 'mechanical_finalizer_duration_too_long',
          finalizer: { status: 'rejected', reason: 'duration', startTime, endTime, duration }
        })
        continue
      }

      accepted.push({
        evaluation: item.evaluation,
        clip: {
          ...item.clip,
          startTime,
          endTime,
          duration
        },
        finalizer: {
          status: 'accepted',
          snappedTo: 'selected_line_word_bounds',
          originalStartTime: item.clip.startTime,
          originalEndTime: item.clip.endTime,
          startTime,
          endTime,
          duration,
          leadingGapSeconds: Number.isFinite(leadingGap) ? Number(leadingGap.toFixed(3)) : null,
          trailingGapSeconds: Number.isFinite(trailingGap) ? Number(trailingGap.toFixed(3)) : null,
          startCutMode: startSilence ? 'pause_cut' : 'hard_handoff_faded',
          endCutMode: endSilence ? 'pause_cut' : 'hard_handoff_faded',
          startCutSilence: startSilence
            ? { start: Number(startSilence.start.toFixed(3)), end: Number(startSilence.end.toFixed(3)) }
            : null,
          endCutSilence: endSilence
            ? { start: Number(endSilence.start.toFixed(3)), end: Number(endSilence.end.toFixed(3)) }
            : null
        }
      })
    }

    return { accepted, rejected }
  }

  private suppressOverlaps(evaluations: CandidateEvaluation[], limit: number) {
    const selected: CandidateEvaluation[] = []
    for (const evaluation of evaluations) {
      if (!evaluation.clip || selected.length >= limit) continue
      if (selected.some((accepted) => accepted.clip && this.clipsDuplicate(accepted.clip, evaluation.clip!))) {
        continue
      }
      selected.push(evaluation)
    }
    return selected
  }

  private suppressWarningOverlaps(evaluations: CandidateEvaluation[], limit: number) {
    const selected: CandidateEvaluation[] = []
    for (const evaluation of evaluations) {
      const clip = evaluation.reviewableWithWarningsClip
      if (!clip || selected.length >= limit) continue
      if (selected.some((accepted) => (
        accepted.reviewableWithWarningsClip &&
        this.clipsDuplicate(accepted.reviewableWithWarningsClip, clip)
      ))) {
        continue
      }
      selected.push(evaluation)
    }
    return selected
  }

  // Two clips duplicate content when they overlap substantially by ratio, or share
  // more than a few absolute seconds — a shared sentence across two published reels
  // reads as duplication even when the ratio is small against a long clip.
  private clipsDuplicate(left: PipelineWorkerPotentialClip, right: PipelineWorkerPotentialClip) {
    const overlapStart = Math.max(left.startTime, right.startTime)
    const overlapEnd = Math.min(left.endTime, right.endTime)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap <= 0) return false
    return overlap / Math.min(left.duration, right.duration) > 0.55 || overlap > 3
  }
}

export const llmThreadSelectorService = new LlmThreadSelectorService()
export default llmThreadSelectorService
