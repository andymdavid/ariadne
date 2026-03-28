# Shadcn Migration Plan

## Goal

Use `shadcn/ui` as the default component system for Ariadne's shared product UI so the app stops mixing:

- legacy custom CSS
- ad hoc Tailwind styling
- partial token usage without a consistent primitive set

This migration is for shared product UI, not the specialized media-editing surfaces.

## Scope

Adopt `shadcn/ui` for:

- buttons
- inputs
- textareas
- cards
- badges
- tabs
- dialogs
- sheets
- dropdown menus
- tooltips
- scroll areas
- separators
- switches
- selects
- toasts

Keep custom implementation for:

- clip carousel
- video preview surfaces
- trim timeline
- caption overlay canvas
- drag handles and editing overlays

## Why

Current styling drift is coming from three competing systems:

1. global CSS in `src/renderer/src/styles/index.css`
2. one-off Tailwind in pages and components
3. a theme token layer that resembles shadcn, but without actually standardizing on shadcn primitives

That produces inconsistent:

- spacing
- borders
- radii
- hover/focus states
- typography rhythm
- panel hierarchy

## Target Architecture

### Layer 1: Tokens

Keep a small Ariadne theme:

- colors
- radius scale
- spacing rhythm
- typography sizes
- focus ring

This should live in the existing CSS variable layer and Tailwind config.

### Layer 2: Shared UI Primitives

Create or standardize a `src/renderer/src/components/ui/` layer using shadcn components as the default source of truth.

Examples:

- `button.tsx`
- `input.tsx`
- `card.tsx`
- `dialog.tsx`
- `tabs.tsx`
- `dropdown-menu.tsx`
- `sheet.tsx`
- `tooltip.tsx`
- `scroll-area.tsx`
- `separator.tsx`

### Layer 3: Product Components

Build Ariadne-specific components from those primitives:

- page header
- upload card
- asset section
- project card
- side rail sections
- settings panes
- review actions

### Layer 4: Specialized Editing Surfaces

Leave these outside shadcn and style them directly:

- clip review carousel
- trim editor
- preview canvas
- draggable brand template overlays

## Migration Order

### Phase 1: Foundation

1. confirm/install shadcn dependencies and generator setup
2. create shared `ui/` primitives
3. map Ariadne theme tokens onto the shadcn base
4. stop introducing new ad hoc primitives

### Phase 2: Shared Shell

Convert:

- sidebar nav buttons
- page headers
- command/search trigger
- standard action buttons
- basic cards and section shells

### Phase 3: Home

Convert:

- upload card
- link input
- primary CTA
- project cards
- empty states

### Phase 4: Asset Library and Brand Template

Convert:

- section cards
- asset rows
- upload actions
- font selection controls
- tabs / selectors / switches

### Phase 5: Review and Export

Convert:

- review action buttons
- badges
- back controls
- export controls
- confirmation dialogs

### Phase 6: Cleanup

Remove obsolete custom CSS classes from `index.css` once replacements are in place.

## Rules During Migration

1. Do not restyle specialized editing surfaces into generic shadcn cards.
2. Do not leave duplicate primitive systems alive longer than necessary.
3. Prefer replacing old custom buttons/inputs/cards over wrapping them.
4. When a page is migrated, remove the old page-specific visual hacks rather than layering more CSS on top.
5. Keep accessibility and keyboard behavior from shadcn primitives wherever possible.

## Immediate Next Steps

1. audit which shadcn primitives already exist in the repo
2. add the missing core primitives
3. migrate `Home` shared controls first
4. then migrate `Asset Library` and `Brand Template`

## Definition of Done

This migration is successful when:

- all standard product UI uses the same primitive system
- `index.css` is mostly layout/tokens, not component styling
- new pages no longer invent their own button/card/input styles
- visual consistency comes from the design system rather than one-off CSS
