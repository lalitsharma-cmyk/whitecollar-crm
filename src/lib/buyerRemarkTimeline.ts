// ────────────────────────────────────────────────────────────────────────────
// buyerRemarkTimeline.ts — turn an imported BuyerRecord.remarks blob into the
// Smart Timeline (BuyerActivity rows), the buyer-side mirror of how Lead imports
// derive their conversation timeline from Lead.remarks (parseRemarksTimeline).
//
// PARITY WITH LEADS
//   • Uses the SAME parser the Lead view uses — parseRemarksTimeline() from
//     remarkParser.ts — so dated segments ("On 19 Jun 2026 (3:30pm) …") become
//     individually-dated entries with the historical date honored, and undated
//     fragments attach to the nearest preceding dated entry (or a supplied
//     fallback = the buyer's import/createdAt date) exactly as for leads.
//   • Each parsed entry → ONE BuyerActivity row, with createdAt = the entry's
//     parsed (historical) date, else the fallback import date.
//   • The activity `type` is mapped from the parsed event type to the EXISTING
//     BuyerActivity vocabulary the timeline UI already renders (CALL / WHATSAPP /
//     NOTE) — no new type a UI doesn't know about. A site-visit / meeting / any
//     conversational line classifies as CALL (it WAS a contact); pure notes → NOTE;
//     WhatsApp mentions → WHATSAPP. Imported rows are tagged "(imported)" in the
//     description so they read as historical, never as live agent-logged contacts.
//
// Pure module (no "server-only", no prisma import) so it is unit-testable and
// callable from the regression harness, the import route, and the backfill script.
// The caller persists the returned plan inside its own transaction.
// ────────────────────────────────────────────────────────────────────────────

import { parseRemarksTimeline, type RemarkEventType } from "@/lib/remarkParser";

/** A single BuyerActivity row to create, derived from one parsed remark entry. */
export interface BuyerActivityPlan {
  /** BuyerActivity.type — one of the values the timeline UI renders. */
  type: "CALL" | "WHATSAPP" | "NOTE";
  /** BuyerActivity.description — the clean entry text, tagged as imported. */
  description: string;
  /** BuyerActivity.createdAt — the entry's historical date, or the import fallback. */
  createdAt: Date;
}

// Suffix that marks a timeline row as derived from imported remarks (vs a live
// agent-logged contact). Kept as a constant so the import route, the backfill
// script, and the regression all agree on the exact idempotency marker.
export const IMPORTED_TAG = " (imported)";

/** Map a parsed remark event type → the existing BuyerActivity vocabulary.
 *  Conversational/visit/meeting lines = a CALL (a real contact happened);
 *  everything else = a NOTE. WhatsApp is detected from the text by the caller. */
function buyerTypeFor(ev: RemarkEventType, text: string): "CALL" | "WHATSAPP" | "NOTE" {
  // A WhatsApp mention routes to the WHATSAPP lane (matches the Lead view's WA chip).
  if (/\bwhats?app\b|\bwa\b/i.test(text)) return "WHATSAPP";
  switch (ev) {
    case "CALL_CONNECTED":
    case "CALL_CALLBACK":
    case "CALL_NOT_PICKED":
    case "CALL_BUSY":
    case "CALL_SWITCHED_OFF":
    case "CALL_NOT_INTERESTED":
    case "SITE_VISIT":
    case "MEETING":
    case "VIRTUAL_MEETING":
      return "CALL";
    default:
      return "NOTE";
  }
}

/**
 * Build the BuyerActivity Smart-Timeline plan from an imported remarks blob.
 *
 * @param remarks       The raw BuyerRecord.remarks text (verbatim imported).
 * @param fallbackDate  The import/createdAt date — used for entries with no
 *                      historical date of their own (parity with leads, where the
 *                      undated-first-entry falls back to the lead's createdAt).
 * @param agentNames    Known agent roster (for "Yasir: …" attribution parity). The
 *                      buyer importer passes [] (no per-entry attribution needed) or
 *                      the roster when available; either is safe.
 * @returns one BuyerActivityPlan per parsed entry, chronological (oldest first).
 *          Empty when the blob has no substantive content.
 */
export function buildBuyerTimelinePlan(
  remarks: string | null | undefined,
  fallbackDate: Date,
  agentNames: string[] = [],
): BuyerActivityPlan[] {
  const cell = (remarks ?? "").trim();
  if (!cell) return [];

  const entries = parseRemarksTimeline(cell, agentNames, fallbackDate);
  const plan: BuyerActivityPlan[] = [];
  for (const e of entries) {
    const text = (e.text ?? "").trim();
    if (text.length < 2) continue;
    const when = e.date ?? fallbackDate;
    const type = buyerTypeFor(e.eventType, text);
    // Prefix the agent (if the parser resolved one) so "Yasir: …" history reads
    // the same as on a lead, then tag it as imported for idempotency + clarity.
    const who = e.agentName ? `${e.agentName}: ` : "";
    plan.push({ type, description: `${who}${text}${IMPORTED_TAG}`, createdAt: when });
  }
  return plan;
}

/** True when a BuyerActivity description was generated from imported remarks
 *  (carries the IMPORTED_TAG). Used to make the import + backfill idempotent:
 *  on a re-run we delete/skip the previously-generated imported rows rather than
 *  duplicating them. Live agent-logged rows never carry the tag, so they are
 *  never touched. */
export function isImportedActivityDescription(description: string | null | undefined): boolean {
  return typeof description === "string" && description.includes(IMPORTED_TAG.trim());
}

// ── Compose a remark blob from short status-like columns ──────────────────────
// Some buyer sheets have no free-text "Remarks" column — the only history-like
// data is short status tokens spread across columns (Status, Status 2, Follow-Up,
// Notes, Comments). To give those a Raw History + Smart Timeline (instead of
// leaving them inert in extraFields), compose them into ONE labeled remark line,
// preserving each value verbatim. A real "Remarks"/"Notes" free-text column, when
// present, is used as-is by the caller and takes precedence — this is the fallback.
//
// Excel serial follow-up dates ("46152") are converted to a readable date so the
// composed remark isn't a meaningless number; any non-serial value is kept verbatim.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // Excel serial 0 = 1899-12-30
function readableFollowup(v: string): string {
  const s = v.trim();
  // Pure-integer Excel serial in the plausible date range → ISO date.
  if (/^\d{4,6}$/.test(s)) {
    const n = parseInt(s, 10);
    if (n > 30000 && n < 80000) {
      const d = new Date(EXCEL_EPOCH_MS + n * 86400000);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    }
  }
  return s;
}

/** Build a single labeled remark line from a map of status-like fields, e.g.
 *  { Status: "Moved To MIS", "Status 2": "Cool Off", "Follow-Up": "46152" }
 *  → "Status: Moved To MIS · Status 2: Cool Off · Follow-Up: 2026-05-22".
 *  Empty/blank values are dropped; returns "" when nothing usable is present. */
export function composeRemarkFromFields(fields: Record<string, string | null | undefined>): string {
  const parts: string[] = [];
  for (const [label, raw] of Object.entries(fields)) {
    const v = String(raw ?? "").trim();
    if (!v) continue;
    const val = /follow.?up/i.test(label) ? readableFollowup(v) : v;
    parts.push(`${label}: ${val}`);
  }
  return parts.join(" · ");
}
