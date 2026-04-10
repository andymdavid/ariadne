import { nativeImage } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import type { ExportCaptionOverlayFrame, ExportCaptionSegment, ExportCaptionStyle } from '@shared/types/exportWorker'

type Resolution = { width: number; height: number }

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const estimateTextWidth = (text: string, fontSize: number, fontWeight = 700) => {
  const weightFactor = fontWeight >= 700 ? 0.62 : 0.58
  return text.length * fontSize * weightFactor
}

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

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex]
      const words = Array.isArray(segment.words) ? segment.words.filter((word) => word.word?.trim()) : []

      if (words.length > 0) {
        for (let activeIndex = 0; activeIndex < words.length; activeIndex += 1) {
          const activeWord = words[activeIndex]
          const imagePath = join(this.tempDir, `${clipId}_${segmentIndex}_${activeIndex}.png`)
          this.writeCaptionPng(imagePath, words.map((word) => word.word), activeIndex, style, resolution)
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
      this.writeCaptionPng(imagePath, fallbackWords, 0, style, resolution)
      frames.push({
        imagePath,
        start: segment.start,
        end: segment.end
      })
    }

    return frames
  }

  private writeCaptionPng(
    outputPath: string,
    words: string[],
    activeIndex: number,
    style: ExportCaptionStyle,
    resolution: Resolution
  ) {
    const svg = this.buildCaptionSvg(words, activeIndex, style, resolution)
    const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    const image = nativeImage.createFromDataURL(dataUrl)
    writeFileSync(outputPath, image.toPNG())
  }

  private buildCaptionSvg(
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
    const fontWeight = Number(style.weight || 700)
    const lineHeight = style.lineMode === 'three-lines' ? fontSize * 1.28 : fontSize
    const strokeWidth = Math.max(0, Math.round((style.outlineWidth ?? 0) * uiToOutputScale))
    const shadowEnabled = Boolean(style.shadow)

    const wordWidths = words.map((word) => estimateTextWidth(word, fontSize, fontWeight))
    const spaceWidth = estimateTextWidth(' ', fontSize, fontWeight)
    const textWidth = wordWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, words.length - 1) * spaceWidth
    const bubbleWidth = Math.ceil(textWidth + paddingX * 2)
    const bubbleHeight = Math.ceil(lineHeight + paddingY * 2)

    const x =
      style.position === 'custom' && style.customX != null
        ? Math.round((style.customX / 100) * resolution.width - bubbleWidth / 2)
        : Math.round((resolution.width - bubbleWidth) / 2)
    const y =
      style.position === 'top'
        ? Math.round(resolution.height * 0.12)
        : style.position === 'center'
          ? Math.round((resolution.height - bubbleHeight) / 2)
          : style.position === 'custom' && style.customY != null
            ? Math.round((style.customY / 100) * resolution.height - bubbleHeight / 2)
            : Math.round(resolution.height * 0.88 - bubbleHeight)

    let cursorX = x + paddingX
    const textY = y + paddingY + fontSize * 0.84
    const tspans = words.map((word, index) => {
      const tspan = `<tspan x="${cursorX}" y="${textY}" fill="${escapeXml(index === activeIndex ? (style.highlightColor || style.color) : (style.textColor || style.color))}">${escapeXml(word)}</tspan>`
      cursorX += wordWidths[index] + spaceWidth
      return tspan
    }).join('')

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${resolution.width}" height="${resolution.height}" viewBox="0 0 ${resolution.width} ${resolution.height}">
  <defs>
    ${shadowEnabled ? `<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="${(style.shadowOffsetX ?? 0) * uiToOutputScale}" dy="${(style.shadowOffsetY ?? 0) * uiToOutputScale}" stdDeviation="${Math.max(0, (style.shadowBlur ?? 0) * uiToOutputScale / 2)}" flood-color="${escapeXml(style.shadowColor || '#000000')}" />
    </filter>` : ''}
  </defs>
  ${style.background ? `<rect x="${x}" y="${y}" width="${bubbleWidth}" height="${bubbleHeight}" rx="${radius}" ry="${radius}" fill="${escapeXml(style.backgroundColor)}" />` : ''}
  <text
    font-family="${escapeXml(style.font)}"
    font-size="${fontSize}"
    font-weight="${fontWeight}"
    font-style="${style.italic ? 'italic' : 'normal'}"
    text-decoration="${style.underline ? 'underline' : 'none'}"
    stroke="${strokeWidth > 0 ? escapeXml(style.outlineColor) : 'transparent'}"
    stroke-width="${strokeWidth}"
    paint-order="stroke fill"
    ${shadowEnabled ? 'filter="url(#shadow)"' : ''}
  >${tspans}</text>
</svg>`
  }
}

export const exportOverlayService = new ExportOverlayService()
