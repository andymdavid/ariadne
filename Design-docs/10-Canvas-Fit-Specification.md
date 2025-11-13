# Canvas Fit - Technical Specification

## Executive Summary

Canvas Fit mode needs to work like CapCut: the video is a freely positioned and scaled layer on a canvas. The user controls zoom (0.5× to 2.0×) and position (by dragging). What you see in the preview must exactly match what exports - no surprises, no quality loss, no aspect ratio distortion.

## The Problem

Current state:
- **Center Crop mode**: Works correctly. Video fills frame, zoom slider punches in/out, user can drag to reposition crop.
- **Canvas Fit mode**: Broken. Zoom slider does nothing. Was previously implemented with complex "fitScale" math that caused preview/export mismatches and quality loss.

Root cause: We tried to be "smart" with aspect ratio calculations and CSS/FFmpeg fit modes. This caused unpredictable behavior and prevented the simple layer-based manipulation that users expect.

## The Solution: Video as a Positioned Layer

### Conceptual Model

Think of Canvas Fit like **PowerPoint** or **Photoshop layers**:
- You have a **canvas** (the 9:16 output frame)
- You place a **video layer** on it
- You can **scale** the layer (zoom slider: 0.5× to 2.0×)
- You can **move** the layer (drag to reposition)
- The layer **maintains its aspect ratio** naturally
- If the layer is bigger than the canvas, it **overflows** (gets clipped)
- If the layer is smaller than the canvas, you see **padding** (black bars)

This is NOT a "fit mode" - it's a positioning system.

### Visual Behavior

```
Zoom = 0.5× (scaled down):
- Video appears small, centered
- Black padding visible around it
- Entire source video is visible

Zoom = 1.0× (baseline):
- Video fits naturally
- May have black bars (top/bottom or sides depending on aspect)
- This is the "neutral" starting point

Zoom = 1.5× (scaled up):
- Video appears larger
- May overflow the canvas edges (gets clipped)
- Less of the source video is visible

Zoom = 2.0× (maximum):
- Video is significantly enlarged
- Likely overflows on all sides
- Shows a "punched in" view
```

## Critical Requirements

### 1. Data Persistence Requirements

**Video Dimensions**:
- Must be stored in database when clip is created
- Must be loaded from database (not derived from video element)
- Required fields: `video_width`, `video_height` on clips table

**Canvas Fit Settings**:
- Must persist: `zoom_level` (default: 1.0, range: 0.5 to 2.0)
- Must persist: `video_offset_x` (default: 0, in pixels from canvas center)
- Must persist: `video_offset_y` (default: 0, in pixels from canvas center)

**Why**: Video element dimensions are async and unreliable. Database is single source of truth.

### 2. Coordinate System Definition

```
Origin: Center of the canvas
X-axis: Horizontal (positive = right, negative = left)
Y-axis: Vertical (positive = down, negative = up)

Examples:
offsetX: 100, offsetY: 0   → Video shifted 100px right
offsetX: -50, offsetY: 100 → Video shifted 50px left, 100px down
offsetX: 0, offsetY: -80   → Video shifted 80px up from center
```

**Why**: Without explicit definition, UI and FFmpeg will have different interpretations.

### 3. Preview Rendering Requirements

**Must Use**:
- Explicit pixel dimensions calculated from: `sourceWidth × zoomLevel`, `sourceHeight × zoomLevel`
- Absolute positioning calculated from: canvas center ± offsets
- Container with `overflow: hidden` to clip overflowing video

**Must NOT Use**:
- CSS `transform: scale()` (causes artifacts)
- CSS `object-fit: contain` or `object-fit: cover` (unpredictable)
- Default dimensions like 1920×1080 (wrong for non-16:9 sources)

**Loading State**:
- Must NOT render until video dimensions are loaded from database
- Must show explicit loading state while dimensions are being fetched
- Initial state for dimensions must be `null`, not a default value

**Why**: Explicit dimensions ensure pixel-perfect preview that matches export exactly.

### 4. FFmpeg Export Requirements

**Must Use**:
- Source video dimensions from database (never hardcoded)
- Scale filter with explicit pixel dimensions: `scale=W:H`
- Overlay filter with explicit position: `overlay=X:Y`
- Black background canvas created with: `color=black:s=WxH`

**Must NOT Use**:
- `force_original_aspect_ratio` (causes quality loss)
- Hardcoded dimensions like 1920×1080 (breaks for other sources)
- Complex crop/fit calculations (introduces mismatches)

**Filter Order**:
1. Video scaling and positioning (Canvas Fit logic)
2. Logo overlay (if enabled)
3. Subtitles (if enabled)
4. Audio mixing (separate from video, comes after)

**Why**: Simple scale + overlay at exact coordinates matches preview exactly and preserves quality.

### 5. User Interaction Requirements

**Zoom Slider**:
- Range: 0.5× to 2.0×
- Step: 0.01
- Default: 1.0× (baseline fit)
- Shows for both Center Crop and Canvas Fit modes
- Behavior differs by mode:
  - Center Crop: Changes crop window size (always fills frame)
  - Canvas Fit: Scales the video layer itself (can show padding/overflow)

**Video Dragging**:
- Only enabled in Canvas Fit mode
- Click and drag anywhere on video to reposition
- Visual feedback: cursor changes to `grab`/`grabbing`
- Must be bounded: at least 10% of video must remain visible
- Cannot drag completely off-screen

**Reset Position**:
- Button to reset offsets to (0, 0) - recenter video
- Only show when offsets are non-zero
- Only available in Canvas Fit mode

**Why**: Users need intuitive control that feels like manipulating a layer in design software.

### 6. Type Safety Requirements

**Shared Type Definition**:
- Must create single source of truth for `FrameSettings` type
- Must be imported by both FrameEditor and ClipEditModal
- Must prevent type drift between components

**IPC Interface**:
- Must update Electron preload types to include new fields
- Must ensure type safety across main/renderer boundary
- Must handle all new database columns

**Why**: Prevents bugs from components having different expectations about data structure.

## Mode Comparison: Center Crop vs Canvas Fit

### Center Crop (Existing, Keep Working)
- **Purpose**: Always fill the frame, crop from source
- **Zoom behavior**: Changes crop window size
- **Positioning**: Drag to choose which part of source to show
- **Aspect ratio**: Forces to match output (e.g., 9:16)
- **Preview styling**: Can use `object-fit: cover` and `transform: scale()`
- **Export**: Crop to aspect, then scale to fill

### Canvas Fit (New Implementation)
- **Purpose**: Video as positioned layer on canvas
- **Zoom behavior**: Scales the video layer itself
- **Positioning**: Drag to move layer on canvas
- **Aspect ratio**: Maintains source aspect (e.g., 16:9)
- **Preview styling**: Must use explicit dimensions and absolute positioning
- **Export**: Scale video, overlay on black canvas at position

**Critical**: These are fundamentally different approaches. Do not mix their logic.

## Rules and Anti-Patterns

### ✅ DO

1. **Store video dimensions in database when clip is created**
2. **Load dimensions from database before rendering**
3. **Use explicit pixel dimensions for everything**
4. **Define coordinate system clearly (origin, axes, signs)**
5. **Bound dragging to keep video partially visible**
6. **Show loading state until metadata is available**
7. **Keep filter order correct (video → logo → subtitles → audio)**
8. **Use shared types to prevent drift**
9. **Test with multiple aspect ratios (16:9, 9:16, 1:1, 21:9)**

### ❌ DON'T

1. **Don't use default dimensions (1920×1080)** - Wrong for non-16:9 sources
2. **Don't use `transform: scale()` for Canvas Fit** - Causes artifacts
3. **Don't use `object-fit` for Canvas Fit** - Unpredictable behavior
4. **Don't hardcode dimensions in FFmpeg** - Breaks for different sources
5. **Don't allow unlimited dragging** - Video can disappear
6. **Don't render before metadata loads** - Preview will be wrong
7. **Don't calculate "fitScale" ratios** - Overcomplicates simple scaling
8. **Don't mix Center Crop and Canvas Fit logic** - Different paradigms
9. **Don't break audio processing** - Filter order matters

## Success Criteria

### Functional Requirements
- [ ] Zoom slider (0.5× to 2.0×) controls video layer scale
- [ ] Drag video to reposition on canvas
- [ ] Video maintains source aspect ratio at all zoom levels
- [ ] Preview shows black padding when zoom < 1
- [ ] Preview clips overflowing video when zoom > 1
- [ ] Position bounded to keep 10% visible minimum
- [ ] Reset button centers video at (0, 0)

### Technical Requirements
- [ ] Video dimensions stored in database (clips table)
- [ ] Canvas Fit settings stored in database (clip_edits table)
- [ ] Dimensions loaded from DB before rendering
- [ ] No default dimensions used anywhere
- [ ] Shared FrameSettings type prevents drift
- [ ] IPC interfaces updated for new fields
- [ ] FFmpeg filter order preserved (video before audio)

### Quality Requirements
- [ ] **Preview exactly matches export** (pixel-perfect WYSIWYG)
- [ ] **No quality loss** from resampling
- [ ] **No aspect ratio distortion** at any zoom level
- [ ] **No race conditions** from async metadata loading
- [ ] **No off-screen videos** from unbounded dragging

### Testing Requirements
- [ ] Test with 16:9 landscape source
- [ ] Test with 9:16 portrait source
- [ ] Test with 1:1 square source
- [ ] Test with 21:9 ultra-wide source
- [ ] Test zoom = 0.5× (should show padding)
- [ ] Test zoom = 1.0× (should fit naturally)
- [ ] Test zoom = 2.0× (should overflow/clip)
- [ ] Test dragging to boundaries (should clamp)
- [ ] Test reset position (should recenter)
- [ ] Test "Apply to All" with mixed aspect ratios
- [ ] Test audio processing not broken by video filters

## Implementation Phases

### Phase 1: Data Foundation
- Add `video_width`, `video_height` to clips table
- Add `zoom_level`, `video_offset_x`, `video_offset_y` to clip_edits table
- Store dimensions when creating clips (processing pipeline)
- Ensure all existing clips have dimensions backfilled

### Phase 2: Type Safety
- Create shared `FrameSettings` type
- Update IPC interfaces in preload
- Ensure components import shared type
- Add TypeScript validation

### Phase 3: UI Implementation
- Add zoom slider to FrameEditor
- Add reset position button
- Load dimensions from database (not video element)
- Implement bounded dragging logic
- Show loading state until dimensions available

### Phase 4: Preview Rendering
- Update ClipEditModal video styling
- Use explicit dimensions and positioning
- Implement coordinate system correctly
- Remove any object-fit or transform usage
- Handle overflow clipping

### Phase 5: Export Implementation
- Update FFmpeg filters for Canvas Fit
- Use stored dimensions (never hardcoded)
- Ensure correct filter order
- Verify audio processing still works

### Phase 6: Testing & Validation
- Test all aspect ratios
- Verify preview matches export
- Check boundary conditions
- Validate data persistence
- Test audio mixing

## Migration Considerations

**Existing Clips**:
- Clips created before this implementation won't have `video_width`/`video_height`
- Must backfill dimensions by reading video files
- Can use FFmpeg `ffprobe` to extract dimensions
- Consider migration script for existing database

**Existing Clip Edits**:
- New fields have defaults: `zoom_level = 1.0`, `video_offset_x = 0`, `video_offset_y = 0`
- No backfill needed (defaults are correct)
- Existing clips will behave as "baseline fit" initially

## Notes

**Why This Approach Works**:
- Simple: Just pixel dimensions and positions
- Predictable: What you see is exactly what you get
- Quality: No unnecessary resampling
- Flexible: Works with any source aspect ratio
- Maintainable: No complex math or "smart" behavior

**Common Misconceptions**:
- "Canvas Fit" is not a CSS or FFmpeg fit mode
- It's a positioning system, like layers in design software
- The complexity is removed, not added
- All the "smart" aspect ratio math was the problem

**Future Enhancements** (Out of Scope):
- Corner drag handles for resizing (slider works for MVP)
- Rotation support
- Multiple video layers
- Keyframe animation

These can be added later without changing the core model.