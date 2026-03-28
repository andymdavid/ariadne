# Ariadne App Shell And Full-Page Editor Spec

## Status

- Date: 2026-03-28
- Status: Proposed
- Owner: Product / Editor
- Supersedes in practice: modal-first clip editing flow
- Related:
  - [trim-editor-redesign-spec.md](/Users/andydavid/Coding/Ariadne/docs/trim-editor-redesign-spec.md)
  - [09-Review-Page-Modal-Editing-Redesign.md](/Users/andydavid/Coding/Ariadne/Design-docs/09-Review-Page-Modal-Editing-Redesign.md)

## Decision

Ariadne should move away from modal-based clip editing and adopt a full-page editor inside a persistent application shell.

Electron is not the blocker. The current issue is information architecture.

## Why This Change

The modal approach was useful as an intermediate step, but it breaks down once trim, transcript, captions, logo, music, and framing all need to coexist in one editing environment.

The current modal causes predictable problems:

- too little room for a serious editor
- too many tabs and cards competing in one popup
- poor sense of place in the workflow
- weak navigation between review and edit tasks
- duplicated context between review, modal, and export

The product now needs a real workspace, not a popup.

## Product Direction

The target UX is closer to a modern web app shell:

- persistent left navigation
- top-level workspace switching
- full-page editor routes
- contextual right-side inspectors
- minimal modal usage

This can be implemented cleanly in Electron because the renderer is already a React application.

## Design Principles

1. Editing is a destination, not an overlay.
2. One screen should have one primary job.
3. Navigation should always show where the user is in the workflow.
4. Preview and timeline should be first-class surfaces.
5. Advanced controls should be contextual, not always visible.
6. Modals should be reserved for confirmations, pickers, and destructive actions.

## New Application Structure

### Primary Navigation

Recommended persistent left nav:

- Home
- Projects
- Review
- Editor
- Export
- Library
- Settings

Not every item needs to appear immediately, but this is the right conceptual model.

### Navigation Rules

- `Home` is for entry, recent projects, and import actions.
- `Projects` is for browsing and reopening work.
- `Review` is for evaluating and approving suggested clips.
- `Editor` is for full-page clip editing.
- `Export` is for output selection, metadata, and job monitoring.
- `Library` is for completed outputs and cleanup actions.

## Proposed Route Model

Recommended route structure:

```text
/
/projects
/project/:projectId
/project/:projectId/review
/project/:projectId/clip/:clipId/edit
/project/:projectId/export
/library
/settings
```

Optional later:

```text
/project/:projectId/editor
```

This could support a multi-clip workspace, but it should not block the first migration.

## Core Screen Roles

### 1. Home

Purpose:

- start new work
- resume recent work
- show system readiness

Primary content:

- import/upload card
- recent projects list
- empty-state sample project
- processing queue summary

### 2. Project Review

Purpose:

- review AI-selected clips
- approve, reject, and queue for editing

This screen should not be the full editor.

Primary content:

- clip cards or table
- transcript context preview
- score/reasoning summary
- quick actions:
  - approve
  - reject
  - open in editor

Secondary actions:

- batch approve
- re-run analysis
- refine selection criteria later

### 3. Clip Editor

Purpose:

- fully edit one clip in a dedicated workspace

This replaces the current modal.

### 4. Export

Purpose:

- choose output settings
- confirm metadata
- run export jobs
- monitor progress

### 5. Library

Purpose:

- review rendered outputs
- reopen source projects
- clean up old jobs and assets

## Clip Editor Page

This should be the heart of the product.

### Layout Model

Recommended page structure:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Header: project > clip title                [Save] [Back to Review]│
├───────────────┬──────────────────────────────────────┬─────────────┤
│ Left Rail     │ Main Workspace                       │ Right Rail  │
│               │                                      │             │
│ Sections      │ Preview                              │ Contextual  │
│ - Trim        │ Timeline / Editor Surface            │ inspector   │
│ - Transcript  │ Active tool panel                    │ and actions │
│ - Captions    │                                      │             │
│ - Logo        │                                      │             │
│ - Music       │                                      │             │
│ - Frame       │                                      │             │
├───────────────┴──────────────────────────────────────┴─────────────┤
│ Bottom transport / status bar                                      │
└────────────────────────────────────────────────────────────────────┘
```

### Editor Regions

#### A. Header

Must show:

- project name
- episode or clip label
- clip status
- unsaved changes state
- actions:
  - save
  - return to review
  - next/previous clip later if useful

#### B. Left Rail

Purpose:

- switch editing domains without tabs across the whole top of the workspace

Recommended sections:

- Trim
- Transcript
- Captions
- Logo
- Music
- Frame

This is more stable and scalable than top tabs inside a modal.

#### C. Main Workspace

Purpose:

- hold the primary preview and the active editing surface

Structure:

- large preview at top
- one active editor surface below
- content changes based on selected left-rail tool

Examples:

- `Trim`: overview timeline, transcript context strip, precision drawer
- `Transcript`: editable transcript segments with playback sync
- `Captions`: style controls plus live subtitle preview
- `Logo`: placement and scale tools
- `Music`: track selection and mix controls
- `Frame`: aspect ratio and crop tools

#### D. Right Rail

Purpose:

- contextual inspector, not permanent clutter

Examples:

- active boundary info during trim
- caption style summary during caption editing
- logo position/opacity during logo editing
- frame crop mode and aspect ratio during frame editing

This rail should be collapsible.

#### E. Bottom Transport

Purpose:

- keep play/pause, seek, timing, and lightweight status available without repeating them in every tool

Must stay compact.

## Trim In The New Full-Page Editor

The trim domain should follow the separate trim redesign spec, but its placement changes:

- trim is a left-rail section, not a modal tab
- precision controls appear in the workspace, not as stacked cards
- transcript context supports trim instead of competing with it

The workspace for `Trim` should be:

1. preview
2. overview timeline
3. transcript context strip
4. precision drawer when editing a boundary

That becomes the main trim environment.

## Review Page Role After Migration

The review page should become simpler, not more powerful.

Keep on review:

- clip browsing
- approval / rejection
- short preview
- transcript context
- AI reasoning

Move out of review:

- full trim editing
- caption editing
- logo/music/frame editing
- detailed boundary manipulation

The rule is simple:

- review decides what is worth editing
- editor performs the actual craft work

## Modal Usage After Migration

Modals should still exist, but only for narrow tasks:

- file picker wrappers
- confirmation dialogs
- apply-to-all confirmation
- delete project confirmation
- export preset selection if needed

Do not use modals for:

- clip editing
- timeline work
- transcript correction across a full clip
- precision trimming

## State And Data Implications

This IA change does not require changing the core processing architecture.

It does require better route-aware UI state:

- current project
- current episode
- current clip
- active editor section
- dirty state per clip
- save status

Recommended rule:

- persistent domain data stays in stores and database
- ephemeral tool state stays local to the editor section

Examples:

- trim boundary selection is local editor state
- saved trim points remain persisted
- caption style edits persist via existing clip edits

## Migration Plan

### Phase 1: Introduce The Shell

Goal:

- establish persistent navigation and a stable page layout

Tasks:

- add application shell component
- move global navigation into left sidebar
- standardize top header and page container
- keep existing routes working inside the new shell

Definition of done:

- app feels like one workspace rather than isolated screens

### Phase 2: Create Full-Page Clip Editor Route

Goal:

- replace modal editing with a dedicated page

Tasks:

- add `/project/:projectId/clip/:clipId/edit`
- move current modal logic into page-level editor container
- preserve current edit sections during migration
- wire `Review` actions to `Open in editor`

Definition of done:

- a clip can be edited without any modal

### Phase 3: Reshape Trim Workspace

Goal:

- implement the trim redesign in the full-page editor

Tasks:

- apply [trim-editor-redesign-spec.md](/Users/andydavid/Coding/Ariadne/docs/trim-editor-redesign-spec.md)
- remove the current diagnostic-heavy duration layout
- create rough cut and precision interaction layers

Definition of done:

- trim feels like a focused workspace, not a debug panel

### Phase 4: Refine Other Editor Sections

Goal:

- make transcript, captions, logo, music, and frame behave like coherent tools in the same page

Tasks:

- simplify each section UI
- move section-specific inspector content into right rail
- remove duplicated save and transport patterns

Definition of done:

- the editor reads as one product, not six unrelated tabs

## Component Model

Recommended top-level components:

- `AppShell`
- `SidebarNav`
- `TopBar`
- `ProjectReviewPage`
- `ClipEditorPage`
- `EditorSectionNav`
- `EditorInspectorRail`
- `GlobalTransportBar`

Recommended clip editor composition:

- `ClipEditorPage`
- `ClipEditorWorkspace`
- `TrimWorkspace`
- `TranscriptWorkspace`
- `CaptionWorkspace`
- `LogoWorkspace`
- `MusicWorkspace`
- `FrameWorkspace`

## UX Acceptance Criteria

The migration is successful if users can do the following without confusion:

1. Understand the difference between `Review` and `Editor`.
2. Open a clip into a dedicated editing workspace.
3. Recognize the current tool from the left rail.
4. See one dominant preview and one dominant editing surface.
5. Return to review or continue to export without losing context.

## Recommendation

Do not continue investing in the modal as the long-term shell.

Use the modal only as a temporary bridge while building:

1. `AppShell`
2. `ClipEditorPage`
3. `TrimWorkspace`

That is the correct structural direction for Ariadne.
