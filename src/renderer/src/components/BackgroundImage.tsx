import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSettingsStore } from '../stores/settingsStore'

interface BackgroundImageProps {
  defaultImage?: string
  useRouteBasedImages?: boolean
}

export function BackgroundImage({
  defaultImage = '/backgrounds/bg-default.png',
  useRouteBasedImages = true
}: BackgroundImageProps) {
  const location = useLocation()
  const backgroundImagesEnabled = useSettingsStore((state) => state.backgroundImagesEnabled)
  const [currentImage, setCurrentImage] = useState<string>(defaultImage)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Map routes to background images
  const getBackgroundForRoute = (pathname: string): string => {
    if (!useRouteBasedImages) return defaultImage

    // Extract route from pathname
    if (pathname === '/') return '/backgrounds/bg-default.png'
    if (pathname.startsWith('/review/')) return '/backgrounds/bg-review.png'
    if (pathname.startsWith('/content/')) return '/backgrounds/bg-content.png'
    if (pathname.startsWith('/export/')) return '/backgrounds/bg-export.png'
    if (pathname === '/library') return '/backgrounds/bg-library.png'

    return defaultImage
  }

  // Update background when route changes
  useEffect(() => {
    const newImage = getBackgroundForRoute(location.pathname)
    console.log('Loading background image:', newImage)

    // Preload image before switching
    const img = new Image()
    img.onload = () => {
      console.log('Background image loaded successfully:', newImage)
      setCurrentImage(newImage)
      setImageLoaded(true)
    }
    img.onerror = (error) => {
      // Fallback to default if image fails to load
      console.error(`Background image failed to load: ${newImage}`, error)
      console.warn('Attempting to load default image:', defaultImage)

      // If the failed image is already the default, just mark as loaded
      if (newImage === defaultImage) {
        console.warn('Default image also failed to load, proceeding without background')
        setImageLoaded(true)
      } else {
        // Try loading the default
        setCurrentImage(defaultImage)
        setImageLoaded(true)
      }
    }
    img.src = newImage
  }, [location.pathname, defaultImage, useRouteBasedImages])

  // Don't render anything if background images are disabled (dark mode)
  if (!backgroundImagesEnabled) {
    return null
  }

  return (
    <div className="background-image-container">
      {/* Background Image */}
      <div
        className={`background-image ${imageLoaded ? 'loaded' : ''}`}
        style={{
          backgroundImage: `url(${currentImage})`
        }}
      />

      {/* Subtle dark overlay for readability */}
      <div className="background-overlay" />
    </div>
  )
}