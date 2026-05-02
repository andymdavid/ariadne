# 18 - World-Class Editorial Arc Clipping Implementation Plan

## Status

This plan supersedes:

- `Design-docs/18-World-Class-Clip-Boundary-Implementation-Plan.md`
- the boundary-first parts of `Design-docs/17-Clip-Selection-Agent-Plan.md`
- any approach where AI invents timestamps and the pipeline tries to repair them afterward

The previous boundary work remains useful only as a final safety layer and regression suite. It is not the product intelligence.

## Decision

Ariadne should move from timestamp repair to editorial arc selection.

Wrong architecture:

1. Generate or ask AI for rough clip timestamps.
2. Repair starts and ends with boundary heuristics.
3. Reject bad clips after the fact.

Target architecture:

1. Build a canonical timed media understanding layer.
2. Derive complete editorial units.
3. Generate candidate clip arcs from those units.
4. Score arcs for hook, flow, value, payoff, context independence, audio quality, and visual suitability.
5. Ask AI to rank candidate arc IDs, not invent timestamps.
6. Snap/validate final exports at word/audio boundaries.

## Why

Recent runs showed the failure mode clearly:

- `transcript_cleanup` is unreliable and does not control export captions consistently.
- Raw transcript segments are acoustic chunks, not editorial units.
- Boundary guardrails can prevent obviously bad exports, but they cannot create great clips.
- Adding lexical rules such as `therefore` or `I'm sorry` is a temporary guardrail, not a scalable clipping strategy.

World-class clipping products publicly describe whole-video understanding, chapter/scene analysis, hook/flow/value scoring, multimodal cues, and word-level editing. Ariadne should align to that architecture.

## Product Bar

Accepted clips must feel like complete short-form posts, not excerpts from the middle of a conversation.

Each selected clip should have:

- a strong opening hook or setup
- one dominant idea
- enough context to stand alone
- development or escalation
- a clear payoff, conclusion, or useful unresolved tension
- natural audio and caption boundaries
- low redundancy with other selected clips
- traceable evidence for why it was selected

Returning fewer high-confidence clips is better than padding output with mediocre clips.

## Architecture

### 1. Canonical Timeline

Build all downstream selection from a shared timeline:

- raw ASR segments
- word timings
- inferred punctuation
- pauses and speech-rate features
- speaker turns when available
- sampled visual observations
- scene/shot boundaries when available

Every derived object must reference word indexes and timestamps from this timeline.

### 2. Editorial Units

Editorial units are the core transcript abstraction.

Each unit represents a complete or nearly complete spoken thought. Units are not caption lines and not raw ASR segments.

Unit fields:

- `id`
- `episodeId`
- `startWordIndex`
- `endWordIndex`
- `startTime`
- `endTime`
- `text`
- `speakerId?`
- `topicId?`
- `role`: `hook | setup | claim | example | escalation | payoff | transition | aside | filler`
- `startsCleanly`
- `endsCleanly`
- `continuesPrevious`
- `continuesNext`
- `pauseBeforeSeconds`
- `pauseAfterSeconds`
- `audioEnergy`
- `speechRate`
- `confidence`
- `source`: `deterministic | ai_refined | manual`

### 3. Candidate Arcs

Candidate arcs are sequences of editorial units that may become clips.

Arc fields:

- `id`
- `unitIds`
- `startWordIndex`
- `endWordIndex`
- `startTime`
- `endTime`
- `duration`
- `topic`
- `summary`
- `hookText`
- `payoffText`
- `keyQuote`
- `scores`
- `diagnostics`

Arcs must be generated before AI ranking. The AI can choose among arcs, but should not invent timestamps.

### 4. Arc Scoring

Each candidate arc gets structured scores:

- `hookStrength`
- `contextIndependence`
- `narrativeFlow`
- `payoffStrength`
- `density`
- `novelty`
- `audioBoundaryQuality`
- `emotionalEnergy`
- `visualSuitability`
- `captionQuality`
- `durationFit`
- `overall`

The first implementation can be transcript + audio. Visual and speaker signals are added after the arc pipeline is stable.

### 5. AI Ranker

The AI ranker receives candidate arc IDs with text, diagnostics, and scores.

The ranker returns:

- selected arc IDs
- editorial rationale
- score overrides where justified
- rejection reasons for close alternatives

It must not return free-form timestamps.

### 6. Final Validator

Final validation is a safety layer only.

It may:

- snap to word boundaries
- add small audio padding
- reject mid-word cuts
- reject hard incomplete starts or endings
- enforce min/max duration
- ensure key quote exists inside the clip
- ensure captions align

It should not be responsible for finding the clip.

## Multimodal Roadmap

### Transcript Signals

- word timings
- editorial unit roles
- topic shifts
- questions and answers
- claims and conclusions
- hook/payoff language
- context debt

### Audio Signals

- pause boundaries
- speech rate
- loudness/energy
- laughter or interruption markers
- speaker turns
- emphasis peaks

Initial implementation should use lightweight audio features from extracted audio and existing word timings. Speaker diarization can follow.

### Visual Signals

- frame sampling
- face presence
- active speaker suitability
- scene cuts
- motion/activity
- screen text/OCR
- vertical crop suitability

Visual signals should affect ranking and reframing, not bypass editorial coherence.

### Sentiment Signals

- transcript sentiment
- audio energy shifts
- laughter/excitement/tension markers
- disagreement or surprise

Sentiment is a ranking signal, not a standalone clip selector.

## Implementation Phases

### Phase 0: Freeze Boundary Expansion

- [x] Keep existing boundary optimizer as safety guard.
- [ ] Stop adding new lexical boundary rules unless they prevent a known invalid export.
- [ ] Mark boundary-first docs as superseded by this plan.
- [ ] Keep regression fixtures for bad historical outputs.

### Phase 1: Editorial Unit Builder

- [x] Add shared `EditorialUnit` and `TimelineWord` types.
- [x] Implement `buildEditorialUnits(transcription)` from word timings, pauses, punctuation inference, and local continuity checks.
- [x] Assign initial unit roles deterministically where obvious: filler, aside, transition, claim, payoff.
- [x] Persist units as a workflow artifact first; add a table only after schema stabilizes.
- [x] Add fixture tests for the TGS053 problem window.
- [x] Emit unit diagnostics in `clip_generation` or a new `editorial_unit_build` step.

Acceptance:

- The TGS053 business-ownership section is represented as coherent units that do not end on `therefore`.
- The `I'm sorry...` repair aside is tagged as an aside/repair unit, not a clean hook.

### Phase 2: Candidate Arc Generator

- [x] Implement `generateCandidateArcs(units, mediaSignals, options)`.
- [x] Generate arcs by combining contiguous units around one topic.
- [x] Include multiple duration bands instead of one hard duration target.
- [x] Reject arcs that are mostly filler, transition, or context debt.
- [ ] Score overlap and topic redundancy before AI ranking.
- [x] Persist candidate arcs and diagnostics in workflow metadata.

Acceptance:

- Candidates are complete unit sequences, not arbitrary transcript line windows.
- TGS053 produces at least one candidate that starts at the idea setup and ends after the ownership/payoff section.

### Phase 3: Arc Scoring

- [x] Implement deterministic score components for hook, context independence, flow, payoff, density, duration fit, and boundary confidence.
- [ ] Add transcript-derived sentiment/tension signals.
- [ ] Add audio pause and speech-rate features.
- [x] Produce an explainable score breakdown for every arc.
- [ ] Update evaluation harness to score arcs as well as final clips.

Acceptance:

- The scorer ranks complete idea arcs above local clean-but-context-poor windows.
- The latest bad accepted windows score poorly before final validation.

### Phase 4: AI Arc Ranker

- [x] Add `rankCandidateArcs` to `AIService`.
- [x] Prompt the AI to choose candidate arc IDs only.
- [x] Require rationale against hook, flow, value, payoff, context independence, and ending quality.
- [x] Validate selected IDs and preserve deterministic scores.
- [ ] Retry once with a smaller candidate set if output is invalid.
- [x] Fall back to deterministic top arcs, not heuristic timestamp generation.

Acceptance:

- AI output cannot create timestamps outside generated arcs.
- Ranking failures degrade to explainable deterministic choices.

### Phase 5: Pipeline Integration

- [ ] Add pipeline stages or substeps:
  - `editorial_unit_build`
  - `candidate_arc_generation`
  - `candidate_arc_ranking`
  - `clip_timestamp_snap_and_validate`
- [ ] Demote current `clip_generation` and `clip_ranking` timestamp paths to legacy fallback.
- [ ] Store selected clips with arc IDs and unit IDs in metadata.
- [ ] Surface arc rationale in review UI later.

Current implementation note:

- `candidate_arc_ranking` now runs before legacy timestamp selectors inside the existing `clip_ranking` stage.
- Final validation still runs through the existing boundary finalizer.
- Dedicated stage names can be split out after the arc path proves stable in metadata.

Acceptance:

- New runs can be audited from selected clip back to arc, units, words, and score breakdown.

### Phase 6: Audio Signals

- [ ] Extract pause/energy features from audio.
- [ ] Attach pause and energy summaries to editorial units.
- [ ] Penalize starts/ends with poor audio boundaries.
- [ ] Prefer arcs with natural pause before hook and after payoff.

Acceptance:

- Final boundaries align to natural speech/audio edit points more reliably than transcript-only boundaries.

### Phase 7: Visual and Speaker Signals

- [ ] Sample frames for face/activity presence.
- [ ] Detect scene changes.
- [ ] Add basic vertical crop suitability.
- [ ] Add active speaker or speaker-change signals when feasible.
- [ ] Include visual suitability in arc score.

Acceptance:

- Visually unusable moments are downgraded even if transcript quality is high.

### Phase 8: Product Feedback Loop

- [ ] Store user accepts/rejects/edits against arc IDs and unit IDs.
- [ ] Track which score dimensions predicted accepted clips.
- [ ] Feed manual boundary edits into evaluation fixtures.
- [ ] Add per-run quality dashboard metrics.

Acceptance:

- The system improves from real editorial feedback instead of accumulating one-off code rules.

## Migration Strategy

### Existing Code To Keep

- word boundary snapping
- final boundary validator
- transcript-line persistence
- content package generation
- clip evaluation fixture infrastructure

### Existing Code To Demote

- AI-generated timestamp proposals
- heuristic fallback candidates as primary clip source
- transcript cleanup as primary candidate-generation input
- boundary optimizer as the main selector

### Existing Code To Remove Later

- duplicated transcript normalization paths
- any fallback that silently produces clips without arc/unit provenance
- UI paths that treat raw ASR segments as editorial transcript

## Near-Term Todo Order

1. Create shared editorial unit and candidate arc types.
2. Build editorial units from current transcription object without schema changes.
3. Add fixture for the TGS053 run and assert unit boundaries/roles.
4. Generate candidate arcs from units.
5. Add deterministic arc scorer.
6. Wire arc artifacts into the pipeline metadata.
7. Add AI arc ranking by ID.
8. Swap selected clips to come from ranked arcs.
9. Keep final boundary validation as safety.
10. Run one full retest only after phases 1-5 are implemented.

## Retest Bar

Do not ask for another full media retest after every small change.

The next full retest should happen only when:

- editorial units are built and visible in metadata
- candidate arcs are generated from units
- selected clips reference arc IDs
- AI ranking selects arc IDs only
- final validation still runs
- the TGS053 fixture passes offline checks

The expected result is not merely "no abrupt endings." The expected result is clips that feel intentionally selected: coherent hook, setup, development, and payoff.
