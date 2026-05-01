# World-Class Clip Boundary Implementation Plan

## Problem

Generated reels can end on abrupt or incomplete words/thoughts. The recent `transcript_cleanup` work was intended to improve this by grouping raw transcript chunks into cleaner editorial units, but recent runs show the AI cleanup path failing validation and falling back to heuristic transcript normalization. More importantly, transcript cleanup is not the right primary control surface for this problem: abrupt reels are a boundary-selection and boundary-validation failure.

The target behavior is that Ariadne should never auto-approve a clip that starts in the middle of a dependency or ends before a thought resolves.

## Product Bar

Match the quality bar of leading clipping products:

- Clips have a clear hook, understandable setup, development, and payoff.
- Starts and ends align to natural speech boundaries.
- Captions are word-synced and reflect the selected clip.
- AI ranking can identify engaging moments, but deterministic gates enforce boundary quality.
- Every rejected or adjusted boundary is explainable from transcript/audio evidence.

## Current Findings

- `transcript_cleanup` runs inside `clip_generation`, not as a standalone pipeline stage.
- Cleanup output is used for candidate generation only when parsing succeeds.
- Latest two cleanup attempts failed with invalid response shapes and fell back to heuristic normalization.
- Persisted transcript segments and transcript lines remain raw Whisper-derived data.
- Export captions use persisted transcript lines first, so cleanup does not reliably affect captions.
- The latest reviewed run selected a clip ending at `401.42s` on text equivalent to `...they should be owned by Claude that's`, while the payoff began immediately after.
- The existing clean-end heuristic is too permissive for long text without terminal punctuation.
- The first v2 boundary run selected a clip from `526.38s` to `574.92s` ending on `...depending on the need`; the next transcript segment continues directly with `I'll use a different tier of model`. This shows the final gate also needs lookahead continuity checks, not only trailing-token checks.
- The same v2 run started the selected clip with `but the point about the model...`, showing the pipeline also needs final start-boundary enforcement.
- The first v3 boundary run correctly extended a clip from `177.68s` to `188.06s`, but stopped on `...like that's that's what`; the next transcript segment continues `I'm trying to do...`. This shows the extension loop needs a strict local-ending check, not just whole-clip completeness.
- The first v4 boundary run correctly rejected an incomplete ending, but returned zero clips. This shows final boundary validation needs a recovery path over deterministic candidates after AI-selected clips are rejected.
- The v5 recovery path still returned zero clips because lookahead was treated as binary failure. Boundary finalization needs to optimize nearby start/end choices and score soft continuation separately from hard dangling endings.

## Architecture Direction

### Canonical Transcript Layers

Maintain separate representations instead of overloading transcript segments:

- Raw ASR segments.
- Word timings.
- Sentence/clause boundaries.
- Editorial thought units.
- Topic beats.
- Caption lines.
- Clip arcs.

Each layer should keep its own source strategy and quality metadata.

### Boundary-First Pipeline

Clip quality should be enforced by a deterministic boundary engine:

1. Generate safe start/end anchors from transcript words, pauses, punctuation, and thought-unit metadata.
2. Let AI rank or propose clips using IDs/anchors, not free-form timestamps.
3. Run a final deterministic extend-or-reject pass.
4. Persist boundary decisions and reasons.

### Cleanup Repositioning

`transcript_cleanup` should become optional enrichment:

- Suggest punctuation and unit grouping.
- Mark `completeThought`, `continuesNext`, `forcedBreak`, and `clipPotential`.
- Avoid replacing timing-sensitive text unless word realignment is performed.
- Store raw AI responses and parsed units for diagnostics.

## Implementation Phases

### Phase 1: Deterministic Boundary Guard

- [ ] Add/strengthen shared boundary predicates.
- [ ] Treat dangling endings as hard failures, including final words such as `that's`, `that`, `because`, `and`, `but`, `to`, `of`, `with`, determiners, auxiliaries, and unresolved discourse markers.
- [ ] Add a final extend-or-reject pass after semantic boundary review and word refinement.
- [ ] Extend forward to the next clean word/line boundary when possible.
- [ ] Reject clips that cannot reach a clean end within max duration.
- [ ] Log final boundary status and reason in `clip_ranking` metadata.
- [ ] Add regression coverage for the May 1 failure case.
- [ ] Add start-boundary enforcement after final semantic review.
- [ ] Add lookahead continuity checks so endings like `depending on the need` cannot pass when the next words complete the phrase.
- [ ] Add regression coverage for the `526.38s -> 574.92s` v2 run.
- [ ] Add strict local-ending checks so the extension loop cannot stop on `that's what`, `this is where`, or similar unresolved references.
- [ ] Strip leading filler before start-boundary checks so `yeah but...` is still treated as a continuation start.
- [ ] Add regression coverage for the `122.58s -> 188.06s` v3 run.
- [ ] Add finalization recovery over heuristic candidates when all AI-selected clips fail boundary validation.
- [ ] Treat clip starts that land inside an overlapping word as invalid starts.
- [ ] Replace binary final closure with boundary-pair optimization over nearby transcript/word anchors.
- [ ] Hard-reject only local dangling endings; soft-penalize lookahead continuation when the local ending is otherwise complete.

### Phase 2: Boundary Evaluation Harness

- [ ] Add fixture-based boundary evaluation script.
- [ ] Score starts, ends, forced breaks, extension counts, rejected incomplete clips, and overlap.
- [ ] Include recent failed clips as fixtures.
- [ ] Surface summary metrics in pipeline run metadata.

### Phase 3: Canonical Editorial Units

- [ ] Add a persisted editorial-unit artifact or table.
- [ ] Store raw text, display text, word span, timestamps, source strategy, `completeThought`, `continuesNext`, `forcedBreak`, and quality metadata.
- [ ] Use editorial units consistently for candidate generation, clip selection, boundary review, UI review, captions, and export.
- [ ] Keep raw transcript available for audit and fallback.

### Phase 4: Cleanup Reliability

- [ ] Move cleanup output into structured schema mode where supported.
- [ ] Store failed raw responses with parse error metadata.
- [ ] Make parser tolerate common shape variants while preserving strict coverage.
- [ ] Split long transcripts into bounded cleanup requests.
- [ ] Track cleanup success rate, coverage, and fallback reason in run metadata.

### Phase 5: Clip Arc Selection

- [ ] Generate candidate arcs from safe anchors and editorial units.
- [ ] Score hook, flow, value, payoff, context independence, duration fit, novelty, and caption quality.
- [ ] Ask AI to rank valid arcs rather than invent clip timestamps.
- [ ] Require selected clips to reference unit/anchor IDs.

### Phase 6: Multimodal Quality Signals

- [ ] Add audio pause and energy features.
- [ ] Add speaker diarization or speaker-change detection.
- [ ] Add visual speaker/face activity signals.
- [ ] Use multimodal signals for ranking and reframing, not to bypass boundary guards.

## Phase 1 Technical Plan

### Shared Boundary Quality

Update `src/shared/clipBoundaryQuality.ts`:

- Add `getTrailingBoundaryIssue(text)`.
- Add `isHardIncompleteEnding(text)`.
- Make `isCleanClipEnd(text)` require no hard trailing issue.
- Keep punctuation as a strong positive signal, but reject punctuation after dangling fragments.

### Pipeline Finalization

Update `src/main/workers/pipelineWorker.ts`:

- After `applySemanticBoundaryReview` and word refinement, run `enforceCleanClipEnd`.
- Use raw word timings to test the current clip text.
- If incomplete, scan forward to later word/line boundaries until clean.
- Respect `SEMANTIC_CLIP_MAX_DURATION_SECONDS`.
- Return accepted, adjusted, and rejected boundary decisions in metadata.

### Tests / Verification

Initial verification should cover:

- Text ending `that's` is not clean.
- Text ending `because` is not clean.
- Text ending with a complete punctuation sentence is clean.
- The May 1 clip window ending at `401.42s` is rejected or extended.
- The May 1 v2 clip window starting with `but` is moved back or rejected.
- The May 1 v2 clip window ending at `574.92s` on `depending on the need` is extended or rejected.
- The May 1 v3 clip window ending at `188.06s` on `that's what` is extended or rejected.
- Final metadata includes rejected/adjusted boundary decisions.

## Commit Strategy

Commit in small slices:

1. Planning document.
2. Shared boundary predicate hardening.
3. Pipeline enforce/extend pass.
4. Evaluation fixture/script.
5. Metadata and diagnostics.
