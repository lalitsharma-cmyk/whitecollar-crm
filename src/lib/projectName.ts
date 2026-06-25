// Display normalization for project names shown in lists.
//
// Imported project values can be lowercase / concatenated ("rislandskymansion")
// or already proper ("Risland Sky Mansion"). We match against the real Project
// list (despaced + lowercased) to recover the canonical name; otherwise we
// title-case. The weak fallback "hint" (a lead's notesShort / configuration) is
// only treated as a project when it actually matches a known project — a remark
// ("Lalit Sir", "Asked to connect") or a config ("2BHK") is NOT a project and
// must render as the em-dash placeholder, never as italic pseudo-project text.

const despace = (s: string) => s.replace(/[\s\-_]+/g, "").toLowerCase();

function titleCaseProject(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (/^\d/.test(w)) return w.toUpperCase();      // 2BHK, 3BR, 4BHK
      if (/^[A-Z0-9&]{2,4}$/.test(w)) return w;        // DLF, M3M, AIPL acronyms
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

/** Canonical display name for a project value, or null if blank. */
export function prettyProjectName(raw: string | null | undefined, known: string[] = []): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const key = despace(s);
  if (!key) return null;
  const hit = known.find((k) => despace(k) === key);
  return hit ?? titleCaseProject(s);
}

/**
 * Resolve what to show in a lead's "Project" column.
 *   formal   → discussedProjects[0] (a real Project link)
 *   interest → interested-unit project
 *   hint     → notesShort / configuration (only counts if it names a real project)
 * Returns the normalized project name, or null → render the em-dash placeholder.
 */
export function resolveProjectDisplay(
  formal: string | null | undefined,
  interest: string | null | undefined,
  hint: string | null | undefined,
  known: string[] = [],
): string | null {
  const f = prettyProjectName(formal, known);
  if (f) return f;
  const i = prettyProjectName(interest, known);
  if (i) return i;
  // Hint counts ONLY if it matches a known project (despaced) — never a remark.
  if (hint) {
    const key = despace(hint);
    const match = known.find((k) => despace(k) === key);
    if (match) return match;
  }
  return null;
}

/**
 * Resolve the "Property Enquired" cell for the Leads table so it AGREES with the
 * lead-detail view and the Master Data grid — all three read the ONE canonical
 * field, `sourceDetail`.
 *
 * The old `resolveProjectDisplay` discarded any `sourceDetail` that wasn't a
 * REGISTERED Project Master name, which wrongly blanked genuine free-text
 * property enquiries ("Central Park Valley", "Silverglades Hightown Square", …)
 * on the Leads table while detail + Master Data showed them. That mismatch was
 * the reported bug.
 *
 * Resolution order:
 *   1. formal Project link (discussed / interestedUnits) → canonical name
 *   2. interested-unit project                            → canonical name
 *   3. sourceDetail (the canonical "Property Enquired" field) → shown verbatim,
 *      title-cased, EVEN when it isn't in the Project Master (it's the dedicated
 *      property field an importer/agent set — not a stray remark)
 *   4. notesShort (a free remark) → counts ONLY if it actually names a known
 *      project, so a one-liner like "Lalit Sir"/"asked to call back" never leaks
 *      into the column.
 * Returns null → em-dash placeholder.
 */
export function resolveEnquiredProperty(
  formal: string | null | undefined,
  interest: string | null | undefined,
  sourceDetail: string | null | undefined,
  notesHint: string | null | undefined,
  known: string[] = [],
): string | null {
  const f = prettyProjectName(formal, known);
  if (f) return f;
  const i = prettyProjectName(interest, known);
  if (i) return i;
  // sourceDetail IS the canonical Property Enquired field — always honor it
  // (title-cased / canonicalized), matching detail + Master Data exactly.
  const sd = prettyProjectName(sourceDetail, known);
  if (sd) return sd;
  // notesShort is a free remark — only a real known-project name counts.
  if (notesHint) {
    const key = despace(notesHint);
    const match = known.find((k) => despace(k) === key);
    if (match) return match;
  }
  return null;
}
