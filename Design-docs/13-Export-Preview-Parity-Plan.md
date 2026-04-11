# Export / Preview Parity Plan

## Goal

Exports must match the Clip Preview exactly for caption and overlay rendering. "Close" is not acceptable.

## Firm Root Causes

### 1. Most long clips are still falling back to ASS subtitles

Current code in [src/main/workers/exportWorker.ts](/Users/andydavid/Coding/Ariadne/src/main/workers/exportWorker.ts) caps DOM-rendered caption overlays at `50` per clip:

- if the estimated overlay count exceeds `50`
- the worker silently falls back to ASS subtitles

That fallback reintroduces the old renderer and explains why many export changes appear to have "no effect".

This is the current main reason exported caption backgrounds do not match the Clip Preview.

### 2. Preview and export are still laid out in different coordinate systems

Current code paths:

- Clip Preview in [src/renderer/src/pages/ClipEditorPage.tsx](/Users/andydavid/Coding/Ariadne/src/renderer/src/pages/ClipEditorPage.tsx) still derives caption layout from the on-screen preview width.
- Export overlay rendering in [src/main/services/exportOverlayService.ts](/Users/andydavid/Coding/Ariadne/src/main/services/exportOverlayService.ts) uses a fixed synthetic preview canvas.

Even with the same Brand Template values, different layout spaces produce different results.

### 3. Export parity cannot depend on silent renderer downgrades

If a clip requires preview-style caption rendering, export should not silently switch to a different renderer model.

For exact parity:

- use the DOM/browser overlay renderer
- or fail loudly

Do not silently fall back to ASS for captioned exports.

## Implementation Plan

### Phase 1. Remove silent renderer downgrade

1. Remove the `MAX_OVERLAYS_PER_CLIP` cap in the export worker.
2. Stop silently falling back to ASS when a captioned clip exceeds the cap.
3. If DOM overlay generation fails for a captioned export, fail the clip with a clear message.

Expected result:

- export changes now actually affect all captioned clips
- parity work becomes visible and testable

### Phase 2. Establish one canonical preview canvas

1. Define canonical preview sizes for each aspect ratio:
   - `9:16` -> `300x533`
   - `1:1` -> `430x430`
   - `16:9` -> `640x360`
2. Move Clip Preview layout logic onto that fixed internal canvas.
3. Visually scale the on-screen preview around that internal canvas instead of recomputing layout from live DOM width.
4. Reuse the same canvas dimensions in export overlay rendering.

Expected result:

- identical layout basis for preview and export
- padding / spread / radius stop drifting between the two

### Phase 3. Share caption layout primitives

1. Move canonical preview-canvas helpers into a shared module.
2. Reuse the same helpers in:
   - Clip Preview
   - export caption segment building
   - export overlay rendering
3. Keep Brand Template values raw; do not rescale individual box-model values separately for export.

Expected result:

- one source of truth for preview/export layout assumptions

### Phase 4. Validate parity with deliberate test cases

Use a small set of known cases:

1. One-line caption with large horizontal spread
2. One-line caption with large vertical spread
3. Rounded background radius
4. Active-word highlighting across 3-word cue
5. Custom caption position

For each:

- compare Clip Preview screenshot
- compare exported frame
- verify no ASS fallback occurred

## Current Execution Order

1. Remove ASS fallback for long clips.
2. Refactor Clip Preview to canonical preview-space layout.
3. Refactor export overlay rendering to use the same canonical preview-space helpers.
4. Re-test spread parity before touching any other caption styling.

## Non-Goals For This Slice

- Reworking music export
- Reworking logo export
- Export performance optimization beyond what is necessary to preserve parity

Performance can be optimized after renderer parity is correct.
