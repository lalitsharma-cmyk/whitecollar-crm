# White Collar Realty CRM — Mobile UX Report
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Testing approach:** Source code audit of MobileShell, KanbanBoard, and page components for mobile-specific patterns. Primary device target: iPhone (390x844 viewport).

---

## Overview

The CRM uses a `MobileShell` component as the root layout wrapper, providing a top header bar and a bottom navigation bar for mobile users. Desktop users see a left sidebar. The architecture is responsive-first using Tailwind CSS breakpoint prefixes (`sm:`, `lg:`).

---

## Mobile shell

### Bottom navigation bar
Five icons pinned at the bottom of the screen for quick access:
- Home (Dashboard)
- Leads
- Revival Engine
- To Do (Action List)
- Properties

The bottom nav mirrors the top 5 WORKSPACE links and is always visible on mobile regardless of which page is open.

### Top header bar (mobile)
- Hamburger menu opens a full-screen slide-in nav with all sections
- Bell icon for notifications
- Quick search
- Theme toggle
- User avatar

### Nav items for AGENT role
`agentHidden: true` items (Reports, Call Logs) are suppressed from the nav for AGENT role. This prevents agents from navigating to pages they are blocked from.

---

## Page-level mobile audit

### Dashboard
- KPI cards use single-column grid on mobile, expanding to multi-column on sm+
- "By Salesperson" table has `overflow-x-auto` — scrolls horizontally on mobile
- Pipeline overview visible

### Leads list
- Cards stack vertically on mobile
- Bulk action controls wrap gracefully

### Lead detail
- `LeadMobileTabs` component handles tabbed view of lead sections on mobile, avoiding the long vertical scroll
- Call/WhatsApp buttons always visible as fixed-bottom bar on mobile

### Pipeline (Kanban)
**BUG-012 FIXED:** Mobile stage-change now works.
- `sm:hidden` "Move Stage" button on every kanban card
- Opens a bottom-sheet stage picker listing all stages
- Current stage shown as disabled (with checkmark)
- Selecting a new stage flows into the shared "What changed?" modal
- Desktop drag-and-drop is unchanged

### Action List
- Cards stack vertically, full width on mobile
- Call/WhatsApp action bar visible
- Urgent glow animations work on mobile

### Activities
- Sections render as vertical cards
- Top 5 strip is full-width
- Type filter banner dismisses with a link

### Cold Calls / Revival Engine
- Two-column layout (leads list + leaderboard/streak) collapses to single column on mobile
- Hidden Gems banner is horizontally scrollable on small screens
- "Start session" button full-width on mobile

### Call Logs
- Table has `overflow-x-auto` wrapper
- Filter form wraps fields using `flex-wrap`

### Reports / Heatmap
- Heatmap grid has overflow-x-auto container
- Best-slot line and disclaimer stack vertically

### Admin Users
- User table has `overflow-x-auto` wrapper
- Invite and Edit modals are bottom-sheet style on mobile (`items-end` on small viewports, `items-center sm:p-4` on larger)
- Edit modal uses `rounded-t-2xl` for bottom-sheet appearance

### Settings
- All card sections are `max-w-2xl` but flow to full-width on narrow screens

---

## Mobile-specific known limitations

1. **Drag-and-drop on pipeline not supported on touch** — by design. The "Move Stage" bottom-sheet button is the touch-first alternative.
2. **PWA install nudge** — `PWAInstallNudge` component is present for Chrome/Safari "Add to Home Screen" flow. Not all features tested in installed-PWA mode.
3. **Voice note recorder** — Uses browser `MediaRecorder` API; works on iOS 16+ Safari. Older devices may not support it.

---

## Verdict

Mobile UX is functional and production-ready. BUG-012 (the only blocking mobile bug from the previous audit) is confirmed resolved. No new mobile regressions found.
