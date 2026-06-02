// Pure helper for the BANT qualification stage-gate.
//
// "Has this lead captured enough BANT to be Qualified?" lives here so the same
// logic backs every entry point (the Kanban stage route + the inline-edit
// route). The signal-counting logic is kept EXACTLY in sync with the lead
// detail page (src/app/(app)/leads/[id]/page.tsx, the bant*Filled booleans) so
// the count an agent sees on the lead matches the gate's decision.
//
// No DB / framework imports — caller passes the already-loaded fields and the
// configured mode. SOFT is the only non-blocking warn mode; only HARD blocks.

import type { BantGateMode } from "./settings";

// Stages at/after "Qualified" that require BANT. NEW / CONTACTED / LOST are
// NEVER gated — an agent must be free to move early-funnel or dead leads
// around without any BANT nag.
export const BANT_GATED_STATUSES = [
  "QUALIFIED",
  "SITE_VISIT",
  "NEGOTIATION",
  "BOOKING_DONE",
  "WON",
] as const;

// The subset of Lead fields the gate inspects. A full `prisma.lead` row is
// structurally assignable to this, so callers can pass the loaded lead directly.
export interface BantFields {
  budgetMin: number | null;
  authorityLevel: string | null;
  needSummary: string | null;
  whenCanInvest: string | null;
}

// EXACT mirror of the lead detail page logic (page.tsx ~215-229):
//   budgetFilled = budgetMin != null && budgetMin > 0
//   authFilled   = authorityLevel != null && authorityLevel !== "UNKNOWN"
//   needFilled    = !!(needSummary && needSummary.trim())
//   timeFilled    = whenCanInvest != null && whenCanInvest !== "UNKNOWN"
export function bantFilledCount(l: BantFields): number {
  const budgetFilled = l.budgetMin != null && l.budgetMin > 0;
  const authFilled = l.authorityLevel != null && l.authorityLevel !== "UNKNOWN";
  const needFilled = !!(l.needSummary && l.needSummary.trim());
  const timeFilled = l.whenCanInvest != null && l.whenCanInvest !== "UNKNOWN";
  return [budgetFilled, authFilled, needFilled, timeFilled].filter(Boolean).length;
}

// Human-readable list of the BANT signals NOT yet captured, in B/A/N/T order.
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
  /** Does this transition fall under the gate (gated stage + <4 captured + mode!=off)? */
  gated: boolean;
  /** HARD mode + gated → the move must be rejected (422). */
  blocked: boolean;
  /** SOFT mode + gated → allow the move but surface a warning. */
  warn: boolean;
  /** Unfilled BANT signals (empty when not gated). */
  missing: string[];
  /** Ready-to-show message, or null when not gated. */
  message: string | null;
}

const NOT_GATED: BantGateResult = {
  gated: false,
  blocked: false,
  warn: false,
  missing: [],
  message: null,
};

// Decide whether moving `lead` to `targetStatus` under `mode` should be
// blocked / warned / allowed. Pure + side-effect free.
export function evaluateBantGate(args: {
  targetStatus: string;
  lead: BantFields;
  mode: BantGateMode;
}): BantGateResult {
  const { targetStatus, lead, mode } = args;
  // OFF → never anything.
  if (mode === "off") return NOT_GATED;
  // Only Qualified+ stages are gated; NEW / CONTACTED / LOST pass through.
  if (!(BANT_GATED_STATUSES as readonly string[]).includes(targetStatus)) return NOT_GATED;
  const count = bantFilledCount(lead);
  // Fully captured → nothing to gate.
  if (count === 4) return NOT_GATED;
  const missing = missingBantLetters(lead);
  const message = `BANT incomplete (${count}/4 captured). Missing: ${missing.join(", ")}.`;
  return {
    gated: true,
    blocked: mode === "hard",
    warn: mode === "soft",
    missing,
    message,
  };
}
