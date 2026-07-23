# ANDA component implementation brief

## Purpose

This folder is the source-owned component foundation for the ANDA meeting operating system. It is frontend-only. Do not change backend services, API contracts, middleware, database logic or workflow rules while implementing these components.

The current application still uses DaisyUI. Keep it installed during the transition and replace existing presentation incrementally, screen by screen. Business behaviour, API calls and mutation rules stay in the existing feature and API-client layers.

## Chosen foundation

- **Component source:** shadcn/ui, compact **Mira** preset.
- **Interaction layer:** Base UI.
- **Icons:** Phosphor Icons.
- **Data grids:** TanStack Table with the source-owned table primitive.
- **Complex forms:** React Hook Form with existing Zod schemas.
- **Review workspace:** react-resizable-panels through the source-owned resizable primitive.
- **Mutation feedback:** Sonner.
- **Existing framework:** Next.js 15, React 19 and Tailwind CSS 4.

The files under `primitives/` are checked-in source, not a black-box component package. Adapt their classes and compose ANDA-specific patterns here. Do not copy business logic into them.

## Visual direction

This is a dense internal operations tool. Function and legibility come before decoration.

- Keep the established ANDA navy, teal and orange semantic tokens in `src/app/globals.css`.
- Navy is the structural and primary-action colour.
- Teal communicates progress, selection and focus.
- Orange is reserved for attention and should not become a general surface colour.
- Use compact controls, clear grouping and strong information hierarchy.
- Avoid gradients, ornamental glass effects, nested cards and excessive rounded containers.
- Keep focus rings visible and meet WCAG AA contrast.
- Use tabular numerals for dates, durations, counts and status metrics.
- Do not use emoji as interface icons.

The `gpt-taste` selection chose **Satoshi** as the future typography direction. It is not bundled here because it is not available through the project's package font source and its delivery licence must be confirmed before loading it. Until that is resolved, retain the current Aptos/Segoe system stack. Do not add Inter.

## Imported primitives

### Actions and status

- `button.tsx`
- `badge.tsx`
- `switch.tsx`

Use buttons for actual actions, links for navigation and badges for short lifecycle states. Destructive actions must never rely on colour alone.

### Forms

- `field.tsx`
- `label.tsx`
- `input.tsx`
- `textarea.tsx`
- `select.tsx`
- `checkbox.tsx`
- `radio-group.tsx`

Use React Hook Form only for multi-field or nested editors. Simple search and filter inputs do not need form state machinery. Reuse the existing Zod contracts; do not duplicate validation schemas in components.

### Overlays and disclosure

- `dialog.tsx`
- `alert-dialog.tsx`
- `sheet.tsx`
- `dropdown-menu.tsx`
- `popover.tsx`
- `tooltip.tsx`
- `tabs.tsx`
- `collapsible.tsx`
- `scroll-area.tsx`

Use an alert dialog for irreversible or high-consequence confirmation. Tooltips may clarify unfamiliar icons but must not contain essential information. Sheets are for narrow-screen secondary workflows, not desktop modal replacement.

When the tooltip component is first adopted, add one `TooltipProvider` at the application provider boundary rather than wrapping individual controls.

### Data and workspace

- `table.tsx`
- `pagination.tsx`
- `resizable.tsx`
- `separator.tsx`

TanStack Table should control sorting, filtering, visibility and pagination while the local table primitive owns markup and appearance. Use resizable panels for transcript/minutes or minutes/PDF comparison on desktop; collapse the same content to tabs on smaller screens.

### Feedback and asynchronous states

- `alert.tsx`
- `progress.tsx`
- `skeleton.tsx`
- `empty.tsx`
- `sonner.tsx`

Use Sonner for short success messages such as saved, approved, retry started or link copied. Keep validation errors and workflow failures inline and persistent. Skeletons must approximate the final layout. Progress must represent real progress or an explicitly indeterminate task.

## Screen mapping

| Area | First components to compose |
| --- | --- |
| Dashboard | Badge, Alert, Skeleton, Empty |
| Meeting queues | TanStack Table, Table, Pagination, Dropdown Menu, Badge |
| Search and archive | Input, Select, Popover, Table, Pagination |
| Meeting review | Tabs, Resizable, Scroll Area, Collapsible, Separator |
| Minutes editor | Field, Input, Textarea, Select, Checkbox, Radio Group |
| Approval and rejection | Dialog, Alert Dialog, Field, Textarea, Sonner |
| PDF and signing | Dialog or Sheet, Progress, Alert, Tooltip |
| Accounts and settings | Table, Dropdown Menu, Switch, Radio Group, Field |

## Selected expressive patterns

The deterministic `gpt-taste` pass selected the following patterns:

- Editorial Split
- Infinite Marquee
- Horizontal Accordions
- Inline Typography Images
- Image Scale and Fade Scroll
- Card Stacking

These are **not defaults for operational screens**. They are available for a later non-production specimen or a restrained overview/empty-state treatment:

- Editorial Split may structure a specimen introduction or onboarding screen.
- Infinite Marquee may show non-critical identity or notice content only. It must pause on interaction and become static under reduced motion.
- Horizontal Accordions may explain the meeting lifecycle but must not replace queues, tables or review controls.
- Inline Typography Images are limited to onboarding or empty states and need meaningful alternative text when informative.
- Image Scale and Fade Scroll and Card Stacking require GSAP if implemented. Do not add GSAP until an approved design actually needs these patterns.
- Never animate approval, rejection, signing, archiving or error recovery controls.

For any later specimen page, use an editorial-split introduction, a dense 12-column bento grid and no numbered meta-labels. A two-row example may use spans `7x2`, `5x1` and `5x1`, filling all 24 grid cells. Headings should stay within two or three lines.

## Implementation order

1. Re-theme and adopt Button, Badge, Alert, form fields and Phosphor icons.
2. Replace approval/rejection dialogs and mutation feedback.
3. Move meeting queues and archive results to TanStack Table.
4. Build the resizable meeting-review workspace with a responsive tab fallback.
5. Move the minutes editor to composed fields and React Hook Form.
6. Evaluate DaisyUI removal only after production screens no longer depend on its classes.
7. Consider Recharts or a command palette only if a real workflow requirement appears.

## Definition of done for each adopted component

- Light and dark ANDA themes both work.
- Keyboard interaction and focus order are verified.
- Focus indicators remain visible.
- Loading, empty, error, disabled and destructive states are represented.
- Mobile and small-laptop layouts remain usable.
- `prefers-reduced-motion` is respected.
- Component tests cover behaviour that differs from the imported primitive.
- Existing API calls and backend behaviour are unchanged.
- Lint, typecheck, relevant UI tests and production build pass.
