// Raw Remark = the IMMUTABLE audit source of truth (exact imported text). This
// helper guarantees the raw remark log only ever GROWS — content is never
// truncated, rewritten, summarized, or silently dropped. On re-import of an
// existing lead/candidate we union the incoming remark with what's stored:
//   - identical            → no change
//   - incoming ⊇ existing   → adopt incoming (cumulative MIS sheet; nothing lost)
//   - existing ⊇ incoming   → keep existing (already contains it; no duplication)
//   - divergent            → APPEND incoming under a source separator
// The separator is additive metadata only; existing text is never altered. The
// result is always a verbatim superset of every remark ever imported.

function normalizeForCompare(s: string): string {
  return s.replace(/\r\n/g, "\n").trim();
}

export function mergeRawRemark(
  existing: string | null | undefined,
  incoming: string | null | undefined,
  sourceLabel?: string,
): string | null {
  const inc = (incoming ?? "").replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
  const ex = existing ?? "";
  if (!inc.trim()) return ex.trim() ? ex : null;
  if (!ex.trim()) return inc;
  const exN = normalizeForCompare(ex);
  const incN = normalizeForCompare(inc);
  if (exN === incN) return ex;          // identical → keep original bytes
  if (incN.includes(exN)) return inc;   // incoming is a superset → adopt (no loss)
  if (exN.includes(incN)) return ex;    // already contained → keep (no duplication)
  const sep = sourceLabel
    ? `\n\n──────── re-imported · ${sourceLabel} ────────\n`
    : `\n\n────────\n`;
  return `${ex}${sep}${inc}`;           // divergent → append, never overwrite
}
