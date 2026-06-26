# Buyer Data — Phase 2 Build Plan

**Status:** planned · **Risk posture:** fully additive · **Migration:** NONE required.

Every field this phase needs already exists on `BuyerRecord`
(`country`, `source`, `buyerKey`, `transactionValue`) — so Phase 2 is **compute +
UI + import** only. No schema change, no migration, no new column. This keeps the
whole phase reversible and removes the hand-applied-migration step from the critical
path (see [`MIGRATION-LEDGER.md`](./MIGRATION-LEDGER.md)).

The Buyer module is already a worked pipeline (Admin Pool → agent → CONVERT/REJECT,
with `BuyerAssignment` / `BuyerActivity` history and `buyerScopeWhere` access
control). Phase 2 layers an **investor-classification + portfolio** view on top of it,
tidies the import flow, and adjusts the buyer UI — all without touching the
lifecycle engine.

---

## The 8-requirement scope (additive, no migration)

The plan is delivered as the items below. Items 1–6 are the distinct, shippable units;
together with their production-verification and role-permission gates they constitute
the eight committed pieces of Phase 2 work.

### 1. Classification compute — First-Time / Investor / Whale
Derive each buyer's classification live from their `buyerKey` rollup (all
`BuyerRecord` rows sharing the normalised fname+lname+phone identity), never stored.

- **Engine already created:** `src/lib/buyerClassification.ts` (pure, compute-only —
  mirrors the Customer-layer "computed, never stored" principle and the
  `lead-statuses.ts` token pattern).
- **Thresholds (tunable — single source of truth in that file):**
  - **Investor** — ≥ **2** properties **OR** total transacted ≥ **AED 5M**.
  - **Whale** — ≥ **4** properties **OR** total transacted ≥ **AED 15M**.
  - **First-Time** — exactly one property below the investor floor.
  - Precedence (highest first): **Whale → Investor → First-Time**.
- Values are in the buyer's market currency; Dubai Buyer Data = AED.
- Callers group `BuyerRecord` rows by `buyerKey`, then call `buildPortfolio()` per
  group to get `{ propertyCount, totalValue, classification, items }`.

### 2. Classification badge + Portfolio section (buyer detail + list)
- **List:** a classification chip on each buyer row (use `CLASSIFICATION_CHIP` /
  `classificationBadge()` from the engine — 🌱 First-Time, 📈 Investor, 🐋 Whale).
- **Detail:** a **Portfolio** section listing every property in the buyer's
  `buyerKey` rollup (project / tower / unit / type / area / transaction value / date,
  newest first) with the computed property count and total transacted value, and the
  classification badge in the header.

### 3. Classification filter (buyer list)
Add a First-Time / Investor / Whale filter to the buyer list. Because classification
is **computed, not stored**, the filter is applied over the computed rollup (group by
`buyerKey` → classify → filter), consistent with how the list already groups for
repeat-buyer rollup. No DB column, no migration.

### 4. Country dropdown + backfill empty `BuyerRecord.country`
- Surface `BuyerRecord.country` as an editable **dropdown** on the buyer detail (and
  in the import mapping), so country is a clean, selectable value rather than free text.
- **Backfill** rows where `country` is empty (script under `scripts/`, backup-first per
  the Production Safety Rule — additive value-fill only, never overwriting a non-empty
  country). The column already exists, so this is a data backfill, **not** a migration.

### 5. Remove Source from the buyer UI — keep the admin provenance card
- Drop the `source` field from the agent-facing buyer UI (it is import provenance, not
  a working field, and clutters the agent view).
- **Retain** `source` / `sourceFile` on an **admin-only provenance card** so the
  "where did this record come from" audit trail is preserved. Field stays in the
  schema and in the data — display-only removal from the agent surface.

### 6. Unified import template + smart column mapping
- One **unified import template** for buyer data, plus **smart column mapping** that
  detects the common header variants (name / phone / country / project / tower / unit /
  property type / area / transaction value / date / agent / source) and maps them to the
  existing `BuyerRecord` fields — unmapped columns preserved verbatim in the existing
  `rawImport` JSON (no data dropped), matching the lead-importer convention.

---

## Build order

Ship in this sequence so each layer rests on a verified one:

1. **Classification compute (#1)** — engine is in place (`buyerClassification.ts`);
   confirm thresholds with the owner and lock the rollup query.
2. **Badge + Portfolio (#2)** — read-only surfacing of #1 on detail + list.
3. **Classification filter (#3)** — filter over the same computed rollup as #2.
4. **Country dropdown + backfill (#4)** — editable field + backup-first data backfill.
5. **Remove Source from UI / keep provenance card (#5)** — display-only change.
6. **Unified import template + smart mapping (#6)** — last, because it feeds clean
   country + values into everything above.

---

## Non-negotiable gate between every feature

**EACH feature gets, before the next one starts:**

1. **Production verification** — confirmed working against live data (the values it
   computes/shows reconcile with the underlying `BuyerRecord` rows).
2. **Role-permission check** — buyer data stays ADMIN/owner-scoped via
   `buyerScopeWhere` / `canTouchBuyer`; the market gate holds (Dubai = visible,
   India = not); no leakage to agents who shouldn't see buyer data.
3. **Full regression** — `scripts/regression.ts` green, with any new buyer invariant
   mirrored into it, **before** moving on.

No feature proceeds until the prior one has cleared all three. All Phase 2 work is
additive, reversible, and touches no lifecycle engine, no schema, and no migration.
