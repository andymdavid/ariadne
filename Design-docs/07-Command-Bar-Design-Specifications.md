# Fey-Inspired Command Bar Design Specifications

## Core Design Philosophy

**No Scroll, No Clutter:** Everything fits in viewport with command-driven navigation replacing busy panels.

## Command Bar Specifications

### Visual Design
```css
.command-bar {
  /* Positioning */
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  
  /* Dimensions */
  width: 680px;
  height: 56px;
  
  /* Glass Morphism Effect */
  background: rgba(22, 27, 34, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  
  /* Border & Shadow */
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 28px; /* Perfect pill shape */
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.3),
    0 2px 8px rgba(0, 0, 0, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
    
  /* Layout */
  display: flex;
  align-items: center;
  padding: 8px 8px 8px 20px;
  gap: 12px;
}
```

### Input Field
```css
.command-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  
  /* Typography */
  font-family: -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
  font-size: 16px;
  font-weight: 400;
  color: #f0f6fc;
  
  /* Placeholder */
  &::placeholder {
    color: rgba(240, 246, 252, 0.5);
    content: "Find clips, create content, export reels...";
  }
}
```

### Navigation Button (Right Side)
```css
.nav-button {
  /* Dimensions */
  width: 40px;
  height: 40px;
  
  /* Styling */
  background: rgba(88, 166, 255, 0.15);
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 20px;
  
  /* Icon */
  display: flex;
  align-items: center;
  justify-content: center;
  color: #58a6ff;
  
  /* Interaction */
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: rgba(88, 166, 255, 0.25);
    border-color: rgba(88, 166, 255, 0.5);
    transform: translateX(2px);
  }
}
```

## Command System Architecture

### Screen Navigation Model
Replace panels with command-driven screens:

```typescript
interface ScreenFlow {
  'upload': {
    title: 'Upload Podcast'
    commands: ['select file', 'drag and drop', 'process episode']
    nextScreen: 'processing'
  }
  'processing': {
    title: 'Processing Content'
    commands: ['view progress', 'cancel processing']
    nextScreen: 'review'
  }
  'review': {
    title: 'Review Clips'
    commands: ['find clips about X', 'approve all', 'reject low scores', 'next']
    nextScreen: 'content'
  }
  'content': {
    title: 'Generate Content'
    commands: ['create titles', 'write descriptions', 'select thumbnails', 'next']
    nextScreen: 'export'
  }
  'export': {
    title: 'Export Reels'
    commands: ['export all', 'export as instagram', 'save project']
    nextScreen: 'complete'
  }
}
```

### Natural Language Processing
```typescript
interface CommandProcessor {
  // Content Discovery
  'find clips about [topic]' → searchTranscript(topic)
  'show me [emotion] moments' → filterByEmotion(emotion)
  'clips under [duration]' → filterByDuration(duration)
  
  // Content Generation  
  'create titles for approved clips' → generateTitles(approvedClips)
  'write descriptions' → generateDescriptions()
  'suggest thumbnails' → extractThumbnails()
  
  // Export & Format
  'export as instagram stories' → setFormat('9:16')
  'export all approved clips' → batchExport(approvedClips)
  'save project' → saveCurrentState()
  
  // Navigation
  'next' → navigateToNextScreen()
  'back' → navigateToPreviousScreen()
  'go to review' → navigateToScreen('review')
}
```

## Screen Layout System

### Single Screen Principle
Each screen fills viewport completely - no scrolling needed:

```
┌─────────────────────────────────────────────────────────────┐
│                      Screen Title                           │ ← 60px header
│                                                             │
│                                                             │
│                   Main Content Area                        │ ← Fill remaining height
│                   (No panels, clean focus)                 │
│                                                             │
│                                                             │ 
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              ╱ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ̄ ╲
                             ╱ > Find clips about "AI" under 30s → ╲ ← Floating command bar
                            ╲_________________________________╱
                                        24px from bottom
```

### Review Screen Redesign
Replace busy three-panel layout:

**Current (Busy):**
```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Suggested   │ │ Clip        │ │ Reel        │
│ Clips       │ │ Details     │ │ Preview     │
│ (Panel)     │ │ (Panel)     │ │ (Panel)     │
└─────────────┘ └─────────────┘ └─────────────┘
```

**New (Clean):**
```
┌─────────────────────────────────────────────────────────────┐
│                    Review Clips (15 found)                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 🔥 HOT_TAKE • 0:14 • 9★           [Approved ✓]        ││ ← Selected clip
│  │                                                         ││
│  │ "The conventional wisdom is that Apple is lagging      ││
│  │ right now... Tim Cook should be fired as CEO."         ││
│  │                                                         ││
│  │ 0:07 - 0:21 • Controversial take on Apple's AI         ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  [Other clips in minimal card format below...]             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                  > approve all high scores →
```

## Command Bar States

### Active States
```typescript
interface CommandStates {
  'idle': {
    placeholder: "Find clips, create content, export reels..."
    suggestions: ['find clips about', 'approve all', 'export as']
  }
  'typing': {
    placeholder: ""
    suggestions: contextualSuggestions(currentInput)
  }
  'processing': {
    placeholder: "Processing..."
    disabled: true
    showProgress: true
  }
  'error': {
    placeholder: "Command not recognized. Try 'find clips about AI'"
    errorState: true
  }
}
```

### Interaction Behaviors
```css
/* Focus State */
.command-bar:focus-within {
  box-shadow: 
    0 8px 32px rgba(0, 0, 0, 0.4),
    0 2px 8px rgba(0, 0, 0, 0.3),
    0 0 0 2px rgba(88, 166, 255, 0.3);
}

/* Typing Animation */
.command-input[data-typing="true"]::after {
  content: "|";
  animation: blink 1s infinite;
  color: #58a6ff;
}
```

## Implementation Notes

### Viewport Management
```javascript
// Ensure no scrolling ever needed
const ensureViewportFit = () => {
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';
  
  // Calculate available height minus command bar
  const availableHeight = window.innerHeight - 104; // 56px bar + 48px margins
  document.querySelector('.main-content').style.height = `${availableHeight}px`;
};
```

### Glass Effect Fallback
```css
/* Fallback for browsers without backdrop-filter */
@supports not (backdrop-filter: blur(20px)) {
  .command-bar {
    background: rgba(22, 27, 34, 0.95);
  }
}
```

### Accessibility
```javascript
// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.metaKey && e.key === 'k') {
    e.preventDefault();
    focusCommandBar();
  }
});
```

## Expected User Experience

1. **Always Accessible:** Command bar visible on every screen
2. **No Learning Curve:** Natural language commands
3. **No Scrolling:** Everything fits in viewport
4. **Fluid Navigation:** Commands drive the experience
5. **Visual Calm:** Clean, focused interface without panel chaos

This approach transforms Ariadne from a traditional multi-panel interface into a command-driven content creation platform that feels both powerful and effortless.
