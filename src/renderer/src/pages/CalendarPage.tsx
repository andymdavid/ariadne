import { useEffect, useMemo, useState } from 'react'
import { MainContentPanel } from '../components/MainContentPanel'
import type {
  CalendarSlot,
  PostingPlan,
  PublicationHistoryEvent,
  PublishingAccount,
  ScheduledPublication
} from '@shared/types'

function formatSlotDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

export function CalendarPage() {
  const [account, setAccount] = useState<PublishingAccount | null>(null)
  const [plan, setPlan] = useState<PostingPlan | null>(null)
  const [slots, setSlots] = useState<CalendarSlot[]>([])
  const [publications, setPublications] = useState<ScheduledPublication[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pushingKey, setPushingKey] = useState<string | null>(null)
  const [selectedPublicationId, setSelectedPublicationId] = useState<string | null>(null)
  const [selectedPublicationHistory, setSelectedPublicationHistory] = useState<PublicationHistoryEvent[]>([])
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)
  const [selectedDescription, setSelectedDescription] = useState<string | null>(null)
  const [selectedThumbnailPath, setSelectedThumbnailPath] = useState<string | null>(null)

  useEffect(() => {
    void loadOverview()
  }, [])

  const loadOverview = async () => {
    setLoading(true)
    setError(null)

    try {
      const overview = await window.electronAPI?.getCalendarOverview?.()
      if (overview) {
        setAccount(overview.account)
        setPlan(overview.plan)
        setSlots(overview.slots)
        setPublications(overview.publications)
      }
    } catch (loadError) {
      console.error('Failed to load calendar overview:', loadError)
      setError('Failed to load scheduling overview')
    } finally {
      setLoading(false)
    }
  }

  const upcomingSlots = useMemo(() => slots.slice(0, 16), [slots])
  const publicationBySlotId = useMemo(
    () => new Map(publications.map((publication) => [publication.calendarSlotId, publication])),
    [publications]
  )
  const readyToPushCount = useMemo(
    () => publications.filter((publication) => publication.status === 'ready_to_push').length,
    [publications]
  )
  const selectedPublication = useMemo(
    () => publications.find((publication) => publication.id === selectedPublicationId) ?? publications[0] ?? null,
    [publications, selectedPublicationId]
  )

  useEffect(() => {
    if (!selectedPublicationId && publications[0]?.id) {
      setSelectedPublicationId(publications[0].id)
    }
  }, [publications, selectedPublicationId])

  useEffect(() => {
    const loadPublicationDetails = async () => {
      if (!selectedPublication) {
        setSelectedPublicationHistory([])
        setSelectedTitle(null)
        setSelectedDescription(null)
        setSelectedThumbnailPath(null)
        return
      }

      try {
        const [history, titles, descriptions, thumbnails] = await Promise.all([
          window.electronAPI?.getPublicationHistory?.(selectedPublication.id).catch(() => []),
          window.electronAPI?.getClipTitles?.(selectedPublication.clipId).catch(() => []),
          window.electronAPI?.getClipDescriptions?.(selectedPublication.clipId).catch(() => []),
          window.electronAPI?.getClipThumbnails?.(selectedPublication.clipId).catch(() => [])
        ])

        setSelectedPublicationHistory(history || [])
        setSelectedTitle(
          (titles || []).find((item: any) => item.id === selectedPublication.selectedTitleId)?.title ??
            (titles || []).find((item: any) => item.is_selected === 1)?.title ??
            null
        )
        setSelectedDescription(
          (descriptions || []).find((item: any) => item.id === selectedPublication.selectedDescriptionId)?.description ??
            (descriptions || []).find((item: any) => item.is_selected === 1)?.description ??
            null
        )
        setSelectedThumbnailPath(
          (thumbnails || []).find((item: any) => item.id === selectedPublication.selectedThumbnailId)?.file_path ??
            (thumbnails || []).find((item: any) => item.is_selected === 1)?.file_path ??
            null
        )
      } catch (detailError) {
        console.error('Failed to load publication details:', detailError)
      }
    }

    void loadPublicationDetails()
  }, [selectedPublication])

  const handlePushPublication = async (publicationId: string) => {
    try {
      setPushingKey(publicationId)
      await window.electronAPI?.pushScheduledPublication?.(publicationId)
      await loadOverview()
      setSelectedPublicationId(publicationId)
    } catch (pushError) {
      console.error('Failed to push scheduled publication:', pushError)
      setError('Failed to push publication to YouTube')
    } finally {
      setPushingKey(null)
    }
  }

  const handlePushReady = async () => {
    try {
      setPushingKey('all')
      await window.electronAPI?.pushReadyPublications?.(account?.id)
      await loadOverview()
    } catch (pushError) {
      console.error('Failed to push ready publications:', pushError)
      setError('Failed to push ready publications to YouTube')
    } finally {
      setPushingKey(null)
    }
  }

  return (
    <MainContentPanel>
      <div className="app-page">
        <div className="flex min-h-full flex-col gap-8">
          <div className="app-page-header">
            <div className="app-page-header-shell">
              <div className="app-page-header-content">
                <div className="app-page-title">Calendar</div>
                <div className="app-page-separator">|</div>
                <div className="app-page-subtitle">
                  Auto-scheduled YouTube slots, publication state, and future queue coverage.
                </div>
              </div>

              <div className="app-page-header-actions">
                {account ? <div className="app-chip">{account.channelName}</div> : null}
                {account ? (
                  <button
                    type="button"
                    onClick={() => void handlePushReady()}
                    className="app-action-primary"
                    disabled={readyToPushCount === 0 || pushingKey === 'all'}
                  >
                    Push ready to YouTube
                  </button>
                ) : null}
                <button type="button" onClick={() => void loadOverview()} className="app-action-secondary">
                  Refresh
                </button>
              </div>
            </div>
          </div>

          <div className="app-page-content-shell flex flex-col gap-6">
            {loading ? (
              <section className="app-section-shell">
                <div className="text-sm text-text-secondary">Loading scheduling overview...</div>
              </section>
            ) : error ? (
              <section className="app-section-shell">
                <div className="text-sm text-text-secondary">{error}</div>
              </section>
            ) : !account || !plan ? (
              <section className="app-section-shell">
                <div className="app-section-header">
                  <div>
                    <h2 className="app-section-title">Publishing setup required</h2>
                  </div>
                </div>
                <div className="app-empty-copy max-w-2xl">
                  Save a YouTube publishing account and default posting plan in Settings before clips can
                  auto-schedule on approval.
                </div>
              </section>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                  <div className="app-stat-card">
                    <div className="app-stat-label">Channel</div>
                    <div className="app-stat-value">{account.channelName}</div>
                  </div>
                  <div className="app-stat-card">
                    <div className="app-stat-label">Posts / Day</div>
                    <div className="app-stat-value">{plan.postsPerDay}</div>
                  </div>
                  <div className="app-stat-card">
                    <div className="app-stat-label">Target Regions</div>
                    <div className="app-stat-value">{plan.targetRegions.length}</div>
                  </div>
                  <div className="app-stat-card">
                    <div className="app-stat-label">Scheduled</div>
                    <div className="app-stat-value">
                      {
                        publications.filter((publication) =>
                          ['ready_to_push', 'scheduling_on_platform', 'scheduled_on_platform'].includes(
                            publication.status
                          )
                        ).length
                      }
                    </div>
                  </div>
                  <div className="app-stat-card">
                    <div className="app-stat-label">Ready to Push</div>
                    <div className="app-stat-value">{readyToPushCount}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.2fr)_360px]">
                  <section className="app-section-shell">
                    <div className="app-section-header">
                      <div>
                        <h2 className="app-section-title">Upcoming slots</h2>
                      </div>
                      <div className="app-chip">
                        {plan.primaryTimezone} • {plan.publishingWindowStart}-{plan.publishingWindowEnd}
                      </div>
                    </div>

                    <div className="calendar-slot-list">
                      {upcomingSlots.map((slot) => {
                        const publication = publicationBySlotId.get(slot.id)
                        return (
                          <div key={slot.id} className="calendar-slot-row">
                            <div className="calendar-slot-main">
                              <div className="calendar-slot-time">
                                {formatSlotDate(slot.scheduledForUtc, slot.scheduledTimezone)}
                              </div>
                              <div className="calendar-slot-meta">
                                {slot.slotLabel}
                                {slot.slotRegion ? ` • ${slot.slotRegion}` : ''}
                              </div>
                            </div>

                            <div className="calendar-slot-status-group">
                              <span className={`calendar-slot-status is-${slot.status}`}>{slot.status}</span>
                              {publication ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setSelectedPublicationId(publication.id)}
                                    className={`calendar-slot-status is-publication-${publication.status}`}
                                  >
                                    {publication.status}
                                  </button>
                                  {publication.status === 'ready_to_push' ? (
                                    <button
                                      type="button"
                                      onClick={() => void handlePushPublication(publication.id)}
                                      className="app-action-secondary"
                                      disabled={pushingKey === publication.id}
                                    >
                                      Push
                                    </button>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  <div className="flex flex-col gap-6">
                    <section className="app-section-shell">
                      <div className="app-section-header">
                        <div>
                          <h2 className="app-section-title">Plan</h2>
                        </div>
                      </div>

                      <div className="space-y-3 text-sm text-text-secondary">
                        <div className="app-list-row">
                          <span>Slot strategy</span>
                          <span className="text-text-primary">{plan.slotStrategy}</span>
                        </div>
                        <div className="app-list-row">
                          <span>Fresh inventory threshold</span>
                          <span className="text-text-primary">{plan.freshInventoryThreshold}</span>
                        </div>
                        <div className="app-list-row">
                          <span>Recycle enabled</span>
                          <span className="text-text-primary">{plan.recyclingEnabled ? 'Yes' : 'No'}</span>
                        </div>
                        <div className="app-list-row">
                          <span>Recycle cooldown</span>
                          <span className="text-text-primary">{plan.minimumRecycleGapDays} days</span>
                        </div>
                      </div>
                    </section>

                    <section className="app-section-shell">
                      <div className="app-section-header">
                        <div>
                          <h2 className="app-section-title">Publication queue</h2>
                        </div>
                      </div>

                      <div className="calendar-publication-list">
                        {publications.length === 0 ? (
                          <div className="app-empty-copy max-w-none">
                            Approved clips will appear here once they reserve a slot.
                          </div>
                        ) : (
                          publications.slice(0, 10).map((publication) => (
                            <button
                              key={publication.id}
                              type="button"
                              onClick={() => setSelectedPublicationId(publication.id)}
                              className="calendar-publication-row w-full text-left"
                            >
                              <div className="calendar-publication-clip">{publication.clipId.slice(0, 8)}</div>
                              <div className="calendar-publication-meta">
                                {formatSlotDate(publication.scheduledForUtc, publication.scheduledTimezone)}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`calendar-slot-status is-publication-${publication.status}`}>
                                  {publication.status}
                                </span>
                                {publication.status === 'ready_to_push' ? (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handlePushPublication(publication.id)
                                    }}
                                    className="app-action-secondary"
                                    disabled={pushingKey === publication.id}
                                  >
                                    Push
                                  </button>
                                ) : null}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    </section>

                    <section className="app-section-shell">
                      <div className="app-section-header">
                        <div>
                          <h2 className="app-section-title">Publication detail</h2>
                        </div>
                      </div>

                      {!selectedPublication ? (
                        <div className="app-empty-copy max-w-none">
                          Select a scheduled publication to inspect its package, platform state, and history.
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-2 text-sm text-text-secondary">
                            <div className="app-list-row">
                              <span>Status</span>
                              <span className={`calendar-slot-status is-publication-${selectedPublication.status}`}>
                                {selectedPublication.status}
                              </span>
                            </div>
                            <div className="app-list-row">
                              <span>Scheduled</span>
                              <span className="text-text-primary">
                                {formatSlotDate(selectedPublication.scheduledForUtc, selectedPublication.scheduledTimezone)}
                              </span>
                            </div>
                            <div className="app-list-row">
                              <span>Platform upload</span>
                              <span className="text-text-primary">
                                {selectedPublication.youtubeUploadStatus ?? 'not pushed'}
                              </span>
                            </div>
                            {selectedPublication.youtubeVideoUrl ? (
                              <div className="app-list-row">
                                <span>YouTube URL</span>
                                <a
                                  href={selectedPublication.youtubeVideoUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-text-primary underline underline-offset-2"
                                >
                                  Open link
                                </a>
                              </div>
                            ) : null}
                            {selectedPublication.lastErrorMessage ? (
                              <div className="app-surface-muted p-3 text-sm text-text-secondary">
                                {selectedPublication.lastErrorMessage}
                              </div>
                            ) : null}
                          </div>

                          {selectedThumbnailPath ? (
                            <div className="overflow-hidden rounded-[3px] bg-black">
                              <img
                                src={`app-file://${selectedThumbnailPath}`}
                                alt="Selected thumbnail"
                                className="aspect-[9/16] w-full object-cover"
                              />
                            </div>
                          ) : null}

                          {selectedTitle ? (
                            <div>
                              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-text-muted">Selected title</div>
                              <div className="text-sm font-medium leading-6 text-text-primary">{selectedTitle}</div>
                            </div>
                          ) : null}

                          {selectedDescription ? (
                            <div>
                              <div className="mb-1 text-xs uppercase tracking-[0.18em] text-text-muted">Selected description</div>
                              <div className="text-sm leading-6 text-text-secondary">{selectedDescription}</div>
                            </div>
                          ) : null}

                          <div>
                            <div className="mb-2 text-xs uppercase tracking-[0.18em] text-text-muted">History</div>
                            <div className="space-y-2">
                              {selectedPublicationHistory.length === 0 ? (
                                <div className="app-empty-copy max-w-none">No publication events yet.</div>
                              ) : (
                                selectedPublicationHistory.map((event) => (
                                  <div key={event.id} className="app-surface-muted p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <div className="text-sm font-medium text-text-primary">
                                        {event.message || event.eventType}
                                      </div>
                                      <div className="text-xs text-text-muted">
                                        {formatSlotDate(event.createdAt, selectedPublication.scheduledTimezone)}
                                      </div>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </MainContentPanel>
  )
}
