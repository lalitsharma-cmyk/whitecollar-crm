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

## 🚀 PHASE C — shipped 2026-06-28
- **Voice Channel ② Escalation Thread** — agent raises a voice escalation → manager replies by voice → either resolves; per-lead thread, status chips, notifications, shared useVoiceRecorder hook. Schema pre-existed; API+UI+wiring built. `a67b9f6` (regression invariant voice-channel-2-escalation).
- **Buyer Conversation History auto-refresh** on tab focus (was stale after sibling-island edits). `4efc316`

## 🚀 PHASE C — Lead-View density v1 shipped 2026-06-28 (awaiting Lalit review)
- Direction locked by Lalit: single page, NO collapse, NO tabs; denser spacing + compact action bar; reusable across Lead/Buyer/Revival (see [[feedback-detail-view-density]]).
- v1 (Lead View) `49ebeeb`: action bar → shared compact density (size="sm" + LeadFollowupActions.compact; icons+labels kept), row tightened, main grid/column spacing 4→3. Built on the SHARED ActionButton + LeadFollowupActions so the SAME treatment rolls to Buyer + Revival next.
- ⏭ NEXT (after Lalit's review/approval of v1): apply the same compact primitives to Buyer View + Revival Engine; then any further density passes he asks for.

## PENDING — Phase C (after prioritization)
- Anything new from docs/CRM-GAP-ANALYSIS.md once you pick + supply creds/decisions.

**State: Phase-A cleared; Phase-C committed features shipped. Only open dev item = the Lead-View density redesign (awaiting your direction); everything else is a Lalit decision/credential.**
