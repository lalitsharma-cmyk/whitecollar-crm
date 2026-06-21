// Shared call / conversation outcome classification for the lead analytics bar.
// DISPLAY-ONLY: derives from CallLog.outcome + notes + WhatsAppMessage direction;
// never changes stored data. Keeps "Connected / Unsuccessful / WhatsApp" consistent.

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
