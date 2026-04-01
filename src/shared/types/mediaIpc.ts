export interface GetClipWaveformRequestDTO {
  episodeId: string
  startTime: number
  duration: number
  samples?: number
}

export interface ClipWaveformDTO {
  peaks: number[]
}

export type GetClipWaveformResponseDTO = ClipWaveformDTO
