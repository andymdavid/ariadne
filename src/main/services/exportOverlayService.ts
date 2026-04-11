import { BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { pathToFileURL } from 'url'
import ffmpeg from 'fluent-ffmpeg'
import type { ExportCaptionOverlayAsset, ExportCaptionOverlayFrame, ExportCaptionSegment, ExportCaptionStyle } from '@shared/types/exportWorker'
import { getCanonicalPreviewCanvas } from '../../shared/previewCanvas'

type Resolution = { width: number; height: number }

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const getFontFamilyValue = (fontFamily: string) =>
  `"${fontFamily}", "Hedvig Letters Sans", system-ui, sans-serif`

class ExportOverlayService {
  private tempDir: string
  private renderWindow: BrowserWindow | null = null
  private fontsDir: string

  constructor() {
    const userDataPath = process.env.ARIADNE_USER_DATA_PATH || process.cwd()
    this.tempDir = join(userDataPath, 'temp', 'export-overlays')
    this.fontsDir = process.env.ARIADNE_FONTS_DIR || join(process.cwd(), 'assets', 'fonts')
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
          await this.writeCaptionPng(imagePath, words.map((word) => word.word), activeIndex, style, resolution)
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
      await this.writeCaptionPng(imagePath, fallbackWords, 0, style, resolution)
      frames.push({
        imagePath,
        start: segment.start,
        end: segment.end
      })
    }

    return frames
  }

  async renderCaptionOverlayAsset(
    clipId: string,
    segments: ExportCaptionSegment[],
    style: ExportCaptionStyle,
    resolution: Resolution,
    duration: number
  ): Promise<ExportCaptionOverlayAsset | undefined> {
    const frames = await this.renderCaptionOverlayFrames(clipId, segments, style, resolution)
    if (!frames.length) return undefined

    const previewCanvas = getCanonicalPreviewCanvas(
      resolution.width === 1920 ? '16:9' : resolution.height === 1080 ? '1:1' : '9:16'
    )
    const blankPath = join(this.tempDir, `${clipId}_blank.png`)
    await this.writeBlankPng(blankPath, previewCanvas)

    const manifestPath = join(this.tempDir, `${clipId}_overlay.txt`)
    const videoPath = join(this.tempDir, `${clipId}_overlay.mov`)
    const cleanupPaths = [blankPath, manifestPath, videoPath, ...frames.map((frame) => frame.imagePath)]

    const entries: Array<{ path: string; duration: number }> = []
    let cursor = 0

    for (const frame of frames) {
      if (frame.start > cursor) {
        entries.push({ path: blankPath, duration: frame.start - cursor })
      }
      entries.push({ path: frame.imagePath, duration: Math.max(0.01, frame.end - frame.start) })
      cursor = frame.end
    }

    if (duration > cursor) {
      entries.push({ path: blankPath, duration: Math.max(0.01, duration - cursor) })
    }

    if (!entries.length) {
      this.cleanupPaths(cleanupPaths)
      return undefined
    }

    const manifestLines: string[] = []
    entries.forEach((entry, index) => {
      manifestLines.push(`file '${entry.path.replace(/'/g, "'\\''")}'`)
      manifestLines.push(`duration ${entry.duration.toFixed(6)}`)
      if (index === entries.length - 1) {
        manifestLines.push(`file '${entry.path.replace(/'/g, "'\\''")}'`)
      }
    })
    writeFileSync(manifestPath, manifestLines.join('\n'), 'utf8')

    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(manifestPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-vsync vfr', '-pix_fmt argb'])
        .videoCodec('qtrle')
        .output(videoPath)
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .run()
    })

    return {
      videoPath,
      cleanupPaths
    }
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

  cleanupPaths(paths: string[] = []) {
    for (const path of paths) {
      try {
        if (path && existsSync(path)) {
          unlinkSync(path)
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  private async writeCaptionPng(
    outputPath: string,
    words: string[],
    activeIndex: number,
    style: ExportCaptionStyle,
    resolution: Resolution
  ) {
    const previewCanvas = getCanonicalPreviewCanvas(
      resolution.width === 1920 ? '16:9' : resolution.height === 1080 ? '1:1' : '9:16'
    )
    const html = this.buildCaptionHtml(words, activeIndex, style, resolution)
    const window = await this.getRenderWindow(previewCanvas)
    const htmlJson = JSON.stringify(html)
    await window.webContents.executeJavaScript(`
      document.open();
      document.write(${htmlJson});
      document.close();
      document.fonts ? document.fonts.ready.then(() => true) : Promise.resolve(true);
    `)
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: previewCanvas.width, height: previewCanvas.height })
    writeFileSync(outputPath, image.toPNG())
  }

  private async writeBlankPng(
    outputPath: string,
    previewCanvas: { width: number; height: number }
  ) {
    const window = await this.getRenderWindow(previewCanvas)
    await window.webContents.executeJavaScript(`
      document.open();
      document.write('<!doctype html><html><body style="margin:0;width:${previewCanvas.width}px;height:${previewCanvas.height}px;background:transparent;"></body></html>');
      document.close();
    `)
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: previewCanvas.width, height: previewCanvas.height })
    writeFileSync(outputPath, image.toPNG())
  }

  private async getRenderWindow(resolution: Resolution) {
    if (!this.renderWindow || this.renderWindow.isDestroyed()) {
      this.renderWindow = new BrowserWindow({
        width: resolution.width,
        height: resolution.height,
        show: false,
        frame: false,
        transparent: true,
        webPreferences: {
          backgroundThrottling: false
        }
      })
      await this.renderWindow.loadURL('about:blank')
    } else {
      this.renderWindow.setContentSize(resolution.width, resolution.height)
    }

    return this.renderWindow
  }

  private buildCaptionHtml(
    words: string[],
    activeIndex: number,
    style: ExportCaptionStyle,
    resolution: Resolution
  ) {
    const previewCanvas = getCanonicalPreviewCanvas(
      resolution.width === 1920 ? '16:9' : resolution.height === 1080 ? '1:1' : '9:16'
    )
    const fontSize = Math.max(12, Math.round(style.size))
    const paddingX = Math.max(0, Math.round(style.backgroundPaddingX ?? 24))
    const paddingY = Math.max(0, Math.round(style.backgroundPaddingY ?? 12))
    const radius = Math.max(0, Math.round(style.backgroundRadius ?? 16))
    const fontWeight = Number(style.weight || 700)
    const strokeWidth = Math.max(0, Math.round(style.outlineWidth ?? 0))
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
      ? `${style.shadowOffsetX ?? 0}px ${style.shadowOffsetY ?? 0}px ${Math.max(0, style.shadowBlur ?? 0)}px ${style.shadowColor || '#000000'}`
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
    const containerMaxWidth = Math.max(96, Math.round((previewCanvas.width * 0.72)))
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
      `font-family:${escapeXml(getFontFamilyValue(style.font))}`,
      `font-size:${fontSize}px`,
      `font-weight:${fontWeight}`,
      `font-style:${style.italic ? 'italic' : 'normal'}`,
      `text-decoration:${style.underline ? 'underline' : 'none'}`,
      `line-height:${lineHeight}`,
      `color:${escapeXml(style.color)}`,
      strokeWidth > 0 ? `-webkit-text-stroke:${strokeWidth}px ${escapeXml(style.outlineColor)}` : '',
      shadowEnabled ? `text-shadow:${textShadow}` : ''
    ].filter(Boolean).join(';')

    const fontFaceCss = this.buildFontFaceCss(style.font, fontWeight)

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      ${fontFaceCss}
      html, body {
        margin: 0;
        width: ${previewCanvas.width}px;
        height: ${previewCanvas.height}px;
        overflow: hidden;
        background: transparent;
      }
      body {
        position: relative;
      }
    </style>
  </head>
  <body>
    <div style="${wrapperStyle}">
      <div style="${cardStyle}">
        <span style="${textStyle}">${wordMarkup}</span>
      </div>
    </div>
  </body>
</html>`
  }

  private buildFontFaceCss(fontFamily: string, fontWeight: number) {
    const sources: string[] = []
    const resolvedPrimary = this.resolveFontFile(fontFamily, fontWeight)
    if (resolvedPrimary) {
      sources.push(`@font-face { font-family: '${fontFamily}'; src: url('${pathToFileURL(resolvedPrimary).href}') format('truetype'); font-weight: ${fontWeight}; font-style: normal; }`)
    }

    if (fontFamily === 'Inter') {
      ;([
        [400, 'Inter-Regular.ttf'],
        [500, 'Inter-Medium.ttf'],
        [600, 'Inter-SemiBold.ttf'],
        [700, 'Inter-Bold.ttf'],
        [800, 'Inter-ExtraBold.ttf'],
        [900, 'Inter-Black.ttf']
      ] as Array<[number, string]>).forEach(([weight, file]) => {
        const filePath = join(this.fontsDir, file)
        if (existsSync(filePath)) {
          sources.push(`@font-face { font-family: 'Inter'; src: url('${pathToFileURL(filePath).href}') format('truetype'); font-weight: ${weight}; font-style: normal; }`)
        }
      })
    }

    if (fontFamily === 'Anton') {
      const filePath = join(this.fontsDir, 'Anton-Regular.ttf')
      if (existsSync(filePath)) {
        sources.push(`@font-face { font-family: 'Anton'; src: url('${pathToFileURL(filePath).href}') format('truetype'); font-weight: 400 900; font-style: normal; }`)
      }
    }

    return sources.join('\n')
  }

  private resolveFontFile(fontFamily: string, fontWeight: number) {
    const fileName = this.mapWeightToFontFileName(fontFamily, fontWeight)
    const filePath = join(this.fontsDir, fileName)
    return existsSync(filePath) ? filePath : null
  }

  private mapWeightToFontFileName(baseFont: string, weight: number) {
    if (baseFont === 'Inter') {
      if (weight <= 150) return 'Inter-Thin.ttf'
      if (weight <= 250) return 'Inter-ExtraLight.ttf'
      if (weight <= 350) return 'Inter-Light.ttf'
      if (weight <= 450) return 'Inter-Regular.ttf'
      if (weight <= 550) return 'Inter-Medium.ttf'
      if (weight <= 650) return 'Inter-SemiBold.ttf'
      if (weight <= 750) return 'Inter-Bold.ttf'
      if (weight <= 850) return 'Inter-ExtraBold.ttf'
      return 'Inter-Black.ttf'
    }

    if (baseFont === 'Anton') {
      return 'Anton-Regular.ttf'
    }

    return `${baseFont}.ttf`
  }
}

export const exportOverlayService = new ExportOverlayService()
