// POST /api/admin/identity/link — ADMIN-only. Resolve a candidate duplicate group
// into ONE virtual Customer: create a Customer and link the given leads to it. The
// underlying records STAY SEPARATE (never merged/deleted); each link is reversible
// (unlinkEnquiry) and written to the immutable CustomerLinkAudit. Body:
//   { leadIds: string[], reason?: string }  (≥2 leadIds)
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { linkEnquiryInTx } from "@/lib/customer/link";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({} as { leadIds?: unknown; reason?: unknown }));
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x: unknown): x is string => typeof x === "string") : [];
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;
  if (leadIds.length < 2) {
    return NextResponse.json({ error: "Select at least 2 records to link into one customer." }, { status: 400 });
  }

  // Only real, non-deleted leads may be linked; capture their current customer state.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, deletedAt: null },
    select: { id: true, customerId: true },
  });
  if (leads.length < 2) {
    return NextResponse.json({ error: "Fewer than 2 valid records found." }, { status: 400 });
  }

  // If any lead is ALREADY linked to a customer, reuse that customer (don't fork a
  // second identity for the same person); otherwise create a fresh Customer.
  const existingCustomerId = leads.map((l) => l.customerId).find((x): x is string => !!x) ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const customerId = existingCustomerId ?? (await tx.customer.create({ data: {} })).id;
    let linked = 0;
    for (const l of leads) {
      if (l.customerId === customerId) continue; // already on the target
      await linkEnquiryInTx(tx, { leadId: l.id, targetCustomerId: customerId, performedById: me.id, reason });
      linked++;
    }
    return { customerId, linked };
  });

  await audit({
    userId: me.id,
    action: "identity.link",
    entity: "Customer",
    entityId: result.customerId,
    meta: { leadIds: leads.map((l) => l.id), linked: result.linked, reason },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, ...result });
}
