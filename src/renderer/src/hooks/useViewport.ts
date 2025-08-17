import { useEffect, useState } from 'react'

interface ViewportDimensions {
  width: number
  height: number
  availableHeight: number // Height minus command bar space
}

export function useViewport() {
  const [dimensions, setDimensions] = useState<ViewportDimensions>({
    width: window.innerWidth,
    height: window.innerHeight,
    availableHeight: window.innerHeight - 104 // 56px bar + 48px margins
  })

  useEffect(() => {
    const handleResize = () => {
      const newDimensions = {
        width: window.innerWidth,
        height: window.innerHeight,
        availableHeight: window.innerHeight - 104
      }
      setDimensions(newDimensions)
    }

    // Set up resize listener
    window.addEventListener('resize', handleResize)
    
    // Initial setup to prevent scrolling
    setupNoScrollViewport()
    
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  return dimensions
}

// Utility function to enforce no-scroll viewport
export function setupNoScrollViewport() {
  // Prevent scrolling on body and html
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
  
  // Ensure body and html take full viewport but account for dock space
  document.body.style.height = '100vh'
  document.body.style.width = '100vw'
  document.documentElement.style.height = '100vh'
  document.documentElement.style.width = '100vw'
  // Remove any default margins/padding
  document.body.style.margin = '0'
  document.body.style.padding = '0'
  document.documentElement.style.margin = '0'
  document.documentElement.style.padding = '0'
  
  console.log('Viewport setup complete - scrolling disabled')
}

// Hook for managing main content area height
export function useContentHeight() {
  const { availableHeight } = useViewport()
  
  useEffect(() => {
    const mainContent = document.querySelector('.main-content') as HTMLElement
    if (mainContent) {
      mainContent.style.height = `${availableHeight}px`
      mainContent.style.overflow = 'hidden'
    }
  }, [availableHeight])
  
  return availableHeight
}