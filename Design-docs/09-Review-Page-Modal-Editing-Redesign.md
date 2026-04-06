# Review Page Modal Editing - Redesign Specification

## Document Information

**Document Version:** 1.0
**Last Updated:** 2025-10-26
**Status:** Approved - Ready for Implementation
**Supersedes:** 06-Editor-Screen-Implementation-Plan.md (partially)

---

## Executive Summary

This document specifies a major UX restructuring that **eliminates the separate Content/Editor screen** and consolidates all clip editing functionality into an **enhanced modal within the Review page**. This approach:

- Reduces the app flow from 5 screens to 4 screens
- Eliminates context switching between Review → Content → Export
- Adds two critical missing features: **Duration Adjustment** and **Transcript Editing**
- Improves user flow with a modal-based editing pattern (similar to Instagram, TikTok)
- Maintains all existing technical architecture (database, IPC, services)

---

## Problem Statement

### Current Flow Issues:

```
Upload → Review → Content → Export → Library
          ↓         ↓
    Click clip → Opens modal (limited info)
    Then navigate to Content screen (full editor)
    ↑ USER CONFUSION - Why two separate interfaces?
```

**Problems:**
1. **Redundant UI** - Clip Preview modal shows basic info, but editing happens on separate screen
2. **Context Loss** - Users leave Review grid to edit, lose context of other clips
3. **Missing Features** - No way to adjust clip duration or edit transcript text
4. **Inefficient** - Extra navigation step adds friction
5. **Modal Underutilized** - Current Clip Preview modal only shows metadata, wastes opportunity

---

## Solution Overview

### New Unified Flow:

```
Upload → Review (with inline editing) → Export → Library
          ↓
    Click clip → Enhanced modal opens with 6 tabs:
    [Duration | Transcript | Captions | Logo | Music | Frame]
    → [Save] → Back to Review grid
```

**Benefits:**
- ✅ **Streamlined** - Edit clips without leaving Review page
- ✅ **Complete** - All editing in one place with full context
- ✅ **New Features** - Duration adjustment + Transcript editing
- ✅ **Modern UX** - Modal editing pattern (industry standard)
- ✅ **Efficient** - One click from clip selection to full editing

---

## Enhanced Modal Design

### Modal Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ [X Close]                    Edit Clip                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                                                              │   │
│  │                     VIDEO PREVIEW                            │   │
│  │                     9:16 Aspect Ratio                        │   │
│  │                   (with all overlays)                        │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────── Tab Navigation ────────────────────┐    │
│  │ [Duration] [Transcript] [Captions] [Logo] [Music] [Frame]  │    │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────── Tab Content ─────────────────────────┐  │
│  │                                                               │  │
│  │   (Tab-specific controls and options appear here)            │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  [Apply to All ▼]                        [Cancel]  [Save Changes]   │
└─────────────────────────────────────────────────────────────────────┘
```

### Modal Specifications

**Size:**
- Width: 90vw (max 1400px)
- Height: 90vh (max 900px)
- Centered on screen
- Dark overlay backdrop (semi-transparent)

**Layout:**
- Video preview: Top, centered, 9:16 aspect ratio
- Tab navigation: Below video
- Tab content: Below tabs, scrollable if needed
- Actions: Bottom right (Apply to All, Cancel, Save)

**Video Preview:**
- Shows real-time overlays for: captions, logo, frame adjustments
- Play/pause controls
- Seek bar
- Time display
- Responds to edits in real-time

---

## Tab 1: Duration (NEW FEATURE)

### Purpose
Allow users to adjust the start and end time of clips without re-running AI analysis.

### UI Design

```
┌─ Duration ─────────────────────────────────────────────────────────┐
│                                                                     │
│  Original Duration: 0:36 (2:44 - 3:20)                             │
│  New Duration:     [_____] (auto-calculated)                       │
│                                                                     │
│  Visual Timeline:                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                                                               │ │
│  │  ────────●═══════════════════●──────────                     │ │
│  │         2:44              3:20                                │ │
│  │                                                               │ │
│  │  Drag handles to adjust clip boundaries                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Surrounding Context:                                               │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ [Before] ...previous transcript text...                      │ │
│  │ ═══════════════════════════════════════                      │ │
│  │ [Clip] "AI is going to become the center..."                 │ │
│  │ ═══════════════════════════════════════                      │ │
│  │ [After] ...following transcript text...                      │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ☐ Snap to word boundaries                                         │
│  ☐ Show waveform (future enhancement)                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

1. **Visual Timeline**
   - Horizontal bar representing entire episode
   - Highlighted section showing current clip
   - Draggable handles at start/end
   - Minimum duration: 5 seconds
   - Maximum duration: 5 minutes

2. **Surrounding Context**
   - Shows transcript 30 seconds before clip
   - Shows transcript 30 seconds after clip
   - Helps user make informed trim decisions
   - Grayed out (non-editable)

3. **Constraints**
   - Cannot overlap with other approved clips (show warning)
   - Snap to word boundaries option (prevents cutting mid-word)
   - Update video preview in real-time as handles move

### Technical Implementation

**Database Impact:**
- Updates `clips.start_time`, `clips.end_time`, `clips.duration`
- Regenerate `clip_edits.caption_segments` if transcript changes

**IPC Handlers:**
```typescript
// New handlers needed
ipcMain.handle('update-clip-duration', (event, clipId, newStartTime, newEndTime))
ipcMain.handle('get-surrounding-transcript', (event, episodeId, startTime, endTime))
```

**Components:**
```typescript
<DurationEditor
  clipId={clipId}
  episodeId={episodeId}
  currentStart={clip.startTime}
  currentEnd={clip.endTime}
  onDurationChange={(newStart, newEnd) => {...}}
/>
```

---

## Tab 2: Transcript (NEW FEATURE)

### Purpose
Allow users to view and edit the transcript text before converting to captions. Fixes Whisper transcription errors.

### UI Design

```
┌─ Transcript ───────────────────────────────────────────────────────┐
│                                                                     │
│  Edit transcript text below. Changes will update caption text.     │
│                                                                     │
│  ┌────────────────── Transcript Segments ──────────────────────┐  │
│  │                                                               │  │
│  │  [0:00 - 0:03]                                                │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ Apple is a hardware company, but AI is going to      │    │  │
│  │  │ become the center of the universe.                   │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  │  [Edit] [Split] [Merge ▼] [Delete]                           │  │
│  │                                                               │  │
│  │  [0:03 - 0:07]                                                │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ The centerpiece of the renewed AI strategy is built   │    │  │
│  │  │ around AI as the center, moving away from the phone.  │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  │  [Edit] [Split] [Merge ▼] [Delete]                           │  │
│  │                                                               │  │
│  │  [0:07 - 0:10]                                                │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ A tabletop robot.                                     │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  │  [Edit] [Split] [Merge ▼] [Delete]                           │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  [+ Add Segment]                                                    │
│                                                                     │
│  💡 Tip: Click a segment to jump video to that timestamp           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

1. **Segment List**
   - Shows all transcript segments with timestamps
   - Each segment is editable textarea
   - Click segment to seek video to that time
   - Active segment highlights as video plays

2. **Editing Actions**
   - **Edit**: Click to make text editable inline
   - **Split**: Split segment at cursor position (creates two segments)
   - **Merge**: Merge with next segment
   - **Delete**: Remove segment entirely
   - **Add Segment**: Add new blank segment

3. **Auto-Save**
   - Saves on blur (when user clicks away)
   - Debounced save (500ms after typing stops)
   - Shows "Saving..." indicator

4. **Validation**
   - Warn if segment is empty
   - Prevent overlapping timestamps
   - Ensure segments cover full clip duration

### Technical Implementation

**Database Impact:**
- Creates/updates `clip_edits.caption_segments` (JSON)
- Preserves timing, only edits text

**Data Structure:**
```typescript
interface TranscriptSegment {
  id: string           // Unique ID
  start: number        // Clip-relative seconds
  end: number          // Clip-relative seconds
  text: string         // Editable transcript text
  originalText: string // For reference (track changes)
}
```

**Components:**
```typescript
<TranscriptEditor
  clipId={clipId}
  segments={segments}
  onSegmentEdit={(segmentId, newText) => {...}}
  onSegmentSplit={(segmentId, splitTime) => {...}}
  onSegmentMerge={(segmentId1, segmentId2) => {...}}
  onSegmentDelete={(segmentId) => {...}}
/>
```

---

## Tab 3: Captions (REFACTORED)

### Purpose
Style captions using edited transcript text from Tab 2.

### Changes from Original Design

**What Stays the Same:**
- Font selection
- Size, color, position controls
- Bold, italic, outline, shadow options
- Background options
- Real-time preview on video

**What Changes:**
- **Caption text** now sourced from Transcript tab (read-only)
- **No inline editing** of caption text in this tab
- Focus purely on **styling** (not content)
- Layout optimized for modal context

### UI Design

```
┌─ Captions ─────────────────────────────────────────────────────────┐
│                                                                     │
│  ☑ Enable Captions                                                 │
│                                                                     │
│  Style Settings:                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ Font:    [Inter ▼]           Size: [48px ────●──── 72px]    │ │
│  │ Color:   [⬜ #FFFFFF]        Position: [Top/Center/●Bottom]  │ │
│  │                                                               │ │
│  │ Text Style:                                                   │ │
│  │ [☑ Bold] [☐ Italic] [☑ Outline] [☐ Shadow] [☐ Background]  │ │
│  │                                                               │ │
│  │ Outline Color: [⬛ #000000]   Width: [2px ──●── 8px]        │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Highlight Style:                                                   │
│  [●Word-by-word] [○Full sentence] [○No highlight]                  │
│                                                                     │
│  Caption Preview:                                                   │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ "Apple is a hardware company, but AI is going to become..."  │ │
│  │ (Live preview with selected styling)                          │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  💡 Tip: Edit caption text in the Transcript tab                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Technical Implementation

**Reuse Existing:**
- CaptionEditor component (refactor slightly)
- Video overlay rendering
- Database save/load for styling

**Remove:**
- Inline text editing in captions
- Segment list in captions tab

**Components:**
```typescript
<CaptionStyleEditor
  clipId={clipId}
  segments={transcriptSegments}  // From Transcript tab
  onStyleChange={(style) => {...}}
/>
```

---

## Tab 4: Logo

### Purpose
Add logo or watermark overlay to video.

### UI Design

```
┌─ Logo & Watermark ─────────────────────────────────────────────────┐
│                                                                     │
│  ☑ Enable Logo                                                     │
│                                                                     │
│  Logo File:                                                         │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [Current: logo.png]                         [Choose File...] │ │
│  │  or drag & drop image here                                    │ │
│  │  (PNG, SVG, JPG - max 2MB)                                    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Position:                                                          │
│  ┌─────────────────────────┐                                       │
│  │  [TL] [TC] [TR]         │   Custom:                             │
│  │  [ML] [MC] [MR]         │   X: [10%]  Y: [10%]                 │
│  │  [BL] [BC] [●BR]        │                                       │
│  └─────────────────────────┘                                       │
│                                                                     │
│  Size: [10% ────────●──────── 30% of video width]                 │
│                                                                     │
│  Opacity: [0% ───────────────●─ 100%]                              │
│                                                                     │
│  Preview:                                                           │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  (Logo preview with current position/size/opacity)            │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

1. **File Upload**
   - Browse button
   - Drag & drop support
   - Supported formats: PNG, SVG, JPG, WebP
   - Max size: 2MB
   - Store in: `~/Library/Application Support/ariadne/logos/`

2. **Positioning**
   - 9 preset positions (TL, TC, TR, ML, MC, MR, BL, BC, BR)
   - Custom X/Y percentage inputs
   - Drag on video preview (future enhancement)

3. **Styling**
   - Size slider (% of video width)
   - Opacity slider (0-100%)

4. **Preview**
   - Real-time overlay on video preview
   - Shows logo at selected position/size/opacity

### Technical Implementation

**Database Fields:**
```typescript
logo_enabled: INTEGER
logo_path: TEXT
logo_position: TEXT  // JSON: {preset: 'BR'} or {x: 10, y: 10}
logo_scale: REAL     // 0.1 to 0.3
logo_opacity: REAL   // 0 to 1
```

**IPC Handlers:**
```typescript
ipcMain.handle('upload-logo', (event, filePath) => {...})
ipcMain.handle('list-logos', () => {...})  // List previously uploaded logos
```

---

## Tab 5: Music

### Purpose
Add background music with auto-ducking during speech.

### UI Design

```
┌─ Background Music ─────────────────────────────────────────────────┐
│                                                                     │
│  ☑ Enable Background Music                                         │
│                                                                     │
│  Audio File:                                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [Current: background-music.mp3]             [Choose File...] │ │
│  │  or drag & drop audio here                                    │ │
│  │  (MP3, WAV, M4A - max 10MB)                                   │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Volume Settings:                                                   │
│  Base Volume: [0% ────●──────── 100%]                              │
│                                                                     │
│  ☑ Duck During Speech                                              │
│  Duck Volume: [0% ──●────────── 50%]                               │
│  (Music volume when speech is detected)                            │
│                                                                     │
│  Fade Effects:                                                      │
│  Fade In:  [0s ──●────── 5s]                                       │
│  Fade Out: [0s ──●────── 5s]                                       │
│                                                                     │
│  ☑ Loop if clip is longer than audio                               │
│                                                                     │
│  Audio Waveform: (Future Enhancement)                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │  [Waveform visualization]                                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

1. **File Upload**
   - Browse button
   - Drag & drop support
   - Supported formats: MP3, WAV, M4A
   - Max size: 10MB
   - Store in: `~/Library/Application Support/ariadne/music/`

2. **Volume Controls**
   - Base volume: Normal music volume
   - Duck volume: Volume during speech (lower)
   - Toggle for ducking on/off

3. **Fade Effects**
   - Fade in duration (0-5 seconds)
   - Fade out duration (0-5 seconds)

4. **Looping**
   - Option to loop audio if clip is longer than music

### Technical Implementation

**Database Fields:**
```typescript
music_enabled: INTEGER
music_path: TEXT
music_volume: REAL        // 0 to 1
music_duck_volume: REAL   // 0 to 0.5
music_fade_in: REAL       // seconds
music_fade_out: REAL      // seconds
```

**Ducking Logic:**
```typescript
// During export, use transcript timing to determine when speech occurs
// Apply volume reduction to music during speech segments
// Smooth transitions (100ms ramps) between duck/normal volume
```

---

## Tab 6: Frame

### Purpose
Configure aspect ratio and video cropping/scaling behavior.

### UI Design

```
┌─ Aspect Ratio & Framing ───────────────────────────────────────────┐
│                                                                     │
│  Aspect Ratio:                                                      │
│  [  1:1  ] [●9:16] [16:9]                                           │
│                                                                     │
│  Crop Mode:                                                         │
│                                                                     │
│  [●] Center Crop                                                    │
│      Crop video to fill frame (may cut edges)                      │
│      ┌──────┐                                                       │
│      │ ████ │ ← Video fills entire frame                           │
│      │ ████ │    (sides may be cut off)                            │
│      └──────┘                                                       │
│                                                                     │
│  [ ] Scale to Fit                                                   │
│      Show entire video (may have black bars)                       │
│      ┌──────┐                                                       │
│      │      │ ← Video fits within frame                            │
│      │ ▓▓▓▓ │    (bars on top/bottom)                              │
│      │      │                                                       │
│      └──────┘                                                       │
│                                                                     │
│  [ ] Blur Background                                                │
│      Fill empty space with blurred video                           │
│      ┌──────┐                                                       │
│      │░████░│ ← Blurred video behind                               │
│      │░████░│    (no black bars)                                   │
│      └──────┘                                                       │
│                                                                     │
│  Preview updates in real-time above                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Features

1. **Aspect Ratio Selection**
   - 1:1 (Instagram post)
   - 9:16 (TikTok, Instagram Reels, YouTube Shorts)
   - 16:9 (YouTube landscape)

2. **Crop Modes**
   - **Center Crop**: Scale and crop to fill frame (may cut edges)
   - **Scale to Fit**: Letterbox/pillarbox to show entire video
   - **Blur Background**: Fill empty space with blurred version of video

3. **Preview**
   - Video preview updates to show exact framing
   - Shows how video will look in export

### Technical Implementation

**Database Fields:**
```typescript
aspect_ratio: TEXT   // '9:16', '1:1', '16:9'
crop_mode: TEXT      // 'center', 'fit', 'blur'
```

**FFmpeg Implementation:**
- Center crop: `crop=ih*9/16:ih`
- Scale to fit: `scale + pad`
- Blur background: `split, boxblur, overlay`

---

## Modal Actions

### Save Button

**Behavior:**
1. Validates all tab settings
2. Saves to `clip_edits` table
3. Updates clip duration if changed (Tab 1)
4. Saves transcript edits if changed (Tab 2)
5. Closes modal
6. Refreshes Review page clip preview

**Validation:**
- Ensure Duration min/max constraints
- Ensure Transcript segments cover full clip
- Ensure file uploads succeeded (logo, music)

### Cancel Button

**Behavior:**
1. Discard all unsaved changes
2. Confirm if user has unsaved changes
3. Close modal
4. Return to Review page

### Apply to All Button

**Dropdown Menu:**
- [ ] Caption Style (font, size, color, position, etc.)
- [ ] Logo Settings (position, size, opacity)
- [ ] Music Settings (file, volumes, fade)
- [ ] Frame Settings (aspect ratio, crop mode)
- [x] All Settings

**Behavior:**
1. Shows dropdown to select which settings to apply
2. Applies selected settings to all approved clips
3. **Excludes:** Duration, Transcript text (clip-specific)
4. Shows progress indicator
5. Confirms completion

---

## Database Schema

### No Changes Required

The existing `clip_edits` table supports all features:

```sql
CREATE TABLE clip_edits (
  clip_id TEXT PRIMARY KEY,

  -- Captions (Tab 3)
  captions_enabled INTEGER DEFAULT 1,
  caption_segments TEXT NOT NULL,  -- JSON from Transcript tab
  caption_font TEXT DEFAULT 'Inter',
  caption_size INTEGER DEFAULT 48,
  caption_color TEXT DEFAULT '#FFFFFF',
  caption_position TEXT DEFAULT 'bottom',
  caption_bold INTEGER DEFAULT 1,
  caption_italic INTEGER DEFAULT 0,
  caption_outline INTEGER DEFAULT 1,
  caption_outline_color TEXT DEFAULT '#000000',
  caption_outline_width INTEGER DEFAULT 2,
  caption_shadow INTEGER DEFAULT 0,
  caption_highlight_style TEXT DEFAULT 'word',
  caption_background INTEGER DEFAULT 0,
  caption_background_color TEXT DEFAULT '#000000',
  caption_background_opacity REAL DEFAULT 0.5,

  -- Logo (Tab 4)
  logo_enabled INTEGER DEFAULT 0,
  logo_path TEXT,
  logo_position TEXT DEFAULT 'bottom-right',
  logo_scale REAL DEFAULT 0.15,
  logo_opacity REAL DEFAULT 0.8,

  -- Music (Tab 5)
  music_enabled INTEGER DEFAULT 0,
  music_path TEXT,
  music_volume REAL DEFAULT 0.3,
  music_duck_volume REAL DEFAULT 0.1,
  music_fade_in REAL DEFAULT 1.0,
  music_fade_out REAL DEFAULT 1.0,

  -- Frame (Tab 6)
  aspect_ratio TEXT DEFAULT '9:16',
  crop_mode TEXT DEFAULT 'center',

  updated_at TEXT NOT NULL,

  FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
)
```

**Duration changes** update `clips` table directly:
```sql
UPDATE clips SET start_time = ?, end_time = ?, duration = ? WHERE id = ?
```

**Transcript edits** stored in `clip_edits.caption_segments`:
```json
[
  {
    "start": 0.0,
    "end": 3.2,
    "text": "Apple is a hardware company...",
    "originalText": "Apple is an hardware company..."
  }
]
```

---

## IPC Handlers

### New Handlers Required

```typescript
// Duration Tab
ipcMain.handle('update-clip-duration', async (event, clipId, newStartTime, newEndTime) => {
  // Update clips table
  // Invalidate extracted clip file
  // Return updated clip object
})

ipcMain.handle('get-surrounding-transcript', async (event, episodeId, startTime, endTime, bufferSeconds = 30) => {
  // Query transcript_segments
  // Return segments before/after specified range
})

// Transcript Tab
// Uses existing: getClipTranscriptSegments, saveClipEdits

// Logo Tab
ipcMain.handle('upload-logo', async (event, sourcePath) => {
  // Copy to logos directory
  // Return new path
})

ipcMain.handle('list-logos', async () => {
  // List all logos in logos directory
})

// Music Tab
ipcMain.handle('upload-music', async (event, sourcePath) => {
  // Copy to music directory
  // Return new path
})

ipcMain.handle('list-music', async () => {
  // List all music in music directory
})
```

---

## Component Architecture

### File Structure

```
src/renderer/src/
├── components/
│   ├── ClipEditModal.tsx          (NEW - Main modal container)
│   ├── DurationEditor.tsx          (NEW - Tab 1)
│   ├── TranscriptEditor.tsx        (NEW - Tab 2)
│   ├── CaptionStyleEditor.tsx      (REFACTOR - Tab 3)
│   ├── LogoEditor.tsx              (NEW - Tab 4)
│   ├── MusicEditor.tsx             (NEW - Tab 5)
│   ├── FrameEditor.tsx             (NEW - Tab 6)
│   └── CaptionEditor.tsx           (EXISTING - Partial reuse)
└── pages/
    ├── ReviewPage.tsx              (UPDATE - Add modal)
    └── EditorPage.tsx              (DELETE - No longer needed)
```

### Component Props

```typescript
// Main Modal
interface ClipEditModalProps {
  isOpen: boolean
  clipId: string
  episodeId: string
  onClose: () => void
  onSave: (edits: ClipEdits) => void
}

// Duration Editor
interface DurationEditorProps {
  clipId: string
  episodeId: string
  currentStart: number
  currentEnd: number
  onDurationChange: (newStart: number, newEnd: number) => void
}

// Transcript Editor
interface TranscriptEditorProps {
  clipId: string
  segments: TranscriptSegment[]
  onSegmentChange: (segments: TranscriptSegment[]) => void
}

// Caption Style Editor
interface CaptionStyleEditorProps {
  clipId: string
  transcriptSegments: TranscriptSegment[]
  currentStyle: CaptionStyle
  onStyleChange: (style: CaptionStyle) => void
}

// Logo Editor
interface LogoEditorProps {
  clipId: string
  currentSettings: LogoSettings
  onSettingsChange: (settings: LogoSettings) => void
}

// Music Editor
interface MusicEditorProps {
  clipId: string
  currentSettings: MusicSettings
  onSettingsChange: (settings: MusicSettings) => void
}

// Frame Editor
interface FrameEditorProps {
  clipId: string
  currentSettings: FrameSettings
  onSettingsChange: (settings: FrameSettings) => void
}
```

---

## Review Page Integration

### Changes to ReviewPage.tsx

**Add Modal State:**
```typescript
const [editingClipId, setEditingClipId] = useState<string | null>(null)
const [isModalOpen, setIsModalOpen] = useState(false)

const handleClipClick = (clip: Clip) => {
  setEditingClipId(clip.id)
  setIsModalOpen(true)
}

const handleModalClose = () => {
  setIsModalOpen(false)
  setEditingClipId(null)
  // Refresh clips to show updated status
  loadClips()
}
```

**Add Modal Render:**
```tsx
{isModalOpen && editingClipId && (
  <ClipEditModal
    isOpen={isModalOpen}
    clipId={editingClipId}
    episodeId={episodeId}
    onClose={handleModalClose}
    onSave={handleClipSave}
  />
)}
```

**Remove:**
- Navigation to Content/Editor page
- "Edit Clip" button (click card directly)

---

## Migration from ContentPage

### What to Remove

1. **Files to Delete:**
   - `src/renderer/src/pages/EditorPage.tsx` (formerly ContentPage.tsx)
   - Route definition in router
   - Navigation links to editor

2. **Remove from Navigation:**
   - Editor screen navigation
   - Editor screen keyboard shortcut

### What to Reuse

1. **Components:**
   - CaptionEditor logic (refactor into tabs)
   - Video player component
   - Style control components

2. **Database Logic:**
   - All IPC handlers
   - clip_edits CRUD operations

3. **State Management:**
   - Video playback state
   - Settings state
   - Save/load logic

---

## User Flow Walkthrough

### Complete Editing Flow

1. **User on Review Page**
   - Sees grid of all clips
   - Each clip shows thumbnail, quote, score

2. **User Clicks Clip**
   - Modal opens (large, centered)
   - Video preview at top (paused)
   - Duration tab selected by default

3. **User Adjusts Duration (Tab 1)**
   - Drags timeline handles
   - Sees surrounding transcript context
   - Confirms new boundaries

4. **User Edits Transcript (Tab 2)**
   - Fixes typos in transcript text
   - Splits/merges segments as needed
   - Text auto-saves

5. **User Styles Captions (Tab 3)**
   - Selects font, size, color
   - Enables outline, shadow
   - Sees real-time preview on video

6. **User Adds Logo (Tab 4)**
   - Uploads logo image
   - Positions in bottom-right
   - Adjusts size and opacity

7. **User Adds Music (Tab 5)**
   - Uploads background music
   - Sets volume levels
   - Enables auto-ducking

8. **User Sets Frame (Tab 6)**
   - Selects 9:16 aspect ratio
   - Chooses center crop mode
   - Sees video framing update

9. **User Saves**
   - Clicks "Save Changes"
   - Modal closes
   - Returns to Review grid
   - Clip shows green checkmark (edited)

10. **User Repeats for Other Clips**
    - Can use "Apply to All" for consistent styling
    - Each clip can have unique Duration/Transcript

11. **User Proceeds to Export**
    - Navigates to Export page
    - Selects clips to export
    - Starts batch export

---

## Benefits vs Original Design

### Comparison Table

| Aspect | Original Design | New Modal Design |
|--------|----------------|------------------|
| **Screens** | 5 (Upload, Review, Content, Export, Library) | 4 (Upload, Review, Export, Library) |
| **Editing Location** | Separate Content screen | Modal within Review |
| **Context Switching** | Required (Review → Content → Export) | None (stay in Review) |
| **Clip Selection** | Click → Navigate → Edit | Click → Edit |
| **Duration Adjustment** | ❌ Not available | ✅ Visual timeline editor |
| **Transcript Editing** | ❌ Not available | ✅ Full text editor |
| **Caption Editing** | ✅ Full featured | ✅ Simplified (styling only) |
| **Video Preview** | ✅ Always visible | ✅ Always visible |
| **Apply to All** | ✅ Available | ✅ Available (enhanced) |
| **Save Flow** | Auto-save | Explicit Save button |
| **UX Pattern** | Multi-screen workflow | Modal editing (modern) |

### Key Advantages

1. **Streamlined UX**
   - 1 fewer screen to maintain
   - Reduced navigation complexity
   - Faster iteration on clips

2. **New Capabilities**
   - Duration adjustment (critical missing feature)
   - Transcript editing (fixes AI errors)
   - Better context preservation

3. **Modern Pattern**
   - Modal editing is industry standard (Instagram, TikTok, YouTube Studio)
   - Feels more responsive
   - Less page loading

4. **Development Efficiency**
   - Reuse 80% of existing code
   - Simpler routing
   - Easier to test

---

## Implementation Timeline

### Phase Breakdown

#### Phase 0: Foundation (2-3 hours)
- Create ClipEditModal component structure
- Add tab navigation
- Integrate modal into ReviewPage
- Remove EditorPage and routes

#### Phase 1: Duration Tab (3-4 hours)
- Build visual timeline component
- Add draggable handles
- Implement surrounding transcript fetch
- Wire up duration updates

#### Phase 2: Transcript Tab (2-3 hours)
- Build segment list UI
- Add inline editing
- Implement split/merge/delete
- Add auto-save

#### Phase 3: Captions Tab (3-4 hours)
- Refactor CaptionEditor for modal
- Remove inline text editing
- Source from Transcript tab
- Fix visibility issues

#### Phase 4: Logo Tab (2-3 hours)
- Build file upload UI
- Add positioning controls
- Implement preview overlay
- Wire up save

#### Phase 5: Music Tab (2-3 hours)
- Build file upload UI
- Add volume controls
- Implement ducking toggle
- Wire up save

#### Phase 6: Frame Tab (2-3 hours)
- Build aspect ratio selector
- Add crop mode selector
- Update preview framing
- Wire up save

#### Phase 7: Integration (2-3 hours)
- Implement Save button logic
- Add Apply to All functionality
- Add validation
- Error handling

#### Phase 8: Export Service (5-6 hours)
- FFmpeg caption burn-in
- FFmpeg logo overlay
- FFmpeg audio mixing
- FFmpeg aspect ratio conversion
- Filter chain builder

#### Phase 9: Testing (2-3 hours)
- End-to-end workflow testing
- Performance testing
- Bug fixes

**Total Estimated Time:** 26-34 hours (3-4 full development days)

---

## Open Questions for Discussion

1. **Modal Behavior**
   - Should modal be dismissible by clicking backdrop? [The modal should retain the 'X' to close'']
   - Should we warn user about unsaved changes? [Yes we should]
   - Should tabs auto-save or require explicit Save? [We can do both]

2. **Duration Tab**
   - Should we show waveform visualization? (nice-to-have) [Not required for now]
   - Should we allow overlapping clips or enforce gaps? [We can allow it]
   - Should we snap to word boundaries by default? [Yes, but sometimes this can sound abrupt because it cuts off suddenly]

3. **Transcript Tab**
   - Should we show word-level timing or just segment timing? [Unsure]
   - Should we allow adding custom segments? [It should just be the transcript from the clip - if we extend or reduce the clip duration then the transcript needs to adjust accordingly]
   - Should we highlight grammar/spell errors? [We can, and then we can edit it manually]

4. **Performance**
   - Should we preload all tab data or lazy load? [Whatever is optimal]
   - Should we debounce preview updates? [Unsure]
   - Should we cache uploaded logos/music? [We can do if its optimal - perhaps it can be linked to the project]

5. **Apply to All**
   - Should we allow selective Apply to Some? [Not for now]
   - Should we show preview of what will change? [All edits should appear in the clip previous - we should have this on the right side of the screen in the modal]
   - Should we allow undo? [Undo/Redo]

---

## Success Metrics

### User Experience
- ⏱️ **Time to Edit** - Under 2 minutes per clip
- 🎯 **Task Completion** - 95%+ save rate (not abandoning modal)
- 😊 **User Satisfaction** - Positive feedback on modal flow

### Technical Performance
- 🚀 **Modal Load** - Opens in < 500ms
- 💾 **Save Speed** - Saves in < 1 second
- 🎬 **Preview Update** - Real-time (< 100ms lag)

### Feature Adoption
- ✂️ **Duration Edit** - 60%+ of clips adjusted
- ✍️ **Transcript Edit** - 40%+ of clips edited
- 🎨 **Caption Style** - 90%+ enable captions
- 🏷️ **Logo** - 70%+ add logo
- 🎵 **Music** - 50%+ add music

---

## Risk Assessment

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Modal state management complexity | Medium | Use React context or Zustand |
| Video preview performance in modal | Medium | Lazy load, debounce updates |
| Duration adjustment invalidating extracts | High | Clear clip cache on duration change |
| Transcript edits breaking caption sync | High | Validate timing on save |

### UX Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Modal too complex (6 tabs) | Medium | Clear tab labels, tooltips |
| Users forgetting to save | High | Prompt on close, show unsaved indicator |
| Apply to All confusion | Low | Clear confirmation dialog |
| Duration adjustment breaking clips | Medium | Show validation warnings |

---

## Rollout Plan

### Development Stages

1. **Alpha (Internal)**
   - Build Duration + Transcript tabs
   - Test with sample clips
   - Validate database operations

2. **Beta (Internal)**
   - Complete all 6 tabs
   - Full integration testing
   - Performance optimization

3. **Release Candidate**
   - Remove EditorPage
   - Complete migration
   - User documentation

4. **Production Release**
   - Deploy with feature flag (optional)
   - Monitor for issues
   - Gather feedback

### Rollback Strategy

If issues arise:
1. **Quick Fix**: Patch specific tab
2. **Partial Rollback**: Disable problematic tab
3. **Full Rollback**: Re-enable EditorPage, hide modal

---

## Future Enhancements

### Post-MVP Features

1. **Duration Tab**
   - Waveform visualization
   - Multi-select for bulk duration adjust
   - Undo/redo for duration changes

2. **Transcript Tab**
   - Spell check integration
   - Speaker labels
   - Auto-capitalization

3. **Captions Tab**
   - Caption animations (fade, slide, pop)
   - Multiple caption styles per clip
   - Caption templates

4. **Logo Tab**
   - Drag-and-drop positioning on preview
   - Logo animations (fade, slide)
   - Multiple logos per clip

5. **Music Tab**
   - Audio waveform visualization
   - Beat detection for sync
   - Built-in music library

6. **Frame Tab**
   - Custom aspect ratios
   - Manual crop adjustment (drag corners)
   - Ken Burns effect (pan/zoom)

7. **General**
   - Keyboard shortcuts for tabs
   - Template presets (save all settings)
   - Undo/redo across all tabs
   - Compare before/after

---

## Conclusion

This modal-based editing approach is **strongly recommended** over the original separate Content screen design because:

1. **Superior UX** - Reduces friction, keeps users in flow
2. **Feature Complete** - Adds critical missing features (Duration, Transcript)
3. **Modern Pattern** - Aligns with industry standards
4. **Efficient Development** - Similar effort, better outcome
5. **Scalable Architecture** - Easy to add future tab enhancements

The investment in restructuring pays dividends in:
- User satisfaction
- Workflow efficiency
- Feature completeness
- Long-term maintainability

**Recommendation: PROCEED WITH MODAL DESIGN**

---

## Appendix A: Technical Specifications

### Video Preview Container

```typescript
interface VideoPreviewProps {
  clipPath: string
  aspectRatio: '9:16' | '1:1' | '16:9'
  overlays: {
    captions?: CaptionOverlay
    logo?: LogoOverlay
    frame?: FrameSettings
  }
  onTimeUpdate: (currentTime: number) => void
}
```

### Modal State Management

```typescript
interface ModalState {
  activeTab: 'duration' | 'transcript' | 'captions' | 'logo' | 'music' | 'frame'
  hasUnsavedChanges: boolean

  // Tab data
  duration: DurationSettings
  transcript: TranscriptSegment[]
  captions: CaptionStyle
  logo: LogoSettings
  music: MusicSettings
  frame: FrameSettings
}
```

### Save Payload

```typescript
interface ClipSavePayload {
  // Update clips table
  clipUpdates?: {
    start_time?: number
    end_time?: number
    duration?: number
  }

  // Update clip_edits table
  edits: {
    // All tab settings
    ...captionSettings,
    ...logoSettings,
    ...musicSettings,
    ...frameSettings,
    updated_at: string
  }
}
```

---

## Appendix B: Comparison Screenshots (Mockups)

### Before (Original Design)

```
Review Page → Clip Grid
              ↓ (click clip)
         Clip Preview Modal (basic info only)
              ↓ (navigate to Content)
         Content Page → Full Editor
              ↓ (save and navigate)
         Export Page
```

### After (New Design)

```
Review Page → Clip Grid
              ↓ (click clip)
         Enhanced Modal with 6 Tabs
         [Duration | Transcript | Captions | Logo | Music | Frame]
              ↓ (save, stay in Review)
         Review Page (clip marked as edited)
              ↓ (when ready)
         Export Page
```

---

**END OF DOCUMENT**
