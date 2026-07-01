# WCR CRM — Master Development Tracker

**Single source of truth.** _Last updated: 2026-06-28 (overnight run end)_

## Process (locked 2026-06-27, Lalit)
- **Phase A — Stabilization** → **Phase B — Freeze** (regression green) → **Phase C — New Ideas** (only after Pending = 0).
- **Deploys + data migrations funnel through the orchestrator ONLY** (serial, backup → tsc → regression → deploy → health). Agents discover; orchestrator fixes + deploys. Destructive steps get a backup first.
Legend: ✅ Completed · 🟡 In Progress · 🔵 In QA · 🚀 Deployed · 🔴 Blocked · ⏳ Remaining

---

## 🟡 LEAD-VIEW UNIFICATION (started 2026-07-01, Lalit — URGENT)
**Goal:** one unified detail UI across all 3 modules — team never learns 3 interfaces. Branch `ws-unify-lead-view`. Leads View = master template, left 100% UNTOUCHED.
**⚠ DIRECTION LOCKED 2026-07-01 (Lalit) — DATA-BANK RULE (see [[project-databank-vs-lead-rule]]):** Buyer Data & Cold/Revival are **staging data banks, NOT active Leads**. UI must be **visually identical** to the Lead View (same layout/colors/components) but **Lead-only workflow actions are HIDDEN until Convert-to-Lead**. HIDE: Voice Guidance, Escalate, Snooze, follow-up Complete, meetings/site-visits/GPS/Expo. KEEP: Call/WhatsApp/Email/Log Call/Notes/Voice Note/Conversation/Smart Timeline/Gallery share/Quick Note/AI analysis (read-only). After conversion → full Lead features unlock, zero data loss.
- **PIVOT:** B1 (follow-up bar), B2 (Voice Guidance), B3a (Escalation) were built for Buyer, and C1-part1 (Voice+Escalation) for Cold — then **REVERTED** per the data-bank rule (commit `4fdbc27`): UI un-wired + dead backend/tables/migrations deleted. The shared components keep a harmless `apiBase` prop; Lead behavior unchanged.
- ✅ **B3c — Buyer field-level Change History (KEPT, COMMITTED `0982a67`):** shared `ChangeHistoryCard` (admin/mgr, read-only audit — aligns with data-safety), additive `BuyerFieldHistory` table + migration `20260701130000_buyer_field_history`; buyer update route records every real inline-edit. tsc 0. **The ONLY migration this initiative still ships.**
- ✅ **B3d — Assignment/Transfer History:** already at parity in `BuyerAdminPanel`.
- **Buyer status:** already well-aligned with the data-bank keep-list (header Call/WA/Email/Log/Note/Voice, Buyer Intelligence, Conversation, Quick Note, Property/Transaction, Client info, Location, Admin, Imported Fields, Change History). ⏳ Possible add: "Share Resources from Gallery" (LeadResourceShare equivalent) + read-only AI analysis.
- 🟡 **C1 — Cold/Revival "Hybrid Layout" (Lalit):** make Cold look like the Lead field-card layout (Client-Info, Property Requirements, Budget, Source, Tags, Smart Timeline) WITHOUT Lead-only actions. Cold currently is a lighter single-column ❄️ view — needs the field cards added (reuse Lead card components; no new backend since Cold IS a Lead). ⏳ NOT yet built.
- **REMAINING FORWARD WORK:** (1) Cold Hybrid field cards. (2) Optional Buyer gallery-share + read-only AI. (3) Wire the data-bank rule so ALL hidden features auto-unlock on Convert-to-Lead (verify convert carries all history — mostly already true).
- 🚀 **DEPLOYED 2026-07-01 (`fd727d3`, prod d01d9bb→fd727d3):** corrective controlled deploy of the data-bank-correct Buyer/Cold UI (Lead-only workflow hidden) + concurrent Buyer terminal-reject/reactivate. Gates: tsc 0 · regression 118/0 · hr-rbac PASS · next build OK. Backup `pre-deploy-2026-07-01T12-08-48-298Z`. DB verified (BuyerFieldHistory + rejectCategory/aiEligibleForRevival present). Smoke: /api/health=fd727d3, all routes non-5xx, real buyer/lead/cold render queries OK, buyer/cold pages have 0 Lead-only-workflow refs. Rollback point d01d9bb.
- ⚠️ **INCIDENT (resolved):** a concurrent session had deployed mid-build commit `d01d9bb` (queried `BuyerVoiceMessage` not yet in Neon) → buyer detail 500'd. Fixed by hand-applying the missing additive tables (empty, zero data-risk), then this corrective deploy removed the query entirely. Cause = multiple sessions deploying the shared `ws-unify-lead-view`/main. Dormant `BuyerVoiceMessage/Read` tables remain in prod (harmless; drop later if desired).
- ⏭ **NEXT (Lalit-approved, after stable):** Cold/Revival **Hybrid Layout** in phases — P1 Client Info/Property Requirements/Budget/Source/Tags/Timeline/Conversation/Shared Resources; P2 AI read-only (summary/priority/next-best-action); P3 convert/assignment/analytics. Reuse Lead field-cards, hide Lead-only actions. Build incrementally, test each phase before the next.

---

## 🚀 ACTOR vs OWNER — timeline shows who PERFORMED the action (2026-07-01, Lalit — audit/compliance) — SHIPPED + RECONCILED
**DEPLOYED prod `c15a918`** (from a9b2f56; rollback=a9b2f56). Migration `20260701140000_actor_owner_attribution` hand-applied to Neon + verified. Gate green (tsc0 · regression 120/0 · HR RBAC PASS). SW v131→v132. Full backup `FULL-2026-07-01T12-57-12-631Z`.
**Reconcile DONE** (Lalit-approved, batched+audited): 130 duplicate-intake rows owner→System · 130 AuditLog `activity.actor-reconcile` · 0 skipped/exceptions/remaining · reversible backup `reconcile-actor-owner-2026-07-01T13-05.json`. Acefone 40 + WA 77 left unchanged (unrecoverable, never guess).
**Validation:** CallLog actor 1647/1647 · 490 calls + 2219 activities actor≠owner (performer shown not owner) · dup-intake owner-stamped now 0 · inbound-unmatched→unassigned.
**Future (designed, not built):** Unmatched Calls Queue (`docs/ACTOR_VS_OWNER_TIMELINE.md`).
**Rule:** Conversation History/Timeline ALWAYS shows the Activity Actor (logged-in user who did it), NEVER the Lead Owner. Separate concepts; never conflate. Branch `ws-actor-vs-owner-timeline`. Design: `docs/ACTOR_VS_OWNER_TIMELINE.md`. See [[feedback-actor-vs-owner-timeline]].
- **Root cause (verified):** 3 tiers — (1) render fallback painted the OWNER when a row had no actor (`ConversationStreamCard` fallbackActor); (2) `WhatsAppMessage` had NO actor column → every outbound WA showed the owner; (3) 4 write paths stamped the owner as actor (leadIngest dup-intake, workflowEngine task, revivalImport, acefone unmatched-call fallback). CallLog was already correct.
- ✅ **Render fix:** null actor → "System" (never owner); outbound WA → `m.actor` sender else "Outbound"; unmatched call → "Unknown Agent".
- ✅ **Write-path fixes:** dup-intake→null, workflow task→null, revival import→importer (`changedById`), acefone unmatched→UNASSIGNED (no owner/admin fallback).
- ✅ **Schema (additive):** `WhatsAppMessage.actorUserId` (nullable) + populated on human sends; `CallLog.userId` made nullable (unmatched calls unassigned). Ripple to reporting/leaderboards/digest handled (null excluded from per-agent counts). **Needs prod migration — gated.**
- ✅ **Regression:** new `actor-never-owner` invariant (write paths + render + schema locked). tsc 0.
- ✅ **Read-only prod analysis** (`scripts/actor-owner-analysis.ts`): historical DATA bug = **130 duplicate-intake rows** (owner-stamped). Workflow/revival = 0 rows. Acefone 40 inbound owner-stamped = unrecoverable (leave). Outbound WA 77 = no actor data (leave). 737 null-activities were rendering-only (fixed by UI, no data touch).
- ⏳ **Historical reconciliation (GATED):** `scripts/reconcile-actor-owner.ts` dry-run verified (130 rows). Backup-first + txn + `--apply`. **NOT run — awaiting Lalit approval.**
- ⏳ **DEPLOY (GATED):** schema migration data-risky per production-safety → backup + approval, then reconcile.
- 🔵 **Future (designed, not built):** Unmatched Calls Queue (admin maps unassigned inbound calls → separate audit event, never rewrites original). Owner-at-time derivable from Assignment history.

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
- ✅ **Buildable-now batch (SHIPPED `46ffafa`):** WhatsApp templates/quick-send (`/api/hr/templates` + `/render` + HRWhatsAppTemplatePicker) · import DRY-RUN preview (?dryRun=1, no writes, then Confirm) · interview conflict detection (±60min, non-blocking, human-readable) · period-accurate reports (conversion funnel + time-to-hire from in-period activity) · unread voice/escalation badges (list + nav) · candidate-detail keyboard shortcuts. Built understand→build→verify; adversarial findings fixed (conflict message shape, import dedup soft-delete + owner validation).
- **REMAINING (needs YOU):** decisions — secondaryOwnerId keep/drop · interview naming (types vs rounds) · auto EXPECTED_JOINING→JOINED. Credential-gated — Acefone call logging · WhatsApp Business API auto-send · Google Calendar sync · (Vercel Blob deferred by choice).
- **STATE: HR ATS production-ready & backlog clear.** 7 deploys today (b7bed60 RBAC · dde334f schema · b6c876d modules · 8f4c586 detail+intake · eb56380 polish+QA · fe3f8c1 resume-dedup/polish), every batch gated tsc 0 · hr-rbac PASS · regression 108/0 · next build OK · health-verified. Awaiting Lalit's live UAT feedback.

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
