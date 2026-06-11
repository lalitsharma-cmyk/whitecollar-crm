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
