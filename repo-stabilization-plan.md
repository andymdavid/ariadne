# Ariadne Repo Stabilization Plan

## Purpose

Stabilize the codebase so trim-system work can continue without compounding type drift, IPC mismatches, and editor regressions.

This plan is execution-oriented. It is meant to be updated as work lands.

## Status Key

- [ ] not started
- [~] in progress
- [x] done
- [!] blocked or needs decision

## Current Problems

### 1. Type-System Instability

- `npm run typecheck` is not clean
- `npm run build:electron -- --noEmit` is not clean
- active renderer paths and core main-process paths both have compile failures

### 2. Shared Model Drift

- shared types do not consistently match runtime usage
- DB rows, preload API shapes, renderer expectations, and shared models are drifting apart
- snake_case and camelCase shapes are leaking across boundaries

### 3. IPC Contract Drift

- preload declarations, renderer typings, and actual usage are out of sync
- this is already visible in logo/music API typing failures

### 4. Overloaded Editor Surface

- `ClipEditModal` owns too many responsibilities:
  - playback
  - trim state
  - transcript editing
  - caption preview
  - frame editing
  - music sync
  - persistence orchestration

### 5. Incomplete Trim Architecture

- source-relative playback is in place
- trim persistence is now in place
- frame precision, keyboard nudging, waveform, silence handling, snapping UX, and consistency checks are still missing

## Workstreams

## Track 1: Type-System Cleanup

Goal:

- restore a trustworthy compile baseline

Checklist:

- [x] Remove stale or backup files from the compile graph
- [ ] Separate type errors into:
  - dead-code noise
  - IPC typing mismatches
  - shared-model mismatches
  - true behavioral bugs
- [x] Clean preload/renderer API typing drift
- [~] Normalize shared models in `src/shared/types.ts`
- [ ] Add explicit mapping layers where DB rows differ from shared models
- [x] Get `build:electron` clean
- [x] Get full `typecheck` clean

Primary files:

- [src/shared/types.ts](/Users/andydavid/Coding/Ariadne/src/shared/types.ts)
- [src/main/preload.ts](/Users/andydavid/Coding/Ariadne/src/main/preload.ts)
- [src/renderer/src/types/electron.d.ts](/Users/andydavid/Coding/Ariadne/src/renderer/src/types/electron.d.ts)
- [src/renderer/src/App.tsx](/Users/andydavid/Coding/Ariadne/src/renderer/src/App.tsx)
- [src/renderer/src/stores/projectStore.ts](/Users/andydavid/Coding/Ariadne/src/renderer/src/stores/projectStore.ts)

## Track 2: Trim-System Implementation

Goal:

- complete the trim architecture on top of a stable foundation

Checklist:

- [~] Add dedicated trim state persistence
- [~] Save trim anchor metadata
- [ ] Add frame-rate metadata retrieval and storage
- [ ] Add keyboard frame nudging
- [ ] Add previous/next word stepping
- [ ] Add selected-boundary loop preview
- [ ] Add snap mode state and visible snap indicators
- [ ] Add central trim serialization rules
- [ ] Build precision timeline
- [ ] Add waveform peaks cache
- [ ] Add silence markers and silence snapping
- [ ] Add preview/export consistency checks
- [ ] Add trim reopen/export regression tests

Primary files:

- [trim-plan.md](/Users/andydavid/Coding/Ariadne/trim-plan.md)
- [src/renderer/src/components/ClipEditModal.tsx](/Users/andydavid/Coding/Ariadne/src/renderer/src/components/ClipEditModal.tsx)
- [src/main/database/database.ts](/Users/andydavid/Coding/Ariadne/src/main/database/database.ts)
- [src/main/services/ffmpegService.ts](/Users/andydavid/Coding/Ariadne/src/main/services/ffmpegService.ts)
- [src/main/services/exportService.ts](/Users/andydavid/Coding/Ariadne/src/main/services/exportService.ts)

## Track 3: Component Refactor Boundaries

Goal:

- reduce regression risk by shrinking high-risk components and clarifying boundaries

Checklist:

- [ ] Extract trim state logic from `ClipEditModal`
- [ ] Extract source preview player component
- [ ] Extract trim overview timeline component
- [ ] Extract transcript word rail component
- [ ] Extract boundary inspector component
- [ ] Keep caption/logo/music/frame editing isolated from trim logic
- [ ] Add helper mappers at app boundaries:
  - DB row -> shared type
  - trim state -> export payload
  - transcript segments -> word anchors

Primary files:

- [src/renderer/src/components/ClipEditModal.tsx](/Users/andydavid/Coding/Ariadne/src/renderer/src/components/ClipEditModal.tsx)
- [src/renderer/src/components](/Users/andydavid/Coding/Ariadne/src/renderer/src/components)

## Execution Order

1. Repo hygiene and compile baseline
2. IPC/shared type alignment
3. Main-process compile cleanup
4. Trim foundation
5. Editor decomposition during ongoing trim work
6. Renderer compile cleanup
7. Regression checks around export, trim reopen, and playback

## First Sprint

Scope:

- [x] Remove backup/stale files from compile inputs
- [x] Fix preload and renderer API typing drift
- [ ] Add typed DB row interfaces for:
  - clip rows
  - `clip_edits`
  - `clip_trim_state`
- [x] Get `build:electron` clean
- [ ] Start frame metadata and keyboard nudge groundwork

Definition of done:

- main-process compile passes
- renderer IPC types are aligned with actual usage
- no stale backup files are poisoning the build
- trim work can continue without widening type drift

## Progress Notes

### Completed so far

- [x] Added `clip_trim_state` persistence
- [x] Added trim anchor metadata storage
- [x] Wired trim state load/save into the clip editor
- [x] Added an initial boundary inspector
- [x] Fixed `app-file://` path decoding for URL-encoded local media paths
- [x] Removed `App-backup.tsx` from renderer typecheck inputs
- [x] Restored `build:electron` to a clean passing state
- [x] Fixed missing renderer IPC typings for logo/music APIs
- [x] Aligned `ReviewPage` and `ClipCarousel` with shared `Clip` usage
- [x] Fixed `projectStore` recovery paths to create valid shared `Episode` objects
- [x] Updated `systemValidation` to match the current store contract
- [x] Restored full `npm run typecheck` to a clean passing state

### Known blockers

- [!] Shared model normalization is improved but not fully complete:
  - DB row mapping is still ad hoc in multiple renderer pages
  - typed row interfaces exist for some main-process paths, not all persistence boundaries
  - trim-system foundation work can proceed, but mapper cleanup is still worth doing
