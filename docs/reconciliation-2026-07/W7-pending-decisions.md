# Workstream 11 — Pending Decisions (for Lalit)

Plain-language decisions only. Engineering bugs live in the QA/Security/Data reports.
Intentionally-paused items are listed **separately at the bottom** — those need no decision
unless you want to un-pause them.

Legend: **Risk of waiting** = what it costs to leave it. **Default safe behavior** = what the
CRM does today if you never decide.

---

## D1 — Revival auto-return: apply the historical sweep, or future-only?
- **What:** The new rule "a Revival record with 5 no-response attempts returns to the Admin queue" is live for *future* calls. Should we also run it retroactively on records that ALREADY have 5+ unanswered attempts in their call history?
- **Why needed:** The backfill can mass-unassign records out of agents' Revival queues tonight. That could be dozens/hundreds moving at once.
- **Options:** (A) Backfill counts only, do NOT auto-return historically (agents keep their current records; rule applies going forward). (B) Full historical auto-return (clean slate — every stale record goes back to your pool now). (C) Backfill counts, show you the exact list of would-be-returned records, you approve in batches.
- **Recommended:** **C.** You see the scale and the names before anything moves; nothing disruptive happens unattended.
- **Risk of waiting:** Low. Counts still populate; only the retroactive returns wait.
- **Default safe behavior:** Counts backfill; historical auto-returns are HELD until you pick.

## D2 — Ghosting historical backfill scope
- **What:** Tag 👻 Ghosting on existing Normal Leads that already show 10+ unanswered attempts by their current owner.
- **Why needed:** It's a read-only tag (never changes status/owner), so it's low-risk — but it will suddenly surface a number of leads as "ghosting" that agents haven't seen flagged before.
- **Options:** (A) Backfill now (recommended — it's just a label, fully reversible by clearing ghostingAt). (B) Future-only.
- **Recommended:** **A** — safe, reversible, and immediately useful for spotting dead leads.
- **Risk of waiting:** Low. The tag simply won't appear on old leads until you say go.
- **Default safe behavior:** Future-only until you approve the backfill.

## D3 — The 10 duplicate customer groups (22 leads)
- **What:** 10 groups of leads that share a phone or email (exported to `docs/reviews/duplicate-review-2026-07-16.md`). These predate the new dedup engine.
- **Why needed:** Merging customer records is irreversible and business-sensitive (wrong merge = lost history). It must not be automated.
- **Options:** (A) You review the list and link/merge via the Customer Identity Center. (B) Leave them — the new engine prevents *new* duplicates; old ones stay as-is. (C) I prepare a per-group recommendation (which is the "primary" record) for your one-click approval.
- **Recommended:** **C**, then you decide per group.
- **Risk of waiting:** Low — they're stable, not growing.
- **Default safe behavior:** Untouched.

## D4 — One flagged backfill date: "Alok Gupta"
- **What:** The created-date backfill moved one lead from 2023-12-22 → 2026-06-20 because the sheet's date column said 2026. Reversible from snapshot.
- **Options:** (A) Keep (trust the sheet). (B) Revert this one row to 2023.
- **Recommended:** (A) unless you know that client is genuinely from 2023.
- **Risk of waiting:** Negligible (one row).
- **Default safe behavior:** Kept as 2026.

## D5 — Lost/Rejected leads still holding an owner (count from data audit, pending)
- **What:** The data-integrity audit is counting leads that are Lost/Rejected but still assigned to an agent (the rule says these should be unassigned). If the count is non-trivial, we run the existing idempotent unassign heal.
- **Why needed:** It's rule-compliance on *existing* data; the heal is known-safe but touches ownership, so per production-safety it wants your nod.
- **Options:** (A) Run the heal (unassign + stamp Previous Owner + clear follow-up — the standard Lost/Rejected behavior, reversible via OperationLog). (B) Leave historical rows, rule applies going forward.
- **Recommended:** **A** — it's the same safe transform already shipped for new data, just applied to the backlog, with a snapshot.
- **Risk of waiting:** Medium — reports slightly overcount agents' active load until healed.
- **Default safe behavior:** Not run until approved (final count comes from the W4 data report).

## D6 — GS16 "deferred production-safe fixes (2nd batch)"
- **What:** An old backlog task from ~2 weeks ago that predates ~12 days of shipped work. Its contents may already be done.
- **Options:** (A) I re-triage it against current main and close what's already shipped, surfacing only what genuinely remains. (B) Delete it as stale.
- **Recommended:** **A** — cheap, and avoids losing a real item.
- **Risk of waiting:** Low.
- **Default safe behavior:** Sits as pending until re-triaged.

## D8 — "War Fear" is BOTH a reject reason AND a workable status (contradiction)
- **What:** A standing memory rule says "War Fear = a workable status, not a rejection." But in code today it exists in **both** places: `reject-reasons.ts` lists `WAR_FEAR` as an active reject reason, AND `lead-statuses.ts` lists "War Fear" as a workable/active status. A stash from ~3 weeks ago (never shipped) tried to retire it from the reject list.
- **Why needed:** If it's a reject reason, choosing it unassigns the lead (terminal). If it's a workable status, the agent keeps working it. Right now both paths exist — a real inconsistency.
- **Options:** (A) Keep it as a workable status only — remove `WAR_FEAR` from the reject reasons (matches your standing rule; apply the parked stash's intent). (B) Keep it as a reject reason only. (C) Leave both (status quo — confusing).
- **Recommended:** **A**, per your own earlier rule — but it changes reject behavior, so it's your call, not an auto-fix.
- **Risk of waiting:** Low-Medium — agents may reject clients they should keep working.
- **Default safe behavior:** Unchanged (both exist) until you decide.

## D9 — "Complete rolls follow-up +1 / no follow-up in Log-Call" — is it live or parked?
- **What:** The branch `pending/complete-logging-followup` (the behavior where "Complete" rolls the follow-up forward a day and Log-Call no longer sets a follow-up) is **merged into production code**, but a memory note still calls it "parked, awaiting approval." Git and the note disagree; no feature flag gates it (it appears live).
- **Why needed:** You should know whether this behavior is actually running for agents right now (it looks like it is).
- **Options:** (A) Confirm it's intended and I update the stale note (recommended if the current behavior is what you want). (B) If you did NOT approve it, we gate or revert it.
- **Recommended:** **A** — the behavior matches your follow-up policy (auto-rollover of overdue), so it's almost certainly intended; just reconciling the note.
- **Risk of waiting:** Low.
- **Default safe behavior:** Stays live.

## D7 — Vercel plan / Neon plan headroom (infrastructure)
- **What:** Prod runs on Vercel + Neon. There was a billing-pause outage earlier, and the new presence heartbeats add lightweight recurring load.
- **Why needed:** Presence sends ~1 heartbeat/user/minute while a tab is open. Fine on a paid Neon plan; worth confirming you're not on the free tier that paused before.
- **Options:** (A) Confirm/upgrade to paid tiers (recommended). (B) Reduce heartbeat frequency / gate presence to fewer users.
- **Recommended:** **A** — the feature is sized for a paid plan; the outage you already hit was billing, not code.
- **Risk of waiting:** Medium — another quota pause would take the site down again.
- **Default safe behavior:** Heartbeats are visibility-aware (stop when tabs are hidden) to minimize load.

---

## INTENTIONALLY PAUSED — no decision needed unless you want to resume
These are **not** blocked or forgotten. You paused them on purpose; they stay frozen.
- **Task Manager module** — fully built, feature flag OFF, 13-table migration NOT applied. Resume = apply migration + flip flag + UAT.
- **All AI features** (Summary, Buyer Intelligence, Buying-Signals, Follow-up AI, AI Sales OS) — frozen by your hard-pause rule; existing AI code untouched.
- **GitHub Actions / cron jobs** — deliberately disabled; nothing is built to depend on them. Not a bug.
- **GS7** (bulk-assign on Awaiting-Team), **GS6b** (shared customer identity backfill), **CI meeting/site-visit conversation backfill**, **Revival rule 5** (keep record after convert) — parked awaiting your go.
