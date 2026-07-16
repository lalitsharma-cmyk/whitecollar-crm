# 🗺️ Execution Roadmap — post-reconciliation
**2026-07-17 · prod `ca50aee` · sequenced by risk, dependency, and your decisions**

Rule of engagement (your standing order): work in parallel, park only decision-blocked items,
never drop prior work. Task Manager / AI / GitHub-crons stay paused. Every code change goes
through the gate (tsc → 155 invariants → build → backup → deploy → health-check).

---

## P0 — do first (security-adjacent + your explicit asks)
| # | Item | Why now | Agent(s) | Depends on | Effort | Rollback |
|---|---|---|---|---|---|---|
| 0.1 | ✅ **DONE** — privilege-escalation guard on user-mgmt + import/fail-open hardening | account-takeover hole | — | — | shipped `ca50aee` | revert commit |
| 0.2 | **M1 IDOR** — scope GET `/api/leads/[id]/ai/analyze` (+ ai/feedback) with `loadOwnedLead` | any agent reads any lead's AI analysis | 1 | ⚠️ touches an `/ai/` route → **needs your OK vs the AI-pause** (it's a security guard, not AI dev) | 15 min | revert |
| 0.3 | **D1 revival mass auto-return** (17 records, all Yasir) | disruptive data change awaiting your yes/no | main (script ready) | **your decision** | 1 run + verify | snapshot restore |

## P1 — high value, mostly unblocked
| # | Item | Why | Agent(s) | Depends on | Effort | Rollback |
|---|---|---|---|---|---|---|
| 1.1 | Dedup auto-merge/block on create+import + historical-phone backfill | your #1 trust blocker; detection ships, auto-action doesn't | 1 | **D3 decision** on merge policy | M | snapshot |
| 1.2 | createdAt / currentStatus round-trip on re-import | P1 data bug (re-import loses original date/status) | 1 | — | S | n/a (code) |
| 1.3 | Routing RR/weighted first-write UAT (5-min script: create disabled rule → enable → 1 test lead) | write-path never run on prod | main | — | 5 min | delete rule |
| 1.4 | Browser UAT: Presence, Routing, Force-Logout, Ghosting chips, Revival chips | 3 admin UIs + 2 feature surfaces never clicked | **you/your team** (W9) | live devices | manual | n/a |
| 1.5 | Credentials batch (unblocks dark features): AS Phone/Acefone, Meta/WhatsApp, VAPID re-enrol, blob storage | code-complete, waiting on secrets | you | **credentials** | you paste | n/a |
| 1.6 | Neon Launch-plan + Vercel plan confirm (D7) | free-tier pause already took site down once; presence adds light load | you | **decision/$** | you | n/a |

## P2 — correctness polish + parity gaps
| # | Item | Why | Agent(s) | Effort |
|---|---|---|---|---|
| 2.1 | Reports drill-through + count==records on OLDER /reports/* (sources, daily, ytd, leaderboard, sla, travel) + Dashboard By-Salesperson columns | Intake report is gold-standard; older pages lag | 2 (reports + dashboard) | M |
| 2.2 | Fix `smart=` export clauses (`visit_potential`/`ghosting`) to match /leads (`currentStatus`/CLOSING) — CSV≠screen today | export divergence (26 vs 0 proven) | 1 | S |
| 2.3 | Replace `updatedAt`-as-close-date with `bookingDoneAt`/`commissionReceivedAt` in daily/ytd/team-comparison | "closed in period" is really "row edited in period" | 1 | S |
| 2.4 | Duplicate activity-log dedup (360 rows) — guarded script + write-path debounce | inflates call metrics slightly | 1 | M (+**D3-style** review) |
| 2.5 | Revival parity: Voice Guidance (G1) + Escalation thread (G2) on revival detail | not AI — Channel-① voice | 1 | M |
| 2.6 | Propagate the modal text-selection fix to the ~8-9 remaining modals | inconsistent UX | 1 | S |
| 2.7 | Unified-Detail: extract the 5 duplicated card pairs into DetailShell | drift risk | 1 | M |
| 2.8 | Git hygiene: delete 27 merged + 8 agent branches; archive 4 superseded; cherry-pick the actor-owner regression test | clutter | main (after tree clean) | S |

## P3 — later / low
India-Buyer import path · India-Buyer performance report · buyer terminal-rule follow-up-clear
(schema, **decision**) · 27 Won/Closed unowned re-attribution (**decision**) · reports/sources
drill-through · other-sites deploys (Academy, Expo, Westin, mobile-LCP) · War Fear (**D8**) ·
GS16 re-triage (**D6**).

## Parked (your holds — untouched)
Task Manager (built, flag OFF, migration unapplied) · ALL AI (frozen) · GitHub-Actions crons
(intentional hold) · Dev Sandbox (needs provisioning) · complete-logging Phase 3 (**D9**).

---

## Suggested parallel-agent wave (when you say go)
- **Wave A (P0/P1 unblocked):** Agent-1 dedup engine (1.1, after D3) · Agent-2 re-import round-trip (1.2) · main runs routing UAT (1.3) + revival returns (0.3 after D1).
- **Wave B (P2 reports):** Agent-3 older-reports drill-through (2.1) · Agent-4 export/close-date fixes (2.2/2.3) — file-disjoint.
- **Wave C (P2 UX/parity):** Agent-5 revival voice (2.5) · Agent-6 modal sweep (2.6) · Agent-7 DetailShell cards (2.7).
Each wave gates + ships independently; git hygiene (2.8) runs last on a clean tree.

## Deploy & rollback discipline (unchanged)
Every batch: backup snapshot first · idempotent migrations (schema leads code) · code deploys
AFTER migration · health-check commit==HEAD · data changes get a JSON snapshot + before/after
counts + your approval when ambiguous. Rollback = revert commit and/or restore snapshot.
