import React from 'react'

interface MainContentPanelProps {
  children: React.ReactNode
  className?: string
}

export function MainContentPanel({ children, className = '' }: MainContentPanelProps) {
  return (
    <div className="main-content-container">
      <div className={`main-content-panel ${className}`}>
        {children}
      </div>
    </div>
  )
}