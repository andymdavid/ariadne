export type AspectRatio = '9:16' | '1:1' | '16:9'
export type CropMode = 'center' | 'fit' | 'blur'

export interface FrameSettings {
  aspectRatio: AspectRatio
  cropMode: CropMode
  // Center Crop settings
  cropPositionX?: number
  cropPositionY?: number
  // Canvas Fit settings
  zoomLevel?: number
  videoOffsetX?: number
  videoOffsetY?: number
}

export const DEFAULT_FRAME_SETTINGS: FrameSettings = {
  aspectRatio: '9:16',
  cropMode: 'center',
  cropPositionX: 50,
  cropPositionY: 50,
  zoomLevel: 1.0,
  videoOffsetX: 0,
  videoOffsetY: 0
}
