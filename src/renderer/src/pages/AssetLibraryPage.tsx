import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  IoCloudUploadOutline,
  IoImagesOutline,
  IoMusicalNotesOutline,
  IoTextOutline
} from 'react-icons/io5'
import type { BrandTemplate } from '@shared/types'
import { MainContentPanel } from '../components/MainContentPanel'

type AssetKind = 'logo' | 'music'

const bundledFonts = ['Anton', 'Inter']

const formatFileName = (filePath: string) => filePath.split('/').pop() || filePath

export function AssetLibraryPage() {
  const [logos, setLogos] = useState<string[]>([])
  const [musicTracks, setMusicTracks] = useState<string[]>([])
  const [brandTemplate, setBrandTemplate] = useState<BrandTemplate | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState<AssetKind | null>(null)
  const [isUpdatingFont, setIsUpdatingFont] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const musicInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadAssets()
  }, [])

  const mediaCount = logos.length + musicTracks.length
  const recentUploads = useMemo(
    () =>
      [...logos, ...musicTracks]
        .map((path) => ({
          path,
          name: formatFileName(path),
          type: logos.includes(path) ? 'Logo' : 'Music'
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [logos, musicTracks]
  )

  const loadAssets = async () => {
    try {
      setIsLoading(true)

      const [loadedLogos, loadedMusic, loadedBrandTemplate] = await Promise.all([
        window.electronAPI?.listLogos?.() ?? Promise.resolve([]),
        window.electronAPI?.listMusic?.() ?? Promise.resolve([]),
        window.electronAPI?.getBrandTemplate?.() ?? Promise.resolve(null)
      ])

      setLogos(loadedLogos ?? [])
      setMusicTracks(loadedMusic ?? [])
      setBrandTemplate(loadedBrandTemplate)
    } catch (error) {
      console.error('Failed to load asset library:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleFileSelection = async (
    event: ChangeEvent<HTMLInputElement>,
    kind: AssetKind
  ) => {
    const file = event.target.files?.[0]
    if (!file) return

    await uploadAsset(file, kind)
    event.target.value = ''
  }

  const uploadAsset = async (file: File, kind: AssetKind) => {
    const validationError = validateAsset(file, kind)
    if (validationError) {
      alert(validationError)
      return
    }

    try {
      setIsUploading(kind)
      const base64Data = await readFileAsDataUrl(file)

      const result =
        kind === 'logo'
          ? await window.electronAPI?.uploadLogo?.(base64Data, file.name)
          : await window.electronAPI?.uploadMusic?.(base64Data, file.name)

      if (!result?.success) {
        throw new Error(result?.error || `Failed to upload ${kind}`)
      }

      await loadAssets()
    } catch (error) {
      console.error(`Failed to upload ${kind}:`, error)
      alert(error instanceof Error ? error.message : `Failed to upload ${kind}`)
    } finally {
      setIsUploading(null)
    }
  }

  const handleFontSelect = async (font: string) => {
    if (!brandTemplate) return

    try {
      setIsUpdatingFont(font)
      const updatedTemplate = await window.electronAPI?.updateBrandTemplate?.({
        caption: {
          ...brandTemplate.caption,
          font
        }
      })

      if (updatedTemplate) {
        setBrandTemplate(updatedTemplate)
      }
    } catch (error) {
      console.error('Failed to update brand template font:', error)
      alert('Failed to apply font to brand template')
    } finally {
      setIsUpdatingFont(null)
    }
  }

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex h-full flex-col gap-8">
          <div className="app-page-header">
            <div className="mx-auto w-full max-w-6xl">
              <div className="app-page-header-content">
                <div className="app-page-title">Asset Library</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">
                  Upload logos and music, then choose the default caption font that Brand Template will use.
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto grid min-h-0 h-full w-full max-w-6xl flex-1 grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] gap-6">
            <div className="flex min-h-0 flex-col gap-6">
              <section className="app-section-shell asset-library-shell">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Media</div>
                    <h2 className="app-section-title">Logos and music</h2>
                  </div>
                  <div className="app-chip">{mediaCount} reusable assets</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <AssetUploadPanel
                    title="Brand logos"
                    description="PNG, SVG, JPG, or WebP files shared across every clip."
                    icon={<IoImagesOutline size={18} />}
                    count={logos.length}
                    uploadLabel={isUploading === 'logo' ? 'Uploading...' : 'Upload logo'}
                    onUpload={() => logoInputRef.current?.click()}
                  />
                  <AssetUploadPanel
                    title="Music library"
                    description="Default beds and reusable tracks for auto-branding."
                    icon={<IoMusicalNotesOutline size={18} />}
                    count={musicTracks.length}
                    uploadLabel={isUploading === 'music' ? 'Uploading...' : 'Upload track'}
                    onUpload={() => musicInputRef.current?.click()}
                  />
                </div>

                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/svg+xml,image/jpeg,image/jpg,image/webp"
                  className="hidden"
                  onChange={(event) => void handleFileSelection(event, 'logo')}
                />
                <input
                  ref={musicInputRef}
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/m4a,.mp3,.wav,.m4a"
                  className="hidden"
                  onChange={(event) => void handleFileSelection(event, 'music')}
                />
              </section>

              <section className="app-section-shell asset-library-shell min-h-0 flex flex-1 flex-col">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Live Data</div>
                    <h2 className="app-section-title">Available uploads</h2>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                  {isLoading ? (
                    <div className="app-empty-state">
                      <div className="app-empty-title">Loading asset library...</div>
                    </div>
                  ) : recentUploads.length === 0 ? (
                    <div className="app-empty-state">
                      <IoCloudUploadOutline size={22} className="text-text-muted" />
                      <div className="app-empty-title">No uploaded assets yet</div>
                      <div className="app-empty-copy">
                        Upload a logo or music track here and it becomes available across brand defaults and clip editing.
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recentUploads.map((asset) => (
                        <div key={asset.path} className="app-list-row asset-library-row">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="app-list-icon">
                              {asset.type === 'Logo' ? <IoImagesOutline size={16} /> : <IoMusicalNotesOutline size={16} />}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-text-primary">{asset.name}</div>
                              <div className="text-xs text-text-secondary">{asset.type}</div>
                            </div>
                          </div>
                          <div className="truncate text-xs text-text-muted">{asset.path}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </div>

            <div className="flex min-h-0 flex-col gap-6">
              <section className="app-section-shell asset-library-shell">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Typography</div>
                    <h2 className="app-section-title">Fonts</h2>
                  </div>
                  <div className="app-chip">{bundledFonts.length} bundled</div>
                </div>

                <div className="mb-4 text-sm leading-relaxed text-text-secondary">
                  Choose which bundled font Brand Template should use for captions by default. This now updates the persisted template state directly.
                </div>

                <div className="space-y-3">
                  {bundledFonts.map((font) => (
                    <button
                      key={font}
                      type="button"
                      onClick={() => void handleFontSelect(font)}
                      className={`app-list-row asset-library-row w-full text-left transition-colors ${
                        brandTemplate?.caption.font === font
                          ? 'border-white/20 bg-white/5'
                          : 'hover:border-border-default hover:bg-white/[0.05]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="app-list-icon">
                          <IoTextOutline size={16} />
                        </div>
                        <div className="text-sm font-medium text-text-primary">{font}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-text-secondary">
                          {brandTemplate?.caption.font === font ? 'Selected in Brand Template' : 'Bundled with the app'}
                        </div>
                        <div className="app-chip asset-library-chip">
                          {isUpdatingFont === font
                            ? 'Saving...'
                            : brandTemplate?.caption.font === font
                              ? 'Active'
                              : 'Use'}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}

function AssetUploadPanel({
  title,
  description,
  icon,
  count,
  uploadLabel,
  onUpload
}: {
  title: string
  description: string
  icon: ReactNode
  count: number
  uploadLabel: string
  onUpload: () => void
}) {
  return (
    <div className="app-upload-panel asset-library-upload-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="app-list-icon">{icon}</div>
        <div className="app-chip asset-library-chip">{count} saved</div>
      </div>
      <div className="mt-5">
        <div className="text-lg font-semibold text-text-primary">{title}</div>
        <div className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</div>
      </div>
      <button type="button" className="app-action-secondary asset-library-upload-action mt-6 w-full justify-center" onClick={onUpload}>
        {uploadLabel}
      </button>
    </div>
  )
}

function validateAsset(file: File, kind: AssetKind) {
  if (kind === 'logo') {
    const validTypes = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/jpg', 'image/webp']
    if (!validTypes.includes(file.type)) {
      return 'Invalid logo type. Please upload PNG, SVG, JPG, or WebP.'
    }

    if (file.size > 2 * 1024 * 1024) {
      return 'Logo file too large. Maximum size is 2MB.'
    }

    return null
  }

  const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/m4a', 'audio/x-m4a']
  if (!validTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|m4a)$/i)) {
    return 'Invalid music type. Please upload MP3, WAV, or M4A.'
  }

  if (file.size > 10 * 1024 * 1024) {
    return 'Music file too large. Maximum size is 10MB.'
  }

  return null
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
