# White Collar Realty CRM — Mobile UX Report
**Audit Date:** 4 June 2026 | **Target Device:** iPhone (390×844 viewport)
**Note:** Mobile testing performed via accessibility tree inspection of the MobileShell component and live page reads. Actual viewport rendering at 390px was not confirmed via screenshot due to tool limitations.

---

## MOBILE ARCHITECTURE OVERVIEW

The CRM uses a responsive "MobileShell" component with:
- **Desktop (lg+):** Fixed left sidebar (264px) + top header bar
- **Mobile (<lg):** Sticky top header + slide-out hamburger drawer + bottom navigation bar
- **Bottom nav (5 tabs):** Home, Leads, Revival, To Do, Properties
- **Safe area insets:** `env(safe-area-inset-top/bottom)` applied — iPhone notch and home indicator respected
- **Back button:** On every non-root page — uses router.back() with parent-route fallback
- **PWA support:** PWAInstallNudge component; manifest.ts configured

---

## PAGE-BY-PAGE MOBILE RATING

### /dashboard — NEEDS WORK
**What works:**
- 2-column KPI tile grid (`grid-cols-2`) — fits 390px width
- Bottom nav present (Home tab active)
- Morning greeting and Today's Mission render
- Attendance "I'm here" button has min-h-11 touch target (44px minimum)
- Team filter links work as normal links

**Issues:**
- The 4 urgent tiles are 2×2 grid — on 390px each tile is ~185px wide. The tile text "🔥 Hot leads untouched / No agent activity in 6+ hours" at small font sizes (10px/11px) may be very difficult to read without zooming
- The scheduled 5-tile row is `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` — on mobile this shows 2+2+1 tiles, causing the 5th tile to be full-width. Layout is readable but not visually balanced.
- The BY SALESPERSON table is `min-w-[520px]` with overflow-x-auto — on 390px this will require horizontal scroll. OK for admin but not ideal.
- Weekly summary and scoreboard sections lack mobile-specific layouts — they will stack vertically (acceptable but dense)
- Dashboard has many scrollable sections — agents may miss the UPCOMING section or ANALYTICS section below the fold

**Rating: NEEDS WORK** — readable but dense; some elements require zooming

---

### /leads — NEEDS WORK
**What works:**
- Per-lead Call and WhatsApp buttons are present and work natively on mobile
- Copy Phone button works
- Search box accessible
- Filter tab bar scrolls horizontally (correct for mobile)
- Checkboxes for bulk selection

**Issues:**
- Lead list at 44 rows already causes very long scroll on mobile. At 25,000 leads with no pagination, this will freeze the phone.
- The filter tab bar has 9 tabs: All, Today, Overdue, Hot, Site Visit, Negotiation, Unassigned, Dubai, India — on 390px these will overflow and require horizontal swipe. The first few tabs should be prioritized (Hot, Overdue are most mobile-critical).
- Lead row density: each row shows name, phone, status, AI score, team, budget, last touch — at 390px some elements will wrap or truncate
- No sticky "Add Lead" FAB visible at the bottom — the FAB is provided by QuickAddLeadFab component (gold + button) which is a global overlay

**Rating: NEEDS WORK** — works but scale and filter bar UX need improvement

---

### /action-list — GOOD
**What works:**
- Cards stack vertically — natural mobile layout
- "💬 WhatsApp" link opens WhatsApp app on device
- "📞 Call" link opens phone dialer
- "Full history →" link works
- Mark done, Snooze, Escalate buttons present
- Card content (name, status, overdue time, remark preview) readable at 390px

**Issues:**
- The pre-filled WhatsApp draft message is truncated in the accessibility tree at ~100 chars. On mobile the full message is in the WA link href. Agents should preview the full message before sending — no preview modal exists.
- Snooze button is labeled "⏸ Snooze ▾" — the dropdown needs adequate touch targets. The `▾` indicator suggests a flyout dropdown which on mobile may be difficult to dismiss.
- Remark text shows first ~150 chars then truncates. Agents may want to read the full remark before calling — this requires navigating to the lead detail page.

**Rating: GOOD** — best mobile page in the CRM; designed for quick action

---

### /leads/[id] — NEEDS WORK
**What works (based on source code and schema):**
- Back button is shown on non-root pages
- Phone call and WhatsApp buttons should be present
- Status change dropdown accessible

**Issues:**
- Lead detail pages are inherently complex (BANT card, activity timeline, call log form, property interests, sticky notes, AI summary, assignment). On a 390px screen, this creates very long vertical scroll.
- The activity timeline showing all call history, notes, WA messages, status changes will be very long for leads with 10+ interactions.
- No "quick log call" floating button optimized for mobile — logging a call requires scrolling to the form section
- Phone field with alt phone: at 390px showing two "Call" and two "WhatsApp" buttons plus "Copy Phone" for each number could create a confusing 6-button cluster

**Rating: NEEDS WORK** — complex page; needs mobile-specific simplification

---

### /cold-calls — GOOD
**What works:**
- Simple card layout
- Start session button has adequate size
- Revival leaderboard sidebar collapses on mobile (likely stack below main content)
- Bottom nav shows "Revival" tab

**Issues:**
- "Assign to agent" button — on mobile, assigning an agent requires a dropdown/modal. Not tested but should work.
- Progress bar is simple and renders well at any width.

**Rating: GOOD** — simple page; works well on mobile

---

### /pipeline — NEEDS WORK
**What works:**
- Mobile note shown: "tap a lead to open it (use desktop to drag)" — drag disabled on mobile by design
- Filter dropdowns (Team, Owner, AI) are comboboxes — native mobile selects
- Lead cards are tappable links to lead detail

**Issues:**
- Kanban columns are horizontal — on 390px each column is narrow. The "New" column with 26 cards will require significant horizontal scroll to see all columns.
- Lead card text (stage name, commission estimate, AI score, days-in-stage) at ~185px column width will be very compressed
- "At risk" warning text ("Stuck 370d in NEW · HOT lead going cold") may overflow on narrow cards
- No column count summary strip for mobile to show total lead counts without scrolling

**Rating: NEEDS WORK** — horizontal kanban is inherently difficult on mobile portrait mode

---

### /settings — NEEDS WORK
**What works:**
- Toggle switches are large enough to tap (they use switch roles)
- Radio buttons for festival theme have labels

**Issues:**
- Settings page is extremely long — no section anchors or expandable sections
- Text content (descriptions for each setting) is very dense at 390px
- The calendar subscription URL field is a long text input — on mobile, text input then copy works but is fiddly

**Rating: NEEDS WORK** — functional but very long scroll; needs accordions or tabs on mobile

---

## MOBILE NAVIGATION ANALYSIS

### Bottom Navigation (5 tabs)
| Tab | URL | Mobile-Critical? | Rating |
|-----|-----|-----------------|--------|
| Home | /dashboard | YES — daily check-in | GOOD |
| Leads | /leads | YES — lead list | GOOD |
| Revival | /cold-calls | YES — cold outreach | GOOD |
| To Do | /action-list | YES — priority actions | GOOD |
| Properties | /properties | MODERATE — browse catalog | GOOD |

**Missing from bottom nav (only in hamburger drawer):**
- Reports (hidden for agents — correct)
- Vault (personal journal — infrequent use; OK in drawer)
- Settings (infrequent — OK in drawer)
- Notifications — not in bottom nav; only in header bell icon

**Recommendation:** Add a notification badge/count to the bell icon in the mobile header (if not already present).

### Hamburger Drawer
- Opens with smooth overlay backdrop
- Scroll-lock applied (useBodyScrollLock) — correct behavior
- Same nav sections as desktop sidebar with role filtering
- Close button (X) in top right

---

## CALL/WHATSAPP BUTTON AUDIT

These are the most critical mobile interactions for sales agents.

| Location | Call Button | WhatsApp Button | Rating |
|----------|------------|-----------------|--------|
| /leads list | tel:// link | wa.me deep link | PASS |
| /action-list cards | tel:// link | wa.me deep link with draft | PASS |
| /activities (Action Board) | tel:// link | wa.me deep link | PASS |
| Lead detail page | Assumed present | Assumed present | UNVERIFIED |
| /pipeline cards | Via tap → lead detail | Via tap → lead detail | PASS |

**WhatsApp Draft Messages:** Pre-filled WhatsApp messages are generic ("schedule a site visit this week"). For mobile agents, the ability to personalize the message before sending requires opening WhatsApp, editing the pre-filled text, then sending. This is acceptable but could be improved with in-app template selection before opening WhatsApp.

---

## HORIZONTAL SCROLL AUDIT

| Page | Risk | Status |
|------|------|--------|
| /dashboard BY SALESPERSON table | min-w-[520px] | SCROLL REQUIRED |
| /leads filter tab bar (9 tabs) | Overflow scrollable | SCROLL REQUIRED (by design) |
| /pipeline kanban columns | Horizontal scroll between columns | SCROLL REQUIRED (by design) |
| /reports call heatmap | 7×24 grid | SCROLL REQUIRED |
| /admin/attendance 14-day grid | Wide table | SCROLL REQUIRED |

**Verdict:** Horizontal scroll is used intentionally for tables and kanban. This is acceptable as long as there is a visual indicator that content extends horizontally. No unintended horizontal page overflow observed.

---

## PWA / INSTALLATION

- `manifest.ts` is configured
- `PWAInstallNudge` component is present
- Safe area insets are handled
- iPhone PWA mode (add-to-home-screen) should work
- No offline/service worker evidence found in this audit

---

## FORM USABILITY ON MOBILE

**Log Call form (on lead detail):**
- Needs scroll to reach form section
- Outcome dropdown (8 options) is a native select — fine on mobile
- Notes textarea — auto-resize expected but not confirmed

**New Lead form (/leads/new):**
- Not tested in this audit

**Quick Add Lead FAB:**
- Global floating `QuickAddLeadFab` button
- Sits at z-40 (below modals at z-50+)
- Should capture basic lead data in minimal taps

---

## OVERALL MOBILE RATING SUMMARY

| Page | Rating |
|------|--------|
| /dashboard | NEEDS WORK |
| /leads | NEEDS WORK |
| /action-list | GOOD |
| /leads/[id] | NEEDS WORK |
| /cold-calls | GOOD |
| /pipeline | NEEDS WORK |
| /reports | NEEDS WORK |
| /settings | NEEDS WORK |
| /admin/users | NEEDS WORK |
| /admin/templates | GOOD |
| /admin/workflows | GOOD |

**Summary:** The mobile architecture is solid (bottom nav, back buttons, safe areas, drawer). The core agent workflow (Action List → Call/WhatsApp → Log) works well on mobile. Complex pages (dashboard, pipeline, lead detail, settings) are dense and require significant scrolling on 390px.

---

## TOP 5 MOBILE FIXES (Recommended)

1. **Add virtual scrolling or pagination to /leads** — at 25,000 leads, the current flat list will lock up phones
2. **Simplify lead detail page on mobile** — show key info first (name, phone, status, last remark) with expandable sections below
3. **Make pipeline KPI summary visible without horizontal scroll** — add a column count strip above the kanban board
4. **Add section jump-links to /settings** — users should be able to jump to Testing Mode, AI Features, or Notifications without scrolling the full page
5. **Consider a dedicated "Log Quick Call" flow** — a bottom sheet or 2-tap log-call for mobile agents instead of scrolling to the call form on lead detail
