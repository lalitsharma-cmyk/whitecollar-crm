import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeBuyerKey, primaryPhone } from "@/lib/buyerIntelligence";
import { normalizeNameList } from "@/lib/nameFormat";
import { canTouchBuyer } from "@/lib/buyerScope";
import { audit, reqMeta } from "@/lib/audit";

// Buyer record inline-edit — SCOPED (admin = any buyer; assigned agent = their
// own ASSIGNED buyer). Accepts one or more whitelisted field updates. Anything
// not in ALLOWED is ignored, so a crafted payload can't write to columns we don't
// expose (e.g. buyerKey, ids, poolStatus — lifecycle transitions go through the
// dedicated assign/convert/reject endpoints, never this generic editor). `remarks`
// is the agent's free-text working notes (retained across reassignments).

const ALLOWED: Record<string, "string" | "number" | "date"> = {
  clientName: "string",
  passport: "string",
  passportExpiry: "string",
  nationality: "string",
  ownerName: "string",
  country: "string",
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
  remarks: "string",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const existing = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Scoped: admin any; assigned agent only their own ASSIGNED buyer. 404 (not
  // 403) for outsiders so existence isn't confirmed.
  if (!(await canTouchBuyer(me, { ownerId: existing.ownerId, poolStatus: existing.poolStatus, deletedAt: existing.deletedAt }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
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

  // If the client name changed, recompute buyerKey so the repeat-buyer rollup
  // stays correct (key = normalized name + phone tail).
  if ("clientName" in data) {
    const phone = primaryPhone(existing.phones, null);
    data.buyerKey = normalizeBuyerKey(String(data.clientName), phone);
  }

  await prisma.buyerRecord.update({ where: { id }, data });

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
