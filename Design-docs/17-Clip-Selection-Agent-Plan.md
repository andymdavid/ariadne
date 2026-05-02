# 17 - Clip Selection Agent Plan

## Status

Superseded by `Design-docs/18-World-Class-Editorial-Arc-Clipping-Implementation-Plan.md`.

This document remains useful historical context for why heuristic-heavy clipping failed, but it should not drive implementation where it conflicts with Plan 18.

The key supersession is:

- do not ask the model to choose timestamps or raw transcript-line boundaries as the primary selection mechanism
- do generate editorial units and candidate arcs first
- do ask the model to rank candidate arc IDs
- keep deterministic boundary logic as final validation only

## Problem

The current clip pipeline is too heuristic-heavy.

It has accumulated:

- transcript normalization rules
- candidate generation rules
- ranking fallbacks
- boundary refinement rules
- semantic review retries
- multiple exception paths for malformed model output

That architecture is mechanically defensible but semantically weak.

The repeated failure mode is consistent:

1. theme selection is often acceptable
2. clip starts are usually reasonable
3. clip endings still degrade because the system is trying to simulate judgment with hardcoded rules
4. each patch fixes a narrow case and increases overall complexity

This is the wrong design for a problem that is fundamentally about editorial judgment.

## Goal

Replace most of the clip-boundary and clip-worthiness heuristics with a dedicated in-app `ClipSelectionAgent` step in the pipeline.

The agent should:

- read the transcript in full
- identify clip-worthy ideas
- choose coherent start and end points
- optimize for short-form retention and shareability
- treat duration as guidance, not as the main objective

The code should:

- prepare transcript context
- call the model
- validate output
- snap semantic selections to real timestamps
- persist clips

The code should not be the main source of editorial intelligence.

## External Guidance To Bake In

As of April 24-25, 2026, the strongest stable guidance to encode is:

### Official YouTube guidance

- YouTube does not favor a particular Shorts format in the abstract. Shorts are ranked on viewer response and personalization.
  Source:
  - https://support.google.com/youtube/answer/11914225?co=YOUTUBE._YTVideoType%3Dshorts&hl=en

- There is no universal ideal length. The right length is the shortest length that fully delivers the value without filler.
  Source:
  - https://support.google.com/youtube/answer/16559651?hl=en

- Shorts quality should be evaluated through actual watch behavior, not by forcing arbitrary format rules.
  Source:
  - https://support.google.com/youtube/answer/12934772?hl=en

### Directional short-form performance guidance

These are not platform guarantees, but they are directionally useful for agent criteria:

- the first 1-3 seconds matter disproportionately for hold rate
- strong opening tension or clear promise improves retention
- one clear idea per clip usually outperforms multi-idea sprawl
- loop-friendly or payoff-resolved endings can improve completion and rewatches
- high completion is generally easier on shorter clips, but completeness is more important than shaving seconds

These principles should guide the agent, but not become brittle hardcoded scoring rules.

## Design Principles

1. Model-first judgment
   - the model decides what is worth clipping and where a thought starts and ends

2. Thin deterministic mechanics
   - code validates indices, snaps to timestamps, enforces basic bounds, and persists results

3. Duration as soft guidance
   - preferred duration range should influence ranking, not override coherence

4. Fewer, cleaner clips beats more mediocre clips
   - when uncertain, return fewer high-confidence clips

5. One canonical transcript basis
   - agent reads `transcript_lines` with timestamps
   - word timestamps remain available for final snapping when needed

6. Minimal fallback
   - if the model output fails, retry once with a simpler contract
   - if it still fails, degrade clearly and conservatively
   - do not pretend heuristic output is equivalent to agent judgment

## What Makes An Effective Reel / Short

The agent instruction set should explicitly optimize for:

### 1. Immediate relevance

A strong clip should open with one of:

- a bold claim
- a surprising contrast
- a practical consequence
- a concrete prediction
- a strong opinion with stakes
- a compelling question that is answered within the clip

Avoid:

- throat-clearing
- hedging intros
- context setup that takes too long to pay off

### 2. One core idea

Each selected clip should revolve around one dominant idea:

- one claim
- one decision
- one strategic insight
- one controversy
- one useful framework

Avoid clips that try to cover multiple loosely related ideas.

### 3. Coherent start

The start should not feel like the middle of an answer.

The agent should prefer starts that:

- establish the idea quickly
- sound intentional without requiring hidden setup
- can stand on their own in-feed

### 4. Coherent ending

The end should feel resolved.

Good endings include:

- a conclusion
- a payoff
- a recommendation
- a decision
- a punchline
- a completed contrast

Avoid endings that clearly continue:

- `if you`
- `because`
- `so it's like`
- `and I think`
- `the whole`
- `a lot`

This should be judged semantically, not by string matching alone.

### 5. Retention potential

The agent should prefer clips that are likely to hold attention because they contain:

- clear tension
- novelty
- specificity
- concrete consequences
- strong contrast
- escalating insight

### 6. Shareability

The best clips are often the ones a viewer would send because:

- they clarify something important
- they express a strong truth cleanly
- they create productive disagreement
- they help the viewer sound informed

### 7. Low context debt

The clip should not depend heavily on:

- prior unseen explanation
- unexplained names or references
- dangling follow-up that never arrives

## Proposed Pipeline Placement

The clip pipeline should become:

1. `source_resolve_or_import`
2. `media_probe`
3. `transcription`
4. `transcript_line_build`
5. `clip_selection_agent`
6. `clip_timestamp_snap_and_validate`
7. `content_package_generation`

Notes:

- `clip_generation` and `clip_ranking` collapse into one model-first agent stage
- timestamp snapping remains a separate deterministic stage
- metadata generation remains downstream

## Clip Selection Agent

### Role

`ClipSelectionAgent` is responsible for selecting clip-worthy spans from the transcript and choosing semantically coherent line boundaries.

It is not a generic summarizer.

Its singular job is:

- find the best short-form clips
- maximize retention potential and coherence
- return exact transcript-line boundaries

### Inputs

- full `transcript_lines`
- optional raw word timing map
- target platform:
  - `youtube_shorts`
- preferred duration guidance:
  - ideal: `35-75s`
  - allowed: `20-95s`
- desired clip count guidance:
  - target count only, not a forced quota
- optional creator / brand context:
  - niche
  - tone
  - audience profile

### Agent instructions

The agent prompt/spec should explicitly tell the model:

- read the transcript in full before selecting
- identify the strongest clip-worthy ideas
- choose starts that do not feel like mid-sentence setup
- choose ends that resolve a thought
- prefer clips with strong hooks, stakes, novelty, or payoff
- reject clips that require too much external context
- prefer fewer strong clips over padding to hit a target count

### Output contract

Do not use a large nested JSON contract.

Use a compact, parseable plain-text contract, for example:

```text
CLIP|1|start_line=12|end_line=19|confidence=0.91
HOOK|Why most businesses will get trapped by cloud AI
WHY|Strong claim, clear stakes, resolves with a practical consequence

CLIP|2|start_line=34|end_line=41|confidence=0.87
HOOK|The real switching cost in AI isn't price
WHY|Strong contrast, clear payoff, ends on a completed idea
```

This avoids the current JSON truncation/parsing problems.

## Code Responsibilities After Agent Output

The code should:

1. parse the returned clip spans
2. validate that:
   - line indices exist
   - `start_line <= end_line`
   - clip duration is within hard safety bounds
3. convert line ranges to timestamps
4. optionally snap to nearest word boundary at the exact line edges
5. persist selected clips

The code should not:

- try to re-decide semantic endings after the model already chose them
- layer a second heuristic ranking engine on top

## Model Strategy

Use model tiering deliberately.

### Default

Use a strong reasoning model for `clip_selection_agent`.

This is the place where better model quality is worth the cost, because:

- clip quality determines most downstream value
- bad clip boundaries ruin preview, export, metadata, and scheduling

### Recommendation

Make the model configurable by pipeline stage:

- `clip_selection_model`
- `metadata_generation_model`
- `default_general_model`

That allows stronger model allocation specifically for clip selection.

### Operational policy

- first attempt: strong primary model
- second attempt: same model with simplified output contract
- fallback: conservative deterministic fallback

## Fallback Policy

Fallback should be intentionally limited.

### Retry 1

If parsing fails:

- rerun with a simpler prompt
- request fewer clips
- request the same plain-text contract

### Final fallback

If the model still fails:

- produce only a small number of high-confidence heuristic clips
- do not force the full target clip count
- mark them explicitly as fallback-generated

This is critical.

The current system degrades quality because fallback tries to fully replace the agent. It should not.

## Evaluation Criteria

The new system should be judged on:

1. `% of clips ending on semantically complete thoughts`
2. `% of clips starting without obvious missing setup`
3. `editorial acceptance rate` during review
4. `need for manual trim correction`
5. `preview/export coherence parity`
6. `number of clips returned`
   - fewer is acceptable if quality is materially higher

## What To Delete Or Demote

Once the agent path is stable, the following should be reduced or removed as primary logic:

- heavy heuristic transcript-thought grouping for boundary choice
- heuristic ranking as the main clip selector
- extensive semantic-ending refinement logic in code
- clip count backfilling that pads low-quality candidates

Keep only:

- transcript line preparation
- output validation
- timestamp snapping
- minimal fallback

## Implementation Plan

### Slice 1

- add `ClipSelectionAgentService`
- add agent prompt/spec file
- add stage-specific model configuration

### Slice 2

- replace `clip_generation` + `clip_ranking` with `clip_selection_agent`
- keep the old path behind a fallback flag

### Slice 3

- add compact output parser and validator
- add retry with simpler contract

### Slice 4

- demote heuristic boundary/ranking path to fallback only
- stop forcing target clip count when fallback quality is weak

### Slice 5

- add run-level evaluation metadata:
  - agent used
  - model used
  - retry count
  - fallback used
  - clip confidence distribution

## Final Recommendation

The system should stop trying to manually encode editorial judgment through expanding heuristic code.

The correct long-term design is:

- transcript lines for structure
- model-driven clip selection for judgment
- deterministic code for mechanics only

That is the cleanest way to improve:

- clip starts
- clip endings
- virality potential
- overall maintainability
