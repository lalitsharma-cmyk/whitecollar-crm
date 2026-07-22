import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeBuyerKey, primaryPhone, toJsonArray } from "@/lib/buyerIntelligence";
import { normalizeNameList } from "@/lib/nameFormat";
import { canTouchBuyer } from "@/lib/buyerScope";
import { selectableStatuses } from "@/lib/lead-statuses";
import { audit, reqMeta } from "@/lib/audit";

// Buyer record inline-edit — SCOPED (admin = any buyer; assigned agent = their
// own ASSIGNED buyer). Accepts one or more whitelisted field updates. Anything
// not in ALLOWED is ignored, so a crafted payload can't write to columns we don't
// expose (e.g. buyerKey, ids, poolStatus — lifecycle transitions go through the
// dedicated assign/convert/reject endpoints, never this generic editor). `remarks`
// is the agent's free-text working notes (retained across reassignments).

// "jsonlist" = a contact/name LIST stored as a JSON array string (phones, emails,
// co-buyers). The client sends a comma/newline-separated string (or an array); we
// normalize it to the same JSON-array form the importer writes, via toJsonArray.
const ALLOWED: Record<string, "string" | "number" | "date" | "jsonlist"> = {
  clientName: "string",
  // Contact + identity lists — the last read-only data fields on the buyer
  // detail, now admin-editable for full parity with Leads (Lalit 2026-07-20).
  // phones/emails are CONTACT PII → admin/manager-only (mirrors the Lead route's
  // ADMIN_ONLY_FIELDS); the gate is enforced below, not here.
  phones: "jsonlist",
  emails: "jsonlist",
  coBuyerNames: "jsonlist",
  source: "string",
  passport: "string",
  passportExpiry: "string",
  nationality: "string",
  ownerName: "string",
  country: "string",
  developer: "string",
  projectName: "string",
  tower: "string",
  unitNumber: "string",
  propertyType: "string",
  configuration: "string",
  size: "string",
  actualSize: "string",
  area: "string",
  transactionValue: "number",
  pricePerSqFt: "number",
  transactionDate: "date",
  transactionId: "string",
  transactionType: "string",
  role: "string",
  agentName: "string",
  businessStatus: "string", // the imported buyer status (R4) — correctable in-app
  followupDate: "date",     // follow-up date (R5) — editable like a lead's follow-up
  remarks: "string",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const existing = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Scoped: admin any; assigned agent only their own ASSIGNED buyer. 404 (not
  // 403) for outsiders so existence isn't confirmed.
  if (!(await canTouchBuyer(me, { ownerId: existing.ownerId, poolStatus: existing.poolStatus, deletedAt: existing.deletedAt, market: existing.market }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));

  // ── Contact-PII gate (SECURITY — parity with the Lead route) ──────────────────
  // Leads make name/phone/email ADMIN-only (ADMIN_ONLY_FIELDS). The buyer parallel
  // is phones/emails: a customer's contact details are corrected by an admin/manager,
  // not an assigned agent — so an agent editing their own buyer can touch project /
  // passport / status etc., but NOT the phone or email. Blocks only when the field
  // is actually present in the payload; the inline editor sends only what changed.
  const CONTACT_PII = new Set(["phones", "emails"]);
  const isAdminOrManager = me.role === "ADMIN" || me.role === "MANAGER";
  if (!isAdminOrManager) {
    for (const key of Object.keys(body)) {
      if (CONTACT_PII.has(key)) {
        return NextResponse.json(
          { error: "Only an admin or manager can change a buyer's phone or email. Ask your admin to update it.", adminOnly: true },
          { status: 403 },
        );
      }
    }
  }

  // ── Status governance (SECURITY — parity with the Lead route) ─────────────────
  // `businessStatus` is the buyer's REAL sales status. Like the Lead route's
  // currentStatus guard (leads/[id]/update/route.ts), booking/won + system statuses
  // (e.g. "Booked With Us", "Fresh Lead") may only be set by roles allowed to set
  // them — an assigned AGENT must NOT be able to PATCH the buyer into a booked status
  // and bypass the booking-approval workflow. The client already restricts the
  // dropdown to selectableStatuses(market, role, current); we enforce the SAME
  // allow-list server-side, using the buyer's market as the team. buyer businessStatus
  // also holds imported/free-text values, so selectableStatuses (which always includes
  // the record's CURRENT value) is the correct gate: it rejects ONLY what the role
  // couldn't pick (booking/won/Fresh for an agent), never a legitimate non-booking
  // status nor a no-op re-save of the existing value. Only fires when a non-empty
  // value is being set to something DIFFERENT from what's stored.
  if (typeof body.businessStatus === "string" && body.businessStatus) {
    const next = body.businessStatus.trim();
    const current = existing.businessStatus ?? "";
    if (next && next !== current &&
        !selectableStatuses(existing.market, me.role, current).includes(next)) {
      return NextResponse.json(
        { error: `"${next}" can't be set here — booking/outcome statuses are set through the approval workflow, or ask an admin.` },
        { status: 403 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  const changed: Record<string, { from: unknown; to: unknown }> = {};

  for (const [key, raw] of Object.entries(body)) {
    const t = ALLOWED[key];
    if (!t) continue; // ignore non-whitelisted fields
    let value: unknown;
    if (raw == null || raw === "") {
      // clientName is NOT NULL — never allow it to be cleared.
      if (key === "clientName") return NextResponse.json({ error: "Client name is required." }, { status: 400 });
      value = null;
    } else if (t === "number") {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ""));
      if (isNaN(n)) return NextResponse.json({ error: `${key} must be a number` }, { status: 400 });
      value = n;
    } else if (t === "date") {
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) return NextResponse.json({ error: `${key} is not a valid date` }, { status: 400 });
      // Normalize bare YYYY-MM-DD to noon IST so it doesn't render as the prior day.
      value = /^\d{4}-\d{2}-\d{2}$/.test(String(raw))
        ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 30))
        : d;
    } else if (t === "jsonlist") {
      // Accept an array or a comma/semicolon/newline-separated string; store as the
      // SAME JSON-array form the importer writes (toJsonArray dedupes + drops blanks
      // + returns null when empty, so the column stays NULL rather than "[]").
      const parts = Array.isArray(raw) ? raw.map((x) => String(x)) : String(raw).split(/[,;\n]+/);
      value = toJsonArray(parts);
    } else {
      value = String(raw).trim();
    }
    data[key] = value;
    changed[key] = { from: (existing as Record<string, unknown>)[key], to: value };
  }

  // Proper-Case the NAME fields only (clientName/ownerName/agentName). Never
  // touch passport/nationality/country/project/unit/txn — those aren't names.
  // normalizeNameList preserves intentional mixed-case + skips non-name values.
  for (const nf of ["clientName", "ownerName", "agentName"] as const) {
    if (typeof data[nf] === "string" && data[nf]) {
      data[nf] = normalizeNameList(data[nf] as string);
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No editable fields in payload" }, { status: 400 });
  }

  // Recompute buyerKey when EITHER half of it changes (key = normalized name +
  // phone tail). Previously only clientName triggered this; now phones is editable
  // too, and a phone edit that didn't refresh the key would silently split or merge
  // the repeat-buyer rollup. Uses the NEW value for whichever side changed and the
  // stored value for the other. data.phones (when present) is already the JSON-array
  // string, which primaryPhone parses.
  if ("clientName" in data || "phones" in data) {
    const name = "clientName" in data ? String(data.clientName) : existing.clientName;
    const phone = "phones" in data ? primaryPhone(data.phones, null) : primaryPhone(existing.phones, null);
    data.buyerKey = normalizeBuyerKey(name, phone);
  }

  // Field-level change history (parity with LeadFieldHistory) — record each REAL
  // change (old→new + who + when) so the buyer detail's Change History card shows a
  // financial-grade audit trail. Values stringified; no-op edits (from == to) skipped.
  const stringifyVal = (v: unknown): string | null =>
    v == null || v === "" ? null : v instanceof Date ? v.toISOString() : String(v);
  const historyRows = Object.entries(changed)
    .map(([field, { from, to }]) => ({ field, oldValue: stringifyVal(from), newValue: stringifyVal(to) }))
    .filter((r) => r.oldValue !== r.newValue)
    .map((r) => ({ buyerId: id, field: r.field, oldValue: r.oldValue, newValue: r.newValue, changedById: me.id, source: "inline-edit" }));

  await prisma.$transaction([
    prisma.buyerRecord.update({ where: { id }, data }),
    ...(historyRows.length ? [prisma.buyerFieldHistory.createMany({ data: historyRows })] : []),
  ]);

  await audit({
    userId: me.id,
    action: "buyer.update",
    entity: "BuyerRecord",
    entityId: id,
    meta: { changed },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true });
}
