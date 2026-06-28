# WCR CRM — Master Development Tracker

**Single source of truth.** _Last updated: 2026-06-28 (overnight run end)_

## Process (locked 2026-06-27, Lalit)
- **Phase A — Stabilization** → **Phase B — Freeze** (regression green) → **Phase C — New Ideas** (only after Pending = 0).
- **Deploys + data migrations funnel through the orchestrator ONLY** (serial, backup → tsc → regression → deploy → health). Agents discover; orchestrator fixes + deploys. Destructive steps get a backup first.
Legend: ✅ Completed · 🟡 In Progress · 🔵 In QA · 🚀 Deployed · 🔴 Blocked · ⏳ Remaining

---

## 🚀 DEPLOYED — overnight 2026-06-28 (15 batches, all health-verified, regression 101/0)
1. **Smart Timeline P0** — never parse dates from client-message content (no torn messages / fake dated cards). `dd7fb37`
2. **'todue' pill** → friendly "Today + Overdue" label. `ba208c2`
3. **Master Data 'Unassigned'** = ready-to-assign only (excl. rejected/lost/closed/archived) + clickable counters. `f20c385`
4. **New-Lead** market-specific categories (India never shows UAE options) + dashboard Team-row alignment. `5035432`
5. **New-Lead** editable Created Date (backfill walk-in/delayed entries, audit timestamp preserved). `a73191c`
6. **Rejected-unassigned (CRITICAL)** — rejected leads never enter assign queue / auto-assign / reminders / morning-queue / unassigned counters. `0b65106`
7. **rejectedAt = source-of-truth** — never active/workable + stale-status reconcile. `9d8de2a`
8. **Revival import not showing** — root-caused limbo (isColdCall + MASTER_DATA), 3-layer fix (data 9→REVIVAL, read originCold broaden, write REVIVAL stamp). `c094163` `b7f1941`
9. **Master Data M1–M4** — canonical source labels (WCR_EVENT/WCR_WEBSITE/Landing) + Website/Event family presets + Awaiting-Classification workable-only. `9ffabf6`
10. **Buyer Data B1–B3** — default Active tab (terminal excluded), Rejected tab, clickable summary cards. `b3a003e`
11. **Master Data export M5** — POSTs exact on-screen id-set → CSV == filtered view. `d0475f1`
12. **Overdue boundary unified** — canonical start-of-today IST everywhere (Today/Overdue disjoint). `bbf0be1`
13. **Today's Leads saved view** dynamic (current IST day) + **Global Search ✕** close button. `208f20c`
14. **CRM feature gap analysis** (docs only, prioritized P0/P1/P2). `34d76a6`

Regression gate now **101 invariants** (+ rejected-not-in-assign-queue, smart-timeline-content-dates, lead-category-by-market, master-data-source-families, buyer-pipeline-tabs, master-data-export-filtered, overdue-boundary-canonical).

## ✅ CLEARED this run (were on the prior tracker)
- Rejected-Lead **hard-unassign** + reporting re-point — DONE: reject nulls ownerId, keeps previousOwnerId; agentPerformance Rejected/Lost attribute via previousOwnerId (`:496-511`). Migration ran (90 leads, backup-first). `f13ccce` `0ec3c56`
- Buyer P2s — market-scoped dedup ✅, voice gate on speechSupported ✅, Region off market (currency-derived) ✅.
- Reconciliation P2 — Action Board excludes COLD_ORIGINS + uses TERMINAL statuses ✅.
- Phase-A leftovers — buyer default Smart-Timeline tab ✅, check-in-before-logout ✅, call/WA actions disabled on rejected lead ✅.
- "Overdue" boundary DECISION — resolved (start-of-today IST). Rejected hard-unassign DECISION — resolved (yes).

## 🔴 BLOCKED — waiting on Lalit (no code possible until then)
- **Device security enforce** — set `DEVICE_SECURITY_ENFORCE=true` in Vercel → redeploy. THEN orchestrator: confirm 4th user, clear the 4 agents' device rows so re-login → PENDING → Sameer approves. (All 4 already at 0 sessions; Sameer is active Admin + can approve.)
- **#253 product calls** — (a) phone-number masking on/off for agents; (b) "Won" metric definition; (c) voice-notes: what's "incomplete" (require transcript before save? auto-retry failed transcription?).
- **Gap-analysis P0s** (see docs/CRM-GAP-ANALYSIS.md) — all need creds/decisions: Acefone keys (telephony), Meta WhatsApp tokens, OK to flip round-robin + 15-min SLA, OK to provision blob storage (per-lead documents).

## ⏳ REMAINING — small, low-priority (can do anytime; need light direction)
- Lead-View **compact/density redesign** (needs your steer on what "compact" should show/hide).
- Buyer timeline **auto-refetch after a remark edit** (P2 nicety; needs server-side activity regen).
- **Voice Channel ② escalation** (committed feature, Phase-C; Channel ① shipped).

## PENDING — committed features (Phase C, after Freeze)
- Voice Channel ② · anything new from the gap-analysis once prioritized.

**State: Phase-A stabilization backlog is cleared. Everything remaining is a Lalit decision/credential or a Phase-C feature.**
