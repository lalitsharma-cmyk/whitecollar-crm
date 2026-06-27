// Parses a Lead.remarks cell (imported from Nitisha MIS / Master Sheet) into a
// structured timeline of interaction entries.
//
// Design goals (from Lalit's spec 2026-06):
//   1. Every remark is shown — nothing is discarded.
//   2. No technical labels ("Historical Note", "Imported From Excel", "1 Jan 1970").
//   3. Agent ownership is preserved: "Yasir: <entries>" → all entries tagged Yasir
//      until the next known-agent prefix appears.
//   4. Only names from the KNOWN AGENT ROSTER become agents. Random words that look
//      like names ("Golf Island", "December") are kept as plain text.
//   5. Undated entries are attached to the nearest preceding dated entry (or the
//      lead's createdAt if no dated entry exists).
//   6. Consecutive identical low-signal outcomes (not picked, busy, switched off)
//      are grouped into "X times, DD Mon – DD Mon" to keep the timeline readable.

import { CallOutcome } from "@prisma/client";
import { canonicalAgentName } from "@/lib/agentName";

// ─── Date/time helpers ──────────────────────────────────────────────────────

export const MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,
  october:9,november:10,december:11,
};

// Every timestamp in MIS sheets is IST wall-clock time. Build the UTC instant
// by treating h/m as IST and subtracting the IST offset.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Expand a 2-digit year ("26" → 2026). MIS sheets write "19-Jun-26".
function expandYear(y: number): number { return y < 100 ? 2000 + y : y; }

export function parseDateTime(dateStr: string, timeStr?: string): Date | null {
  // Accept space / hyphen / slash / dot between day-month-year + a 2- OR 4-digit
  // year ("19 Jun 2026", "19-Jun-26", "19/Jun/2026"). Hyphenated month-name dates
  // used to FAIL here → the remark became UNDATED and folded into the previous
  // timeline card instead of starting its own dated event.
  const m = dateStr.match(/(\d{1,2})[\s\-/.]+([A-Za-z]+)[\s\-/.]+(\d{2,4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const yr = expandYear(parseInt(m[3]));
  let h = 12, mins = 0;
  if (timeStr) {
    // Accept BOTH ":" and "." as the hour:minute separator — MIS sheets write
    // both "9:15 PM" and "5.30 pm". Without "." the minutes + am/pm were dropped
    // ("5.30 pm" → parsed as "5:00 am").
    const tm = timeStr.match(/(\d{1,2})[:.]?(\d{0,2})\s*(am|pm)?/i);
    if (tm) {
      h = parseInt(tm[1]);
      mins = parseInt(tm[2] || "0");
      const ampm = (tm[3] ?? "").toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
  }
  return new Date(Date.UTC(yr, mon, day, h, mins) - IST_OFFSET_MS);
}

// Date-only remarks carry NO clock time. Store them at NOON IST (= 06:30 UTC) — a
// sentinel ConversationStreamCard.hasTime() recognises as "no real time", so it
// renders the date alone instead of inventing a clock time. (Previously stored at
// 01:00 UTC = 6:30 AM IST, which made every undated remark show a spurious "6:30 am".)
function dateOnlyNoonIST(yr: number, mon: number, day: number): Date {
  return new Date(Date.UTC(yr, mon, day, 6, 30)); // 06:30 UTC === 12:00 IST (noon)
}

// ── Display-only body cleanup ─────────────────────────────────────────────────
// Imported MIS remarks arrive with parser / copy artifacts that must not appear
// in the readable body — the date / time / name belong in the card header:
//   • square brackets from "[date] text" tagging  → "] he said…" / "…text]"
//   • a leading "From (Name)" / "From [date]" wrapper
//   • empty "()" left behind after a time token was pulled out
//   • leading stray punctuation ") not picked" / "| he said"
// Raw History keeps the verbatim original; this only changes what is rendered.
function cleanRemarkBody(text: string): string {
  let t = (text ?? "").trim();
  t = t.replace(/^from\s*[([][^)\]]*[)\]]\s*[:,\-]?\s*/i, ""); // "From (X)" / "From [X]" wrapper
  t = t.replace(/[[\]]/g, " ");          // square brackets are always import artifacts here
  t = t.replace(/\(\s*\)/g, " ");        // empty round parens
  t = t.replace(/^[)(>|\s,.;:–—-]+/, ""); // leading stray bracket / punctuation
  return t.replace(/\s{2,}/g, " ").trim();
}

// Pull a leading clock time off a body — "(3:33pm) He said…" / "10:35am called" —
// so it becomes the entry's time (combined with its date in pass 3) and the body
// starts at the actual words. Returns the time string + the remaining body.
function extractLeadingTime(body: string): { timeStr: string | null; rest: string } {
  const m = body.match(/^[([]?\s*(\d{1,2}[:.]\d{2}\s*[ap]\.?\s*m\.?|\d{1,2}\s*[ap]\.?\s*m\.?|\d{1,2}[:.]\d{2})\s*[)\]]?[\s,:\-]*/i);
  if (m && m[1]) return { timeStr: m[1].replace(/\s+/g, ""), rest: body.slice(m[0].length) };
  return { timeStr: null, rest: body };
}

// Combine a base date (any UTC instant) with an IST wall-clock time string,
// returning the precise UTC instant for that IST date + time.
function withISTTime(baseDate: Date, timeStr: string): Date | null {
  const tm = timeStr.match(/(\d{1,2})[:.]?(\d{0,2})\s*(am|pm)?/i);
  if (!tm) return null;
  let h = parseInt(tm[1]); const mins = parseInt(tm[2] || "0");
  const ampm = (tm[3] ?? "").toLowerCase();
  if (ampm === "pm" && h < 12) h += 12;
  if (ampm === "am" && h === 12) h = 0;
  if (h > 23 || mins > 59) return null;
  const ist = new Date(baseDate.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), h, mins) - IST_OFFSET_MS);
}

// Date-only noon sentinel (06:30 UTC = 12:00 IST): the entry has NO real clock
// time, so two such entries on the same day are DISTINCT remarks — never merged.
// EXPORTED so the Smart Timeline render can show the DATE ALONE for these entries
// (no invented clock time) exactly the way the parser intends them.
export function isNoonSentinel(d: Date): boolean {
  return d.getUTCHours() === 6 && d.getUTCMinutes() === 30;
}

function tryExtractDate(line: string): Date | null {
  const mLong = line.match(/(?:^|[^a-z])(\d{1,2})[\s\-/.]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/.,]+(\d{2,4})/i);
  if (mLong) {
    const d = parseInt(mLong[1]);
    const mon = MONTHS[mLong[2].toLowerCase().slice(0,4)] ?? MONTHS[mLong[2].toLowerCase()];
    const yr = expandYear(parseInt(mLong[3]));
    if (mon !== undefined) return dateOnlyNoonIST(yr, mon, d);
  }
  const mISO = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (mISO) {
    return dateOnlyNoonIST(parseInt(mISO[1]), parseInt(mISO[2]) - 1, parseInt(mISO[3]));
  }
  const mDMY = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (mDMY) {
    const day = parseInt(mDMY[1]), mon = parseInt(mDMY[2]) - 1, yr = expandYear(parseInt(mDMY[3]));
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11)
      return dateOnlyNoonIST(yr, mon, day);
  }
  return null;
}

// Extract a date ONLY when the text STARTS with it ("5 Jul 2026 called", "17-May-26
// not picked"). A date buried MID-SENTENCE ("…attending the Expo on 4-5 July 2026",
// "his mother passed away on 1 April") is CLIENT-MESSAGE CONTENT and must NEVER
// become a timeline event date. This is the anchored counterpart to tryExtractDate
// (which scans the whole line) — used for non-"On…" content lines so a client's
// message is never re-dated to a date it merely mentions. (Lalit 2026-06-28, critical.)
function leadingDate(text: string): Date | null {
  const t = (text ?? "").trimStart();
  const mLong = t.match(/^(\d{1,2})[\s\-/.]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/.,]+(\d{2,4})\b/i);
  if (mLong) {
    const mon = MONTHS[mLong[2].toLowerCase().slice(0, 4)] ?? MONTHS[mLong[2].toLowerCase()];
    if (mon !== undefined) return dateOnlyNoonIST(expandYear(parseInt(mLong[3])), mon, parseInt(mLong[1]));
  }
  const mISO = t.match(/^(\d{4})-(\d{2})-(\d{2})\b/);
  if (mISO) return dateOnlyNoonIST(parseInt(mISO[1]), parseInt(mISO[2]) - 1, parseInt(mISO[3]));
  const mDMY = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/);
  if (mDMY) {
    const day = parseInt(mDMY[1]), mon = parseInt(mDMY[2]) - 1, yr = expandYear(parseInt(mDMY[3]));
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) return dateOnlyNoonIST(yr, mon, day);
  }
  return null;
}

// ─── Event-type classification ───────────────────────────────────────────────

export type RemarkEventType =
  | "CALL_CONNECTED"
  | "CALL_NOT_PICKED"
  | "CALL_BUSY"
  | "CALL_SWITCHED_OFF"
  | "CALL_CALLBACK"
  | "CALL_NOT_INTERESTED"
  | "SITE_VISIT"
  | "MEETING"
  | "VIRTUAL_MEETING"
  | "NOTE";

// ─── Completed-event detection (Lalit's rule: "planning ≠ completed event") ────
// A Site Visit / Office Meeting / Virtual Meeting is counted ONLY when the remark
// confirms it actually happened. Planning / proposed / future-intent language
// ("will plan a virtual meeting", "client may visit", "asked to schedule meeting")
// must never be counted — it stays in Conversation History only.
//
// How this stays robust: completion is matched as a marker ADJACENT to the event
// noun, and the auxiliary whitelist (AUX) deliberately excludes future words
// ("to be", "will be", "yet to"), so "meeting to be done" / "visit will be
// completed" structurally cannot match. If unsure, nothing matches → not counted.

// Completion words, end-bounded so "completion"/"redone" don't false-trigger.
const DONE = "(?:done|completed|complete|finished|happened|conducted|concluded|wrapped\\s*up)\\b";
// Allowed connectors between the event noun and the completion word. NOTE: no
// "to be" / "will be" / "yet to" here — that is what blocks planning language.
const AUX = "(?:is\\s+|was\\s+|are\\s+|were\\s+|got\\s+|has\\s+been\\s+|have\\s+been\\s+|already\\s+|just\\s+|now\\s+|successfully\\s+)?";

// Confirmed SITE VISIT (with us / our project).
const SITE_VISIT_DONE = new RegExp(
  `site\\s*visit\\s+${AUX}${DONE}`
  + `|(?:did|completed|finished|conducted|attended)\\s+(?:the\\s+|a\\s+|his\\s+|her\\s+|their\\s+)?site\\s*visit`
  + `|visited\\s+(?:the\\s+)?(?:site|project|property|flat|apartment|unit|sample\\s*flat|tower)`
  + `|(?:site|project)\\s+visited`
  + `|(?:physical|project)\\s+visit\\s+${AUX}${DONE}`   // "physical/project visit conducted/done"
  + `|came\\s+(?:to|down\\s+to)\\s+(?:the\\s+)?(?:site|project)`
  + `|came\\s+for\\s+(?:the\\s+|a\\s+)?(?:site\\s*)?visit\\b`
  + `|went\\s+to\\s+(?:the\\s+)?(?:site|project)\\b`
  // Saw / shown the SAMPLE / MODEL flat — a physical-location noun is now REQUIRED
  // (no trailing `?`), so a bare "saw sample" or "saw sample video" can no longer
  // count. "show" dropped as an adjective for the same reason. The COLLATERAL_SHARE
  // guard in classifyText() is the belt-and-suspenders backstop.
  + `|saw\\s+(?:the\\s+|a\\s+)?(?:sample|actual|model)\\s*(?:flat|apartment|apt|unit|home|villa|house|property)\\b`
  + `|shown\\s+(?:the\\s+|a\\s+)?(?:sample|actual|model)?\\s*(?:flat|apartment|apt|unit|home|villa|property)\\b`
  + `|(?:sample|actual|model)\\s*(?:flat|apartment|apt|unit|home|villa)\\s+(?:was\\s+|got\\s+)?shown\\b`
  + `|\\bsv\\s+done\\b`,
  "i",
);

// Confirmed VIRTUAL MEETING (with our team).
const VIRTUAL_DONE = new RegExp(
  `(?:virtual\\s*meeting|online\\s+meeting|zoom(?:\\s*meeting|\\s*call)?|teams\\s+meeting|google\\s+meet|g-?meet|video\\s+call|virtual\\s+call|vc)\\s+${AUX}${DONE}`
  + `|(?:did|completed|finished|conducted|attended)\\s+(?:the\\s+|a\\s+)?(?:virtual\\s*meeting|online\\s+meeting|zoom|google\\s+meet|video\\s+call|virtual\\s+call|vc)\\b`
  + `|meeting\\s+conducted\\s+virtually`
  + `|met\\s+(?:virtually|online)\\b`
  + `|\\bvc\\s+done\\b`,
  "i",
);

// Confirmed OFFICE MEETING (with us / our agent).
const OFFICE_DONE = new RegExp(
  `office\\s*(?:meeting|visit)\\s+${AUX}${DONE}`
  + `|meeting\\s+${AUX}${DONE}`
  + `|team\\s+meeting\\s+${AUX}${DONE}`
  + `|(?:did|completed|finished|conducted|attended)\\s+(?:the\\s+|a\\s+|an\\s+)?(?:office\\s+)?meeting\\b`
  + `|came\\s+(?:to|down\\s+to|in(?:to)?)\\s+(?:the\\s+|our\\s+)?office`
  + `|visited\\s+(?:the\\s+|our\\s+)?office`
  + `|met\\s+(?:\\w+\\s+){0,6}?(?:at|in)\\s+(?:the\\s+|our\\s+)?office`
  + `|met\\s+(?:with\\s+)?(?:us|our\\s+team)\\b`
  + `|(?:we|our\\s+team|agent)\\s+met\\s+(?:the\\s+)?(?:client|him|her|them)\\b`,
  "i",
);

// Third-party / not-our-meeting context. A meeting or visit must NOT be counted
// as a WCR event when the remark is clearly about the CLIENT dealing with someone
// else — a buyer of their own house (resale), their bank, family, another broker
// or builder, etc. This only suppresses the Office/Site/Virtual classification;
// the remark still shows in Conversation History as a normal note.
// (Lalit's rule: "keyword matching is not enough — understand context; if unsure,
// do NOT count it.")
const THIRD_PARTY = new RegExp(
  [
    // Counterparty is buying/selling the CLIENT'S OWN property (resale) — not our deal.
    "buy(?:ing|er|s)?\\s+(?:his|her|their|my|the\\s+client'?s)\\s+(?:house|home|flat|apartment|property|plot|land|shop|villa)",
    "\\bbuyer\\s+of\\s+(?:his|her|their|my|the)\\b",
    "(?:who|someone|person|party|guy)\\s+(?:is\\s+|who'?s\\s+)?buying\\b",
    "sell(?:ing)?\\s+(?:his|her|their|my)\\s+(?:house|home|flat|apartment|property|plot|land|shop|villa)",
    "\\bresale\\b",
    // A meeting / discussion WITH an external (non-WCR) counterparty.
    "\\bwith\\s+(?:the\\s+|a\\s+|an\\s+|his\\s+|her\\s+|their\\s+|another\\s+|other\\s+|some\\s+)?(?:builder|broker|bank|banker|seller|dealer|lawyer|advocate|accountant|\\bca\\b|another\\s+agent|other\\s+agent)\\b",
    // Standalone third-party meeting types.
    "\\b(?:seller|family|bank|builder|broker)\\s+meeting\\b",
    "\\binternal\\s+(?:discussion|meeting|talk)\\b",
    "\\b(?:another|other)\\s+(?:broker|builder|party|dealer|agent|company)\\b",
    "\\bother\\s+party\\b",
    // Deferring to / reporting on SOMEONE ELSE'S meeting.
    "\\btheir\\s+meeting\\b",
    "\\bwill\\s+update\\s+(?:you\\s+)?(?:once|after|post|when)\\b",
    "\\b(?:meet|meeting|see|seeing)\\s+some\\s*one(?:\\s+else)?\\b",
    "\\bsome\\s*one\\s+else\\b",
  ].join("|"),
  "i",
);

// ─── Shared-collateral guard (Lalit's rule) ──────────────────────────────────
// Sending marketing collateral — a sample/project VIDEO, brochure, floor plan,
// price/payment plan, location map, inventory, presentation, details/info, photos
// or a PDF — is a NORMAL conversation, never a Site Visit or Meeting. It must not
// increment the Site-Visit count or create a visit timeline event.
// "Shared sample video" / "Shared brochure" / "Shared floor plan on WhatsApp" → NOTE.
const COLLATERAL_NOUN =
  "(?:video|brochure|broucher|floor\\s*plan|layout|price\\s*(?:list|sheet)|payment\\s*plan|cost\\s*sheet|location\\s*(?:map|pin)|google\\s*location|inventory|presentation|\\bppt\\b|\\bpdf\\b|catalogue|catalog|details?|information|\\binfo\\b|photos?|pics?|images?|material|deck|price\\s*list)";
const SHARE_VERB =
  "(?:shared?|sent|sending|forwarded?|share|send|whats?app(?:ed)?|mail(?:ed)?|email(?:ed)?|gave|given|provided|drop(?:ped)?)";
const COLLATERAL_SHARE = new RegExp(
  `\\b${SHARE_VERB}\\b[\\s\\S]{0,40}?\\b${COLLATERAL_NOUN}\\b`
  + `|\\b${COLLATERAL_NOUN}\\b[\\s\\S]{0,25}?\\b${SHARE_VERB}\\b`,
  "i",
);
// UNAMBIGUOUS physical-visit / real-meeting evidence. When BOTH this and
// collateral-sharing appear in the same remark ("did site visit, then shared
// brochure"), the visit still counts — the guard only suppresses the loose
// proxy patterns, never an explicit visit.
const STRONG_VISIT = new RegExp(
  `\\b(?:site\\s*visit|visited\\s+(?:the\\s+)?(?:site|project|property|flat|apartment|unit|tower)`
  + `|(?:site|project)\\s+visited|came\\s+(?:to|for|down)|went\\s+to\\s+(?:the\\s+)?(?:site|project)`
  + `|physical\\s+visit|project\\s+visit|\\bsv\\s+done\\b|office\\s+(?:meeting|visit)`
  + `|zoom|google\\s+meet|video\\s+call|virtual\\s+(?:meeting|call))\\b`,
  "i",
);

// Meaningful client communication → CONNECTED (see classifyText). Deliberately
// broad: a reply, discussion, meeting update, budget/requirement talk, or
// "he said he will come / call / visit / update" all count as a real conversation.
const CONVERSATION_RE = /\b(?:said|says|saying|told|telling|talk(?:ed|ing)?|spoke|speak|speaking|discuss(?:ed|ing|ion)?|explain(?:ed|ing)?|confirm(?:ed|ing)?|agree(?:d|ing)?|ask(?:ed|ing)?|enquir|inquir|interested|budget|requirement|shared?|sharing|replied|reply|replies|respond(?:ed|ing)?|conversation|connected|coming|will\s*(?:come|call|visit|update|revert|confirm|meet|share|get\s*back|do|pay|book|think|decide)|meeting\s*(?:today|tomorrow|done|fixed|on|scheduled|next|happened)|met\s+(?:him|her|client|them|today|yesterday)|wants?|wanted|update[ds]?|whats?\s*app|whatsapp|negotiat|site\s*visit|paid|booked|advance|deal)\b/i;
// Explicit negations that CANCEL a conversation word ("no further discussion").
const NO_CONVERSATION_RE = /\bno\s*(?:further\s*)?(?:discussion|conversation|response|reply|talk|update|contact)\b|without\s*(?:conversation|talking|discussion|reply|response)|did(?:n.?t| not)\s*(?:talk|speak|discuss|respond|reply|connect)/i;

export function classifyText(text: string): RemarkEventType {
  const t = text.toLowerCase();

  // Sharing marketing collateral (sample video / brochure / floor plan / price
  // list / payment plan / location map / inventory / presentation / details) is a
  // normal conversation — NEVER a Site Visit or Meeting — UNLESS the same remark
  // also carries explicit physical-visit / real-meeting evidence. This is Lalit's
  // rule: "Shared sample video must not increment Site Visit count."
  const collateralOnly = COLLATERAL_SHARE.test(t) && !STRONG_VISIT.test(t);

  // Completed events first — ONLY when explicitly confirmed (regexes above) AND the
  // meeting/visit is OURS, not the client meeting a third party. Planning / proposed
  // / third-party / collateral-sharing remarks fall through and are classified as a
  // normal conversation (connected / note): they stay in Conversation History but
  // are NOT counted as a Site Visit / Meeting / Virtual Meeting.
  if (!collateralOnly && !THIRD_PARTY.test(t)) {
    if (SITE_VISIT_DONE.test(t)) return "SITE_VISIT";
    if (VIRTUAL_DONE.test(t))    return "VIRTUAL_MEETING";
    if (OFFICE_DONE.test(t))     return "MEETING";
  }

  // ── Connected-vs-no-answer: ONE shared rule, same for every role ─────────
  // No-answer applies ONLY when no conversation happened. The moment there is
  // ANY meaningful client communication — discussion, a reply (incl. WhatsApp),
  // a meeting update, "he said he will come", budget/requirement talk — it is
  // CONNECTED, even if the same remark ALSO mentions a missed call
  // ("not picked, later he replied on WhatsApp" → connected).
  if (CONVERSATION_RE.test(t) && !NO_CONVERSATION_RE.test(t)) {
    if (/not\s*interested|do not call|cancel.*query|drop.*query/i.test(t)) return "CALL_NOT_INTERESTED";
    if (/callback|call back|call later|will call/i.test(t)) return "CALL_CALLBACK";
    return "CALL_CONNECTED";
  }

  if (/not\s*picked|did not pick|didn[''']?t pick|no answer|nai pick|not pick|not\s*connected|not\s*reachable|unreachable|no\s*response|not\s*responding|phone\s*(?:not\s*reachable|off|unreachable)|disconnected|did(?:n.?t| not)\s*answer/i.test(t)) return "CALL_NOT_PICKED";
  if (/switched\s*off|switch off/i.test(t)) return "CALL_SWITCHED_OFF";
  if (/(call\s*)?busy|in meeting/i.test(t)) return "CALL_BUSY";
  if (/not\s*interested|do not call|cancel.*query|drop.*query/i.test(t)) return "CALL_NOT_INTERESTED";
  if (/callback|call back|call later|will call/i.test(t)) return "CALL_CALLBACK";
  if (/connected|spoke|discussed|explained|told|confirmed|agreed|follow up|sent details|shared details|interested/i.test(t)) return "CALL_CONNECTED";
  return "NOTE";
}

// Whether an event type is a low-signal missed-call outcome (eligible for grouping)
export function isMissedCall(t: RemarkEventType): boolean {
  return t === "CALL_NOT_PICKED" || t === "CALL_BUSY" || t === "CALL_SWITCHED_OFF";
}

export function guessOutcome(text: string): CallOutcome {
  switch (classifyText(text)) {
    case "CALL_NOT_PICKED":  return CallOutcome.NOT_PICKED;
    case "CALL_BUSY":        return CallOutcome.BUSY;
    case "CALL_SWITCHED_OFF": return CallOutcome.SWITCHED_OFF;
    case "CALL_CALLBACK":    return CallOutcome.CALLBACK;
    case "CALL_NOT_INTERESTED": return CallOutcome.NOT_INTERESTED;
    case "CALL_CONNECTED":   return CallOutcome.CONNECTED;
    default:                 return CallOutcome.CONNECTED;
  }
}

// ─── Agent roster matching ────────────────────────────────────────────────────

// Build a matcher: given a list of known agent names (from the DB):
//   1. If candidate matches a roster entry → return canonical name
//      (e.g. "Yasir" → "Yasir Khan", "Tanuj" → "Tanuj Chopra").
//   2. If NOT in roster but looks like a real person name (≤2 CamelCase words,
//      no digits, ≥2 chars each) → return the candidate as-is.
//      This preserves historical agents (Kiran, Devansh, Muskan, Nitisha, …)
//      who were real employees but are no longer active CRM users.
//   3. 3+ word constructs like "Expressway Gurgaon Tanuj" or "Golf Island Tanuj"
//      → return null (these are project/place names mixed in, not person names).
//
// Rule: historical remarks are business records. Agent names must NEVER be
// removed just because the person is no longer an active CRM user.
export function buildAgentMatcher(agentNames: string[]): (candidate: string) => string | null {
  const lookup = new Map<string, string>();
  for (const name of agentNames) {
    const lower = name.toLowerCase().trim();
    lookup.set(lower, name);
    const first = lower.split(" ")[0];
    if (first && !lookup.has(first)) lookup.set(first, name);
  }
  return (candidate: string) => {
    const trimmed = candidate.trim();
    // Priority 0: hard cluster ("Lalit"/"Lalit Sir"/"Sharma"/"Shrama" → "Lalit
    // Sharma") + honorific strip + unambiguous first-name→full-name from roster.
    // Only short-circuits when it actually changed the name (keeps Priority 2
    // historical non-roster names like "Kiran" untouched).
    const hard = canonicalAgentName(trimmed, agentNames);
    if (hard.toLowerCase() !== trimmed.toLowerCase()) return hard;
    // Priority 1: known CRM user → canonical full name
    const canonical = lookup.get(trimmed.toLowerCase());
    if (canonical) return canonical;
    // Priority 2: not in roster → show as-is IF it looks like a person name.
    // Person name heuristic: 1–2 words, each starting with a capital letter,
    // no digits, each word ≥ 2 chars. This accepts "Kiran", "Devansh", "Muskan",
    // "Nicky Gupta", "Abhinav Singh" and rejects "Expressway Gurgaon Tanuj" (3 words).
    const words = trimmed.split(/\s+/);
    if (words.length < 1 || words.length > 2) return null;
    if (words.some(w => w.length < 2 || !/^[A-Z]/.test(w) || /\d/.test(w))) return null;
    return trimmed; // preserve as historical agent name
  };
}

// ─── Core structured entry ────────────────────────────────────────────────────

export interface RemarkEntry {
  /** Parsed date (IST→UTC), or null for truly undated fragments */
  date: Date | null;
  /** True when the date was inferred (undated → attached to nearest dated entry) */
  dateInferred: boolean;
  /** Canonical agent name from the roster, or null */
  agentName: string | null;
  /** Clean display text (no leading "Name: ") */
  text: string;
  /** Semantic type of this interaction */
  eventType: RemarkEventType;
}

// Stable identifier for a parsed remark entry — addresses an imported remark
// for the conversation-moderation overlay (RemarkVisibility / RemarkAuditLog).
// Derived purely from the entry's parsed date + text, both of which come from
// the immutable Lead.remarks cell, so the key is stable across renders.
export function remarkKeyFor(entry: { date: Date | null; text: string }): string {
  const day = entry.date ? entry.date.toISOString().slice(0, 10) : "undated";
  const norm = entry.text.trim().replace(/\s+/g, " ").toLowerCase();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = (((h << 5) + h) + norm.charCodeAt(i)) | 0;
  return `${day}_${(h >>> 0).toString(36)}`;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

// Full "on DD Mon YYYY (HH:MM) body" — previously made into synthetic CallLogs.
const FULL_DATED_RE = /^(?:([A-Z][A-Za-z\s]{1,30}?)\s*:\s*)?[oO]n\s+(\d{1,2}[\s\-/.]+[A-Za-z]+(?:[\s\-/.]+\d{2,4})?)\s*\(([^)]+)\)\s*([\s\S]*)$/;
// "on DD Mon YYYY body" — date but no time parens (hyphen/slash/2-digit-year tolerant)
const ON_DATE_NO_TIME = /^(?:([A-Z][A-Za-z\s]{1,30}?)\s*:\s*)?[oO]n\s+((?:\d{1,2}[\s\-/.]+[A-Za-z]+(?:[\s\-/.]+\d{2,4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}))\s*(.*)/;
// Leading "Name: " attribution (only to detect; canonical check is against roster)
const NAME_PREFIX = /^([A-Z][A-Za-z]{1,20}(?:\s+[A-Z][A-Za-z]{1,20}){0,2})\s*:\s*/;

/**
 * Parse a Lead.remarks cell into a structured timeline of RemarkEntry objects,
 * respecting agent ownership and attaching undated entries to their nearest
 * dated neighbour.
 *
 * @param cell        The raw Lead.remarks string.
 * @param agentNames  List of canonical agent names from the DB.
 * @param leadCreatedAt  Lead creation date — used as fallback for the very first
 *                    undated entry when no dated entry precedes it.
 */
export function parseRemarksTimeline(
  cell: string,
  agentNames: string[],
  leadCreatedAt?: Date,
  now: Date = new Date(),
): RemarkEntry[] {
  if (!cell || typeof cell !== "string") return [];

  const matchAgent = buildAgentMatcher(agentNames);

  // A remark documents something that ALREADY happened, so a parsed date in the
  // FUTURE is never an event date — it is client-message CONTENT ("…attending the
  // Expo on 4-5 July 2026"). Reject anything more than a day ahead of `now`.
  // (Lalit 2026-06-28, critical Smart-Timeline regression.)
  const futureCutoff = now.getTime() + 24 * 60 * 60 * 1000;
  const notFuture = (d: Date | null): Date | null => (d && d.getTime() > futureCutoff ? null : d);

  // Normalize MIS separators and split inline "On DD Mon" occurrences
  const normalized = cell
    .replace(/,{2,}/g, "\n")
    .replace(/\r\n/g, "\n")
    // Split before a REAL imported-entry header — "On DD <Month> YYYY" — only,
    // pulling an immediately-preceding "Name:" prefix onto the new line so the new
    // dated entry keeps its OWN agent ("...him. Lalit: On 19 Jun 2026..." → "Lalit:
    // On 19 Jun 2026...", attributed to Lalit).
    //
    // P0 DATA-INTEGRITY (Lalit 2026-06): the old regex split before ANY "on <digit>",
    // so a client's MID-SENTENCE date tore one message into two fake dated entries —
    // "...visited the Expo on 4th & 5th July 2026" / "he text My mother passed away
    // on 1st April" both split at "on 4"/"on 1". Requiring a FULL date — day, then a
    // whitespace-separated month NAME, then a year — structurally excludes ordinals
    // ("4th"/"1st" have no space before the suffix) and yearless casual dates
    // ("on 5 July"), so a client message is never split. Real MIS headers always
    // carry the full "On DD Month YYYY", so legitimate entries still separate.
    // Day/month/year may be separated by space, hyphen, slash or dot — the same
    // tolerance parseDateTime() uses — so hyphenated MIS dates ("On 17-May-26")
    // still split. The day must be followed by a SEPARATOR then a month NAME then a
    // year: an ordinal ("4th"/"1st" — letter, not a separator) or a yearless casual
    // date ("on 5 July to visit") structurally cannot match, so a client message is
    // never torn.
    .replace(
      /[.!?,]?\s*((?:[A-Z][A-Za-z]{1,20}\s*:\s*)?[oO]n\s+(\d{1,2})[\s\-/.]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s\-/.]+(\d{2,4})\b)/gi,
      (m: string, block: string, dd: string, mon: string, yy: string) => {
        // Only treat "On <date>" as a NEW dated entry when the date is NOT in the
        // future — a future "on 4-5 July 2026" is client-message content, not an
        // event header, so it must not split the message into a fake dated entry.
        const mi = MONTHS[mon.toLowerCase().slice(0, 4)];
        const dt = mi === undefined ? null : new Date(Date.UTC(expandYear(parseInt(yy)), mi, parseInt(dd), 6, 30));
        return notFuture(dt) ? `\n${block}` : m;
      },
    )
    .trim();

  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean);

  // Raw entries before we apply the undated → inferred-date pass
  interface RawEntry { date: Date | null; agentCandidate: string | null; text: string; timeStr?: string | null }
  const raw: RawEntry[] = [];
  let currentAgent: string | null = null; // last known-roster agent seen

  for (const line of lines) {
    if (line.length < 2) continue;

    // Case 1: full "on DD Mon YYYY (HH:MM) body"
    const mFull = line.match(FULL_DATED_RE);
    if (mFull) {
      const candidate = mFull[1]?.trim() ?? null;
      const date = notFuture(parseDateTime(mFull[2].trim(), mFull[3].trim()));
      const body = cleanRemarkBody((mFull[4] ?? "").replace(/^[,.\s]+/, "").trim());
      if (candidate) {
        const resolved = matchAgent(candidate);
        if (resolved) currentAgent = resolved;
      }
      // Push with currentAgent as agentCandidate when the line had no inline prefix
      // (happens when the inline-split puts "Name:" on its own line before "On …")
      if (body.length >= 2) raw.push({ date, agentCandidate: candidate ?? currentAgent, text: body });
      continue;
    }

    // Case 2: "on DD Mon YYYY body" — date with no PARENTHESISED time.
    const mOn = line.match(ON_DATE_NO_TIME);
    if (mOn) {
      const candidate = mOn[1]?.trim() ?? null;
      let date = notFuture(tryExtractDate(mOn[2].trim()));
      let body = (mOn[3] ?? "").replace(/^[,.\s]+/, "").trim();
      // The body may START with a written clock time ("On 19 Jun 2026, 3:30 PM
      // call not picked"). The calling team writes these in IST, so PROMOTE the
      // time to the event timestamp (via the already-correct IST parseDateTime)
      // instead of dropping the event to a date-only noon sentinel. No timezone
      // conversion is applied — the written wall-clock time IS the IST time.
      const mTime = body.match(/^(\d{1,2}[:.]\d{2}(?:\s*[ap]\.?m\.?)?|\d{1,2}\s*[ap]\.?m\.?)[\s,]*/i);
      if (mTime && date) {
        const exact = parseDateTime(mOn[2].trim(), mTime[1].trim());
        if (exact) { date = exact; body = body.slice(mTime[0].length).trim(); }
      }
      body = cleanRemarkBody(body);
      if (candidate) {
        const resolved = matchAgent(candidate);
        if (resolved) currentAgent = resolved;
      }
      if (body.length >= 2) raw.push({ date, agentCandidate: candidate ?? currentAgent, text: body });
      continue;
    }

    // Case 3: line might start with "Name: body" without a date prefix.
    // Also handles "Name:" alone (body empty) — just updates currentAgent.
    const mName = line.match(NAME_PREFIX);
    if (mName) {
      const candidate = mName[1].trim();
      const resolved = matchAgent(candidate);
      if (resolved) currentAgent = resolved;
      const body = line.slice(mName[0].length).trim();
      if (body.length < 2) continue; // name-only line — agent updated, nothing to push
      const date = notFuture(leadingDate(body));
      let displayText = body.replace(/^[,.\s]+/, "").trim();
      if (date) {
        displayText = displayText
          .replace(/^\d{1,2}\s+[a-z]{3}[a-z]*(?:\s+\d{4})?\s*[:\-]?\s*/i, "")
          .replace(/^\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/, "")
          .replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*[:\-]?\s*/, "")
          .trim();
      }
      const t3 = extractLeadingTime(displayText);
      displayText = cleanRemarkBody(t3.rest);
      if (displayText.length >= 2) raw.push({ date, agentCandidate: candidate, text: displayText, timeStr: t3.timeStr });
      continue;
    }

    // Case 4: plain content line. Only a LEADING date counts (a real date prefix);
    // a date mentioned mid-sentence is client-message content, never an event date.
    const date = notFuture(leadingDate(line));
    let displayText = line;
    if (date) {
      displayText = line
        .replace(/^\d{1,2}\s+[a-z]{3}[a-z]*(?:\s+\d{4})?\s*[:\-]?\s*/i, "")
        .replace(/^\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/, "")
        .replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*[:\-]?\s*/, "")
        .trim();
    }
    displayText = displayText.replace(/^[,.\s]+/, "").trim();
    const t4 = extractLeadingTime(displayText);
    displayText = cleanRemarkBody(t4.rest);
    if (displayText.length >= 2) raw.push({ date, agentCandidate: null, text: displayText, timeStr: t4.timeStr });
  }

  // ── Pass 2: resolve agent for each entry (sticky ownership) ────────────────
  // Walk forward maintaining currentAgent; for each entry with a known candidate
  // update it, then stamp the entry.
  let runningAgent: string | null = null;
  const withAgent: Array<RawEntry & { resolvedAgent: string | null }> = raw.map(e => {
    if (e.agentCandidate) {
      const resolved = matchAgent(e.agentCandidate);
      if (resolved) runningAgent = resolved;
    }
    return { ...e, resolvedAgent: runningAgent };
  });

  // ── Pass 3: attach undated entries to their nearest preceding dated entry ──
  // Find the last dated entry before each undated one and reuse its date, marked
  // as inferred. If none exists, use leadCreatedAt.
  let lastKnownDate: Date | null = leadCreatedAt ?? null;
  const entries: RemarkEntry[] = withAgent.map(e => {
    let date: Date | null = e.date;
    let inferred = false;
    if (date) { lastKnownDate = date; }
    else { date = lastKnownDate; inferred = true; }
    // Promote a body-leading clock time ("(3:33pm) he said…") onto the entry's
    // date — even when that date was inferred from the previous dated entry.
    if (e.timeStr && date) {
      const withT = withISTTime(date, e.timeStr);
      if (withT) { date = withT; if (!e.date) lastKnownDate = withT; }
    }
    return { date, dateInferred: inferred, agentName: e.resolvedAgent, text: e.text, eventType: classifyText(e.text) };
  });

  // Sort chronologically (oldest first, matching original Excel order).
  // Null-date entries (no lead creation date either) go to the bottom.
  entries.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

  return entries;
}

// ─── Grouping for display ─────────────────────────────────────────────────────

export interface MissedCallGroup {
  kind: "missed_group";
  count: number;
  from: Date;
  to: Date;
  label: string;      // e.g. "Call not picked" / "Busy"
  agentName: string | null;
}

export interface SingleEntry {
  kind: "entry";
  entry: RemarkEntry;
}

export type DisplayEntry = MissedCallGroup | SingleEntry;

/**
 * Collapse consecutive isMissedCall entries of the same type into a group
 * (spec §5: "do not create 20 separate entries").
 * Min 3 consecutive identical outcomes → grouped; fewer shown individually.
 */
export function groupEntries(entries: RemarkEntry[]): DisplayEntry[] {
  const MIN_GROUP = 3;
  const result: DisplayEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    const e = entries[i];
    if (!isMissedCall(e.eventType)) {
      result.push({ kind: "entry", entry: e });
      i++;
      continue;
    }
    // Count run of same missed-call type
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j].eventType === e.eventType &&
      entries[j].agentName === e.agentName
    ) j++;
    const count = j - i;

    if (count >= MIN_GROUP) {
      const from = entries[i].date ?? new Date(0);
      const to   = entries[j - 1].date ?? from;
      const label = e.eventType === "CALL_NOT_PICKED" ? "Call not picked"
        : e.eventType === "CALL_BUSY" ? "Busy"
        : "Switched off";
      result.push({ kind: "missed_group", count, from, to, label, agentName: e.agentName });
      i = j;
    } else {
      result.push({ kind: "entry", entry: e });
      i++;
    }
  }
  return result;
}

// ─── Same-moment merge ────────────────────────────────────────────────────────
// One MIS remark block — "On 7 Jun (11:30) had words… asked me will meet… site
// to book…" — parses into several entries (the dated line + undated follow-on
// lines that inherit the SAME exact timestamp). They are ONE conversation, so
// merge consecutive entries that share agent + timestamp into a single block,
// joining the lines as paragraphs. Never splits a remark into many timeline rows.
export function mergeSameMoment(entries: RemarkEntry[]): RemarkEntry[] {
  const out: RemarkEntry[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    // Same moment ONLY when both share a real (non-null) timestamp AND agent.
    // (Two truly date-less entries must NOT merge just because both dates are
    // null — they could be unrelated remarks.)
    const sameMoment = !!last
      && last.agentName === e.agentName
      && last.date != null && e.date != null
      && last.date.getTime() === e.date.getTime()
      && !isNoonSentinel(e.date); // date-only entries (noon sentinel) are distinct remarks — never merge
    if (sameMoment && last) {
      last.text = `${last.text}\n${e.text}`.trim();
      last.eventType = classifyText(last.text);   // strongest signal of the whole block
      last.dateInferred = last.dateInferred && e.dateInferred;
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

// ─── Display normalisation ────────────────────────────────────────────────────
// Imported MIS remarks arrive with broken line breaks, copied WhatsApp wrapping
// and Excel row splits, so one conversation renders as many stacked lines eating
// vertical space. Collapse a single remark block into ONE readable paragraph:
// join the lines with sentence punctuation, tidy spacing, capitalise sentence
// starts, and normalise real-estate config tokens (4bhk → 4 BHK).
//
// This is PURELY cosmetic — the raw Lead.remarks text is never mutated; only the
// rendered string changes. We deliberately do NOT rewrite words or fix spelling:
// these are business records, so meaning must be preserved exactly.
export function toReadableParagraph(text: string): string {
  if (!text) return "";
  const lines = text
    .replace(/\r\n?/g, "\n")
    .replace(/(\s*,\s*){2,}/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .split("\n")
    .map(l => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return "";

  // End each non-final line with a full stop (unless it already ends in
  // punctuation) so the lines flow as sentences instead of stacking.
  let out = lines
    .map((line, i) => (i === lines.length - 1 ? line : /[.!?,;:]$/.test(line) ? line : `${line}.`))
    .join(" ")
    .replace(/\s+([.,!?;:])/g, "$1")   // no space before punctuation
    .replace(/\s{2,}/g, " ")
    .trim();

  // Capitalise the first letter overall and the first letter after . ! ?
  out = out.replace(/(?:^|[.!?]\s+)([a-z])/g, m => m.toUpperCase());
  // Standalone lowercase "i" → "I".
  out = out.replace(/\bi\b/g, "I");
  // Real-estate config tokens are always upper-case.
  out = out
    .replace(/\b(\d+)\s*bhk\b/gi, "$1 BHK")
    .replace(/\b(\d+)\s*br\b/gi, "$1 BR")
    .replace(/\b(\d+)\s*rk\b/gi, "$1 RK");
  return out;
}

// ─── Site-visit / Meeting extraction ─────────────────────────────────────────

export interface VisitSummary {
  date: Date | null;
  project: string | null;
  agentName: string | null;
  outcome: string;
}

export function extractSiteVisits(entries: RemarkEntry[]): VisitSummary[] {
  return entries
    .filter(e => e.eventType === "SITE_VISIT")
    .map(e => ({
      date: e.date,
      project: extractProjectFromText(e.text),
      agentName: e.agentName,
      outcome: e.text,
    }));
}

export function extractMeetings(entries: RemarkEntry[]): VisitSummary[] {
  return entries
    .filter(e => e.eventType === "MEETING" || e.eventType === "VIRTUAL_MEETING")
    .map(e => ({
      date: e.date,
      project: null,
      agentName: e.agentName,
      outcome: e.text,
    }));
}

// Naive project-name extractor: looks for a capitalised proper-noun run in the
// text that isn't a common stop word.
const STOP = new Set(["client", "he", "she", "they", "said", "called", "told", "wanted", "the", "a", "an", "and", "at", "of"]);
function extractProjectFromText(text: string): string | null {
  const m = text.match(/(?:(?:at|to|visit|visited|project|tower|residences?|heights?)\s+)?([A-Z][A-Za-z\s]{3,30})/);
  if (!m) return null;
  const candidate = m[1].trim().split(" ")[0]?.toLowerCase();
  if (!candidate || STOP.has(candidate)) return null;
  return m[1].trim();
}

// ─── Legacy exports (kept for callStats + CSV route that no longer use them) ──
// parseRemarks is no longer called from intake/csv (removed in dd7e550).
// extractUndatedSegments is replaced by parseRemarksTimeline.
// Both are kept here with minimal bodies so any imports don't break.

export interface ParsedRemark {
  agentName: string;
  when: Date;
  outcome: CallOutcome;
  text: string;
}

/** @deprecated Use parseRemarksTimeline instead. Not called from intake. */
export function parseRemarks(_cell: string): ParsedRemark[] { return []; }

export interface SegmentEntry {
  text: string;
  date: Date | null;
}

/** @deprecated Use parseRemarksTimeline instead. */
export function extractUndatedSegments(_cell: string): SegmentEntry[] { return []; }
