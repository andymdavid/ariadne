import { ReactNode } from 'react'
import { StatusBar } from './StatusBar'
import { Logo } from './Logo'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
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