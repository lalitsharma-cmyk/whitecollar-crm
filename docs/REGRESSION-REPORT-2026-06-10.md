# White Collar Realty — Sales CRM Regression Report
**Date:** 2026-06-10 · **Live commit:** 187cf09 (app) + data backfill a49a977
**Scope:** all changes from the last 3–4 days + "fix existing data" requirement

---

## A. Does each fix apply to EXISTING data? (backfill audit)

The key finding: **almost every recent fix is computed at render time from the
fields already stored on each lead** — so it applies to *every* existing record
(imported, revival, active, rejected/lost, and future) automatically on the next
page load. Only one fix touched a *stored* column that other code reads, so that
one got a real backfill.

| Fix | How it works | Existing data covered? | Action |
|---|---|---|---|
| Conversation history merge + compact paragraph | Parses `lead.remarks` live (`parseRemarksTimeline` → `mergeSameMoment` → `toReadableParagraph`) | ✅ Auto — every lead, every load | None needed |
| Meeting / Site Visit / Virtual classification | `classifyText` runs on `lead.remarks` live; meeting counts merge live-detected + agent-logged Activity rows | ✅ Auto | None needed |
| BANT Need auto-fill from Configuration | Displayed live (`effectiveNeed = needSummary ‖ config`) **and** BANT-gate/reports read stored `needSummary` | ✅ Display auto + **stored backfilled** | **Backfilled 64 leads** (a49a977) |
| Project city badge (PROPERTY city not client city) | Render-time `proj.city ?? proj.area ?? lead.city` | ✅ Auto | None needed |
| Client location / placeholder cleanup ("Add Value") | Render-time | ✅ Auto | None needed |
| LinkedIn field | `LinkedInField` reads `lead.linkedInUrl` live | ✅ Auto | None needed |
| Budget display (formatBudget) / Budget≠Config separation | Render-time; `budgetMin` is numeric so config text never contaminated it | ✅ Auto | None needed |
| Table / card display fields | Render-time | ✅ Auto | None needed |
| Reject reasons list | Static constant `reject-reasons.ts` | ✅ Auto | None needed |
| Status governance (removed statuses not agent-selectable) | Write-time guard (`canSetStatus`) + render-time dropdown filter (`selectableStatuses`) | ✅ Applies forward; existing statuses preserved as history | None needed |

### Backfill performed
`scripts/backfill-need-from-config.ts --apply` — filled `needSummary` from
`configuration` on **64 leads** where Need was blank (additive; never overwrote an
existing Need). Breakdown: 22× 4BHK, 18× 3BHK, 7× Villa, 5× 5BHK, 3× 2BHK,
2× 4BR, 2× Plot, 1× each {3BR, 2BR, 1BR, 1BHK, Penthouse}. Re-run dry-run after:
**0 remaining**. Only `needSummary` was written — no timestamps/activities bumped.

### Synthetic MIS CallLogs (context, no action)
Old imports stored remarks as synthetic `CallLog` rows (`attributedAgentName` set).
These are **already excluded everywhere** (`realCallLogs` filter, `callStats`,
`BestCallTimeChip`) and the Conversation card receives `realCallLogs`, so the new
Connected/No-answer counters do **not** double-count them. Bulk deletion remains
**on hold** (backup saved) — intentionally not touched.

---

## B. Clickability audit — every visible button actually works

Full read-through of table view, mobile card view, desktop card view, and the
lead detail page + all referenced API routes. **60+ action controls audited, 0
dead buttons, all endpoints exist.**

| Control | Wired to | Result |
|---|---|---|
| Call (table/card/detail) | `tel:` / `telLink()` | ✅ |
| WhatsApp | `wa.me` / `whatsappLink()` (+ click log) | ✅ |
| Email | TemplatePickerButton | ✅ |
| Log Call | `submitCall()` → `POST /api/leads/[id]/log-call` | ✅ |
| Note / sticky note | → `PATCH /api/leads/[id]/sticky-note` | ✅ |
| Voice note (dictation) | Web Speech API → saved via log-call | ✅ |
| Reject Lead | `quickReject()` / modal → `POST /api/leads/[id]/reject` | ✅ |
| Delete Lead (Lalit only) | `doDeleteLead()` → `POST /api/leads/[id]/delete` | ✅ |
| Reassign | `onReassign()` → `POST /api/leads/[id]/assign` | ✅ |
| Follow-up / Meeting / Site-visit dates | SchedulingField → `PATCH /api/leads/[id]/update` | ✅ |
| Start/End Site Visit (+GPS) | → `POST/PUT/PATCH /api/leads/[id]/visit` | ✅ |
| Log Meeting | `save()` → `POST /api/leads/[id]/meeting` | ✅ |
| Office/Site/Virtual count tiles | clickable filter when count>0, display-only at 0 | ✅ (by design) |
| Table header filters (Name/Project/Status/Budget/Follow-up/Owner/Activity) | URL search params → server filter | ✅ |
| Status quick-set popover | `quickSetStatus()` → `PATCH /api/leads/[id]/update` | ✅ |
| Bulk: tag / reassign / reject / WhatsApp | → `/api/leads/bulk`, `/api/leads/bulk-wa` | ✅ |
| Back buttons | `Link href="/leads"` + global mobile back | ✅ |

---

## C. UI stability — mobile / tablet / desktop

Reviewed the recently-changed screens for overflow, clipping, fixed widths,
missing `min-w-0`, z-index. **All 7 areas stable.**

| Area | Result | Evidence |
|---|---|---|
| Reminder widget counts ("14 Callbacks") | ✅ Stable | `flex flex-wrap` + per-item `whitespace-nowrap` |
| Header filter dropdowns | ✅ Stable | fixed-positioned, `z-[9999]`, clamped to viewport, not clipped by table overflow |
| Leads table horizontal scroll + card fallback | ✅ Stable | `overflow-x-auto`; `hidden sm:block` table / `lg:hidden` cards |
| Conversation History long paragraphs | ✅ Stable | `max-h-[620px] overflow-y-auto`, `break-words` |
| Meetings/Site-Visit notes scroll | ✅ Stable | `max-h-48 overflow-y-auto` |
| Inline edits (LinkedIn/BANT/location/budget) | ✅ Stable | grid `[&>div]:min-w-0 overflow-hidden`, link `truncate`, pencil `flex-none` |
| Lead detail responsive grid | ✅ Stable | `xl:grid-cols-3`, mobile tab bar, BANT `grid-cols-1 sm:grid-cols-2` |

---

## D. Permissions & removed-logic verification — 13/13 PASS

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Delete button shown only when `canDelete` | ✅ | `LeadsListClient` gated `{canDelete && …}`; `page.tsx` passes `canDelete={me.isSuperAdmin === true}` |
| 2 | Delete endpoint enforces super-admin | ✅ | `delete/route.ts` → `if (!me.isSuperAdmin) return 403` |
| 3 | Restore endpoint enforces super-admin | ✅ | `restore/route.ts` → `if (!me.isSuperAdmin) return 403` |
| 4 | Reject requires non-empty remarks | ✅ | `reject/route.ts` → `if (!note) return 400` |
| 5 | Agents cannot select outcome statuses | ✅ | `selectableStatuses()` agent list = working statuses only; server `canSetStatus` → 403 |
| 6 | "Fresh Lead" system-generated (admin-correct only) | ✅ | `canSetStatus`: Fresh Lead ⇒ `role === "ADMIN"` |
| 7 | "Booked with Us" never agent/manager selectable | ✅ | agent list excludes it; manager filter `!isBookedStatus(s)` |
| 8 | Delete ≠ Reject (separate flows) | ✅ | distinct buttons → `delete` vs `reject` routes; distinct side-effects |
| 9 | Removed statuses live in Reject Reasons | ✅ | `reject-reasons.ts` lists War Fear, Funds Issue, Booked With Us, Sell Out, Leasing, Rent Out, Already Bought, Number Changed, Never Respond, Pass Away, Broker… |
| 10 | Automations OFF unless enabled | ✅ | `testingMode.enabled` defaults **ON**; gates workflow triggers, round-robin, SLA escalations, manager flagging |
| 11 | Stage pipeline removed | ✅ | `LeadJourneyBar` removed; status-only workflow, no stepper rendered |
| 12 | `isSuperAdmin` explicit (not inferred from ADMIN) | ✅ | `schema.prisma` explicit `Boolean @default(false)` |

### Live-DB confirmation of the Delete gate (production)
Queried the production DB directly:
- **`isSuperAdmin = true`: exactly 1 user → Lalit Sharma** (`lalitsharma@whitecollarrealty.com`, role ADMIN).
- Roles: AGENT=4, MANAGER=1, ADMIN=3.
- **2 of the 3 admins do NOT have super-admin → they cannot delete leads.** Only Lalit can.

So "Delete = Lalit only" is verified both in code (UI gate + server 403) and in the
actual production data.

---

## E. What still needs HUMAN QA (cannot be automated from code)

Code-level verification confirms wiring, permissions, and layout markup, but the
following genuinely need a person clicking through the live site and **cannot be
truthfully signed off from code alone**:

- Real device rendering: **iPhone Safari, Android Chrome, iPad/tablet, desktop
  Chrome/Edge/Firefox** — actual pixel layout, tap targets, keyboard behaviour.
- Logging in as **Agent**, **Admin**, and **Lalit** to confirm each role sees the
  right buttons in the live session (code gates are verified; live session is not).
- End-to-end side effects: placing a real call, sending a real WhatsApp/email,
  GPS capture on a real phone during a site visit.

These are listed honestly rather than marked "Pass" — I can't fake a device test.
