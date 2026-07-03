// Shared call / conversation outcome vocabulary — the ONE module for both
// CLASSIFYING a stored outcome (the lead analytics bar) and PRODUCING the
// free-text label written to Activity.outcome (every CALL write path + the
// backfill). Centralised so the label format can never drift between the
// log-call route, the telephony sink, the Acefone webhook, the click-to-call
// tap and the Buyer→Lead carry-over (data-consistency rule: existing + future,
// no dual logic).
//
// The classification helpers below are DISPLAY-ONLY (derive from CallLog.outcome
// + notes + WhatsAppMessage direction; never change stored data). The write-side
// label helpers are at the bottom of the file.

export const CONNECTED_OUTCOMES = new Set(["CONNECTED", "INTERESTED", "NOT_INTERESTED"]);
export const UNSUCCESSFUL_OUTCOMES = new Set(["NOT_PICKED", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALLBACK"]);

/** A CONNECTED row whose notes say "dropped wa" is really a one-way send → NOT_PICKED. */
export function effectiveOutcome(outcome: string, notes: string | null | undefined): string {
  if (outcome === "CONNECTED" && notes && /dropped\s*wa/i.test(notes)) return "NOT_PICKED";
  return outcome;
}

/** Notes from a WhatsApp-channel log ("💬 WA in — …" / "💬 WA out — …"). */
export function isWaNote(notes: string | null | undefined): boolean {
  return !!notes && /^\s*💬\s*WA\s+(in|out)\b/i.test(notes);
}
/** A WhatsApp INBOUND log — the client replied ("💬 WA in — …"). */
export function isWaInbound(notes: string | null | undefined): boolean {
  return !!notes && /^\s*💬\s*WA\s+in\b/i.test(notes);
}

// Broadened "unsuccessful" free-text detector. ANCHORED on a negative phrase so a
// genuine "client picked up" is never flagged. Covers: no answer, not picked
// (pic/piced/piked/picku misspellings), call not picked, "not received/recieved",
// forwarded to voicemail, will call back, call later, switched off, not reachable.
const UNSUCCESSFUL_TEXT = new RegExp(
  [
    "no\\s*answer",
    "not\\s*answer(ed|ing)?",
    "(not|never|didn'?t|couldn'?t|could\\s*not|un)\\s*(picked|pickup|pick\\s*up|pick|pic|piced|piked|picku)",
    "call\\s*not\\s*pick",
    "(not|never)\\s*(recieved|received|reciev|receiv)",
    "forwarded?\\s*to\\s*voice\\s*?mail",
    "voice\\s?mail",
    "will\\s*call\\s*back",
    "call\\s*(back\\s*)?later",
    "switch(ed)?\\s*off",
    "not\\s*reachable",
  ].join("|"),
  "i",
);
export function isUnsuccessfulText(notes: string | null | undefined): boolean {
  return !!notes && UNSUCCESSFUL_TEXT.test(notes);
}

// ── WRITE-SIDE: the canonical Activity.outcome label ─────────────────────────
// Used by every path that CREATES a CALL Activity, so the stored value is
// identical forward and historical. FORMAT = the CallOutcome enum token with
// underscores → spaces (CONNECTED → "CONNECTED", NOT_PICKED → "NOT PICKED").
// This is byte-for-byte what the primary log-call route has always written and
// what the 2000+ historical rows + scripts/backfill-activity-outcome.ts use, so
//   • ConversationStreamCard renders it verbatim as a chip (old == new), and
//   • followupGate.isConnectedOutcome() (which upper-cases before matching
//     {"CONNECTED","INTERESTED"}) keeps recognising a connected call.
// Param is typed `string` (not the Prisma CallOutcome) so this client-usable
// file stays free of a @prisma/client value import; enum members ARE strings.

/** Free-text Activity.outcome label for a structured CallOutcome / outcome token. */
export function callOutcomeLabel(outcome: string): string {
  return String(outcome).replaceAll("_", " ");
}

/**
 * Outcome for a CALL Activity that records the agent TAPPING the call button
 * (click-to-call) — a dial placed with no result captured yet. The real call
 * outcome, once the agent logs it, lands on its OWN Activity via log-call; this
 * tap is a distinct event and its honest label is "Initiated". Non-null so a
 * tap can never erode the CALL-outcome data-integrity invariant.
 */
export const CALL_OUTCOME_INITIATED = "Initiated";

/**
 * Safe generic outcome for a CALL Activity with no structured CallOutcome to
 * derive from — e.g. a buyer-conversation call carried into a Lead timeline on
 * Buyer→Lead conversion (the real detail is preserved in the entry description).
 * Non-null so the carry-over can't reintroduce the null-outcome gap.
 */
export const CALL_OUTCOME_LOGGED = "Logged";
