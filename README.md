# Ariadne 🧵

> Your thread through content - AI-powered podcast reel creator

Ariadne is a desktop application that transforms long-form podcasts into ready-to-publish social media reels using advanced AI analysis. Just as Ariadne's thread guided Theseus through the labyrinth, our intelligent system guides creators through hours of content to discover the moments worth sharing.

## ✨ Features

### 🤖 AI-Powered Content Analysis
- **Smart Transcription**: Whisper-powered audio transcription with precise timestamps
- **Content Intelligence**: AI identifies engaging, shareable segments automatically
- **Quality Scoring**: Each clip rated for shareability potential (1-10 scale)
- **Content Categorization**: Clips tagged as insights, stories, advice, hot takes, or humor

### 🎬 Professional Video Processing
- **FFmpeg Integration**: Professional-grade audio/video processing
- **Multiple Formats**: Export optimized for Instagram Stories, TikTok, YouTube Shorts
- **Smart Boundaries**: AI finds natural conversation breaks for clean clips
- **Batch Processing**: Generate multiple clips simultaneously

### 🏠 Local-First & Secure
- **Privacy Focused**: All processing happens locally on your machine
- **Encrypted Storage**: API keys stored with AES encryption
- **No Cloud Dependency**: Your content never leaves your computer
- **SQLite Database**: Fast, reliable local data storage

### 🎨 Clean, Command-Driven Interface
- **Fey-Inspired Design**: Minimal, data-focused UI without clutter
- **Command Interface**: Navigate with natural language (⌘K)
- **Three-Panel Layout**: Clips | Timeline | Preview for efficient workflow
- **Dark Mode Native**: Designed for long editing sessions

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+**
- **FFmpeg** (automatically detected)
- **OpenRouter API Key** ([get one here](https://openrouter.ai/keys))

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/ariadne.git
cd ariadne

# Install dependencies (includes automatic native module rebuild)
npm install

# Start development server
npm run dev
```

**Note**: The `postinstall` script automatically rebuilds native modules (like `better-sqlite3`) for your Electron version. If you encounter module version errors, run:

```bash
npm run postinstall  # or: npx electron-rebuild
```

### First Time Setup

1. **Launch Ariadne**: The app will open automatically
2. **Configure API Keys**: Press `⌘K` → "Open settings"
3. **Add OpenRouter Key**: Paste your API key from openrouter.ai
4. **Choose AI Model**: 
   - **DeepSeek R1**: ~$0.14/1M tokens (recommended for development)
   - **Claude Sonnet 4**: ~$3/1M tokens (highest quality)

### Process Your First Podcast

1. **Upload Media**: Drag & drop any audio/video file
2. **AI Analysis**: Watch as Ariadne transcribes and analyzes content
3. **Review Clips**: Browse AI-suggested clips with scores and reasoning
4. **Generate Content**: Automatic titles, descriptions, and thumbnails
5. **Export Reels**: Professional-quality clips ready for social media

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Electron + Node.js + SQLite
- **AI Services**: OpenRouter (DeepSeek R1 / Claude Sonnet 4) + Whisper
- **Video Processing**: FFmpeg with Node.js bindings
- **State Management**: Zustand
- **Build System**: Vite + Electron Builder

### Project Structure
```
src/
├── main/                   # Electron main process
│   ├── database/          # SQLite database layer
│   ├── services/          # AI, FFmpeg, config services
│   └── handlers/          # IPC request handlers
├── renderer/              # React frontend
│   ├── components/        # UI components
│   ├── pages/            # Route components
│   ├── stores/           # State management
│   └── styles/           # Tailwind CSS
└── shared/               # Shared types and utilities
```

## 🛠️ Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server with hot reload
npm run dev:vite         # Frontend only
npm run dev:electron     # Electron only

# Building
npm run build            # Build for production
npm run build:vite       # Build frontend
npm run build:electron   # Build Electron main process

# Quality
npm run lint             # ESLint
npm run typecheck        # TypeScript checking
npm test                # Run tests (when implemented)

# Distribution
npm run dist             # Package for current platform
npm run dist:mac         # Package for macOS
npm run dist:win         # Package for Windows
```

### Development Environment

1. **Clone and Install**:
   ```bash
   git clone <repository-url>
   cd ariadne
   npm install
   ```

2. **Environment Setup**:
   - Ensure FFmpeg is installed and in PATH
   - Get OpenRouter API key for AI services
   - Node.js 18+ required

3. **Start Development**:
   ```bash
   npm run dev
   ```

4. **Code Quality**:
   ```bash
   npm run typecheck  # Check TypeScript
   npm run lint       # Check code style
   ```

## 🔒 Security & Privacy

### Data Protection
- **Local Processing**: All content analysis happens on your machine
- **Encrypted API Keys**: Stored with AES encryption using electron-store
- **No Telemetry**: No user data or usage analytics collected
- **Privacy First**: Your content never leaves your computer

### Security Features
- Comprehensive .gitignore prevents accidental secret commits
- Input validation and sanitization throughout
- Parameterized database queries prevent SQL injection
- HTTPS-only API communication
- Error handling that doesn't expose sensitive data

See [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for complete security analysis.

## 💰 Cost Estimation

### AI Processing Costs (per 60-minute episode)
- **Transcription (Whisper)**: ~$0.36 (fixed)
- **Analysis (DeepSeek R1)**: ~$0.50 (development)
- **Analysis (Claude Sonnet 4)**: ~$10.50 (production)
- **Content Generation**: ~$0.30-$6.00 (depends on model)

**Total per episode**: $1.16 (dev) to $16.86 (production)

### Optimization Tips
- Use DeepSeek R1 for development and testing
- Claude Sonnet 4 for final production clips
- Batch processing reduces API overhead
- Results cached to avoid re-processing

## 🎯 Roadmap

### Phase 1: MVP (Current)
- [x] Core AI pipeline (transcription + analysis)
- [x] Basic UI with clip review
- [x] Local database and settings
- [x] FFmpeg video processing
- [x] Export functionality

### Phase 2: Enhancement
- [ ] Advanced editing tools
- [ ] Template system for consistent branding
- [ ] Multi-speaker detection
- [ ] Performance analytics integration

### Phase 3: Professional
- [ ] Team collaboration features
- [ ] Direct platform publishing (Instagram, TikTok, YouTube)
- [ ] Advanced AI with custom model fine-tuning
- [ ] Enterprise security and compliance

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details.

### Development Setup for Contributors

1. **Fork and Clone**:
   ```bash
   git fork https://github.com/original-owner/ariadne.git
   git clone https://github.com/your-username/ariadne.git
   ```

2. **Create Feature Branch**:
   ```bash
   git checkout -b feature/amazing-feature
   ```

3. **Make Changes and Test**:
   ```bash
   npm run typecheck
   npm run lint
   npm run build
   ```

4. **Submit Pull Request**:
   - Ensure security review passed
   - Add tests for new features
   - Update documentation as needed

## 📋 System Requirements

### Minimum Requirements
- **OS**: macOS 10.15+, Windows 10+, or Linux (Ubuntu 18.04+)
- **RAM**: 4GB (8GB recommended)
- **Storage**: 2GB free space
- **Internet**: Required for AI processing

### Recommended Specs
- **RAM**: 8GB+ for smooth processing of large files
- **Storage**: SSD recommended for faster processing
- **CPU**: Multi-core processor for parallel processing

## 🆘 Support & Troubleshooting

### Common Issues

**"FFmpeg not found"**
- Install FFmpeg and ensure it's in your system PATH
- macOS: `brew install ffmpeg`
- Windows: Download from ffmpeg.org
- Linux: `sudo apt install ffmpeg`

**"Processing failed"**
- Check OpenRouter API key is valid
- Ensure internet connection for AI services
- Verify file format is supported (MP4, MOV, MP3, WAV, M4A, AAC)

**"Out of memory"**
- Large files (>1GB) may require more RAM
- Consider splitting long episodes into segments
- Close other memory-intensive applications

### Getting Help

- 📖 **Documentation**: Check this README and security audit
- 🐛 **Bug Reports**: [Open an issue](https://github.com/your-username/ariadne/issues)
- 💡 **Feature Requests**: [Start a discussion](https://github.com/your-username/ariadne/discussions)
- 🗨️ **Community**: Join our Discord (coming soon)

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🙏 Acknowledgments

- **Whisper**: OpenAI's speech recognition model
- **OpenRouter**: AI model access platform
- **Electron**: Cross-platform desktop framework
- **FFmpeg**: Multimedia processing library
- **React**: UI framework
- **Fey.com**: UI/UX design inspiration

---

**Ariadne** - Guiding creators through the labyrinth of content to find the golden moments worth sharing.

*Built with ❤️ for the creator community*