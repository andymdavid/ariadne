# Technical Architecture Document: AI Reel Creator

## System Overview

**Architecture Type:** Desktop-first application with cloud AI services  
**Platform:** Electron-based cross-platform desktop app  
**Processing Model:** Local-first with cloud AI augmentation  

## Technology Stack

### Frontend
- **Framework:** React 18 + TypeScript
- **UI Library:** Custom components with Tailwind CSS
- **State Management:** Zustand (lightweight, performant)
- **Desktop Framework:** Electron (cross-platform compatibility)

### Backend/Processing
- **Runtime:** Node.js
- **Video Processing:** FFmpeg (native binary + Node.js bindings)
- **Database:** SQLite (local, embedded)
- **File System:** Native file operations via Electron APIs

### AI Services
- **Model Provider:** OpenRouter (model flexibility)
- **Development Model:** Deepseek R1 (~$0.14/1M tokens)
- **Production Model:** Claude Sonnet 4 (~$3/1M tokens)
- **Transcription:** Whisper Large (~$0.006/minute)

### Development Tools
- **Build:** Vite + Electron Builder
- **Testing:** Vitest + Playwright
- **Code Quality:** ESLint + Prettier + TypeScript

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Electron Main Process                    │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│  │   File System   │ │   FFmpeg Core   │ │   SQLite DB     │ │
│  │   Operations    │ │   Processing    │ │   Management    │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ IPC Communication
                                │
┌─────────────────────────────────────────────────────────────┐
│                  Electron Renderer Process                   │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│  │   React UI      │ │   Timeline      │ │   Cards Review  │ │
│  │   Components    │ │   Editor        │ │   Interface     │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                                │
                                │ HTTPS API Calls
                                │
┌─────────────────────────────────────────────────────────────┐
│                      Cloud AI Services                       │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐ │
│  │   OpenRouter    │ │   Whisper API   │ │   Content       │ │
│  │   LLM API       │ │   Transcription │ │   Analysis      │ │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Architecture

### 1. File Processing Pipeline
```
Input: Podcast File (.mp4, .mov, .mp3)
    ↓
Audio Extraction (FFmpeg)
    ↓
Transcription (Whisper API)
    ↓
Content Analysis (LLM via OpenRouter)
    ↓
Clip Suggestions (Stored in SQLite)
    ↓
Human Review (React Cards UI)
    ↓
Approved Clips Processing (FFmpeg)
    ↓
Content Generation (LLM for titles/descriptions)
    ↓
Export Ready Files
```

### 2. Data Storage Strategy
```
Local SQLite Database:
├── projects/
│   ├── project_id, name, created_at
├── episodes/
│   ├── episode_id, project_id, file_path, duration
├── transcripts/
│   ├── transcript_id, episode_id, full_text, timestamps
├── clips/
│   ├── clip_id, episode_id, start_time, end_time, content
├── exports/
│   └── export_id, clip_id, file_path, metadata
```

## Core Components

### 1. File Management System
**Responsibility:** Handle large media files efficiently
- **Local file operations** via Electron's native APIs
- **Metadata extraction** using FFprobe
- **Temporary file management** for processing
- **Progress tracking** for long operations

### 2. Video Processing Engine
**Responsibility:** All FFmpeg operations
- **Audio extraction** from source video
- **Clip generation** with precise timestamps
- **Audio processing** (silence removal, normalization)
- **Video composition** (captions, logos, background music)

### 3. AI Orchestration Layer
**Responsibility:** Manage all AI API interactions
- **Request batching** to optimize API costs
- **Error handling** and retry logic
- **Model switching** (development vs production)
- **Response caching** to avoid duplicate calls

### 4. Timeline Editor Component
**Responsibility:** Interactive editing interface
- **Waveform visualization** for audio tracks
- **Drag-and-drop** clip boundary adjustment
- **Real-time preview** of edits
- **Multi-track support** (video, audio, captions)

### 5. Cards Review Interface
**Responsibility:** Human review workflow
- **Swipeable cards** for quick decision making
- **Audio preview** with transcript display
- **Context expansion** to see surrounding content
- **Batch operations** for multiple clips

## Performance Considerations

### Memory Management
- **Streaming processing** for large files
- **Lazy loading** of video previews
- **Garbage collection** of temporary files
- **Memory limits** for FFmpeg operations

### Processing Optimization
- **Background processing** to keep UI responsive
- **Parallel processing** where possible (multiple clips)
- **Incremental saves** to prevent data loss
- **Progress indicators** for long operations

### UI Responsiveness
- **Virtual scrolling** for large clip lists
- **Debounced updates** for real-time editing
- **Web Workers** for heavy computations
- **Efficient re-rendering** with React optimizations

## Security & Privacy

### Data Protection
- **Local-first** architecture minimizes cloud data exposure
- **Temporary file cleanup** after processing
- **No persistent cloud storage** of user content
- **API key encryption** for OpenRouter credentials

### Error Handling
- **Graceful degradation** when cloud services unavailable
- **Local fallbacks** where possible
- **Comprehensive logging** for debugging
- **User-friendly error messages**

## Scalability Considerations

### MVP Constraints
- **Single user** desktop application
- **Local processing** limits (RAM, CPU)
- **Sequential processing** of episodes
- **Manual project management**

### Future Scaling Options
- **Cloud processing** for heavy operations
- **Batch processing** of multiple episodes
- **Team collaboration** features
- **Performance analytics** and optimization

## Integration Points

### External Services
- **OpenRouter API** for LLM operations
- **Whisper API** for transcription
- **File system** for media storage
- **Future:** Social platform APIs for direct publishing

### Internal APIs
- **IPC communication** between Electron processes
- **SQLite queries** for data persistence
- **FFmpeg CLI** for video operations
- **React state** for UI synchronization

## Development Environment

### Local Setup Requirements
- **Node.js 18+** for runtime
- **FFmpeg binary** installed locally
- **SQLite3** for database operations
- **OpenRouter API key** for AI services

### Build Pipeline
- **TypeScript compilation** with strict checking
- **Electron packaging** for cross-platform distribution
- **Asset optimization** for smaller bundle size
- **Automated testing** before releases

## Deployment Strategy

### MVP Distribution
- **Direct download** from website
- **Manual installation** on macOS/Windows
- **Auto-updater** for future versions
- **Local data storage** only

### Future Distribution
- **App Store** distribution (Mac App Store, Microsoft Store)
- **Team licensing** for organizations
- **Cloud sync** for settings and templates
- **Enterprise features** and support
