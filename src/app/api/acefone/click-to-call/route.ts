// Server endpoint the lead-detail "Call via Acefone" button hits.
// Looks up the lead's phone + the current user's Acefone agent id, then
// fires the click-to-call. Returns immediately — the actual call lifecycle
// arrives later via /api/acefone/webhook.
import { NextResponse, type NextRequest } from "next/server";
import { acefoneEnabled, clickToCall } from "@/lib/acefone";
import { loadOwnedLead } from "@/lib/leadScope";

export async function POST(req: NextRequest) {
  if (!acefoneEnabled()) {
    return NextResponse.json({ error: "Acefone is not configured. Ask admin to set ACEFONE_API_KEY + ACEFONE_DID_NUMBER." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const leadId = String(body.leadId ?? "");
  if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

  // Ownership check — agents can only click-to-call their own leads
  const scoped = await loadOwnedLead(leadId);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  if (!me.acefoneAgentId) {
    return NextResponse.json({ error: "Your account isn't mapped to an Acefone agent id. Ask admin to set it in Team & Roles." }, { status: 400 });
  }
  if (!lead.phone) return NextResponse.json({ error: "Lead has no phone number" }, { status: 400 });

  const result = await clickToCall({
    agentNumber: me.acefoneAgentId,
    destinationNumber: lead.phone,
    customIdentifier: `lead:${lead.id}`, // echoed back in webhook so we can re-link
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: result.message });
}
