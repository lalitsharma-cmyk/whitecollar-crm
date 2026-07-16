# W2 — Git Branch / Session / Worktree / Stash Reconciliation

**Workstream 2 (Audit-2) · White Collar Realty CRM · 2026-07-17**
**Mode: READ-ONLY.** Zero mutating git commands were executed (only `log`, `show`, `diff`, `branch`, `worktree list`, `stash list/show`, `ls-tree`, `rev-list`, `merge-base`, `grep`). No commit / push / checkout / merge / rebase / stash-pop / branch-delete / worktree-remove. No source edited. Only this report file was written.

`main` HEAD at audit time: **630df9e** ("docs: consolidated final report for the 16-17 Jul overnight window").

---

## Inventory totals
- **Worktrees:** 4 (1 main + 3 secondary; all 3 secondary have CLEAN working trees).
- **Local branches:** 35 (main + 34 non-main). Of the 34 non-main: **27 already merged**, **7 unmerged** (4 = AI/paused-intentional, of which 2 are worktrees + task-manager; 3 = superseded-by-main; 1 mislabeled with a stray test).
- **Remote-only branches:** 4 (`origin/recovered/stash-0..3-*`) — these are **1:1 backups of the 4 local stashes**. Plus overlapping remotes for 4 local branches (`ws-buyer-convo-readonly`, `wip/hr-qa-fixes`, `wip/hr-dashboard-redesign`, `feat/customer-layer-foundation`). ~45 refs total.
- **Stashes:** 4 (all also mirrored to `origin/recovered/*` — nothing is single-copy).
- **Uncommitted in main worktree:** 26 items (17 modified + 9 untracked paths) = the **in-flight ghosting/call-attempts feature** (100% coupled). Plus 2 audit-agent artifacts not part of any feature.

---

## Master table

| Ref (branch / worktree / stash) | Intent | Ahead / Behind main | Merged? | Deployed? | Conflicts prod? | Recommendation | Safe-to-action | Notes |
|---|---|---|---|---|---|---|---|---|
| **WORKTREES** | | | | | | | | |
| `whitecollar-crm` @ main | Primary prod worktree | — | — | yes | — | **LEAVE** | N | Active session; 26 in-flight files. |
| `wcr-ai-workstream` @ ai-sales-os-v2 | AI Sales OS M0–M7 build | 14 / 84 | No | No | No | **DO NOT TOUCH** (AI-frozen) | N | Clean tree. AI-PAUSE hard override. 7 `/api/ai/*` routes, 104 tests. |
| `wcr-freshleads` @ ws-fresh-leads-priority | Fresh-lead priority visibility | 1 / 132 | No | **Feature yes (via main/RC1)** | No | **ARCHIVE** (worktree remove → branch delete) | Y* | Clean tree. `freshLeads.ts` + `reports/fresh-leads` already on main (rebuilt, evolved). Branch is the older standalone copy. |
| `D:/wcr-ai-sales-os` @ feat/ai-sales-os | Older AI Sales OS M1 attempt | 1 / 140 | No | No | No | **DO NOT TOUCH** (AI-frozen) | N | Clean tree. Superseded by ai-sales-os-v2 but still AI-frozen — leave. |
| **UNMERGED BRANCHES** | | | | | | | | |
| `feat/task-manager` | Task Manager v1 (full) | 1 / 12 | No | No (flag OFF, migration unapplied) | No | **DO NOT TOUCH** (intentional hold) | N | Checkpoint 8dd8d89 = 62 files / +5,495 lines = complete v1. 13-table migration STAGED, not applied. Deliberate pause. |
| `feat/customer-layer-foundation` | Customer/identity foundation | 2 / 250 | No | Partially (rebuilt on main) | **Schema approach superseded** | **ARCHIVE after review** | Y* | `src/lib/customer/*`, `ReturningClientCard`, `InvestorBanner` all rebuilt+evolved on main. Branch's **physical Customer table + migration** is the road-not-taken (main chose VIRTUAL profile per Global-Identity rule). Remote backup exists. |
| `ws-actor-vs-owner-timeline` | Actor-vs-owner timeline | 1 / 128 | No | Code yes (on main) | No | **NEEDS RECONCILIATION** (tiny) → then archive | Y* | MISLABELED: the actor-owner code is already on main; the branch's ONE unique commit (646aa62) is a **stray 37-line voice-broadcast regression test**. Optionally cherry-pick that test into main, then delete. |
| `ws-buyer-convo-readonly` | Buyer convo = read-only | 1 / 130 | No | **Yes (equivalent on main)** | No | **ARCHIVE** (local + remote) | Y* | Main's `BuyerActivityTimeline.tsx` already has NO in-card action bar (`LOG_BTNS`/`ATTEMPT_BTNS`/composer absent). Duplicate-bar removal effectively done on main. `context` prop was deferred and is moot. |
| **AI (frozen) — see worktrees** `ai-sales-os-v2`, `feat/ai-sales-os` | | | | | | **DO NOT TOUCH** | N | Covered above. |
| **MERGED BRANCHES (ancestors of main — redundant refs)** | | | | | | | | |
| `hold/import-fidelity` | Import canonical phone + dedup | 0 / 10 | **Yes (41b9503)** | Yes (sw v151 marker) | No | **DELETE** (safe) | Y | Anchor confirmed: merged via 41b9503 "…(APPROVED)"; tip 79788c9 is ancestor. Hold is over. |
| `pending/complete-logging-followup` | Complete rolls follow-up +1d | 0 / 249 | **Yes (ancestor)** | Content in main | No | **DELETE** (safe) — verify intent | Y | Labeled "PARKED awaiting approval" but tip 6776806 IS in main's ancestry → the parked work is already in main. Flag to Lalit that the gate is effectively lifted. |
| `rc1` | RC1 consolidation / Market field | 0 / 115 | Yes | Yes (shipped Jul1) | No | **DELETE** (safe) | Y | Consolidation shipped. |
| `release/followup-revisit` | Follow-up board + Revisit queue | 0 / 247 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `ws-leads-418-hydration` | Kill React #418 on /leads | 0 / 100 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `ws-unify-lead-view` | Data-bank rule / lead-view | 0 / 130 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `wip/hr-dashboard-redesign` | HR action dashboard | 0 / 167 | Yes | Yes | No | **DELETE** (safe, local + remote) | Y | |
| `wip/hr-qa-fixes` | HR auto-join cron | 0 / 150 | Yes | Yes | No | **DELETE** (safe, local + remote) | Y | |
| `feat/hr-recruitment-module` | HR Phase 1 | 0 / 541 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `feat/hr-calendar-resume-wa` | HR resume bank + calendar | 0 / 538 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/hr-dedicated-shell` | HR own shell | 0 / 540 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/nisha-hr-only` | hrOnly gating | 0 / 539 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `feat/action-list-status-driven` | Action list by status | 0 / 543 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `feat/conversation-history-redesign` | Convo history redesign | 0 / 545 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `feat/import-safe-mode` | Import 2-step preview | 0 / 544 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/import-conversation-history-cleanup` | Imported remarks → notes | 0 / 548 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/preserve-historical-agent-names` | Keep Excel agent names | 0 / 542 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/reminder-widget-and-project-column` | Reminder + project col | 0 / 547 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `fix/sticky-note-simplification` | Plain sticky note | 0 / 546 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `worktree-agent-a2705735fa8563813` | Templates + Bulk Email | 0 / 827 | Yes | Yes | No | **DELETE** (safe) | Y | Old agent worktree branch. |
| `worktree-agent-ac34c746c01436e6c` | Templates + Bulk Email (dup) | 0 / 827 | Yes | Yes | No | **DELETE** (safe) | Y | Duplicate of above. |
| `worktree-agent-ae02e3a415b096c14` | Templates + Bulk Email (dup) | 0 / 827 | Yes | Yes | No | **DELETE** (safe) | Y | Duplicate of above. |
| `worktree-agent-a6b75610f170a2404` | Revival Engine rebrand | 0 / 759 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `worktree-agent-ab7c2b08b0932fce4` | Gamification XP/levels | 0 / 759 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `worktree-agent-ac726d2b2b753729d` | EOI booking funnel | 0 / 759 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `worktree-agent-acd83bd95924ed929` | Vault MVP | 0 / 759 | Yes | Yes | No | **DELETE** (safe) | Y | |
| `worktree-agent-adaf51d97a0d19a43` | Mobile-first calling | 0 / 664 | Yes | Yes | No | **DELETE** (safe) | Y | |
| **STASHES** (all mirrored to `origin/recovered/*`) | | | | | | | | |
| `stash@{0}` device-security WIP | Country-change audit + admin alert | — | — | **On main** | No | **DROP** (safe) | Y | `deviceSecurity.ts` on main already has `country_change` audit. Superseded. Remote backup: `recovered/stash-0`. |
| `stash@{1}` buyer-classification WIP | FIRST_TIME/INVESTOR/WHALE | — | — | **On main** | No | **DROP** (safe) | Y | Classification shipped on main in `buyerIntelligence.ts` (+ InvestorBanner). Superseded. Backup: `recovered/stash-1`. |
| `stash@{2}` War-Fear reclassification | Remove WAR_FEAR from reject reasons | — | — | **NOT on main** | Policy pending | **NEEDS DECISION** (keep) | N | Main STILL lists `WAR_FEAR` as an ACTIVE reject reason (reject-reasons.ts line 9). Encodes a real product decision (War Fear = workable, not lost) that was never applied. Flag to Lalit. Backup: `recovered/stash-2`. |
| `stash@{3}` terminal-followup cleanup | `currentStatus` in loadOwnedLead | — | — | Superseded approach | Contradicts main | **DROP** (safe) | Y | Own label: "overlaps/contradicts Release-1 Revisit approach". Terminal-followup invariant shipped on main via Lost/Rejected auto-unassign (b6c051e). Backup: `recovered/stash-3`. |

\* *Safe-to-action Y\* = safe once the owning session confirms; worktree branches require `worktree remove` before branch delete, and are not this workstream's to execute.*

---

## SAFE CLEANUP list (recommend only — do NOT execute)

**27 merged local branches — refs fully contained in `main`, deletion loses nothing:**
`feat/action-list-status-driven`, `feat/conversation-history-redesign`, `feat/hr-calendar-resume-wa`, `feat/hr-recruitment-module`, `feat/import-safe-mode`, `fix/hr-dedicated-shell`, `fix/import-conversation-history-cleanup`, `fix/nisha-hr-only`, `fix/preserve-historical-agent-names`, `fix/reminder-widget-and-project-column`, `fix/sticky-note-simplification`, `hold/import-fidelity`, `pending/complete-logging-followup`, `rc1`, `release/followup-revisit`, `wip/hr-dashboard-redesign`, `wip/hr-qa-fixes`, `ws-leads-418-hydration`, `ws-unify-lead-view`, and all 8 `worktree-agent-*` branches.

**3 unmerged-but-superseded branches — work already rebuilt/evolved on main:**
- `ws-buyer-convo-readonly` (local + `origin/ws-buyer-convo-readonly`) — read-only fix already effective on main.
- `ws-fresh-leads-priority` (WORKTREE `wcr-freshleads`) — feature shipped on main; remove worktree first.
- `feat/customer-layer-foundation` (local + remote) — customer layer rebuilt on main; physical-table schema deliberately not taken. Skim `searchRank.ts`/`timelineEvents.ts` for any residual util before deleting.

**3 stashes superseded — droppable (all remote-backed):** `stash@{0}`, `stash@{1}`, `stash@{3}`.

**Redundant remote recovery branches** once their stashes are resolved: `origin/recovered/stash-0`, `-1`, `-3` (keep `-2` while its decision is open).

---

## DO NOT TOUCH list (paused / in-flight / AI)

- **`feat/task-manager`** — deliberate hold; complete 62-file v1; 13-table migration intentionally unapplied. Not a cleanup target.
- **`ai-sales-os-v2`** (worktree `wcr-ai-workstream`) — AI-FROZEN (hard override). Leave.
- **`feat/ai-sales-os`** (worktree `D:/wcr-ai-sales-os`) — AI-FROZEN. Superseded by v2 but still leave (AI pause).
- **The 26 uncommitted items in the main worktree** — in-flight ghosting/call-attempts feature owned by the primary session + 3 agents. Includes `src/lib/callAttempts.ts`, `src/lib/ghosting.ts`, `prisma/schema.prisma` (call_attempt_cycle), the `20260717060000_call_attempt_cycle` migration, `backfill-call-attempts.ts`, `reports/ghosting/`, `reports/revival-cycles/`, `settings/call-attempts/`, `CallAttemptThresholdsEditor.tsx`, `GhostingMetricCard.tsx`, and 17 modified files (all heavily coupled to attempt/ghost/cycle). **Do not stage, commit, discard, or stash any of these.**
- **`stash@{2}`** War-Fear reclassification — pending product decision, keep until Lalit rules.

---

## NEEDS RECONCILIATION list (real value not on main)

1. **`stash@{2}` — War Fear reject-reason retirement.** Highest-value orphan. Main still offers "War Fear" as an active rejection; the stash reclassifies it as a workable status (with a legacy-label fallback so historical records still resolve). This is a product-policy call for Lalit, not an auto-merge. Remote-backed (`recovered/stash-2`).
2. **`ws-actor-vs-owner-timeline` — 37-line voice-broadcast regression test (646aa62).** The only genuinely-not-on-main artifact of value across all unmerged branches. Encodes Lalit's 6 recipient-targeting invariants (USER/TEAM/ALL, sender-excluded, access-gated). Cheap to cherry-pick into `main`'s `scripts/regression.ts`; then the branch is fully redundant.
3. **`feat/customer-layer-foundation` — review before archive.** Main's customer layer diverged (main added `candidates.ts`, `returningClient.ts`; branch had `searchRank.ts`, `timelineEvents.ts`, `types.ts`). Confirm no wanted helper is stranded, then archive. Its schema/migration is intentionally obsolete (virtual-profile direction won).

---

## Uncommitted-files classification (main worktree)

| Path | Class | Verdict |
|---|---|---|
| `prisma/schema.prisma` (M, +18 attempt/ghost hits) | In-flight feature | LEAVE (main session) |
| `scripts/regression.ts` (M, +55) | In-flight feature | LEAVE |
| `src/app/(app)/cold-calls/page.tsx` (M, 36) | In-flight | LEAVE |
| `src/app/(app)/leads/page.tsx` (M, 14) | In-flight | LEAVE |
| `src/app/(app)/reports/page.tsx` (M, 10) | In-flight | LEAVE |
| `src/app/(app)/revival-engine/cold-data/[id]/page.tsx` (M, 28) | In-flight | LEAVE |
| `src/app/(app)/settings/page.tsx` (M, 16) | In-flight | LEAVE |
| `src/app/api/acefone/webhook/route.ts` (M, 4) | In-flight | LEAVE |
| `src/app/api/leads/[id]/log-call/route.ts` (M, 6) | In-flight | LEAVE |
| `src/components/BuyerAdminPanel.tsx` (M, 25) | In-flight | LEAVE |
| `src/components/LeadFilters.tsx` (M, 15) | In-flight | LEAVE |
| `src/components/LeadsListClient.tsx` (M, 23) | In-flight | LEAVE |
| `src/components/RevivalLeadsListClient.tsx` (M, 28) | In-flight | LEAVE |
| `src/lib/leadFilterWhere.ts` (M, 9) | In-flight | LEAVE |
| `src/lib/leadIngest.ts` (M, 5) | In-flight | LEAVE |
| `src/lib/telephony/recordCall.ts` (M, 4) | In-flight | LEAVE |
| `docs/MIGRATION-LEDGER.md` (M, 4) | In-flight (migration ledger) | LEAVE |
| `prisma/migrations/20260717060000_call_attempt_cycle/` (??) | In-flight | LEAVE |
| `scripts/backfill-call-attempts.ts` (??) | In-flight | LEAVE |
| `src/app/(app)/reports/ghosting/` (??) | In-flight | LEAVE |
| `src/app/(app)/reports/revival-cycles/` (??) | In-flight | LEAVE |
| `src/app/api/settings/call-attempts/` (??) | In-flight | LEAVE |
| `src/components/CallAttemptThresholdsEditor.tsx` (??) | In-flight | LEAVE |
| `src/components/GhostingMetricCard.tsx` (??) | In-flight | LEAVE |
| `src/lib/callAttempts.ts` (??) | In-flight | LEAVE |
| `src/lib/ghosting.ts` (??) | In-flight | LEAVE |
| `scripts/_audit_data_1.ts` (??) | **Sibling audit probe** (Workstream 6 / Audit-4; self-labeled "TEMP READ-ONLY … Deleted after run") | Not a feature file; that agent removes it. Do not commit. |
| `docs/reconciliation-2026-07/` (??) | **This reconciliation output** (incl. this file) | Expected. |

**Every feature file is coupled to the ghosting/call-attempts build — nothing stale or generated in the set. No orphaned uncommitted work.**

---

## Conflicts-with-prod summary
None of the recommended deletions touch prod code (merged refs are already in prod; superseded branches were rebuilt in prod). The only prod-relevant open item is `stash@{2}` (War Fear), which is a deliberate not-yet-applied policy change, not a conflict. `feat/task-manager`'s unapplied 13-table migration and the two AI worktrees are intentional holds and must not be actioned.

**Confirmation: ZERO mutating git commands were executed during this audit.**
