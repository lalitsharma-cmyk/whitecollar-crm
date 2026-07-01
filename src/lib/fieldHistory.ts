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
// Admin Lead-View full-edit (2026-06-24): every inline-editable field on the
// lead detail is tracked so the Change History card records old→new + who + when
// for ALL of them — identity/contact (name/phone/altPhone/email/altEmail/
// linkedInUrl/company/profession), provenance (source/sourceRaw/sourceDetail/
// medium/mediumOther), requirement (configuration/propertyType + BANT depth),
// scheduling (followup/meeting/siteVisit), location, team, budget, status.
// `customFields.<key>` rows are written by the customFields-merge update path
// (the dynamic key is matched by a prefix rule in recordFieldChanges below).
export const TRACKED_FIELDS = [
  // status / pipeline
  "currentStatus", "status", "potential", "bantStatus", "forwardedTeam",
  // budget
  "budgetMin", "budgetMax", "budgetCurrency", "budgetRaw",
  // BANT depth
  "fundReadiness", "authorityLevel", "authorityPerson", "needSummary",
  "whenCanInvest", "needType",
  // assignment + scheduling
  "ownerId", "followupDate", "meetingDate", "siteVisitDate",
  // provenance / channel
  "source", "sourceRaw", "sourceDetail", "medium", "mediumOther", "leadOrigin",
  // identity / contact
  "name", "altName", "phone", "altPhone", "email", "altEmail",
  "company", "profession", "designation", "nationality", "preferredLocation", "linkedInUrl",
  // requirement
  "configuration", "propertyType",
  // location
  "city", "state", "country", "address",
  // free-text
  "remarks",
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
  // The set of column names to record: the static tracked list PLUS any
  // dynamic `customFields.<key>` pseudo-fields present in `after` (written by
  // the imported-field merge edit path — see /api/leads/[id]/update). The
  // dynamic keys carry their own old/new in `before`/`after` already.
  const dynamicCustom = Object.keys(after).filter((k) => k.startsWith("customFields."));
  const fields: string[] = [...TRACKED_FIELDS, ...dynamicCustom];
  for (const f of fields) {
    if (!(f in after)) continue;          // field not part of this update
    const o = norm(before[f]);
    const n = norm(after[f]);
    if (o === n) continue;                // unchanged
    rows.push({ leadId, field: f, oldValue: o, newValue: n, changedById, source });
  }
  if (rows.length) await db.leadFieldHistory.createMany({ data: rows });
  return rows.length;
}
