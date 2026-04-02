# Ariadne UI Plan

This plan maps the Midday dashboard aesthetic into Ariadne as a visual and layout reference only. It does not copy Midday code, assets, icons, or product structure.

Reference sources reviewed:
- Midday repo: https://github.com/midday-ai/midday/tree/main
- License: https://github.com/midday-ai/midday/blob/main/LICENSE
- Dashboard shell layout: https://raw.githubusercontent.com/midday-ai/midday/main/apps/dashboard/src/app/%5Blocale%5D/(app)/(sidebar)/layout.tsx
- Sidebar: https://raw.githubusercontent.com/midday-ai/midday/main/apps/dashboard/src/components/sidebar.tsx
- Main menu: https://raw.githubusercontent.com/midday-ai/midday/main/apps/dashboard/src/components/main-menu.tsx
- Header: https://raw.githubusercontent.com/midday-ai/midday/main/apps/dashboard/src/components/header.tsx
- Dashboard globals: https://raw.githubusercontent.com/midday-ai/midday/main/apps/dashboard/src/styles/globals.css
- Shared UI globals: https://raw.githubusercontent.com/midday-ai/midday/main/packages/ui/src/globals.css
- Shared Tailwind preset: https://raw.githubusercontent.com/midday-ai/midday/main/packages/ui/tailwind.config.ts

## Visual Direction

Adopt these characteristics:
- Neutral grayscale dark palette
- Thin borders instead of heavy shadows
- Small, controlled radius values
- Sidebar and header as the primary shell
- Content rendered onto the page background, not nested card-on-card
- Quiet active and hover states
- Consistent spacing rhythm

Do not copy:
- Midday code or component structure
- Midday icons, assets, branding, or page composition
- Exact interaction details that are product-specific

## Token Rules

Standardize Ariadne around:
- App background: near-black neutral
- Panel background: slightly lifted neutral
- Border color: subtle dark gray
- Primary text: near-white
- Secondary text: muted gray
- Shell radius: 10px
- Control radius: 5px
- Minimal shadows

## Implementation Backlog

### 1. Foundation Tokens
- Normalize the global dark palette to a Midday-like neutral grayscale system.
- Remove remaining glassmorphism from shared surfaces.
- Unify primary/secondary button radii and border treatments.
- Unify chip, list-row, panel, and muted-surface styling.

Status:
- Started

### 2. Shell Layout
- Treat the sidebar and header as the app’s main structure.
- Remove remaining hardcoded dock offsets and route-level margin hacks.
- Use one shared nav-width variable for compact and expanded sidebar modes.
- Keep pages rendered on the main background rather than inside nested shell cards.

Status:
- In progress

### 3. Sidebar Navigation
- Keep the new compact sidebar as the base.
- Refine active state, hover state, and icon spacing.
- Keep Settings as a first-class destination.
- Remove stale command-only navigation dependencies.
- Support expandable/collapsible behavior cleanly.

Status:
- In progress

### 4. Header System
- Use one consistent page header height and divider treatment.
- Standardize title, subtitle, separator, and right-side actions.
- Remove decorative metadata from headers where it does not help decision making.

Status:
- Pending

### 5. Surface System
- Replace page-specific surface variants with a shared panel system.
- Standardize:
  - section shells
  - muted surfaces
  - list rows
  - empty states
  - inline action groups
- Reduce page-level styling drift.

Status:
- Pending

### 6. Form and Control System
- Standardize:
  - text inputs
  - selects
  - toggles
  - segmented buttons
  - icon buttons
  - status pills
- Keep controls compact and neutral.

Status:
- Pending

### 7. Page Cleanup Order
1. Settings
2. Asset Library
3. Home
4. Brand Template refinement pass
5. Clip Workspace / Clip Editor shell alignment
6. Export

Status:
- Pending

### 8. Typography and Density
- Reduce decorative labels and unnecessary kickers.
- Keep type hierarchy tighter and calmer.
- Standardize spacing on an 8 / 12 / 16 / 24 / 32 rhythm.

Status:
- Pending

## Working Rules

- Favor shell structure over more cards.
- Prefer border, spacing, and typography over effects.
- Every new page should inherit from shared primitives first.
- Avoid reintroducing large-radius, glassy, or purple-accent patterns.
- When in doubt, make the UI quieter, flatter, and more structurally consistent.
