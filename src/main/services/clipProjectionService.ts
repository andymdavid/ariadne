import { randomUUID } from 'crypto'
import type { CandidateArc } from '../../shared/editorialUnits'
import type {
  PipelineWorkerPotentialClip,
  PipelineWorkerSelectionDecision
} from '@shared/types/pipelineWorker'

interface ProjectClipsInput {
  episodeId: string
  workflowJobId?: string
  selectionRunId?: string
  sourceResolution?: { width: number; height: number }
  finalClips: PipelineWorkerPotentialClip[]
  candidateArcs?: CandidateArc[]
  selectionDecisions?: PipelineWorkerSelectionDecision[]
}

interface ProjectedClipRecord extends PipelineWorkerPotentialClip {
  id: string
  episodeId: string
  videoWidth: number | null
  videoHeight: number | null
  workflowJobId: string | null
  selectionRunId: string | null
  sourceArcId: string | null
  selectionSource: string
  selectionConfidence: number | null
  approvalSource: 'pending_review'
  isActive: true
  status: 'pending_review'
  provenanceJson: string
}

interface SelectedDecisionMatch {
  decision: PipelineWorkerSelectionDecision
  arc?: CandidateArc
}

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

class ClipProjectionService {
  private readonly minimumDecisionMatchScore = 1.5

  projectClips(input: ProjectClipsInput): ProjectedClipRecord[] {
    const selectionSource = this.resolveSelectionSource(input.selectionDecisions)
    const decisionMatches = this.matchSelectedDecisionsToClips(
      input.finalClips,
      input.candidateArcs ?? [],
      input.selectionDecisions ?? []
    )

    return input.finalClips.map((clip, index) => {
      const match = decisionMatches[index]
      const selectionConfidence = this.resolveSelectionConfidence(match?.decision, clip.shareabilityScore)
      const sourceArcId = match?.decision.candidateArcId ?? clip.sourceArcId ?? null
      const validatorResult = parseJson<Record<string, unknown>>(match?.decision.validatorResultJson)

      return {
        ...clip,
        id: randomUUID(),
        episodeId: input.episodeId,
        videoWidth: input.sourceResolution?.width ?? null,
        videoHeight: input.sourceResolution?.height ?? null,
        workflowJobId: input.workflowJobId ?? null,
        selectionRunId: input.selectionRunId ?? null,
        sourceArcId,
        selectionSource,
        selectionConfidence,
        approvalSource: 'pending_review',
        isActive: true,
        status: 'pending_review',
        provenanceJson: JSON.stringify({
          selectionSource,
          workflowJobId: input.workflowJobId ?? null,
          selectionRunId: input.selectionRunId ?? null,
          sourceArcId,
          selectionConfidence,
          selectionDecisionId: match?.decision.id ?? clip.selectionDecisionId ?? null,
          selectionDecision: match?.decision.decision ?? null,
          validatorStatus: typeof validatorResult?.status === 'string' ? validatorResult.status : null,
          validatorResult,
          matchedBy: match ? this.resolveMatchStrategy(clip, match.arc) : null,
          clipIndex: index
        })
      }
    })
  }

  private resolveSelectionSource(
    selectionDecisions: PipelineWorkerSelectionDecision[] | undefined
  ): string {
    if (!Array.isArray(selectionDecisions) || selectionDecisions.length === 0) {
      return 'legacy_pipeline'
    }

    if (selectionDecisions.some((decision) => decision.decision === 'fallback_selected')) {
      return 'deterministic_candidate_arcs'
    }

    if (selectionDecisions.some((decision) => decision.decision === 'selected')) {
      return 'candidate_arc_ranker'
    }

    return 'legacy_pipeline'
  }

  private resolveSelectionConfidence(
    decision: PipelineWorkerSelectionDecision | undefined,
    fallbackScore: number
  ): number | null {
    if (!decision) {
      return fallbackScore
    }

    return decision.finalScore ?? decision.modelScore ?? fallbackScore
  }

  private matchSelectedDecisionsToClips(
    finalClips: PipelineWorkerPotentialClip[],
    candidateArcs: CandidateArc[],
    selectionDecisions: PipelineWorkerSelectionDecision[]
  ): Array<SelectedDecisionMatch | null> {
    const decisionById = new Map(selectionDecisions.map((decision) => [decision.id, decision]))
    const decisionByArcId = new Map(
      selectionDecisions
        .filter(
          (decision) =>
            (decision.decision === 'selected' || decision.decision === 'fallback_selected') &&
            Boolean(decision.candidateArcId)
        )
        .map((decision) => [decision.candidateArcId as string, decision])
    )
    const arcById = new Map(candidateArcs.map((arc) => [arc.id, arc]))
    const explicitMatches = finalClips.map((clip): SelectedDecisionMatch | null => {
      const decision = clip.selectionDecisionId
        ? decisionById.get(clip.selectionDecisionId)
        : clip.sourceArcId
          ? decisionByArcId.get(clip.sourceArcId)
          : undefined

      if (!decision || (decision.decision !== 'selected' && decision.decision !== 'fallback_selected')) {
        return null
      }

      const arc = decision.candidateArcId ? arcById.get(decision.candidateArcId) : undefined
      return { decision, arc }
    })

    if (explicitMatches.every(Boolean)) {
      return explicitMatches
    }

    const selectedDecisionMatches = selectionDecisions
      .filter(
        (decision) =>
          (decision.decision === 'selected' || decision.decision === 'fallback_selected') &&
          Boolean(decision.candidateArcId)
      )
      .sort((left, right) => (left.rankOrder ?? Number.MAX_SAFE_INTEGER) - (right.rankOrder ?? Number.MAX_SAFE_INTEGER))
      .map((decision) => ({
        decision,
        arc: candidateArcs.find((arc) => arc.id === decision.candidateArcId)
      }))

    if (selectedDecisionMatches.length === 0) {
      return finalClips.map(() => null)
    }

    const explicitlyMatchedDecisionIds = new Set(
      explicitMatches
        .map((match) => match?.decision.id)
        .filter((decisionId): decisionId is string => Boolean(decisionId))
    )
    const unmatched = selectedDecisionMatches.filter((match) => !explicitlyMatchedDecisionIds.has(match.decision.id))

    return finalClips.map((clip, clipIndex) => {
      const explicitMatch = explicitMatches[clipIndex]
      if (explicitMatch) {
        return explicitMatch
      }

      let bestIndex = -1
      let bestScore = -1

      unmatched.forEach((match, matchIndex) => {
        const score = this.computeMatchScore(clip, match.arc, clipIndex, matchIndex, finalClips.length, selectedDecisionMatches.length)
        if (score > bestScore) {
          bestScore = score
          bestIndex = matchIndex
        }
      })

      if (bestIndex === -1 || bestScore < this.minimumDecisionMatchScore) {
        return null
      }

      const [selectedMatch] = unmatched.splice(bestIndex, 1)
      return selectedMatch ?? null
    })
  }

  private computeMatchScore(
    clip: PipelineWorkerPotentialClip,
    arc: CandidateArc | undefined,
    clipIndex: number,
    decisionIndex: number,
    clipCount: number,
    decisionCount: number
  ): number {
    if (!arc) {
      return clipCount === decisionCount && clipIndex === decisionIndex ? 0.25 : 0
    }

    const overlapStart = Math.max(clip.startTime, arc.startTime)
    const overlapEnd = Math.min(clip.endTime, arc.endTime)
    const overlapDuration = Math.max(0, overlapEnd - overlapStart)
    const clipDuration = Math.max(clip.duration, 0.001)
    const arcDuration = Math.max(arc.duration, 0.001)
    const overlapRatio = overlapDuration / Math.max(clipDuration, arcDuration)
    const centerDelta = Math.abs(
      (clip.startTime + clip.endTime) / 2 - (arc.startTime + arc.endTime) / 2
    )
    const normalizedCenterDelta = Math.min(centerDelta / Math.max(clipDuration, arcDuration), 1)
    const orderBonus = clipCount === decisionCount && clipIndex === decisionIndex ? 0.25 : 0

    return overlapRatio * 2 + (1 - normalizedCenterDelta) + orderBonus
  }

  private resolveMatchStrategy(
    clip: PipelineWorkerPotentialClip,
    arc: CandidateArc | undefined
  ): 'temporal_overlap' | 'ordered_fallback' | 'no_arc_match' {
    if (!arc) {
      return 'no_arc_match'
    }

    const overlapStart = Math.max(clip.startTime, arc.startTime)
    const overlapEnd = Math.min(clip.endTime, arc.endTime)
    return overlapEnd > overlapStart ? 'temporal_overlap' : 'ordered_fallback'
  }
}

export const clipProjectionService = new ClipProjectionService()
export default clipProjectionService
