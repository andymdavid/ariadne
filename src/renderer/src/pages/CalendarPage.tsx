import { useEffect, useMemo, useState } from 'react'
import { MainContentPanel } from '../components/MainContentPanel'
import type { CalendarSlot, PostingPlan, PublishingAccount, ScheduledPublication } from '@shared/types'

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
                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
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
                                <span className={`calendar-slot-status is-publication-${publication.status}`}>
                                  {publication.status}
                                </span>
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
                            <div key={publication.id} className="calendar-publication-row">
                              <div className="calendar-publication-clip">{publication.clipId.slice(0, 8)}</div>
                              <div className="calendar-publication-meta">
                                {formatSlotDate(publication.scheduledForUtc, publication.scheduledTimezone)}
                              </div>
                              <span className={`calendar-slot-status is-publication-${publication.status}`}>
                                {publication.status}
                              </span>
                            </div>
                          ))
                        )}
                      </div>
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
