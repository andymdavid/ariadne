import { create } from 'zustand'
import type { ProcessingProgress } from '@shared/types'

interface ProcessingStore extends ProcessingProgress {
  isProcessing: boolean
  setProcessing: (processing: boolean) => void
  updateProgress: (update: Partial<ProcessingProgress>) => void
  reset: () => void
}

const initialState: ProcessingProgress = {
  stage: 'uploading',
  progress: 0,
  message: 'Ready',
  recentTranscriptLines: [],
  partialTranscript: ''
}

export const useProcessingStore = create<ProcessingStore>((set) => ({
  ...initialState,
  isProcessing: false,
  
  setProcessing: (processing) => set({ isProcessing: processing }),
  
  updateProgress: (update) => set((state) => ({
    ...state,
    ...update,
  })),
  
  reset: () => set({
    ...initialState,
    isProcessing: false,
  }),
}))