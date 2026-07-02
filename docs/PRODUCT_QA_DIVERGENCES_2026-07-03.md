# Product QA — Requirement vs Live Product (2026-07-03)

Governing rule for this pass: **the requirement wins.** Every item below compares the
live product against Lalit's stated requirements (60-day memory), not against the code.
Six audit agents (+ a product sub-fleet) ran read-only; findings triaged into **Fixed /
Documented / Needs-decision**. Prod @ `4c73f11`.

**Large areas verified CLEAN (requirement == product):** market segregation & no cross-market
passport/financial leak · currency never mixed/converted · Won/Closed boundary (activity
routes never close a lead) · rejected-lead 8-point workflow · assignment + leave-cover ·
count-unification (one `activeLeadWhere`) · actor-vs-owner rendering · import mapping/dedup ·
DetailShell + layout tokens + Returning-Client card shared · India↔Dubai buyer list/import/
export/assign/convert parity.

---

## A. FIXED & DEPLOYED this session (requirement now matches product)

| # | Requirement | Was diverging | Fixed in |
|---|-------------|---------------|----------|
| A1 | Recording must appear in Lead/Revival timeline; provider URL never exposed | Lead path used a raw `<audio src=providerUrl>` (leak + scope bypass) | `ConversationStreamCard` → scope-proxy player |
| A2 | Telephony secure | Recording proxy was an open SSRF (webhook-supplied URL) | host allow/blocklist + redirect validation |
| A3 | Telephony secure | Webhook was fail-OPEN before credentials (open CallLog writer) | fail-CLOSED when no secret/token |
| A4 | Recording appears in Lead timeline | Agent-unmatched telephony calls were filtered OUT of the Lead timeline | filter keys on `ivrProvider` |
| A5 | Call auto-links to the right Lead by phone | Composite phone+email fingerprint missed every email-bearing lead | phone-digit match |
| A6 | Both-markets: India buyer fully workable | Shared buyer detail hardcoded the Dubai agent roster + "Back to Dubai" → India buyers un-reassignable | roster + link derive from `rec.market` |
| A7 | Both-markets messaging | Buyer assign/transfer notifications hardcoded "Dubai Buyer Data" | market-dynamic text + link |
| A8 | Convert to Lead = ZERO data loss | Buyer→Lead Convert orphaned the entire BuyerActivity timeline (calls/notes/attempts) | copies timeline + re-links CallLogs |
| A9 | Promoted cold lead shows in active metrics | `promote-cold` didn't flip `leadOrigin` → invisible to Leads/Dashboard/Reports | sets `leadOrigin=ACTIVE_LEAD` |
| A10 | Actor = performer, never owner | Workflow auto-sent WA/Email credited the owner | → System (`userId: null`) |
| A11 | Property names correct | "DLF The Camellias" rendered "Dlf The Camellias" | developer-acronym preservation |
| A12 | Dark mode consistent | Lead needs-manager/duplicate/SLA + Revival cold banners were light-only | dark variants |
| A13 | AI explainable + confident (mock) | Bare flag-list explanations, no confidence/grounding | confidence-annotated, KB-grounded, urgency-ordered + 73 tests |

## B. DOCUMENTED (real but low-priority / cosmetic — recorded, safe to defer)

| # | Requirement | Divergence | Note |
|---|-------------|-----------|------|
| B1 | Zero-drift tokens | Lead detail hardcodes `card p-4` instead of the `CARD` token it authored (Buyer uses the token) | future token change won't reach Lead; mechanical swap, deferred with the consolidation (C1) |
| B2 | Zero-drift tokens | Cold detail re-types `COLD_BADGE` + uses `p-5` header vs shared `p-4` | cosmetic drift |
| B3 | India parity | Shared buyer detail country dropdown is UAE-first even for India buyers | order by market |
| B4 | Consistency | Empty-state wording varies ("No leads match…" vs "No matching records.") | tone only; every list HAS a state |
| B5 | Read-only cold detail | `ConversationStreamCard` `context` prop defined but unused (cold edit gated by `isAdmin` only) | no functional leak today |
| B6 | Single source of truth | Dashboard/agent-perf keep local copies of status predicates | drift risk if TERMINAL_STATUSES changes |
| B7 | Export hygiene | `call-logs`/HR exports are CSV-only, no watermark | see C6 for the access question |
| B8 | Cron security | Every `/api/cron/*` except `db-backup` skips the CRON_SECRET check when the env var is unset | ensure `CRON_SECRET` always set in prod |

## C. NEEDS YOUR DECISION (genuine requirement gaps that are large, risky, or change behaviour)

| # | Requirement | Gap | Why it's your call |
|---|-------------|-----|--------------------|
| C1 | Unified Lead Detail "each card exists ONCE, reused everywhere; zero drift" | Conversation timeline, Quick Note, Client Info, Notes, Actions are **per-module duplicates** (Buyer* vs Lead versions). Shell/tokens/Returning-Client ARE shared. | Consolidating 5 card pairs is a large refactor on a live CRM — needs a phased plan + approval, not an autonomous rewrite. |
| C2 | Conversation = source of truth (auto-create Meeting/Site-Visit records) | Only render-time classification today — **no Activity records, no live hook, no Needs-Review queue, no backfill.** | This is the pending **CI-BACKFILL** feature — a real build. Approve to start. |
| C3 | Global Identity Resolution (every new record checks the whole CRM; cross-module) | Built-but-dormant, **Lead-only**: not live on ingest, buyer-convert bypasses it, no cross-module `CustomerMember`, no unlink UI. | Phase E, explicitly owner-gated (5 open decisions). Approve to go live. |
| C4 | Both-markets rule (every feature supports India+UAE) | **India Buyer Performance report is missing** (`/reports/buyer-performance` is Dubai-only). | Buildable in ~1 pass — **want me to build it?** |
| C5 | Both-markets rule | **AI buyer distribution is hardcoded to Dubai** (`buyerDistribution.ts`) — India buyers can't be auto-distributed. | Buildable (generalize like buyerScope) — **want me to?** |
| C6 | "Agents cannot export" (role-audit rule) | `call-logs/export` lets an AGENT export own logs / MANAGER team logs — a scoped exfil surface. | Lock to ADMIN (matches the rule) **or** ratify the scoped exception — your call before I remove agent access. |
| C7 | Sale Off / Lease Off "first-class modules" | They're status-**views** over Lead (detail IS unified; excluded from identity search). | Keep as views (lower-lift) or promote to distinct modules? |
| C8 | Brand logo — exact asset only | Collapsed sidebar shows a hand-built "WCR" text monogram. | Use a crop of the real logo mark? (needs the asset) |

---

**Bottom line.** Everything in **A** is fixed, deployed, and gate-verified (tsc 0 ·
telephony 40 · AI 113 · regression 131 · build green). **B** is logged and safe to defer.
**C** is where your product intention and the live build still differ in ways only you
should resolve — most are either large refactors (C1–C3), quick parity builds awaiting your
go-ahead (C4–C5), or behaviour/brand calls (C6–C8).
