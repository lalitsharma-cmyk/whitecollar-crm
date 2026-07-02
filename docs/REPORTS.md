# CRM Reports Reference

> Every report in the CRM: its URL, what it shows, its filters, and who can see it.
> All report pages live under `/reports/**` (sales) with one HR report at
> `/hr/reports`.

## Who sees what (applies to every report)

- **Admin** — sees everything; can switch team (All / Dubai / India) where a team
  filter exists.
- **Manager** — locked to their own team. Every query is filtered to their team
  (`forwardedTeam`); a Dubai manager cannot see India data and vice-versa.
- **Agent** — for **team-level** reports (sources, cooling, team comparison, YTD,
  travel, SLA, commission, changes, leaderboard, follow-up compliance): **no
  access** (redirected). For **personal** reports (agent performance, daily,
  fresh-leads, buyer performance): allowed, but scoped to **their own rows only**.

Money is never mixed across markets — Dubai (AED) and India (INR) are always shown
in separate columns. Soft-deleted/recycled leads are excluded everywhere. Most
reports share a date-range picker (`?from=&to=`).

Shared building blocks (engineer note): `src/lib/leadScope.ts` (canonical
counting/scoping), `src/lib/buyerScope.ts`, `src/lib/freshLeads.ts` (fresh-lead
definitions), and `buildAgentReport` / `buildBuyerReport` — which power both the
on-screen tables **and** their exports, so the two always match.

## Report index

`/reports` — the reports home page. Shows an executive strip (weighted revenue
forecast split AED/INR, biggest funnel leak %, stalled deals + money tied up), a
status funnel with conversion %, source/medium/property-type charts, a best-time-
to-call heatmap (day × hour, last 30 days, coloured by connect rate), a top-projects
table, and the navigation grid of all the report cards below. Team selector is
interactive for admin, locked for manager, hidden for agent. Agents see a reduced
index (only Daily + My Performance).

## Sales reports

| Report | URL | What it shows | Filters | Agent access |
|---|---|---|---|---|
| **Agent Performance** | `/reports/agent-performance` | Per-agent table (~31 columns): assignment, outcomes, engagement (calls/WhatsApp/notes), meetings, site visits, and derived rates (connect %, conversion %, follow-up compliance %) + funnel + rankings | Time-range presets or custom `from`/`to`; team selector (admin) | Own single-row view |
| ↳ Agent detail | `/reports/agent-performance/[agentId]` | One agent's headline ratios + the 6 metric groups, each drillable | Time range | Own only |
| ↳ Metric drill | `/reports/agent-performance/[agentId]/drill` | Up to 500 lead rows behind a chosen metric (reconciles 1:1 with the count) | `metric=…` + range | Own only |
| **Dubai Buyer Performance** | `/reports/buyer-performance` | Buyer-pool health + per-agent table (assigned, converted, rejected, auto/manual returned, calls, attempts) + funnel + rankings | Range presets + custom | Own row (Dubai only) |
| ↳ Buyer-agent detail | `/reports/buyer-performance/[agentId]` | One buyer-agent's ratios + assignment/outcomes/activity/funnel | Range | Own only |
| ↳ Buyer drill | `/reports/buyer-performance/[agentId]/drill` | Up to 500 buyer records behind a metric (transfer history, return reasons, converted-lead link) | `metric=…` + range | Own only |
| **Leaderboard** | `/reports/leaderboard` | One row per agent: rank, calls (90d), active leads, qualified, won, conversion % | None (fixed 90-day window) | No access |
| **Fresh-Lead Response** | `/reports/fresh-leads` | 4 tiles (assigned today, first contact done + %, still untouched, backlog untouched) + per-agent table sorted worst-first | Team selector (admin) | Own only |
| **Daily Report** | `/reports/daily` | Target vs Achieved vs Pending for the day (calls, connects, meetings, fresh clients, deals, closing value AED/INR) + follow-up workflow table. **PDF export.** | Date `?date=`, agent `?agent=` | Always self |
| **Follow-up Compliance** | `/reports/followup-compliance` | Tiles (overdue, due today, chronically rolled ≥3×) + per-agent table with drill links | Team toggle (admin) | No access |
| **Lead Sources** | `/reports/sources` | Source / Medium / Property-Type funnels (total → contacted → qualified → booked → lost, with rates, first-call latency, avg AI score) | Date range | No access |
| **Activity Feed** | `/reports/activity` | Per-agent feed of call entries + audit entries (latest 100 calls + 50 audits) | Date `?date=` | No access |
| **Cooling Leads** | `/reports/cooling` | Leads that dropped HOT→WARM/COLD: count, budget at risk, table (was hot, now, days since drop, last touched) | Date range (default 14d) | No access |
| **Team Comparison** | `/reports/team-comparison` | Dubai vs India head-to-head (new/active leads, calls, connect rate, response time, meetings, site visits, bookings, pipeline, revivals, AI score) + weighted winner banner | Date range (default 30d) | No access |
| **Year-to-Date** | `/reports/ytd` | Per-team YTD (leads, bookings, won, connect rate, commission) + received box + top-5 sources + top-5 agents | Date range (default Jan 1 → today) | No access |
| **Travel Reimbursement** | `/reports/travel` | Per-agent trips, total km, reimbursement (INR) for two periods; current ₹/km rate shown | Date range, agent | No access |
| **SLA & Meetings** | `/reports/sla` | By-type cards (site visit / office / virtual — scheduled, completed, rescheduled, no-show) + per-agent table | Date range, agent | No access |
| **Commission & Earnings** | `/reports/commission` | Commission booked/received/outstanding (AED+INR), status cards, per-agent table, latest-50 bookings | Date range | No access |
| **Change Report** | `/reports/changes` | Field-level audit (when, user, lead, field, old→new, via) + per-user change counts | `?period=today\|week\|month`, user | No access |

## HR report (separate HR workspace)

`/hr/reports` — recruitment funnel (applied → interviewed → offered → joined + %),
time-to-hire, offers/joining snapshot, recruiter performance table, source
performance, pipeline by status. Filter: `?period=today|7d|30d|month|all` (default
30d). Access is via HR permission (e.g. Nisha), not the sales roles.

## Export routes

| Export | Route | Formats | Gating |
|---|---|---|---|
| Leads / Revival / Calls / Master | `GET`+`POST /api/reports/export` | CSV / XLSX (`?format=xlsx`); `?type=leads\|revival\|calls\|master`; POST `{leadIds}` for exact rows | **ADMIN only** (agents 403) |
| Daily report PDF | `GET /api/reports/daily/pdf` | PDF | **ADMIN + MANAGER**; manager blocked from cross-team `?agent=` |
| Dubai buyer performance | `GET /api/reports/buyer-performance/export` | CSV / XLSX | **ADMIN only** |
| Agent performance | `GET /api/reports/agent-performance/export` | CSV / XLSX | **ADMIN only** |
| Call logs | `GET /api/call-logs/export` | CSV | Any signed-in user, but **row-scoped** (agent = own, manager = team, admin = all) |
| HR candidates | `GET /api/hr/candidates/export` | CSV | **HR permission** (`exportData`), rows HR-scoped |

Every `/reports/*` export file is watermarked with the downloader's email/name,
timestamp (IST), and the filters used.
