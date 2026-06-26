# WCR CRM — Master Development Tracker

**Single source of truth for what is done, doing, and pending.**
_Last updated: 2026-06-27_

## Process (locked 2026-06-27, Lalit)

- **Phase A — Stabilization** (current build): ONLY voice, Smart Timeline,
  Rejected-Lead workflow, UI bugs, existing production issues, regression.
  Fix → verify → deploy. **No new features.**
- **Phase B — Freeze**: when regression is green, freeze the build. Nothing new
  goes into it.
- **Phase C — New Ideas**: every new idea (UI / AI / CRM) is captured here, NOT
  built into the current build.
- **HARD RULE:** do **not** start any New Idea until the **Pending list = 0**.

**Status legend:** ✅ Completed · 🟡 In Progress · 🔴 Pending · 🧪 Under Testing · 🚀 Deployed · ❌ Rejected · 🚫 Blocked

---

## STATUS SUMMARY (this stabilization cycle)

| | Count |
|---|---|
| ✅🚀 Completed + Deployed | 5 |
| 🟡 In Progress | 1 |
| 🔴 Pending (Phase A stabilization) | 3 |
| 🔴 Pending (committed features, post-freeze) | 10 |
| 🚫 Blocked / needs decision | 2 |

---

## PHASE A — STABILIZATION (current build)

| Status | Item | Ref |
|---|---|---|
| ✅🚀 | **Buyer Conversation History** (P0) — the imported **"Conversation History"** column (438 buyers) now drives the buyer Conversation timeline (Raw + Smart, dated) like a Lead, instead of sitting in **Imported Fields**. Import mapping fixed + existing 438 backfilled (backed up). Root cause: column was unmapped → `extraFields`; `rec.remarks` had only a short Status token. | buyer-convo |
| ✅🚀 | **Voice Module — Channel ① Manager Voice Guidance** (record + browser transcript + playback + notify owner + mark-understood) — validated LIVE; header 🎤 mic pin added | bb01d72 · e2d49a1 |
| ✅🚀 | **Smart Timeline P0** — client messages never torn on mid-sentence dates ("on 4th", "on 1st April"); regression-locked | e7f70c2 |
| ✅🚀 | **Smart Timeline declutter** — conversation = client communication only; system/audit events → Change History (no data loss) | cfa1b35 |
| ✅🚀 | **Permission hardening** — 3 HIGH + 3 Med access leaks patched | e28d324 |
| 🟡 | **Rejected-Lead workflow** — approved business rule (unassign + preserve ownership history + reactivate-before-reassign + REJECTED badge + disable actions + double-reject guard + backed-up migration). See `project-rejected-lead-workflow` | building |
| 🔴 | **Default Smart Timeline tab** on Buyer + Revival detail | — |
| 🔴 | **Login/Logout** — block logout before check-in (cannot check out before checking in) | — |
| 🔴 | **Lead View** — compact / dense / responsive redesign (Conversation primary; compact BANT/actions/client-info/scheduling/meetings/interested-props/assignment-history/change-history/location/quick-note) | — |

---

## PENDING — COMMITTED FEATURES (after Freeze, before any New Idea)

| Status | Item | Ref |
|---|---|---|
| 🔴 | Voice **Channel ② — Escalation voice** (agent→manager voice/reason/text; manager reply voice/text; statuses Pending/Replied/Resolved; 2-way notify) — requested, not a new idea | — |
| 🔴 | Buyer Data — classification engine (First-Time / Investor / Whale) | #244 |
| 🔴 | Buyer Data — classification badge + portfolio section (detail/list) | #245 |
| 🔴 | Buyer Data — classification filter on list | #246 |
| 🔴 | Buyer Data — country dropdown + backfill empty country | #247 |
| 🔴 | Buyer Data — remove Source from UI (keep admin provenance) | #248 |
| 🔴 | Buyer Data — unified import template + smart column mapping | #249 |
| 🔴 | Reporting reconciliation v2 (audit P1/P2 fixes) | #250 |
| 🔴 | Smart Timeline — CONNECTED chip count == filtered rows | #251 |
| 🔴 | UI polish batch (from UI/UX audit) | #252 |

---

## 🚫 BLOCKED / DECISIONS NEEDED

| Item | Note |
|---|---|
| "Overdue" boundary | `< now()` vs `< startOfTodayIST` — pick one (M4) |
| Product calls | phone-mask policy · Won-metric booked-at | #253 |

---

## PHASE C — NEW IDEAS (captured, NOT started until Pending = 0)

_New ideas land here with date. They do not enter the current build._

- _(none yet)_
