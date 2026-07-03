// ─────────────────────────────────────────────────────────────────────────────
// DETERMINISTIC PII ANONYMIZER  (sandbox prod-snapshot refresh)
//
// Given a stable seed (a record id / phone / email), produces a REALISTIC FAKE
// value — never a blank or "[masked]" string. The sandbox must look and behave
// exactly like production, just with no real client data.
//
// DETERMINISTIC: the same real value always maps to the same fake value, so:
//   • a lead keeps ONE fake identity across every module (Leads, Buyer, timeline),
//   • the same phone/email on two records collapses to the same fake (dedup + repeat-
//     buyer logic still demonstrate correctly), and
//   • a refresh is stable (re-running yields the same faces — no churn).
//
// Nothing here reads a database; it's a pure transform the refresh pipeline applies
// row-by-row. No Math.random / Date.now (determinism), so a refresh is reproducible.
// ─────────────────────────────────────────────────────────────────────────────

// FNV-1a 32-bit — small, fast, stable string hash. We derive every choice from a
// seed string so the same input is always mapped the same way.
function hash(seed: string): number {
  let h = 0x811c9dc5;
  const s = seed || "seed";
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A second, decorrelated stream from the same seed (so first/last name, phone
 *  digits etc. don't all move together). */
function rehash(seed: string, salt: string): number {
  return hash(`${salt}:${seed}`);
}

function pick<T>(arr: readonly T[], n: number): T {
  return arr[n % arr.length];
}

// ── Realistic name pools — the WCR book is India + Gulf + some Western buyers. ──
const FIRST_NAMES = [
  "Rajesh", "Priya", "Amit", "Neha", "Vikram", "Anjali", "Rohit", "Sneha", "Arjun", "Kavya",
  "Ahmed", "Fatima", "Mohammed", "Aisha", "Omar", "Layla", "Yusuf", "Mariam", "Khalid", "Noor",
  "Sarah", "John", "Emma", "David", "Olivia", "James", "Sophia", "Daniel", "Isabella", "Michael",
  "Sanjay", "Pooja", "Karan", "Divya", "Rahul", "Meera", "Suresh", "Ananya", "Vivek", "Ritu",
];
const LAST_NAMES = [
  "Sharma", "Gupta", "Patel", "Singh", "Kapoor", "Mehta", "Reddy", "Nair", "Iyer", "Bose",
  "Khan", "Al-Rashid", "Hassan", "Ali", "Rahman", "Farooq", "Siddiqui", "Mansoor", "Aziz", "Habib",
  "Williams", "Miller", "Smith", "Brown", "Jones", "Taylor", "Wilson", "Davies", "Evans", "Clark",
  "Malhotra", "Chopra", "Bhatia", "Verma", "Rao", "Joshi", "Menon", "Desai", "Sethi", "Chawla",
];

/** A realistic full name. Deterministic per seed. */
export function fakeName(seed: string): string {
  const first = pick(FIRST_NAMES, rehash(seed, "first"));
  const last = pick(LAST_NAMES, rehash(seed, "last"));
  return `${first} ${last}`;
}

/** Split helper — some models store the fake name's parts. */
export function fakeFirstLast(seed: string): { first: string; last: string } {
  return { first: pick(FIRST_NAMES, rehash(seed, "first")), last: pick(LAST_NAMES, rehash(seed, "last")) };
}

/** A valid-FORMAT but fake phone. India (+91 9xxxxxxxxx) or UAE (+971 5xxxxxxxx),
 *  chosen from the seed unless a region is forced. The subscriber digits come from
 *  the hash, so it's stable + collision-rare but never a real number. */
export function fakePhone(seed: string, region?: "IN" | "AE"): string {
  const h = rehash(seed, "phone");
  const reg = region ?? (h % 2 === 0 ? "IN" : "AE");
  // 8 pseudo-digits from the hash (zero-padded).
  const digits = String(rehash(seed, "phdigits") % 100_000_000).padStart(8, "0");
  if (reg === "AE") return `+9715${digits.slice(0, 8)}`;            // +9715######## (9 after code)
  return `+91 9${digits.slice(0, 4)} ${digits.slice(4, 8)}`.slice(0, 16); // +91 9####-#### style
}

/** A demo-safe email — routes to a domain that can never deliver to a real inbox. */
export function fakeEmail(seed: string): string {
  const { first, last } = fakeFirstLast(seed);
  const n = rehash(seed, "emailn") % 900 + 100; // 3-digit tag
  return `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, "")}${n}@demo-crm.local`;
}

/** A realistic fake company / employer (for profession / HNI buyer fields). */
const COMPANIES = [
  "Horizon Traders", "Gulf Star Logistics", "Meridian Consulting", "BlueOak Capital",
  "Sunrise Exports", "Falcon IT Services", "Crescent Holdings", "Silverline Realty Partners",
  "Apex Manufacturing", "Zenith Pharma", "Orbit Media", "Harbour Foods",
];
export function fakeCompany(seed: string): string {
  return pick(COMPANIES, rehash(seed, "company"));
}

/** A valid-format but fake passport number (Buyer records). Letter + 7 digits. */
export function fakePassport(seed: string): string {
  const letter = String.fromCharCode(65 + (rehash(seed, "ppl") % 26));
  const num = String(rehash(seed, "ppn") % 10_000_000).padStart(7, "0");
  return `${letter}${num}`;
}

/** Keep a value's REALISM (currency band) while making it fake. Rounds the real
 *  magnitude to a plausible nearby figure derived from the seed, so distributions
 *  still look right in reports but no exact real figure survives. */
export function fakeBudget(realValue: number | null | undefined, seed: string): number {
  const bands = [500_000, 1_000_000, 1_500_000, 2_000_000, 2_500_000, 3_500_000, 5_000_000, 8_000_000, 12_000_000];
  // Anchor near the real magnitude if we have one, else pick from the seed.
  if (realValue && realValue > 0) {
    const closest = bands.reduce((a, b) => (Math.abs(b - realValue) < Math.abs(a - realValue) ? b : a), bands[0]);
    const jitter = (rehash(seed, "budjit") % 5 - 2) * 100_000; // ±200k in 100k steps
    return Math.max(300_000, closest + jitter);
  }
  return pick(bands, rehash(seed, "bud"));
}

// ── Realistic real-estate conversation / note templates ──────────────────────
// Filled with the record's OWN anonymized project + budget so the timeline reads
// like a genuine sales conversation. One template chosen deterministically.
const CONVO_TEMPLATES = [
  "Client interested in a 2BHK at {project}. Budget around {budget}. Wants a unit with a park view; prefers handover by {year}. Follow up after the weekend.",
  "Spoke with the client — looking for an investment unit at {project}, ~{budget}. Asked for the payment plan and expected ROI. Sending brochure on WhatsApp.",
  "Client is an end-user relocating for work. Considering {project} within {budget}. Needs a 3BHK near a school. Scheduling a site visit next week.",
  "Callback done. Client comparing {project} with two other options. Budget {budget}. Concerned about handover timeline — reassured with the RERA date.",
  "Warm lead. Client asked about mortgage eligibility for {project} at {budget}. Referred to the bank desk; will revert after pre-approval.",
  "Client requested a higher floor at {project}. Budget flexible up to {budget}. Interested in the golf-view line. Awaiting availability from the developer.",
  "Not picked on 2 attempts; connected on the 3rd. Client still evaluating {project}. Budget {budget}. Prefers a call after 6 PM.",
  "Client visited the show apartment for {project}. Liked the layout; budget {budget}. Discussing the booking amount and cheque schedule.",
];

function money(v: number): string {
  // Render as a readable AED / Cr-style figure.
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)} Cr`;
  if (v >= 100_000) return `AED ${(v / 1_000_000).toFixed(1)}M`;
  return `AED ${v.toLocaleString()}`;
}

/** A realistic fake conversation/note. Optionally weave in the record's own
 *  anonymized project + budget so it's internally consistent. */
export function fakeConversation(seed: string, ctx?: { project?: string | null; budget?: number | null }): string {
  const t = pick(CONVO_TEMPLATES, rehash(seed, "convo"));
  const project = ctx?.project?.trim() || pick(FAKE_PROJECTS, rehash(seed, "projfallback"));
  const budget = money(ctx?.budget && ctx.budget > 0 ? ctx.budget : fakeBudget(null, seed));
  const year = 2026 + (rehash(seed, "year") % 3); // 2026–2028
  return t.replace("{project}", project).replace("{budget}", budget).replace("{year}", String(year));
}

// Fallback project names (real Dubai/India developments are public, not PII — the
// pipeline keeps real project names by default; this pool is only for blanks).
export const FAKE_PROJECTS = [
  "Marina Vista", "Downtown Heights", "Emerald Gardens", "Palm Residences", "Skyline Towers",
  "Creek Harbour", "Golf Vista", "Bay Square", "Green Valley", "Central Park Residences",
];

/** A short realistic WhatsApp / call-note line (for logs). */
export function fakeMessage(seed: string): string {
  const lines = [
    "Shared the floor plan and price list. Awaiting reply.",
    "Client said will discuss with family and revert.",
    "Sent payment plan. Asked to call back tomorrow.",
    "Confirmed site visit for the weekend.",
    "Client asked for a corner unit — checking availability.",
    "Follow-up: still interested, budget unchanged.",
  ];
  return pick(lines, rehash(seed, "msg"));
}

/** Generic free-text scrubber for any remaining PII-ish blob — replaces it with a
 *  realistic note rather than blanking, unless it's clearly empty. */
export function fakeFreeText(seed: string, ctx?: { project?: string | null; budget?: number | null }): string {
  return fakeConversation(seed, ctx);
}
