# WCR CRM — Master Development Tracker

**Single source of truth.** _Last updated: 2026-06-28 (overnight run end)_

## Process (locked 2026-06-27, Lalit)
- **Phase A — Stabilization** → **Phase B — Freeze** (regression green) → **Phase C — New Ideas** (only after Pending = 0).
- **Deploys + data migrations funnel through the orchestrator ONLY** (serial, backup → tsc → regression → deploy → health). Agents discover; orchestrator fixes + deploys. Destructive steps get a backup first.
Legend: ✅ Completed · 🟡 In Progress · 🔵 In QA · 🚀 Deployed · 🔴 Blocked · ⏳ Remaining

---

## 🟢 HR ATS PRODUCTIZATION (started 2026-06-28, Lalit) — make /hr as polished as Sales CRM
**Audit:** `docs/HR-ATS-AUDIT.md` (13-area parallel audit). Module was ~40–60% of Sales parity, NOT production-safe (systemic RBAC hole). Plan: Phase0 safety → Phase1 schema+roles → Phase2 security → Phase3 modules+voice → Phase4 polish → Phase5 QA.
- ✅ **Phase 0 — Safety:** full DB backup ×2 (`backups/FULL-2026-06-28T13-56-16-581Z` + offsite) + dedicated HR archive; prod schema-drift risk cleared (`hrOnly/hrTeam` exist).
- ✅ **HR data reset:** ⚠️ the "447 candidates" were REAL career-page applicants (not dummy) — flagged, then on Lalit's re-confirmation reset HR to clean shell, fully reversible (txn + integrity check). Restore: `backups/HR-ARCHIVE-*`. See [[project-hr-data-is-real]]. Scripts: `audit-hr-test-data.ts`, `cleanup-hr-data.ts`.
- ✅ **Phase 2 — RBAC (SHIPPING):** centralized engine `src/lib/hrPermissions.ts` (pure) + `src/lib/hrAccess.ts` (server guards); 3 roles DERIVED (Admin / Senior HR=hrTeam|hrOnly+MANAGER / Junior HR=hrOnly+AGENT) — NO migration. Every HR route (12) + page (13) + nav gated; 404-not-403 on candidate denial; bulk scope-intersected. Junior=owned-only/no reports-settings-import-export-users/escalation-only; Senior(Nisha)=all+assign+reports+voice-guidance, no user-mgmt/system-settings. Gate `scripts/regression-hr-rbac.ts` (matrix + static leak-scan) wired into `deploy.sh`. tsc 0 · rbac PASS · regression 107/0.
- ✅ **Phase 1 — schema (SHIPPED `dde334f`):** additive, hand-applied to Neon + resolved. HRVoiceMessage/HREscalation/HRVoiceMessageRead (reuse VoiceMessageKind), HRSavedFilter, HRCandidate.deletedAt+salaryCurrency, HRInterview.recommendation, HRActivityType += voice/escalation/resume. See docs/MIGRATION-LEDGER.md.
- ✅ **Wave 1 — modules (SHIPPED `b6c876d`):** shared VOICE engine (guidance/escalation/thread + inline-stream play + HRCandidateVoice.tsx) · candidate LIST (saved views, column show/hide, Created/Source/Notice cols, inline Call/WA) · INTERVIEW lifecycle (reschedule, result+recommendation→status, delete clears auto-FUs) · FOLLOW-UPS (complete-with-next, snooze/skip, Offer/Joining tabs) · REPORTS (funnel, source perf, conversion%, CSV) + DASHBOARD cards · RESUME bank (search/version-history/preview).
- ✅ **Wave 2 — detail + fixes (SHIPPED `8f4c586`):** candidate DETAIL redesign (card layout, unified conversation timeline, Raw History, interview result/delete, mobile) · LIVE intake email-lowercase dedup fix · call-outcome→status map completed · resume activity type.
- ✅ **Wave 3 — polish + QA (SHIPPED `eb56380`):** cosmetic polish (empty/loading states, Lucide, dark-mode) across 10 HR pages; read-only per-role QA audit found **no P0/security** — RBAC core confirmed solid. Fixed: soft-delete scoping everywhere (new `hrActiveScopeWhere`, loadOwnedCandidate 404s deleted, list/export/dup/bulk/intake/calendar/detail), role-vs-perm UI (Junior HR no longer sees dead Export/bulk/import controls), owner-assign validates active-HR-user target, applyBulk checks res.ok, Missed-badge scoped via hrScopeWhere.
- ✅ **Backlog cleared (SHIPPED `fe3f8c1`):** resume hash-dedup (HRResume.contentHash SHA-256 + upload flag + Resume-Bank "Duplicate" badge) · dark-mode contrast on table/calendar buttons · consistency fixes (create dup-check soft-delete-aware, bulk OFFER_RELEASED uses hrRoleOf). Escalation web-push + applications display were already wired (verified).
- **STATE: HR ATS production-ready & backlog clear.** 6 deploys today (b7bed60 RBAC · dde334f schema · b6c876d modules · 8f4c586 detail+intake · eb56380 polish+QA · fe3f8c1 resume-dedup/polish), every batch gated tsc 0 · hr-rbac PASS · regression 108/0 · next build OK · health-verified. Awaiting Lalit's live UAT feedback.

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

## 🚀 SHIPPED 2026-06-28 (post-review fixes)
- **Rejected→Unassigned FULL COVERAGE** `95ed21c` — closed the 6 surfaces still treating rejected as normal-unassigned (the "Unassigned Leads" nav filter was the active leak). All modules Completed+Verified; data clean (122 rejected, 0 still-owned/0 leak); regression `rejected-unassigned-full-coverage` locks it. See [[project-rejected-lead-workflow]].
- **Master Data compact column layout** `4959cfc` — order Created Date·Time·Client Name (frozen) · Agent · Team · Property Enquired · Budget · Status · Source · Bucket · (optional); Message default-hidden; compact widths (fits one screen). Created Date admin-editable from lead detail.

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
