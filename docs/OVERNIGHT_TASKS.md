# WCR CRM — Task Inventory & Overnight Execution (2026-07-02 night)

Legend: ✅ DONE/DEPLOYED · 🟡 PARTIAL · ⬜ NOT DONE · ⛔ BLOCKED · 🧪 TESTED

## A. Shipped in the last ~20 days (all DEPLOYED to prod) — 367 commits
| Area | Status |
|---|---|
| Market/Team segregation (Phase A/B, market-at-source, currency displayBudget) | ✅ DEPLOYED |
| Unified DetailShell (Lead · Buyer · Cold/Revival) + layout tokens | ✅ DEPLOYED |
| Customer Identity (Customer-360, Returning-Client card, Resolution Center) | ✅ DEPLOYED |
| Buyer Data module + lifecycle (pool→assign→convert/reject, B1–B3 parity, Developer field) | ✅ DEPLOYED |
| Revival Engine (Leads parity, India/Dubai split, UI cleanup, Needs-Review chip) | ✅ DEPLOYED |
| Sale Off / Lease Off modules | ✅ DEPLOYED |
| Fresh-Lead system + priority visibility | ✅ DEPLOYED |
| Actor-vs-Owner timeline + reconcile | ✅ DEPLOYED |
| Follow-up automation (FU-4 badge, rollover, Compliance report) | ✅ DEPLOYED |
| Leave-cover engine + Team-page UI | ✅ DEPLOYED |
| HR ATS (RBAC, dashboard, import, reports) | ✅ DEPLOYED |
| Voice subsystem (broadcast · guidance · escalation) | ✅ DEPLOYED |
| Production stabilization (responsive grids, a11y, loading skeletons, error/404 boundaries) | ✅ DEPLOYED |
| v1.0 readiness audit + 3 cross-team report leaks fixed + regression invariant (130) | ✅ DEPLOYED |
| Cron reliability (heartbeat dispatcher on /api/cron/warm) | 🟡 PARTIAL (GH-Actions crons dormant; heartbeat is the workaround) |
| AI Sales OS (M0–M7, 104 tests) | ✅ BUILT · isolated `ai-sales-os-v2` · **NOT deployed (separate milestone)** |

## B. The 12 pending items (this overnight run) — status refined by live assessment
| # | Item | Status | Task |
|---|---|---|---|
| 1 | India Buyer Data module (INR/Cr, sidebar, import/export/template) | ⬜ NOT DONE | #29 |
| 2 | Buyer common rules for BOTH Dubai + India (existing + future) | 🟡 PARTIAL | #30 |
| 3 | Revival detail uses common DetailShell | ✅ DONE — verifying parity | #31 |
| 4 | Imported/unmapped-fields card (Leads/Buyer/Revival/Master) | 🟡 PARTIAL | #32 |
| 5 | Buyer date bug — Excel serial `461198` shown raw | ⬜ NOT DONE | #33 |
| 6 | Buyer notes ↔ Conversation History / Smart Timeline | 🟡 PARTIAL | #34 |
| 7 | Revival rejected → tag + Master Data + team preserve + filter | 🟡 PARTIAL | #35 |
| 8 | Follow-up rollover cron @ 23:30 IST (assigned, overdue→next day) | 🟡 PARTIAL (runs ~18:00) | #36 |
| 9 | Sidebar collapse/expand layout bug (CRM-wide) | ⬜ NOT DONE | #37 |
| 10 | Dashboard "Today" filter shows actual today (IST) only | ⬜ NOT DONE | #38 |
| 11 | Import/export (CSV+Excel) + templates for all 5 modules | 🟡 PARTIAL | #39 |
| 12 | Full reports audit (filters/columns/date/team/user/status) | 🟡 PARTIAL (team-scope class fixed+locked) | #40 |

## C. Execution order (safety + value + independence)
1. Contained bug fixes first: #5 date bug · #10 dashboard Today · #9 sidebar collapse.
2. Logic: #7 revival rejected · #8 rollover cron.
3. Structural: #4 imported-fields card · #6 notes↔timeline · #3 verify.
4. Big builds: #1 India Buyer module (shares Dubai components) · #11 import/export/templates.
5. Audit sweep: #12 reports.
Every change: tsc + regression (130) + build → deploy → smoke. Never touch rejected/closed/deleted data destructively; existing + future both fixed.

_Blockers, deploys, and test results appended below as the loop runs._

## D. Run log
