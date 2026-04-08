import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  IoArrowBack,
  IoCheckmarkCircleOutline,
  IoCreateOutline,
  IoDocumentTextOutline,
  IoImageOutline,
  IoShareOutline
} from 'react-icons/io5'
import { MainContentPanel } from '../components/MainContentPanel'
import type { Clip, ScheduledPublication } from '@shared/types'

type RawClip = Record<string, any>

type ClipTitleOption = {
  id: string
  title: string
  is_selected?: number
}

type ClipDescriptionOption = {
  id: string
  description: string
  is_selected?: number
  platform?: string
}

type ClipThumbnailOption = {
  id: string
  file_path: string
  timestamp?: number | null
  is_selected?: number
}

type ContentClip = Clip & {
  titleOptions: ClipTitleOption[]
  descriptionOptions: ClipDescriptionOption[]
  thumbnailOptions: ClipThumbnailOption[]
  publicationStatus: string | null
}

const mapClip = (clip: RawClip, episodeId: string): Clip => ({
  id: clip.id,
  episodeId: clip.episode_id || clip.episodeId || episodeId,
  startTime: Number(clip.start_time ?? clip.startTime ?? 0),
  endTime: Number(clip.end_time ?? clip.endTime ?? 0),
  duration: Number(clip.duration ?? 0),
  contentType: (clip.content_type || clip.contentType || 'insight') as Clip['contentType'],
  shareabilityScore: Number(clip.shareability_score ?? clip.shareabilityScore ?? 0),
  keyQuote: clip.key_quote || clip.keyQuote || 'Untitled clip',
  reason: clip.reason || '',
  contextNeeded: (clip.context_needed || clip.contextNeeded || 'low') as Clip['contextNeeded'],
  videoWidth: clip.video_width ?? clip.videoWidth ?? null,
  videoHeight: clip.video_height ?? clip.videoHeight ?? null,
  status: (clip.status || 'pending') as Clip['status'],
  createdAt: clip.created_at || clip.createdAt || new Date().toISOString()
})

const publicationStatusLabel = (status: string | null) => {
  switch (status) {
    case 'ready_to_push':
      return 'Ready to push'
    case 'waiting_for_export':
      return 'Waiting for export'
    case 'waiting_for_metadata':
      return 'Waiting for metadata'
    case 'waiting_for_thumbnail':
      return 'Waiting for thumbnail'
    case 'scheduled':
      return 'Scheduled'
    case 'scheduling_on_platform':
      return 'Scheduling on platform'
    case 'published':
      return 'Published'
    case 'failed':
      return 'Failed'
    default:
      return 'Draft'
  }
}

const formatTimestamp = (value?: number | null) => {
  if (!Number.isFinite(value ?? Number.NaN)) return 'Auto'
  const seconds = Math.max(0, Math.round(Number(value)))
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export function ContentPage() {
  const navigate = useNavigate()
  const { id: episodeId } = useParams<{ id: string }>()
  const [clips, setClips] = useState<ContentClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const loadContentWorkspace = async () => {
    if (!episodeId) {
      setError('Missing episode ID')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)

      const [rawClips, overview] = await Promise.all([
        window.electronAPI?.getEpisodeClips?.(episodeId),
        window.electronAPI?.getCalendarOverview?.()
      ])

      const publicationStatusByClipId = new Map<string, string>()
      ;(overview?.publications ?? []).forEach((publication: ScheduledPublication) => {
        if (!['cancelled'].includes(publication.status)) {
          publicationStatusByClipId.set(publication.clipId, publication.status)
        }
      })

      const approvedClips = ((rawClips || []) as RawClip[])
        .map((clip) => mapClip(clip, episodeId))
        .filter((clip) => clip.status === 'approved')

      const detailedClips = await Promise.all(
        approvedClips.map(async (clip) => {
          const [titleOptions, descriptionOptions, thumbnailOptions] = await Promise.all([
            window.electronAPI?.getClipTitles?.(clip.id).catch(() => []),
            window.electronAPI?.getClipDescriptions?.(clip.id).catch(() => []),
            window.electronAPI?.getClipThumbnails?.(clip.id).catch(() => [])
          ])

          return {
            ...clip,
            titleOptions: (titleOptions || []) as ClipTitleOption[],
            descriptionOptions: (descriptionOptions || []) as ClipDescriptionOption[],
            thumbnailOptions: (thumbnailOptions || []) as ClipThumbnailOption[],
            publicationStatus: publicationStatusByClipId.get(clip.id) ?? null
          } satisfies ContentClip
        })
      )

      setClips(detailedClips)
      setSelectedClipId((current) => current ?? detailedClips[0]?.id ?? null)
    } catch (loadError) {
      console.error('Failed to load content workspace:', loadError)
      setError('Failed to load content workspace')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadContentWorkspace()
  }, [episodeId])

  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null,
    [clips, selectedClipId]
  )

  const syncClipAfterSelection = async (clipId: string) => {
    await window.electronAPI?.refreshClipScheduling?.(clipId)
    await loadContentWorkspace()
    setSelectedClipId(clipId)
  }

  const handleSelectTitle = async (clipId: string, titleId: string) => {
    try {
      setBusyKey(`title-${clipId}`)
      await window.electronAPI?.selectClipTitle?.(titleId, clipId)
      await syncClipAfterSelection(clipId)
    } catch (selectionError) {
      console.error('Failed to select clip title:', selectionError)
    } finally {
      setBusyKey(null)
    }
  }

  const handleSelectDescription = async (clipId: string, descriptionId: string) => {
    try {
      setBusyKey(`description-${clipId}`)
      await window.electronAPI?.selectClipDescription?.(descriptionId, clipId)
      await syncClipAfterSelection(clipId)
    } catch (selectionError) {
      console.error('Failed to select clip description:', selectionError)
    } finally {
      setBusyKey(null)
    }
  }

  const handleSelectThumbnail = async (clipId: string, thumbnailId: string) => {
    try {
      setBusyKey(`thumbnail-${clipId}`)
      await window.electronAPI?.selectClipThumbnail?.(thumbnailId, clipId)
      await syncClipAfterSelection(clipId)
    } catch (selectionError) {
      console.error('Failed to select clip thumbnail:', selectionError)
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) {
    return (
      <MainContentPanel>
        <div className="app-page-content-shell flex min-h-full items-center justify-center py-16">
          <div className="text-center">
            <div className="text-lg text-text-primary">Loading content packaging…</div>
            <div className="text-sm text-text-muted">Preparing approved clips</div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  if (error || !episodeId) {
    return (
      <MainContentPanel>
        <div className="app-page-content-shell flex min-h-full items-center justify-center py-16">
          <div className="text-center">
            <div className="text-lg text-text-primary">Content workspace unavailable</div>
            <div className="mt-2 text-sm text-text-muted">{error || 'Missing episode'}</div>
          </div>
        </div>
      </MainContentPanel>
    )
  }

  return (
    <MainContentPanel>
      <div className="relative h-full min-h-full">
        <header className="workspace-panel-header app-page-header-shell">
          <div>
            <div className="app-page-title">Generate Content</div>
            <div className="app-page-subtitle">
              Finalize titles, descriptions, and thumbnails for approved clips before export and scheduling.
            </div>
          </div>
          <div className="app-page-header-actions">
            <div className="app-chip">{clips.length} approved</div>
            <button type="button" onClick={() => navigate(`/review/${episodeId}`)} className="btn-secondary">
              <IoArrowBack size={15} />
              <span>Back to review</span>
            </button>
            <button type="button" onClick={() => navigate(`/export/${episodeId}`)} className="btn-primary">
              <IoShareOutline size={15} />
              <span>Export queue</span>
            </button>
          </div>
        </header>

        <div className="app-page-content-shell grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)] gap-6 py-5">
          <section className="app-section-shell flex min-h-0 flex-col">
            <div className="flex items-center justify-between">
              <h2 className="app-section-title !mt-0">Approved clips</h2>
              <div className="app-chip">{clips.length} ready</div>
            </div>
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {clips.length === 0 ? (
                <div className="app-surface-muted flex min-h-[220px] items-center justify-center p-6 text-center text-sm text-text-muted">
                  Approve clips in Review first. Once approved, they appear here for title, description, and thumbnail selection.
                </div>
              ) : (
                clips.map((clip) => {
                  const selectedTitle =
                    clip.titleOptions.find((option) => option.is_selected)?.title ||
                    clip.titleOptions[0]?.title ||
                    clip.keyQuote
                  const selectedThumbnail = clip.thumbnailOptions.find((option) => option.is_selected) || clip.thumbnailOptions[0]
                  const isSelected = clip.id === selectedClip?.id

                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => setSelectedClipId(clip.id)}
                      className={`app-surface text-left transition-colors ${isSelected ? 'border-border-strong bg-[#171717]' : 'hover:border-border-strong hover:bg-[#151515]'}`}
                    >
                      <div className="flex gap-3 p-3">
                        <div className="h-24 w-[72px] overflow-hidden rounded-[3px] bg-black">
                          {selectedThumbnail ? (
                            <img
                              src={`app-file://${selectedThumbnail.file_path}`}
                              alt={selectedTitle}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[11px] text-text-muted">
                              No thumb
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="app-chip">{publicationStatusLabel(clip.publicationStatus)}</div>
                            <div className="text-xs text-text-muted">{clip.shareabilityScore.toFixed(1)}</div>
                          </div>
                          <div className="mt-3 line-clamp-3 text-sm font-medium text-text-primary">{selectedTitle}</div>
                          <div className="mt-2 text-xs uppercase tracking-[0.18em] text-text-muted">
                            {clip.contentType.replace('_', ' ')}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <section className="app-section-shell min-h-0">
            {!selectedClip ? (
              <div className="app-surface-muted flex min-h-[320px] items-center justify-center text-sm text-text-muted">
                Select an approved clip to package it for publishing.
              </div>
            ) : (
              <div className="grid min-h-0 grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6">
                <div className="space-y-4">
                  <div className="app-surface p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.18em] text-text-muted">Selected clip</div>
                        <div className="mt-2 text-xl font-semibold text-text-primary">
                          {selectedClip.titleOptions.find((option) => option.is_selected)?.title ||
                            selectedClip.titleOptions[0]?.title ||
                            selectedClip.keyQuote}
                        </div>
                      </div>
                      <div className="app-chip">{publicationStatusLabel(selectedClip.publicationStatus)}</div>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <div className="app-chip">{selectedClip.contentType.replace('_', ' ')}</div>
                      <div className="app-chip">Score {selectedClip.shareabilityScore.toFixed(1)}</div>
                      <div className="app-chip">
                        {(selectedClip.endTime - selectedClip.startTime).toFixed(1)}s
                      </div>
                    </div>
                    <div className="mt-4 text-sm leading-7 text-text-secondary">{selectedClip.reason}</div>
                    <div className="mt-5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => navigate(`/content/${episodeId}/${selectedClip.id}`)}
                        className="btn-secondary"
                      >
                        <IoCreateOutline size={15} />
                        <span>Edit clip</span>
                      </button>
                    </div>
                  </div>

                  <div className="app-surface p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                      <IoCheckmarkCircleOutline size={16} />
                      <span>Scheduling readiness</span>
                    </div>
                    <div className="mt-3 text-sm text-text-secondary">
                      This clip becomes publish-ready as soon as it has a selected export, metadata, and thumbnail.
                    </div>
                  </div>
                </div>

                <div className="min-h-0 space-y-6">
                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
                      <IoCreateOutline size={16} />
                      <span>Title options</span>
                    </div>
                    <div className="grid gap-3">
                      {selectedClip.titleOptions.map((option) => {
                        const isSelected = option.is_selected === 1
                        return (
                          <button
                            key={option.id}
                            type="button"
                            disabled={busyKey === `title-${selectedClip.id}`}
                            onClick={() => handleSelectTitle(selectedClip.id, option.id)}
                            className={`app-surface p-4 text-left transition-colors ${
                              isSelected ? 'border-border-strong bg-[#171717]' : 'hover:border-border-strong hover:bg-[#151515]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm font-medium leading-6 text-text-primary">{option.title}</div>
                              {isSelected ? <div className="app-chip">Selected</div> : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
                      <IoDocumentTextOutline size={16} />
                      <span>Description</span>
                    </div>
                    <div className="grid gap-3">
                      {selectedClip.descriptionOptions.map((option) => {
                        const isSelected = option.is_selected === 1
                        return (
                          <button
                            key={option.id}
                            type="button"
                            disabled={busyKey === `description-${selectedClip.id}`}
                            onClick={() => handleSelectDescription(selectedClip.id, option.id)}
                            className={`app-surface p-4 text-left transition-colors ${
                              isSelected ? 'border-border-strong bg-[#171717]' : 'hover:border-border-strong hover:bg-[#151515]'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="text-sm leading-6 text-text-secondary">{option.description}</div>
                              {isSelected ? <div className="app-chip">Selected</div> : null}
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-primary">
                      <IoImageOutline size={16} />
                      <span>Thumbnail options</span>
                    </div>
                    {selectedClip.thumbnailOptions.length === 0 ? (
                      <div className="app-surface-muted p-4 text-sm text-text-muted">
                        No thumbnails generated yet. This clip will remain in waiting-for-thumbnail until one is available.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                        {selectedClip.thumbnailOptions.map((option) => {
                          const isSelected = option.is_selected === 1
                          return (
                            <button
                              key={option.id}
                              type="button"
                              disabled={busyKey === `thumbnail-${selectedClip.id}`}
                              onClick={() => handleSelectThumbnail(selectedClip.id, option.id)}
                              className={`app-surface overflow-hidden p-2 text-left transition-colors ${
                                isSelected ? 'border-border-strong bg-[#171717]' : 'hover:border-border-strong hover:bg-[#151515]'
                              }`}
                            >
                              <div className="aspect-[9/16] overflow-hidden rounded-[3px] bg-black">
                                <img
                                  src={`app-file://${option.file_path}`}
                                  alt={`Thumbnail ${formatTimestamp(option.timestamp)}`}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                              <div className="mt-2 flex items-center justify-between gap-2 px-1 pb-1">
                                <span className="text-xs text-text-muted">{formatTimestamp(option.timestamp)}</span>
                                {isSelected ? <div className="app-chip">Selected</div> : null}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </MainContentPanel>
  )
}
