# Export Settings Audit
## Comparing: Edit Clip Modal Preview → Database → FFmpeg Export

Based on clip ID: `45cab42c-e86a-4b49-8f51-ee96672618d9`

---

## 📝 CAPTION SETTINGS

| Setting | Preview (Modal) | Database Value | Export Implementation | Status |
|---------|----------------|----------------|----------------------|--------|
| **Enabled** | ✅ | `captions_enabled: 1` | ✅ Checked | ✅ WORKING |
| **Font** | Inter | `caption_font: 'Inter'` | ✅ ASS Style | ✅ WORKING |
| **Size** | 76px | `caption_size: 76` | ✅ ASS Style | ✅ WORKING |
| **Color** | #FFFFFF | `caption_color: '#FFFFFF'` | ✅ ASS PrimaryColour | ✅ WORKING |
| **Position** | Custom (50.78%, 43.96%) | `caption_position: 'custom'`<br>`caption_custom_x: 50.78`<br>`caption_custom_y: 43.96` | ✅ ASS \pos() tag | ✅ WORKING |
| **Bold** | ✅ | `caption_bold: 1` | ✅ ASS Style Bold | ✅ WORKING |
| **Italic** | ❌ | `caption_italic: 0` | ✅ ASS Style Italic | ✅ WORKING |
| **Outline** | ❌ (disabled) | `caption_outline: 0` | ✅ ASS BorderStyle | ✅ WORKING |
| **Outline Color** | #000000 | `caption_outline_color: '#000000'` | ✅ ASS OutlineColour | ✅ WORKING |
| **Outline Width** | 2 | `caption_outline_width: 2` | ✅ ASS Outline | ✅ WORKING |
| **Shadow** | ❌ | `caption_shadow: 0` | ✅ ASS Shadow | ✅ WORKING |
| **Background** | ❌ | `caption_background: 0` | ✅ ASS BorderStyle | ✅ WORKING |
| **Background Color** | #000000 | `caption_background_color: '#000000'` | ✅ ASS BackColour | ✅ WORKING |
| **Background Opacity** | 0.5 | `caption_background_opacity: 0.5` | ✅ ASS BackColour alpha | ✅ WORKING |
| **Text Case** | UPPERCASE | `caption_text_case: 'uppercase'` | ✅ transformText() | ✅ WORKING |
| **Highlight Style** | word | `caption_highlight_style: 'word'` | ✅ Word splitting logic | ✅ WORKING |
| **Words Per Caption** | 2 | `caption_words_per_caption: 2` | ✅ Word group size | ✅ WORKING |
| **Max Width** | 100% | `caption_max_width: 100` | ⚠️ Line breaking logic | ⚠️ PARTIAL |
| **Line Height** | 1.2 | `caption_line_height: 1.2` | ❌ NOT IMPLEMENTED | ❌ **MISSING** |
| **Letter Spacing** | 0 | `caption_letter_spacing: 0` | ✅ ASS Spacing | ✅ WORKING |
| **Word Highlighting Effect** | Opacity 1.0 vs 0.6 on words | N/A (runtime effect) | ❌ NOT IMPLEMENTED | ❌ **MISSING** |

### 🔴 Caption Issues Found:
1. **Line Height**: Database has `caption_line_height: 1.2` but ASS export doesn't implement this
2. **Word Highlighting**: Preview shows first word at opacity 1.0, rest at 0.6 (animated effect). Export shows all words at same opacity

---

## 🖼️ LOGO SETTINGS

| Setting | Preview (Modal) | Database Value | Export Implementation | Status |
|---------|----------------|----------------|----------------------|--------|
| **Enabled** | ✅ | `logo_enabled: 1` | ✅ Checked | ✅ WORKING |
| **Logo Path** | .../TGS Logo_*.png | `logo_path: '/Users/.../TGS Logo_*.png'` | ✅ Input file | ✅ WORKING |
| **Position X** | 18.11% | `logo_position_x: 18.11` | ✅ FFmpeg overlay x | ✅ WORKING |
| **Position Y** | 19.18% | `logo_position_y: 19.18` | ✅ FFmpeg overlay y | ✅ WORKING |
| **Scale** | 0.25 (25%) | `logo_scale: 0.25` | ✅ FFmpeg scale filter | ✅ WORKING |
| **Opacity** | 1.0 (100%) | `logo_opacity: 1.0` | ✅ FFmpeg colorchannelmixer | ✅ WORKING |

### ✅ Logo: All settings working correctly!

---

## 🎵 MUSIC SETTINGS

| Setting | Preview (Modal) | Database Value | Export Implementation | Status |
|---------|----------------|----------------|----------------------|--------|
| **Enabled** | ✅ | `music_enabled: 1` | ✅ Checked | ✅ WORKING |
| **Music Path** | .../Digital Whispers_*.mp3 | `music_path: '/Users/.../Digital Whispers_*.mp3'` | ✅ Input file | ✅ WORKING |
| **Volume** | 0.05 (5%) | `music_volume: 0.05` | ✅ FFmpeg volume filter | ✅ WORKING |
| **Duck Volume** | 0.1 (10%) | `music_duck_volume: 0.1` | ⚠️ Used in amix weights | ⚠️ INCORRECT |
| **Duck Enabled** | ❌ (disabled) | `music_duck_enabled: 0` | ✅ Checked | ✅ WORKING |
| **Fade In** | 1.5s | `music_fade_in: 1.5` | ✅ FFmpeg afade | ✅ WORKING |
| **Fade Out** | 1.5s | `music_fade_out: 1.5` | ✅ FFmpeg afade | ✅ WORKING |
| **Loop** | ✅ | `music_loop: 1` | ❌ NOT IMPLEMENTED | ❌ **MISSING** |

### 🔴 Music Issues Found:
1. **Ducking Implementation**: Current implementation uses `amix weights` but doesn't actually duck during speech. Needs proper sidechaining or dynamic volume control
2. **Music Looping**: Database has `music_loop: 1` but FFmpeg doesn't loop the audio if music is shorter than video

---

## 📐 FRAME SETTINGS

| Setting | Preview (Modal) | Database Value | Export Implementation | Status |
|---------|----------------|----------------|----------------------|--------|
| **Aspect Ratio** | 9:16 | `aspect_ratio: '9:16'` | ✅ Resolution 1080x1920 | ✅ WORKING |
| **Crop Mode** | center | `crop_mode: 'center'` | ✅ FFmpeg crop filter | ✅ WORKING |
| **Crop Position X** | 53.91% | `crop_position_x: 53.91` | ✅ FFmpeg crop x calc | ✅ WORKING |
| **Crop Position Y** | 29.13% | `crop_position_y: 29.13` | ⚠️ Used but may be incorrect | ⚠️ NEEDS TESTING |

### ⚠️ Frame Issues:
1. **Crop Position Y**: The calculation uses `crop=ih*1080/1920:ih:X:0` - the Y position is hardcoded to 0, not using the `crop_position_y` value!

---

## 📊 SUMMARY

### ✅ Working (18/24):
- Caption segments with word-by-word timing
- Font, size, color, position
- Bold, italic, outline, shadow, background
- Text case transformation
- Logo overlay with position, scale, opacity
- Music mixing with fade in/out
- Frame aspect ratio and basic crop

### ⚠️ Partial (2/24):
- Caption max width (line breaking rough estimate)
- Music ducking (implemented but not dynamic)

### ❌ Missing (4/24):
1. **Caption line height** - not applied in ASS
2. **Word highlight effect** - no opacity/color variation between words
3. **Music looping** - doesn't loop if shorter than clip
4. **Crop Position Y** - not being used in center crop calculation

---

## 🔧 PRIORITY FIXES NEEDED:

### HIGH PRIORITY:
1. **Fix Crop Position Y** - Currently hardcoded to 0, should use `crop_position_y`
2. **Implement Word Highlighting** - Use ASS color tags to dim non-active words

### MEDIUM PRIORITY:
3. **Add Line Height** - Implement in ASS Spacing parameter
4. **Implement Music Looping** - Use FFmpeg loop filter for music input

### LOW PRIORITY:
5. **Improve Max Width** - Better line breaking algorithm
6. **Improve Ducking** - Implement proper audio sidechaining

