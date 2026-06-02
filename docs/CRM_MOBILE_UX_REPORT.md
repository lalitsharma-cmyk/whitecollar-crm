# CRM Mobile UX Review

**App:** White Collar Realty CRM — `crm.whitecollarrealty.com`
**Stack:** Next.js 16 (Turbopack) · React 19 · Prisma 6 · PostgreSQL (Neon, Singapore)
**Source reviewed at:** commit `4f7308e` ("Round 12 + B-01…B-20 fix wave")
**Method:** Source-code review only. The live app is login-gated, so this report is built from reading the components and CSS, not from a device clickthrough or a real Lighthouse/Web Vitals run. Items that depend on a real device or network are explicitly marked **(to be measured during live UAT)** with a source-based estimate.
**Audience reality:** Agents are first-time CRM users and work **predominantly on phones**. Dubai-property sales calling Indian investors.

---

## 0. The one rule this report is built around

> **If an agent cannot — from a phone, in seconds — (1) CALL a lead, (2) WhatsApp a lead, (3) add a remark, and (4) set the next follow-up, then the CRM will not be adopted. Everything else is secondary.**

**Verdict up front: the four critical actions all pass on mobile.** See §4. The remaining work in §6 is about reducing friction (scroll, filter clutter, missing back buttons on some routes, loading states), not about unblocking the core loop.

---

## 1. Responsive architecture (what the app does on a phone)

The whole app renders inside `src/components/MobileShell.tsx`, which splits desktop vs. mobile at Tailwind's `lg:` breakpoint (1024px):

- **Desktop (`lg` and up):** fixed left sidebar — `fixed left-0 w-64 hidden lg:flex`.
- **Mobile (below `lg`):** the sidebar is hidden; instead the user gets a **sticky top header**, a **slide-out drawer**, and a **fixed bottom navigation bar**.

This is a genuine mobile-first shell, not a desktop layout crammed onto a phone. Key specifics confirmed in source:

| Element | Source evidence | Mobile quality |
|---|---|---|
| Top header | `lg:hidden sticky top-0 z-20`, `paddingTop: calc(0.5rem + env(safe-area-inset-top))` | Good — respects the iPhone notch. |
| Hamburger + Back buttons | both `min-w-11 min-h-11` (44px) | Good — meet Apple/Material touch-target minimums. |
| Slide-out drawer | `w-72 z-50`, `useBodyScrollLock(open)`, safe-area padding | Good — body scroll is locked behind the drawer so the page doesn't scroll underneath. |
| Bottom nav | 5 items (Home / To Do / Leads / Pipeline / Alerts), `min-h-12`, `paddingBottom: env(safe-area-inset-bottom)` — confirmed in `MobileShell.tsx` `bottomNav` array | Good — thumb-reachable, clears the home indicator. |
| Main content padding | `paddingBottom: calc(4rem + env(safe-area-inset-bottom))` | Good — content never hides behind the bottom nav. |

**Thumb reach:** the primary navigation lives at the **bottom** of the screen (bottom nav) and the most-used per-lead actions are in the lead header (top) and on each mobile lead card. The bottom nav covers the 5 highest-traffic destinations, which is the right call for one-handed use.

---

## 2. PWA / install behavior

- The shell is built for **standalone (installed-PWA) mode**: safe-area insets (`env(safe-area-inset-top/bottom)`) are applied at the header and bottom nav, which is exactly what you need so the UI doesn't collide with the notch or the home indicator when launched from the home screen.
- Install nudge / standalone handling is present (inferred from the safe-area handling and PWA wiring in the shell).
- **(To be measured during live UAT):** actual "Add to Home Screen" prompt behavior on iOS Safari vs. Android Chrome, offline behavior, and icon/splash rendering. iOS in particular only shows a manual Share → Add to Home Screen flow, so confirm agents are told how to install.

---

## 3. Forms, keyboard, modals, tables, dropdowns

### Forms & the iOS auto-zoom trap (handled)
`src/app/globals.css` forces **16px font on all inputs/selects/textareas below `lg`**:
```css
@media (max-width: 1023.98px) { input, select, textarea { font-size: 16px !important } }
```
This is the single most important mobile-form fix and it is **done**. iOS Safari auto-zooms into any input with a font under 16px; this prevents the page from jerking/zooming every time an agent taps a field.

### Keyboard hiding fields / save-button visibility
- Modals are **bottom-sheets** that scroll internally: `max-h-[90vh] overflow-y-auto safe-bottom` (see Log Call modal, reject modal). Because the sheet itself scrolls and is capped at 90% viewport height, the on-screen keyboard pushing up does not bury the Save button off-screen — the agent can scroll within the sheet to reach it.
- **(To be measured during live UAT):** on some Android keyboards the viewport resize behavior differs; confirm the primary action button in the Log Call sheet stays reachable with the keyboard open on a real mid-range Android.

### Body scroll-lock
`useBodyScrollLock` + `body.modal-open { overflow:hidden; touch-action:none }` (globals.css) stops the background page from scrolling behind an open modal/drawer — prevents the classic mobile "scroll bleed" annoyance.

### Dashboard — new top-of-page widgets
Two new widgets render at the very top of `/dashboard` before the KPI tiles:
- **"I am here" attendance card** (`IamHereCard`) — prominently shows the agent their check-in status the moment the dashboard loads; larger and more obvious than the smaller `AttendanceBadge` further down the page. *(Round 5/T)*
- **"☕ Daily motivation (pilot)"** (`MotivationPilot`) — a deterministic daily-quote card, currently **enabled for both teams** (`motivationPilot.team=ALL`) per Lalit's instruction. Renders only when `motivationPilot.enabled=true` and the viewer's `User.team` matches the configured value — gating is server-side, never inferred from phone/geography. Admin can switch it off or change the team scope in **Settings → "☕ Daily motivation (pilot)"**. AI voice is optional and dormant until a key is added. *(B-20, `1f735ed`, `bfe636e`)*

On mobile these add two cards to the top scroll of the dashboard; both are compact and fit within the first screen's worth of content.

### Tables → horizontal scroll, not squashed
Wide tables are wrapped in `overflow-x-auto` with a min-width so columns stay legible rather than crushing:
- Dashboard by-salesperson table: `overflow-x-auto`, `min-w-[520px]`.
- Lead list on mobile **does not use a table at all** — it switches to a **card list** (`lg:hidden`) while the desktop table is `hidden lg:block`. This is the correct pattern (see `src/components/LeadsListClient.tsx`).

### Filter chips / dropdowns
- Filter chip rows use `overflow-x-auto lg:flex-wrap` with `min-h-11` chips — horizontally scrollable on mobile, wrapping on desktop (`src/app/(app)/leads/page.tsx`, `LeadFilters.tsx`).
- On mobile the lead filters **collapse behind a "Show filters ▾" toggle** (`lg:hidden btn`) so they don't eat the whole screen — directly addresses Lalit's complaint that "Filters on Lead page take so much space user has to scroll." (`src/components/LeadFilters.tsx`).
- **"Who is client" is now a structured dropdown** (`src/components/ClientTypeSelect.tsx`): Investor / End-user / Both / Unclear — replaces the old free-text field on lead detail (Round 8/AA). The long-form narrative ("Who is the client — the full situation") stays as a separate `whoIsClient` textarea. The dropdown is a standard `<select>`-backed component; standard iOS/Android native picker behaviour applies.
- **Known residual issue (from QA-FEEDBACK):** "popups/dropdowns distort the form on mobile." The bottom-sheet pattern fixes the big modals, but verify every native `<select>` and any custom dropdown inside forms during UAT — this is the most likely place a control still overflows. **(to be measured during live UAT)**

---

## 4. THE critical mobile path (call · WhatsApp · remark · follow-up)

This is the make-or-break test. All four actions are reachable on a phone **without leaving the lead**, from two entry points.

### Entry point A — the lead-detail header: `src/components/LeadActionsClient.tsx`
Action grid is `grid grid-cols-2 sm:grid-cols-4 gap-2` (two big buttons per row on a phone):

1. **CALL** — `<a href={telUrl(phone)}>`, `bg-emerald-600 min-h-11`. One tap → native dialer. ✅
2. **WhatsApp** — `TemplatePickerButton` (compact) → `wa.me` deep link with a template. ✅
3. **Add a remark** — the **Log Call** button opens a bottom-sheet (`fixed inset-0 … flex items-end sm:items-center`, `rounded-t-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto safe-bottom`) with a **remarks textarea** plus **voice dictation** (Web Speech API, `en-IN`). One-handed, and an agent can dictate instead of typing. ✅
4. **Set next follow-up** — the **same Log Call sheet** has a callback scheduler (`DateTimeIST`, future-only) that writes `Lead.followupDate`. So logging the call and setting the next touch happen in **one** sheet, not two screens. ✅

**Note (Round 6/W):** "Copy Snapshot" and "Export Activity CSV" buttons were **removed** from this header per Lalit's instruction — the `CopyLeadSnapshot` component and `/api/leads/[id]/activity-csv` route were deleted. The lead-detail header is now leaner on mobile. (Confirmed in `src/app/(app)/leads/[id]/page.tsx` comment at line 744.)

This is the ideal design: after a call, the agent opens one sheet and captures outcome + remark (typed or spoken) + next follow-up together.

### Entry point B — the mobile lead list cards: `src/components/LeadsListClient.tsx`
Each mobile card (the `lg:hidden` card list) has **one-tap Call and WhatsApp icons** directly on the card:
- Call: `w-10 h-10 rounded-full bg-emerald-600`
- WhatsApp: `bg-[#25D366]`

So an agent can call/WhatsApp **straight from the list** without even opening the lead. Adding a remark / setting follow-up requires opening the lead (Entry point A), which is the correct trade-off — those need the full sheet.

### Conclusion
**The 4-action loop passes.** Call and WhatsApp are one tap from both the list and the lead header; remark + follow-up are one combined bottom-sheet from the lead header, with voice input as a typing alternative. This is the single most important finding in this report and it is positive.

**(To be measured during live UAT):** real-device confirmation that `tel:` and `wa.me` hand off cleanly to the dialer / WhatsApp on the agents' actual phones (especially dual-SIM Android and WhatsApp Business), and that Web Speech dictation works in their browser (Web Speech API support is strong on Android Chrome but limited/older on some iOS Safari versions — have a typing fallback, which exists).

---

## 5. Touch targets & spacing audit

- Navigation controls (hamburger, back, bottom-nav items): **44px+** (`min-h-11`/`min-w-11`/`min-h-12`). ✅
- Primary lead actions (Call, Log Call): `min-h-11`. ✅
- Filter chips: `min-h-11`. ✅
- Mobile card call/WhatsApp icons: `w-10 h-10` (40px) — **slightly under the 44px guideline**. Acceptable because they're round and well-spaced, but bumping to `w-11 h-11` would be safer for thumbs. (Low priority — see §6.)

---

## 6. Prioritized mobile fix list

### P0 — must hold (these are the adoption gate; today they PASS, keep them green)
1. **Protect the 4-action loop.** Any future redesign of `LeadActionsClient` / the Log Call sheet must keep Call, WhatsApp, remark, and follow-up reachable in ≤2 taps from the lead. This is the line that, if crossed, kills adoption.
2. **Verify `tel:` / `wa.me` handoff and voice dictation on the agents' real phones** during UAT. **(to be measured during live UAT)**

### P1 — high (friction that will cause complaints)
3. **Back buttons on every route — substantially resolved (Round 8/BB).** The shell already shows Back on all non-root paths via `showBack` (`MobileShell.tsx`). Additionally, every reports sub-page (`/reports/daily`, `/reports/sla`, `/reports/travel`, `/reports/cooling`, `/reports/sources`, `/reports/team-comparison`, `/reports/commission`, `/reports/ytd`) now has an explicit "← Back to reports" link at the top (confirmed in source per Lalit's 2026-06 feedback). Audit any remaining deeper/admin routes during UAT.
4. **Sweep every dropdown/`<select>` inside forms** for the "popups distort the form" complaint. Big modals are fixed (bottom-sheets); the risk is small inline dropdowns and any custom menu. **(partly to be measured during live UAT)**
5. **Confirm the Log Call sheet's Save button stays above the keyboard** on a real mid-range Android. **(to be measured during live UAT)**

### P2 — medium (polish)
6. **Bump mobile card Call/WhatsApp icons from `w-10 h-10` (40px) to `w-11 h-11` (44px)** in `LeadsListClient.tsx` to fully meet touch-target guidance.
7. **Loading skeletons on mobile — improved (B-14).** A group-level `(app)/loading.tsx` skeleton and `(app)/error.tsx` boundary were added (`1f9f5f5`), plus a dedicated `reports/loading.tsx`. Dashboard and leads already had their own. All force-dynamic routes now fall through to the group skeleton at minimum — on mobile data this removes the "is it broken?" blank pause for routes that previously had no skeleton. (See the Performance report for detail.)
8. **PWA install guidance** — confirm agents know how to "Add to Home Screen" on iOS (no automatic prompt). **(to be measured during live UAT)**

### P3 — nice to have
9. Confirm pull-to-refresh / over-scroll behavior doesn't fight the bottom-sheet gesture on iOS. **(to be measured during live UAT)**
10. Validate dark-mode contrast on real devices in sunlight (token system exists in globals.css). **(to be measured during live UAT)**

---

## 7. Summary

The mobile foundation is **strong and intentional**: a real mobile-first shell, safe-area handling for installed PWAs, 44px nav targets, the 16px iOS-zoom fix, bottom-sheet modals that scroll internally, card-based lead lists instead of squashed tables, and collapsible filters. Most importantly, **the four make-or-break actions — call, WhatsApp, remark, follow-up — all work from a phone**, with call/WhatsApp available one-tap from the list and remark+follow-up combined into a single bottom-sheet with voice input.

Since the Round 11 baseline, several mobile friction items have shipped: the "Copy Snapshot" and "Export CSV" buttons were removed from the lead-detail header (leaner on mobile); "Who is client" is now a structured dropdown (Investor / End-user / Both / Unclear) rather than a free-text field; all reports sub-pages gained "← Back to reports" links; the group-level `(app)/loading.tsx` skeleton and `(app)/error.tsx` boundary mean no route is left with a completely blank-screen stall; and the "☕ Daily motivation (pilot)" card and "I am here" attendance widget now render at the top of the dashboard for both teams (flag-controlled). The open items are friction-reduction, not blockers: sweep inline dropdowns, nudge to 44px on the card icons, and do real-device verification of the native handoffs. **Restating the rule: adoption lives or dies on those four actions — and as built, they pass.**
