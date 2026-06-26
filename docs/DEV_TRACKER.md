# WCR CRM — Master Development Tracker

**Single source of truth for the overnight stabilization run.**
_Last updated: 2026-06-27 (overnight)_

## Process (locked 2026-06-27, Lalit)
- **Phase A — Stabilization**: voice, Smart Timeline, Rejected-Lead, Buyer module, UI bugs, prod issues, regression. Fix → verify → deploy.
- **Phase B — Freeze** when regression green. **Phase C — New Ideas** only after Pending = 0.
- **Deploys + data migrations funnel through the orchestrator ONLY** (serial, backup → tsc → regression → deploy → health). Agents discover/analyze; orchestrator fixes + deploys. Destructive/data-risky steps get a backup first.

Status legend: ✅ Completed · 🟡 In Progress · 🔵 In QA · 🚀 Deployed · 🔴 Blocked · ⏳ Remaining

---

## 🚀 DEPLOYED tonight
- **Buyer Conversation History (P0)** — imported "Conversation History" column now drives the buyer timeline (438 buyers backfilled, backed up). `1925491`
- **Buyer re-import idempotency (P0)** — re-import no longer double-creates timeline rows; status keys de-duped from Imported Fields. `de254ea`
- _(earlier this cycle)_ Voice Channel ① + mic pin · Smart Timeline P0 (no torn client msgs) · Smart Timeline declutter · Permission hardening.

## 🟡 IN PROGRESS
- **Rejected-Lead workflow** — schema `previousOwnerId` added + migration applied to prod. PENDING: reject route (unassign + previousOwnerId + double-reject guard), reactivate route (clear rejection + reset currentStatus — fixes latent bug where it only flips legacy `status`), Lead-view REJECTED badge + Previous-Owner + disable-actions, existing-rejected-leads migration (backup-first), regression.

## ⏳ REMAINING — AUDIT BACKLOG (from 3 parallel agents, 2026-06-27)

### Buyer module (Agent 1) — highest priority
- 🔴 P1 `convert/route.ts` — (a) re-convert guard should key on `poolStatus===CONVERTED` alone (null `convertedLeadId` slips → duplicate lead) `:49`; (b) admin converting a POOL buyer falls back to self as owner + `team=null` `:56`; (c) manager can convert/reject others' buyers via `canTouchBuyer` (wider than the UI's admin-or-owning-agent) — tighten routes to match; (d) currency/team inferred from nationality not `buyer.market` → Dubai buyer can land INR/India `:76-79`.
- 🔴 P1 `BuyerActionsClient.tsx:123` — Voice button posts type `NOTE` not `VOICE_NOTE` (mislabels voice notes).
- 🔵 P2 `BuyerActivityTimeline.tsx:71-82` — Smart tab doesn't refetch after inline remark edit (Raw vs Smart stale until reload).
- 🔵 P2 import `findExistingBuyer` dedup not market-scoped (latent until a 2nd market exists).
- 🔵 P2 `BuyerActionsClient` Voice button shown even without Speech API; P2 list/detail Region label off nationality not market.

### Reconciliation (Agent 2) — count==drill bugs (no P0; permissions solid)
- 🔴 P1 `reports/page.tsx:286,334` — funnel "Closing→Booked" leak ALWAYS 0% (4 counts, only 3 destructured; self-compare). Fix `const [tot,contacted,qualified,booked]=funnel`.
- 🔴 P1 `dashboard/page.tsx:695` — "Future Activities" drill links `?followup=upcoming` which leads page doesn't handle → shows all. Use `?followup=future`.
- 🔴 P1 `agentPerformance.ts:766` — `freshAssigned` drill uses 6-value local list vs `isFreshStatus` 8 → count>drill. Use `FRESH_STATUS_IN_VALUES`.
- 🔴 P1 `dashboard/page.tsx:194-201` — "Cold revival" tile structurally ~0 (meScope excludes COLD + `isColdCall:true` contradiction). Count over a cold scope.
- 🔵 P2 `activities/page.tsx:110-245` — Action Board doesn't exclude COLD_ORIGINS + uses SUPPRESSED not TERMINAL statuses (diverges from unified board). Spread `activeBoardWhere`.
- 🔵 P2 `leads/page.tsx:24-36` — `srcChip/srcLabel` cover 15 of ~30 LeadSource enum → blank chips; add `?? "Other"` fallback.

### UI/UX (Agent 3) — verdict: good/disciplined; globals.css dark net catches most
- 🔵 P2 **High-leverage**: extend `globals.css` dark net to cover `bg-slate-50/100`, `text-gray-300`, `divide-[#e5e7eb]` → fixes ~10 gaps in ONE place (ConversationStreamCard, GlobalCalendarPanel/DateFilter, AIComparisonWorkspace, LeadsListClient placeholders, reports heatmap, table dividers).
- 🔵 P3 misc: BuyerInlineEdit amber edit-border dark variant; profile notice block; LeadBulkActions destructive-button token.

### Phase-A leftovers
- ⏳ Default Smart Timeline tab (Buyer/Revival) · ⏳ Login/Logout check-in-before-logout · ⏳ Lead-View compact redesign.

### Pending committed features (after Freeze)
- ⏳ Voice Channel ② escalation · Buyer Phase-2 (classification/portfolio/country/remove-source/unified-import #244-249) · Reporting v2 #250 · Connected-chip #251.

## 🔴 BLOCKED / DECISIONS
- "Overdue" boundary `<now()` vs `<startOfTodayIST` (M4) · phone-mask + Won-metric (#253).
