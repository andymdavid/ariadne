# Ariadne Trim Editor Redesign Spec

## Status

- Date: 2026-03-28
- Status: Proposed
- Owner: Product / Editor
- Depends on: existing source-relative trim engine, trim state persistence, frame nudging, word anchors, snap modes

## Why This Exists

The current trim system has improved technically, but the UI is exposing too much internal state at once. The result is a screen that feels dense, noisy, and harder to trust than the underlying implementation deserves.

The problem is not that the trim engine is wrong. The problem is that the editor is explaining the machine instead of supporting the task.

This spec restructures the trim experience around editing intent:

1. Find the moment.
2. Roughly shape the clip.
3. Precisely place the boundaries.
4. Finish and move on.

## Product Reference

Two current products are useful reference points for interaction design:

- SendShort
- Opus Clip

Shared lessons from those products:

- lead with one primary task at a time
- keep the video preview dominant
- make AI suggestions visible but optional
- keep transcript and timing tools subordinate to the main trim action
- hide diagnostic state unless the user asks for precision

We should borrow that interaction clarity, not copy their branding or exact layout.

## Current UX Problems

The current duration tab mixes:

- transport controls
- rough trimming
- precision trimming
- transcript targeting
- snap state
- anchor state
- keyboard instruction text
- loop preview status
- internal diagnostic detail

This creates four concrete problems:

1. Too many equal-weight panels.
   Nothing reads as the primary control surface.

2. Internal concepts are over-exposed.
   Terms like `anchor type`, `nearest word delta`, and fallback nudge values are implementation detail for most users.

3. Rough cut and precision cut compete with each other.
   The user is asked to think about high-level clip shape and frame-level exactness in the same visual moment.

4. The screen does not clearly answer the user's core questions:
   - Where am I in the source?
   - What part becomes the clip?
   - Which boundary am I editing?
   - Why did the boundary land there?

## Design Goals

The redesigned trim experience should be:

- legible in under 3 seconds
- centered on preview plus one dominant timeline
- progressive, not all-at-once
- precise when needed
- compact by default
- compatible with the current trim engine

## Non-Goals

This spec does not change:

- export architecture
- transcript storage model
- caption editing UX outside trim
- music/logo/frame tabs

This spec is about the trim interaction model and its information architecture.

## New Mental Model

The user should experience trim editing as four layers:

### 1. AI Suggestions

Optional starting points:

- tighten intro silence
- end on sentence boundary
- snap to next clean word

These are suggestions, not automatic hidden edits.

### 2. Rough Cut

Fast shaping with broad context:

- one overview timeline
- visible in/out boundaries
- quick seeking
- simple transcript context

### 3. Precision

Only when a boundary is active:

- zoomed local timeline
- waveform
- word markers
- frame stepping
- loop preview

### 4. Finish

Light confirmation:

- final duration
- start and end timestamps
- any warnings

## Proposed Information Architecture

The current `Duration` tab should be replaced with a staged trim workspace.

### Default Layout

```text
┌──────────────────────────────────────────────────────────────────┐
│ Preview                                                         │
│ [video]                                                         │
│ transport controls                                              │
├──────────────────────────────────────────────────────────────────┤
│ Clip Trim                                                       │
│ [overview timeline with in/out handles and playhead]            │
│ [start time] [duration] [end time]                              │
│                                                                  │
│ [Transcript context strip]                                      │
│                                                                  │
│ [Precision drawer: hidden until boundary selected]              │
└──────────────────────────────────────────────────────────────────┘
```

### Precision Drawer

Shown only when the user is editing `Start` or `End`.

Contents:

- active boundary label
- zoomed boundary timeline
- waveform
- word markers
- loop preview toggle
- compact snap controls
- previous/next word and frame nudge controls

This is where advanced trim state belongs. Not in the default surface.

## Primary Surfaces

### A. Preview Surface

Purpose:

- show the clip result
- show playhead and active boundary context

Requirements:

- large and visually dominant
- source-relative playback
- simple transport row
- no duplicated timing cards directly below the preview

### B. Overview Timeline

Purpose:

- rough trim with broad context
- quick understanding of current clip range

Requirements:

- one clear highlighted clip region
- visible `Start` and `End` handles
- playhead indicator
- source-relative time labels
- click-to-seek
- drag handles for coarse edits

This is the primary trim control.

### C. Transcript Context Strip

Purpose:

- help the user understand surrounding speech without becoming the main editor

Requirements:

- horizontally scrollable or compact stacked phrases
- active words highlighted during playback
- word click can target start/end when precision mode is open
- less visual weight than the timeline

The current chip wall is too loud. This should feel like supporting context.

### D. Precision Drawer

Purpose:

- exact placement of one boundary at a time

Requirements:

- explicit active boundary: `Editing Start` or `Editing End`
- local zoom window around the boundary
- waveform plus word boundaries in one compact lane stack
- frame ticks when FPS is available
- loop preview around active boundary
- snap mode control with small footprint

## What To Remove From The Default View

These items should not be permanently visible in large cards:

- anchor type
- anchor label
- nearest word delta
- nudge fallback text
- verbose keyboard help
- loop preview readiness text

They can still exist, but should move into a compact advanced panel or tooltip-level detail.

## Snap Model In The New UI

Snap is useful. The current presentation is not.

### Default Behavior

- `Word` snap is the default for most editing
- `Frame` snap is available in precision mode
- `Free` is an override, not the primary recommendation

### Presentation

Show compact segmented controls in precision mode:

- `Word`
- `Frame`
- `Free`

Show the result, not the mechanism:

- `Snapped to word end`
- `Snapped to frame`
- `Free placement`

Avoid raw diagnostic wording unless the user opens advanced details.

## Boundary Legibility

The UI must always answer:

- which boundary is active
- where that boundary is on the source timeline
- whether it is snapped
- what the nearby spoken context is

Recommended boundary header:

```text
Editing End
69:34.340  •  Snapped to word end  •  Loop preview on
```

That gives the user the important truth without a wall of metadata.

## Recommended Trim Flow

### Flow 1: Fast Edit

1. Open clip.
2. Drag start/end on the overview timeline.
3. Scrub preview.
4. Save.

### Flow 2: Exact Word Placement

1. Click `Edit Start` or `Edit End`.
2. Precision drawer opens.
3. Use word rail, keyboard nudges, or frame step.
4. Preview local loop.
5. Confirm boundary.

### Flow 3: AI Assist

1. Open `Suggestions`.
2. Apply one proposal:
   - remove leading silence
   - end on sentence boundary
   - tighten dead air
3. Review in preview.
4. Fine-tune if needed.

## Component Model

The current `ClipEditModal` should stop owning all trim rendering directly.

Recommended breakdown:

- `SourcePreviewPlayer`
- `TrimOverviewTimeline`
- `TranscriptContextStrip`
- `TrimPrecisionDrawer`
- `TrimSuggestionsPanel`
- `TrimFooterSummary`

Inside precision mode:

- `TrimBoundaryHeader`
- `TrimPrecisionTimeline`
- `TrimWaveformLane`
- `TrimWordMarkerLane`
- `TrimSnapControl`

## Mapping From Current System To New UI

The current underlying work is still valid.

Keep:

- source-relative playback
- trim state persistence
- anchor metadata
- frame metadata
- keyboard nudging
- loop preview logic
- snap mode state

Change the presentation:

- overview timeline becomes the main surface
- transcript chips become a lighter context strip
- boundary inspector becomes a compact precision header plus optional advanced detail
- precision controls move into a drawer instead of occupying the whole screen

## Implementation Plan

### Phase 1: Information Architecture Reset

Goal:

- reduce noise without changing the core trim engine

Tasks:

- simplify the `Duration` tab into preview + overview + transcript context
- move boundary inspector into a collapsed precision drawer
- remove large diagnostic cards from the default view
- add clear `Edit Start` and `Edit End` entry points

Definition of done:

- the trim screen has one obvious primary control
- the user can identify the active boundary immediately
- advanced trim data is hidden by default

### Phase 2: Precision Surface

Goal:

- make exact edits feel trustworthy

Tasks:

- build `TrimPrecisionDrawer`
- add zoomed timeline around active boundary
- integrate frame ticks
- integrate waveform lane
- integrate word marker lane
- keep snap control compact and local to precision mode

Definition of done:

- frame and word edits happen in one coherent place
- loop preview feels attached to the active boundary

### Phase 3: AI Suggestions

Goal:

- expose smart assist as suggestions instead of raw mechanisms

Tasks:

- add suggestion chips for silence cleanup and sentence endings
- allow preview-before-apply
- allow one-click revert of suggestion changes

Definition of done:

- assistive trimming is visible, optional, and understandable

## UX Acceptance Criteria

The redesign is successful if a new user can answer these questions without explanation:

1. What part of the source becomes the clip?
2. Which boundary am I editing right now?
3. How do I make a rough change?
4. How do I make a precise change?
5. Why did the boundary land where it did?

If any of those answers require reading a diagnostics card, the UI is still too technical.

## Engineering Notes

This redesign should happen before more trim complexity is exposed in the current layout. In particular:

- waveform
- silence markers
- sentence-end suggestions

should be added into the new precision surface, not bolted onto the current card stack.

## Immediate Next Step

Implement Phase 1 first:

- simplify the duration tab shell
- create explicit rough cut and precision entry points
- demote diagnostics into collapsed detail

Do not add more always-visible trim controls until that shell is in place.
