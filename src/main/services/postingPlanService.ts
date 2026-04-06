import { randomUUID } from 'crypto'
import { database } from '../database/database'
import type {
  PostingPlan,
  PublishingAccount,
  SlotStrategy,
  TargetRegion
} from '@shared/types'

const DEFAULT_ACTIVE_DAYS = [1, 2, 3, 4, 5, 6, 0]
const DEFAULT_TARGET_REGIONS: TargetRegion[] = ['aus_nz', 'europe', 'united_states']

export class PostingPlanService {
  buildDefaultPlan(
    publishingAccountId: string,
    timezone: string,
    overrides: Partial<PostingPlan> = {}
  ): PostingPlan {
    const now = new Date().toISOString()

    return {
      id: overrides.id ?? randomUUID(),
      publishingAccountId,
      isDefault: overrides.isDefault ?? true,
      postsPerDay: overrides.postsPerDay ?? 5,
      activeDays: overrides.activeDays ?? DEFAULT_ACTIVE_DAYS,
      primaryTimezone: overrides.primaryTimezone ?? timezone,
      targetRegions: overrides.targetRegions ?? DEFAULT_TARGET_REGIONS,
      publishingWindowStart: overrides.publishingWindowStart ?? '08:00',
      publishingWindowEnd: overrides.publishingWindowEnd ?? '22:00',
      slotStrategy: overrides.slotStrategy ?? ('regional_weighted' as SlotStrategy),
      recyclingEnabled: overrides.recyclingEnabled ?? true,
      minimumRecycleGapDays: overrides.minimumRecycleGapDays ?? 30,
      maxRecyclesPerClip: overrides.maxRecyclesPerClip ?? 3,
      freshInventoryThreshold: overrides.freshInventoryThreshold ?? 12,
      metadata: overrides.metadata ?? {},
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now
    }
  }

  ensureDefaultPlanForAccount(account: PublishingAccount): PostingPlan {
    const existing = database.getDefaultPostingPlanForAccount(account.id)
    if (existing) {
      return existing
    }

    const plan = this.buildDefaultPlan(account.id, account.timezone)
    database.upsertPostingPlan(plan)
    return plan
  }

  savePostingPlan(plan: PostingPlan): PostingPlan {
    database.upsertPostingPlan(plan)
    return plan
  }

  listPlansForAccount(accountId: string): PostingPlan[] {
    return database.listPostingPlansForAccount(accountId)
  }
}

export const postingPlanService = new PostingPlanService()
