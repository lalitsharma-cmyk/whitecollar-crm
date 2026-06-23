import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchBuyer } from "@/lib/buyerScope";

/**
 * PUT /api/buyer-data/[id]/sticky-note
 *
 * Upserts the calling user's private sticky note for this buyer. Mirrors the Lead
 * sticky-note endpoint: unique (buyerId, userId) — every user gets exactly one row
 * per buyer. SCOPED via canTouchBuyer (admin = any live buyer; assigned agent =
 * their own ASSIGNED buyer; manager = their org subtree). 404 (not 403) for
 * outsiders so a buyer's existence isn't confirmed.
 *
 * Body: { body: string }   (mapped to BuyerStickyNote.body)
 * Returns: { ok: true, body, updatedAt } so the widget can show "Saved · just now".
 *
 * PRIVACY: the note body is only ever returned to its owner; other users get their
 * own row (or a fresh empty one).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const buyer = await prisma.buyerRecord.findUnique({
    where: { id },
    select: { id: true, ownerId: true, poolStatus: true, deletedAt: true },
  });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!(await canTouchBuyer(me, { ownerId: buyer.ownerId, poolStatus: buyer.poolStatus, deletedAt: buyer.deletedAt }))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const payload = await req.json().catch(() => ({}));
  const raw = typeof payload?.body === "string" ? payload.body : "";
  // 4 KB is plenty for a sticky scratchpad — protects the table from abuse.
  if (raw.length > 4000) {
    return NextResponse.json({ error: "Sticky note is too long (max 4000 chars)" }, { status: 400 });
  }

  const sticky = await prisma.buyerStickyNote.upsert({
    where: { buyerId_userId: { buyerId: id, userId: me.id } },
    create: { buyerId: id, userId: me.id, body: raw },
    update: { body: raw },
  });

  return NextResponse.json({
    ok: true,
    body: sticky.body,
    updatedAt: sticky.updatedAt.toISOString(),
  });
}
