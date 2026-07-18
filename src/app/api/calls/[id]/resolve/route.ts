import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { CallOutcome } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";
import { canTouchBuyer } from "@/lib/buyerScope";
import { transitionCall, isPendingCall } from "@/lib/callLogService";
import { recordLeadCallAttempt } from "@/lib/callAttempts";

// ── RESOLVE A DIALLED CALL ───────────────────────────────────────────────────
// POST /api/calls/[id]/resolve  { outcome, durationSec?, notes? }
//
// Moves an EXISTING CallLog (normally the INITIATED row the dial beacon wrote)
// to its real outcome. Updates that ONE row — never creates a second. This is
// the endpoint a softphone / in-page call widget / "how did that call go?"
// prompt calls once the agent knows the result.
//
// The Log-Call form does NOT use this route: it goes through
// resolveOrCreateCall(), which finds the pending row by (record, user) without
// the client having to remember a callLogId.
//
// SCOPE: the caller must be allowed to touch the record the call is linked to —
// the same canTouchLead / canTouchBuyer gates as everywhere else. An UNLINKED
// call (telephony row with no CRM match) is admin-only, since there is no record
// to derive permission from. Out-of-scope → 404, never 403.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));

  const outcome = String(body.outcome ?? "").trim().toUpperCase() as CallOutcome;
  if (!outcome || !Object.values(CallOutcome).includes(outcome)) {
    return NextResponse.json(
      { error: `Invalid outcome. One of: ${Object.values(CallOutcome).join(", ")}` },
      { status: 400 },
    );
  }
  const durationRaw = Number(body.durationSec ?? 0);
  const durationSec = !isFinite(durationRaw) || durationRaw < 0 ? 0 : Math.floor(durationRaw);
  const notes = String(body.notes ?? "").trim() || null;

  const call = await prisma.callLog.findUnique({
    where: { id },
    select: { id: true, leadId: true, buyerId: true, userId: true, direction: true },
  });
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  // ── Permission derives from the LINKED RECORD, not from the call row ───────
  if (call.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: call.leadId },
      select: { ownerId: true, forwardedTeam: true },
    });
    if (!lead || !(await canTouchLead(me, lead))) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
  } else if (call.buyerId) {
    const buyer = await prisma.buyerRecord.findUnique({
      where: { id: call.buyerId },
      select: { ownerId: true, poolStatus: true, deletedAt: true, market: true },
    });
    if (
      !buyer ||
      !(await canTouchBuyer(me, {
        ownerId: buyer.ownerId,
        poolStatus: buyer.poolStatus,
        deletedAt: buyer.deletedAt,
        market: buyer.market,
      }))
    ) {
      return NextResponse.json({ error: "Call not found" }, { status: 404 });
    }
  } else if (me.role !== "ADMIN") {
    // Unlinked (unmatched telephony) call — no record to scope against.
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  const result = await transitionCall(id, outcome, {
    durationSec: durationSec > 0 ? durationSec : null,
    notes,
  });

  // An illegal move (e.g. trying to re-open a resolved call) is a client bug,
  // not a server error — report it as 409 so the caller can see what happened.
  if (!result.ok && result.reason === "illegal-transition") {
    return NextResponse.json(
      { error: `Cannot move a call from ${result.from} to ${result.to}.`, reason: result.reason },
      { status: 409 },
    );
  }
  if (!result.ok && result.reason === "not-found") {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // ── ADVANCE THE ATTEMPT CYCLE ON RESOLUTION ─────────────────────────────────
  // A dial writes a PENDING row that counts as NOTHING. The attempt only becomes
  // real when the call RESOLVES — and for a call resolved through THIS route,
  // this is the only place that can fire it. Without this, every call resolved
  // here would silently never count: 👻 ghosting would stop stamping and Revival
  // auto-return-at-5 would stop returning records to the Admin queue. That is the
  // exact mirror of the inflation bug the PENDING guard prevents — same root
  // cause (a dial and its resolution are two events on one row), opposite
  // direction, and far harder to notice because nothing looks broken.
  //
  // Fired ONLY on a real PENDING → TERMINAL move:
  //   • result.applied  — a refused/no-op transition must not count.
  //   • from is PENDING — a TERMINAL → TERMINAL correction must NOT count a
  //     second attempt; the original resolution already counted one.
  //   • leadId          — buyers run their own engine in buyerLifecycle.ts.
  //
  // actorId is the agent who MADE the call (call.userId), never `me.id`: the
  // cycle is owner-specific, so an admin resolving an agent's call must credit
  // the agent — and recordLeadCallAttempt's own owner check then correctly
  // no-ops if that agent no longer owns the lead.
  //
  // The Log-Call form does NOT reach this route (it uses resolveOrCreateCall and
  // fires the cycle itself), so there is no double-count path.
  if (result.applied && call.leadId && isPendingCall(result.from) && !isPendingCall(outcome)) {
    await recordLeadCallAttempt({
      leadId: call.leadId,
      actorId: call.userId,
      outcome,
      direction: call.direction,
      at: new Date(),
    }).catch((e) => {
      // Never fail the resolution because bookkeeping failed — the call outcome
      // is already saved and must not be rolled back.
      console.error("[calls/resolve] attempt cycle failed", id, e);
    });
  }

  return NextResponse.json({
    ok: result.ok,
    callLogId: id,
    applied: result.applied,
    outcome,
  });
}
