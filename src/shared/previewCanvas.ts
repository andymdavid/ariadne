export type PreviewAspectRatio = '9:16' | '1:1' | '16:9'

export type PreviewCanvasSize = {
  width: number
  height: number
}

export type CaptionLayoutConfig = {
  maxLines: number
  widthRatio: number
  minWidth: number
  maxWidth?: number
  fontScale: number
  minFontSize: number
  maxFontSize: number
}

export const getCanonicalPreviewCanvas = (
  aspectRatio: PreviewAspectRatio
): PreviewCanvasSize => {
  switch (aspectRatio) {
    case '16:9':
      return { width: 640, height: 360 }
    case '1:1':
      return { width: 430, height: 430 }
    case '9:16':
    default:
      return { width: 300, height: 533 }
  }
}

export const getCaptionLayoutConfig = (
  presetId: string | null | undefined
): CaptionLayoutConfig => {
  switch (presetId) {
    case 'deep-diver':
      return {
        maxLines: 1,
        widthRatio: 0.7,
        minWidth: 150,
        fontScale: 0.06,
        minFontSize: 15,
        maxFontSize: 22
      }
    case 'karaoke':
      return {
        maxLines: 2,
        widthRatio: 0.78,
        minWidth: 180,
        maxWidth: 340,
        fontScale: 0.054,
        minFontSize: 14,
        maxFontSize: 20
      }
    case 'beasty':
      return {
        maxLines: 3,
        widthRatio: 0.82,
        minWidth: 190,
        maxWidth: 360,
        fontScale: 0.053,
        minFontSize: 14,
        maxFontSize: 20
      }
    case 'youshaei':
    case 'pod-p':
      return {
        maxLines: 2,
        widthRatio: 0.8,
        minWidth: 185,
        maxWidth: 350,
        fontScale: 0.052,
        minFontSize: 14,
        maxFontSize: 19
      }
    default:
      return {
        maxLines: 2,
        widthRatio: 0.78,
        minWidth: 180,
        maxWidth: 340,
        fontScale: 0.052,
        minFontSize: 14,
        maxFontSize: 19
      }
  }
}
