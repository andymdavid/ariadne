import { ReactNode, useEffect } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const backgroundImagesEnabled = useSettingsStore((state) => state.backgroundImagesEnabled)

  // Apply dark-mode class to body when backgrounds are disabled
  useEffect(() => {
    if (backgroundImagesEnabled) {
      document.body.classList.remove('dark-mode')
    } else {
      document.body.classList.add('dark-mode')
    }
  }, [backgroundImagesEnabled])

  return (
    <div className="h-screen overflow-hidden bg-[#0a0b0f] text-text-primary">
      <main className="h-full overflow-hidden">
        {children}
      </main>
    </div>
  )
}
