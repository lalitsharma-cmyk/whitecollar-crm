// BANT qualification helpers.
//
// The stage-gate is removed — there are no stages, only statuses.
// BANT remains informational: the N/4 captured pill on lead detail
// shows how complete the qualification is, but nothing is blocked.
//
// bantFilledCount() and missingBantLetters() are kept for the pill UI.
// evaluateBantGate() always returns NOT_GATED (kept for API compat).

import type { BantGateMode } from "./settings";

// The subset of Lead fields the gate inspects.
export interface BantFields {
  budgetMin: number | null;
  authorityLevel: string | null;
  needSummary: string | null;
  whenCanInvest: string | null;
}

export function bantFilledCount(l: BantFields): number {
  const budgetFilled = l.budgetMin != null && l.budgetMin > 0;
  const authFilled = l.authorityLevel != null && l.authorityLevel !== "UNKNOWN";
  const needFilled = !!(l.needSummary && l.needSummary.trim());
  const timeFilled = l.whenCanInvest != null && l.whenCanInvest !== "UNKNOWN";
  return [budgetFilled, authFilled, needFilled, timeFilled].filter(Boolean).length;
}

export function missingBantLetters(l: BantFields): string[] {
  const budgetFilled = l.budgetMin != null && l.budgetMin > 0;
  const authFilled = l.authorityLevel != null && l.authorityLevel !== "UNKNOWN";
  const needFilled = !!(l.needSummary && l.needSummary.trim());
  const timeFilled = l.whenCanInvest != null && l.whenCanInvest !== "UNKNOWN";
  const missing: string[] = [];
  if (!budgetFilled) missing.push("Budget");
  if (!authFilled) missing.push("Authority");
  if (!needFilled) missing.push("Need");
  if (!timeFilled) missing.push("Timeline");
  return missing;
}

export interface BantGateResult {
  gated: boolean;
  blocked: boolean;
  warn: boolean;
  missing: string[];
  message: string | null;
}

const NOT_GATED: BantGateResult = {
  gated: false,
  blocked: false,
  warn: false,
  missing: [],
  message: null,
};

// No stages → gate never fires. Kept for API compatibility.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function evaluateBantGate(_args: {
  targetStatus: string;
  lead: BantFields;
  mode: BantGateMode;
}): BantGateResult {
  return NOT_GATED;
}
