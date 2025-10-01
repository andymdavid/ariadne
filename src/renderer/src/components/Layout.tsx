import { ReactNode, useEffect } from 'react'
import { StatusBar } from './StatusBar'
import { Logo } from './Logo'
import { BackgroundImage } from './BackgroundImage'
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
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Background Image - behind all content */}
      <BackgroundImage />

      {/* Status Bar */}
      <StatusBar />

      {/* Logo */}
      <Logo />

      {/* Main Content Area - will be sized by App component */}
      <main className="flex-1 flex overflow-hidden">
        {children}
      </main>
    </div>
  )
}