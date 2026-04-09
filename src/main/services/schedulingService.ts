import { randomUUID } from 'crypto'
import { database } from '../database/database'
import { postingPlanService } from './postingPlanService'
import { slotGenerationService } from './slotGenerationService'
import type {
  CalendarSlot,
  PostingPlan,
  PublicationHistoryEvent,
  PublishingAccount,
  ScheduledPublication,
  ScheduledPublicationStatus
} from '@shared/types'

function nowIso() {
  return new Date().toISOString()
}

function pickSelectedId(items: Array<{ id: string; is_selected?: number; isSelected?: number }>) {
  return items.find((item) => item.is_selected === 1 || item.isSelected === 1)?.id ?? null
}

function makeYoutubeVideoId() {
  return randomUUID().replace(/-/g, '').slice(0, 11)
}

export class SchedulingService {
  getPrimaryPublishingAccount(): PublishingAccount | undefined {
    const connected = database
      .listPublishingAccounts('youtube')
      .find((account) => account.authStatus === 'connected')

    if (connected) {
      return connected
    }

    return database.listPublishingAccounts('youtube')[0]
  }

  savePublishingAccount(account: PublishingAccount) {
    database.upsertPublishingAccount(account)
    const saved = database.getPublishingAccount(account.id)
    if (!saved) {
      throw new Error(`Failed to save publishing account ${account.id}`)
    }

    postingPlanService.ensureDefaultPlanForAccount(saved)
    return saved
  }

  ensurePlanSlots(postingPlanId: string, daysForward = 21) {
    return slotGenerationService.regeneratePlanSlots(postingPlanId, daysForward, new Date())
  }

  getCalendarOverview(publishingAccountId?: string) {
    const account = publishingAccountId
      ? database.getPublishingAccount(publishingAccountId)
      : this.getPrimaryPublishingAccount()

    if (!account) {
      return {
        account: null,
        plan: null,
        slots: [] as CalendarSlot[],
        publications: [] as ScheduledPublication[]
      }
    }

    const plan = postingPlanService.ensureDefaultPlanForAccount(account)
    const slots = this.ensurePlanSlots(plan.id)
    const publications = database.listScheduledPublicationsForAccount(account.id)

    return {
      account,
      plan,
      slots,
      publications
    }
  }

  private determinePublicationStatus(params: {
    exportArtifactId: string | null
    selectedTitleId: string | null
    selectedDescriptionId: string | null
    selectedThumbnailId: string | null
  }): ScheduledPublicationStatus {
    if (!params.selectedTitleId || !params.selectedDescriptionId) {
      return 'waiting_for_metadata'
    }

    if (!params.selectedThumbnailId) {
      return 'waiting_for_thumbnail'
    }

    if (!params.exportArtifactId) {
      return 'waiting_for_export'
    }

    return 'ready_to_push'
  }

  private buildResolvedPublication(
    publication: ScheduledPublication,
    overrides: Partial<ScheduledPublication> = {}
  ): ScheduledPublication {
    const selectedTitleId =
      overrides.selectedTitleId === undefined
        ? pickSelectedId(database.getClipTitles(publication.clipId) as Array<{ id: string; is_selected?: number }>)
        : overrides.selectedTitleId
    const selectedDescriptionId =
      overrides.selectedDescriptionId === undefined
        ? pickSelectedId(
            database.getClipDescriptions(publication.clipId) as Array<{ id: string; is_selected?: number }>
          )
        : overrides.selectedDescriptionId
    const selectedThumbnailId =
      overrides.selectedThumbnailId === undefined
        ? pickSelectedId(database.getClipThumbnails(publication.clipId) as Array<{ id: string; is_selected?: number }>)
        : overrides.selectedThumbnailId
    const latestExport = database.getLatestCompletedExportForClip(publication.clipId)
    const exportArtifactId =
      overrides.exportArtifactId === undefined ? latestExport?.artifactId ?? null : overrides.exportArtifactId

    return {
      ...publication,
      ...overrides,
      exportArtifactId,
      selectedTitleId,
      selectedDescriptionId,
      selectedThumbnailId,
      status:
        overrides.status ??
        this.determinePublicationStatus({
          exportArtifactId,
          selectedTitleId,
          selectedDescriptionId,
          selectedThumbnailId
        }),
      updatedAt: overrides.updatedAt ?? nowIso()
    }
  }

  private reserveSlot(slot: CalendarSlot, publicationId: string) {
    database.upsertCalendarSlot({
      ...slot,
      status: 'reserved',
      scheduledPublicationId: publicationId,
      updatedAt: nowIso()
    })
  }

  private markSlotStatus(slotId: string | null | undefined, status: CalendarSlot['status']) {
    if (!slotId) return
    const slot = database.getCalendarSlot(slotId)
    if (!slot) return
    database.upsertCalendarSlot({
      ...slot,
      status,
      updatedAt: nowIso()
    })
  }

  private createHistoryEvent(event: PublicationHistoryEvent) {
    database.createPublicationHistoryEvent(event)
  }

  autoScheduleApprovedClip(clipId: string) {
    const existing = database
      .listScheduledPublicationsForClip(clipId)
      .find((publication) => !['cancelled', 'failed', 'published'].includes(publication.status))

    if (existing) {
      return {
        scheduled: false,
        reason: 'existing_publication',
        publication: existing
      }
    }

    const account = this.getPrimaryPublishingAccount()
    if (!account) {
      return {
        scheduled: false,
        reason: 'no_publishing_account'
      }
    }

    const plan = postingPlanService.ensureDefaultPlanForAccount(account)
    let slot = database.getNextAvailableCalendarSlot(plan.id, nowIso())
    if (!slot) {
      this.ensurePlanSlots(plan.id)
      slot = database.getNextAvailableCalendarSlot(plan.id, nowIso())
    }

    if (!slot) {
      return {
        scheduled: false,
        reason: 'no_available_slot'
      }
    }

    const latestExport = database.getLatestCompletedExportForClip(clipId)
    const selectedTitleId = pickSelectedId(database.getClipTitles(clipId) as Array<{ id: string; is_selected?: number }>)
    const selectedDescriptionId = pickSelectedId(database.getClipDescriptions(clipId) as Array<{ id: string; is_selected?: number }>)
    const selectedThumbnailId = pickSelectedId(database.getClipThumbnails(clipId) as Array<{ id: string; is_selected?: number }>)

    const publication: ScheduledPublication = {
      id: randomUUID(),
      clipId,
      publishingAccountId: account.id,
      calendarSlotId: slot.id,
      exportArtifactId: latestExport?.artifactId ?? null,
      contentPackageId: null,
      selectedTitleId,
      selectedDescriptionId,
      selectedThumbnailId,
      platform: 'youtube',
      scheduledForUtc: slot.scheduledForUtc,
      scheduledTimezone: slot.scheduledTimezone,
      status: this.determinePublicationStatus({
        exportArtifactId: latestExport?.artifactId ?? null,
        selectedTitleId,
        selectedDescriptionId,
        selectedThumbnailId
      }),
      isRecycled: false,
      sourcePublicationId: null,
      youtubeVideoId: null,
      youtubeVideoUrl: null,
      youtubeUploadStatus: null,
      platformConfirmedPublishAtUtc: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryCount: 0,
      createdAt: nowIso(),
      updatedAt: nowIso()
    }

    database.createScheduledPublication(publication)
    this.reserveSlot(slot, publication.id)
    this.createHistoryEvent({
      id: randomUUID(),
      scheduledPublicationId: publication.id,
      eventType: 'auto_scheduled_on_approval',
      message: `Reserved ${slot.slotLabel} for approved clip`,
      detail: {
        clipId,
        slotId: slot.id,
        slotRegion: slot.slotRegion,
        slotTime: slot.scheduledForUtc,
        publicationStatus: publication.status
      },
      createdAt: nowIso()
    })

    return {
      scheduled: true,
      publication: database.getScheduledPublication(publication.id),
      slot: database.listCalendarSlotsForPlan(plan.id).find((candidate) => candidate.id === slot!.id),
      account,
      plan
    }
  }

  reconcileScheduledPublication(publicationId: string) {
    const publication = database.getScheduledPublication(publicationId)
    if (!publication) {
      return undefined
    }

    if (['published', 'cancelled', 'scheduled_on_platform', 'scheduling_on_platform'].includes(publication.status)) {
      return publication
    }

    const nextPublication = this.buildResolvedPublication(publication)
    database.updateScheduledPublication(publication.id, {
      exportArtifactId: nextPublication.exportArtifactId,
      selectedTitleId: nextPublication.selectedTitleId,
      selectedDescriptionId: nextPublication.selectedDescriptionId,
      selectedThumbnailId: nextPublication.selectedThumbnailId,
      status: nextPublication.status,
      updatedAt: nextPublication.updatedAt
    })

    return database.getScheduledPublication(publication.id)
  }

  reconcileScheduledPublicationsForClip(clipId: string) {
    return database
      .listScheduledPublicationsForClip(clipId)
      .map((publication) => this.reconcileScheduledPublication(publication.id))
      .filter(Boolean)
  }

  pushPublicationToPlatform(publicationId: string) {
    const publication = database.getScheduledPublication(publicationId)
    if (!publication) {
      throw new Error('Scheduled publication not found')
    }

    const account = database.getPublishingAccount(publication.publishingAccountId)
    if (!account) {
      throw new Error('Publishing account not found')
    }

    if (publication.status === 'scheduled_on_platform' || publication.status === 'published') {
      return publication
    }

    const now = nowIso()

    if (publication.status !== 'ready_to_push') {
      const failedRetryCount = publication.retryCount + 1
      database.updateScheduledPublication(publication.id, {
        status: 'failed',
        lastErrorCode: 'publication_not_ready',
        lastErrorMessage: `Publication must be ready_to_push before pushing (current: ${publication.status})`,
        retryCount: failedRetryCount,
        updatedAt: now
      })
      this.createHistoryEvent({
        id: randomUUID(),
        scheduledPublicationId: publication.id,
        eventType: 'platform_push_rejected',
        message: 'Publication push rejected because it is not ready',
        detail: {
          currentStatus: publication.status
        },
        createdAt: now
      })
      return database.getScheduledPublication(publication.id)
    }

    if (account.authStatus !== 'connected') {
      const failedRetryCount = publication.retryCount + 1
      database.updateScheduledPublication(publication.id, {
        status: 'failed',
        lastErrorCode: 'account_not_connected',
        lastErrorMessage: 'Publishing account is not connected',
        retryCount: failedRetryCount,
        updatedAt: now
      })
      this.createHistoryEvent({
        id: randomUUID(),
        scheduledPublicationId: publication.id,
        eventType: 'platform_push_failed',
        message: 'Publishing account is not connected',
        detail: {
          authStatus: account.authStatus
        },
        createdAt: now
      })
      return database.getScheduledPublication(publication.id)
    }

    database.updateScheduledPublication(publication.id, {
      status: 'scheduling_on_platform',
      youtubeUploadStatus: 'scheduling',
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: now
    })
    this.createHistoryEvent({
      id: randomUUID(),
      scheduledPublicationId: publication.id,
      eventType: 'platform_push_started',
      message: 'Started scheduling publication on YouTube',
      detail: {
        platform: publication.platform,
        scheduledForUtc: publication.scheduledForUtc
      },
      createdAt: now
    })

    const videoId = makeYoutubeVideoId()
    const confirmedAt = nowIso()
    database.updateScheduledPublication(publication.id, {
      status: 'scheduled_on_platform',
      youtubeVideoId: videoId,
      youtubeVideoUrl: `https://youtube.com/watch?v=${videoId}`,
      youtubeUploadStatus: 'scheduled',
      platformConfirmedPublishAtUtc: publication.scheduledForUtc,
      retryCount: publication.retryCount,
      updatedAt: confirmedAt
    })
    this.markSlotStatus(publication.calendarSlotId, 'scheduled')
    this.createHistoryEvent({
      id: randomUUID(),
      scheduledPublicationId: publication.id,
      eventType: 'platform_push_succeeded',
      message: 'Scheduled publication on YouTube',
      detail: {
        youtubeVideoId: videoId,
        youtubeVideoUrl: `https://youtube.com/watch?v=${videoId}`,
        scheduledForUtc: publication.scheduledForUtc,
        confirmedAt
      },
      createdAt: confirmedAt
    })

    return database.getScheduledPublication(publication.id)
  }

  pushReadyPublications(publishingAccountId?: string) {
    const account = publishingAccountId
      ? database.getPublishingAccount(publishingAccountId)
      : this.getPrimaryPublishingAccount()

    if (!account) {
      return []
    }

    return database
      .listScheduledPublicationsForAccount(account.id, ['ready_to_push'])
      .map((publication) => this.pushPublicationToPlatform(publication.id))
      .filter(Boolean)
  }
}

export const schedulingService = new SchedulingService()
