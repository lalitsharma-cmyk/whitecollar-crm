# AI Sales OS

> What the AI does, why it can't touch data without a human, and how to turn it on.
> This is the operator's overview. The full engineering design is in
> [`AI_SALES_OS_ARCHITECTURE.md`](./AI_SALES_OS_ARCHITECTURE.md).

## Status: built, not deployed, and OFF

The AI Sales OS is **fully built and tested** (milestones M0–M7, ~104 tests) but is
**not deployed to production** and is **switched OFF**. It ships as a no-op:

- The master DB setting **`ai.enabled` is `false`** — with it off, nothing
  cost-incurring runs, and every AI call returns null so callers fall back to the
  existing rule-based logic (zero token cost).
- The default engine is a **deterministic mock** — the CRM works fully without any
  AI provider key. It never depends on an LLM being up.

Going live requires an explicit **"Deploy AI"** decision plus a provider key (see
"How to turn it on").

## What it does — a Sales Operating System, not a chatbot

The AI is designed as one 24/7 layer acting as **Director + Coach + Analyst + BI**
over the whole CRM. It reads everything, explains its reasoning, and **suggests**;
it only *applies* changes after a human approves. Capabilities (each behind its own
flag):

- **Read + Explain** — assemble a lead/customer's full context and produce an
  explainable analysis (BANT, follow-up state, buying signals).
- **Detect + Suggest** — spot stalled deals, returning investors, and next-best
  actions, ranked and explained.
- **Matching engine** — match Buyer ↔ Seller ↔ inventory over budget/location/
  configuration/market (hard-gated so an India record never matches a UAE one).
- **Data quality / self-healing** — detect and *propose* reversible fixes (applied
  only via approval).
- **Coach / Analyst / BI** — daily digests, coaching nudges, pipeline analytics
  (read-only).
- **Memory + knowledge base** — conversation memory + curated KB for reasoning.

## The Read-Only-First pipeline (the safety guarantee)

Every AI operation follows one fixed pipeline:

```
Read → Analyze → Detect → Explain → Suggest → Approval → Apply
```

**Nothing mutates production without an explicit human approval step.** The
principles (from the permanent AI standards):

1. **One central Brain** — never per-module AI; every module calls the same Brain.
2. **Read-Only-First** — all routes are read-only except one gated apply route.
3. **Deterministic-first** — reuse the existing rule layer (follow-up, dedup,
   classification, market); call the LLM only for genuine ambiguity. Cheaper,
   faster, auditable.
4. **Every decision is explainable** — each suggestion carries its evidence + a
   rule/LLM trace.
5. **Audit-first** — reads/suggestions/approvals/applies write audit rows.
6. **Human approval before any critical mutation** — and applies are **whitelisted +
   reversible** only.

## Mock vs. real provider

- **No key set** → the engine transparently uses the **deterministic mock**;
  `GET /api/ai/engine-status` reports `ready:false` with the reason. Everything still
  runs, deterministically and free.
- **Key set + provider selected** → real LLM calls (Gemini 2.5 Flash is the default
  target). Providers are swappable **by env only** (Gemini / Claude / OpenAI /
  DeepSeek) — no code change.

## The AI API surface

All routes are read-only **except** `/api/ai/apply`, and all are gated behind
`ai.enabled` except engine-status:

| Route | Method | Access | Writes? |
|---|---|---|---|
| `/api/ai/analyze` | GET | scope-safe | no |
| `/api/ai/matches` | GET | scope-safe | no |
| `/api/ai/data-quality` | GET | ADMIN | no (suggests) |
| `/api/ai/apply` | POST | ADMIN | **yes — reversible, whitelisted, audited** |
| `/api/ai/digest` | GET | ADMIN | no |
| `/api/ai/memory` | GET | scope-safe | no |
| `/api/ai/engine-status` | GET | ADMIN | no (diagnostics, ungated) |

## How to turn it on

1. **Get the "Deploy AI" go-ahead** (owner decision). Until then the code stays out
   of production per the AI standards.
2. **Set a provider key** in Vercel env (a secret — the owner's step, never
   committed). Env reference (full table in the architecture doc):
   - `AI_ENGINE_PROVIDER` — `mock` | `gemini` | `claude` | `openai` | `deepseek`
     (default `gemini`).
   - `AI_GEMINI_API_KEY` / `AI_GEMINI_MODEL` (default `gemini-2.5-flash`), and the
     equivalents for Claude / OpenAI / DeepSeek.
3. **Flip `ai.enabled` to `true`** in **Settings** (the DB kill-switch). This is the
   master switch for all cost-incurring AI.
4. **Enable capabilities one at a time** behind their own flags, and watch the cost
   cap (`ai.monthlyCostCapUsd`, default `$50` — spend above it short-circuits AI back
   to the mock).

Related settings keys (`ai.enabled`, `ai.trialMode.enabled`, `ai.monthlyCostCapUsd`,
`ai.extraction.autoApply`) are documented in [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md).

## Current live AI state (as of the memory notes)

- `src/lib/ai.ts` is **paused** (`ai.enabled=false`).
- A "War Room" surface has run on the pilot (Lalit's leads only) via
  `isAiPilotLead`; the AI Audit note flags removing War Room from the general Lead
  view. See memory notes `project-ai-state.md`, `project-ai-audit-jul2.md`.
- The full build lives on an isolated worktree/branch and is rebased in only as part
  of the "Deploy AI" step, then run through the full gate (tsc + regression + build).

For the layer-by-layer design, module layout, and milestone detail, read
[`AI_SALES_OS_ARCHITECTURE.md`](./AI_SALES_OS_ARCHITECTURE.md). For the follow-up
intelligence design specifically, see
[`AI_FOLLOWUP_INTELLIGENCE_DESIGN.md`](./AI_FOLLOWUP_INTELLIGENCE_DESIGN.md).
