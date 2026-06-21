// Display-only canonicalizer for an INTERNAL agent/user name. Like leadName.ts,
// this NEVER mutates a stored value — it only changes what is RENDERED, at render
// time, so it applies uniformly to existing + future records (no backfill).
//
// Goal (Lalit): every spelling/honorific variant of one person collapses to the
// DB full name — "Lalit", "Lalit Sir", "Sharma", "Shrama", "Lalit Shrama" →
// "Lalit Sharma". A roster (active-user names) optionally resolves a bare first
// name → full name when unambiguous.

// Hard cluster: variants of ONE person → DB full name. Scoped to the Lalit
// cluster ONLY — verified there is no other "*harma*" user/agent — so a genuinely
// different "Sharma" is never collapsed. Keys are pre-normalised (lowercased,
// honorifics already stripped, whitespace collapsed).
const HARD_CANONICAL: Record<string, string> = {
  "lalit": "Lalit Sharma",
  "lalit sharma": "Lalit Sharma",
  "lalit shrama": "Lalit Sharma",
  "shrama": "Lalit Sharma",
  "sharma": "Lalit Sharma",
};

const HONORIFICS = new Set(["sir", "ji", "sahab", "sahib", "saab", "madam", "maam", "mam"]);

function stripHonorifics(s: string): string {
  return s.split(/\s+/).filter((w) => !HONORIFICS.has(w.toLowerCase())).join(" ").trim();
}

/**
 * Canonicalise an internal agent/user display name. DISPLAY-ONLY.
 *   canonicalAgentName("Lalit Sir")            → "Lalit Sharma"
 *   canonicalAgentName("Shrama")               → "Lalit Sharma"
 *   canonicalAgentName("Yasir", ["Yasir Khan"])→ "Yasir Khan"
 *   canonicalAgentName("Rahul", ["Rahul A","Rahul B"]) → "Rahul" (ambiguous → unchanged)
 *   canonicalAgentName("")                     → ""
 */
export function canonicalAgentName(raw: string | null | undefined, roster?: string[]): string {
  const original = (raw ?? "").trim();
  if (!original) return original;
  const stripped = stripHonorifics(original);
  const key = stripped.toLowerCase().replace(/\s+/g, " ");
  // 1. Hard cluster (handles "Lalit", "Lalit Sir", "Sharma", "Shrama", "Lalit Shrama").
  if (HARD_CANONICAL[key]) return HARD_CANONICAL[key];
  // 2. Generic first-name → DB full name from the active-user roster (only when
  //    it resolves to EXACTLY one user, so two "Rahul"s never collide).
  if (roster?.length) {
    const exact = roster.find((n) => n.toLowerCase() === key);
    if (exact) return exact;
    const byFirst = roster.filter((n) => n.toLowerCase().split(" ")[0] === key);
    if (byFirst.length === 1) return byFirst[0];
  }
  // 3. No match → honorific-stripped original (so "Yasir Sir" → "Yasir"), or the
  //    original when stripping emptied it.
  return stripped || original;
}
