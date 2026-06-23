import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { assignBuyerInTx, BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";
import { visibleBuyerOwnerIds } from "@/lib/buyerScope";

// ── Assign buyers from the Admin Pool to an agent ────────────────────────────
// ADMIN / MANAGER only. Supports bulk (array of buyerIds → one agent). For each
// buyer: sets ownerId/assignedAt/poolStatus=ASSIGNED, opens a BuyerAssignment
// stint, logs BuyerActivity ASSIGNED, and notifies the agent. A MANAGER may only
// assign to an agent inside their org subtree. Buyers must currently be in the
// pool (ownerId null / not CONVERTED); already-assigned buyers are skipped (an
// admin reassign is handled inside assignBuyerInTx by closing the prior stint).
//
// Body: { buyerIds: string[]  (or buyerId: string), agentId: string }
export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));

  const agentId = String(body.agentId ?? body.userId ?? "").trim();
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

  const rawIds: unknown[] = Array.isArray(body.buyerIds)
    ? body.buyerIds
    : body.buyerId
      ? [body.buyerId]
      : [];
  const buyerIds: string[] = Array.from(
    new Set(rawIds.map((x) => String(x).trim()).filter((s): s is string => s.length > 0)),
  );
  if (buyerIds.length === 0) return NextResponse.json({ error: "buyerIds required" }, { status: 400 });

  // Validate the target agent exists + is active.
  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { id: true, name: true, active: true } });
  if (!agent || !agent.active) return NextResponse.json({ error: "Target agent not found or inactive" }, { status: 400 });

  // MANAGER may only assign to an agent within their org subtree.
  if (me.role === "MANAGER") {
    const allowed = await visibleBuyerOwnerIds({ id: me.id, role: me.role, team: me.team });
    if (allowed !== null && !allowed.includes(agentId)) {
      return NextResponse.json({ error: "You can only assign buyers to agents on your team." }, { status: 403 });
    }
  }

  // Load the candidate buyers. Only POOL buyers are assignable here (CONVERTED is
  // terminal; an ASSIGNED buyer would be a reassign, which assignBuyerInTx handles
  // but we surface as a separate count).
  const buyers = await prisma.buyerRecord.findMany({
    where: { id: { in: buyerIds }, deletedAt: null }, // never assign a recycle-bin buyer
    select: { id: true, clientName: true, poolStatus: true, ownerId: true },
  });
  const byId = new Map(buyers.map((b) => [b.id, b]));

  const assigned: string[] = [];
  const skipped: { id: string; reason: string }[] = [];

  for (const id of buyerIds) {
    const b = byId.get(id);
    if (!b) { skipped.push({ id, reason: "not found" }); continue; }
    if (b.poolStatus === BUYER_POOL_STATUS.CONVERTED) { skipped.push({ id, reason: "already converted" }); continue; }
    // Assign (or reassign) inside a transaction so stint + activity + record stay atomic.
    await prisma.$transaction(async (tx) => {
      await assignBuyerInTx(tx, id, agentId, me.id);
    });
    assigned.push(id);
  }

  // Notify the agent ONCE with a summary (avoids N pushes for a bulk assign).
  if (assigned.length > 0) {
    const first = byId.get(assigned[0]);
    const title = assigned.length === 1
      ? `🏷️ Buyer assigned: ${first?.clientName ?? "buyer"}`
      : `🏷️ ${assigned.length} buyers assigned to you`;
    const body2 = assigned.length === 1
      ? `You have a new buyer to work in Buyer Data.`
      : `${assigned.length} buyers from the Admin Pool are now yours in Buyer Data.`;
    await notify({
      userId: agentId,
      kind: "LEAD_ASSIGNED",
      severity: "INFO",
      title,
      body: body2,
      linkUrl: assigned.length === 1 ? `/buyer-data/${assigned[0]}` : `/buyer-data`,
    });
  }

  await audit({
    userId: me.id,
    action: "buyer.assign",
    entity: "BuyerRecord",
    meta: { agentId, assigned: assigned.length, skipped },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, assigned: assigned.length, skipped, agentId });
}
