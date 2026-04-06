# Editor Screen Implementation Plan

## Overview

The Editor Screen (formerly Content Page) is a lightweight video editing interface positioned between the Review and Export screens. It provides essential editing capabilities to prepare approved clips for export without requiring external tools like CapCut.

**Position in Workflow:**
```
Upload → Review → Edit → Export
                   ↑
            This screen
```

---

## Purpose & Goals

### Primary Goal
Transform approved clips into export-ready reels by adding:
- Professional captions with custom styling
- Logo/watermark overlays
- Background music mixing
- Proper aspect ratio framing

### Success Criteria
- Eliminate need for external video editing tools
- Provide live preview of all edits
- Export-ready clips with all overlays baked in
- Settings reusable across multiple clips

---

## Core Features

### 1. Captions System

**Requirements:**
- ✅ Generate captions from existing Whisper transcript
- ✅ **Editable text** - Allow manual correction of transcript errors
- ✅ Word-level timing extraction
- ✅ Customizable styling (font, size, color, weight)
- ✅ Position control (top/middle/bottom)
- ✅ Style options (bold, italic, outline, shadow)
- ✅ Highlight modes:
  - Word-by-word (TikTok style)
  - Full sentence display
  - No highlight
- ✅ Live preview synchronized with video playback

**Caption Editor Features:**
- Inline text editing for each caption segment
- Timestamp adjustment (start/end times)
- Add/remove/split caption segments
- Spell check and formatting tools

**Technical Approach:**
```typescript
interface CaptionSegment {
  start: number        // seconds
  end: number         // seconds
  text: string        // Editable transcript text
  words?: Array<{     // Optional word-level timing
    word: string
    start: number
    end: number
  }>
}
```

**Data Source:**
- Extract from `transcript_segments` table for clip's time range
- Generate word-level timing if not available
- Store edited captions in `clip_edits` table

---

### 2. Logo/Watermark Overlay

**Requirements:**
- ✅ Upload logo from local storage
- ✅ Store in app data directory for reuse
- ✅ Position controls:
  - Drag-and-drop on preview
  - Preset positions (corners, center)
  - Custom coordinates (x, y)
- ✅ Size/scale slider (% of video width)
- ✅ Opacity control (0-100%)
- ✅ Live preview

**Storage:**
- Save uploaded logos to: `~/Library/Application Support/ariadne/logos/`
- Store relative path in database
- Reuse across projects

---

### 3. Background Music

**Requirements:**
- ✅ Upload audio file (MP3, WAV, M4A)
- ✅ Volume controls:
  - Base volume (0-100%)
  - Duck volume during speech (auto-reduce)
- ✅ Fade in/out options
- ✅ Loop for clips longer than music
- ✅ Audio waveform visualization (optional)

**Ducking Logic:**
```
When speech is detected (from transcript):
  music_volume = duck_volume (e.g., 10%)
When no speech:
  music_volume = base_volume (e.g., 30%)
```

---

### 4. Aspect Ratio & Framing

**Problem to Solve:**
Current export creates 9:16 canvas but doesn't resize/crop video to fill it. Video appears letterboxed.

**Requirements:**
- ✅ Aspect ratio selection: 9:16, 1:1, 16:9
- ✅ Crop modes:
  - **Center Crop** - Crop video to fill frame (may cut off edges)
  - **Scale to Fit** - Letterbox/pillarbox to fit entire video
  - **Blur Background** - Fill with blurred version of video
- ✅ Live preview showing exact framing
- ✅ Apply to all clips option

**Visual Example:**
```
Original: 16:9 video → Target: 9:16

Center Crop:        Scale to Fit:     Blur Background:
┌────────┐         ┌────────┐         ┌────────┐
│ ████   │         │        │         │▓▓████▓▓│
│ ████   │ (crop)  │  ████  │ (bars)  │▓▓████▓▓│ (blur edges)
│ ████   │         │        │         │▓▓████▓▓│
└────────┘         └────────┘         └────────┘
```

---

### 5. Apply to All

**Scope:**
Works for:
- ✅ Logo settings (position, size, opacity)
- ✅ Background music (file, volumes)
- ✅ Caption style (font, size, color, position, styling)
- ✅ Aspect ratio settings (ratio, crop mode)

Does NOT work for:
- ❌ Caption text (clip-specific)
- ❌ Caption timing (clip-specific)

**UI:**
```
[Apply to All ▼]
  ├─ Caption Style
  ├─ Logo Settings
  ├─ Music Settings
  ├─ Frame Settings
  └─ All Settings
```

---

## Database Schema

### New Table: `clip_edits`

```sql
CREATE TABLE clip_edits (
  clip_id TEXT PRIMARY KEY,

  -- Captions
  captions_enabled INTEGER DEFAULT 1,
  caption_segments TEXT NOT NULL,  -- JSON: [{start, end, text, words?}]
  caption_font TEXT DEFAULT 'Inter',
  caption_size INTEGER DEFAULT 48,
  caption_color TEXT DEFAULT '#FFFFFF',
  caption_position TEXT DEFAULT 'bottom',  -- top, middle, bottom
  caption_bold INTEGER DEFAULT 1,
  caption_italic INTEGER DEFAULT 0,
  caption_outline INTEGER DEFAULT 1,
  caption_outline_color TEXT DEFAULT '#000000',
  caption_outline_width INTEGER DEFAULT 2,
  caption_shadow INTEGER DEFAULT 0,
  caption_highlight_style TEXT DEFAULT 'word',  -- word, sentence, none
  caption_background INTEGER DEFAULT 0,
  caption_background_color TEXT DEFAULT '#000000',
  caption_background_opacity REAL DEFAULT 0.5,

  -- Logo/Watermark
  logo_enabled INTEGER DEFAULT 0,
  logo_path TEXT,
  logo_position TEXT DEFAULT 'bottom-right',  -- JSON: {x, y} or preset
  logo_scale REAL DEFAULT 0.15,  -- % of video width
  logo_opacity REAL DEFAULT 0.8,

  -- Background Music
  music_enabled INTEGER DEFAULT 0,
  music_path TEXT,
  music_volume REAL DEFAULT 0.3,
  music_duck_volume REAL DEFAULT 0.1,  -- Volume during speech
  music_fade_in REAL DEFAULT 1.0,      -- Seconds
  music_fade_out REAL DEFAULT 1.0,     -- Seconds

  -- Aspect Ratio & Framing
  aspect_ratio TEXT DEFAULT '9:16',    -- 9:16, 1:1, 16:9
  crop_mode TEXT DEFAULT 'center',     -- center, fit, blur

  -- Metadata
  updated_at TEXT NOT NULL,

  FOREIGN KEY (clip_id) REFERENCES clips (id) ON DELETE CASCADE
)
```

### Schema Changes to Existing Tables

**Add to clips table:**
```sql
ALTER TABLE clips ADD COLUMN has_edits INTEGER DEFAULT 0;
```

---

## UI Design

### Layout Structure

```
┌──────────────────────────────────────────────────────────────────┐
│  Edit Clips (3 of 5 completed)     [Apply to All ▼] [Export All >] │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────┐  ┌────────────────────────────────────────────┐   │
│  │          │  │                                             │   │
│  │  Clips   │  │         Video Preview Area                  │   │
│  │  List    │  │                                             │   │
│  │          │  │    ┌─────────────────────┐                 │   │
│  │ ┌──────┐ │  │    │ [Logo]              │                 │   │
│  │ │Clip 1│✓│  │    │                     │                 │   │
│  │ └──────┘ │  │    │   VIDEO PLAYER      │                 │   │
│  │ ┌──────┐ │  │    │   + HTML Overlays   │                 │   │
│  │ │Clip 2│ │  │    │                     │                 │   │
│  │ └──────┘ │  │    │ "Caption text here" │                 │   │
│  │ ┌──────┐ │  │    └─────────────────────┘                 │   │
│  │ │Clip 3│ │  │                                             │   │
│  │ └──────┘ │  │    [████████████░░░] 0:15 / 0:45          │   │
│  │          │  │                                             │   │
│  └──────────┘  ├─────────────────────────────────────────────┤   │
│                │ [Captions] [Logo] [Music] [Frame]          │   │
│                │                                             │   │
│                │ ┌─ Captions Tab ──────────────────────────┐│   │
│                │ │ ☑ Enable Captions                       ││   │
│                │ │                                          ││   │
│                │ │ Caption Segments (Click to edit):       ││   │
│                │ │ ┌─────────────────────────────────────┐ ││   │
│                │ │ │ 0:00-0:03  "Apple is a hardware..." │ ││   │
│                │ │ │ 0:03-0:07  "The centerpiece of..."  │ ││   │
│                │ │ │ 0:07-0:10  "...renewed AI strategy"│ ││   │
│                │ │ └─────────────────────────────────────┘ ││   │
│                │ │                                          ││   │
│                │ │ Style Settings:                         ││   │
│                │ │ Font: [Inter ▼]  Size: [48 ─●─── 72]   ││   │
│                │ │ Color: [⬜ #FFF]  Outline: [⬛ #000]    ││   │
│                │ │ Position: [ Top ] [Middle] [●Bottom]    ││   │
│                │ │ Style: [☑Bold] [☐Italic] [☑Outline]    ││   │
│                │ │ Highlight: [●Word] [○Sentence] [○None] ││   │
│                │ └──────────────────────────────────────────┘│   │
│                │                                             │   │
│                └─────────────────────────────────────────────┘   │
│                                                                   │
│              [◀ Previous]  Clip 1 of 5  [Next ▶]                │
└──────────────────────────────────────────────────────────────────┘
```

### Clip List Sidebar

**Card Design:**
```
┌─────────────────────┐
│ INSIGHT      [✓]    │ ← Completion badge
├─────────────────────┤
│ "Apple is a         │
│  hardware..."       │ ← Quote preview
├─────────────────────┤
│ 0:25 • 9★           │ ← Duration & score
└─────────────────────┘
```

**States:**
- ✓ Green badge = has edits
- No badge = needs editing
- Ring highlight = selected

---

## Tab Interfaces

### Captions Tab

**Caption Segment Editor:**
```
┌─ Caption Segments ─────────────────────────────────────┐
│ ┌───────────────────────────────────────────────────┐ │
│ │ ⏱ 0:00 - 0:03                       [Edit] [×]   │ │
│ │ "Apple is a hardware company..."                  │ │
│ │                                                    │ │
│ │ ⏱ 0:03 - 0:07                       [Edit] [×]   │ │
│ │ "The centerpiece of the renewed AI strategy..."  │ │
│ │                                                    │ │
│ │ ⏱ 0:07 - 0:10                       [Edit] [×]   │ │
│ │ "...is a tabletop robot."                        │ │
│ └───────────────────────────────────────────────────┘ │
│                                    [+ Add Segment]    │
└───────────────────────────────────────────────────────┘

┌─ Style Settings ───────────────────────────────────────┐
│ Font Family:                                           │
│ [Inter ▼]  [Roboto]  [Montserrat]  [Poppins]         │
│                                                        │
│ Text Size:          Text Color:                       │
│ [36 ────●──── 72]   [⬜ #FFFFFF]                      │
│                                                        │
│ Position:                                              │
│ [  Top  ] [Middle] [●Bottom]                          │
│                                                        │
│ Text Style:                                            │
│ [☑ Bold] [☐ Italic] [☑ Outline] [☐ Shadow]          │
│                                                        │
│ Outline Color:      Outline Width:                    │
│ [⬛ #000000]        [1 ──●── 5]                       │
│                                                        │
│ Background:                                            │
│ [☐ Enable]  Color: [⬛ #000000]  Opacity: [50%]      │
│                                                        │
│ Highlight Style:                                       │
│ [● Word-by-word] [○ Full sentence] [○ No highlight]  │
└───────────────────────────────────────────────────────┘
```

### Logo Tab

```
┌─ Logo/Watermark ──────────────────────────────────────┐
│ ☑ Enable Logo                                         │
│                                                        │
│ Logo File:                                             │
│ [Select Logo...] or drag & drop                       │
│ Current: logo.png                        [Change]     │
│                                                        │
│ Position:                                              │
│ [TL] [TC] [TR]                                        │
│ [ML] [MC] [MR]    or    X: [10%]  Y: [10%]           │
│ [BL] [BC] [●BR]                                       │
│                                                        │
│ Size (% of width):                                     │
│ [10% ────●──── 30%]                                   │
│                                                        │
│ Opacity:                                               │
│ [0% ─────────●─ 100%]                                │
└───────────────────────────────────────────────────────┘
```

### Music Tab

```
┌─ Background Music ────────────────────────────────────┐
│ ☑ Enable Background Music                             │
│                                                        │
│ Audio File:                                            │
│ [Select Audio...] or drag & drop                      │
│ Current: background-music.mp3           [Change]      │
│                                                        │
│ Volume Settings:                                       │
│ Base Volume:                                           │
│ [0% ──●────── 100%]                                   │
│                                                        │
│ Duck During Speech:                                    │
│ [☑ Enable]  Duck to: [10% ──●── 50%]                 │
│                                                        │
│ Fade Effects:                                          │
│ Fade In:  [0s ──●── 5s]                               │
│ Fade Out: [0s ──●── 5s]                               │
└───────────────────────────────────────────────────────┘
```

### Frame Tab

```
┌─ Aspect Ratio & Framing ──────────────────────────────┐
│ Aspect Ratio:                                          │
│ [  1:1  ] [●9:16] [16:9]                              │
│                                                        │
│ Crop Mode:                                             │
│                                                        │
│ [●] Center Crop                                        │
│     Crop video to fill frame (may cut edges)          │
│     ┌────┐                                            │
│     │████│ ← Cropped                                  │
│     └────┘                                            │
│                                                        │
│ [ ] Scale to Fit                                       │
│     Show entire video (may have bars)                  │
│     ┌────┐                                            │
│     │▓▓▓▓│ ← Bars                                     │
│     └────┘                                            │
│                                                        │
│ [ ] Blur Background                                    │
│     Fill empty space with blurred video                │
│     ┌────┐                                            │
│     │░██░│ ← Blur                                     │
│     └────┘                                            │
└───────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation & Layout (Week 1, Day 1-2)

**Goals:**
- Rename ContentPage to EditorPage
- Remove title/description generation code
- Create new database schema
- Build basic two-panel layout
- Implement clip list sidebar with selection

**Deliverables:**
- ✅ EditorPage.tsx with clean layout
- ✅ Database migration for `clip_edits` table
- ✅ Clip list sidebar with navigation
- ✅ Tab navigation structure (empty tabs)

**Database Work:**
```typescript
// Create clip_edits table
// Add migration script
// Create IPC handlers for CRUD operations
```

---

### Phase 2: Video Preview (Week 1, Day 2-3)

**Goals:**
- Implement video player component
- Load and play selected clip
- Create aspect ratio frame container
- Basic HTML overlay system

**Deliverables:**
- ✅ VideoPlayer component
- ✅ Load clip from file path
- ✅ Aspect ratio frame (9:16, 1:1, 16:9 containers)
- ✅ Playback controls (play/pause, scrub)
- ✅ Overlay container synchronized with video

**Technical Requirements:**
```typescript
interface VideoPlayerProps {
  clipId: string
  episodeId: string
  aspectRatio: '9:16' | '1:1' | '16:9'
  overlays: {
    captions: CaptionSegment[]
    logo?: LogoSettings
  }
}
```

---

### Phase 3: Caption System (Week 1-2, Day 4-7)

**Goals:**
- Extract transcript segments for clip time range
- Generate word-level timing
- Build caption editor UI
- Implement caption style controls
- Render captions as HTML overlay
- Text editing functionality
- Save/load caption settings

**Deliverables:**
- ✅ Caption segment extraction service
- ✅ Caption editor with text editing
- ✅ Style controls (font, size, color, position)
- ✅ Live preview overlay
- ✅ Save to `clip_edits` table
- ✅ Word-by-word highlighting

**Caption Extraction:**
```typescript
async function extractClipCaptions(
  episodeId: string,
  startTime: number,
  endTime: number
): Promise<CaptionSegment[]> {
  // Query transcript_segments table
  // Filter by time range
  // Generate word-level timing if needed
  // Return structured segments
}
```

**Caption Rendering:**
```typescript
// HTML/CSS overlay on video
// Real-time sync with currentTime
// Highlight active word/sentence
// Apply styling from settings
```

---

### Phase 4: Logo & Music (Week 2, Day 8-10)

**Goals:**
- Logo upload and storage system
- Logo positioning UI (drag + presets)
- Background music upload
- Audio mixing controls
- Render logo overlay

**Deliverables:**
- ✅ File upload handlers (logo, music)
- ✅ Logo positioning controls
- ✅ Logo overlay rendering
- ✅ Music controls UI
- ✅ Save settings to database

**Logo Upload:**
```typescript
// Save to: ~/Library/Application Support/ariadne/logos/
// Store relative path in database
// Render as <img> overlay with position/scale
```

**Music Settings:**
```typescript
interface MusicSettings {
  enabled: boolean
  path: string
  volume: number         // 0-1
  duckVolume: number    // 0-1
  fadeIn: number        // seconds
  fadeOut: number       // seconds
}
```

---

### Phase 5: Export Integration (Week 2-3, Day 11-14)

**Goals:**
- Read `clip_edits` from database
- Generate FFmpeg commands with all features
- Implement aspect ratio cropping/scaling
- Caption burn-in with styling
- Logo overlay
- Audio mixing

**Deliverables:**
- ✅ Updated exportService.ts
- ✅ FFmpeg filter chain builder
- ✅ Caption burn-in (using drawtext filter)
- ✅ Logo overlay (using overlay filter)
- ✅ Audio mixing (using amix/volume filters)
- ✅ Aspect ratio conversion (crop/scale/blur)

**FFmpeg Command Structure:**
```bash
ffmpeg -i input.mp4 -i logo.png -i music.mp3 \
  -filter_complex "
    [0:v]crop=ih*9/16:ih[cropped];
    [cropped]drawtext=...[captioned];
    [captioned][1:v]overlay=...[final];
    [0:a][2:a]amix=...[audio]
  " \
  -map [final] -map [audio] \
  output.mp4
```

**Caption Burn-in:**
```typescript
// Generate FFmpeg drawtext filter
// For each caption segment, create filter with timing
// Apply font, size, color, outline settings
// Position based on user preference
```

---

### Phase 6: Polish & Features (Week 3, Day 15-17)

**Goals:**
- Apply to All functionality
- Preset/template system
- Error handling
- Preview accuracy improvements
- Performance optimization

**Deliverables:**
- ✅ Apply to All dropdown with selective copy
- ✅ Save/load editing presets
- ✅ Comprehensive error handling
- ✅ Loading states and progress indicators
- ✅ Keyboard shortcuts
- ✅ Undo/redo for caption edits (nice to have)

**Apply to All:**
```typescript
async function applySettingsToAll(
  sourceClipId: string,
  targetClipIds: string[],
  settings: {
    captionStyle?: boolean
    logo?: boolean
    music?: boolean
    frame?: boolean
  }
) {
  // Copy selected settings from source to targets
  // Preserve caption text (clip-specific)
}
```

---

## Technical Challenges & Solutions

### Challenge 1: Caption Timing Accuracy

**Problem:**
Whisper transcripts may not have word-level timing, only segment-level.

**Solutions:**
1. **Use forced alignment** - Tools like `aeneas` or `gentle` for word-level timing
2. **Estimate timing** - Divide segment duration by word count
3. **Manual adjustment** - Allow users to tweak timing in editor

**Chosen Approach:** Start with estimation, add manual adjustment UI

---

### Challenge 2: Video/Caption Sync

**Problem:**
HTML overlay must stay perfectly in sync with video playback.

**Solution:**
```typescript
// Listen to video timeupdate event
videoElement.addEventListener('timeupdate', () => {
  const currentTime = videoElement.currentTime
  updateCaptionDisplay(currentTime)
})

function updateCaptionDisplay(time: number) {
  // Find active caption segment
  const active = segments.find(s =>
    time >= s.start && time < s.end
  )

  // Update DOM with active caption
  // Highlight current word if word-level timing exists
}
```

---

### Challenge 3: FFmpeg Filter Complexity

**Problem:**
Building correct FFmpeg filter chains for multiple overlays is complex.

**Solution:**
```typescript
class FFmpegFilterBuilder {
  private filters: string[] = []

  addCrop(aspectRatio: string, mode: string) {
    // Calculate crop dimensions
    // Add crop filter
  }

  addCaptions(segments: CaptionSegment[], style: CaptionStyle) {
    // For each segment, add drawtext filter with timing
  }

  addLogo(logo: LogoSettings) {
    // Add overlay filter
  }

  addAudioMix(music: MusicSettings) {
    // Add audio filters
  }

  build(): string {
    return this.filters.join(';')
  }
}
```

---

### Challenge 4: Preview vs Export Accuracy

**Problem:**
HTML/CSS preview may not exactly match FFmpeg output.

**Mitigation:**
- Use web-safe fonts available in FFmpeg
- Test caption positioning with sample exports
- Provide "Test Export" button for single clip
- Document known differences

---

### Challenge 5: Caption Text Editing

**Problem:**
Need to allow editing while maintaining timing structure.

**Solution:**
```typescript
interface EditableCaptionSegment {
  id: string
  start: number
  end: number
  text: string          // Editable
  originalText: string  // For reference
  edited: boolean       // Track changes
}

// UI allows:
// - Inline text editing
// - Timestamp adjustment
// - Segment splitting/merging
// - Add/remove segments
```

---

## Data Flow

### Loading Clip for Editing

```
User selects clip
  ↓
Load clip data from database (clips table)
  ↓
Load existing edits (clip_edits table) OR create defaults
  ↓
Load transcript segments for clip time range
  ↓
Render video player + overlays
  ↓
User makes edits
  ↓
Save to clip_edits table (real-time or on blur/change)
  ↓
Mark clip as edited (has_edits = 1)
```

### Export with Edits

```
User clicks Export
  ↓
For each approved clip:
  ↓
  Load clip_edits settings
  ↓
  Build FFmpeg command with:
    - Caption burn-in (from edited caption_segments)
    - Logo overlay (if enabled)
    - Audio mix (if enabled)
    - Aspect ratio crop/scale
  ↓
  Execute FFmpeg
  ↓
  Save to exports directory
```

---

## File Storage Structure

```
~/Library/Application Support/ariadne/
├── ariadne.db                   # SQLite database
├── clips/                       # Extracted audio clips
│   └── {episode_id}_{clip_id}.mp4
├── exports/                     # Final exported reels
│   └── {project_name}_{clip_number}.mp4
├── logos/                       # User uploaded logos
│   ├── logo1.png
│   └── logo2.svg
└── music/                       # Background music files
    ├── track1.mp3
    └── track2.wav
```

---

## API/IPC Handlers

### New Handlers Required

```typescript
// Clip edits CRUD
ipcMain.handle('get-clip-edits', (event, clipId: string))
ipcMain.handle('save-clip-edits', (event, clipId: string, edits: ClipEdits))
ipcMain.handle('delete-clip-edits', (event, clipId: string))

// Caption extraction
ipcMain.handle('extract-clip-captions', (event, episodeId: string, startTime: number, endTime: number))

// File uploads
ipcMain.handle('upload-logo', (event, filePath: string))
ipcMain.handle('upload-music', (event, filePath: string))

// Apply to all
ipcMain.handle('apply-edits-to-all', (event, sourceClipId: string, targetClipIds: string[], settings: object))

// Preview/Test
ipcMain.handle('export-preview', (event, clipId: string)) // Quick test export
```

---

## Success Metrics

### MVP Success
- ✅ Captions render correctly in exports
- ✅ Logo overlay positions accurately
- ✅ Background music mixes properly
- ✅ Aspect ratio conversion works (9:16, 1:1, 16:9)
- ✅ Preview matches export output within 95% accuracy
- ✅ No external tools needed (CapCut replacement)

### Performance Targets
- Editor loads in < 2 seconds
- Caption edits save in < 500ms
- Preview renders in < 1 second
- Export processes clips at 2-5x real-time speed

### User Experience
- Intuitive interface (minimal learning curve)
- Live preview feels responsive
- Settings persist across sessions
- Apply to All saves significant time

---

## Future Enhancements (Post-MVP)

### Phase 7: Advanced Features
- **Caption animations** - Fade in/out, slide, pop
- **Multiple caption styles** - Different styles for different speakers
- **Caption background boxes** - Solid/gradient backgrounds
- **Advanced logo animations** - Fade, slide, bounce
- **Multi-track audio** - Background music + sound effects
- **Video filters** - Color grading, brightness, contrast
- **Transitions** - Between clips (if exporting multiple)

### Phase 8: Templates & Presets
- **Save editing templates** - Reuse across projects
- **Preset library** - Common styles (e.g., "TikTok Style", "YouTube Shorts")
- **Brand kits** - Logo + colors + fonts + music
- **One-click apply** - Apply template to all clips

### Phase 9: Collaboration
- **Export templates** - Share with other users
- **Cloud storage** - Sync logos, music, presets
- **Version history** - Undo/redo entire editing sessions

---

## Testing Plan

### Unit Tests
- Caption timing extraction
- FFmpeg command generation
- Aspect ratio calculations
- Database operations

### Integration Tests
- Full edit → export workflow
- Apply to all functionality
- File upload/storage
- Multi-clip batch export

### User Testing
- Test with 5+ real podcast episodes
- Verify caption accuracy
- Check preview/export matching
- Measure time savings vs CapCut

---

## Migration Notes

### From Current Content Page

**What to Keep:**
- MainContentPanel wrapper
- Two-panel layout structure
- Clip list sidebar concept

**What to Remove:**
- ❌ Title generation UI
- ❌ Description editor
- ❌ `clip_titles` table usage
- ❌ `clip_descriptions` table usage
- ❌ AI content generation calls

**What to Add:**
- ✅ Video player
- ✅ Tab interface
- ✅ Caption editor
- ✅ Logo controls
- ✅ Music controls
- ✅ Frame settings

### Database Cleanup

Optional cleanup of old tables (if not used elsewhere):
```sql
-- Consider removing if truly unused
DROP TABLE IF EXISTS clip_titles;
DROP TABLE IF EXISTS clip_descriptions;
DROP TABLE IF EXISTS content_packages;
```

---

## Open Questions

1. **Caption word-level timing:** Use forced alignment library or simple estimation?
2. **Logo format support:** PNG only, or also SVG/WebP?
3. **Music library:** Include stock music tracks or user-upload only?
4. **Export filename:** Use clip quote, custom field, or numbered sequence?
5. **Undo/redo:** Implement for caption edits, or rely on manual backups?

---

## Resources & References

### FFmpeg Documentation
- [drawtext filter](https://ffmpeg.org/ffmpeg-filters.html#drawtext)
- [overlay filter](https://ffmpeg.org/ffmpeg-filters.html#overlay)
- [crop filter](https://ffmpeg.org/ffmpeg-filters.html#crop)
- [amix filter](https://ffmpeg.org/ffmpeg-filters.html#amix)

### Libraries
- **Video Player:** HTML5 `<video>` element
- **Color Picker:** React-based color picker component
- **File Upload:** Electron dialog API
- **Caption Timing:** Consider `aeneas` or `gentle` for accuracy

### Design Inspiration
- CapCut web editor
- TikTok caption styles
- Instagram Reels editor
- DaVinci Resolve caption tools

---

## Timeline Summary

**Total Estimated Time:** 3 weeks (15-17 working days)

| Phase | Duration | Key Deliverables |
|-------|----------|------------------|
| 1. Foundation | 2 days | Layout, database, structure |
| 2. Video Preview | 1-2 days | Player, aspect ratio frame |
| 3. Captions | 3-4 days | Editor, styling, rendering, text editing |
| 4. Logo & Music | 3 days | Upload, controls, overlay |
| 5. Export Integration | 3-4 days | FFmpeg implementation |
| 6. Polish | 2-3 days | Apply to All, presets, UX |

**Start Date:** [TBD]
**Target MVP Date:** [TBD + 3 weeks]

---

## Approval & Sign-off

- [ ] Design reviewed
- [ ] Technical approach validated
- [ ] Database schema approved
- [ ] UI mockups finalized
- [ ] Timeline accepted
- [ ] Ready to begin implementation

---

**Document Version:** 1.0
**Last Updated:** 2025-10-03
**Author:** Development Team
**Status:** Draft - Pending Approval
