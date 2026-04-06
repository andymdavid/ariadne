# Calendar Publishing V1 Execution Plan

## Purpose

This document turns the high-level scheduling and publishing plan into a concrete Ariadne implementation sequence using the current database and workflow architecture.

It is intentionally scoped to:

- YouTube scheduling first
- automatic scheduling triggered by clip approval
- regional slot planning
- direct schedule push to YouTube
- thumbnail generation as part of the publishing pipeline
- recycling after the core scheduling flow is stable

This is not the final product roadmap. It is the implementation order for a reliable V1.

## Current System Context

The current app already has:

- clip generation and ranking
- clip review / approval
- export jobs
- workflow job infrastructure
- artifacts
- content packages, titles, descriptions, thumbnails

Current relevant tables:

- `clips`
- `content_packages`
- `clip_titles`
- `clip_descriptions`
- `clip_thumbnails`
- `workflow_jobs`
- `workflow_step_runs`
- `artifacts`
- `export_jobs`
- `exports`
- `workflow_events`
- `failure_events`

This means publishing should be built as an extension of the existing workflow engine, not as a separate background system.

## V1 Scope

### Included

- connect one or more YouTube accounts/channels
- define one posting plan per YouTube channel
- generate future slots from regional posting windows
- automatically schedule approved clips into the next available slots
- require a locked export artifact before platform scheduling
- generate title/description/thumbnail package if missing
- upload and schedule videos directly on YouTube
- store platform publish state locally
- display scheduled posts in Calendar
- basic recycling support after publish history exists

### Not Included in V1

- multi-platform publishing beyond YouTube
- adaptive ML-based slot optimization
- live analytics-driven posting time feedback loops
- deep multi-variant thumbnail A/B testing
- full campaign planner

## Core Implementation Decisions

### 1. Scheduling Trigger

Scheduling should be triggered when:

- clip status changes to approved

That trigger should:

1. validate the clip is publishable
2. ensure a current export exists or enqueue one
3. ensure publish metadata exists or enqueue generation
4. assign next open slot
5. enqueue YouTube publication job

### 2. Scheduling Source of Truth

Local DB is the planning source of truth.

YouTube is the platform execution source of truth.

Meaning:

- Ariadne decides what to schedule and when
- YouTube holds the actual future scheduled post after upload

### 3. Publication Unit

The publishable thing is not just a clip.

It is:

- clip
- plus locked export artifact
- plus locked metadata payload
- plus locked thumbnail payload
- plus target account
- plus scheduled slot

This should be represented as a distinct record.

## New Data Model

### Table: `publishing_accounts`

Purpose:

- store connected YouTube channel credentials and metadata

Fields:

- `id TEXT PRIMARY KEY`
- `platform TEXT NOT NULL`
- `channel_id TEXT NOT NULL`
- `channel_name TEXT NOT NULL`
- `channel_handle TEXT`
- `timezone TEXT NOT NULL`
- `auth_status TEXT NOT NULL`
- `access_token_ref TEXT`
- `refresh_token_ref TEXT`
- `token_expires_at TEXT`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Notes:

- token values should not be stored casually in plain reusable config fields
- use secure storage or encrypted local storage strategy

### Table: `posting_plans`

Purpose:

- define slot generation rules per account

Fields:

- `id TEXT PRIMARY KEY`
- `publishing_account_id TEXT NOT NULL`
- `is_default INTEGER NOT NULL DEFAULT 1`
- `posts_per_day INTEGER NOT NULL`
- `active_days_json TEXT NOT NULL`
- `primary_timezone TEXT NOT NULL`
- `target_regions_json TEXT NOT NULL`
- `publishing_window_start TEXT NOT NULL`
- `publishing_window_end TEXT NOT NULL`
- `slot_strategy TEXT NOT NULL`
- `recycling_enabled INTEGER NOT NULL DEFAULT 0`
- `minimum_recycle_gap_days INTEGER NOT NULL DEFAULT 30`
- `max_recycles_per_clip INTEGER NOT NULL DEFAULT 3`
- `fresh_inventory_threshold INTEGER NOT NULL DEFAULT 10`
- `metadata_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### Table: `calendar_slots`

Purpose:

- optional but recommended
- persist generated slot inventory for visibility and manual override

Fields:

- `id TEXT PRIMARY KEY`
- `posting_plan_id TEXT NOT NULL`
- `scheduled_for_utc TEXT NOT NULL`
- `scheduled_timezone TEXT NOT NULL`
- `slot_label TEXT NOT NULL`
- `slot_region TEXT`
- `status TEXT NOT NULL`
- `scheduled_publication_id TEXT`
- `blocked_reason TEXT`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

Why persist slots:

- easier Calendar rendering
- easier drag/drop override
- easier empty-slot detection
- easier regeneration of future windows

### Table: `scheduled_publications`

Purpose:

- the central publishing record

Fields:

- `id TEXT PRIMARY KEY`
- `clip_id TEXT NOT NULL`
- `publishing_account_id TEXT NOT NULL`
- `calendar_slot_id TEXT`
- `export_artifact_id TEXT`
- `content_package_id TEXT`
- `selected_title_id TEXT`
- `selected_description_id TEXT`
- `selected_thumbnail_id TEXT`
- `platform TEXT NOT NULL`
- `scheduled_for_utc TEXT NOT NULL`
- `scheduled_timezone TEXT NOT NULL`
- `status TEXT NOT NULL`
- `is_recycled INTEGER NOT NULL DEFAULT 0`
- `source_publication_id TEXT`
- `youtube_video_id TEXT`
- `youtube_video_url TEXT`
- `youtube_upload_status TEXT`
- `platform_confirmed_publish_at_utc TEXT`
- `last_error_code TEXT`
- `last_error_message TEXT`
- `retry_count INTEGER NOT NULL DEFAULT 0`
- `created_at TEXT NOT NULL`
- `updated_at TEXT NOT NULL`

### Table: `publication_history`

Purpose:

- immutable state history for debugging and UI

Fields:

- `id TEXT PRIMARY KEY`
- `scheduled_publication_id TEXT NOT NULL`
- `event_type TEXT NOT NULL`
- `message TEXT`
- `detail_json TEXT NOT NULL DEFAULT '{}'`
- `created_at TEXT NOT NULL`

### Table: `clip_publish_preferences`

Purpose:

- optional clip-level scheduling and recycling flags

Fields:

- `clip_id TEXT PRIMARY KEY`
- `recycle_enabled INTEGER NOT NULL DEFAULT 1`
- `priority_score REAL NOT NULL DEFAULT 0`
- `exclude_until_utc TEXT`
- `last_published_at TEXT`
- `last_recycled_at TEXT`
- `recycle_count INTEGER NOT NULL DEFAULT 0`
- `performance_score REAL NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

## Recommended Status Model

### `scheduled_publications.status`

Use:

- `draft`
- `waiting_for_export`
- `waiting_for_metadata`
- `waiting_for_thumbnail`
- `ready_to_push`
- `scheduling_on_platform`
- `scheduled_on_platform`
- `published`
- `failed`
- `cancelled`
- `outdated`

### `calendar_slots.status`

Use:

- `empty`
- `reserved`
- `scheduled`
- `blocked`
- `published`

## Workflow Job Design

This should reuse `workflow_jobs`.

### New `job_type` values

- `publication_schedule`
- `publication_push`
- `thumbnail_generate`
- `metadata_generate`
- `calendar_slot_refresh`
- `publication_recycle`

### New `worker_kind` values

- `publishing`
- `thumbnail`
- `calendar`

### New Step Keys

For `publication_schedule`:

- `resolve_clip_publishability`
- `resolve_export_artifact`
- `resolve_metadata`
- `resolve_thumbnail`
- `assign_slot`
- `create_scheduled_publication`

For `publication_push`:

- `validate_account_auth`
- `upload_video`
- `upload_thumbnail`
- `apply_metadata`
- `schedule_publish_time`
- `persist_platform_result`

For `publication_recycle`:

- `select_recyclable_clips`
- `rank_recycle_candidates`
- `assign_recycle_slots`
- `create_recycle_publications`

## Trigger Architecture

### Clip Approval Trigger

When a clip becomes approved:

1. emit a review state change event
2. create a `publication_schedule` job for that clip if:
   - auto-scheduling is enabled
   - at least one active YouTube publishing plan exists

### Export Dependency Rule

Scheduling should not use mutable clip state.

The scheduler must resolve a stable export artifact first.

If a fresh export artifact does not exist:

- enqueue export
- keep publication in `waiting_for_export`

### Metadata Dependency Rule

If title/description are missing:

- enqueue metadata generation

If thumbnail is missing:

- enqueue thumbnail generation

## Slot Engine Design

### Slot Generator Input

- posting plan
- start date
- horizon in days
- already occupied slots
- blocked slots
- regional targeting windows

### Slot Generator Output

- ordered list of slot records

### Regional Window Model

Recommended v1 region presets:

- `aus_nz`
- `europe`
- `united_states`

Each preset provides preferred windows in local region time.

Example:

- `aus_nz`
  - 07:00-09:00
  - 17:00-20:00
- `europe`
  - 07:30-09:30
  - 12:00-14:00
  - 18:00-21:00
- `united_states`
  - 07:00-09:00
  - 12:00-14:00
  - 18:00-21:00

The slot engine maps those into UTC using the target date and timezone rules.

### Assignment Rule

Default assignment:

- next empty slot in chronological order
- respecting:
  - per-day post cap
  - one future publication per clip unless explicitly allowed
  - recycle cooldown rules

## YouTube Push Design

### Platform Push Timing

Push to YouTube immediately after slot assignment.

Do not wait until the publish date.

### Requirements Before Push

- valid YouTube account auth
- valid export artifact path
- title selected
- description selected
- thumbnail selected or skipped by policy

### Push Outputs

Persist:

- YouTube video ID
- video URL
- YouTube scheduled datetime
- YouTube upload state

### Retry Rules

Retryable failures:

- transient upload errors
- network/API errors
- token refresh recoverable errors

Non-retryable without user intervention:

- auth revoked
- metadata rejected repeatedly
- missing artifact

## Thumbnail Generation Design

### Trigger Point

Thumbnail generation should happen before publication push.

Recommended trigger:

- on schedule preparation if no valid selected thumbnail exists

### Model

Use:

- `google/gemini-3.1-flash-image-preview`

As the current Nano Banana 2 reference model.

### Inputs

- selected clip title
- title short variant for thumbnail text
- thumbnail reference images
- style notes
- font/style constraints
- optional key frame or clip frame

### Output Records

Store output in existing `clip_thumbnails` plus metadata linking model/prompt/version.

Recommended extension:

- use `clip_thumbnails.metadata_json` or extend table later if needed

Suggested metadata:

- model id
- prompt
- reference set ids
- text used
- style version

## Metadata Generation Design

### Trigger Point

If selected title/description do not exist at scheduling time:

- generate them before slot assignment completes

### Recommended behavior

- create several titles
- choose one as default publish title
- allow alternate titles for recycled publications later

## Recycling Design

### Activation Rule

Recycling should not run until:

- publication history exists
- some clips are already published

### Selection Inputs

- previously published clips
- cooldown rule
- recycle count
- performance score
- region recency

### Output

- create new `scheduled_publications` with:
  - `is_recycled = 1`
  - `source_publication_id` pointing to prior publication

## Calendar Page V1 UX

### Required sections

1. `Ready Queue`
- approved clips waiting to schedule

2. `Upcoming Calendar`
- generated slots and scheduled items

3. `Publication Inspector`
- selected slot/publication details

### Required actions

- auto-schedule approved clips
- retry failed push
- unschedule
- move slot
- block slot
- regenerate thumbnail
- regenerate metadata

## Implementation Order

### Slice 1: Schema foundation

Add:

- `publishing_accounts`
- `posting_plans`
- `calendar_slots`
- `scheduled_publications`
- `publication_history`
- `clip_publish_preferences`

Deliverables:

- schema.sql updates
- database migration helpers
- typed database access methods

### Slice 2: Account and posting plan backend

Add:

- YouTube account persistence
- posting plan CRUD
- regional slot window config

Deliverables:

- DB methods
- service layer
- basic settings/account wiring

### Slice 3: Slot engine

Add:

- slot generation service
- calendar slot persistence
- next-available-slot resolver

Deliverables:

- slot service
- tests around timezone mapping and region windows

### Slice 4: Approval-triggered scheduling

Add:

- workflow job creation when clip becomes approved
- dependency resolution for export/metadata/thumbnail
- scheduled_publication creation

Deliverables:

- publishing schedule worker
- event hooks from approval path

### Slice 5: YouTube push worker

Add:

- upload + schedule integration
- platform result persistence
- retry handling

Deliverables:

- publication push worker
- auth refresh handling
- failure events

### Slice 6: Thumbnail generation pipeline

Add:

- Nano Banana 2 thumbnail worker
- reference-driven prompt builder
- thumbnail persistence and selection

Deliverables:

- thumbnail worker
- reference asset model if needed

### Slice 7: Calendar UI

Add:

- slot grid
- scheduled item cards
- ready queue
- publication detail panel

Deliverables:

- working Calendar page v1

### Slice 8: Recycling

Add:

- recycle selection service
- recycle scheduling job
- recycled-state UI

Deliverables:

- automatic refill with recycled posts

## Recommended First Code Slice

The first actual implementation slice should be:

1. schema
2. DB access layer
3. posting plan service
4. slot generation service

Do not start with the Calendar UI.

Without:

- durable slot records
- publication records
- account records

the UI will just become placeholder scaffolding again.

## Acceptance Criteria for V1

V1 is successful when:

- approving a clip can automatically create a scheduled publication
- the publication is assigned to a real future slot
- the clip is pushed to YouTube as a scheduled post
- the scheduled post appears in Calendar with durable state
- editing the clip afterward marks the publication outdated
- empty future slots can be filled automatically
- recycled content can fill gaps once publish history exists
