import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ClipEditModal } from '../components/ClipEditModal'
import { MainContentPanel } from '../components/MainContentPanel'
import type { Clip } from '@shared/types'

type ClipEditorData = {
  id: string
  keyQuote: string
  startTime: number
  endTime: number
  duration: number
  videoWidth?: number | null
  videoHeight?: number | null
}

const mapClipToEditorData = (clip: Partial<Clip> & { id: string }): ClipEditorData => ({
  id: clip.id,
  keyQuote: clip.keyQuote || 'Untitled clip',
  startTime: clip.startTime ?? 0,
  endTime: clip.endTime ?? 0,
  duration: clip.duration ?? Math.max(0, (clip.endTime ?? 0) - (clip.startTime ?? 0)),
  videoWidth: clip.videoWidth ?? null,
  videoHeight: clip.videoHeight ?? null
})

export function ClipEditorPage() {
  const navigate = useNavigate()
  const { id: episodeId, clipId } = useParams<{ id: string; clipId: string }>()
  const [clipData, setClipData] = useState<ClipEditorData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadClip = async () => {
      if (!episodeId || !clipId) {
        setError('Missing episode or clip ID')
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setError(null)

        const rawClip = await window.electronAPI?.getClip?.(clipId)
        if (!rawClip) {
          setError('Clip not found')
          return
        }

        setClipData(mapClipToEditorData({
          id: rawClip.id,
          keyQuote: rawClip.key_quote ?? rawClip.keyQuote,
          startTime: Number(rawClip.start_time ?? rawClip.startTime ?? 0),
          endTime: Number(rawClip.end_time ?? rawClip.endTime ?? 0),
          duration: Number(rawClip.duration ?? 0),
          videoWidth: rawClip.video_width ?? rawClip.videoWidth ?? null,
          videoHeight: rawClip.video_height ?? rawClip.videoHeight ?? null
        }))
      } catch (loadError) {
        console.error('Failed to load clip for editor page:', loadError)
        setError('Failed to load clip editor')
      } finally {
        setLoading(false)
      }
    }

    loadClip()
  }, [clipId, episodeId])

  const handleBackToReview = () => {
    if (!episodeId) {
      navigate('/')
      return
    }

    navigate(`/review/${episodeId}`)
  }

  if (loading) {
    return (
      <MainContentPanel className="p-6">
        <div className="flex h-full items-center justify-center rounded-2xl border border-border-default bg-bg-secondary/40">
          <div className="text-center">
            <div className="text-lg text-text-primary">Loading editor…</div>
            <div className="text-sm text-text-muted">Preparing clip workspace</div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  if (error || !clipData || !episodeId) {
    return (
      <MainContentPanel className="p-6">
        <div className="flex h-full items-center justify-center rounded-2xl border border-border-default bg-bg-secondary/40">
          <div className="max-w-md text-center space-y-4">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">Editor unavailable</h1>
              <p className="mt-2 text-sm text-text-secondary">{error || 'Clip data could not be loaded.'}</p>
            </div>
            <button
              type="button"
              onClick={handleBackToReview}
              className="inline-flex items-center rounded-full border border-border-default bg-bg-tertiary px-4 py-2 text-sm text-text-primary hover:bg-hover-bg transition-colors"
            >
              Back to Review
            </button>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel className="p-4">
      <ClipEditModal
        isOpen
        presentation="page"
        clipId={clipData.id}
        episodeId={episodeId}
        clipData={clipData}
        onBack={handleBackToReview}
        onClose={handleBackToReview}
        onSave={() => {
          // The editor persists changes internally. The page stays in place after save.
        }}
      />
    </MainContentPanel>
  )
}
