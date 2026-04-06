import { randomUUID } from 'crypto'
import { database } from '../database/database'
import type {
  CalendarSlot,
  CalendarSlotStatus,
  PostingPlan,
  TargetRegion
} from '@shared/types'

const REGION_LABELS: Record<TargetRegion, string> = {
  aus_nz: 'AUS/NZ',
  europe: 'EUR',
  united_states: 'USA',
  global_fallback: 'Global'
}

function parseTimeParts(value: string) {
  const [hour, minute] = value.split(':').map((part) => Number.parseInt(part, 10))
  return { hour, minute }
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  })

  const parts = formatter.formatToParts(date)
  const read = (type: string) => Number.parseInt(parts.find((part) => part.type === type)?.value ?? '0', 10)

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone)
  const utcEquivalent = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  return utcEquivalent - date.getTime()
}

function zonedDateTimeToUtc(dateKey: string, timeValue: string, timeZone: string) {
  const [year, month, day] = dateKey.split('-').map((part) => Number.parseInt(part, 10))
  const { hour, minute } = parseTimeParts(timeValue)
  const guessUtc = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))
  const offsetMs = getTimeZoneOffsetMs(guessUtc, timeZone)
  return new Date(guessUtc.getTime() - offsetMs)
}

function addLocalDays(baseDate: Date, timeZone: string, daysToAdd: number) {
  const parts = getTimeZoneParts(baseDate, timeZone)
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd, 12, 0, 0))
}

function getLocalDateKey(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone)
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`
}

function getLocalWeekday(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short'
  }).format(date)
}

function getLocalDayIndex(date: Date, timeZone: string) {
  const weekday = getLocalWeekday(date, timeZone)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
}

export class SlotGenerationService {
  private getRegionForIndex(plan: PostingPlan, slotIndex: number): TargetRegion {
    if (plan.targetRegions.length === 0) {
      return 'global_fallback'
    }

    if (plan.slotStrategy === 'fixed') {
      return plan.targetRegions[0]
    }

    return plan.targetRegions[slotIndex % plan.targetRegions.length]
  }

  private buildDailyTimeValues(plan: PostingPlan) {
    const start = parseTimeParts(plan.publishingWindowStart)
    const end = parseTimeParts(plan.publishingWindowEnd)
    const startMinutes = start.hour * 60 + start.minute
    const endMinutes = end.hour * 60 + end.minute
    const totalMinutes = Math.max(endMinutes - startMinutes, 60)
    const steps = Math.max(plan.postsPerDay - 1, 1)

    return Array.from({ length: plan.postsPerDay }, (_, index) => {
      const minuteOffset = plan.postsPerDay === 1 ? 0 : Math.round((totalMinutes / steps) * index)
      const total = startMinutes + minuteOffset
      const hour = Math.floor(total / 60)
      const minute = total % 60
      return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
    })
  }

  generateUpcomingSlots(plan: PostingPlan, daysForward = 21, fromDate = new Date()): CalendarSlot[] {
    const slots: CalendarSlot[] = []
    const timeValues = this.buildDailyTimeValues(plan)
    const activeDays = new Set(plan.activeDays)
    const nowIso = new Date().toISOString()

    for (let dayOffset = 0; dayOffset < daysForward; dayOffset += 1) {
      const localDate = addLocalDays(fromDate, plan.primaryTimezone, dayOffset)
      const dayIndex = getLocalDayIndex(localDate, plan.primaryTimezone)
      if (!activeDays.has(dayIndex)) {
        continue
      }

      const dateKey = getLocalDateKey(localDate, plan.primaryTimezone)

      timeValues.forEach((timeValue, slotIndex) => {
        const region = this.getRegionForIndex(plan, slotIndex)
        const scheduledUtc = zonedDateTimeToUtc(dateKey, timeValue, plan.primaryTimezone)

        if (scheduledUtc <= fromDate) {
          return
        }

        slots.push({
          id: randomUUID(),
          postingPlanId: plan.id,
          scheduledForUtc: scheduledUtc.toISOString(),
          scheduledTimezone: plan.primaryTimezone,
          slotLabel: `${REGION_LABELS[region]} ${timeValue}`,
          slotRegion: region,
          status: 'empty' as CalendarSlotStatus,
          scheduledPublicationId: null,
          blockedReason: null,
          createdAt: nowIso,
          updatedAt: nowIso
        })
      })
    }

    return slots.sort((a, b) => a.scheduledForUtc.localeCompare(b.scheduledForUtc))
  }

  regeneratePlanSlots(planId: string, daysForward = 21, fromDate = new Date()) {
    const plan = database.getPostingPlan(planId)
    if (!plan) {
      throw new Error(`Posting plan ${planId} not found`)
    }

    const existingSlots = database.listCalendarSlotsForPlan(plan.id)
    const existingTimes = new Set(existingSlots.map((slot) => slot.scheduledForUtc))
    const generatedSlots = this.generateUpcomingSlots(plan, daysForward, fromDate)
    const missingSlots = generatedSlots.filter((slot) => !existingTimes.has(slot.scheduledForUtc))

    database.replaceCalendarSlots(plan.id, missingSlots)
    return database.listCalendarSlotsForPlan(plan.id)
  }
}

export const slotGenerationService = new SlotGenerationService()
