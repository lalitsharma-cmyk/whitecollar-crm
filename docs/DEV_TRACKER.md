# WCR CRM — Master Development Tracker

**Single source of truth.** _Last updated: 2026-06-27 (overnight run end)_

## Process (locked 2026-06-27, Lalit)
- **Phase A — Stabilization** → **Phase B — Freeze** (regression green) → **Phase C — New Ideas** (only after Pending = 0).
- **Deploys + data migrations funnel through the orchestrator ONLY** (serial, backup → tsc → regression → deploy → health). Agents discover; orchestrator fixes + deploys. Destructive steps get a backup first.
Legend: ✅ Completed · 🟡 In Progress · 🔵 In QA · 🚀 Deployed · 🔴 Blocked · ⏳ Remaining

---

## 🚀 DEPLOYED — overnight 2026-06-27 (7 batches, all health-verified)
1. **Buyer Conversation History P0** — imported "Conversation History" → buyer timeline; 438 backfilled (backed up). `1925491`
2. **Buyer re-import idempotency P0** — no double-created timeline rows; status de-dup. `de254ea`
3. **Buyer convert hardening + VOICE_NOTE + 3 reporting reconciliations** (funnel leak, fresh-drill, future-link). `5c1f5b6`
4. **UI dark-mode net** (slate/gray-300/#e5e7eb, ~10 gaps). `f379c9d`
5. **Reactivate fix** (resets currentStatus + clears rejection stamp). `62a002e`
6. **Rejected-Lead workflow core** — 🟥 badge, double-reject guard, Reactivate button, reactivate-before-reassign, previousOwnerId recorded. `73c5b03`
7. **Dashboard Cold-revival tile** (was ~0; now counts cold leads). `4b9b09e`
_(earlier this cycle: Voice Ch① + mic pin · Smart Timeline P0 · declutter · Permission hardening · prep `previousOwnerId` migration applied to prod.)_

Regression gate now **85 invariants** (+ buyer-conversation, buyer-import-idempotent, smart-timeline-client-comms, rejected-lead-workflow).

## 🔴 PARKED — waiting on Lalit (device security)
- **4 agents (Dinesh, Mehak, Tanuj + 4th TBC) device re-registration w/ Sameer approval.** Status: all 4 already logged out (0 sessions). Sameer (sameer.wcr1@gmail.com) is an **active Admin** → already gets alerts + can approve. **BLOCKER (Lalit's action tomorrow):** set `DEVICE_SECURITY_ENFORCE=true` in Vercel → redeploy. THEN orchestrator: (a) confirm 4th user, (b) optional 1-line policy change so EVERY device needs approval (default auto-approves first 2/user), (c) clear the 4 agents' device rows so re-login → PENDING → Sameer approves.

## ⏳ REMAINING — backlog (audit P2/P3 + Phase-A leftovers)
- **Rejected-Lead hard-unassign** (DEFERRED, needs care): null `ownerId` + "Current Assignee: Unassigned" + existing-rejected migration → requires re-pointing every `groupBy(["ownerId"])` rejected/lost report (agentPerformance summary `:447,458` + drills `:774,778`) to `ownerId OR previousOwnerId`, + a backed-up migration. Current build keeps ownerId (reports accurate) + shows "Previous Owner / reactivate-to-reassign" instead.
- Buyer P2s: timeline auto-refetch after remark edit (needs server-side activity regen); market-scoped dedup (latent); Voice-button gate on speechSupported; Region label off `market` not nationality.
- Reconciliation P2s: Action Board (`activities/page.tsx`) exclude COLD_ORIGINS + use TERMINAL (not SUPPRESSED) statuses.
- Phase-A leftovers: default Smart-Timeline tab on Buyer/Revival · Login/Logout check-in-before-logout · Lead-View compact/density redesign · disable call/WA actions while a lead is rejected.

## PENDING — committed features (after Freeze)
- Voice Channel ② escalation · Buyer Phase-2 (#244-249) · Reporting v2 #250 · Connected-chip #251.

## 🔴 DECISIONS
- "Overdue" boundary `<now()` vs `<startOfTodayIST` · phone-mask + Won-metric (#253) · Rejected-Lead hard-unassign yes/no.
