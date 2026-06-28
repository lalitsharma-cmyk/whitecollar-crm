# HR ATS Module — Consolidated Audit & Execution Plan

_Generated 2026-06-28 via 13-area parallel read-only audit (orchestrated). Source of truth for the HR ATS productization workstream._

## 1. Executive summary

The HR ATS has a **solid, well-normalized foundation** (clean Prisma models, working candidate→interview→follow-up→offer→joining lifecycle, import pipeline, dashboard, resume bank) but sits at roughly **40–60% of Sales-CRM parity** and is **not production-safe in its current state**. Two issues dominate everything else: (1) a **systemic RBAC failure** — nearly every `/api/hr/candidates/[id]/*` route enforces login but **not ownership**, so any HR agent can read, edit, delete, or download any candidate (salary, resumes, feedback) by guessing an ID; and (2) the **three-tier role model the spec requires (Admin / Senior HR / Junior HR) does not exist** — the code reuses Sales `ADMIN/MANAGER/AGENT`, which locks Senior HR (Nisha) out of reports entirely while leaving APIs under-gated. Biggest risks: PII/data-exfiltration via the RBAC leaks, a possible **production schema-drift on `User.hrOnly/hrTeam`** that could silently break HR login, and **email not lowercased on website intake** quietly creating duplicate candidates. Voice/conversation-history features are entirely absent (a known parity goal, but lower stakes than security).

## 2. What already works (by module)

- **Architecture/schema** — Normalized models (`HRCandidate`, `HRInterview`, `HRFollowUp`, `HRActivity`, `HRResume`, `HRApplication`, `HRIntakeLog`, `HRImport`); well-indexed; latest migration current. Entry RBAC in `(hr)/layout.tsx`.
- **Dashboard** — Metric pills, action list, no-next-action list, follow-up tabs, today's interviews, no-show recovery, expected joinings, reminders calendar, dark mode, IST handling.
- **Candidate list** — Table + card views, 5-field search, 13 quick chips, 15+ filters, bulk actions, Excel/CSV export, status colors.
- **Candidate detail** — Inline edit, call logging w/ outcomes, WhatsApp log, interview schedule/confirm/attend, follow-up creation, resume upload, status dropdown, fit fields, timeline page.
- **Interviews** — Scheduling (VIRTUAL/HR/FINAL/F2F), auto status transitions, auto confirmation + reminder follow-ups, attendance, no-show auto-recovery, list (5 tabs), 14-day calendar.
- **Follow-ups** — Today/Overdue/Upcoming + confirmation + no-show tabs, missed-actions page, Call/WhatsApp/Done quick actions.
- **Resume bank** — Upload (5MB bytea), download/view, active-version tracking, AI auto-fill at create.
- **Import/Export** — Multi-step wizard, fuzzy header match, dup detection (phone/email/WA), status categorization preserving verbatim, batch tracking + error CSV, hard-delete rollback (Admin), website intake with dedup.
- **Reports** — Recruiter productivity table + pipeline funnel snapshot + period selector.

## 3. Unfinished / broken / abandoned (COMPLETE FIRST)

**P0 — broken / unsafe**
- RBAC ownership not enforced on candidate APIs (GET/PUT/POST/PATCH/DELETE on `route.ts`, `interview`, `followup`, `log`, `resume`, `bulk`, `check-duplicate`, `export`, detail/timeline pages).
- Resume DELETE has zero authorization (`resume/route.ts:102-111`).
- Three-tier HR role model missing (spec: Admin/Senior HR/Junior HR; code: ADMIN/MANAGER/AGENT).
- Reports locked to ADMIN only (`reports/page.tsx:21`) — Senior HR (Nisha) redirected out.
- Candidate list fetches hardcoded 300 rows (`candidates/page.tsx:29-40`) — silent data loss past 300; pagination API exists but unused.
- `HRImport.importBatchId` uses `onDelete: SetNull` (`schema.prisma:2098`) — batch rollback orphans candidates.
- Email not lowercased on website intake (`intake/hr/route.ts:181`) — dedup-evading duplicates.

**P1 — half-done / abandoned**
- No reschedule UI (opens a new interview instead of PATCHing `scheduledAt`).
- No interview result/feedback capture (`result`/`notes` fields exist, no UI; fit fields orphaned).
- Follow-up completion drops the candidate (no next touchpoint created).
- No completion gate (can mark done with no logged contact).
- Bulk follow-up date accepts past dates (no `futureOnly`).
- Orphaned auto-follow-ups on interview delete.
- `rawRemarks` stored but never displayed/parsed (imported conversation history invisible).
- Applications tab only renders if data pre-exists; not in detail `include`.
- Reports = 1 of 10 spec report types.
- Status auto-map on call outcome partial.
- Abandoned `secondaryOwnerId` (present, unused).

## 4. Gaps vs spec & Sales parity

- **Schema** — no `HRCallLog`/`HRWhatsAppMessage`, no `HRVoiceMessage`/`HREscalation`, no `HRInterviewFeedback`, bare `Float?` salary (no range/currency/band), no `HRSavedFilter`, no field-history, no soft-delete, no source enum.
- **Dashboard** — missing Today's Calls, Daily Tasks, Recruiter Productivity card, Leaderboard, Upcoming-Interviews card, Recent Activities feed, Pending-Confirmations card, Pipeline chart, Unassigned count.
- **Candidate list** — no saved views, no column selection/freeze/sticky, missing created date/time + source + notice columns, no inline call/WA icons, no server pagination/sort UI, weak search.
- **Candidate detail** — not card-based (density-v1), no unified conversation stream, no compact quick-action client, no readiness banners, no mobile tab bar, no sticky note.
- **Timeline/conversation** — no voice record/playback, no unified stream, no escalation thread, no broadcast, interview entries not merged.
- **Interviews** — no reschedule, no feedback/result, missing GHOSTED/SELECTED/REJECTED + offer/joining transitions, no bulk, no conflict detection, no timezone, no rounds.
- **Follow-ups** — no snooze/skip/escalate, no rollover cron, no bulk, no saved views, missing Offer + Joining pages.
- **Resume bank** — no search/filter/sort, no version history UI, no preview modal, no post-upload parsing, no cross-candidate dedup, no pagination.
- **Import/export** — no preview/dry-run, no soft-delete rollback, no Junior read-only export, no rawImport audit.
- **Reports** — 9 missing report types, no daily/weekly segmentation, no exec cards, no CSV export, no filters.
- **UI/UX** — emoji buttons vs `ActionButton`/`ActionIconButton`, Lucide/emoji mix, dark-mode gaps on mobile cards/badges, missing empty/loading states, no RBAC-aware hiding.

## 5. RBAC & security (highest stakes)

Every candidate API calls only `requireUser()` — an Agent can act on **any** candidate by ID:

| Route / file | Leak |
|---|---|
| `GET /api/hr/candidates/[id]` | Read any candidate (salary, fit, feedback) |
| `PUT /api/hr/candidates/[id]` | Edit any candidate; reassign ownership to self |
| `POST/PATCH .../interview` | Schedule/alter interviews on any candidate |
| `POST/PATCH .../followup` | Complete others' follow-ups |
| `POST .../log` | Log calls + auto-change status on any candidate |
| `POST /api/hr/candidates/bulk` | Bulk status/owner update bypasses scope |
| `.../resume` (incl. **DELETE:102-111, no auth**) | Download / fake / delete any resume |
| `GET .../check-duplicate` | Reveals peers'/managers' candidates |
| `GET .../export` / `POST .../import` | Manager exports/imports across all teams |
| `/hr/candidates/[id]` page + `/timeline` | Full data, no scope check |
| list pages | Scope client-side only; direct API returns all |

**Role-model failures:** no `SENIOR_HR`/`JUNIOR_HR`; no Manager team-scoping; `/api/hr/users` lets any Admin grant hrOnly/hrTeam.
**Hardening gaps:** no audit logging, no `deletedAt: null` filter, no bulk-size/rate limits.
**Fix pattern:** create `src/lib/hrCandidateScope.ts` (`hrCandidateScopeWhere(me)` + `canTouchCandidate(me, candidate)`) mirroring `leadScope.ts`; call in **every** route + server page; return 404 (not 403) on denial.

## 6. Data-risk register

- **Schema drift (verify FIRST, backup-first):** `User.hrOnly`/`hrTeam` may not exist in prod → HR login fails silently. Verify via `information_schema`; backfill idempotently after backup.
- **Email case mismatch** (intake vs import) → silent duplicates.
- `onDelete: SetNull` on `importBatchId` → orphans on rollback (change to Cascade).
- `rawRemarks` unvalidated → potential PII leak; apply conversation-column detection.
- **Test-data deletion plan (no hardcoded HR seeds — good):** test data accrues only from dev imports / UAT website forms / manual creates. Before purge: (1) `backup-hr-candidates.ts` full JSON; (2) read-only `audit-hr-test-data.ts`; (3) add `isTest`/`importType` markers; (4) purge behind `--apply` + Admin + audit + Cascade.

## 7. Prioritized execution plan

- **Phase 0 — Production safety (SERIAL, gate):** backup prod; verify `hrOnly/hrTeam` in prod, backfill if missing; write read-only backup + test-data audit scripts.
- **Phase 1 — Schema & role foundation (SERIAL migration):** add SENIOR_HR/JUNIOR_HR; new tables/fields (saved filters, interview feedback, voice/escalation, field history, salary range/currency, source enum, deletedAt/importType/isTest, rawImport); `importBatchId`→Cascade; create `hrCandidateScope.ts`.
- **Phase 2 — Security hardening (SERIAL after 1):** wire scope into every route + page; fix resume auth; Manager team-scoping; restrict `/api/hr/users`; audit logging; `deletedAt` filter; bulk limits; intake email lowercase. _Gate: RBAC matrix passes._
- **Phase 3 — Parallel modules:** A list/detail, B interviews+lifecycle, C follow-ups, D reports+dashboard, E import/export+resume bank, F voice/conversation.
- **Phase 4 — UI/UX consistency pass.**
- **Phase 5 — QA + test-data purge (final gate):** RBAC matrix + regression; mirror new queries into `scripts/regression.ts`; execute purge; bump SW version.

## 8. Open questions for Lalit

1. Senior HR (Nisha): see **all** candidates or **team-scoped**?
2. Follow-up "Skip": temporary snooze (24h) or permanent dismiss?
3. Interview type naming: keep VIRTUAL/HR/FINAL/F2F or move to rounds?
4. `secondaryOwnerId`: real co-ownership workflow or drop?
5. EXPECTED_JOINING→JOINED: auto-flip on joining date or manual?
6. Voice/escalation: needed for go-live or deferred post-MVP?
7. Resume storage: stay on 5MB Postgres bytea or budget Vercel Blob?
8. Integrations: WhatsApp Business API / Acefone dialer / calendar, or all manual for now?
