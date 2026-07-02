# AI Sales OS — Architecture & Build Plan (Workstream 2, isolated)

> **Isolation contract.** All AI development lives on branch `ai-sales-os-v2` in the
> `wcr-ai-workstream` worktree. **Nothing here is deployed to production or merged to
> `main` until Lalit says "Deploy AI".** Build to *deployment-ready*, then only
> deployment + final validation remain.

## 1. Vision — AI is a Sales Operating System, not a chatbot
One 24/7 layer that acts as **Director + Coach + Analyst + Admin + BI** over the whole
CRM. It reads everything, explains its reasoning, suggests, and only *applies* critical
changes after human approval.

## 2. Non-negotiable principles (from the permanent AI standards)
1. **ONE central AI Brain** — never per-module AI. Every module calls the same Brain.
2. **Read-Only-First pipeline:** `Read → Analyze → Detect → Explain → Suggest → Approval → Apply`.
   Nothing mutates prod without an explicit human approval step.
3. **One Client = One Unified Profile** — the Brain reasons over the virtual unified
   customer (reuses the existing `src/lib/customer/` layer + `getReturningClientView`).
4. **Every decision is explainable** — each suggestion carries its evidence + rule/LLM trace.
5. **Deterministic-first, LLM-only-for-ambiguous** — reuse the existing rule layer
   (follow-up, classification, dedup, market); call the LLM only where rules can't decide.
   Cheaper, faster, auditable.
6. **Audit-first** — every read/suggestion/approval/apply writes an `AiDecision` audit row.
7. **Provider-independent** — engine abstraction (mock default; Gemini 2.5 Flash target;
   Claude/GPT swappable via `AI_ENGINE_PROVIDER`). Extends the existing `src/lib/ai/` pattern.
8. **Human approval before any critical mutation** — gated by the Authority Model
   (Milestone 1 foundation on `feat/ai-sales-os`: 8 tables + authority model — re-derive here).

## 3. The 7-layer Brain
| # | Layer | Responsibility | Reuses |
|---|-------|----------------|--------|
| L1 | **Ingest / Context** | assemble the unified-profile context for an entity | `src/lib/customer/*`, lead/buyer loaders |
| L2 | **Analyze** | deterministic signals (BANT, follow-up state, dedup, market, buying signals) | existing rule libs |
| L3 | **Detect** | opportunities/risks (stalled deals, returning investor, matching buyer↔seller) | new + rule layer |
| L4 | **Reason (LLM)** | only for ambiguity the rules can't resolve; provider-independent | `src/lib/ai/` engine |
| L5 | **Explain** | attach evidence + rule/LLM trace to every output | new |
| L6 | **Suggest / Orchestrate** | rank actions, route to the right human, schedule | new |
| L7 | **Apply (gated)** | execute ONLY approved, reversible mutations; audit every one | Authority Model |

## 4. Module layout (to build under `src/lib/ai/`)
```
src/lib/ai/
  brain/            # the orchestrator — one entry: analyzeEntity(kind,id) → AiResult
  engine/           # provider-independent LLM engines (mock|gemini|claude|openai)
  context/          # L1 unified-profile context builders
  analyzers/        # L2 deterministic signal producers (wrap existing rule libs)
  detectors/        # L3 opportunity/risk detectors (matching engine lives here)
  prompts/          # versioned prompt templates (+ tests / golden files)
  memory/           # conversation + knowledge-base memory (embeddings later)
  pipelines/        # scheduled jobs: rescore, digest, matching sweeps (behind flags)
  authority/        # who may approve/apply what (re-derive Milestone-1 authority model)
  audit/            # AiDecision writer + explainability trace
  types.ts          # shared pure types (unit-testable, no server-only)
```
API surface: thin `/api/ai/*` routes → `brain.analyzeEntity(...)` (read-only) and
`/api/ai/approve` / `/api/ai/apply` (gated, audited). No route mutates without approval.

## 5. The 17 director-grade capabilities → milestones
Grouped into shippable milestones (each: build → local test → local validation; deploy only on "Deploy AI"):

- **M0 Foundation (on this branch):** engine abstraction + `types.ts` + `AiDecision` audit table + Read-Only pipeline skeleton + Authority Model (re-derive from Milestone 1). Feature-flagged, mock engine default.
- **M1 Read + Explain:** L1–L2, L5 — unified context + deterministic analysis + explainable output for a lead. `/api/ai/analyze` (read-only). No mutations.
- **M2 Detect + Suggest:** L3, L6 — stalled-deal + returning-investor + next-best-action detectors → ranked, explained suggestions surfaced (read-only, approval-required).
- **M3 Matching Engine:** Buyer ↔ Seller ↔ Inventory matching (first-class) over the unified profile (budget/location/config/market from existing fields).
- **M4 Data Quality + Self-healing:** detect+propose fixes (derived, reversible) — extends the existing `dataQuality` cron; apply only via approval.
- **M5 Coach/Analyst/BI:** daily digests, coaching nudges, pipeline analytics (read-only reports).
- **M6 Memory + Knowledge base:** conversation memory + KB retrieval for the Reason layer.
- **M7 Gemini provider + prompt hardening:** wire Gemini 2.5 Flash engine; prompt tests/golden files; cost + latency budget.

## 6. Safety & deployment gates
- Default engine = **mock** (deterministic, free) until Gemini is wired + validated.
- Global `ai.enabled` flag stays **OFF**; every capability behind its own flag.
- **No prod migration, no live-CRM change, no external LLM key used against prod data** on this branch.
- Rebase onto `main` (or cherry-pick) only as part of the eventual "Deploy AI" step, then run the full gate (tsc + regression + build) + cross-module regression before any deploy.

## 7. Status
- [x] Isolated worktree `ai-sales-os-v2` off current `main`.
- [x] This architecture + build plan.
- [x] **M0 Foundation** — `types.ts`, `engine.ts` (mock default + provider stubs), Read-Only pipeline shapes.
- [x] **M1 Read + Explain** — `analyze.ts` + `context.ts` + `brain.ts` + `GET /api/ai/analyze` (read-only, gated). 11 tests.
- [x] **M2 Detect + Suggest** — deterministic detectors → ranked explained suggestions (all `mutation: null`).
- [x] **M3 Matching Engine** — `matching.ts` + `matchingService.ts` + `GET /api/ai/matches`; market hard-gate. 10 tests.
- [x] **M4 Apply framework + self-heal** — `apply.ts` (whitelist+reversible gate) + `applyService.ts` (before-check + AuditLog) + `POST /api/ai/apply` (ADMIN, gated) + `dataQuality.ts`/`dataQualityService.ts` + `GET /api/ai/data-quality`. First reversible WRITE path, end-to-end loop. 23 tests.
- [x] **M5 Coach/Analyst/BI** — `analytics.ts` (pipeline health + coaching nudges + daily digest) + `analyticsService.ts` + `GET /api/ai/digest` (ADMIN, gated, read-only). 16 tests.
- [x] **M6 Memory + Knowledge base** — `knowledge.ts` (curated KB + deterministic retrieval) + `memory.ts` (compaction) + `memoryService.ts` + `GET /api/ai/memory` (scope-safe, gated, read-only). 15 tests.
- [x] **M7 Provider-agnostic engine** — `providers.ts` (config-driven registry: Gemini/Claude/OpenAI/DeepSeek, add-a-provider = add-a-spec) + `llmEngine.ts` (one generic HTTP engine) + `engine.ts` (`resolveEngine` degrades to mock when no key; `getEngine` strict; `engineStatus` diagnostics) + `prompts.ts` (grounded, currency-guardrailed) + `reason.ts` (deterministic-first, always-falls-back) + `GET /api/ai/engine-status`. **Gemini 2.5 Flash default, switchable by config only.** 29 tests.

**✅ ALL MILESTONES M0–M7 COMPLETE.** The module is **deploy-ready pending only the "Deploy AI" gate + an API key.** When "Deploy AI" is given: rebase/cherry-pick onto `main` → full gate (tsc + regression + build) → set the provider key (below) → enable flags per capability. Deterministic mock runs everything until a key is set — the CRM never depends on the LLM being up.

**Local validation:** 104 pure tests passing across 7 files (`npx tsx src/lib/ai/*.test.ts`); tsc clean across the worktree. `main` + prod untouched. No LLM key used, no prod migration, `ai.enabled` OFF.

## 8. API surface (all read-only except apply; all gated behind `ai.enabled` except engine-status)
| Route | Method | Access | Writes? |
|---|---|---|---|
| `/api/ai/analyze` | GET | scope-safe | no |
| `/api/ai/matches` | GET | scope-safe | no |
| `/api/ai/data-quality` | GET | ADMIN | no (suggests) |
| `/api/ai/apply` | POST | ADMIN | **yes — reversible, whitelisted, audited** |
| `/api/ai/digest` | GET | ADMIN | no |
| `/api/ai/memory` | GET | scope-safe | no |
| `/api/ai/engine-status` | GET | ADMIN | no (diagnostics, ungated) |

## 9. Config reference (env — set at "Deploy AI", nothing before)
| Env | Purpose | Default |
|---|---|---|
| `ai.enabled` (DB setting) | Master switch for all AI routes | `false` (OFF) |
| `AI_ENGINE_PROVIDER` | `mock` \| `gemini` \| `claude` \| `openai` \| `deepseek` | `gemini` |
| `AI_GEMINI_API_KEY` / `AI_GEMINI_MODEL` | Gemini key / model | — / `gemini-2.5-flash` |
| `AI_CLAUDE_API_KEY` / `AI_CLAUDE_MODEL` | Claude key / model | — / `claude-haiku-4-5-20251001` |
| `AI_OPENAI_API_KEY` / `AI_OPENAI_MODEL` | OpenAI key / model | — / `gpt-4o-mini` |
| `AI_DEEPSEEK_API_KEY` / `AI_DEEPSEEK_MODEL` | DeepSeek key / model | — / `deepseek-chat` |

Switching providers is env-only (no code change). With no key set, `resolveEngine()` transparently uses the deterministic mock and `GET /api/ai/engine-status` reports `ready:false` with the reason. **Entering the API key itself is the user's step** (a secret), done in Vercel env — never committed.
