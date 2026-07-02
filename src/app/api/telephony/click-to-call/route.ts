// Generic click-to-call. The lead/buyer detail "Call" button hits this. Works for
// a Lead (incl. Revival/cold — they're Leads) OR a BuyerRecord. Rings the agent
// first, then dials the client; the lifecycle + recording arrive via the webhook
// and auto-attach to this record's timeline. Enqueues a retry on transient failure.
import { NextResponse, type NextRequest } from "next/server";
import { telephonyClickToCall, telephonyEnabled, telephonyMissing } from "@/lib/telephony/client";
import { enqueue } from "@/lib/telephony/retryQueue";
import { activeProvider } from "@/lib/telephony/config";
import { loadOwnedLead } from "@/lib/leadScope";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canTouchBuyer } from "@/lib/buyerScope";

export async function POST(req: NextRequest) {
  if (!telephonyEnabled()) {
    const { provider, missing } = telephonyMissing();
    return NextResponse.json({ error: `${provider} telephony not configured. Ask admin to set: ${missing.join(", ")}.` }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const leadId = body.leadId ? String(body.leadId) : "";
  const buyerId = body.buyerId ? String(body.buyerId) : "";
  if (!leadId && !buyerId) return NextResponse.json({ error: "leadId or buyerId required" }, { status: 400 });

  // ── Resolve target phone + agent ext, with per-record scope enforcement ─────
  let destinationNumber = "";
  let customIdentifier = "";
  let agentExt: string | null = null;

  if (leadId) {
    const scoped = await loadOwnedLead(leadId);
    if (scoped.error) return scoped.error;
    const { me, lead } = scoped;
    if (!lead.phone) return NextResponse.json({ error: "Lead has no phone number" }, { status: 400 });
    agentExt = me.acefoneAgentId;
    destinationNumber = lead.phone;
    customIdentifier = `lead:${lead.id}`;
  } else {
    const me = await requireUser();
    const buyer = await prisma.buyerRecord.findUnique({
      where: { id: buyerId },
      select: { id: true, ownerId: true, poolStatus: true, deletedAt: true, market: true, phones: true },
    });
    if (!buyer) return NextResponse.json({ error: "Buyer not found" }, { status: 404 });
    if (!(await canTouchBuyer(me, buyer))) return NextResponse.json({ error: "Not permitted for this buyer" }, { status: 403 });
    const phone = firstPhone(buyer.phones);
    if (!phone) return NextResponse.json({ error: "Buyer has no phone number" }, { status: 400 });
    agentExt = me.acefoneAgentId;
    destinationNumber = phone;
    customIdentifier = `buyer:${buyer.id}`;
  }

  if (!agentExt) {
    return NextResponse.json({ error: "Your account isn't mapped to a telephony agent id. Ask admin to set it in Team & Roles." }, { status: 400 });
  }

  const result = await telephonyClickToCall({ agentExt, destinationNumber, customIdentifier });
  if (!result.ok) {
    if (result.retryable) {
      await enqueue("CLICK_TO_CALL", activeProvider(), customIdentifier, { agentExt, destinationNumber, customIdentifier }).catch(() => {});
      return NextResponse.json({ ok: false, queued: true, message: `${result.message} — queued for retry` }, { status: 202 });
    }
    return NextResponse.json({ error: result.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: result.message, providerCallId: result.providerCallId ?? null });
}

/** First entry of a BuyerRecord.phones JSON array (or a bare string). */
function firstPhone(phones: string | null): string | null {
  if (!phones) return null;
  try {
    const arr = JSON.parse(phones);
    if (Array.isArray(arr)) return arr.find((x) => x && String(x).trim()) ?? null;
  } catch { /* not JSON — treat as a bare number */ }
  return String(phones).trim() || null;
}
