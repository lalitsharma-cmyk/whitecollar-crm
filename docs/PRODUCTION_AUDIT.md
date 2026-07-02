# Production Audit Report — WCR CRM

Living document for the Production Stabilization Phase. Findings from continuous
read-only audits (a11y/console, responsive/spacing, loading/empty, performance) +
deterministic data-integrity monitoring. Severities are **re-triaged to real production
impact** (audit agents tend to over-rate — a `key={index}` on an append-only list is not
a bug; a cramped mobile grid is not "Critical").

Status legend: ✅ Fixed & deployed · 🔜 Batched (Medium, prepared) · ⏸️ Deferred/monitor · ✓ Verified-safe (no action needed)

---

## Cycle 1 — 2026-07-02

### Data-integrity baseline (monitoring)
| Check | Result |
|---|---|
| Regression invariants | ✅ **129 / 129** |
| Team-without-market gap | ✅ **0** (write-at-source fix holding; no new drift) |
| Duplicate groups (live, unlinked) | 1 — "Mr. MD Ehsan" (same phone; review-list exported, `/admin/identity` link available) |
| Live leads | 980 (93 legitimately team-less → market not derivable, expected) |
| Double-submit vulnerabilities | ✓ **0** — codebase uniformly guards with `busy`/`disabled`/`phase` |

### 🔴 Critical — production at risk
**None.** No data-loss, security, crash, or corruption paths found.

### 🟠 High — real but not stability-threatening (performance / slow-network UX)
| # | Area | file:line | Impact | Status |
|---|---|---|---|---|
| H1 | Over-fetch: lead detail pulls ~340 relation rows/view (take 50–100 + full includes) | `leads/[id]/page.tsx:128–167` | ~150–250 KB + 50–80 ms/view | 🔜 Medium batch (verify fields still used) |
| H2 | Over-fetch: cold-calls fetches 20 callLogs × 200 rows | `cold-calls/page.tsx:201–209` | ~300 KB/render | 🔜 Medium batch (verify badge logic) |
| H3 | Over-fetch: reports triple-nested `include: units→interestedBy→lead` (full Lead rows discarded) | `reports/page.tsx:154–158` | 180–600 Lead rows/render | 🔜 Medium batch |
| H4 | 9 hot routes missing `loading.tsx` (blank screen on slow net) | leads, cold-calls, buyer-data, action-list, gallery, activities, ai, call-logs, hr/candidates | UX on 3G | 🔜 Medium batch (additive skeletons) |

### 🟡 Medium — prepared / batched
| # | Area | file:line | Fix | Status |
|---|---|---|---|---|
| M1 | Cold-calls: 55 per-status `count()` queries | `cold-calls/page.tsx:246–248` | single `groupBy` | 🔜 batch (safe, clear win) |
| M2 | Lead detail: sequential awaits (returning-client / customerHistory / dupIntent / voice / escalation) | `leads/[id]/page.tsx:175–282` | `Promise.all` batching | 🔜 batch |
| M3 | LeadsListClient: 50-row table re-renders on every selection/sort | `LeadsListClient.tsx:775–972` | memoize row | ⏸️ verify (larger change) |
| M4 | Tab semantics: LeadMobileTabs uses `aria-pressed`, not `role="tab"` | `LeadMobileTabs.tsx:65–78` | `role=tablist/tab + aria-selected` | 🔜 batch |
| M5 | Empty states unverified on secondary pages | notifications, team, master-data | confirm/add "no records" | 🔜 verify |

### 🟢 Low — auto-fixed (safe) or queued
| # | Area | Status |
|---|---|---|
| L1 | Icon-only `aria-label`: NotifBell bell, MobileShell drawer-close | ✅ **Fixed** `ca67ae1` |
| L2 | Hydration: HR `fmtDate/fmtDateFull` missing `timeZone` (near-midnight mismatch) | ✅ **Fixed** `ca67ae1` |
| L3 | Icon-only `aria-label`: WorkflowControls pause/play/delete | ⏸️ queued (low-traffic admin) |
| L4 | ~~Tap targets < 36px~~ | ✓ **agent misread** — BuyerInlineEdit is `min-w-9`=36px (at safe min) + already has aria-labels; only CustomerIntelligenceCard/LeadInterestedClient use `min-h-8`=32px (marginal, deferred — not worth churn) |
| L5 | LeadFilters checkbox group missing `role="group"` | ⏸️ queued |

### ⚪ Cosmetic — auto-fixed (safe) or intentional
| # | Area | Status |
|---|---|---|
| C1 | Responsive: 14 fixed `grid-cols-3/4` stat grids cramped on phones | ✅ **Fixed** `ca67ae1` (`grid-cols-1 sm:grid-cols-3`) |
| C2 | Empty-state density `p-8/p-6 → p-5` (22 states) | ✅ **Fixed** `08f62a6` (prior cycle) |
| C3 | Customer 360 bespoke cards → shared `card` token | ✅ **Fixed** `08f62a6` |
| C4 | `key={index}` on append-only lists (AiInsights, chat, workflow, onboarding) | ✓ non-bug (no reorder) — skip unless lists become sortable |
| C5 | Dashboard `p-3` vs `p-4` in one card group; LeadFilters `items-start` vs `items-center` | ⏸️ queued (trivial) |
| C6 | `grid-cols-7` calendars, emoji/color pickers | ✓ intentional fixed-column — no change |

### Fix log (deployed this cycle)
- `74c2c3d` — loading skeletons for 6 hot routes (H4; additive, no blank screens) (batch 2)
- `ca67ae1` — 14 responsive grids + 2 a11y labels + HR date `timeZone` (batch 1)
- `08f62a6` — empty-state density + Customer 360 card token (prior)
- `7607e5b` — Revival "Needs Review" chip (42 leads un-hidden)
- `e1afaa6` — market write-at-source + backfill

### Cycle-1 disposition
- ✅ **Deployed (safe, high-value):** responsive grids · a11y labels · hydration-safe dates · loading skeletons. Regression 129/129 after each.
- ⏸️ **Deferred — perf query refactors (H1/H2/H3/M1/M2/M3):** these touch hot query paths (lead-detail, cold-calls, leads-list). They are **latency**, not stability, and during a stabilization phase a query refactor is a *regression risk* — the opposite of the goal. Prepared + documented here; to be done as a dedicated, closely-monitored performance pass AFTER the multi-day stability window, one query at a time.
- ⏸️ **Marginal cosmetic (deferred, not worth churn):** WorkflowControls admin aria-labels · `min-h-8`→`min-h-9` on 2 buttons · dashboard `p-3/p-4` · LeadFilters `role="group"`/`items-center`.
- ✓ **Non-issues (agent over-rating):** `key={index}` on append-only lists · BuyerInlineEdit tap targets.

### Monitoring (each cycle)
Re-run `scripts/regression.ts` (129 invariants) + market-gap check + `scripts/export-duplicate-review.ts`. Baseline held green through both deploy batches. Watch for: new team-without-market drift, new duplicates, any invariant regression.
