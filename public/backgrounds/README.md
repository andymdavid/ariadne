# Background Images

This folder contains background images that appear behind the glassmorphic UI panels.

## 📁 File Structure

Place your background images in this folder with the following naming convention:

```
public/backgrounds/
  ├── bg-default.png    (Required - Home screen / fallback)
  ├── bg-review.png     (Optional - Review/Suggested Clips screen)
  ├── bg-content.png    (Optional - Content screen)
  ├── bg-export.png     (Optional - Export screen)
  └── bg-library.png    (Optional - Library screen)
```

## 🎨 Image Specifications

**Recommended Settings:**
- **Format:** JPG or PNG
- **Resolution:** 2560×1440 (or 1920×1080 minimum)
- **File Size:** Under 500KB for optimal performance
- **Aspect Ratio:** 16:9 or similar widescreen format

**Style Guidelines:**
- Choose images with good contrast variety
- Avoid images with too much fine detail (will be blurred)
- Dark or muted tones work best for readability
- Consider the glassmorphic panels will overlay the image

## 🔧 How It Works

1. **Glassmorphic Effect:**
   - Background images are displayed at full width/height
   - A subtle dark gradient overlay is applied for readability
   - Glassmorphic UI panels use `backdrop-filter: blur(16px)` to blur the background
   - Semi-transparent panels let the background show through

2. **Route-Based Switching:**
   - Different backgrounds load based on the current screen
   - Smooth 0.6s fade transition between images
   - Falls back to `bg-default.jpg` if a specific image is missing

3. **Fallback Behavior:**
   - If a route-specific image is missing, uses `bg-default.jpg`
   - If `bg-default.jpg` is missing, displays the default dark background

## 🚀 Adding Your Images

1. Place your images in this folder (`public/backgrounds/`)
2. Name them according to the convention above
3. Restart the app to see your backgrounds

**Quick Start:**
```bash
# Add your default background
cp /path/to/your/image.png public/backgrounds/bg-default.png

# Optional: Add route-specific backgrounds
cp /path/to/review-bg.png public/backgrounds/bg-review.png
```

## 🎯 Tips

- Start with just `bg-default.png` to test the effect
- Add route-specific images only if you want different backgrounds per screen
- Use tools like ImageOptim or TinyPNG to compress images
- Test readability of text overlays before finalizing images

## ⚙️ Configuration

To disable route-based backgrounds and use only the default:

Edit `src/renderer/src/components/Layout.tsx`:
```tsx
<BackgroundImage useRouteBasedImages={false} />
```

To change the default image path:
```tsx
<BackgroundImage defaultImage="/backgrounds/my-custom-bg.png" />
```