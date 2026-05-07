# Ariadne Implementation Plan

## Status

This document is the single source of truth for the remaining implementation plan for Ariadne's clipping pipeline.

All future implementation planning for the clip-selection architecture should be added here instead of creating new plan documents elsewhere in the repo.

## Goal

Build a world-class clipping pipeline that produces coherent, self-contained clips with clear openings, clear endings, strong standalone context, durable provenance, and trustworthy review diagnostics.

## Core Decision

Ariadne will move to a single production clip-selection path:

1. Canonical timeline
2. Editorial units
3. Candidate arcs
4. AI ranks arc IDs
5. Final validator
6. Projected clips

The production system will no longer treat timestamp invention, transcript-line selection, grounded candidate ranking, and heuristic supplementation as equal first-class selector paths.

## Product Bar

Every accepted clip must:

- open cleanly
- communicate one strong idea
- resolve cleanly
- make sense without prior context
- be traceable to real timeline evidence

Returning fewer strong clips is better than padding output with weak ones.

## Production Architecture

### 1. Canonical Timeline

Owner:
- `src/main/services/canonicalTimelineService.ts`

Responsibilities:
- unify ASR segments, word timings, timing metadata, and pause cues
- provide one canonical timing structure for selection, editing, captions, export, and evaluation
- eliminate parallel transcript abstractions that drift from one another

### 2. Editorial Units

Owner:
- deterministic logic stays in `src/shared/editorialUnits.ts`
- orchestration and persistence move to `src/main/services/editorialUnitService.ts`

Responsibilities:
- derive coherent spoken thought units from the canonical timeline
- persist unit diagnostics and role labels
- ensure unit construction happens after transcript cleanup / normalization, not before

### 3. Candidate Arcs

Owner:
- scoring/generation core in `src/shared/editorialUnits.ts`
- orchestration in `src/main/services/candidateArcService.ts`

Responsibilities:
- generate contiguous unit sequences that could become clips
- persist score breakdowns and diagnostics
- become the only selectable clip candidates in production

### 4. Arc Ranker

Owner:
- `src/main/services/arcSelectionService.ts`

Responsibilities:
- send only arc IDs and grounded arc data to the model
- return selected arc IDs, rank order, rationale, and rejection reasons
- never invent timestamps

### 5. Final Validator

Owner:
- `src/main/services/finalClipValidationService.ts`

Responsibilities:
- snap final arc bounds to exact word and audio boundaries
- reject hard incomplete starts and ends
- verify quote grounding
- verify caption and transcript alignment

This stage is a safety gate, not the main intelligence layer.

### 6. Clip Projection

Owner:
- `src/main/services/clipProjectionService.ts`

Responsibilities:
- materialize validated arc selections into surfaced clip records
- maintain active clip sets by pipeline run
- preserve provenance for inspection and comparisons

## Legacy Paths

### Production Keep

- local Whisper with word timestamps
- deterministic editorial-unit builder
- candidate-arc scoring
- final word/audio snapping and export safety checks
- workflow events and evaluation harnesses

### Demote Behind Flags

- `AIService.proposeBoundaries()`
- `AIService.analyzeTranscript()` as a primary selector
- `ClipSelectionAgentService.selectClips()` in its current line-based form
- heuristic supplementation to hit target clip counts
- score-based auto-approval

### Remove From Production Behavior

- sticky reuse of existing clips on rerun
- multiple selector families competing for the same episode in the default runtime

## Data Model Changes

### New Tables

Add:

- `pipeline_selection_runs`
- `editorial_units`
- `candidate_arcs`
- `selection_decisions`

### Extend `clips`

Add:

- `workflow_job_id`
- `selection_run_id`
- `source_arc_id`
- `selection_source`
- `selection_confidence`
- `approval_source`
- `replaced_by_clip_id`
- `is_active`
- `provenance_json`

### Persistence Rules

- every pipeline run gets its own selection run record
- surfaced clips are projections from selected arcs
- only one clip set is active per episode in production mode
- old clip sets remain inspectable for comparison
- reruns must never silently reuse an old clip set

## Feature Flags

Add to config:

- `productionSelectorMode: 'legacy' | 'arc_v1'`
- `enableLegacyBoundaryProposal: boolean`
- `enableLegacyTranscriptLineAgent: boolean`
- `enableLegacyCandidateRanking: boolean`
- `enableHeuristicSupplementation: boolean`
- `autoApproveGeneratedClips: boolean`
- `persistSelectionRunArtifacts: boolean`

Recommended end state:

- `productionSelectorMode = 'arc_v1'`
- all legacy selector flags `false`
- `autoApproveGeneratedClips = false`
- `persistSelectionRunArtifacts = true`

## Rollout Phases

### Phase 0: Freeze

- stop expanding boundary heuristics unless fixing a known invalid export
- stop adding new competing selector paths
- stop sticky clip reuse on rerun

### Phase 1: Persistence Foundation

- add new schema
- persist selection runs, units, arcs, and decisions
- keep legacy runtime behavior while collecting data

### Phase 2: Canonical Arc Path

- rebuild editorial units and candidate arcs from the cleaned canonical timeline
- ensure candidate-arc ranking has complete provenance
- run `arc_v1` in shadow mode alongside legacy

### Phase 3: Projection Cutover

- materialize clips from validated arc selections
- allow legacy and `arc_v1` run comparisons
- keep legacy selector output out of the primary review surface

### Phase 4: Trust Cutover

- replace score-based auto-approval with explicit review states
- show provenance and rejection reasons in run inspection
- expose rerun comparisons in the UI

### Phase 5: Production Cutover

- set `productionSelectorMode = 'arc_v1'`
- disable legacy selector paths by default
- keep the final validator only as a safety layer

## PR-by-PR Execution Plan

### PR 1: Remove Sticky Clip Reuse

Scope:
- `src/main/services/processingPipeline.ts`
- `src/main/database/database.ts`

Changes:
- stop returning existing episode clips from `storeClips()`
- introduce per-run clip set replacement or versioning groundwork
- ensure reruns produce fresh inspectable output

Acceptance:
- rerunning an episode no longer silently reuses old clips

### PR 2: Add Selection-Run Schema

Scope:
- `src/main/database/schema.sql`
- `src/main/database/database.ts`

Changes:
- add `pipeline_selection_runs`
- add `editorial_units`
- add `candidate_arcs`
- add `selection_decisions`
- extend `clips` provenance fields

Acceptance:
- schema supports run-scoped selection provenance end to end

### PR 3: Persist Selection Runs In Pipeline

Scope:
- `src/main/workers/pipelineWorker.ts`
- `src/main/services/processingPipeline.ts`

Changes:
- create and update selection-run records during processing
- persist artifacts and metadata under the selection run

Acceptance:
- every clip-producing run has a durable selection-run record

### PR 4: Build Canonical Timeline Service

Scope:
- new `src/main/services/canonicalTimelineService.ts`
- `src/main/workers/pipelineWorker.ts`

Changes:
- centralize timeline creation from Whisper output
- make downstream services consume canonical timeline data

Acceptance:
- one canonical timing representation feeds all downstream stages

### PR 5: Rebuild Editorial Units From Cleaned Timeline

Scope:
- `src/main/workers/pipelineWorker.ts`
- `src/shared/editorialUnits.ts`
- new `src/main/services/editorialUnitService.ts`

Changes:
- build units after transcript cleanup / normalization
- persist units and diagnostics
- remove the current raw-transcript mismatch

Acceptance:
- editorial units match the cleaned canonical timeline

### PR 6: Persist Candidate Arcs And Scores

Scope:
- `src/shared/editorialUnits.ts`
- new `src/main/services/candidateArcService.ts`
- `src/main/database/database.ts`

Changes:
- persist candidate arcs and score breakdowns
- store arc diagnostics for inspection

Acceptance:
- each selection run has durable arc candidates with scores

### PR 7: Extract Arc Selection Service

Scope:
- new `src/main/services/arcSelectionService.ts`
- `src/main/services/aiService.ts`
- `src/main/workers/pipelineWorker.ts`

Changes:
- create dedicated AI arc-ranker
- send arc IDs plus grounded context only
- return rank decisions, not timestamps

Acceptance:
- `candidate_arc_ranking` becomes the canonical production selection path

### PR 8: Demote Legacy Selectors Behind Flags

Scope:
- `src/main/workers/pipelineWorker.ts`
- `src/main/services/configService.ts`

Changes:
- feature-flag boundary proposal, transcript-line agent, and legacy candidate ranking
- disable heuristic supplementation in experimental mode

Acceptance:
- legacy paths can be turned off cleanly without breaking the pipeline

### PR 9: Replace Final Boundary Logic With Focused Validator

Scope:
- new `src/main/services/finalClipValidationService.ts`
- `src/main/workers/pipelineWorker.ts`
- `src/shared/clipBoundaryQuality.ts`

Changes:
- narrow validator to snapping, grounding, and hard invalid-boundary rejection
- keep useful boundary checks
- stop treating lexical heuristics as primary clip intelligence

Acceptance:
- validator output is explicit: accepted, snapped, or rejected with a reason code

### PR 10: Clip Projection And Active Clip Sets

Scope:
- new `src/main/services/clipProjectionService.ts`
- `src/main/database/database.ts`
- `src/main/services/processingPipeline.ts`

Changes:
- materialize clips from validated arc decisions
- track active clip sets per episode
- preserve historical sets for comparison

Acceptance:
- review surface shows one active run while preserving historical provenance

### PR 11: Approval Semantics And Review State Cleanup

Scope:
- `src/shared/types.ts`
- `src/renderer/src/pages/ReviewPage.tsx`
- `src/main/services/processingPipeline.ts`
- `src/main/services/configService.ts`

Changes:
- replace score-based default approval
- introduce explicit review states
- keep user approval distinct from generated confidence

Acceptance:
- `approved` means editorially accepted, not merely high-scoring

### PR 12: Run Inspector Upgrade

Scope:
- `src/renderer/src/components/PipelineRunInspector.tsx`
- `src/main/services/workflowReadModel.ts`
- `src/shared/types/pipelineIpc.ts`

Changes:
- expose selected arc IDs
- expose rejected arc reasons
- expose validator adjustments
- expose fallback use and run promotion state

Acceptance:
- an editor can explain why a clip exists and why nearby alternatives failed

### PR 13: Evaluation Harness Upgrade

Scope:
- `scripts/evaluate-clip-selection.js`
- `docs/clip-evaluation-harness.md`
- `eval/fixtures/*`

Changes:
- score units, arcs, provenance, and final clip quality
- expand fixture coverage
- add regression gates for known bad windows

Acceptance:
- pipeline changes are benchmarked against real fixture coverage, not only qualitative review

### PR 14: Production Cutover

Scope:
- runtime config defaults
- pipeline worker cutover
- docs refresh

Changes:
- set `arc_v1` as default production selector
- disable legacy selector paths by default
- keep validator and benchmark suite in place

Acceptance:
- production runtime has one canonical selector path

## Inspector Requirements

The run inspector must answer:

- which arcs were generated
- which arcs were selected
- which arcs were rejected and why
- what the validator changed
- whether a fallback path was used
- whether this run is active for the episode

## UI State Requirements

Review state should distinguish:

- `pending_review`
- `approved_by_user`
- `rejected_by_user`
- optional `auto_promoted` only if intentionally retained

The UI should not imply that a generated score is equivalent to editorial approval.

## Benchmark Requirements

Before final cutover:

- build a fixture set of 20 to 30 real episode excerpts
- keep existing bad boundary regressions as hard blockers
- score:
  - coherence
  - hook strength
  - payoff completeness
  - context independence
  - duplicate overlap
  - quote grounding
  - bad-range intrusion
  - provenance completeness

## Acceptance Gates

Do not ship `arc_v1` as production until:

- every surfaced clip has `selection_run_id` and `source_arc_id`
- reruns create fresh clip sets
- no production selector invents timestamps
- the system can return fewer clips without padding
- approval is no longer score-only
- inspector surfaces causal decision data
- benchmark results beat legacy on coherence and bad-range intrusion

## Maintenance Rule

Do not create additional plan documents for this migration.

If scope changes, update this file.
