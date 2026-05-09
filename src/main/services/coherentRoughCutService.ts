import { randomUUID } from 'crypto'
import {
  getLeadingBoundaryIssue,
  getTrailingBoundaryIssue,
  isCleanClipEnd,
  isCleanClipStart,
  looksLikeCompleteThought,
  startsLikeContinuation
} from '../../shared/clipBoundaryQuality'
import type { CandidateArc, EditorialUnit } from '../../shared/editorialUnits'
import { buildTranscriptLinesFromSegments } from '../../shared/transcriptLines'
import type AIService from './aiService'
import type { RoughCutVariantForJudging, RoughCutVariantJudgment } from './aiService'
import type {
  PipelineWorkerPotentialClip,
  PipelineWorkerSelectionDecision,
  PipelineWorkerTranscription
} from '@shared/types/pipelineWorker'

type RoughCutMoment = {
  id: string
  source: 'candidate_arc' | 'editorial_unit_window' | 'transcript_line_window'
  sourceArcId: string | null
  sourceUnitIds: string[]
  startTime: number
  endTime: number
  score: number
  momentType: PipelineWorkerPotentialClip['contentType']
  reasonForInterest: string
}

type RoughCutThread = {
  momentId: string
  label: string
  summary: string
  requiredContext: string | null
  expectedResolution: string | null
}

type DraftSpan = {
  id: string
  momentId: string
  startTime: number
  endTime: number
  source: string
  rationale: string
}

type BoundaryVariant = {
  id: string
  momentId: string
  draftSpanId: string
  variantType: string
  editOperation: string
  startTime: number
  endTime: number
  duration: number
  transcriptText: string
}

type CompletenessEvaluation = {
  variantId: string
  isCoherent: boolean
  startStatus: 'clean' | 'abrupt'
  endStatus: 'rounded' | 'unresolved'
  contextStatus: 'sufficient' | 'missing_previous' | 'needs_next'
  threadPreserved: boolean
  tooPadded: boolean
  fatalIssues: string[]
  score: number
  rationale: string
}

type RoughCutCandidate = {
  moment: RoughCutMoment
  thread: RoughCutThread
  draftSpan: DraftSpan
  variant: BoundaryVariant
  evaluation: CompletenessEvaluation
  clip: PipelineWorkerPotentialClip
}

export type CoherentRoughCutResult = {
  clips: PipelineWorkerPotentialClip[]
  decisions: PipelineWorkerSelectionDecision[]
  metadata: {
    executor: 'coherent_rough_cut_service'
    implementationVersion: 'coherent_rough_cuts_v1'
    momentsGenerated: number
    threadsLabeled: number
    draftSpansCreated: number
    boundaryVariantsGenerated: number
    variantsEvaluated: number
    reviewableRoughCuts: number
    rejectedMoments: number
    overlapSuppressedCount: number
    modelJudgeAttempted: boolean
    modelJudgeSucceeded: boolean
    modelJudgeFailureReason?: string
    selectedPreview: Array<Record<string, unknown>>
    rejectedPreview: Array<Record<string, unknown>>
  }
}

const TARGET_MIN_SECONDS = 20
const TARGET_MAX_SECONDS = 90
const REPAIR_MAX_SECONDS = 150
const MOMENT_LIMIT = 24
const ARC_MOMENT_LIMIT = 10
const UNIT_WINDOW_LIMIT = 8
const TRANSCRIPT_LINE_WINDOW_LIMIT = 14

class CoherentRoughCutService {
  async selectRoughCuts(input: {
    transcription: PipelineWorkerTranscription
    editorialUnits: EditorialUnit[]
    candidateArcs: CandidateArc[]
    mediaDuration: number
    targetClipCount: number
    aiService?: AIService | null
    onProgress?: (progress: number) => void
  }): Promise<CoherentRoughCutResult> {
    const moments = this.generateMoments(input.editorialUnits, input.candidateArcs, input.transcription)
    const momentEvaluations: Array<{
      moment: RoughCutMoment
      thread: RoughCutThread
      draftSpan: DraftSpan
      evaluated: Array<{ variant: BoundaryVariant; evaluation: CompletenessEvaluation }>
    }> = []
    let boundaryVariantsGenerated = 0
    let variantsEvaluated = 0

    input.onProgress?.(15)
    for (const moment of moments) {
      const thread = this.labelThread(moment, input.editorialUnits, input.candidateArcs)
      const draftSpan = this.createDraftSpan(moment)
      const variants = this.generateBoundaryVariants({
        moment,
        draftSpan,
        transcription: input.transcription,
        editorialUnits: input.editorialUnits,
        mediaDuration: input.mediaDuration
      })
      boundaryVariantsGenerated += variants.length

      const evaluated = variants
        .map((variant) => ({
          variant,
          evaluation: this.evaluateVariant(input.transcription, variant)
        }))
        .sort((left, right) => right.evaluation.score - left.evaluation.score)
      variantsEvaluated += evaluated.length
      momentEvaluations.push({ moment, thread, draftSpan, evaluated })
    }

    input.onProgress?.(35)
    const modelJudgeResult = await this.applyModelJudgments(input.aiService ?? null, input.transcription, momentEvaluations, input.onProgress)
    const candidates: RoughCutCandidate[] = []
    const rejected: Array<Record<string, unknown>> = []

    for (const item of momentEvaluations) {
      const winner = item.evaluated.find((candidate) => candidate.evaluation.isCoherent) ?? null
      if (!winner) {
        rejected.push({
          momentId: item.moment.id,
          sourceArcId: item.moment.sourceArcId,
          thread: item.thread.label,
          bestVariant: item.evaluated[0]?.variant.variantType ?? null,
          fatalIssues: item.evaluated[0]?.evaluation.fatalIssues ?? ['no_boundary_variants'],
          rationale: item.evaluated[0]?.evaluation.rationale ?? 'No coherent rough-cut boundary variant was available.'
        })
        continue
      }

      candidates.push({
        moment: item.moment,
        thread: item.thread,
        draftSpan: item.draftSpan,
        variant: winner.variant,
        evaluation: winner.evaluation,
        clip: this.buildClip(item.moment, item.thread, winner.variant, winner.evaluation)
      })
    }

    const portfolio = this.selectPortfolio(candidates, input.targetClipCount)
    const decisions = this.buildSelectionDecisions(moments, portfolio)

    return {
      clips: portfolio.map((candidate) => candidate.clip),
      decisions,
      metadata: {
        executor: 'coherent_rough_cut_service',
        implementationVersion: 'coherent_rough_cuts_v1',
        momentsGenerated: moments.length,
        threadsLabeled: moments.length,
        draftSpansCreated: moments.length,
        boundaryVariantsGenerated,
        variantsEvaluated,
        reviewableRoughCuts: portfolio.length,
        rejectedMoments: Math.max(0, moments.length - portfolio.length),
        overlapSuppressedCount: Math.max(0, candidates.length - portfolio.length),
        modelJudgeAttempted: modelJudgeResult.attempted,
        modelJudgeSucceeded: modelJudgeResult.succeeded,
        modelJudgeFailureReason: modelJudgeResult.failureReason,
        selectedPreview: portfolio.slice(0, 5).map((candidate) => ({
          momentId: candidate.moment.id,
          sourceArcId: candidate.moment.sourceArcId,
          thread: candidate.thread.label,
          startTime: candidate.clip.startTime,
          endTime: candidate.clip.endTime,
          duration: candidate.clip.duration,
          score: candidate.evaluation.score,
          variantType: candidate.variant.variantType,
          repairOperation: candidate.variant.editOperation
        })),
        rejectedPreview: rejected.slice(0, 8)
      }
    }
  }

  private generateMoments(
    units: EditorialUnit[],
    arcs: CandidateArc[],
    transcription: PipelineWorkerTranscription
  ): RoughCutMoment[] {
    const arcMoments = arcs.slice(0, ARC_MOMENT_LIMIT).map((arc, index): RoughCutMoment => ({
      id: `moment_arc_${index + 1}_${arc.id}`,
      source: 'candidate_arc',
      sourceArcId: arc.id,
      sourceUnitIds: arc.unitIds,
      startTime: arc.startTime,
      endTime: arc.endTime,
      score: Number((arc.scores.overall * 10).toFixed(2)),
      momentType: arc.scores.emotionalEnergy >= 0.65 ? 'hot_take' : 'insight',
      reasonForInterest: arc.summary || arc.topic || arc.keyQuote
    }))

    const unitWindows: RoughCutMoment[] = []
    for (let startIndex = 0; startIndex < units.length; startIndex += 1) {
      for (let endIndex = startIndex; endIndex < units.length; endIndex += 1) {
        const windowUnits = units.slice(startIndex, endIndex + 1)
        const first = windowUnits[0]
        const last = windowUnits[windowUnits.length - 1]
        const duration = last.endTime - first.startTime
        if (duration > TARGET_MAX_SECONDS) break
        if (duration < TARGET_MIN_SECONDS) continue
        if (!windowUnits.some((unit) => unit.role === 'claim' || unit.role === 'hook' || unit.role === 'payoff')) continue

        unitWindows.push({
          id: `moment_window_${unitWindows.length + 1}`,
          source: 'editorial_unit_window',
          sourceArcId: null,
          sourceUnitIds: windowUnits.map((unit) => unit.id),
          startTime: first.startTime,
          endTime: last.endTime,
          score: this.scoreUnitWindow(windowUnits),
          momentType: 'insight',
          reasonForInterest: windowUnits.map((unit) => unit.text).join(' ').slice(0, 220)
        })
      }
    }

    const transcriptLineWindows = this.generateTranscriptLineWindowMoments(transcription)

    return [
      ...arcMoments,
      ...unitWindows.sort((left, right) => right.score - left.score).slice(0, UNIT_WINDOW_LIMIT),
      ...transcriptLineWindows
    ]
      .sort((left, right) => right.score - left.score)
      .slice(0, MOMENT_LIMIT)
  }

  private generateTranscriptLineWindowMoments(transcription: PipelineWorkerTranscription): RoughCutMoment[] {
    const lines = buildTranscriptLinesFromSegments(transcription.segments)
    const windows: RoughCutMoment[] = []

    for (let startIndex = 0; startIndex < lines.length; startIndex += 1) {
      for (let endIndex = startIndex; endIndex < lines.length; endIndex += 1) {
        const startLine = lines[startIndex]
        const endLine = lines[endIndex]
        const duration = endLine.end - startLine.start
        if (duration > REPAIR_MAX_SECONDS) break
        if (duration < TARGET_MIN_SECONDS) continue

        const text = lines.slice(startIndex, endIndex + 1).map((line) => line.text).join(' ').replace(/\s+/g, ' ').trim()
        if (!this.hasEnoughSubstance(text)) continue

        windows.push({
          id: `moment_line_window_${startIndex + 1}_${endIndex + 1}`,
          source: 'transcript_line_window',
          sourceArcId: null,
          sourceUnitIds: [],
          startTime: startLine.start,
          endTime: endLine.end,
          score: this.scoreTranscriptLineWindow(text, duration, startIndex, endIndex),
          momentType: this.inferMomentTypeFromText(text),
          reasonForInterest: text.slice(0, 260)
        })
      }
    }

    return windows
      .sort((left, right) => right.score - left.score)
      .slice(0, TRANSCRIPT_LINE_WINDOW_LIMIT)
  }

  private async applyModelJudgments(
    aiService: AIService | null,
    transcription: PipelineWorkerTranscription,
    momentEvaluations: Array<{
      moment: RoughCutMoment
      thread: RoughCutThread
      draftSpan: DraftSpan
      evaluated: Array<{ variant: BoundaryVariant; evaluation: CompletenessEvaluation }>
    }>,
    onProgress?: (progress: number) => void
  ) {
    if (!aiService) {
      return { attempted: false, succeeded: false }
    }

    const judgeInputs = momentEvaluations
      .flatMap((item) => this.selectVariantsForModelJudgment(item.evaluated).map((candidate): RoughCutVariantForJudging => ({
        variantId: candidate.variant.id,
        momentId: item.moment.id,
        threadLabel: item.thread.label,
        duration: candidate.variant.duration,
        transcriptText: candidate.variant.transcriptText,
        previousContext: this.extractText(transcription, Math.max(0, candidate.variant.startTime - 12), candidate.variant.startTime),
        nextContext: this.extractText(transcription, candidate.variant.endTime, Math.min(candidate.variant.endTime + 18, transcription.segments[transcription.segments.length - 1]?.end ?? candidate.variant.endTime + 18)),
        deterministicIssues: candidate.evaluation.fatalIssues
      })))
      .slice(0, 72)

    if (judgeInputs.length === 0) {
      return { attempted: false, succeeded: false }
    }

    try {
      const judgments = await aiService.judgeRoughCutVariants(judgeInputs, (progress) => {
        onProgress?.(35 + progress * 0.45)
      })
      const judgmentByVariantId = new Map(judgments.map((judgment) => [judgment.variantId, judgment]))
      for (const item of momentEvaluations) {
        item.evaluated = item.evaluated
          .map((candidate) => {
            const judgment = judgmentByVariantId.get(candidate.variant.id)
            if (!judgment) {
              return candidate
            }
            return {
              ...candidate,
              evaluation: this.mergeModelJudgment(candidate.evaluation, judgment)
            }
          })
          .sort((left, right) => right.evaluation.score - left.evaluation.score)
      }
      return { attempted: true, succeeded: judgments.length > 0 }
    } catch (error) {
      return {
        attempted: true,
        succeeded: false,
        failureReason: error instanceof Error ? error.message : 'Unknown rough cut model judgment error'
      }
    }
  }

  private selectVariantsForModelJudgment(
    evaluated: Array<{ variant: BoundaryVariant; evaluation: CompletenessEvaluation }>
  ) {
    const selected = new Map<string, { variant: BoundaryVariant; evaluation: CompletenessEvaluation }>()
    const add = (candidate: { variant: BoundaryVariant; evaluation: CompletenessEvaluation } | undefined) => {
      if (candidate) {
        selected.set(candidate.variant.id, candidate)
      }
    }

    evaluated.slice(0, 6).forEach(add)
    add([...evaluated].sort((left, right) => left.variant.startTime - right.variant.startTime)[0])
    add([...evaluated].sort((left, right) => right.variant.endTime - left.variant.endTime)[0])
    add([...evaluated].sort((left, right) =>
      (right.variant.endTime - right.variant.startTime) - (left.variant.endTime - left.variant.startTime)
    )[0])
    add(evaluated.find((candidate) =>
      candidate.variant.editOperation.includes('expand_left') &&
      candidate.variant.editOperation.includes('expand_right')
    ))
    add(evaluated.find((candidate) => candidate.variant.variantType.includes('previous_line_start')))
    add(evaluated.find((candidate) => candidate.variant.variantType.includes('next_line_end')))

    return [...selected.values()]
      .sort((left, right) => right.evaluation.score - left.evaluation.score)
      .slice(0, 10)
  }

  private mergeModelJudgment(
    deterministic: CompletenessEvaluation,
    judgment: RoughCutVariantJudgment
  ): CompletenessEvaluation {
    const fatalIssues = judgment.fatalIssues.length > 0
      ? judgment.fatalIssues
      : deterministic.fatalIssues
    const isCoherent = judgment.isReviewable &&
      judgment.startStatus === 'clean' &&
      judgment.endStatus === 'rounded' &&
      judgment.contextStatus === 'sufficient' &&
      judgment.threadPreserved

    return {
      variantId: deterministic.variantId,
      isCoherent,
      startStatus: judgment.startStatus,
      endStatus: judgment.endStatus,
      contextStatus: judgment.contextStatus,
      threadPreserved: judgment.threadPreserved,
      tooPadded: judgment.tooPadded,
      fatalIssues: isCoherent ? [] : fatalIssues,
      score: Number(Math.max(0, Math.min(100, judgment.score)).toFixed(3)),
      rationale: judgment.rationale || deterministic.rationale
    }
  }

  private scoreUnitWindow(units: EditorialUnit[]) {
    const cleanStart = units[0]?.startsCleanly ? 1.5 : 0
    const cleanEnd = units[units.length - 1]?.endsCleanly ? 1.5 : 0
    const roleScore = units.reduce((score, unit) => {
      if (unit.role === 'hook' || unit.role === 'claim') return score + 1
      if (unit.role === 'payoff') return score + 1.2
      if (unit.role === 'filler' || unit.role === 'aside') return score - 0.5
      return score + 0.3
    }, 0)
    return Number(Math.max(1, Math.min(9.2, 4 + cleanStart + cleanEnd + roleScore)).toFixed(2))
  }

  private hasEnoughSubstance(text: string) {
    const words = text.split(/\s+/).filter(Boolean)
    if (words.length < 90) {
      return false
    }

    const normalized = text.toLowerCase()
    const fillerMatches = normalized.match(/\b(yeah|yep|okay|right|like|you know|um|uh)\b/g) ?? []
    const fillerRatio = fillerMatches.length / words.length
    if (fillerRatio > 0.16) {
      return false
    }

    return /\b(because|why|how|what|think|mean|point|problem|decision|decisions|business|people|need|should|actually|really|important|different|wrong|right|works|own|owned|ownership|consistent|consistency)\b/i.test(text)
  }

  private scoreTranscriptLineWindow(text: string, duration: number, startIndex: number, endIndex: number) {
    const openingWords = text.split(/\s+/).slice(0, 12).join(' ')
    const endingWords = text.split(/\s+/).slice(-18).join(' ')
    const cleanStart = !getLeadingBoundaryIssue(openingWords) && isCleanClipStart(openingWords)
    const cleanEnd = !getTrailingBoundaryIssue(endingWords) && (isCleanClipEnd(text) || looksLikeCompleteThought(text))
    const durationScore = duration >= 35 && duration <= TARGET_MAX_SECONDS
      ? 1.4
      : duration <= 120
        ? 0.8
        : 0.2
    const lineCount = endIndex - startIndex + 1
    const lineCountScore = lineCount >= 3 && lineCount <= 10 ? 0.8 : 0.2
    const substanceScore = this.hasStrongConversationalSubstance(text) ? 1.2 : 0.4

    return Number(Math.max(1, Math.min(9.5,
      5.2 +
      (cleanStart ? 1 : -0.8) +
      (cleanEnd ? 1.2 : -0.6) +
      durationScore +
      lineCountScore +
      substanceScore
    )).toFixed(2))
  }

  private hasStrongConversationalSubstance(text: string) {
    return /\b(that'?s why|that'?s how|which means|the point is|because|the problem|the decision|wrong way|right way|need to|have to|be able to|business|ownership|consistency|consistent)\b/i.test(text)
  }

  private inferMomentTypeFromText(text: string): PipelineWorkerPotentialClip['contentType'] {
    if (/\b(wrong way|right way|shouldn'?t|don'?t|hot take|honestly)\b/i.test(text)) {
      return 'hot_take'
    }
    if (/\b(how to|need to|have to|should|practical|decision|decisions)\b/i.test(text)) {
      return 'advice'
    }
    return 'insight'
  }

  private labelThread(moment: RoughCutMoment, units: EditorialUnit[], arcs: CandidateArc[]): RoughCutThread {
    const arc = moment.sourceArcId ? arcs.find((candidate) => candidate.id === moment.sourceArcId) : null
    const sourceUnits = units.filter((unit) => moment.sourceUnitIds.includes(unit.id))
    const label = arc?.topic || arc?.summary || sourceUnits.map((unit) => unit.text).join(' ').slice(0, 140)
    return {
      momentId: moment.id,
      label: label.replace(/\s+/g, ' ').trim() || 'Conversational moment',
      summary: (arc?.summary || moment.reasonForInterest).replace(/\s+/g, ' ').trim(),
      requiredContext: sourceUnits[0]?.continuesPrevious ? 'Earlier context may be needed for a natural entry.' : null,
      expectedResolution: sourceUnits[sourceUnits.length - 1]?.continuesNext ? 'The thread likely resolves after the draft end.' : null
    }
  }

  private createDraftSpan(moment: RoughCutMoment): DraftSpan {
    return {
      id: `draft_${moment.id}`,
      momentId: moment.id,
      startTime: moment.startTime,
      endTime: moment.endTime,
      source: moment.source,
      rationale: `Initial draft span from ${moment.source}.`
    }
  }

  private generateBoundaryVariants(input: {
    moment: RoughCutMoment
    draftSpan: DraftSpan
    transcription: PipelineWorkerTranscription
    editorialUnits: EditorialUnit[]
    mediaDuration: number
  }): BoundaryVariant[] {
    const startAnchors = this.buildStartAnchors(input)
    const endAnchors = this.buildEndAnchors(input)
    const variants: BoundaryVariant[] = []

    for (const start of startAnchors) {
      for (const end of endAnchors) {
        if (end.time <= start.time) continue
        const duration = Number((end.time - start.time).toFixed(3))
        if (duration < TARGET_MIN_SECONDS || duration > REPAIR_MAX_SECONDS) continue
        const transcriptText = this.extractText(input.transcription, start.time, end.time)
        if (!transcriptText) continue
        variants.push({
          id: `variant_${input.moment.id}_${variants.length + 1}`,
          momentId: input.moment.id,
          draftSpanId: input.draftSpan.id,
          variantType: `${start.type}+${end.type}`,
          editOperation: this.resolveEditOperation(input.draftSpan, start.time, end.time),
          startTime: start.time,
          endTime: end.time,
          duration,
          transcriptText
        })
      }
    }

    return variants
  }

  private buildStartAnchors(input: {
    moment: RoughCutMoment
    draftSpan: DraftSpan
    transcription: PipelineWorkerTranscription
    editorialUnits: EditorialUnit[]
  }) {
    const minStart = Math.max(0, input.draftSpan.startTime - 60)
    const maxStart = input.draftSpan.startTime + 5
    const lines = buildTranscriptLinesFromSegments(input.transcription.segments)
    const unitStarts = input.editorialUnits
      .filter((unit) => unit.startTime >= minStart && unit.startTime <= maxStart)
      .map((unit) => ({
        time: unit.startTime,
        type: unit.startTime < input.draftSpan.startTime ? 'previous_unit_start' : 'unit_start'
      }))
    const lineStarts = lines
      .filter((line) => line.start >= minStart && line.start <= maxStart)
      .map((line) => ({
        time: line.start,
        type: line.start < input.draftSpan.startTime ? 'previous_line_start' : 'line_start'
      }))

    return this.uniqueAnchors([
      { time: input.draftSpan.startTime, type: 'draft_start' },
      ...unitStarts,
      ...lineStarts
    ])
  }

  private buildEndAnchors(input: {
    draftSpan: DraftSpan
    transcription: PipelineWorkerTranscription
    editorialUnits: EditorialUnit[]
    mediaDuration: number
  }) {
    const minEnd = Math.max(input.draftSpan.startTime + TARGET_MIN_SECONDS, input.draftSpan.endTime - 5)
    const maxEnd = Math.min(input.mediaDuration, input.draftSpan.startTime + REPAIR_MAX_SECONDS, input.draftSpan.endTime + 90)
    const lines = buildTranscriptLinesFromSegments(input.transcription.segments)
    const unitEnds = input.editorialUnits
      .filter((unit) => unit.endTime >= minEnd && unit.endTime <= maxEnd)
      .map((unit) => ({
        time: unit.endTime,
        type: unit.endTime > input.draftSpan.endTime ? 'next_unit_end' : 'unit_end'
      }))
    const lineEnds = lines
      .filter((line) => line.end >= minEnd && line.end <= maxEnd)
      .map((line) => ({
        time: line.end,
        type: line.end > input.draftSpan.endTime ? 'next_line_end' : 'line_end'
      }))

    return this.uniqueAnchors([
      { time: input.draftSpan.endTime, type: 'draft_end' },
      ...unitEnds,
      ...lineEnds
    ])
  }

  private evaluateVariant(
    transcription: PipelineWorkerTranscription,
    variant: BoundaryVariant
  ): CompletenessEvaluation {
    const openingWords = variant.transcriptText.split(/\s+/).slice(0, 12).join(' ')
    const endingWords = variant.transcriptText.split(/\s+/).slice(-18).join(' ')
    const leadingIssue = getLeadingBoundaryIssue(openingWords)
    const trailingIssue = getTrailingBoundaryIssue(endingWords) ?? getTrailingBoundaryIssue(variant.transcriptText)
    const nextText = this.extractText(transcription, variant.endTime, Math.min(variant.endTime + 12, variant.endTime + 30))
    const startsClean = !leadingIssue && isCleanClipStart(openingWords)
    const endsClean = !trailingIssue && (isCleanClipEnd(variant.transcriptText) || looksLikeCompleteThought(variant.transcriptText))
    const nextContinues = Boolean(nextText && (startsLikeContinuation(nextText) || !endsClean))
    const fatalIssues = [
      startsClean ? null : leadingIssue ?? 'abrupt_start',
      endsClean ? null : trailingIssue ?? 'unresolved_ending',
      nextContinues ? 'needs_next_sentence' : null
    ].filter((issue): issue is string => Boolean(issue))
    const tooPadded = variant.duration > TARGET_MAX_SECONDS
    const durationPenalty = tooPadded ? (variant.duration - TARGET_MAX_SECONDS) * 0.08 : 0
    const score = Number((
      50 +
      (startsClean ? 18 : -24) +
      (endsClean ? 24 : -30) +
      (!nextContinues ? 14 : -28) +
      (tooPadded ? -durationPenalty : 4) -
      variant.editOperation.split('+').filter((part) => part !== 'keep_start' && part !== 'keep_end').length * 1.5
    ).toFixed(3))

    return {
      variantId: variant.id,
      isCoherent: fatalIssues.length === 0 && score >= 45,
      startStatus: startsClean ? 'clean' : 'abrupt',
      endStatus: endsClean && !nextContinues ? 'rounded' : 'unresolved',
      contextStatus: !startsClean ? 'missing_previous' : nextContinues ? 'needs_next' : 'sufficient',
      threadPreserved: fatalIssues.length === 0,
      tooPadded,
      fatalIssues,
      score,
      rationale: fatalIssues.length === 0
        ? 'Variant preserves a coherent conversational thread with a clean start and rounded ending.'
        : `Variant is not reviewable: ${fatalIssues.join(', ')}.`
    }
  }

  private buildClip(
    moment: RoughCutMoment,
    thread: RoughCutThread,
    variant: BoundaryVariant,
    evaluation: CompletenessEvaluation
  ): PipelineWorkerPotentialClip {
    const selectionDecisionId = randomUUID()
    return {
      id: `rough_cut_${moment.id}`,
      selectionDecisionId,
      sourceArcId: moment.sourceArcId,
      startTime: variant.startTime,
      endTime: variant.endTime,
      duration: variant.duration,
      contentType: moment.momentType,
      shareabilityScore: Number(Math.max(1, Math.min(9.4, moment.score + evaluation.score / 100)).toFixed(1)),
      keyQuote: variant.transcriptText.slice(0, 220),
      reason: `Coherent rough cut for thread: ${thread.label}. ${evaluation.rationale}`,
      contextNeeded: evaluation.tooPadded ? 'medium' : 'low'
    }
  }

  private selectPortfolio(candidates: RoughCutCandidate[], limit: number) {
    const ranked = [...candidates].sort((left, right) => right.evaluation.score - left.evaluation.score)
    const selected: RoughCutCandidate[] = []

    for (const candidate of ranked) {
      if (selected.length >= limit) break
      if (selected.some((accepted) => this.overlapRatio(accepted.clip, candidate.clip) > 0.45)) {
        continue
      }
      selected.push(candidate)
    }

    return selected
  }

  private buildSelectionDecisions(
    moments: RoughCutMoment[],
    selected: RoughCutCandidate[]
  ): PipelineWorkerSelectionDecision[] {
    const selectedByMomentId = new Map(selected.map((candidate, index) => [candidate.moment.id, { candidate, index }]))
    return moments.map((moment) => {
      const match = selectedByMomentId.get(moment.id)
      if (match) {
        return {
          id: match.candidate.clip.selectionDecisionId ?? randomUUID(),
          candidateArcId: moment.sourceArcId,
          decision: 'selected',
          rankOrder: match.index + 1,
          modelScore: moment.score,
          finalScore: match.candidate.clip.shareabilityScore,
          reason: `Selected as coherent rough cut. ${match.candidate.thread.label}`,
          validatorResultJson: JSON.stringify(this.buildSelectedDecisionTrace(match.candidate))
        }
      }

      return {
        id: randomUUID(),
        candidateArcId: moment.sourceArcId,
        decision: 'rejected',
        modelScore: moment.score,
        finalScore: moment.score,
        rejectionCode: 'not_selected_by_rough_cut_portfolio',
        reason: 'Not selected by coherent rough cut portfolio pass.',
        validatorResultJson: JSON.stringify(this.buildRejectedDecisionTrace(moment))
      }
    })
  }

  private buildSelectedDecisionTrace(candidate: RoughCutCandidate) {
    return {
      stage: 'coherent_rough_cut_selector_v1',
      status: 'selected_for_final_validation',
      source: 'coherent_rough_cut_service',
      moment: this.summarizeMoment(candidate.moment),
      thread: candidate.thread,
      draftSpan: candidate.draftSpan,
      selectedVariant: this.summarizeVariant(candidate.variant),
      completenessEvaluation: candidate.evaluation
    }
  }

  private buildRejectedDecisionTrace(moment: RoughCutMoment) {
    return {
      stage: 'coherent_rough_cut_selector_v1',
      status: 'rejected_before_final_validation',
      source: 'coherent_rough_cut_service',
      rejectionCode: 'not_selected_by_rough_cut_portfolio',
      moment: this.summarizeMoment(moment)
    }
  }

  private summarizeMoment(moment: RoughCutMoment) {
    return {
      id: moment.id,
      source: moment.source,
      sourceArcId: moment.sourceArcId,
      sourceUnitIds: moment.sourceUnitIds,
      startTime: moment.startTime,
      endTime: moment.endTime,
      duration: Number((moment.endTime - moment.startTime).toFixed(3)),
      score: moment.score,
      momentType: moment.momentType,
      reasonForInterest: moment.reasonForInterest
    }
  }

  private summarizeVariant(variant: BoundaryVariant) {
    return {
      id: variant.id,
      momentId: variant.momentId,
      draftSpanId: variant.draftSpanId,
      variantType: variant.variantType,
      editOperation: variant.editOperation,
      startTime: variant.startTime,
      endTime: variant.endTime,
      duration: variant.duration,
      transcriptPreview: variant.transcriptText.slice(0, 700)
    }
  }

  private extractText(transcription: PipelineWorkerTranscription, startTime: number, endTime: number) {
    const words = transcription.segments
      .flatMap((segment) => segment.words ?? [])
      .filter((word) =>
        Number.isFinite(word.start) &&
        Number.isFinite(word.end) &&
        word.end > startTime &&
        word.start < endTime
      )
      .map((word) => String(word.word ?? '').trim())
      .filter(Boolean)

    if (words.length > 0) {
      return words.join(' ').replace(/\s+/g, ' ').trim()
    }

    return transcription.segments
      .filter((segment) => segment.end > startTime && segment.start < endTime)
      .map((segment) => segment.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private resolveEditOperation(draftSpan: DraftSpan, startTime: number, endTime: number) {
    const startOp = startTime < draftSpan.startTime - 0.04
      ? 'expand_left'
      : startTime > draftSpan.startTime + 0.04
        ? 'contract_left'
        : 'keep_start'
    const endOp = endTime > draftSpan.endTime + 0.04
      ? 'expand_right'
      : endTime < draftSpan.endTime - 0.04
        ? 'contract_right'
        : 'keep_end'
    return `${startOp}+${endOp}`
  }

  private uniqueAnchors(anchors: Array<{ time: number; type: string }>) {
    const byTime = new Map<number, { time: number; type: string }>()
    for (const anchor of anchors) {
      if (!Number.isFinite(anchor.time)) continue
      const time = Number(anchor.time.toFixed(3))
      if (!byTime.has(time)) byTime.set(time, { ...anchor, time })
    }
    return [...byTime.values()].sort((left, right) => left.time - right.time)
  }

  private overlapRatio(left: PipelineWorkerPotentialClip, right: PipelineWorkerPotentialClip) {
    const overlapStart = Math.max(left.startTime, right.startTime)
    const overlapEnd = Math.min(left.endTime, right.endTime)
    const overlap = Math.max(0, overlapEnd - overlapStart)
    if (overlap <= 0) return 0
    return overlap / Math.min(left.duration, right.duration)
  }
}

export const coherentRoughCutService = new CoherentRoughCutService()
export default coherentRoughCutService
