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

    if (['published', 'cancelled'].includes(publication.status)) {
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
}

export const schedulingService = new SchedulingService()
