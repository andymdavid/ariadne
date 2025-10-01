import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

// Settings state interface
export interface SettingsState {
  // UI Settings
  backgroundImagesEnabled: boolean

  // Future settings can go here
  // theme: 'light' | 'dark' | 'auto'
  // soundEnabled: boolean
  // etc.
}

// Actions interface for settings store
interface SettingsActions {
  setBackgroundImagesEnabled: (enabled: boolean) => void
  toggleBackgroundImages: () => void
}

// Initial state
const initialState: SettingsState = {
  backgroundImagesEnabled: true
}

// Create the settings store with persistence
export const useSettingsStore = create<SettingsState & SettingsActions>()(
  persist(
    (set, get) => ({
      ...initialState,

      setBackgroundImagesEnabled: (enabled) => {
        set({ backgroundImagesEnabled: enabled })
      },

      toggleBackgroundImages: () => {
        set((state) => ({ backgroundImagesEnabled: !state.backgroundImagesEnabled }))
      }
    }),
    {
      name: 'ariadne-settings-storage',
      storage: createJSONStorage(() => localStorage),
      version: 1
    }
  )
)
