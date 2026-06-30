# HR CRM — Production QA Audit (2026-06-29) + Fix Tracker

Read-only 11-area audit (orchestrated). 55 findings. This file = the fix worklist; status updated as fixes land.

## P0 (data-loss / security)
1. Bulk delete HARD-deletes (no soft-delete) → `bulk/route.ts:33` use `updateMany({deletedAt})`. [FIXING]
2. Inline field edits ignore `res.ok` → `HRCandidateDetail.tsx:123-132` + FitInline; check res.ok, error, refresh only on success. [FIXING]
3. RBAC leak: resume dup-detection has no scope → `resume/route.ts:35-38` add hrScopeWhere. [FIXING]

## P1 (fix today)
- Client export bypasses RBAC → server links (HRCandidateTable).
- No-Shows KPI capped at 10 → distinct count (hr/page.tsx).
- Reports: period vs all-time labels + distinct-candidate interview counts + funnel "Reached Interview" (reports/page.tsx).
- Phone validation (candidates route).
- Bulk delete `updated:0` shown as success → validate action + check count.
- Junior HR owner picker no-op → hide for Junior (HRAddCandidateForm + server enforce).
- Import preview swallows batch failures (HRImportClient).
- Delete-import-batch swallows errors (imports/[id] + HRImportHistory).
- Filter chips show no counts → render countMap (HRCandidateTable).
- "Clear filters" doesn't reset chip/search → reset all (HRCandidateTable).
- Interviews page browser-local time → IST.
- Auto-interview-followup notes server-local time → IST.
- Timeline within-day ordering newest-first → ascending within day (HRCandidateDetail + timeline page).
- PERF: candidates list 300 rows + per-row subqueries → paginate + groupBy; export streaming; HRInterview composite index.

## Candidate-profile redesign (Lalit P1)
Current `lg:grid-cols-3` = 2-col tabbed main + 1-col right rail stacking 8+ cards (right too long, center choked). Target: **Left=details · Center=timeline (widest) · Right=compact quick-actions**, top summary bar full-width.

## Timeline confirmed OK: date-grouping, imported rawRemarks, multi-HR attribution all work. Only fix = within-day ascending order.

## Migration (orchestrator, backup-first): `@@index([interviewerId, scheduledAt])` on HRInterview.
