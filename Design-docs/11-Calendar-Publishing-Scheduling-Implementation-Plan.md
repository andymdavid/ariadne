# Calendar, Publishing, Recycling, and Thumbnail Implementation Plan

## Objective

Turn Ariadne from a clip generation and editing tool into a lightweight publishing system that can:

- automatically schedule approved clips into the next best available publishing slots
- push those scheduled posts to YouTube itself so local uptime is not required
- maintain cadence with content recycling when fresh clips are insufficient
- generate thumbnail packages automatically, using reference-driven AI image generation
- keep the Calendar primarily visual and planning-oriented, while automation handles slot assignment

This spec is intentionally biased toward low-friction publishing. The user should not need to manually place every clip on the calendar.

## Product Principles

1. Approval should trigger scheduling eligibility automatically.
2. YouTube should be the durable scheduler of record once a post is scheduled.
3. Calendar is primarily visibility, review, override, and queue management.
4. Fresh clips are preferred, but recycled clips should fill inventory gaps.
5. Scheduling is driven by configured slot plans, not ad hoc manual time selection.
6. Thumbnail creation is part of the publishing pipeline, not a separate afterthought.

## Updated UX Direction

### Approval Flow

When a clip is approved in the clip review flow:

- it should automatically move into `ready_for_scheduling`
- it should not require a separate bulk `Schedule all` action
- the scheduler should attempt to place it into the next valid publishing slot
- if no valid slot is immediately available, it should remain in the ready queue

This means the effective flow becomes:

1. clip generated
2. clip reviewed
3. clip approved
4. clip exported or export-ready
5. clip enters scheduling queue
6. next available slot assigned automatically
7. schedule pushed to YouTube

### Calendar Role

Calendar should remain useful, but mostly as:

- a visual map of upcoming posts
- a place to inspect slots and overrides
- a place to see fresh vs recycled content
- a place to identify failures, empty slots, and outdated scheduled items

It should not be the only way to get a clip scheduled.

## Core Publishing Model

Scheduling should create a persistent publication record tied to:

- clip
- export artifact/version
- target platform/account
- scheduled publish time
- metadata payload
- thumbnail payload
- publication state

The publish time should then be pushed to YouTube at schedule time, so YouTube itself owns the eventual publish event.

## Scheduling Strategy

### Publishing Plan

Each connected YouTube channel should have a publishing plan:

- `posts_per_day`
- `active_days`
- `primary_timezone`
- `secondary_target_regions`
- `publishing_window_start`
- `publishing_window_end`
- `slot_strategy`
- `recycling_enabled`
- `minimum_recycle_gap_days`
- `max_future_schedules_per_clip`

### Timezone Strategy

This should explicitly support multi-region targeting.

The user concern is valid:

- local timezone matters
- but key publishing windows for USA and Europe matter too
- this means the system should not think in only one local posting pattern

#### Recommended v1 model

Use a single canonical scheduling timezone per channel, but let slot generation target multiple regional windows.

Example:

- channel primary timezone: `Australia/Perth`
- target regions:
  - `Australia/NZ`
  - `Europe`
  - `United States`

The scheduler then generates slots by merging target windows such as:

- AUS/NZ morning and evening
- Europe morning / lunch / evening
- US morning / afternoon / evening

The result may be more than 5 posts per day if the configured plan supports that.

#### Recommended v1 constraints

- store all scheduled times in UTC
- display:
  - channel local time
  - user local time
  - optional region label for why a slot exists

#### Slot examples

Slots can be tagged:

- `aus_peak`
- `eur_peak`
- `us_peak`
- `global_fallback`

This makes it easier to understand why content was placed where it was.

### Slot Assignment Modes

Recommended modes:

1. `fixed`
- same recurring slot times each day

2. `regional_weighted`
- slots generated from several region-specific windows
- best fit for the current product direction

3. `adaptive`
- future version
- slot weighting changes based on performance

Recommended v1 default:

- `regional_weighted`

## Automated Scheduling Behavior

When a clip becomes approved:

1. validate publishability
2. ensure an export artifact exists
3. ensure title/description/thumbnail package exists or can be generated
4. assign next available slot from the posting plan
5. create scheduled publication record
6. push scheduled upload to YouTube

If a required dependency is missing:

- no YouTube account connected
- export missing
- metadata generation failed
- thumbnail generation failed

then the clip remains in:

- `ready`
- or `needs_attention`

## YouTube Scheduling Model

The app should not rely on the MacBook staying on.

Therefore:

- schedule should be pushed to YouTube as soon as slot assignment happens
- Ariadne should upload and configure the scheduled video in advance
- YouTube should perform the actual future publish

### Minimum YouTube scheduling payload

- video asset
- title
- description
- thumbnail
- scheduled publish datetime
- privacy status
- Shorts-compatible metadata where required

### Stored response

Store:

- `youtube_video_id`
- `youtube_url`
- `youtube_upload_status`
- `scheduled_publish_at_utc`
- `youtube_confirmed_publish_at_utc`

## Content Recycling

Recycling should be first-class, not a bolt-on.

### Purpose

Maintain publishing volume even when fresh clips are low.

### Recycling behavior

When fresh inventory is insufficient:

- select eligible previously published clips
- rank them for reuse
- place them into future slots
- optionally regenerate title/thumbnail package

### Clip-level recycling fields

- `recycle_enabled`
- `last_published_at`
- `last_recycled_at`
- `recycle_count`
- `performance_score`

### Global recycling rules

- `minimum_days_between_reposts`
- `maximum_recycles_per_clip`
- `minimum_days_between_same_clip_in_same_region`
- `fresh_inventory_threshold`
- `recycle_preference_weight`

### Recommended v1 defaults

- minimum recycle gap: `30 days`
- max recycles per clip: `3`
- do not schedule same clip twice inside `14 days`
- prefer best-performing historical clips

### Recycled content UI treatment

Calendar items should visibly indicate:

- `fresh`
- `recycled`
- `outdated`

## Metadata Generation

Publishing should include metadata generation as part of the schedule pipeline.

### Required metadata

- title
- description
- optional tags
- thumbnail prompt package

### Title generation

The system should generate:

- one primary publish title
- several alternate titles

This supports:

- better default publishing
- alternate titles for recycled content
- thumbnail text generation

### Title rules

Recommended:

- platform-aware
- concise enough for thumbnail usage
- should not require manual creation every time

## Thumbnail Generation

Thumbnail creation needs to be part of the publishing system.

### Model requirement

Use the latest Nano Banana model available via OpenRouter as of April 2026:

- `Nano Banana 2`
- OpenRouter model ID: `google/gemini-3.1-flash-image-preview`

Reference:

- Google announcement: `Nano Banana 2: Combining Pro capabilities with lightning-fast speed` (Feb 26, 2026)
- OpenRouter model page: `google/gemini-3.1-flash-image-preview`

### Thumbnail generation flow

For each scheduled clip:

1. generate publish title candidates
2. select primary title
3. create thumbnail prompt package
4. send:
   - title
   - image reference set
   - font/style guidance
   - composition rules
   - brand/style references
5. generate thumbnail image
6. validate output
7. attach to scheduled YouTube post

### Reference-based generation

Thumbnail generation should use:

- thumbnail reference images
- style reference images
- creator visual references if needed

The output should match the styling direction of the references, especially:

- text placement
- text treatment
- font family
- font weight
- stroke/shadow/background treatment
- layout balance

### Text handling in thumbnails

The title for the clip should also be the thumbnail text basis.

The generated thumbnail system should:

- use the selected title or a short variant of it
- place it using the same style as the reference set
- preserve font consistency across outputs

### Thumbnail styling fields

Per channel or brand:

- `thumbnail_reference_images`
- `thumbnail_font_family`
- `thumbnail_font_weight`
- `thumbnail_text_style_notes`
- `thumbnail_layout_style_notes`
- `thumbnail_color_palette`

### Thumbnail versions

For future flexibility, store:

- primary thumbnail
- alternate thumbnails
- prompt package used
- model used

## Publication States

Recommended publication states:

- `draft`
- `ready`
- `queued_for_scheduling`
- `scheduled`
- `uploading_to_platform`
- `scheduled_on_platform`
- `published`
- `failed`
- `cancelled`
- `outdated`
- `recycled`
- `needs_attention`

## Outdated Schedule Behavior

If the clip or metadata changes after scheduling:

- mark publication as `outdated`
- do not silently overwrite the scheduled YouTube post

User actions:

- keep existing scheduled version
- regenerate export + thumbnail + metadata
- replace scheduled YouTube asset if allowed

Recommended v1:

- scheduling always locks to a specific export artifact and metadata version

## Failure Handling

Common failure points:

- YouTube auth expired
- export missing
- thumbnail generation failed
- metadata generation failed
- YouTube upload failed
- YouTube schedule rejected
- title/thumbnail not acceptable

Per publication store:

- `last_error_code`
- `last_error_message`
- `retry_count`
- `last_attempted_at`

UI actions:

- retry
- reschedule
- regenerate thumbnail
- regenerate metadata
- switch account

## Data Model

### `publishing_accounts`

- `id`
- `platform`
- `channel_id`
- `channel_name`
- `timezone`
- `auth_status`
- `created_at`
- `updated_at`

### `posting_plans`

- `id`
- `account_id`
- `posts_per_day`
- `active_days`
- `publishing_window_start`
- `publishing_window_end`
- `slot_strategy`
- `primary_timezone`
- `target_regions_json`
- `recycling_enabled`
- `minimum_recycle_gap_days`
- `max_recycles_per_clip`
- `created_at`
- `updated_at`

### `scheduled_publications`

- `id`
- `clip_id`
- `export_id` or `artifact_path`
- `account_id`
- `platform`
- `scheduled_for_utc`
- `scheduled_timezone`
- `slot_label`
- `status`
- `is_recycled`
- `source_publication_id`
- `title`
- `description`
- `thumbnail_path`
- `thumbnail_model`
- `thumbnail_prompt_json`
- `platform_post_id`
- `platform_url`
- `last_error_code`
- `last_error_message`
- `retry_count`
- `created_at`
- `updated_at`

### `publication_history`

- immutable event log
- recommended for:
  - retries
  - failures
  - publish confirmation
  - reschedules
  - recycle actions

## Worker Model

Need a background publishing worker to:

- build next slot assignments
- generate metadata if missing
- generate thumbnails if missing
- upload to YouTube
- set YouTube schedule
- reconcile platform status

### Important design rule

The worker should push schedule to YouTube immediately after slot assignment.

It should not rely on local app uptime at the actual publish time.

## Calendar UX

### Layout

Three-zone structure:

1. left rail
- ready clips
- recycled candidate pool
- failed items

2. center
- calendar grid
- scheduled posts
- empty slots

3. right panel
- selected publication details
- platform status
- metadata
- thumbnail
- actions

### Key actions

- `Auto-schedule approved clips`
- `Fill empty slots`
- `Recycle top performers`
- `Retry failed`
- `Unschedule`
- `Move to another slot`
- `Regenerate thumbnail`
- `Regenerate metadata`

## Implementation Phases

### Phase 1: Data and connection layer

- add YouTube account model
- add posting plan model
- add scheduled publication model
- add OAuth/token storage and refresh handling

### Phase 2: Slot engine

- implement slot generation
- support regional weighted windows
- automatic next-slot assignment on approval
- calendar rendering of scheduled items

### Phase 3: YouTube scheduling

- upload export artifact
- set title/description/thumbnail
- set scheduled publish time on YouTube
- store returned platform IDs/status

### Phase 4: Thumbnail automation

- add thumbnail prompt/reference model
- integrate OpenRouter Nano Banana 2
- generate thumbnails from references + title
- attach thumbnail to scheduled publication

### Phase 5: Recycling

- identify eligible published clips
- add recycle ranking and cooldown logic
- schedule recycled content into empty slots

### Phase 6: Failure handling and reconciliation

- retry flows
- outdated detection
- scheduled post inspection
- platform state refresh

## Immediate Build Recommendation

Build in this order:

1. YouTube account connection
2. posting plan + slot generation
3. scheduled publication model
4. automatic schedule-on-approval flow
5. push schedule to YouTube
6. thumbnail generation
7. recycling

This gets the product useful quickly while keeping room for the more automated thumbnail and recycle systems.

## Open Questions

1. Should recycled clips reuse the same metadata by default, or generate alternates?
2. Should a clip be allowed more than one future scheduled publication at once?
3. Should thumbnail generation happen on approval, on scheduling, or just before YouTube upload?
4. Should failed thumbnail generation block scheduling, or allow scheduling with a fallback thumbnail?
5. Should region targeting be channel-specific or plan-specific?

## Recommended Defaults

- schedule automatically when approved
- push schedule directly to YouTube immediately
- use weighted regional slots
- allow more than 5 posts/day where slot inventory supports it
- use Nano Banana 2 for thumbnail generation
- keep recycled posts clearly labeled
- lock schedules to specific export artifacts
