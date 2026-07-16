# Workstream 9 — Cross-Device / Cross-Browser QA Checklist

**Why this is a checklist, not a result:** cross-device/browser/PWA testing needs the actual
devices and logged-in sessions (iPhone Safari, iPad, Mac Safari, Android, the office iMac).
This session has no access to them and cannot log in as real users. So this workstream is
delivered as a **structured manual pass for the human team** — hand it to whoever has the
devices, tick each box, note the build (`git rev-parse --short HEAD`) and date.

Everything a headless session CAN verify (server-rendered markup, API responses, RBAC, data)
is covered by the automated regression suite (233 invariants) + the other audit workstreams.

---

## Devices to cover
Windows Chrome · Windows Edge · Mac Chrome · Mac Safari · office iMac · iPhone Safari ·
iPhone PWA (home-screen icon) · Android Chrome · Android PWA · iPad Safari.

## Golden rule to verify on every device
> Same user + same permissions + same filters ⇒ identical result everywhere.
If a card/count/list differs between two devices for the same login, that's a **stale
service-worker cache** — hard-refresh; the SW version bumps on every UI deploy (currently
v153) precisely to prevent this. Log any mismatch that survives a refresh.

## Focus areas (Lalit's list) — tick per device
- [ ] Dubai Buyer summary cards: **Converted / Rejected / Unique / Repeat** counts match across devices and each card opens the exact records (URL-driven — should be device-independent).
- [ ] Text selection inside modals does NOT close them (the useDismiss fix — test Log Call, Notes, Reassign, Bulk on touch + desktop).
- [ ] WhatsApp templates render + send-link works (mobile especially).
- [ ] Log Call flow: outcome + remarks save; "What next?" popup appears.
- [ ] Notes / Remarks: add, and (where allowed) edit same-day.
- [ ] Filters persist across back-navigation; pagination Prev/Next + "Page X of Y" correct (Leads, Revival, Buyer, Master — all 50/page).
- [ ] Bulk selection: current-page-only vs all-matching distinction + confirm dialog (admin only).
- [ ] Dropdowns / owner picker show the full roster; table renders without overflow on mobile.
- [ ] Sidebar collapse/expand; bottom nav on mobile.
- [ ] Search autosuggest (3-char min) returns cross-module, role-scoped results.
- [ ] PWA: install to home screen, launch, confirm it's the current build (not a stale shell), notifications/sound work.

## New-this-week surfaces to include in the pass
- [ ] **Team Presence** (admin only) renders on desktop; agents/managers/HR do NOT see the menu item or the page.
- [ ] **Lead Routing** panel (admin only) renders; create-rule modal usable on desktop.
- [ ] **User Management → Sessions / Force Logout** modal opens, lists sessions, dismiss-safe.
- [ ] **👻 Ghosting** chip + filter render on the Leads list (once shipped); Ghosting report drill-downs open the right records.
- [ ] **Revival attempt chips** (`3/5`) + Returned-to-Admin badge render on the Revival list.

## How to report back
For each failure: device + browser + build sha + module + what you did + expected vs actual +
a screenshot. Drop them in a shared doc; they become QA defect rows (Deliverable 2).
