/** Shared, pure helpers for engine mocks. No server-only — safe anywhere. */

/** Best-effort parse of a budget string ("AED 2M", "40000000", "AED 3.5M–5M") to AED. */
export function parseBudgetAed(budget?: string | null): number {
  if (!budget) return 0;
  const m = budget.match(/([\d.]+)\s*M/i);
  if (m) return parseFloat(m[1]) * 1_000_000;
  const digits = budget.replace(/[^\d]/g, "");
  return digits ? parseInt(digits, 10) : 0;
}

/** Stable hash for lead-aware-but-deterministic mock variation. */
export function hashish(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function firstName(name: string): string {
  return (name || "there").trim().split(/\s+/)[0];
}
