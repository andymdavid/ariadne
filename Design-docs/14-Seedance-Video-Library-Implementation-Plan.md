# AI Video Library Implementation Plan

## Goal

Add a new Ariadne capability that lets a user:

- generate reusable AI video assets in a dedicated workspace
- store those generated videos in a library
- apply one of those library videos to a clip as its visual source
- keep Clip Workspace preview and export aligned with that chosen video source

This is not a logo/overlay feature.
This is a **base visual replacement** feature for clips.

## Product Shape

Two product surfaces are required:

1. **Video Library**
- create new videos with a video generation model
- upload optional reference images
- manage generated outputs
- save and reuse generated videos across future clips

2. **Clip Workspace**
- choose the clip video source:
  - `Original source`
  - `Library video`
- preview the selected source immediately
- export from the selected source, not just the original media

## Model Assumption

OpenRouter currently exposes these live video generation models:
- `alibaba/wan-2.6`
- `bytedance/seedance-1-5-pro`
- `openai/sora-2-pro`
- `google/veo-3.1`

Sources:
- OpenRouter live video models endpoint:
  - https://openrouter.ai/api/v1/videos/models
- OpenRouter video generation guide:
  - https://openrouter.ai/docs/guides/overview/multimodal/video-generation

### Recommended Default Model For This Feature

For the stylized, painterly, illustrated references intended for this workflow:

- **Default**: `alibaba/wan-2.6`
- **Alternative**: `bytedance/seedance-1-5-pro`
- **Later premium/cinematic option**: `google/veo-3.1`

Reason:
- the target outputs are not primarily photoreal
- they are more about stylized still-image animation and visual mood retention

Implication:
- this feature should not be named or architected around Seedance only
- model choice should be configurable in the workspace
- the underlying system should be provider/model agnostic

### Naming

The product surface should be called:
- **Video Library**

Not:
- `Seedance Library`

Reason:
- the workspace should support model switching over time without renaming the feature

## Core User Flow

1. User opens `Video Library`
2. User enters:
- a base prompt
- an optional style/reference image
- optional prompt modifiers
- target aspect ratio
- target duration
 - target model
3. Ariadne submits a video generation job
4. Generated videos are saved as reusable library assets
5. User opens a clip in `Clip Workspace`
6. User switches `Video Source` from `Original source` to `Library video`
7. User selects one saved generated video
8. Preview updates immediately
9. Export uses the selected generated video as the clip’s base visual layer

## Product Rules

### Rule 1: Generated videos are reusable assets

Generated videos must not be treated as one-off outputs tied only to a single clip.

Each successful generation should become a reusable library asset with:
- video file path
- generation prompt
- optional reference image path
- model/provider metadata
- duration
- aspect ratio
- created timestamp
- preview thumbnail

### Rule 2: Clip video source is explicit

Each clip needs an explicit source selection:
- `original`
- `library_video`

If `library_video` is chosen, the clip must also store the selected asset id.

### Rule 3: Preview and export must resolve from the same source

The selected video source must drive:
- Clip Workspace preview
- export render
- publication/export packaging

No separate preview-only substitution is acceptable.

### Rule 4: Library videos are not Brand Template defaults

Brand Template controls:
- captions
- logo
- music
- frame/layout defaults

Library videos should not be part of Brand Template v1.
They are clip-level editorial choices.

## Why This Needs A Separate Workspace

The generation workflow is not a small control inside Clip Workspace.

It needs:
- prompt editing
- image reference upload
- model selection/config
- run history
- output review
- asset saving/reuse

That is a dedicated creation workflow, similar in weight to Brand Template or Content Packaging.

So the right UI split is:
- **Video Library** for generation and asset management
- **Clip Workspace** for selecting which library asset replaces a clip’s original visual source

## Proposed New Navigation Surface

Add a new primary screen:
- `Video Library`

It should sit alongside:
- Home
- Brand Template
- Asset Library
- Calendar
- Settings

This screen becomes the system of record for reusable generated video assets.

## Data Model

### `generated_video_assets`

Stores reusable generated outputs.

Suggested fields:
- `id`
- `name`
- `status`
- `provider`
- `model_id`
- `prompt`
- `style_prompt`
- `negative_prompt`
- `reference_image_path`
- `source_job_id`
- `file_path`
- `thumbnail_path`
- `duration_seconds`
- `aspect_ratio`
- `width`
- `height`
- `metadata_json`
- `created_at`
- `updated_at`

Statuses:
- `pending`
- `running`
- `completed`
- `failed`
- `archived`

### `generated_video_jobs`

Tracks generation attempts.

Suggested fields:
- `id`
- `asset_id` nullable until output exists
- `provider`
- `model_id`
- `prompt`
- `style_prompt`
- `negative_prompt`
- `reference_image_path`
- `input_json`
- `output_json`
- `status`
- `progress`
- `error_message`
- `created_at`
- `started_at`
- `completed_at`
- `updated_at`

### `clip_visual_sources`

Tracks the clip’s chosen visual source.

Suggested fields:
- `clip_id`
- `source_type` = `original` | `generated_video`
- `generated_video_asset_id` nullable
- `updated_at`

Alternative:
- this can be folded into `clip_edits`

Recommendation:
- use a dedicated table

Reason:
- visual source selection is now a first-class editorial decision
- it should not be buried in mixed legacy edit columns

## Backend Services

### `videoGenerationService.ts`

Responsibilities:
- validate generation inputs
- submit async video generation request
- poll job status if needed
- download/store output file
- generate preview thumbnail
- create/update DB records

This service must be provider-agnostic at the boundary:
- provider
- model id
- generation params

So the app can default to one model without hardwiring the whole subsystem to one vendor contract.

### `videoLibraryService.ts`

Responsibilities:
- list video assets
- get asset details
- archive/delete assets
- attach generated asset to a clip
- return reusable browse/search results

### `clipVisualSourceService.ts`

Responsibilities:
- resolve effective visual source for a clip
- default to original video when no override exists
- return the source path for:
  - preview
  - export

## Clip Workspace Changes

Add a new control section:
- `Video Source`

Controls:
- `Original source`
- `Library video`

If `Library video` selected:
- show currently selected video asset
- button to change asset
- button to jump to Video Library

Optional v1 interaction:
- modal picker listing saved video assets

The preview player should then load:
- episode source media if `original`
- generated video asset path if `library_video`

## Export Changes

Current export path already resolves:
- frame settings
- logo
- music
- caption overlay asset

The new rule should be:
- source media path is resolved per clip

That means:
- if clip uses original source, export from episode media path
- if clip uses generated video, export from generated asset path

This belongs in:
- [exportService.ts](/Users/andydavid/Coding/Ariadne/src/main/services/exportService.ts)
- potentially a new source resolution helper/service

Important:
- duration handling must be explicit

If generated video is shorter than clip duration:
- v1 behavior should be configurable but simple

Recommended v1:
- `loop if shorter`

Optional later:
- trim
- freeze last frame
- reject mismatch

## Preview Rules

Preview in Clip Workspace must use the exact same resolved source logic as export.

That means:
- same file path resolution
- same aspect ratio behavior
- same loop/fit behavior assumptions where possible

This is important because preview/export divergence is already a known risk area in the app.

## Video Library Screen UX

### Left: Generation Form

Fields:
- `Base Prompt`
- `Style Prompt`
- `Negative Prompt`
- `Reference Image`
- `Aspect Ratio`
- `Duration`
- `Model`

Primary actions:
- `Generate video`
- `Save prompt preset`

### Center: Preview / Job Status

Show:
- active generation job
- progress/status
- latest output preview

### Right: Library

Show reusable saved outputs:
- thumbnail / first-frame preview
- name
- aspect ratio
- duration
- created time
- prompt summary

Actions:
- `Use in clip`
- `Rename`
- `Archive`
- `Open in Finder`

## Prompting Model

The generation workflow should support two prompt layers:

1. **System/base prompt**
- app-level default prompt guidance for quality/style consistency

2. **User prompt**
- per-generation creative instruction

Optional v1:
- user-editable style preset templates

This is important because the feature should support repeatability and consistent style across future clips.

## Reference Image Behavior

Reference image should be optional but first-class.

Supported use cases:
- visual style reference
- composition reference
- subject/scene mood reference

Store the original reference image path with the generated asset/job metadata.

## OpenRouter Integration Shape

Use OpenRouter’s video generation endpoint:
- `/api/v1/videos`

Requirements:
- async job submission
- poll status or fetch result
- handle provider/model capability differences

The implementation must:
- keep provider model ID configurable
- load the model list from OpenRouter or from a maintained local config
- verify per-model supported durations/aspect ratios before submission
- store raw provider response metadata for debugging

### v1 Default Model Policy

For this workspace:
- default selected model: `alibaba/wan-2.6`
- alternative selectable model: `bytedance/seedance-1-5-pro`

Why:
- the current target visual references are stylized and illustrative
- this is a better default fit than realism-first cinematic models

## Failure States

Need explicit statuses for:
- generation queued
- generation running
- generation failed
- download failed
- asset saved but thumbnail failed
- clip references missing asset

Clip Workspace should degrade cleanly:
- if a selected generated asset is missing, show:
  - clear error state
  - option to revert to original source

## Library Semantics

The library should support reuse over time.

That means:
- do not delete assets just because one clip stops using them
- do not make clip ownership exclusive
- preserve generation metadata for auditing/repro

Optional later:
- tags
- collections
- prompt templates
- favorite assets

## Phased Implementation

### Phase 1: Foundations
- schema for generated video assets/jobs
- schema for clip visual source selection
- service layer for CRUD and source resolution

### Phase 2: Video Library Screen
- generation form shell
- library listing
- local state and job history

### Phase 3: OpenRouter Video Generation
- async generation jobs
- download/store output
- asset thumbnail generation

### Phase 4: Clip Workspace Integration
- `Video Source` control
- library asset picker
- preview source swap

### Phase 5: Export Integration
- resolve export source per clip
- support loop/trim behavior for generated videos
- ensure logo/music/captions still apply on top

### Phase 6: Polish
- prompt presets
- reference image quality controls
- better library browsing
- retry/recover failed generations

## Non-Goals For V1

Do not include in v1:
- inpainting or local scene edits inside the generated video
- automatic transcript-semantic matching to generated visuals
- per-word auto-cut visual generation
- Brand Template default generated video
- multi-layer generated video compositing

Those are separate problems.

## Critical Engineering Constraints

1. Preview/export parity must be preserved.
2. Generated videos must be reusable assets, not ephemeral temp outputs.
3. Clip source replacement must be explicit and inspectable.
4. Provider/model IDs must remain configurable and validated against OpenRouter-supported video models.

## Immediate Next Step

Before code:
- approve this plan as the source of truth

Then implement in this order:
1. schema + services
2. Video Library screen shell
3. OpenRouter generation integration
4. Clip Workspace `Video Source`
5. export source replacement
