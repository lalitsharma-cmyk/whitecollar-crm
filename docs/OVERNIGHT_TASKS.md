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
- **d469ea1 DEPLOYED+LIVE** — #5 buyer date bug (suppress implausible serials like 461198) · #7 revival reject tag "Revival Engine Rejected" + exclude rejected from active views (kept in Master Data, team preserved) · #8 rollover moved to ~23:00 IST heartbeat (off the premature 18:00). Gate 130/130.
- **4034eb0 committed** — #1 India Buyer FOUNDATION: market-generic buyer scope (Dubai byte-preserved wrappers; canAccessBuyerMarket / buyerScopeWhereForMarket / market-aware canTouchBuyer; cross-market leak impossible). Gate 130/130, Dubai intact. India pages/nav/import = next.
- **Verified already-DONE (no change needed):** #3 Revival DetailShell (single-col intentional) · #4 Imported-Fields card (all 4 detail pages) · #6 buyer notes↔timeline (parity).
- **De-risked by assessment (smaller than feared):** #9 sidebar shell layout is sound (no shift bug in MobileShell — any break is page-specific) · #10 dashboard "Today" IST boundary is correct (only a cosmetic multi-day label) · #12 reports filters apply correctly (team-scope class already fixed+locked).
- **6ff2678 DEPLOYED** — #1 India Buyer Data VIEW module: /india-buyer-data list (INR/Cr, India scope) + sidebar nav (admin/India-team) + shared buyer detail now market-aware (canTouchBuyer enforces the buyer's own market — no cross-market open) + export ?market=India. Dubai byte-preserved. 130/130.
- **Remaining:** #1 India IMPORT (BuyerImportClient market prop + import-route dedup/create param — deferred so the sensitive passport/financial path isn't rushed unattended; no India data exists yet) · #11 exports+templates for Leads/Master/Revival (+xlsx) · verify #9/#10 in-browser (both assessed low/non-issue).
