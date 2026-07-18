import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadOwnedLead } from "@/lib/leadScope";
import { canTouchBuyer } from "@/lib/buyerScope";
import { startCall } from "@/lib/callLogService";
import { parseJsonArray } from "@/lib/buyerIntelligence";

// ── THE DIAL BEACON SINK ─────────────────────────────────────────────────────
// POST { leadId? | buyerId?, phone? } → creates ONE CallLog at outcome=INITIATED
// and returns its id.
//
// Fired by src/components/useDialBeacon.ts the instant an agent taps ANY Call
// affordance in the CRM, via navigator.sendBeacon (fetch+keepalive fallback).
// This is what makes a dial visible in Call Logs BEFORE — and independently of —
// the agent filling the Log-Call form. When they do fill that form,
// resolveOrCreateCall() claims THIS row rather than creating a second one, so
// one dial is always exactly one row.
//
// DESIGN NOTES
//   • FAST + FIRE-AND-FORGET. The browser is navigating to `tel:` as this
//     request flies; nothing here may block or fail loudly. The client ignores
//     the response entirely.
//   • SCOPED. The caller must be allowed to touch the record — the same
//     loadOwnedLead / canTouchBuyer gates every other lead/buyer route uses. A
//     tampered beacon can never write a CallLog against someone else's record.
//     Out-of-scope → 404 (never 403 — we don't confirm the record exists).
//   • NO TIMELINE WRITE. This endpoint writes ONLY the CallLog. It deliberately
//     does NOT create an Activity: an ActivityType.CALL row satisfies the
//     follow-up completion gate (src/lib/followupGate.ts), so writing one per
//     tap would let a mere dial close a follow-up from every list view in the
//     CRM. Timeline semantics stay exactly as they are today.
//
// Runs on the Node runtime (Prisma).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * sendBeacon may deliver the payload as text/plain (it is not always allowed to
 * set application/json), so parse defensively: JSON first, raw text second.
 * A malformed body is treated as empty rather than throwing.
 */
async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    /* not JSON-parsable via .json() — try raw text */
  }
  try {
    const txt = await req.text();
    if (!txt) return {};
    return JSON.parse(txt) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const leadId = String(body.leadId ?? "").trim() || null;
  const buyerId = String(body.buyerId ?? "").trim() || null;
  const phone = String(body.phone ?? "").trim() || null;

  if (!leadId && !buyerId) {
    return NextResponse.json({ error: "leadId or buyerId is required" }, { status: 400 });
  }

  // ── LEAD dial (covers Leads, Master Data, Revival / cold — all are Lead rows)
  if (leadId) {
    const scoped = await loadOwnedLead(leadId);
    if (scoped.error) return scoped.error; // 404 for out-of-scope / missing
    const { me, lead } = scoped;
    const { callLogId } = await startCall({
      leadId,
      userId: me.id,
      // Trust the record's number over the client's — the beacon's `phone` is
      // only a hint for records whose number the caller sees masked.
      phoneNumber: lead.phone ?? phone,
    });
    return NextResponse.json({ ok: true, callLogId });
  }

  // ── BUYER dial (Dubai / India Buyer Data) ──────────────────────────────────
  const me = await requireUser();
  const buyer = await prisma.buyerRecord.findUnique({
    where: { id: buyerId! },
    select: { id: true, ownerId: true, poolStatus: true, deletedAt: true, market: true, phones: true },
  });
  if (!buyer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (
    !(await canTouchBuyer(me, {
      ownerId: buyer.ownerId,
      poolStatus: buyer.poolStatus,
      deletedAt: buyer.deletedAt,
      market: buyer.market,
    }))
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // A buyer can hold several numbers, so the client tells us WHICH one the agent
  // tapped. That hint is accepted only if it is genuinely one of this buyer's
  // numbers — otherwise a tampered beacon could stamp an arbitrary string into
  // the phoneNumber column of a real call record. Compared digits-only so
  // formatting differences ("+971 50 …" vs "97150…") still match. No match →
  // ignore the hint and let startCall resolve from the record.
  const digits = (s: string) => s.replace(/\D/g, "");
  const known = parseJsonArray(buyer.phones).map((p) => digits(String(p)));
  const hinted = phone && known.includes(digits(phone)) ? phone : null;

  const { callLogId } = await startCall({
    buyerId: buyer.id,
    userId: me.id,
    phoneNumber: hinted,
  });
  return NextResponse.json({ ok: true, callLogId });
}
