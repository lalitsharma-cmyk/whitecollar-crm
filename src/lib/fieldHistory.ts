// Financial-grade field-change capture. Writes one append-only LeadFieldHistory
// row per changed tracked field (old→new + who + when + source). Call from every
// lead-mutation path so every change to status/budget/BANT/owner/follow-up/
// source/leadOrigin/remarks is recoverable and reportable ("what did X change").
import type { Prisma } from "@prisma/client";

// Minimal shape that both `prisma` and an interactive-transaction `tx` satisfy.
type HistoryDB = {
  leadFieldHistory: { createMany: (args: { data: Prisma.LeadFieldHistoryCreateManyInput[] }) => Promise<unknown> };
};

// The fields we track. Add here to capture more. Keys match Lead columns.
export const TRACKED_FIELDS = [
  "currentStatus", "status", "budgetMin", "budgetMax", "budgetCurrency",
  "bantStatus", "ownerId", "followupDate", "source", "leadOrigin",
  "remarks", "city", "country", "configuration", "needType", "potential",
] as const;

function norm(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Diff `before` vs `after` and write a history row for each changed tracked
 * field. Best-effort — never throws into the caller's transaction-critical path
 * (wrap the call in try/catch at the call site if it must not fail the mutation).
 */
export async function recordFieldChanges(
  db: HistoryDB,
  leadId: string,
  changedById: string | null,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  source: string,
): Promise<number> {
  const rows: Prisma.LeadFieldHistoryCreateManyInput[] = [];
  for (const f of TRACKED_FIELDS) {
    if (!(f in after)) continue;          // field not part of this update
    const o = norm(before[f]);
    const n = norm(after[f]);
    if (o === n) continue;                // unchanged
    rows.push({ leadId, field: f, oldValue: o, newValue: n, changedById, source });
  }
  if (rows.length) await db.leadFieldHistory.createMany({ data: rows });
  return rows.length;
}
