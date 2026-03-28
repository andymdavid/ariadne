# Ariadne Product IA Simplification Spec

## Status

- Date: 2026-03-28
- Status: Proposed
- Owner: Product / UX
- Motivation: simplify Ariadne into a product that feels closer to Opus Clip in structure and defaults

## Core Decision

Ariadne should stop exposing its internal workflow as top-level product navigation.

The primary product should have only five persistent menu items:

- Home
- Brand Template
- Asset Library
- Calendar
- Analytics

Everything else should be subordinate to those areas.

## Why

The current product is over-explaining itself:

- too many workflow concepts are first-class
- too much per-clip editing is exposed
- too many decisions are repeated for every output
- too much product structure is based on how we built it, not how users think

That is why the app feels busy even when individual screens improve.

The right simplification is not "remove cards from trim."
It is "make fewer things primary."

## Product Thesis

The user should experience Ariadne as:

1. Bring in a source.
2. Generate reels in one click.
3. Apply a reusable brand system.
4. Review and lightly refine outputs.
5. Schedule and analyze performance.

That means Ariadne is not fundamentally:

- an editor-first tool
- a file management tool
- a screen-flow tool

It is a reel generation and publishing product with a brand system.

## New Top-Level Navigation

### 1. Home

Purpose:

- project entry point
- one-click reel generation
- recent work
- generation status

Primary actions:

- paste a source link
- upload a local file
- open recent project
- retry recent generation

This should be the dominant starting point.

### 2. Brand Template

Purpose:

- define how generated clips should look and behave by default

This should absorb most of what is currently treated as per-clip editing setup.

Brand Template should own:

- aspect ratio defaults
- caption style
- logo / overlay / CTA
- intro / outro
- music defaults
- AI filler-word removal
- AI pause removal
- keyword highlight behavior
- emoji behavior
- B-roll defaults later

This is the correct home for "how our clips should look."

### 3. Asset Library

Purpose:

- centralized reusable assets

Asset Library should own:

- logos
- music
- fonts
- image assets
- video overlays
- brand vocabulary
- censored words list

This should be reusable across projects, not repeatedly configured per clip.

### 4. Calendar

Purpose:

- scheduling and publishing workflow

Calendar should own:

- scheduled posts
- draft queue
- publishing status
- timezone / platform schedule logic later

### 5. Analytics

Purpose:

- understand performance and feed better generation choices later

Analytics should own:

- post performance
- top-performing clips
- hooks / captions / formats that work best
- account or channel performance later

## What Stops Being Top-Level

These should no longer be persistent navigation items:

- Review
- Editor
- Export
- Library
- Settings in the main workflow

They are still necessary functions.
They just should not be first-class product areas.

## Where Those Functions Move

### Review

Review becomes a project-level state under `Home`.

Flow:

- Home
- open generated project
- review generated clips inline

Review is a mode inside a project, not an app section.

### Editor

Editing becomes subordinate to generated clips.

Flow:

- Home
- open project
- open clip
- adjust if needed

Editing should be lightweight and exception-based.
It should not define the product structure.

### Export

Export should be mostly implicit.

Instead of a dedicated product area, generated clips should move through states like:

- generated
- approved
- scheduled
- published

Manual export can still exist, but it should be a project or clip action, not a destination.

### Library

The current "library" concept should split:

- reusable assets go to `Asset Library`
- finished content history belongs under `Analytics` or a project history area

## New Home Experience

Home should be dramatically simpler.

Recommended structure:

### A. Primary Generation Card

Top-center card:

- source URL input
- upload local file
- `Get clips in 1 click`

This is the product.

### B. Capability Shortcuts

Secondary icon row:

- Long to Shorts
- AI Captions
- Video Editor
- Enhance Speech
- AI Reframe
- AI B-Roll
- AI Hook

These are optional feature doors, not the core navigation.

### C. Recent Projects

Projects grid below:

- thumbnail
- title
- status
- last updated

This should feel lightweight and familiar.

## Brand System Strategy

The biggest structural change is this:

Most editing choices should become template defaults, not clip-by-clip decisions.

That means Ariadne should prefer:

- set once in Brand Template
- apply automatically to generated clips
- override only when needed

Instead of:

- open every clip
- restyle captions every time
- re-choose logo/music/frame repeatedly

This is the difference between a generation product and a manual editor.

## Project-Level Workflow

Each project should have a simple state model:

1. Source imported
2. Clips generated
3. Clips reviewed
4. Clips scheduled or exported
5. Performance tracked

Inside a project, the user should mainly see:

- source summary
- generated clips
- clip status
- selected template
- scheduling actions

## Clip Workflow

A clip should support only three levels of interaction:

### 1. Accept

The clip is good enough as generated.

### 2. Quick Adjust

Small edits only:

- trim
- transcript correction
- hook text
- thumbnail frame

### 3. Deep Edit

Only when truly necessary.

This should be rare and de-emphasized.

The current product over-optimizes for level 3.
We need to optimize for level 1 and level 2.

## Editor Position In The Product

The editor should still exist, but it should not feel like the center of Ariadne.

Recommended rule:

- default generated clips inherit Brand Template
- clip cards offer quick actions
- `Edit Clip` opens only for exceptions

That keeps the product focused on throughput, not manual tweaking.

## Settings Strategy

Do not give Settings equal visual weight in the main nav.

Settings should be lightweight and secondary:

- account
- API / integrations
- publishing accounts
- billing

These can live behind the profile or a gear menu.

## Simplified Navigation Model

Recommended persistent left nav:

```text
Home
Brand Template
Asset Library
Calendar
Analytics
```

Recommended secondary chrome:

- profile/account menu
- credits / billing
- notifications
- help

## IA Rules

These rules should guide future screens:

1. Do not create a top-level nav item for an internal workflow stage.
2. Prefer project states over separate workflow pages.
3. Prefer templates over repeated per-clip setup.
4. Prefer inline review and quick actions over full editing.
5. Prefer reusable assets over local clip-specific uploads.

## What This Means For The Current Codebase

The current route model is too workflow-heavy:

- `/review/:id`
- `/content/:id`
- `/export/:id`
- `/library`

Long-term, those should collapse toward:

- `Home`
- project detail / project review
- clip detail
- template pages
- asset library pages
- calendar
- analytics

The route model should reflect product nouns, not implementation phases.

## Migration Plan

### Phase 1: Product IA Reset

Goal:

- agree on the simplified product map

Tasks:

- adopt five-item top-level nav
- demote old workflow destinations from primary navigation
- define project-level review model

### Phase 2: Home Rebuild

Goal:

- make Home the true generation hub

Tasks:

- add source URL input
- keep upload local file
- prioritize one-click generation card
- show recent projects beneath it

### Phase 3: Brand System Consolidation

Goal:

- move repeated clip styling into Brand Template and Asset Library

Tasks:

- map existing caption/logo/music/frame settings to template defaults
- centralize asset selection
- reduce per-clip setup burden

### Phase 4: Review And Clip Actions

Goal:

- make project review lightweight and throughput-focused

Tasks:

- clip cards with accept / reject / quick adjust
- open editor only when needed
- reduce full-editor usage

### Phase 5: Calendar And Analytics

Goal:

- complete the loop from generation to posting to learning

Tasks:

- scheduling surface
- post history
- performance reporting

## Recommendation

We should stop designing around:

- Upload
- Review
- Content
- Export
- Library

And start designing around:

- Generate
- Brand
- Assets
- Schedule
- Learn

That is the cleaner product.
