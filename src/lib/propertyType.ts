// Property Type inference — Residential vs Commercial.
//
// Priority (per owner spec):
//   1. Explicit value (e.g. sent by the website property page).  [handled by caller]
//   2. The matched Project Master category ("residential" | "commercial").
//   3. Keyword heuristic over configuration + project name + notes.
//   4. Otherwise NULL — never guess (blank where unclear).
//
// Used identically at intake (ingestLead) AND in the historical backfill, so old
// and new leads classify the same way (global data-consistency rule).

export type PropertyType = "Residential" | "Commercial";

// Strong, end-bounded commercial / residential signals. "Plot" is intentionally
// EXCLUDED from both — a plot can be residential or commercial, so it stays blank.
const COMMERCIAL_RE = /\b(commercial|office|offices|shop|shops|retail|showroom|warehouse|sco|mall|workspace|work\s*space|co-?working|food\s*court|business\s*park|corporate|industrial)\b/i;
const RESIDENTIAL_RE = /\b(residential|residence|residences|apartment|apartments|flat|flats|villa|villas|\d\s*bhk|\d\s*br|studio|penthouse|duplex|builder\s*floor|housing)\b/i;

export function inferPropertyType(s: {
  projectCategory?: string | null;
  configuration?: string | null;
  projectName?: string | null;
  notes?: string | null;
}): PropertyType | null {
  // 1. Authoritative — the project's own category from Project Master.
  const cat = (s.projectCategory ?? "").toLowerCase();
  if (cat.includes("commercial")) return "Commercial";
  if (cat.includes("residential")) return "Residential";

  // 2. Keyword heuristic. Configuration is the strongest single signal
  //    ("Commercial" / "Office" → Commercial; "2BHK" / "Villa" → Residential).
  const hay = [s.configuration, s.projectName, s.notes].filter(Boolean).join(" ");
  if (!hay.trim()) return null;
  const isC = COMMERCIAL_RE.test(hay);
  const isR = RESIDENTIAL_RE.test(hay);
  if (isC && !isR) return "Commercial";
  if (isR && !isC) return "Residential";
  // Ambiguous (both or neither) → don't guess.
  return null;
}
