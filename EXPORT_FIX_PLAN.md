# Export Function Fix Plan

## Problem Summary

The clip export function produces videos that don't match the Clip Preview screen. Additionally, exports are failing with errors like "8 clips failed while 0 completed".

## Root Causes Identified

### Export Failures (Critical - Blocking All Exports)

**Primary Issue: Too Many PNG Overlay Inputs**

The PNG overlay approach creates one file per word in captions, causing:

1. **Filter Graph Complexity** - FFmpeg fails with `auto_scale_136/165` errors
   - Each PNG becomes a separate FFmpeg input
   - 100+ inputs overwhelm FFmpeg's filter graph
   - Error: `Failed to configure output pad on auto_scale_XXX`

2. **Resource Exhaustion** - FFmpeg killed with SIGKILL
   - Too many inputs overwhelm system resources
   - Error code -35: "Resource temporarily unavailable"

3. **PNG Generation Failures** - sips command issues
   - macOS sips utility has unreliable SVG-to-PNG conversion
   - Error: `Error opening input file .../export-overlays/XXX.png`

### Visual Parity Issue

ASS subtitles (fallback) create **rectangular** boxes, not rounded corners like preview:
- Preview uses CSS with `borderRadius` for rounded rectangles
- ASS BorderStyle=3 creates simple rectangular opaque boxes
- This is a limitation of the ASS format

---

## Current Solution: Hybrid Approach

### Strategy: Smart Fallback

1. **For clips with ≤50 caption overlays** → Use PNG overlays (visual parity)
2. **For clips with >50 caption overlays** → Use ASS subtitles (avoid FFmpeg crash)

This provides:
- Full visual parity (rounded backgrounds) for most clips
- Reliable export for caption-heavy clips via ASS fallback

### Implementation Details

**exportWorker.ts**:
```typescript
const MAX_OVERLAYS_PER_CLIP = 50

// Estimate total overlays needed
const estimatedOverlays = task.captionSegments.reduce(...)

if (estimatedOverlays <= MAX_OVERLAYS_PER_CLIP) {
  // Use PNG overlays for visual parity
  captionOverlayFrames = await exportOverlayService.renderCaptionOverlayFrames(...)
} else {
  // Fall back to ASS subtitles
  captionOverlayFrames = []
}
```

---

## Implementation Plan

### Phase 1: Fix Export Failures (Critical) ✅

- [x] **1.1** Identify root cause via failure_events database
- [x] **1.2** Implement smart fallback (PNG for ≤50 overlays, ASS for >50)
- [x] **1.3** Add debug logging for caption style values
- [x] **1.4** Fix ASS background rendering (BorderStyle=3, Shadow=4)

### Phase 2: Testing Required

- [ ] **2.1** Test export with PNG overlays
  - Rebuild the app
  - Export a clip with few captions (≤50 overlays)
  - Verify rounded background appears

- [ ] **2.2** Test export with ASS fallback
  - Export a clip with many captions (>50 overlays)
  - Verify export completes (rectangular background is OK)

- [ ] **2.3** Verify console logs show correct values
  - `[ExportWorker] Generated X caption overlays for clip Y`
  - `[FFmpegService] ASS Style Debug: { background: true, ... }`

### Phase 3: Visual Parity Improvements (Optional)

If rectangular backgrounds are acceptable for long captions, no further work needed.

If full parity is required for all clips:
- [ ] **3.1** Increase MAX_OVERLAYS_PER_CLIP if system can handle it
- [ ] **3.2** Consider batching overlays more efficiently
- [ ] **3.3** Consider pre-rendering segment groups as single images

---

## Detailed Error Analysis

### Actual Errors from Database (failure_events table)

**Error Type 1: Filter Graph Complexity (exit code 221)**
```
[auto_scale_165 @ ...] Failed to configure output pad on auto_scale_165
[fc#0 @ ...] Error reinitializing filters!
[fc#0 @ ...] Task finished with error code: -35 (Resource temporarily unavailable)
```

**Error Type 2: SIGKILL**
```
ffmpeg was killed with signal SIGKILL
```
Occurs at ~0.5 fps processing speed with 136+ overlay inputs.

**Error Type 3: Invalid PNG (exit code 183)**
```
Error opening input file .../export-overlays/XXX.png
Error opening input files: Invalid data found when processing input
```
sips fails to convert SVG to valid PNG.

---

## Files Modified

### Session 2 - April 11, 2026

- `src/main/workers/exportWorker.ts`
  - Smart fallback: PNG overlays for ≤50, ASS for >50

- `src/main/services/ffmpegService.ts`
  - Debug logging for ASS style values
  - Fixed ASS Shadow value (4 when background enabled)

- `src/main/services/exportService.ts`
  - Debug logging for caption background settings

### Session 1 - April 10, 2026 (REVERTED)

All changes from session 1 were reverted due to runtime module resolution issues.

---

## Progress Log

### Session 2 - April 11, 2026

**Analysis:**
1. Queried failure_events table for actual error details
2. Identified three distinct failure modes (filter complexity, SIGKILL, PNG failures)
3. Found threshold: FFmpeg crashes at 136+ overlay inputs

**User Feedback:**
- Exports were working but caption backgrounds not appearing
- ASS BorderStyle=3 creates rectangular boxes, not rounded like preview

**Fixes Applied:**
1. Implemented smart fallback (PNG overlays for ≤50, ASS for >50)
2. Added debug logging to trace caption style values
3. Fixed ASS Shadow value to enable opaque box rendering

**Next Steps:**
1. Rebuild and test export with PNG overlays
2. Verify rounded backgrounds appear for clips with ≤50 overlays
3. Confirm ASS fallback works for caption-heavy clips

---

## Technical Notes

### PNG Overlay Flow (Visual Parity)

1. `exportOverlayService.renderCaptionOverlayFrames()` generates SVGs
2. sips (macOS) converts SVG → PNG
3. Each PNG is an FFmpeg input with timed overlay
4. Result: Rounded rectangle backgrounds matching preview

Limitation: Max ~50 overlays per clip to avoid FFmpeg crashes.

### ASS Subtitle Flow (Fallback)

1. `ffmpegService.generateASSSubtitles()` creates .ass file
2. BorderStyle=3 with Shadow=4 for opaque box background
3. libass renders subtitles inline during FFmpeg encoding

Limitation: Rectangular backgrounds only (no rounded corners).

### Threshold Selection

The 50-overlay limit was chosen conservatively based on:
- FFmpeg crashed at 136+ inputs
- Leaving headroom for other inputs (logo, music)
- Most clips have ~20-40 words, which fits under limit
