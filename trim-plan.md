# Ariadne Trim System Plan

## Execution Checklist

Status key:

- [x] done
- [~] in progress
- [ ] not started

### Foundation

- [x] Replace clip-relative playback with source-relative playback
- [~] Introduce dedicated trim state persistence
- [~] Persist trim anchor metadata alongside in/out points
- [ ] Add central trim serialization and rounding rules
- [ ] Add frame-rate metadata retrieval and storage

### Editor Core

- [ ] Introduce explicit editor trim state:
  - selected boundary
  - snap mode
  - zoom range
  - loop preview range
- [x] Show precise absolute timestamps with millisecond precision
- [~] Add a boundary inspector
- [ ] Add keyboard trim controls for frame and word movement
- [ ] Add snap indicators and snap enable/disable UX

### Word-Aware Editing

- [x] Expose word timestamps to the renderer from stored transcript data
- [x] Add click-to-select word trimming controls
- [~] Save start/end word anchor metadata
- [ ] Highlight active word consistently during playback
- [ ] Add previous/next word keyboard stepping

### Precision Timeline

- [x] Add an overview timeline with surrounding context
- [ ] Build a dedicated precision timeline component
- [ ] Add zoom controls around the active boundary
- [ ] Add frame ticks where FPS is known

### Audio Structure

- [ ] Generate waveform peaks and cache them
- [ ] Render waveform peaks in the precision timeline
- [ ] Generate silence markers
- [ ] Add snap-to-silence controls
- [ ] Add loop-preview around the active boundary

### Consistency And Verification

- [x] Ensure editor playback uses source media
- [x] Ensure export cuts from source media using saved boundaries
- [ ] Ensure preview/export use the same trim serialization rules
- [ ] Add regression tests for trim save/reopen/export consistency
- [ ] Add unit tests for anchor resolution and snapping

## Purpose

Replace the current clip boundary editing flow with a precise, non-destructive trim system that is:

- word-aware
- frame-aware
- timeline-accurate
- fast to edit
- reliable enough to feel comparable to professional consumer tools

This plan is intentionally first-principles. The current trim UX should not be incrementally polished into shape. The underlying model needs to change.

## Problem Statement

Today, Ariadne trim editing feels like guesswork because the system is built around the wrong source of truth.

Current issues:

- trim editing operates on extracted clip previews instead of the original media timeline
- the playhead is tied to `video.currentTime` from the preview clip rather than a precise absolute source timeline
- the seek controls are coarse and not designed for frame or word accuracy
- transcript context is segment-based, not word-based
- there is no waveform, no zoom, no snapping, and no looped micro-preview around boundaries
- boundary changes are stored as raw floating-point times with no concept of what they were aligned to

User-visible consequences:

- trims land "near" the right point rather than on it
- cuts often happen before or after the intended word
- it is hard to know whether the cut is on a word end, frame boundary, or silence break
- the system does not feel trustworthy for precise finishing

## Design Principles

The replacement trim system should follow these principles:

1. Original media is the source of truth.
2. Trim state is non-destructive until save/export.
3. Boundaries are edited against real anchors, not guessed floating points.
4. The editor must support both fast rough trimming and surgical precision trimming.
5. The UI should make the current boundary decision legible:
   - what time it is on
   - what word it is on
   - whether it is snapped
   - what it is snapped to

## Product Goal

A user should be able to:

- trim a clip to end exactly after a chosen word
- trim a clip to start on the first spoken word after silence
- nudge by one frame when needed
- preview a short loop around a boundary
- trust that what they see on the timeline matches what will export

## Target Interaction Model

The trim editor should operate on a single source timeline with two boundary handles:

- `inPoint`
- `outPoint`

The user should be able to edit boundaries through multiple inputs:

- drag the in/out handles
- click a transcript word to set:
  - start before this word
  - end after this word
- use keyboard nudges:
  - `Left` / `Right`: 1 frame
  - `Shift + Left` / `Shift + Right`: 5 frames
  - `Alt + Left` / `Alt + Right`: previous/next word boundary
- click waveform to seek
- zoom in around a boundary
- loop-preview 1 to 2 seconds around the active boundary

## What "World-Class" Means Here

The system should support these editing modes:

### Rough Cut Mode

Fast adjustments with broad context:

- overview timeline of the clip plus nearby context
- fast dragging
- simple transcript context

### Precision Mode

High-resolution editing around a selected boundary:

- zoomed waveform
- visible word anchors
- frame-step nudging
- loop preview
- clear snap indicators

### Smart Assist Mode

Optional assistive suggestions:

- snap to nearest word end
- snap to nearest sentence end
- snap to nearest silence boundary
- tighten dead air
- trim to first confident spoken word

These are assistive only. The system should never silently move user boundaries without showing it.

## Source Of Truth

The trim system should rely on four time sources:

1. Original media timeline
- authoritative playback and export timeline

2. Frame timing
- for keyboard nudging and frame snapping
- derived from video FPS where available

3. Word timestamps
- derived from stored Whisper word timestamps
- used for word snapping and click-to-trim

4. Pause/silence markers
- derived from waveform or audio analysis
- used for start/end cleanup

## Core Data Model

Add an explicit boundary model rather than just storing raw times.

Recommended structures:

```ts
type TrimBoundaryType =
  | 'free'
  | 'frame'
  | 'word_start'
  | 'word_end'
  | 'segment_start'
  | 'segment_end'
  | 'silence_start'
  | 'silence_end'

interface TrimBoundaryAnchor {
  type: TrimBoundaryType
  sourceId?: string
  time: number
  confidence?: number
  label?: string
}

interface ClipTrimState {
  clipId: string
  episodeId: string
  inPoint: number
  outPoint: number
  inAnchor?: TrimBoundaryAnchor
  outAnchor?: TrimBoundaryAnchor
  sourceMediaPath: string
  frameRate?: number
  updatedAt: string
}
```

This matters because later the UI can say:

- `End snapped to word_end: "strategy"`
- `Start snapped to silence_end`

Instead of showing an unexplained decimal timestamp.

## Anchor Model

All boundary edits should resolve to anchors.

Recommended anchor families:

- frame anchors
- word start anchors
- word end anchors
- segment start/end anchors
- pause start/end anchors

Anchor generation should happen once per episode and be cached.

### Word Anchors

Use stored transcript words where available:

- `word.start`
- `word.end`
- `word.text`
- `segment_id`

If a segment has no word timestamps, fall back to segment anchors only.

### Silence Anchors

Generate from audio energy analysis:

- detect spans of low energy over a configurable minimum duration
- convert these spans to candidate silence boundaries

Recommended first-pass thresholds:

- silence floor: tune empirically
- minimum pause duration: 120ms to 250ms

### Frame Anchors

If FPS is known:

- `frameDuration = 1 / fps`
- derive exact frame-aligned time positions

If FPS is unavailable:

- keep frame nudging disabled or fall back to millisecond nudge

## Playback Architecture

The editor should stop using extracted clip files as the primary editing surface.

### Current Model

- request backend to cut a temporary clip
- load the temporary clip
- edit using clip-relative time

### Replacement Model

- load the original episode media in the editor
- seek to the current clip region
- keep clip boundaries as overlay markers on the full source timeline
- export or preview by applying `inPoint/outPoint` against the source

Benefits:

- one authoritative timeline
- no mismatch between preview clip time and source time
- easier precise seeking
- easier waveform alignment
- less regeneration churn during editing

## UI Architecture

The trim editor should have five main surfaces.

### 1. Source Preview Player

Requirements:

- play original media
- support accurate seeking
- support boundary overlay
- support in/out loop preview

### 2. Overview Timeline

Purpose:

- show clip region with context before and after
- allow quick large-scale moves

Requirements:

- visible in/out handles
- visible playhead
- visible current clip duration
- context shading outside selected clip

### 3. Precision Timeline

Purpose:

- show a zoomed window around the selected boundary

Requirements:

- waveform peaks
- word anchors
- silence anchors
- frame ticks where appropriate
- drag handle with snapping

### 4. Transcript Word Rail

Purpose:

- allow word-accurate trimming

Requirements:

- clickable words with timing
- active word highlighting during playback
- boundary actions:
  - `Set Start`
  - `Set End`

### 5. Boundary Inspector

Purpose:

- make the current trim decision explainable

Show:

- exact timestamp
- anchor type
- anchor label
- delta from nearest word/frame if freehand
- effective duration

## Storage And Caching

The trim system needs reusable cached analysis artifacts.

### Episode-Level Cached Data

Recommended:

- waveform peaks
- frame rate
- duration
- transcript word timing index
- silence markers

Potential new table:

```sql
trim_analysis_cache (
  episode_id TEXT PRIMARY KEY,
  waveform_peaks_json TEXT,
  frame_rate REAL,
  silence_markers_json TEXT,
  word_index_json TEXT,
  created_at TEXT,
  updated_at TEXT
)
```

If waveform payloads become too large, move peaks to a sidecar file on disk and store only the metadata/path in SQLite.

### Clip-Level Saved State

Store:

- in/out points
- in/out anchor metadata
- zoom preference if useful

This can live in `clip_edits` or a dedicated trim table. A dedicated trim table is cleaner.

Recommended:

```sql
clip_trim_state (
  clip_id TEXT PRIMARY KEY,
  in_point REAL NOT NULL,
  out_point REAL NOT NULL,
  in_anchor_type TEXT,
  in_anchor_source_id TEXT,
  in_anchor_label TEXT,
  out_anchor_type TEXT,
  out_anchor_source_id TEXT,
  out_anchor_label TEXT,
  updated_at TEXT NOT NULL
)
```

## Backend Work Required

### 1. Episode media access in editor

Need:

- a way to load the original episode media directly in the editor
- not just pre-cut clip files

Likely work:

- expose original media path safely to renderer playback
- ensure seeking against source media is stable in Electron

### 2. Word timing retrieval API

Need:

- normalized word-level transcript API per episode and per clip

Recommended API shape:

```ts
getEpisodeWordAnchors(episodeId): Promise<Array<{
  id: string
  text: string
  start: number
  end: number
  segmentId: string
}>>
```

### 3. Waveform analysis

Need:

- precomputed waveform peaks for the episode audio

Implementation options:

- derive peaks from extracted audio using ffmpeg + decoder
- use a Node audio decode library
- store downsampled peaks at multiple zoom levels if needed later

### 4. Silence analysis

Need:

- a backend utility that computes likely pause ranges

Output:

- start/end times
- confidence score

### 5. Frame rate metadata

Need:

- reliable FPS retrieval from `ffprobe`
- stored with episode or trim cache

### 6. Non-destructive preview/export path

Need:

- preview and export to use source media + current trim state
- not old clip preview assumptions

## Frontend Work Required

### 1. Replace clip-relative trim player

Current `ClipEditModal` duration tab should move from:

- preview-clip-first

To:

- source-player-first

### 2. Introduce editor trim state

Need a dedicated state object:

- `absolutePlayhead`
- `inPoint`
- `outPoint`
- `selectedBoundary`
- `snapMode`
- `zoomRange`

### 3. Build precision timeline components

Recommended components:

- `TrimOverviewTimeline`
- `TrimPrecisionTimeline`
- `TranscriptWordRail`
- `TrimBoundaryInspector`

### 4. Add keyboard control layer

Required:

- single-frame nudge
- five-frame nudge
- previous/next word jump
- previous/next silence jump
- loop selected boundary preview

### 5. Add snapping UX

Need visible states:

- snap enabled / disabled
- snapped to word/frame/silence
- hold modifier to temporarily disable snapping

## Accuracy Requirements

To feel trustworthy, define explicit accuracy goals.

### Playback / UI Goals

- playhead updates at animation-frame smoothness in precision mode
- drag latency low enough to feel direct
- visible timestamps with millisecond precision

### Boundary Goals

- frame nudge lands exactly on one frame interval
- word snap lands exactly on stored `word.start` or `word.end`
- saved/exported boundary matches visible snapped boundary

### Export Goals

- exported clip boundaries should differ from saved trim state by no more than one frame

## Technical Risks

### 1. Browser media seek precision

Risk:

- HTML video elements can have seek granularity quirks depending on codec/container

Mitigation:

- test source formats
- add frame-step fallback behavior
- consider a dedicated media playback layer later if browser precision is insufficient

### 2. Whisper word timing quality

Risk:

- word timestamps are not perfect for all speech conditions

Mitigation:

- allow frame nudging around snapped word boundaries
- visually indicate confidence
- fall back to segment anchors when needed

### 3. Performance of waveform generation

Risk:

- large episodes can make waveform extraction expensive

Mitigation:

- generate once
- cache aggressively
- use downsampled peaks

### 4. Export mismatch

Risk:

- preview looks right but ffmpeg cut differs slightly

Mitigation:

- standardize trim rounding rules
- define boundary serialization rules centrally
- test preview vs export alignment

## Recommended Phases

## Phase 1: Precision Foundation

Goal:

- eliminate obvious guesswork and make the editor timeline honest

Tasks:

- use source media in editor instead of extracted clip file
- introduce absolute `inPoint/outPoint`
- add high-resolution seek with sub-second steps
- add frame-rate metadata
- add keyboard frame nudges
- show exact timestamps with milliseconds

Success criteria:

- boundaries can be adjusted deterministically without relying on coarse clip-relative playback

## Phase 2: Word-Aware Editing

Goal:

- make trims land on spoken words, not approximate positions

Tasks:

- expose word timing data to the renderer
- render transcript word rail
- add click-word set-start / set-end
- add word-start / word-end snapping
- show active word under playhead

Success criteria:

- user can confidently trim to the end of a specific word

## Phase 3: Waveform + Silence

Goal:

- make boundary cleanup visually and acoustically obvious

Tasks:

- generate cached waveform peaks
- build zoomable precision waveform timeline
- generate silence markers
- add snap-to-silence and loop-preview around boundaries

Success criteria:

- user can quickly trim dead air and align boundaries using audio structure

## Phase 4: Save/Preview/Export Consistency

Goal:

- ensure editor state exactly matches final output

Tasks:

- unify trim serialization
- ensure preview uses the same trim model as export
- add regression tests for saved trim vs exported clip

Success criteria:

- no visible mismatch between editor and exported output

## Phase 5: Smart Assist

Goal:

- speed up editing without taking control away from the user

Tasks:

- add suggested trim cleanup actions:
  - remove leading silence
  - end on sentence completion
  - tighten to nearest clean word boundary
- rank suggestions by confidence

Success criteria:

- suggestions save time while staying transparent and reversible

## First Implementation Slice

Start here.

### Slice A: Replace clip-relative trimming with source-relative trimming

Files likely affected:

- `src/renderer/src/components/ClipEditModal.tsx`
- `src/main/preload.ts`
- `src/main/main.ts`
- `src/shared/types.ts`
- possibly database state for saved trim metadata

Tasks:

- add API to retrieve original episode media path for editor playback
- change duration tab to load original media
- keep `absolutePlayhead`, `inPoint`, and `outPoint`
- remove trim math based on extracted clip current time
- show precise absolute timestamps and duration
- add `step="0.01"` at minimum on range-based seek controls
- add keyboard frame or 10ms nudges immediately

Why this is first:

- it fixes the biggest structural error
- it is prerequisite for proper word snapping and waveform work
- it improves trust before the full advanced editor exists

## Second Implementation Slice

### Slice B: Word-boundary trim support

Tasks:

- expose normalized word timings
- build clickable word list/rail
- support:
  - set start to word start
  - set end to word end
- save anchor metadata with trim state

## Testing Plan

Need automated and manual checks.

### Automated

- unit tests for anchor resolution
- unit tests for word-snap and frame-snap calculations
- tests for trim serialization / deserialization
- tests that boundary duration constraints remain valid

### Manual

Use 5 to 10 real clips with:

- fast speech
- pauses
- overlapping music/background noise
- sentence endings near current clip boundary
- cases where the user wants to end exactly after a punchline word

Check:

- can user trim to exact word end
- does saved state reopen accurately
- does exported clip match editor boundaries

## Non-Goals For The First Pass

Do not block the trim overhaul on:

- full multi-track audio editing
- subtitle animation redesign
- AI-driven automatic re-trimming
- collaborative editing

## Recommendation

Do not keep improving the current trim buttons and preview clip model beyond temporary safety fixes.

The right path is:

- source-relative editing
- anchor-based boundaries
- word-aware trims
- waveform and silence visualization
- precise preview/export consistency

That is the foundation required for a trim experience that feels world-class.
