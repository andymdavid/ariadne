import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import type { ExportCaptionOverlayFrame, ExportCaptionSegment, ExportCaptionStyle } from '@shared/types/exportWorker'

type Resolution = { width: number; height: number }

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

class ExportOverlayService {
  private tempDir: string

  constructor() {
    const userDataPath = process.env.ARIADNE_USER_DATA_PATH || process.cwd()
    this.tempDir = join(userDataPath, 'temp', 'export-overlays')
    if (!existsSync(this.tempDir)) {
      mkdirSync(this.tempDir, { recursive: true })
    }
  }

  async renderCaptionOverlayFrames(
    clipId: string,
    segments: ExportCaptionSegment[],
    style: ExportCaptionStyle,
    resolution: Resolution
  ): Promise<ExportCaptionOverlayFrame[]> {
    if (!segments.length) return []

    const frames: ExportCaptionOverlayFrame[] = []
    const window = new BrowserWindow({
      show: false,
      width: resolution.width,
      height: resolution.height,
      transparent: true,
      frame: false,
      useContentSize: true,
      webPreferences: {
        sandbox: false,
        backgroundThrottling: false
      }
    })

    try {
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex]
        const words = Array.isArray(segment.words) ? segment.words.filter((word) => word.word?.trim()) : []

        if (words.length > 0) {
          for (let activeIndex = 0; activeIndex < words.length; activeIndex += 1) {
            const activeWord = words[activeIndex]
            const imagePath = join(this.tempDir, `${clipId}_${segmentIndex}_${activeIndex}.png`)
            const html = this.buildCaptionHtml(words.map((word) => word.word), activeIndex, style, resolution)
            await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
            await new Promise((resolve) => setTimeout(resolve, 20))
            const image = await window.webContents.capturePage()
            writeFileSync(imagePath, image.toPNG())
            frames.push({
              imagePath,
              start: activeWord.start,
              end: activeWord.end
            })
          }
          continue
        }

        const fallbackWords = segment.text.split(/\s+/).filter(Boolean)
        const imagePath = join(this.tempDir, `${clipId}_${segmentIndex}_fallback.png`)
        const html = this.buildCaptionHtml(fallbackWords, 0, style, resolution)
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        await new Promise((resolve) => setTimeout(resolve, 20))
        const image = await window.webContents.capturePage()
        writeFileSync(imagePath, image.toPNG())
        frames.push({
          imagePath,
          start: segment.start,
          end: segment.end
        })
      }
    } finally {
      window.destroy()
    }

    return frames
  }

  private buildCaptionHtml(
    words: string[],
    activeIndex: number,
    style: ExportCaptionStyle,
    resolution: Resolution
  ) {
    const referencePreviewWidth =
      resolution.width === 1920 ? 640 : resolution.width === 1080 && resolution.height === 1080 ? 430 : 300
    const uiToOutputScale = resolution.width / referencePreviewWidth
    const fontSize = Math.max(12, Math.round(style.size * uiToOutputScale))
    const paddingX = Math.max(0, Math.round((style.backgroundPaddingX ?? 24) * uiToOutputScale))
    const paddingY = Math.max(0, Math.round((style.backgroundPaddingY ?? 12) * uiToOutputScale))
    const radius = Math.max(0, Math.round((style.backgroundRadius ?? 16) * uiToOutputScale))
    const strokeWidth = Math.max(0, (style.outlineWidth ?? 0) * uiToOutputScale)
    const shadowX = (style.shadowOffsetX ?? 0) * uiToOutputScale
    const shadowY = (style.shadowOffsetY ?? 0) * uiToOutputScale
    const shadowBlur = (style.shadowBlur ?? 0) * uiToOutputScale
    const maxWidth = Math.round(Math.min(resolution.width * 0.78, Math.max(280, resolution.width * 0.56)))

    const positionStyle =
      style.position === 'top'
        ? 'left:50%; top:12%; transform:translateX(-50%);'
        : style.position === 'center'
          ? 'left:50%; top:50%; transform:translate(-50%, -50%);'
          : style.position === 'custom' && style.customX != null && style.customY != null
            ? `left:${style.customX}%; top:${style.customY}%; transform:translate(-50%, -50%);`
            : 'left:50%; bottom:12%; transform:translateX(-50%);'

    const spans = words
      .map((word, index) => {
        const color = index === activeIndex ? (style.highlightColor || style.color) : (style.textColor || style.color)
        return `<span style="color:${color};">${escapeHtml(word)}</span>`
      })
      .join('<span style="color:transparent;"> </span>')

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: ${resolution.width}px;
        height: ${resolution.height}px;
        overflow: hidden;
        background: transparent;
      }
      body {
        position: relative;
        font-family: "${style.font}", "Hedvig Letters Sans", system-ui, sans-serif;
      }
      .caption {
        position: absolute;
        z-index: 2;
        ${positionStyle}
        max-width: ${maxWidth}px;
        white-space: ${style.lineMode === 'three-lines' ? 'normal' : 'nowrap'};
        text-align: center;
      }
      .bubble {
        display: inline-block;
        background: ${style.background ? style.backgroundColor : 'transparent'};
        padding: ${style.background ? `${paddingY}px ${paddingX}px` : '0'};
        border-radius: ${style.background ? `${radius}px` : '0'};
      }
      .text {
        display: inline-block;
        font-size: ${fontSize}px;
        font-weight: ${style.weight};
        font-style: ${style.italic ? 'italic' : 'normal'};
        text-decoration: none;
        line-height: ${style.lineMode === 'three-lines' ? '1.28' : 'normal'};
        -webkit-text-stroke: ${strokeWidth > 0 ? `${strokeWidth}px ${style.outlineColor}` : '0 transparent'};
        text-shadow: ${style.shadow ? `${shadowX}px ${shadowY}px ${shadowBlur}px ${style.shadowColor || '#000000'}` : 'none'};
      }
    </style>
  </head>
  <body>
    <div class="caption">
      <div class="bubble">
        <span class="text">${spans}</span>
      </div>
    </div>
  </body>
</html>`
  }
}

export const exportOverlayService = new ExportOverlayService()
