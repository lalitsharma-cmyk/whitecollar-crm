// ═════════════════════════════════════════════════════════════════════════════
// BUDGET-BASED ROUTING CONDITIONS (Lalit 2026-07-17) — an extension of the Admin
// Lead Routing Rules. Pure module (no prisma / server-only) so the engine
// (leadRouting.ts), the rule validator (routing-rules/shared.ts), the admin UI
// (RoutingRulesClient), and the regression suite can all import it.
//
// KEY DESIGN — no schema change, no currency conversion:
//   • The condition lives in the RoutingRule's existing `scope` Json as
//     `scope.budget = { op, min?, max? }`. No migration.
//   • Currency is IMPLIED by the rule's team: India → INR, Dubai → AED. A budget
//     rule MUST target exactly one team (enforced by the validator), so INR and
//     AED are NEVER compared to each other — the team scope already isolates them.
//   • `Lead.budgetMin/budgetMax` are ALREADY normalized numeric values in the
//     lead's own currency, and parseBudget() normalizes "1 Cr" / "100 lakh" /
//     "2M" / "10000000" for the admin's inputs. So both sides are plain numbers
//     in the same currency at comparison time.
//   • A lead's "routing budget" = budgetMin ?? budgetMax (the entered / lower
//     bound). If you prefer the ceiling, flip the two in leadRoutingBudget().
// ═════════════════════════════════════════════════════════════════════════════
import { parseBudget } from "@/lib/budgetParse";

export type BudgetOp =
  | "lt" | "lte" | "gt" | "gte" | "between" | "eq"   // numeric — need an available budget
  | "blank" | "invalid" | "available";               // presence — no numeric threshold

export const BUDGET_OPS: BudgetOp[] = ["lt", "lte", "gt", "gte", "between", "eq", "blank", "invalid", "available"];
export const NUMERIC_BUDGET_OPS: BudgetOp[] = ["lt", "lte", "gt", "gte", "between", "eq"];

/** The condition stored in scope.budget. `min` is the single threshold for
 *  lt/lte/gt/gte/eq; `min`+`max` bound `between`. presence ops carry neither. */
export interface BudgetCondition {
  op: BudgetOp;
  min?: number;
  max?: number;
}

export type BudgetState = "available" | "blank" | "invalid";

export const BUDGET_OP_LABELS: Record<BudgetOp, string> = {
  lt: "Less than",
  lte: "Less than or equal to",
  gt: "Greater than",
  gte: "Greater than or equal to",
  between: "Between",
  eq: "Exactly",
  blank: "No budget / blank",
  invalid: "Budget invalid / unparseable",
  available: "Budget is available",
};

/** India → INR, Dubai → AED. Any other/unknown team → null (a budget rule must
 *  pick one of these two, so null is a validation failure upstream). */
export function currencyForTeam(team: string | null | undefined): "INR" | "AED" | null {
  if (team === "India") return "INR";
  if (team === "Dubai") return "AED";
  return null;
}

/** The lead's single routing budget + a presence state, in the rule's currency.
 *  - value = budgetMin ?? budgetMax (numbers are already normalized in the
 *    lead's currency).
 *  - state "available" only when a numeric value exists AND its currency matches
 *    the rule's expected currency (never compare INR vs AED). "blank" = no number
 *    and no raw text. "invalid" = raw text present but unparsed, OR currency
 *    mismatch / UNKNOWN. */
export function leadRoutingBudget(
  lead: { budgetMin?: number | null; budgetMax?: number | null; budgetCurrency?: string | null; budgetRaw?: string | null },
  expectedCurrency: "INR" | "AED" | null,
): { value: number | null; state: BudgetState } {
  const value = lead.budgetMin ?? lead.budgetMax ?? null;
  if (value == null) {
    return { value: null, state: (lead.budgetRaw ?? "").trim() ? "invalid" : "blank" };
  }
  const ccy = (lead.budgetCurrency ?? "").toUpperCase();
  // No currency constraint (rule has no single team → shouldn't happen for a
  // budget rule) → trust the number. Otherwise require an exact currency match.
  if (!expectedCurrency || ccy === expectedCurrency) return { value, state: "available" };
  return { value: null, state: "invalid" }; // currency mismatch — do NOT compare across INR/AED
}

/** Parse scope.budget Json → a validated BudgetCondition, or null (no condition).
 *  Tolerant: a malformed condition returns null so intake never crashes. */
export function parseBudgetCondition(v: unknown): BudgetCondition | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const op = typeof o.op === "string" ? (o.op as BudgetOp) : null;
  if (!op || !BUDGET_OPS.includes(op)) return null;
  const num = (x: unknown): number | undefined => {
    if (typeof x === "number" && isFinite(x) && x >= 0) return x;
    return undefined;
  };
  const cond: BudgetCondition = { op };
  const min = num(o.min);
  const max = num(o.max);
  if (op === "between") {
    if (min == null || max == null) return null;
    cond.min = Math.min(min, max);
    cond.max = Math.max(min, max);
  } else if (NUMERIC_BUDGET_OPS.includes(op)) {
    if (min == null) return null;
    cond.min = min;
  }
  return cond;
}

/** Normalize an admin's budget input ("1 Cr", "5M", "AED 2,000,000", 10000000)
 *  to a plain number — the same parser used across intake/import. */
export function normalizeBudgetInput(raw: string | number | null | undefined): number | null {
  return parseBudget(raw);
}

/** Does a lead's budget satisfy the condition? No condition → true (unconstrained).
 *  Numeric ops require an AVAILABLE budget; a blank/invalid budget never matches a
 *  numeric op (it must be caught by a dedicated blank/invalid rule — spec §7). */
export function budgetMatches(
  cond: BudgetCondition | null | undefined,
  budget: { value: number | null; state: BudgetState },
): boolean {
  if (!cond) return true;
  switch (cond.op) {
    case "blank": return budget.state === "blank";
    case "invalid": return budget.state === "invalid";
    case "available": return budget.state === "available";
    default: break; // numeric
  }
  if (budget.state !== "available" || budget.value == null) return false;
  const v = budget.value;
  const min = cond.min ?? 0;
  switch (cond.op) {
    case "lt": return v < min;
    case "lte": return v <= min;
    case "gt": return v > min;
    case "gte": return v >= min;
    case "eq": return v === min;
    case "between": return v >= min && v <= (cond.max ?? min);
    default: return false;
  }
}

/** Human summary of a budget condition for the rule list / summary line.
 *  `fmt` renders a number in the rule's currency (₹ Cr / AED M) — supplied by
 *  the caller so this module stays currency-agnostic. */
export function budgetConditionLabel(cond: BudgetCondition | null | undefined, fmt: (n: number) => string): string | null {
  if (!cond) return null;
  switch (cond.op) {
    case "blank": return "No budget";
    case "invalid": return "Budget invalid";
    case "available": return "Budget available";
    case "between": return `${fmt(cond.min ?? 0)}–${fmt(cond.max ?? 0)}`;
    case "lt": return `< ${fmt(cond.min ?? 0)}`;
    case "lte": return `≤ ${fmt(cond.min ?? 0)}`;
    case "gt": return `> ${fmt(cond.min ?? 0)}`;
    case "gte": return `≥ ${fmt(cond.min ?? 0)}`;
    case "eq": return `= ${fmt(cond.min ?? 0)}`;
    default: return null;
  }
}

/** Prisma-where fragment for the "apply to existing leads" preview/apply — the
 *  DB twin of budgetMatches, so the affected-count equals what the engine routes.
 *  Compares budgetMin (the routing value) with a budgetMax fallback via OR.
 *  `expectedCurrency` scopes to leads in the rule's currency (no INR/AED mixing).
 *  Returns null for presence ops the caller handles specially (blank/invalid). */
export function budgetWhereFragment(
  cond: BudgetCondition | null | undefined,
  expectedCurrency: "INR" | "AED" | null,
): Record<string, unknown> | null {
  if (!cond) return null;
  const ccy = expectedCurrency ? { budgetCurrency: expectedCurrency } : {};
  // routing value = budgetMin ?? budgetMax. For the DB, match on budgetMin when
  // present, else budgetMax — expressed as an OR so both single-value and
  // range leads are covered consistently with leadRoutingBudget().
  const onValue = (clause: Record<string, unknown>) => ({
    ...ccy,
    OR: [
      { budgetMin: clause },
      { AND: [{ budgetMin: null }, { budgetMax: clause }] },
    ],
  });
  switch (cond.op) {
    case "blank": return { budgetMin: null, budgetMax: null };
    case "available": return { ...ccy, OR: [{ budgetMin: { not: null } }, { budgetMax: { not: null } }] };
    case "invalid": return null; // needs raw-text + currency logic — caller filters in JS
    case "lt": return onValue({ lt: cond.min });
    case "lte": return onValue({ lte: cond.min });
    case "gt": return onValue({ gt: cond.min });
    case "gte": return onValue({ gte: cond.min });
    case "eq": return onValue({ equals: cond.min });
    case "between": return onValue({ gte: cond.min, lte: cond.max });
    default: return null;
  }
}
