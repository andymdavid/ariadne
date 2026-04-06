# UI/UX Specifications: Clean, AI-First Interface

## Design Philosophy

**Core Principle:** "Lex.page for reel creation" - radical simplicity with powerful AI assistance under the hood.

**Design Goals:**
- **Minimize cognitive load** - only show what's needed for current task
- **AI-first workflow** - prompts and suggestions drive the experience
- **Context-sensitive UI** - interface adapts to current step
- **Dark mode native** - designed for long editing sessions

## Application Structure

### Main Application Layout
```
┌─────────────────────────────────────────────────────────────┐
│                    Floating Toolbar                        │ ← Minimal, context-aware
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│                 │ │                 │ │                 │
│   Clip Cards    │ │  Main Timeline  │ │  Reel Preview   │ ← Three-column layout
│   Review Area   │ │   (Xcode-like)  │ │  (Phone View)   │
│                 │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              Slim Audio/Video Tracks                       │ ← Minimal timeline
└─────────────────────────────────────────────────────────────┘
```

## Color Palette & Typography

### Dark Mode Color System
```css
/* Primary Colors */
--bg-primary: #0d1117;        /* Main background */
--bg-secondary: #161b22;      /* Card backgrounds */
--bg-tertiary: #21262d;       /* Elevated elements */

/* Accent Colors */
--accent-primary: #58a6ff;    /* Interactive elements */
--accent-success: #238636;    /* Approved clips */
--accent-warning: #d29922;    /* Pending review */
--accent-danger: #f85149;     /* Rejected clips */

/* Text Colors */
--text-primary: #f0f6fc;      /* Primary text */
--text-secondary: #8b949e;    /* Secondary text */
--text-muted: #6e7681;        /* Muted text */

/* Interactive States */
--hover-bg: #30363d;          /* Hover backgrounds */
--border-default: #30363d;    /* Default borders */
--border-accent: #58a6ff;     /* Focused borders */
```

### Typography Scale
```css
/* Font Family */
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;

/* Type Scale */
--text-xs: 12px;      /* Timestamps, metadata */
--text-sm: 14px;      /* Secondary text */
--text-base: 16px;    /* Body text */
--text-lg: 18px;      /* Card titles */
--text-xl: 20px;      /* Section headers */
--text-2xl: 24px;     /* Page titles */
```

## Core UI Components

### 1. Floating Toolbar
**Position:** Top of screen, always visible
**Content:** Context-sensitive controls

```typescript
interface ToolbarState {
  mode: 'upload' | 'review' | 'editing' | 'export'
  actions: ToolbarAction[]
}

// Upload Mode
['Select File', 'Processing Status']

// Review Mode  
['Process More', 'Approve All', 'Settings']

// Editing Mode
['Play/Pause', 'Trim', 'Export', 'Back to Review']

// Export Mode
['Export Settings', 'Export All', 'Back']
```

### 2. Clip Cards Interface
**Layout:** Vertical scrollable list in left panel
**Interaction:** Click to select, checkbox for approval

```typescript
interface ClipCard {
  id: string
  preview: {
    duration: string         // "1:23"
    confidence: number       // 8.5/10
    contentType: ClipType    // "insight" | "story" | etc.
  }
  content: {
    transcript: string       // Truncated to 2-3 lines
    keyQuote: string        // Most memorable quote
    timestamp: string       // "12:34 - 13:57"
  }
  state: 'pending' | 'approved' | 'rejected'
  aiReasoning: string       // Why AI selected this clip
}
```

**Visual Design:**
```
┌─────────────────────────────────────────────────────────┐
│ ✅ INSIGHT • 1:23 • Score: 8.5                         │ ← Header with state
│                                                         │
│ "The real problem with remote work isn't               │ ← Key quote
│ productivity - it's the loss of..."                    │
│                                                         │
│ [12:34 - 13:57] Contains complete explanation of       │ ← Metadata
│ remote work challenges with actionable solution         │
│                                                         │
│ 🎵 Play Preview    ⚙️ Adjust Boundaries               │ ← Actions
└─────────────────────────────────────────────────────────┘
```

### 3. Timeline Editor (Xcode-inspired)
**Layout:** Center panel, horizontal timeline
**Functionality:** Visual editing with minimal complexity

```
Timeline Header:
[0:00]──────[5:00]──────[10:00]──────[15:00]──────[20:00]

Main Track (Video):
████████████████████████████████████████████████████████

Audio Track:
∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿

Captions Track:
[Caption 1]    [Caption 2]         [Caption 3]

Background Music:
♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪
```

**Interaction Patterns:**
- **Click and drag** to select clip boundaries
- **Scroll wheel** for zoom in/out
- **Spacebar** for play/pause
- **Click track** to jump to timestamp

### 4. Reel Preview Panel
**Layout:** Right panel, mobile-shaped preview
**Purpose:** Real-time preview of final output

```
┌─────────────────┐
│ ┌─────────────┐ │ ← iPhone-shaped frame
│ │             │ │
│ │   Preview   │ │ ← Live video preview
│ │   Window    │ │
│ │             │ │
│ │ [Captions]  │ │ ← Overlay elements
│ └─────────────┘ │
│                 │
│ Title: "..."    │ ← Generated content
│ Desc: "..."     │
│                 │
│ [Export]        │ ← Quick actions
└─────────────────┘
```

## Workflow-Specific Interfaces

### Upload & Processing Screen
**Goal:** Clear progress indication and status

```
┌─────────────────────────────────────────────────────────────┐
│                     Upload Your Podcast                    │
│                                                             │
│    ┌─────────────────────────────────────────────────┐    │
│    │                                                 │    │
│    │           Drop file here or click               │    │
│    │                                                 │    │
│    └─────────────────────────────────────────────────┘    │
│                                                             │
│  📁 Supported: .mp4, .mov, .mp3, .wav (up to 3GB)        │
└─────────────────────────────────────────────────────────────┘

Processing Status:
┌─────────────────────────────────────────────────────────────┐
│ ✅ Audio extracted                                          │
│ ⏳ Transcribing... (2:34 remaining)                        │
│ ⏸ Analyzing content...                                     │
│ ⏸ Generating suggestions...                                │
└─────────────────────────────────────────────────────────────┘
```

### Review & Approval Interface
**Goal:** Efficient clip evaluation and approval

```
Left Panel (Clip Cards):           Right Panel (Context):
┌─────────────────────────────┐   ┌─────────────────────────────┐
│ [Card 1] ✅               │   │ Full Transcript Context:    │
│ [Card 2] ⏳               │   │                             │
│ [Card 3] ❌               │   │ "...earlier in conversation │
│ [Card 4] ⏳               │   │ they were discussing X, then│
│ [Card 5] ✅               │   │ → [SELECTED CLIP] ←         │
│ [Card 6] ⏳               │   │ and after this they move on │
│ ...                      │   │ to discussing Y..."         │
└─────────────────────────────┘   └─────────────────────────────┘

Bottom Actions:
[⏯ Play Selected] [🎯 Adjust Boundaries] [✅ Approve All] [🔄 Process More]
```

### Content Generation Review
**Goal:** Quick review and customization of AI-generated content

```
┌─────────────────────────────────────────────────────────────┐
│                  Content Package Review                    │
│                                                             │
│ Clip 1: "Remote work productivity insights"                │
│ ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│ │ Title Options:  │ │ Description:    │ │ Thumbnail:      │ │
│ │ ○ Option 1      │ │ [Editable text  │ │ [Frame preview] │ │
│ │ ● Option 2      │ │  area with AI   │ │ [Select frame]  │ │
│ │ ○ Option 3      │ │  generated      │ │                 │ │
│ │ + Custom        │ │  content]       │ │                 │ │
│ └─────────────────┘ └─────────────────┘ └─────────────────┘ │
│                                                             │
│ [Previous] [Save Changes] [Next] [Export All]              │
└─────────────────────────────────────────────────────────────┘
```

## Interaction Patterns

### Progressive Disclosure
**Principle:** Show only what's needed for current task
- **Upload:** Just file selection and progress
- **Review:** Focus on clip evaluation
- **Editing:** Timeline and preview
- **Export:** Output options and progress

### Contextual Actions
**Principle:** Actions change based on selection and mode
```typescript
interface ContextualAction {
  trigger: 'clip_selected' | 'timeline_focused' | 'multiple_selected'
  actions: Action[]
}

// Examples:
clip_selected → ['Play', 'Edit Boundaries', 'Approve', 'Reject']
timeline_focused → ['Play/Pause', 'Zoom', 'Add Marker']
multiple_selected → ['Bulk Approve', 'Bulk Reject', 'Export Selected']
```

### Keyboard Shortcuts
**Goal:** Efficient workflow for power users
```
Global:
- Space: Play/Pause
- ⌘+N: New Project
- ⌘+O: Open File
- ⌘+E: Export

Review Mode:
- ↑/↓: Navigate clips
- Enter: Play selected clip
- A: Approve clip
- R: Reject clip
- E: Edit boundaries

Timeline Mode:
- I: Set in point
- O: Set out point
- X: Clear selection
- ⌘+Z: Undo
```

## Animation & Feedback

### Micro-Interactions
- **Card selection:** Smooth highlight animation
- **Approval states:** Color transition with subtle bounce
- **Processing:** Pulsing indicators and progress bars
- **Clip boundaries:** Smooth drag with magnetic snap points

### Loading States
- **Skeleton screens** for content loading
- **Progressive loading** of clip cards
- **Real-time progress** for long operations
- **Contextual messages** explaining current process

### Error States
- **Inline validation** for form inputs
- **Toast notifications** for system messages
- **Empty states** with helpful guidance
- **Retry mechanisms** for failed operations

## Responsive Behavior

### Window Sizing
- **Minimum size:** 1200x800px for usable timeline
- **Optimal size:** 1440x900px for three-panel layout
- **Maximum efficiency:** Ultra-wide displays (21:9 ratio)

### Panel Resizing
- **Draggable dividers** between panels
- **Snap points** for common layouts
- **Collapsed states** for single-panel focus
- **Memory of user preferences**

## Accessibility

### Keyboard Navigation
- **Tab order** follows logical workflow
- **Focus indicators** clearly visible
- **Screen reader** compatibility for all controls
- **Voice control** support for macOS

### Visual Accessibility
- **High contrast** option beyond dark mode
- **Text scaling** support
- **Color blind** friendly color palette
- **Motion reduction** respect for system preferences

## Technical Implementation Notes

### React Component Architecture
```typescript
// Main Layout
<AppShell>
  <FloatingToolbar />
  <ThreeColumnLayout>
    <ClipCardsPanel />
    <TimelineEditor />
    <ReelPreview />
  </ThreeColumnLayout>
  <SlimTrackEditor />
</AppShell>

// Key Components
<ClipCard clip={clip} onApprove={} onReject={} />
<Timeline tracks={tracks} onSelection={} />
<ReelPreview clip={selectedClip} />
```

### State Management Strategy
```typescript
// Global State (Zustand)
interface AppState {
  currentProject: Project | null
  clips: ClipCard[]
  selectedClip: string | null
  timeline: TimelineState
  ui: UIState
}

// Component-specific state (React useState)
// - Form inputs
// - Local UI state
// - Animation states
```

### Performance Considerations
- **Virtual scrolling** for large clip lists
- **Lazy loading** of video previews
- **Debounced updates** for real-time editing
- **Memoized components** to prevent unnecessary re-renders


## Fey-Inspired UI Optimizations

### Updated Main Layout
Based on analysis of Fey's clean, data-focused interface, we're implementing these key improvements:

```
┌─────────────────────────────────────────────────────────────┐
│                    Minimal Status Bar                      │ ← Processing status only
└─────────────────────────────────────────────────────────────┘

┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│                 │ │                 │ │                 │
│   Clean Clip    │ │ Simplified      │ │  Live Reel      │ ← Cleaner layout
│   Cards         │ │ Timeline        │ │  Preview        │
│   (No clutter)  │ │ (Single track)  │ │  (Phone frame)  │
│                 │ │                 │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ > Find clips about "remote work" under 60 seconds          │ ← Command interface
└─────────────────────────────────────────────────────────────┘
```

### Key Fey-Inspired Improvements

#### 1. Bottom Command Interface (Primary Innovation)
Replace floating toolbar with bottom command bar that accepts natural language:

```
Examples:
> Find clips about "AI risks" under 30 seconds
> Show me funny moments from this episode  
> Create titles for approved clips
> Export all clips as Instagram Stories
```

#### 2. Simplified Clip Cards (Reduce Visual Clutter)
Current design → Fey-inspired clean design:

```css
/* Remove all visual decorations */
.clip-card {
  background: var(--bg-secondary);
  border: 1px solid var(--border-default);
  padding: 16px;
  /* NO: border-radius, box-shadow, gradients */
}
```

Visual result:
```
┌─────────────────────────────────────────────────────────┐
│ INSIGHT • 1:23 • 8.5★                                  │
│                                                         │
│ "The real problem with remote work..."                 │
│                                                         │
│ 12:34-13:57 • Complete thought                         │
└─────────────────────────────────────────────────────────┘
```

#### 3. Single-Track Timeline (Eliminate Complexity)
Replace multi-track interface with clean single timeline:

```
Current (Complex):
[Video Track    ] ████████████████████████████████████
[Audio Track    ] ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿
[Captions Track ] [Caption 1] [Caption 2] [Caption 3]
[Music Track    ] ♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪

Fey-Inspired (Clean):
────────────────────────────────────────────────────────
     ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿
[📍 12:34] ████████████████ [📍 13:57]   🎵 
────────────────────────────────────────────────────────
```

#### 4. Natural Language Processing Integration
```typescript
interface CommandProcessor {
  // Natural language to actions
  "find clips about X" → searchTranscript(query)
  "show clips under Y seconds" → filterByDuration(maxDuration)
  "export as Instagram format" → setExportFormat('9:16')
  "create titles for approved" → generateTitles(approvedClips)
}
```

#### 5. Context-Aware UI Adaptation
Following Fey's pattern of intelligent UI adaptation:

```typescript
interface UIState {
  'reviewing': {
    leftPanel: 'clip-cards'
    rightPanel: 'transcript-context'
    bottomCommand: 'clip-search-suggestions'
  }
  'editing': {
    leftPanel: 'clip-cards'
    rightPanel: 'editing-tools'
    bottomCommand: 'editing-commands'
  }
  'exporting': {
    leftPanel: 'export-queue'
    rightPanel: 'export-settings'
    bottomCommand: 'export-commands'
  }
}
```

### Implementation Priority

**Phase 1: Core Fey Patterns (Week 1-2)**
1. Bottom command interface with natural language processing
2. Simplified clip card design (remove visual clutter)
3. Single-track timeline view

**Phase 2: Advanced Features (Week 3-4)**
1. Context-aware UI adaptation
2. Advanced command processing
3. Performance optimizations

### Expected Impact

**User Experience Benefits:**
- **50% faster navigation** through command interface
- **Reduced cognitive load** from simplified visuals
- **More intuitive workflow** with natural language commands

**Technical Benefits:**
- **Simplified component architecture** 
- **Better performance** with fewer UI elements
- **Easier maintenance** with cleaner design system

This Fey-inspired approach transforms our interface from a traditional video editor into a content intelligence platform, perfectly aligning with our "Lex.page for reel creation" vision.
