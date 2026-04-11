import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import type { ExportCaptionOverlayFrame, ExportCaptionSegment, ExportCaptionStyle } from '@shared/types/exportWorker'

type Resolution = { width: number; height: number }

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

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

  cleanupOverlayFrames(frames: ExportCaptionOverlayFrame[] = []) {
    for (const frame of frames) {
      try {
        if (frame?.imagePath && existsSync(frame.imagePath)) {
          unlinkSync(frame.imagePath)
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  private writeCaptionPng(
    outputPath: string,
    words: string[],
    activeIndex: number,
    style: ExportCaptionStyle,
    resolution: Resolution
  ) {
    const svg = this.buildCaptionSvg(words, activeIndex, style, resolution)
    try {
      const electronModule = require('electron') as { nativeImage?: { createFromDataURL: (dataUrl: string) => { toPNG: () => Buffer } } }
      if (electronModule?.nativeImage?.createFromDataURL) {
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        const image = electronModule.nativeImage.createFromDataURL(dataUrl)
        writeFileSync(outputPath, image.toPNG())
        return
      }
    } catch {
      // Fall through to CLI rasterization in worker contexts.
    }

    const svgPath = outputPath.replace(/\.png$/i, '.svg')
    writeFileSync(svgPath, svg, 'utf8')

    try {
      execFileSync('/usr/bin/sips', ['-s', 'format', 'png', svgPath, '--out', outputPath], {
        stdio: 'ignore'
      })
    } finally {
      try {
        if (existsSync(svgPath)) {
          unlinkSync(svgPath)
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
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
    const strokeWidth = Math.max(0, Math.round((style.outlineWidth ?? 0) * uiToOutputScale))
    const shadowEnabled = Boolean(style.shadow)
    const lineHeight = style.lineMode === 'three-lines' ? '1.28' : 'normal'
    const left = style.position === 'custom' && style.customX != null ? `${style.customX}%` : '50%'
    const top =
      style.position === 'top'
        ? '12%'
        : style.position === 'center'
          ? '50%'
          : style.position === 'custom' && style.customY != null
            ? `${style.customY}%`
            : undefined
    const bottom =
      style.position === 'bottom'
        ? '12%'
        : style.position === 'custom' && style.customY == null
          ? '12%'
          : undefined
    const transform =
      style.position === 'center'
        ? 'translate(-50%, -50%)'
        : 'translateX(-50%)'
    const textShadow = shadowEnabled
      ? `${(style.shadowOffsetX ?? 0) * uiToOutputScale}px ${(style.shadowOffsetY ?? 0) * uiToOutputScale}px ${Math.max(0, (style.shadowBlur ?? 0) * uiToOutputScale)}px ${style.shadowColor || '#000000'}`
      : 'none'
    const wordMarkup = words
      .map((word, index) => {
        const color = index === activeIndex
          ? (style.highlightColor || style.color)
          : (style.textColor || style.color)
        const suffix = index < words.length - 1 ? '&nbsp;' : ''
        return `<span style="color:${escapeXml(color)};">${escapeXml(word)}${suffix}</span>`
      })
      .join('')
    const containerMaxWidth = Math.max(96, Math.round((resolution.width * 0.72)))
    const wrapperStyle = [
      'position:absolute',
      `left:${left}`,
      top ? `top:${top}` : '',
      bottom ? `bottom:${bottom}` : '',
      `transform:${transform}`,
      'text-align:center',
      'z-index:25'
    ].filter(Boolean).join(';')
    const cardStyle = [
      'display:inline-block',
      style.lineMode === 'one-line' ? 'white-space:nowrap' : 'white-space:normal',
      style.lineMode === 'three-lines' ? `max-width:${containerMaxWidth}px` : '',
      style.background ? `background:${style.backgroundColor}` : 'background:transparent',
      style.background ? `padding:${paddingY}px ${paddingX}px` : 'padding:0',
      style.background ? `border-radius:${radius}px` : 'border-radius:0',
      'text-align:center'
    ].filter(Boolean).join(';')
    const textStyle = [
      'display:inline-block',
      style.lineMode === 'three-lines' ? 'white-space:pre-line' : 'white-space:nowrap',
      `font-family:${escapeXml(style.font)}, sans-serif`,
      `font-size:${fontSize}px`,
      `font-weight:${fontWeight}`,
      `font-style:${style.italic ? 'italic' : 'normal'}`,
      `text-decoration:${style.underline ? 'underline' : 'none'}`,
      `line-height:${lineHeight}`,
      `color:${escapeXml(style.color)}`,
      strokeWidth > 0 ? `-webkit-text-stroke:${strokeWidth}px ${escapeXml(style.outlineColor)}` : '',
      shadowEnabled ? `text-shadow:${textShadow}` : ''
    ].filter(Boolean).join(';')

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${resolution.width}" height="${resolution.height}" viewBox="0 0 ${resolution.width} ${resolution.height}">
  <foreignObject x="0" y="0" width="${resolution.width}" height="${resolution.height}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="position:relative;width:${resolution.width}px;height:${resolution.height}px;">
      <div style="${wrapperStyle}">
        <div style="${cardStyle}">
          <span style="${textStyle}">${wordMarkup}</span>
        </div>
      </div>
    </div>
  </foreignObject>
</svg>`
  }
}

export const exportOverlayService = new ExportOverlayService()
