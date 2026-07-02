// AI Sales OS — apply-safety core (M4), PURE + unit-testable. This is the ONLY
// gate through which the AI may propose a WRITE. Three hard rules, enforced here so
// no apply path can bypass them:
//   1. The mutation must be marked reversible (type-level `reversible: true`).
//   2. The field must be on the tiny AI_APPLY_WHITELIST (derived, safe, reversible
//      fields only — never a name/phone/remark/status).
//   3. A non-empty target value.
// Everything else (execution + audit + before-check) is the IO wrapper (applyService).
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiMutation } from "./types";

/** The COMPLETE set of fields the AI is ever allowed to write, per entity. Start
 *  minimal: only the derived India/UAE market (recomputable from team → fully
 *  reversible). Growing this list is a deliberate, reviewed decision. */
export const AI_APPLY_WHITELIST: Record<string, ReadonlySet<string>> = {
  Lead: new Set(["market"]),
};

export type PlanResult =
  | { ok: true; mutation: AiMutation }
  | { ok: false; reason: string };

export function planApply(mutation: AiMutation): PlanResult {
  if (!mutation.reversible) return { ok: false, reason: "mutation is not marked reversible" };
  const fields = AI_APPLY_WHITELIST[mutation.entity];
  if (!fields || !fields.has(mutation.field)) {
    return { ok: false, reason: `${mutation.entity}.${mutation.field} is not on the AI apply whitelist` };
  }
  if (mutation.to == null || mutation.to === "") return { ok: false, reason: "target value is empty" };
  if (mutation.to === mutation.from) return { ok: false, reason: "no-op (value unchanged)" };
  return { ok: true, mutation };
}

/** Human-readable description for the audit trail / approval UI. */
export function describeApply(mutation: AiMutation): string {
  return `Set ${mutation.entity}.${mutation.field}: ${JSON.stringify(mutation.from)} → ${JSON.stringify(mutation.to)}`;
}
