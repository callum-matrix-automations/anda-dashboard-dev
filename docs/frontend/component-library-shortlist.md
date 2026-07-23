# ANDA frontend component library shortlist

Research snapshot: 23 July 2026

This document records the component-library research behind the ANDA frontend redesign. The approved first set now lives in `src/frontend/components/design-system`; adoption into production screens remains incremental.

## Selection principles

- Preserve the existing Next.js 15, React 19 and Tailwind CSS 4 stack.
- Keep ANDA's own colours, typography, density and component styling.
- Prefer accessible, headless behaviour over a pre-styled dashboard theme.
- Adopt components incrementally so existing workflows remain testable.
- Avoid two competing implementations of the same primitive.
- Keep business rules and API calls outside reusable visual components.

## Preferred component foundation

### shadcn/ui with Base UI: selected component foundation

Status: **installed for incremental adoption**

The compact Mira preset is installed on the Base UI foundation. shadcn/ui adds component source code to the application rather than hiding it behind a package API, which lets us apply ANDA tokens and retain ownership of the markup. Base UI is shadcn's current recommendation for new projects; Radix remains a supported alternative.

Installed starting set:

- Button
- Badge
- Alert and Alert Dialog
- Dialog
- Sheet for narrow-screen workflows
- Dropdown Menu
- Tooltip
- Popover
- Tabs
- Collapsible
- Scroll Area
- Separator
- Input, Textarea and Field
- Select
- Checkbox and Radio Group
- Switch
- Progress
- Skeleton
- Empty
- Pagination
- Sonner integration
- Resizable
- Table

Conditional additions such as Breadcrumb, Button Group, Combobox and Input Group should be brought in only when a redesigned screen needs them.

Do not install the entire catalogue. Adopt and restyle the selected components one screen at a time.

Official references:

- https://ui.shadcn.com/docs/components
- https://ui.shadcn.com/docs/tailwind-v4

### Base UI: selected interaction layer

Status: **installed through the selected shadcn primitives**

Base UI provides the accessible, unstyled behaviour beneath the selected source-owned components. Import Base UI directly only when ANDA needs behaviour that the shadcn component does not expose cleanly.

Most useful primitives:

- Dialog and Alert Dialog
- Dropdown Menu
- Popover
- Select
- Tabs
- Tooltip
- Collapsible
- Checkbox and Radio Group
- Progress
- Scroll Area
- Switch

Official references:

- https://base-ui.com/react/overview/about
- https://ui.shadcn.com/docs/changelog/2026-07-base-ui-default

## Focused libraries

### TanStack Table

Status: **installed for queues, search and archive**

Use the headless React adapter rather than a pre-styled grid. It provides sorting, filtering, pagination, column visibility, selection, resizing and expansion while leaving the table markup and ANDA styling under our control.

Best targets:

- All meetings
- Needs review
- Deferred meetings
- Treasurer signing queue
- Search results
- Archive
- Account administration

Useful features:

- Server-controlled sorting, filters and pagination
- Optional columns on narrow screens
- Expandable rows for secondary metadata
- Row selection if batch operations are added later
- Column sizing and visibility

Official references:

- https://tanstack.com/table/latest/docs/overview
- https://tanstack.com/table/latest/docs/guide/features

### Phosphor Icons

Status: **installed as the application icon system**

Replace the current text glyphs with one consistent icon family. Phosphor provides multiple weights, tree-shaking and Next.js-specific import guidance. Use regular-weight icons for navigation and bold or filled variants only for selected states.

Likely icons:

- Dashboard, meetings, review, defer, signing and archive
- Search, filters and sorting
- Edit, save, approve, reject and retry
- PDF, download and external link
- Status and operational alerts
- Account, settings and navigation controls

Official reference:

- https://github.com/phosphor-icons/react

### react-resizable-panels

Status: **installed for the meeting review workspace**

Use a resizable desktop split between the source transcript and editable minutes or PDF preview. Collapse to tabs or a sheet on smaller screens. Keyboard-accessible separators must remain visible.

Best targets:

- Transcript and minutes comparison
- Meeting editor and source evidence
- Minutes and PDF preview

Official references:

- https://github.com/bvaughn/react-resizable-panels
- https://ui.shadcn.com/docs/components/aria/resizable

### React Hook Form

Status: **installed for complex editor and administration forms**

Use with the existing Zod schemas to reduce manual field state and make validation consistent. Do not introduce it for one-field filters or simple search boxes.

Best targets:

- Meeting minutes editor
- Attendee, motion and vote editing
- Approval and rejection forms
- Account administration
- Settings forms

Official reference:

- https://www.react-hook-form.com/

### Sonner

Status: **installed as the future replacement for the custom toast**

Use for short mutation outcomes such as saved, approved, retry started or link copied. Keep persistent errors and workflow failures inline rather than hiding them in transient notifications.

Official reference:

- https://github.com/emilkowalski/sonner

### Recharts

Status: **optional, only when a metric needs a chart**

Use sparingly for workflow volume or status history. Do not turn the operational dashboard into a decorative analytics screen.

Possible uses:

- Meetings by lifecycle state
- Processing failures over time
- Approval turnaround time
- Signing and archive completion trends

Useful components:

- Bar Chart
- Line Chart
- Area Chart
- Responsive Container
- Tooltip

Official reference:

- https://recharts.github.io/en-US/api/

### cmdk

Status: **optional later**

Consider only if the global search evolves into a keyboard command palette for navigation, opening meetings and invoking safe actions. The existing search field does not currently justify another dependency.

Official reference:

- https://github.com/dip/cmdk

## Screen-to-component map

| ANDA area | Components marked for later use |
| --- | --- |
| Application shell | Sidebar, Sheet, Breadcrumb, Tooltip, Dropdown Menu, Phosphor icons |
| Dashboard | Custom metric blocks, Empty, Skeleton, optional Recharts |
| Meeting queues | TanStack Data Table, Pagination, Dropdown Menu, Badge, Skeleton, Empty |
| Search and archive | Input Group, Combobox or Select, Popover, TanStack Data Table, Pagination |
| Meeting review | Tabs, Resizable Panels, Scroll Area, Collapsible, Separator, Sheet |
| Meeting editor | Field, Input, Textarea, Select, Combobox, Checkbox, Radio Group, React Hook Form |
| Approval and rejection | Alert Dialog, Dialog, Field, Textarea, Sonner |
| PDF and signing | Dialog or Sheet, Progress, Alert, Tooltip, external-link actions |
| Accounts and settings | Avatar, Data Table, Dropdown Menu, Switch, Radio Group, Field |
| Loading and failures | Skeleton, Empty, Alert, Progress, inline recovery actions |

## Libraries not selected

- **Material UI, Ant Design and Mantine:** comprehensive but would introduce a competing visual and theming system.
- **React Spectrum:** strong accessibility, but too much overlap with the chosen Base UI/shadcn primitive layer.
- **React Aria Components:** a credible alternative to Base UI, but should not be mixed into the same primitive layer without a specific unmet requirement.
- **A full prebuilt admin template:** likely to erase the ANDA identity and constrain the existing workflows.
- **Multiple icon libraries:** use one icon family consistently.

## Adoption order

1. Phosphor icons and foundational shadcn components.
2. Dialogs, sheets, tabs, tooltips and form controls.
3. TanStack Table for operational lists.
4. Resizable meeting review workspace.
5. React Hook Form for complex editing.
6. Sonner for mutation feedback.
7. Recharts or cmdk only if the redesigned workflow demonstrates a real need.

Keep DaisyUI installed during the transition so current screens continue to work. As each component is redesigned, move its presentation into source-owned ANDA components. Decide whether DaisyUI can be removed only after the redesigned screens no longer depend on its classes.
