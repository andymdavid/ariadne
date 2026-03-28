import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ReactNode } from 'react'
import {
  IoCloudUploadOutline,
  IoDocumentTextOutline,
  IoImagesOutline,
  IoMusicalNotesOutline,
  IoTextOutline
} from 'react-icons/io5'
import { MainContentPanel } from '../components/MainContentPanel'

type AssetKind = 'logo' | 'music'

type AssetStatusCard = {
  id: string
  label: string
  value: string
  tone?: 'default' | 'muted'
}

const libraryStatusCards: AssetStatusCard[] = [
  { id: 'vocabulary', label: 'Vocabulary rules', value: 'Not connected yet', tone: 'muted' },
  { id: 'censored', label: 'Censored words', value: 'Not connected yet', tone: 'muted' },
  { id: 'fonts', label: 'Fonts bundled', value: '10 families loaded' }
]

const bundledFonts = ['Anton', 'Inter']

const formatFileName = (filePath: string) => filePath.split('/').pop() || filePath

export function AssetLibraryPage() {
  const [logos, setLogos] = useState<string[]>([])
  const [musicTracks, setMusicTracks] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState<AssetKind | null>(null)
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

      const [loadedLogos, loadedMusic] = await Promise.all([
        window.electronAPI?.listLogos?.() ?? Promise.resolve([]),
        window.electronAPI?.listMusic?.() ?? Promise.resolve([])
      ])

      setLogos(loadedLogos ?? [])
      setMusicTracks(loadedMusic ?? [])
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

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="mx-auto flex h-full max-w-7xl flex-col gap-8">
          <div className="app-page-header">
            <div className="max-w-3xl">
              <div className="text-[11px] uppercase tracking-[0.24em] text-text-muted">Asset Library</div>
              <div className="mt-3 app-page-title">Reusable Brand Assets</div>
              <div className="app-page-subtitle">
                Keep logos, music, and language controls in one place so generated clips inherit the same brand system by default.
              </div>
            </div>

            <div className="grid min-w-[300px] grid-cols-3 gap-3">
              {libraryStatusCards.map((card) => (
                <div key={card.id} className="app-stat-card">
                  <div className="app-stat-label">{card.label}</div>
                  <div className={`app-stat-value ${card.tone === 'muted' ? 'text-text-secondary' : ''}`}>
                    {card.id === 'fonts' ? `${bundledFonts.length} families` : card.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)] gap-6">
            <div className="flex min-h-0 flex-col gap-6">
              <section className="app-section-shell">
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

              <section className="app-section-shell min-h-0 flex-1">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Live Data</div>
                    <h2 className="app-section-title">Available uploads</h2>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto">
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
                        <div key={asset.path} className="app-list-row">
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
              <section className="app-section-shell">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Language</div>
                    <h2 className="app-section-title">Shared vocabulary rules</h2>
                  </div>
                </div>

                <div className="grid gap-3">
                  <PendingLibraryPanel
                    icon={<IoDocumentTextOutline size={18} />}
                    title="Brand vocabulary"
                    description="Approved terms, proper nouns, and phrasing rules should live here once the store is wired."
                  />
                  <PendingLibraryPanel
                    icon={<IoTextOutline size={18} />}
                    title="Censored words"
                    description="Caption replacements and blocked terms are still missing real persistence, so this section stays honest for now."
                  />
                </div>
              </section>

              <section className="app-section-shell">
                <div className="app-section-header">
                  <div>
                    <div className="app-section-kicker">Typography</div>
                    <h2 className="app-section-title">Bundled fonts</h2>
                  </div>
                  <div className="app-chip">{bundledFonts.length} available</div>
                </div>

                <div className="space-y-2">
                  {bundledFonts.map((font) => (
                    <div key={font} className="app-list-row">
                      <div>
                        <div className="text-sm font-medium text-text-primary">{font}</div>
                        <div className="text-xs text-text-secondary">Bundled with the desktop app</div>
                      </div>
                    </div>
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
    <div className="app-upload-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="app-list-icon">{icon}</div>
        <div className="app-chip">{count} saved</div>
      </div>
      <div className="mt-5">
        <div className="text-lg font-semibold text-text-primary">{title}</div>
        <div className="mt-2 text-sm leading-relaxed text-text-secondary">{description}</div>
      </div>
      <button type="button" className="app-action-secondary mt-6 w-full justify-center" onClick={onUpload}>
        {uploadLabel}
      </button>
    </div>
  )
}

function PendingLibraryPanel({
  icon,
  title,
  description
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="app-surface-muted p-4">
      <div className="flex items-center gap-3">
        <div className="app-list-icon">{icon}</div>
        <div className="text-sm font-medium text-text-primary">{title}</div>
      </div>
      <div className="mt-3 text-sm leading-relaxed text-text-secondary">{description}</div>
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
