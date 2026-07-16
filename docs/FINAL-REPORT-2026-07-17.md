# Consolidated Final Report — Overnight Execution 16→17 Jul 2026

Format per Lalit's Final Execution Instruction §8. Prod = crm.whitecollarrealty.com.
Deploy chain this window: `09baee0` → `41b9503`/`9b7ff54` → `15d659a` → `1adb007` → `5ea2b12`.
Every deploy passed the full gate (tsc 0 errors · regression suite · production build · health-check).
Regression suite grew **145 → 153 invariants**, all green.

---

## A. COMPLETED & DEPLOYED

### A1. Lead Source Intake Report + CRM-wide drill-down — `09baee0` (Batch 1)
- **Module:** Reports (new `/reports/lead-intake`) + Leads/Master/Revival/Buyers list envelopes.
- **Issue:** No source-intake report; numbers across reports not clickable; counts based on import timestamp.
- **Root cause:** No shared date/source drill contract; `/leads` had its own inline filter parser that drifted from the shared engine (UTC vs IST dates, fresh lenses missing the active-pipeline gate — 1,175 divergent rows); follow-up compliance dropped NULL-status leads (Postgres `NOT IN` ignores NULLs — up to 752 owned leads).
- **Fix:** New report (daily/weekly/monthly/yearly/custom × Team × Module × Source, metrics incl. converted/rejected, based on **original lead date**); every number emits a drill URL parsed by the target list (`?bucket=` for Master/Revival, `?filter=` + pinned `followup=all&seg=all&dateField=createdAt` for /leads); IST-aligned `leadFilterWhere`; NULL-safe workable envelope; Unclassified/Unassigned/Needs-Review shown as separate buckets (never force-bucketed, per §3).
- **Existing data:** read-only — reporting math only. **Future data:** all new leads flow through the same envelopes; drift locked by `lead-intake-drilldown` + updated `needs-lalit` invariants.
- **Tests:** AT-1 proven live (`15 Jul · Dubai · Website → 3` = drill row count); count==records verified per module.
- **Rollback:** revert commit (read-side only).

### A2. Import fidelity — canonical phone + OR-dedup + created date/time — `41b9503`/`9b7ff54` (Batch 2)
- **Module:** Intake (CSV/Sheet/API/manual), Leads, dedup engine.
- **Issue:** P0 dedup fingerprint + import created-date; phone formats inconsistent; blank sheet times invented "12:00 AM".
- **Root cause:** No canonical phone; dedup was phone-AND-email in places; import stamped upload time, not sheet Date/Time.
- **Fix:** `Lead.phoneCanonical` (digits-only CC+number, e.g. `919999999999`); **approved rule live: same normalized phone OR same normalized email = same customer** (`leadDedupOR`, wired through every intake + manual + linking + now conversion); sheet Date+Time → `createdAt` with `createdTimeKnown` tri-state (blank time shows blank, never fabricated).
- **Existing data (backfills, each with JSON snapshot + dry-run + counts):** 6,098 phones canonicalized (6,036 IN · 25 UK · 6 UAE · 2 SG · 29 other) · 5,510 time-blanks flagged · 3 genuine day-corrections · **22 manually-corrected dates DETECTED and PRESERVED** (§4A guard via LeadFieldHistory). One flagged for review: *Alok Gupta 2023-12-22 → 2026-06-20* (sheet said 2026; reversible from snapshot).
- **Future data:** stamped at create/edit; D2 proven closed on live data (phone-only re-submission of a phone+email lead MATCHES).
- **Tests:** `import-fidelity-live` invariant with Lalit's exact normalization examples + DATA arms (≥6,000 canonical / ≥5,000 time-flags).
- **Rollback:** `backups/backfill-phone-canonical-…`, `backups/backfill-created-datetime-…`, `backups/pre-deploy-2026-07-16T18-03-31-005Z`.

### A3. Security/perf batch — `15d659a` (Batch 3)
- **Module:** Health endpoint, intake endpoints, properties page, indexes.
- **Fix:** anonymous `/api/health` redacted to `{ok,commit,ts}` (lead count now auth-only); email intake fails CLOSED when key unset; Meta webhook rejects unsigned POSTs when half-configured; `bestLeadsForProjects()` collapses N+1 (max 3 queries); 3 hot indexes verified in `pg_indexes`.
- **Rollback:** revert commit.

### A4. Yasir Khan hard session reset — executed + `1adb007` (Batch 4a)
- **Module:** Auth/sessions.
- **Issue (URGENT):** force logout from every device (iPhone Safari, iPhone PWA, laptop, hidden/stale).
- **Root cause found during execution:** the password-epoch check only applied to DB-session (`sid`) cookies — **legacy pre-rollout cookies carry no issue-time, so even an admin password reset did not log them out.** Genuine security hole, CRM-wide.
- **Fix:** auth.ts now rejects any legacy no-sid cookie for a user whose `passwordChangedAt` is set (super-admin exempt as lockout backstop). Executed for Yasir: **10 session rows revoked** (iPhone Safari active till 23:36 IST 16 Jul; Windows Chrome till 19:37 IST; +8 older), **2 remembered devices removed**, **epoch stamped 00:55 IST 17 Jul**, presence rows cleared, both steps audit-logged (`user.force-logout`). Password hash untouched — he signs in fresh with the same password.
- **Existing data:** none beyond Yasir's sessions/devices. **Future:** every admin password reset / force-logout now also kills pre-rollout devices for ALL users.
- **Tests:** extended `session-device-password-hardening` invariant (legacy-cookie epoch assertion).
- **Rollback:** re-clear `passwordChangedAt` for Yasir (not recommended).

### A5. Buyer→Lead convert duplicate guard — `1adb007` (Batch 4a)
- **Module:** Dubai/India Buyer convert.
- **Issue:** the one intake path not yet running the approved dedup rule.
- **Fix:** `leadDedupOR` at convert — 409 with a pointer to the existing lead ("one customer, one lead") instead of minting a duplicate.
- **Existing data:** none touched (10 pre-existing duplicate groups / 22 leads exported for human review at `docs/reviews/duplicate-review-2026-07-16.md` — predate the engine; link via Identity Center, do NOT auto-merge). **Future:** convert can no longer create duplicates.

### A6. Presence & Last-Seen system (admin-only) — `5ea2b12` (Batch 5)
- **Module:** NEW — `/admin/presence` + heartbeat + PresenceSession model (migration `20260717040000` applied with pre-migration backup).
- **Spec compliance:** Online (heartbeat ≤90s) / Idle (>5min no interaction) / Offline / Never-Active-Today (IST); per-device sessions (multi-device listed separately, PWA badge); last seen from any device without logout; filters; per-user session history (framed as sessions, not attendance); **strict RBAC — role ADMIN and not-HR only; managers/agents/HR get 403 JSON at the API and a redirect at the page (no shell renders); presence appears in NO other payload**; every admin access audit-logged; heartbeat 60s visibility-aware; **privacy: pathname only — no message content, note text, phone numbers, GPS, or precise IP**; **zero cron dependency** (stale cleanup runs opportunistically inside the admin read).
- **Existing data:** none (new tables). **Future:** sessions accumulate from first deploy.
- **Tests:** `presence-admin-only` invariant — functional boundary checks (90s/5min/endedAt-wins), RBAC incl. the Nisha hrOnly case, pathname-privacy, both shell mounts. 36/36 build-time logic probes.
- **Rollback:** feature is additive; drop nav link + beacon mount to disable.

### A7. Lead Routing Scheduler (admin-controlled) — `5ea2b12` (Batch 5)
- **Module:** NEW — `/admin/routing-rules` + engine + RoutingRule/RoutingRuleVersion models (same applied migration).
- **Spec compliance:** durations Today/Tomorrow/This Week/Next Week/This Month/Next Month/Custom/**Permanent**; recipients single/multiple/team/**round-robin**/**weighted %** (validates to 100); scopes: all leads, Master convert, buyer converts, Revival promotions, imports, website/API intake, sources (canonical list), projects, countries, teams; **priority Manual > Date > Source > Team > Default** (manual paths never call the engine; UI encodes the rest via priority with auto-suggestions); **hidden entirely from non-admins**; **full audit: every mutation writes a version snapshot** (who/when/what, disable/revert, affected counts via assignedCount); **"Pause Automatic Assignment"** override — leads stay Unassigned for manual distribution, red banner + confirm; dashboard widget of active rules; **auto-expiry with no cron** (windows evaluated at assign time).
- **Wired at 5 choke points:** website/API/quick-add intake, reconciler orphan sweep, awaiting-team tagging, buyer convert (only the previously-blocked pool branch — manual always wins), CSV + Google-Sheet imports (only brand-new, unowned, workable rows — imports stay parked unless an admin makes an Imports rule).
- **Existing data:** zero impact — **with no rules defined, every path is byte-identical to the pre-existing default, proven against live prod data** (Dubai→Lalit; non-Tuesday India→Tanuj). **Future:** rule hits stamp `routingMethod="rule"` + reason "Rule: <name> → <Strategy> (<Agent>)" on the lead and the Assignment row.
- **Known delta (improvement):** awaiting-team tagging now respects leave-cover (previously skipped it).
- **Tests:** `routing-scheduler` invariant (engine, all 5 choke points, RBAC, version-trail + weighted-sum + provenance DATA arms); 29/29 build-time engine probes.
- **UAT owed (one item):** the round-robin/weighted WRITE path has never executed on prod (creating a live rule was out of bounds overnight). First use: create a rule Disabled → Enable → send one test lead → check the Assignment reason + counters.
- **Rollback:** disable/delete rules in the panel (soft, versioned) or Pause; zero rules = legacy behavior.

### A8. Force Logout admin feature — `5ea2b12` (Batch 5)
- **Module:** Admin → User Management (per Lalit's recommendation after the Yasir reset).
- **Fix:** per-user **Sessions** panel — every active session with device/browser/city/login/last-active (IST); log out ONE session; or **Force Logout — All Devices** = revoke all rows + epoch stamp (kills legacy cookies; password unchanged). Super Admin protected (only a super-admin can force-logout a super-admin); hr-only admins excluded; every action audited; self-logout redirects to /login.
- **Tests:** `force-logout-admin` invariant (epoch semantics, hash untouched, single-revoke never bumps epoch, ownership check, audit).

### A9. Bulk-action UI/permission alignment — `5ea2b12` (Batch 5)
- **Module:** Leads list.
- **Issue:** agents/managers saw bulk buttons (Follow-up, Reassign) that always 403'd server-side.
- **Fix:** row checkboxes + bulk buttons now render only for roles the server actually allows (your "10 bulk actions = Admin/Super-Admin only" rule). Per-row single-lead actions unchanged.

### A10. Revival calling-only + pagination · Master-Data Assign · Lost/Rejected ownership (earlier this window)
- All shipped and verified in prior batches: Revival = outreach only (meetings/visits/expos server-403'd + UI removed, convert-to-Lead unlocks them); Revival list = 50/page with the same pagination bar as Leads; Master Data Assign asks Status+Follow-up and reactivates before assign; Lost/Rejected auto-unassign + Previous Owner everywhere (manual/bulk/import/API).

---

## B. AWAITING DEPLOYMENT
None. Working tree is clean at `5ea2b12`; all completed work is live.

## C. TESTING
- **Passed:** 153/153 regression invariants; tsc 0 errors; production build green; health-check verified per deploy; presence/routing/force-logout probed against prod schema (read-only) at build time.
- **Failed then fixed during the gate:** 2 tsc errors (widget `as const` where-clause) — fixed; 3 invariant regexes (beacon privacy comment false-positive; 2 stale asserts predating the resolver indirection) — updated to assert the new chain end-to-end.
- **Not possible overnight (needs humans/devices):** browser UAT of the three new admin UIs; Mac/Safari device pass (your team, per your decision); routing RR/weighted first-write UAT (5-minute script above).

## D. DATA
- Backfills applied: A2 (with snapshots). Backups on disk: 4 pre-deploy snapshots + 2 backfill JSONs (latest `pre-deploy-2026-07-16T19-22-11` + Batch-5's).
- Needs YOUR review (not auto-fixed): 10 duplicate groups / 22 leads (`docs/reviews/duplicate-review-2026-07-16.md`); the Alok Gupta date sample.

## E. BLOCKED / PARKED (decision needed, unchanged tonight)
- **Task Manager** (built, flag OFF, migration staged) — paused by you.
- **All AI features** — frozen by you.
- **GitHub Actions crons** — intentional hold by you (nothing tonight depends on them).
- GS7 bulk-assign coordination · GS6b shared customer identity plan-go · CI meeting/site-visit backfill · Revival rule 5 (keep record after convert).

## F. LIMITATIONS / HONEST NOTES
- Presence "device count" counts distinct device+browser combos (3 tabs of one Chrome ≠ 3 devices).
- Heartbeats cost ~3 light queries/user/minute while a tab is visible — sized for the Neon Launch plan; visibility-aware to stop when tabs hide.
- A routing rule hit overwrites the team-classifier provenance fields on that lead (classifier detail survives in customFields + the Assignment row) — flag if you prefer append-only.
- Super-admin (your account) legacy cookies are exempt from the epoch kill BY DESIGN (lockout backstop).
