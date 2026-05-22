import { randomUUID } from 'crypto'
import type { CanonicalConversationalTimeline, CanonicalTranscriptLine } from '../../shared/canonicalTimeline'
import {
  getEndLookaheadIssue,
  getStartLookbackIssue
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
    coherenceReviewsAttempted: number
    coherenceReviewsAccepted: number
    llmCoherenceReviewError: string | null
    llmCoherenceReviewFailureCategory: string | null
    zeroOutputStage: string | null
    zeroOutputSubreason: string | null
    finalClipsAccepted: number
    finalClipsRejected: number
    rejectedPreview: Array<Record<string, unknown>>
    selectedPreview: Array<Record<string, unknown>>
  }
}

const MIN_CLIP_SECONDS = 25
const MAX_CLIP_SECONDS = 150
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

        discovered.push(...candidates)
      } catch (error) {
        llmDiscoveryError = error instanceof Error ? error.message : 'Unknown LLM discovery error'
        llmDiscoveryFailureCategory = this.resolveAiFailureCategory(error)
        discoveryDiagnostics.push({
          chunkId,
          responsePreview: '',
          rawCandidateCount: 0,
          validCandidateCount: 0,
          invalidCandidateCount: 0,
          invalidReasons: [llmDiscoveryError]
        })
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

      const clip = verification.status === 'accepted'
        ? this.buildClip(currentCandidate, verification)
        : null

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
        clip
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

  private buildClip(candidate: ThreadCandidateSelection, verification: VerificationResult): PipelineWorkerPotentialClip {
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
      reason: `LLM thread rough cut: ${candidate.reason}`,
      contextNeeded: candidate.selfContained ? 'low' : 'medium'
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
    const selectedIds = new Set(finalization.accepted.map((item) => item.evaluation.candidate.id))
    const mechanicalRejectionByCandidateId = new Map(finalization.rejected.map((item) => [item.evaluation.candidate.id, item.reason]))
    const zeroOutputStage = options.zeroOutputStage ??
      (finalization.accepted.length > 0
        ? null
        : options.llmDiscoveryError
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
      (finalization.accepted.length === 0 && finalization.rejected.length > 0
        ? finalization.rejected[0]?.reason ?? null
        : null)

    return {
      clips: finalization.accepted.map((item) => item.clip),
      decisions: evaluations.map((evaluation, index) => ({
        id: evaluation.clip?.selectionDecisionId ?? randomUUID(),
        candidateArcId: null,
        decision: selectedIds.has(evaluation.candidate.id) ? 'selected' : 'rejected',
        rankOrder: index + 1,
        modelScore: evaluation.candidate.confidence * 10,
        finalScore: evaluation.clip?.shareabilityScore ?? 0,
        rejectionCode: selectedIds.has(evaluation.candidate.id)
          ? undefined
          : mechanicalRejectionByCandidateId.get(evaluation.candidate.id) ?? 'llm_thread_verification_failed',
        reason: selectedIds.has(evaluation.candidate.id)
          ? evaluation.candidate.reason
          : `Rejected by llm_thread_v1: ${mechanicalRejectionByCandidateId.get(evaluation.candidate.id) ?? (evaluation.verification.issues.join(', ') || evaluation.repairError || 'not selected')}`,
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
          coherenceReviewError: evaluation.coherenceReviewError
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
        threadCandidatesAccepted: finalization.accepted.length,
        threadCandidatesRepaired: evaluations.filter((evaluation) => (evaluation.repairAttempts > 0 || evaluation.deterministicRepairApplied) && evaluation.clip).length,
        threadCandidatesRejected: evaluations.filter((evaluation) => !evaluation.clip).length + finalization.rejected.length,
        llmDiscoveryError: options.llmDiscoveryError,
        llmDiscoveryFailureCategory: options.llmDiscoveryFailureCategory,
        llmRepairError: options.llmRepairError,
        llmRepairFailureCategory: options.llmRepairFailureCategory,
        llmRepairAttemptsExhausted: options.llmRepairAttemptsExhausted,
        mechanicalVariantsGenerated: options.mechanicalVariantsGenerated,
        mechanicalVariantCeiling: VARIANT_GUARD_LIMIT,
        discoveryDiagnostics: options.discoveryDiagnostics,
        discoveryRetryAttempted: options.discoveryRetryAttempted,
        coherenceReviewsAttempted: options.coherenceReviewsAttempted,
        coherenceReviewsAccepted: evaluations.filter((evaluation) => evaluation.coherenceReview?.status === 'accepted' && selectedIds.has(evaluation.candidate.id)).length,
        llmCoherenceReviewError: options.llmCoherenceReviewError,
        llmCoherenceReviewFailureCategory: options.llmCoherenceReviewFailureCategory,
        zeroOutputStage,
        zeroOutputSubreason,
        finalClipsAccepted: finalization.accepted.length,
        finalClipsRejected: evaluations.length - finalization.accepted.length,
        selectedPreview: finalization.accepted.slice(0, 5).map((item) => ({
          candidateId: item.evaluation.candidate.id,
          startTime: item.clip.startTime,
          endTime: item.clip.endTime,
          originalLineRange: `${item.evaluation.originalCandidate.startLineIndex}-${item.evaluation.originalCandidate.endLineIndex}`,
          finalLineRange: `${item.evaluation.candidate.startLineIndex}-${item.evaluation.candidate.endLineIndex}`,
          mechanicalFinalizer: item.finalizer,
          deterministicRepairApplied: item.evaluation.deterministicRepairApplied,
          coherenceReview: item.evaluation.coherenceReview,
          confidence: item.evaluation.candidate.confidence,
          title: item.evaluation.candidate.title
        })),
        rejectedPreview: [
          ...finalization.rejected.map((item) => ({
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
            originalLineRange: `${evaluation.originalCandidate.startLineIndex}-${evaluation.originalCandidate.endLineIndex}`,
            finalLineRange: `${evaluation.candidate.startLineIndex}-${evaluation.candidate.endLineIndex}`,
            title: evaluation.candidate.title
          }))
        ].slice(0, 8)
      }
    }
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

      const startTime = Math.max(0, firstWord.startTime)
      const endTime = Math.min(timeline.mediaDuration, lastWord.endTime + 0.22)
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
          duration
        }
      })
    }

    return { accepted, rejected }
  }

  private suppressOverlaps(evaluations: CandidateEvaluation[], limit: number) {
    const selected: CandidateEvaluation[] = []
    for (const evaluation of evaluations) {
      if (!evaluation.clip || selected.length >= limit) continue
      if (selected.some((accepted) => accepted.clip && this.overlapRatio(accepted.clip, evaluation.clip!) > 0.55)) {
        continue
      }
      selected.push(evaluation)
    }
    return selected
  }

  private overlapRatio(left: PipelineWorkerPotentialClip, right: PipelineWorkerPotentialClip) {
    const overlapStart = Math.max(left.startTime, right.startTime)
    const overlapEnd = Math.min(left.endTime, right.endTime)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap <= 0) return 0
    return overlap / Math.min(left.duration, right.duration)
  }
}

export const llmThreadSelectorService = new LlmThreadSelectorService()
export default llmThreadSelectorService
