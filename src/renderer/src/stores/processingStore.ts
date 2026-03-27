import { create } from 'zustand'
import type { ProcessingProgress } from '@shared/types'

interface ProcessingStore extends ProcessingProgress {
  isProcessing: boolean
  activeJobId?: string
  setProcessing: (processing: boolean) => void
  setActiveJobId: (jobId?: string) => void
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
  activeJobId: undefined,
  
  setProcessing: (processing) => set({ isProcessing: processing }),

  setActiveJobId: (jobId) => set({ activeJobId: jobId }),
  
  updateProgress: (update) => set((state) => ({
    ...state,
    ...update,
  })),
  
  reset: () => set({
    ...initialState,
    isProcessing: false,
    activeJobId: undefined,
  }),
}))
