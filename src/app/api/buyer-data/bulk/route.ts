import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { audit, reqMeta } from "@/lib/audit";
import { canTouchBuyer, visibleBuyerOwnerIds, isBuyerAdmin, isBuyerAssignableForMarket, marketOfBuyer, type BuyerMarket } from "@/lib/buyerScope";
import { assignBuyerInTx, BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";
import { normalizeNameList } from "@/lib/nameFormat";

// ── Buyer bulk actions ───────────────────────────────────────────────────────
// One endpoint for the list-page bulk toolbar. Actions:
//   • transfer    (ADMIN/MANAGER) — reassign selected buyers to a different agent
//                 (opens a fresh stint via assignBuyerInTx; closes the prior one).
//   • delete      (ADMIN only)    — SOFT-delete (recycle-bin): sets deletedAt; the
//                 buyer leaves every list/pool/rollup but is fully restorable.
//   • restore     (ADMIN only)    — clear deletedAt, bringing a recycle-bin buyer back.
//   • edit        (scoped)        — set one whitelisted field on every selected buyer
//                 the caller may touch (admin = any live buyer; agent = own ASSIGNED).
// Body: { action, buyerIds: string[], agentId?, field?, value? }
//
// "assign" (from-pool) lives in /api/buyer-data/assign; "export" reuses the GET
// /api/buyer-data/export route. Everything writes an audit row.

const EDITABLE: Record<string, "string" | "number"> = {
  nationality: "string",
  projectName: "string",
  tower: "string",
  propertyType: "string",
  configuration: "string",
  agentName: "string",
  transactionValue: "number",
  remarks: "string",
};

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "").trim();

  const rawIds: unknown[] = Array.isArray(body.buyerIds) ? body.buyerIds : [];
  const buyerIds = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter((s): s is string => s.length > 0)));
  if (buyerIds.length === 0) return NextResponse.json({ error: "buyerIds required" }, { status: 400 });
  if (buyerIds.length > 5000) return NextResponse.json({ error: "Too many records in one bulk action (max 5000)." }, { status: 400 });

  // ── transfer (reassign to a different agent) — ADMIN / MANAGER ──────────────
  if (action === "transfer") {
    if (me.role !== "ADMIN" && me.role !== "MANAGER") {
      return NextResponse.json({ error: "Only an admin or manager can transfer buyers." }, { status: 403 });
    }
    const agentId = String(body.agentId ?? "").trim();
    if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
    const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { id: true, name: true, active: true, role: true, team: true } });
    if (!agent || !agent.active) return NextResponse.json({ error: "Target agent not found or inactive" }, { status: 400 });
    // MANAGER may only transfer to / within their subtree.
    if (me.role === "MANAGER") {
      const allowed = await visibleBuyerOwnerIds({ id: me.id, role: me.role, team: me.team });
      if (allowed !== null && !allowed.includes(agentId)) {
        return NextResponse.json({ error: "You can only transfer buyers to agents on your team." }, { status: 403 });
      }
    }
    // Live, non-converted buyers the caller may touch. Load the market so we can gate the
    // transfer target to it — an India buyer only to an India agent/admin, and vice-versa.
    const buyers = await prisma.buyerRecord.findMany({
      where: { id: { in: buyerIds }, deletedAt: null },
      select: { id: true, ownerId: true, poolStatus: true, deletedAt: true, market: true },
    });
    const markets = new Set(buyers.map((b) => marketOfBuyer(b)));
    if (markets.size > 1) return NextResponse.json({ error: "Cannot transfer buyers from different markets in one action." }, { status: 400 });
    const market: BuyerMarket = markets.size === 1 ? ([...markets][0] as BuyerMarket) : "Dubai";
    if (!isBuyerAssignableForMarket(agent, market)) {
      return NextResponse.json({ error: `${market} Buyer Data can only be transferred to ${market}-team users or admins.` }, { status: 403 });
    }
    let transferred = 0;
    const skipped: string[] = [];
    for (const b of buyers) {
      if (b.poolStatus === BUYER_POOL_STATUS.CONVERTED) { skipped.push(b.id); continue; }
      if (!(await canTouchBuyer(me, b))) { skipped.push(b.id); continue; }
      if (b.ownerId === agentId) { continue; } // already theirs — no-op
      await prisma.$transaction(async (tx) => { await assignBuyerInTx(tx, b.id, agentId, me.id); });
      transferred++;
    }
    if (transferred > 0) {
      await notify({
        userId: agentId, kind: "BUYER_ASSIGNED", severity: "INFO",
        title: transferred === 1 ? `🔁 A buyer was transferred to you` : `🔁 ${transferred} buyers transferred to you`,
        body: `${transferred} buyer${transferred === 1 ? "" : "s"} ${transferred === 1 ? "is" : "are"} now yours in Dubai Buyer Data.`,
        linkUrl: "/buyer-data",
      }).catch(() => null);
    }
    await audit({ userId: me.id, action: "buyer.bulk.transfer", entity: "BuyerRecord", meta: { agentId, transferred, skipped: skipped.length }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, transferred, skipped: skipped.length });
  }

  // ── delete (soft / recycle-bin) — ADMIN only ───────────────────────────────
  if (action === "delete") {
    if (!isBuyerAdmin(me)) return NextResponse.json({ error: "Only an admin can delete buyers." }, { status: 403 });
    const res = await prisma.buyerRecord.updateMany({
      where: { id: { in: buyerIds }, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: me.id },
    });
    await audit({ userId: me.id, action: "buyer.bulk.delete", entity: "BuyerRecord", meta: { count: res.count, ids: buyerIds.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, deleted: res.count });
  }

  // ── restore (un-delete) — ADMIN only ───────────────────────────────────────
  if (action === "restore") {
    if (!isBuyerAdmin(me)) return NextResponse.json({ error: "Only an admin can restore buyers." }, { status: 403 });
    const res = await prisma.buyerRecord.updateMany({
      where: { id: { in: buyerIds }, deletedAt: { not: null } },
      data: { deletedAt: null, deletedById: null },
    });
    await audit({ userId: me.id, action: "buyer.bulk.restore", entity: "BuyerRecord", meta: { count: res.count }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, restored: res.count });
  }

  // ── edit (set one whitelisted field) — scoped per record ────────────────────
  if (action === "edit") {
    const field = String(body.field ?? "").trim();
    const t = EDITABLE[field];
    if (!t) return NextResponse.json({ error: `Field "${field}" is not bulk-editable.` }, { status: 400 });
    let value: unknown;
    const raw = body.value;
    if (raw == null || raw === "") {
      value = null;
    } else if (t === "number") {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[^\d.-]/g, ""));
      if (isNaN(n)) return NextResponse.json({ error: `${field} must be a number` }, { status: 400 });
      value = n;
    } else {
      value = String(raw).trim();
      // Proper-Case the name field (agentName). normalizeNameList only touches
      // all-upper/all-lower names + preserves intentional mixed-case; other
      // string fields (projectName/tower/configuration/etc.) are left as typed.
      if (field === "agentName" && value) value = normalizeNameList(value as string);
    }
    // Apply only to records the caller may touch (admin = any live Dubai; agent =
    // own ASSIGNED Dubai). Dubai-market only — this is the Dubai module.
    const buyers = await prisma.buyerRecord.findMany({
      where: { id: { in: buyerIds }, deletedAt: null },
      select: { id: true, ownerId: true, poolStatus: true, deletedAt: true, market: true },
    });
    const touchable: string[] = [];
    for (const b of buyers) if (await canTouchBuyer(me, b)) touchable.push(b.id);
    if (touchable.length === 0) return NextResponse.json({ error: "None of the selected buyers are editable by you." }, { status: 403 });
    const res = await prisma.buyerRecord.updateMany({ where: { id: { in: touchable } }, data: { [field]: value } });
    await audit({ userId: me.id, action: "buyer.bulk.edit", entity: "BuyerRecord", meta: { field, value, count: res.count }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: res.count, field });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
