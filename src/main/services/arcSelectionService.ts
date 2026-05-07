import { randomUUID } from 'crypto'
import type AIService from './aiService'
import type { RankedCandidateArcSelection } from './aiService'
import type { CandidateArc } from '../../shared/editorialUnits'
import type { PipelineWorkerPotentialClip, PipelineWorkerSelectionDecision } from '@shared/types/pipelineWorker'

export type ArcSelectionMode = 'candidate_arc_ranking' | 'deterministic_candidate_arcs'

export interface ArcSelectionResult {
  mode: ArcSelectionMode
  aiAnalysisSucceeded: boolean
  clips: PipelineWorkerPotentialClip[]
  decisions: PipelineWorkerSelectionDecision[]
  selectedArcIds: string[]
  fallbackReason?: string
}

class ArcSelectionService {
  async selectCandidateArcs(
    arcs: CandidateArc[],
    mediaDuration: number,
    targetClipCount: number,
    aiService: AIService | null,
    onProgress?: (progress: number) => void
  ): Promise<ArcSelectionResult> {
    try {
      if (!aiService) {
        throw new Error('AI arc ranker unavailable')
      }

      const rankedSelections = await aiService.rankCandidateArcs(
        arcs,
        mediaDuration,
        targetClipCount,
        onProgress
      )
      const clips = this.buildPotentialClipsFromRankedArcs(arcs, rankedSelections)
      if (clips.length < 1) {
        throw new Error('Candidate arc ranker returned no usable arc selections')
      }

      return {
        mode: 'candidate_arc_ranking',
        aiAnalysisSucceeded: true,
        clips,
        decisions: this.buildRankedArcDecisions(arcs, rankedSelections, clips),
        selectedArcIds: rankedSelections.map((selection) => selection.arcId)
      }
    } catch (error) {
      const fallbackReason = error instanceof Error ? error.message : 'Unknown candidate arc ranking error'
      const clips = this.buildDeterministicClipsFromTopArcs(arcs)
      if (clips.length < 1) {
        throw error
      }

      return {
        mode: 'deterministic_candidate_arcs',
        aiAnalysisSucceeded: false,
        clips,
        decisions: this.buildDeterministicArcDecisions(arcs, clips, fallbackReason),
        selectedArcIds: arcs.slice(0, clips.length).map((arc) => arc.id),
        fallbackReason
      }
    }
  }

  private buildPotentialClipsFromRankedArcs(
    arcs: CandidateArc[],
    selections: RankedCandidateArcSelection[]
  ): PipelineWorkerPotentialClip[] {
    const arcById = new Map(arcs.map((arc) => [arc.id, arc]))

    return selections
      .map((selection, index): PipelineWorkerPotentialClip | null => {
        const arc = arcById.get(selection.arcId)
        if (!arc) return null
        const selectionDecisionId = randomUUID()

        return {
          id: `arc_${index + 1}_${selection.arcId}`,
          selectionDecisionId,
          sourceArcId: arc.id,
          startTime: arc.startTime,
          endTime: arc.endTime,
          duration: arc.duration,
          contentType: selection.contentType,
          shareabilityScore: selection.shareabilityScore,
          keyQuote: selection.keyQuote || arc.keyQuote,
          reason: selection.reason || `Selected from editorial candidate arc ${selection.arcId}.`,
          contextNeeded: selection.contextNeeded
        }
      })
      .filter((clip): clip is PipelineWorkerPotentialClip => Boolean(clip))
  }

  private buildDeterministicClipsFromTopArcs(
    arcs: CandidateArc[],
    limit = 4
  ): PipelineWorkerPotentialClip[] {
    return arcs.slice(0, limit).map((arc, index) => {
      const selectionDecisionId = randomUUID()
      return {
        id: `deterministic_arc_${index + 1}`,
        selectionDecisionId,
        sourceArcId: arc.id,
        startTime: arc.startTime,
        endTime: arc.endTime,
        duration: arc.duration,
        contentType: arc.scores.emotionalEnergy >= 0.65 ? 'hot_take' : 'insight',
        shareabilityScore: Number(Math.max(1, Math.min(9.2, arc.scores.overall * 10)).toFixed(1)),
        keyQuote: arc.keyQuote,
        reason: `Selected from deterministic editorial arc scoring. Hook=${arc.scores.hookStrength}, flow=${arc.scores.narrativeFlow}, payoff=${arc.scores.payoffStrength}.`,
        contextNeeded: arc.scores.contextIndependence >= 0.7 ? 'low' : arc.scores.contextIndependence >= 0.45 ? 'medium' : 'high'
      }
    })
  }

  private buildRankedArcDecisions(
    arcs: CandidateArc[],
    selections: RankedCandidateArcSelection[],
    clips: PipelineWorkerPotentialClip[]
  ): PipelineWorkerSelectionDecision[] {
    const selectedByArcId = new Map(selections.map((selection, index) => [selection.arcId, { selection, index }]))

    return arcs.map((arc) => {
      const selected = selectedByArcId.get(arc.id)
      if (selected) {
        return {
          id: clips.find((clip) => clip.sourceArcId === arc.id)?.selectionDecisionId ?? randomUUID(),
          candidateArcId: arc.id,
          decision: 'selected',
          rankOrder: selected.index + 1,
          modelScore: selected.selection.shareabilityScore,
          finalScore: selected.selection.shareabilityScore,
          reason: selected.selection.reason || `Selected from editorial candidate arc ${arc.id}.`,
          validatorResultJson: '{}'
        }
      }

      return {
        id: randomUUID(),
        candidateArcId: arc.id,
        decision: 'rejected',
        modelScore: Number((arc.scores.overall * 10).toFixed(1)),
        finalScore: Number((arc.scores.overall * 10).toFixed(1)),
        rejectionCode: 'not_selected_by_ranker',
        reason: 'Not selected by candidate arc ranker.',
        validatorResultJson: '{}'
      }
    })
  }

  private buildDeterministicArcDecisions(
    arcs: CandidateArc[],
    clips: PipelineWorkerPotentialClip[],
    fallbackReason: string
  ): PipelineWorkerSelectionDecision[] {
    const selectedArcIds = new Set(arcs.slice(0, clips.length).map((arc) => arc.id))

    return arcs.map((arc, index) => {
      if (selectedArcIds.has(arc.id)) {
        return {
          id: clips.find((clip) => clip.sourceArcId === arc.id)?.selectionDecisionId ?? randomUUID(),
          candidateArcId: arc.id,
          decision: 'fallback_selected',
          rankOrder: index + 1,
          modelScore: Number((arc.scores.overall * 10).toFixed(1)),
          finalScore: Number((arc.scores.overall * 10).toFixed(1)),
          reason: `Selected by deterministic editorial arc fallback after candidate arc ranker failure: ${fallbackReason}`,
          validatorResultJson: '{}'
        }
      }

      return {
        id: randomUUID(),
        candidateArcId: arc.id,
        decision: 'rejected',
        modelScore: Number((arc.scores.overall * 10).toFixed(1)),
        finalScore: Number((arc.scores.overall * 10).toFixed(1)),
        rejectionCode: 'deterministic_fallback_not_selected',
        reason: `Not selected by deterministic editorial arc fallback. Ranker failure: ${fallbackReason}`,
        validatorResultJson: '{}'
      }
    })
  }

}

export const arcSelectionService = new ArcSelectionService()
export default arcSelectionService
