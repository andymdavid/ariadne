# Export Function Fix Plan

## Problem Summary

The clip export function produces videos that don't match the Clip Preview screen. Additionally, exports are failing with errors like "8 clips failed while 0 completed".

## Root Causes Identified

### Export Failures (Critical - Blocking All Exports)

**Primary Issue: PNG Overlay Approach is Fundamentally Flawed**

The current approach creates one PNG file per word in the caption, which causes:

1. **Filter Graph Complexity** - FFmpeg fails with `auto_scale_136/165` errors
   - Each PNG becomes a separate FFmpeg input
   - Filter graph becomes too complex for FFmpeg to handle
   - Error: `Failed to configure output pad on auto_scale_XXX`

2. **Resource Exhaustion** - FFmpeg killed with SIGKILL
   - Too many inputs overwhelm system resources
   - Error code -35: "Resource temporarily unavailable"

3. **PNG Generation Failures** - sips command issues
   - macOS sips utility has unreliable SVG-to-PNG conversion
   - Error: `Error opening input file .../export-overlays/XXX.png`

**Solution: Use ASS Subtitles Instead**
- ASS subtitles are rendered inline by FFmpeg's libass
- No separate input files needed
- Already implemented in ffmpegService.ts (lines 554-577)
- Activated when `captionOverlayFrames` array is empty

### Visual Discrepancies (Secondary - To Address After Exports Work)

1. **Text Width Measurement Mismatch**
   - Preview uses Canvas API for accurate text measurement
   - Export uses a rough character-count estimation formula
   - This causes different word chunking and line breaks

2. **Reference Width Inconsistencies**
   - Export overlay service uses different reference widths than preview
   - Preview uses dynamic container width (~260px)
   - Export uses hardcoded values (300/430/640)

3. **Caption Positioning Differences**
   - Preview uses CSS percentage + transform positioning
   - Export calculates absolute pixel positions differently

4. **Font Scaling Issues**
   - UI-to-output scale calculations differ between components

---

## Implementation Plan

### Phase 1: Fix Export Failures (Critical)

- [x] **1.1** Disable PNG overlay generation, use ASS subtitles
  - Modified `exportWorker.ts` to skip PNG overlay generation
  - ASS subtitles path is now used instead
  - No more filter graph complexity issues

- [ ] **1.2** Test export with ASS subtitles
  - Verify clips export successfully
  - Check caption timing and positioning
  - Validate font rendering

### Phase 2: Visual Parity (After Exports Work)

- [ ] **2.1** Unify text measurement
  - Create shared text measurement utility
  - Port Canvas-based measurement approach to export service

- [ ] **2.2** Unify caption layout configuration
  - Extract shared caption layout configuration
  - Single source of truth for layout parameters

- [ ] **2.3** Align positioning calculations
  - Unified position calculation utility
  - Consistent top/center/bottom/custom positions

- [ ] **2.4** Match font scaling
  - Unified UI-to-output scale calculations
  - Consistent reference widths

### Phase 3: Testing & Validation

- [ ] **3.1** Create visual comparison tests
  - Export clips and compare to preview screenshots
  - Automate where possible

- [ ] **3.2** Test edge cases
  - Very long captions
  - Single word captions
  - Various fonts and weights
  - All aspect ratios (9:16, 1:1, 16:9)
  - All crop modes (fit, center, blur)

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
- `src/main/workers/exportWorker.ts` - Skip PNG overlay generation, use ASS subtitles

### Session 1 - April 10, 2026 (REVERTED)
All changes from session 1 were reverted due to runtime module resolution issues.

---

## Progress Log

### Session 2 - April 11, 2026

**Analysis:**
1. Queried failure_events table for actual error details
2. Identified three distinct failure modes:
   - Filter graph complexity (136+ inputs)
   - Resource exhaustion (SIGKILL)
   - PNG generation failures (sips issues)
3. Root cause: PNG overlay approach creates too many FFmpeg inputs

**Fix Applied:**
1. Disabled PNG overlay generation in exportWorker.ts
2. FFmpeg will now use ASS subtitles fallback path
3. This eliminates all three failure modes

**Next Steps:**
1. Test export to verify clips are created successfully
2. Check caption appearance with ASS subtitles
3. Address visual parity if needed

### Session 1 - April 10, 2026

**Attempted:**
- Pre-flight validation, shared utilities, etc.
- All reverted due to module resolution issues at runtime

---

## Technical Notes

### Why ASS Subtitles Are Better

1. **Single file** - One .ass file per clip instead of 100+ PNGs
2. **Inline rendering** - libass renders subtitles within FFmpeg
3. **No input limit** - Filter graph stays simple
4. **Already implemented** - ffmpegService.ts already has ASS generation
5. **Font support** - Font installed to user library for CoreText

### ASS Subtitle Flow

1. `ffmpegService.exportReelClip()` checks `captionOverlayFrames`
2. If empty, calls `generateASSSubtitles()` (line 563)
3. Generates .ass file with styled captions
4. Adds `ass='path.ass'` filter to FFmpeg
5. libass renders captions during encoding
