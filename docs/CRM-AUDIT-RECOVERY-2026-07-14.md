# WCR CRM — Complete Audit & Recovery Report
**Date:** 2026-07-14 · **Prod commit:** `f8dc049` · **Method:** read-only code scan + live-prod data probes + full invariant suite (145/145 green) + 4 parallel investigation agents + reconciliation of the repo's own prior QA docs.

## Ground truth established first
- **Committed `main` is 100% deployed.** `git log f8dc049..main` is empty; prod `/api/health` = `f8dc049`. There is **no committed-but-undeployed code.**
- **All un-shipped work is either (a) the UNCOMMITTED Task Manager working tree, or (b) 6 unmerged branches** (mostly frozen/superseded).
- **Live data integrity is clean:** 0 orphans (owner/prevOwner/rejectedBy/leadProject/activity/note/callLog/assignment/buyerOwner/fieldHistory), 0 leads owned by inactive/HR users, 0 Lost/Rejected still owned, 0 terminal leads with a follow-up, 0 bad status transitions, 0 corrupted budgets. Prod: 3,962 leads (1,778 live / 2,184 deleted), 2,102 buyers, 11 active users (7 AGENT · 1 MANAGER · 3 ADMIN), 67 OperationLog rows.
- ⚠️ **A parallel session is actively building the Task Manager right now** (`tasks/page.tsx` created mid-audit). This report does not touch it.

---

# 1. Development Pending

| # | Item | State | Evidence |
|---|------|-------|----------|
| D1 | **Task Manager — 6 of 7 pages missing** | Backend (`api/tasks/`), lib (`lib/tasks/`), components (`components/tasks/`) + `/tasks` (My Day) exist; `/tasks/{upcoming,all,assigned-to-me,assigned-by-me,team,completed}` are wired in `MobileShell` nav but have **no `page.tsx` → 404**. All uncommitted, flag `taskManager.enabled` OFF. | `MobileShell.tsx` nav diff; `find src/app/(app)/tasks` = only `page.tsx` |
| D2 | **Cold/Revival "Hybrid Layout" field cards** — not built | Cold detail is still a lighter single-column view; Lalit asked for the Lead field-card layout (Client-Info, Property, Budget, Source, Tags, Timeline) without Lead-only actions. | `docs/DEV_TRACKER.md:19` "⏳ NOT yet built" |
| D3 | **Unified Lead Detail — 5 card pairs still duplicated** | Shell/tokens/Returning-Client shared; Conversation timeline, Quick Note, Client Info, Notes, Actions are still per-module duplicates (Buyer* vs Lead). | `docs/PRODUCT_QA_DIVERGENCES_2026-07-03.md:52` (C1) |
| D4 | **CI-BACKFILL — "Conversation = source of truth"** not built | Only render-time classification; no Activity records, no live hook, no Needs-Review queue, no historical backfill. | `PRODUCT_QA_DIVERGENCES:53`; memory `feedback-conversation-source-of-truth` |
| D5 | **Global Identity Resolution** — built-but-dormant, Lead-only | Not live on ingest; buyer-convert bypasses it; no cross-module `CustomerMember`; no unlink UI. Blocks Revival rule 5. | `PRODUCT_QA_DIVERGENCES:54` (C3) |
| D6 | **Unmatched Calls Queue** — designed, not built | Admin-maps-unassigned-inbound-calls; only the design exists. | `DEV_TRACKER.md:41`, `docs/ACTOR_VS_OWNER_TIMELINE.md` |
| D7 | **Notes "pin"** — not implemented | PATCH/pin dead-ends because `Note.pinned` isn't in the schema. | `api/leads/[id]/notes/[noteId]/route.ts:14` |
| D8 | **Intake "Calls / IVR"** — "Coming soon" placeholder tile | Unbuilt intake surface. | `intake/page.tsx:176` |
| D9 | **Dedup auto-merge/block on create+import** — not built | Detection + admin manual-merge shipped (`/admin/duplicates`); the *automatic* merge/block prompt at create/import and a one-time historical-phone backfill are still design-only. | `docs/CRM_BUG_REPORT.md` B-01 |
| D10 | **BANT stage-gating** — not built | At-a-glance N/4 pill shipped; gating stage advancement on BANT completeness needs co-design. | `CRM_BUG_REPORT.md` B-17 |

**Minor/cosmetic dev debt:** dead `ComingSoon.tsx` (0 imports); stale tooltip "Buyer module not yet live" (`AgentPerformanceTable.tsx:152`); `revival-constants.ts:13` TODO remove-after-refactor; `settings.ts:76` "TEMPORARY" website auto-assign block; `GlobalCalendarPanel.tsx:165` shows all events (no team filter).

---

# 2. Deployment Pending

| Item | Dev status | Deploy status | Prod impact | Deploy risk |
|------|-----------|---------------|-------------|-------------|
| **Task Manager** | Partial (D1) | Uncommitted working tree; migration `20260714120000_task_manager` **unapplied**; flag OFF | None yet (dark) | **HIGH if mishandled** — 334-line schema add (Task + Reminder + 10 enums) needs hand-apply-then-`resolve` + backup; do NOT `prisma migrate deploy` blindly |
| **AI Sales OS v2** (`ai-sales-os-v2`) | Complete (13 commits, real LLM engine, 104 tests) | Not merged, not deployed | None (frozen) | Blocked by permanent AI freeze — do not touch |
| **Customer-Layer Foundation** (`feat/customer-layer-foundation`) | 2 commits (schema + computed health/360/search) | Excluded from RC2 as "stale/would resurrect deleted buyer functionality" | None | Medium — needs fresh rebase, not a straight merge |
| `feat/ai-sales-os` (superseded), `ws-*` branches (content shipped), remote `recovered/stash-*` | Various | Unmerged, redundant/superseded | None | Low — candidates for deletion after confirmation |

Everything on `main` is deployed. The only *unapplied migration* is the Task Manager one (uncommitted).

---

# 3. Testing Pending
The invariant suite (145 checks) passes and covers data-integrity + permission + terminal-status + follow-up + cross-module *rules*. What it does **not** cover:

- **Cross-browser / cross-device (category 10):** never executed on real Mac Safari / iPhone / iPad / Android — the app is login-gated and I have no devices. Static analysis only (see §10). **Highest untested surface.**
- **The un-migrated modals (category 10):** 8 *live* components with the text-selection-closes-modal bug shape — strongest candidates `TimelineEntryEditModal`, `AdminUsersClient`, `VaultClient`, `HRCandidateDetail`, `HRImportClient` (also `ColumnHeaderFilter`/`LeadHeaderFilter`/`MobileShell`, likely popover/nav not true modals — verify). The Jul-10 fix was not propagated to these. `LeadBulkActions` also matches the shape but is **dead code** (unmounted). Needs per-modal verification.
- **Import/export edge cases (category 8):** dedup preview-vs-write divergence, `createdAt` round-trip loss, phone CSV coercion, unguarded date parse — none have a regression test; verify on real files.
- **Role/permission click-through:** invariants assert the gates in source; a live logged-in click-through per role (Agent/Manager/Admin) has not been done this cycle.
- **Performance at current scale:** perf report was written at 45 leads; prod is now 1,778 live. Missing indexes (`Lead.followupDate`, `Lead.lastTouchedAt`, composite `(forwardedTeam,status)`) and the Properties `1+3N` N+1 are now exercised against a real dataset for the first time — measure.
- **Cron end-to-end:** the GitHub-Actions crons are not firing (see §5), so their workflows are effectively untested in prod right now.

---

# 4. Decision Pending From Lalit

| # | Decision required | Recommended | Risk of each option | Default if silent |
|---|-------------------|-------------|---------------------|-------------------|
| Q1 | **Re-enable GitHub Actions crons** (13 sub-daily jobs incl. follow-up rollover, SLA, unassigned-reminders) | Re-enable + verify `CRON_SECRET` | Leaving off = overdue follow-ups never auto-roll, no SLA escalation. On = normal. | Stays OFF — operational drift continues |
| Q2 | **Won/Closed follow-up** — keep clearing it, or let booked deals carry a follow-up (handover/payment)? | Keep clearing (current) | Carry = booked deals sit in queues forever unless a status filter is added. Clear = no handover reminder. | Keeps clearing |
| Q3 | **`set_team` bulk (leads) + buyer assign/distribute** — Admin-only, or keep Manager? | Your call — Manager is defensible for team routing | Lock = managers lose team-routing. Keep = a manager-reachable bulk mutation exists (constrained to own team). | Keeps Manager |
| Q4 | **Convert-to-Lead** — Admin-only, or keep owning-agent? | Keep owning-agent (single-record, scoped) | Lock = agents can't convert their own buyers. Keep = fine. | Keeps agent |
| Q5 | **Dedup auto-merge/block on create + import** + one-time historical-phone backfill | Build it — #1 trust blocker | Not building = duplicate clients keep entering (see §5/§8 fingerprint miss). | Stays manual-merge only |
| Q6 | **Integration credentials** — Acefone (telephony), Meta/WhatsApp Business, email (Resend), push (VAPID), blob storage | Supply per priority | All are dark until creds set; blob needed for KYC/passport docs (5MB bytea ceiling today). | Stay dark |
| Q7 | **Flip round-robin + 15-min SLA** (currently OFF, Lalit paused 2026-06-22) | Flip after a small validation window | Changes who leads route to going forward; no historical data touched. | Stay OFF |
| Q8 | **Device security enforce** (`DEVICE_SECURITY_ENFORCE`) — flip from MONITOR to ENFORCE | Flip once trusted-device list is clean | Enforce too early = locks out legitimate devices. | Stays MONITOR |
| Q9 | **Sale Off / Lease Off** — first-class modules or status-views? | Status-views (current) is fine | Modules = more nav/build; views = less discoverable. | Stays views |
| Q10 | **Returning-Client card + Task Manager flags** — flip ON when? | After UAT | Flipping dark features on without a click-through. | Stay dark |
| Q11 | **Task Manager** — is this an approved build to continue, and who owns it? | Confirm scope + commit the WIP so it isn't lost | Uncommitted work can be lost on a bad `git` op. | WIP at risk |

---

# 5. Production Bugs Still Open

| Sev | Bug | Detail | Evidence |
|-----|-----|--------|----------|
| **P0 (operational)** | **13 GitHub-Actions crons dead** | `cron.yml` present but Actions scheduling not firing since ~Jul 2; follow-up rollover / SLA / unassigned-reminders / revival-sweep / site-visit-watch not running. The 2 Vercel daily crons (morning/evening reminder) DO fire. | `.github/workflows/cron.yml`; memory `project-cron-outage-jul2` |
| **P1** | **Dedup fingerprint miss creates duplicates** | Write-path dedup key is the single string `phone\|email`; a person first stored with phone+email won't match a re-import carrying only the phone → **new duplicate lead**, even though the preview flagged it. | `assignment.ts:39-44`; import-audit D2 |
| **P1** | **`createdAt` lost on lead re-import** | Export emits `createdAt`; the import auto-mapper has no `createdat` candidate → historic date demoted to customFields and re-stamped to now/+10min. `currentStatus` similarly doesn't round-trip. | import-audit §C |
| **P2** | **Text-selection closes ~8 modals** | Jul-10 fix not propagated; drag-selecting text in these modals can close them + drop the draft (`LeadBulkActions` also matches but is dead/unmounted). | §10; `grep backdropProps` |
| **P2** | **Phone CSV coercion** | Every CSV export writes `+`-prefixed E.164 with no text guard → Excel treats `+9715…` as a formula (`#NAME?`/0); xlsx paths are safe. | import-audit D4 |
| **P2** | **Unguarded date parse on lead import** | `followupDate`/`meetingDate`/`siteVisitDate` use unguarded `parseImportDate` — a stray bare "5" becomes 05-Jan-1900 (buyer follow-up is guarded; leads aren't). | import-audit D6 |
| **P2** | **Buyer chunk import can be unrevertable** | A chunk POST with `batchId:null` (no `{init:true}` first) creates buyers with no `importBatchId` → no revert. | `buyer-data/import:239,449` |
| **P3** | **`/api/health` leaks total lead count** to anonymous callers | GET returns `prisma.lead.count()` unauthenticated. | `health/route.ts:14` |
| **P3** | **`intake/email` fails open** if `EMAIL_INTAKE_KEY` unset | Skips the key check → accepts unauthenticated lead injection. Config hardening. | `intake/email:70` |
| **P3 (data)** | **27 Won/Closed leads unowned** | Booking attribution lost — these were rejected earlier then re-statused; pre-existing pattern, not caused by any current rule. | prod probe |
| **P3 (data)** | **1 buyer CONVERTED → soft-deleted lead** (Mr. Mayank Budhiraja) | Buyer shows CONVERTED but its lead was deleted 2026-06-24; not an OperationLog revert. Stranded pointer. | prod probe |
| **P3 (hygiene)** | **2,179 soft-deleted leads keep a followupDate** · **501 live leads null status** · **318 in "Needs Review"** | Benign (deletedAt filters the first) but untidy; the 318 are an operational reclassification backlog. | prod probe |

**Verified CLOSED (were flagged in old docs, confirmed fixed in current code):** B-02 `/calls` agent leak (`where: isAgent ? {userId:me.id} : {}` now present); B-08/09/10/11 agent-scope leaks; B-03/04/05/13/14/16/17/18/19/20. The June `CRM_BUG_REPORT.md` "re-verify" note on B-02 is stale.

---

# 6. Cross-Module Consistency Issues

**Architecture:** Master Data detail = the Leads detail *verbatim* (`master-data/[id]/page.tsx` re-exports `leads/[id]/page`). Revival rows ARE Leads (separate detail file re-importing shared components). Dubai + India Buyer share one `BuyerListClient` and one market-agnostic detail (`/buyer-data/[id]`) — byte-identical, differ only by market/currency/roster. `RevivalEngineListClient.tsx` and `LeadBulkActions.tsx` are **dead code** (defined, never mounted).

| Capability | Leads | Master Data | Dubai Buyer | India Buyer | Revival |
|---|:--:|:--:|:--:|:--:|:--:|
| Terminal-status rule (unassign+clear f/u+prev owner) | ✅ | ✅ | ⚠️ | ⚠️ | ✅ |
| Previous Owner column + filter | ❌ | ✅ | ➖ (no col) | ➖ | ❌ |
| Select-All = current page | ✅ | ✅ | ✅ | ✅ | ✅ |
| Bulk actions admin-gated (server) | ✅ | ✅ | ✅ | ✅ | ⚠️ V1 |
| Detail workflow set | ✅ full | ✅ full | ⚠️ staging | ⚠️ staging | ⚠️ near-full |
| Call / WhatsApp / Note / Log-Call | ✅ | ✅ | ✅ | ✅ | ✅ |
| Convert-to-Lead + revert | ➖ | ➖ | ✅/✅ | ✅/✅ | ✅/❌ |
| Shared DetailShell / cards | ✅ | ✅ | ⚠️ 5 pairs dup | ⚠️ | ✅ |
| Import dedup scheme | tail-10+combined | (via CSV) | tail-8+key+market | tail-8+key+market | (via CSV) |
| Import source preservation | ✅ verbatim | ✅ | ❌ hard-coded | ❌ | ✅ |
| Export timezone | IST ISO | IST ISO | IST date-only | IST date-only | IST ISO |
| Call attribution by surface | ✅ | ✅ never "MD" | ✅ | ✅ | ✅ |

**Confirmed gaps (6):**
- **G1 — Revival detail missing Voice Guidance** (Medium). Lead detail imports `LeadVoiceGuidance`/`VoiceGuidancePin`; Revival imports none → manager→agent voice guidance unavailable to Revival agents. **Channel-① voice, NOT AI — not covered by the freeze.** Violates *Revival = FULL Lead parity*.
- **G2 — Revival detail missing Escalation thread** (Medium). The lightweight "Escalate" button exists; the two-way `LeadEscalationThread` doesn't. Same parity rule.
- **G3 — Buyer terminal rule incomplete** (Medium, schema-parked). `rejectBuyerInTx` unassigns but never clears `followupDate` and stashes no Previous Owner (`BuyerRecord` has no `previousOwnerId`). A rejected buyer can keep a stale follow-up. Prior ownership is modeled via `BuyerAssignment` stints instead — a deliberate schema choice; parity gap is PARKED per production-safety. **Confirm the stale follow-up is acceptable.**
- **G4 — Buyer detail missing Gallery/Brochure share** (Low-Med). The data-bank KEEP list says buyers should retain "Share Resources from Gallery," but `BuyerActionsClient` has none. Confirm intent.
- **G5 — Revival "promote" not reversible** (Low). Buyer→Lead convert is a first-class reversible `OperationLog`; Revival promote writes no OperationLog and has no dedicated revert.
- **G6 — Bulk-gating client/server mismatch** (Low, UX). `leads/page.tsx` sets `canBulk = ADMIN||MANAGER`, so managers SEE Reassign/Status/Reject bulk controls that the server 403s. No escalation (server is the gate) but the UI over-promises.

Plus the import/export cross-module items: 4 divergent dedup schemes + preview≠write (§8 D1), buyer source hard-coded (D5), export timezone inconsistency.

**Deliberate differences (not gaps):** buyer hides Lead-only workflow until Convert (staging-bank rule); Master Data admin-only + adds Bucket/Previous-Owner; Master Data never an activity-attribution surface (calls fold to "Leads"); buyer uses `BuyerActivityTimeline` (ledger) inside the shared shell; Dubai/India differ only by market+currency; buyer convert is owner-or-admin by design.

---

# 7. Admin Permission Audit
242 API routes classified. Master Data (whole module), all 10 named bulk actions, all exports/imports/reverts are correctly Admin (or Super-Admin) gated. **Deviations from "10 bulk actions = Admin-only":**

| ID | Route | Current gate | Verdict |
|----|-------|--------------|---------|
| **V1** | `cold-data/bulk-assign` | `requireRole("ADMIN","MANAGER")` | **Violation** — a MANAGER can bulk-assign cold/revival rows. (This is the parked GS7 route.) |
| V2 | `leads/bulk` `set_team` | ADMIN+MANAGER (own-team scoped) | Deviation — manager does a bulk field mutation. **Decision Q3.** |
| V3 | `buyer-data/assign` + `distribute` | ADMIN+MANAGER (subtree/market scoped) | Confirm — is buyer-pool distribution "Bulk Assign"? **Decision Q3.** |
| V4 | `admin/projects/[id]/units/import` | ADMIN+MANAGER | Low sev — project-unit inventory, not customer data |
| V5 | `leads/bulk` `reject` | owner-scoped, no role gate | Intentional (agents reject own leads); strict reading = bulk status change. Confirm. |

**Gaps:** G1 `/api/health` leaks lead count (P3); G2 `intake/email` fail-open if key unset (P3). **Policy inconsistency:** `intake/csv` + `google-sheet` gate at `requireRole("ADMIN")` while every other export/import uses `canImportData` = **Super-Admin** — a plain admin can import leads, looser than the documented policy. Consider aligning. **Stricter-than-required (fine):** bulk delete + master soft-delete are Super-Admin.

---

# 8. Import / Export Audit

**Exports** — leads export = 42-col "sales-list" projection. Present: rawImport, rawRemarks, sourceRaw, sourceDetail, followupDate, created/updated, module, owner name. **Missing (material):** ownerId, previousOwnerId, previousStatus, market, nationality, clientType, whoIsClient, meeting/siteVisit dates, the whole EOI/booking/commission funnel, originalSheetStatus. Manually-entered depth is **not recoverable** from an export. Buyer export ⚠️ column `ownerName` = the *assigned agent*, while schema `BuyerRecord.ownerName` (the *registered property owner*) isn't exported — consumer confusion.

**Fidelity:** Dates PASS (IST ISO) except HR + calls-arm = raw UTC. Budget PASS (numeric + `budgetRaw`/`transactionValueDisplay`). **Phone RISK in every CSV path** (leading `+` → Excel formula); xlsx safe.

**Imports:** rawImport/customFields preservation PASS; terminal-status intake rule PASS (all sources); original-timestamp guard PASS (Excel serial `461198` rejected). **Issues:** (D1) 4 dedup schemes + preview≠write; (D2) fingerprint miss creates duplicates; (C) `createdAt`/`currentStatus` don't round-trip; (D5) buyer source hard-coded; (D6) lead date fields unguarded; (D7) buyer chunk without `init` unrevertable, and *enriched* rows are never revertable in any module (by design).

**Top 3 to fix:** dedup fingerprint miss → `createdAt` round-trip → preview/write dedup divergence.

---

# 9. Data Integrity Audit (live prod, read-only)
**All clean (0):** orphan owner/prevOwner/rejectedBy/leadProject/activity/note/callLog/assignment/buyerOwner/fieldHistory; leads owned by inactive or HR users; Lost/Rejected still owned; buyers with >1 active assignment; terminal leads with a follow-up; rejected-but-non-terminal; assigned+scheduled+rejected; far-future/ancient/excel-serial follow-ups; absurd budgets; buyer→missing-lead.

**Non-zero (all catalogued in §5):** 27 Won/Closed unowned · 1 buyer→deleted-lead · 2,179 deleted-with-followup (benign) · 501 null-status live · 318 Needs-Review · 55 no-phone live. **Missing operation logs:** not retroactively detectable; OperationLog only started ~early-July (67 rows, all last 7d) — pre-July structural ops predate it. **Verdict: the data layer is healthy.**

---

# 10. Cross-Platform Testing
**I cannot run real-device tests** (login-gated app, no Mac/iOS/iPad). This is **static analysis + a QA test plan the team must execute.**

**Static — GOOD:** no Safari-hostile `new Date('dd/mm/yyyy')` parsing (all uses are ISO or Date objects); no un-prefixed `backdrop-filter`; SW cache versioned (`v146`, bumped per UI deploy — the fix for the original iMac stale-cache bug); mobile shell respects safe-area insets, 44px touch targets, body-scroll-lock, 16px inputs (no iOS auto-zoom), bottom-sheet modals capped at 90vh, tables → card lists on mobile. The four critical mobile actions (Call/WhatsApp/Remark/Follow-up) pass on source review.

**Static — RISK:** the **9 un-migrated modals** (text-selection-closes-modal); `datetime-local` inputs render as native pickers on Safari/iOS (works, looks different — verify); native `<select>` overflow inside mobile forms (QA-flagged residual).

**Required human QA matrix** (per device × surface): Windows Chrome/Edge, Mac Safari/Chrome, iPhone Safari, Android Chrome, iPad Safari × {filters, dropdowns, tables, selection, text-selection-in-modal, modals, follow-up picker, WhatsApp templates, remarks, bulk actions, export open-in-Excel, import upload, call logs, dashboard}. **Prioritize Mac Safari + iPad** given the prior iMac reports.

---

# 11. Deep Regression Testing
**Automated:** 145/145 invariants green against live prod — covers the *rules* of the lead lifecycle (intake→assign→terminal→unassign→Previous Owner→reports→audit), terminal-status across all sources, follow-up boundaries, permission gates, cross-module call attribution, reversibility.

**NOT automatable by me (needs logged-in UAT):** the *click-through* of Website Lead → Master Data → Assign → Agent Work → Follow-up → Convert → Won/Lost → Reports → Call Logs → Audit, and the same for Dubai Buyer / India Buyer / Revival. I verified the **data-layer** of each stage this cycle (e.g. Master-Data assign reactivates + lands on the Action List — proven on a disposable prod record) but not the UI path. **Owner action:** one scripted UAT pass per module.

---

# 12. Final Dashboard

| Category | Items | P0 | P1 | P2 | P3 |
|----------|:---:|:---:|:---:|:---:|:---:|
| 1 · Development Pending | 10 (+5 minor) | 0 | 2 | 4 | 4 |
| 2 · Deployment Pending | 4 | 0 | 1 | 1 | 2 |
| 3 · Testing Pending | 6 areas | 1 | 3 | 2 | 0 |
| 4 · Decision Pending | 11 | 1 | 4 | 4 | 2 |
| 5 · Production Bugs | 12 | 1 | 2 | 4 | 5 |
| 6 · Cross-Module Gaps | 5 | 0 | 1 | 3 | 1 |
| 7 · Permission Deviations | 5 (+2 gaps) | 0 | 1 | 2 | 4 |
| 8 · Import/Export Issues | 7 | 0 | 2 | 3 | 2 |
| 9 · Data Integrity | 6 non-zero | 0 | 0 | 0 | 6 |
| 10 · Cross-Platform | test plan | 1 | 1 | 2 | 0 |

**The single P0 that actually hurts today: re-enable the GitHub-Actions crons (Q1).** Everything else is either a decision (§4), a contained bug (§5), or untested-but-passing-on-rules.

**Fastest path to "stable production-ready":**
1. **Q1 cron re-enable** (Lalit, 5 min) — restores follow-up rollover + SLA.
2. **P1 dedup fingerprint miss + createdAt round-trip** (dev, ~1 day) — stops duplicates + preserves history on re-import.
3. **9-modal text-selection propagation** (dev, ~2–3 hrs) — finish the Jul-10 fix everywhere.
4. **Answer Q2–Q5** (Lalit, minutes) — unblocks the permission + Won/Closed + dedup-policy work.
5. **Human QA matrix on Mac Safari + iPad** (Lalit's team, ~half day) — the real untested surface.
6. **Decide on the uncommitted Task Manager** (Q11) — commit it so it isn't lost, or park it deliberately.

**Effort roll-up:** the genuinely-code items above ≈ **2–3 developer-days**. The rest is decisions + credentials + a QA pass — not engineering time. **No P0 code defect and a clean data layer** means the CRM is much closer to production-ready than the volume of this list suggests; the long tail is deferred features and business decisions, not instability.
