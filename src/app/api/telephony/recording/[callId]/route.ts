// Recording proxy + download. Streams a call recording through the CRM so:
//   • the provider URL / token is never exposed to the browser
//   • access is scope-checked (you must be able to see the linked lead/buyer)
// GET /api/telephony/recording/<callId>          → inline (player)
// GET /api/telephony/recording/<callId>?download=1 → attachment (download button)
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadOwnedLead } from "@/lib/leadScope";
import { canTouchBuyer } from "@/lib/buyerScope";
import { telephonyConfig } from "@/lib/telephony/config";
import { providerSpec } from "@/lib/telephony/providers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ callId: string }> }) {
  const { callId } = await params;
  const me = await requireUser();

  const call = await prisma.callLog.findUnique({
    where: { id: callId },
    select: { id: true, leadId: true, buyerId: true, recordingUrl: true, startedAt: true },
  });
  if (!call || !call.recordingUrl) return NextResponse.json({ error: "Recording not found" }, { status: 404 });

  // ── Scope: admin/manager, else must own the linked lead/buyer ───────────────
  const role = me.isSuperAdmin === true ? "ADMIN" : me.role;
  let allowed = role === "ADMIN" || role === "MANAGER";
  if (!allowed && call.leadId) {
    const scoped = await loadOwnedLead(call.leadId);
    allowed = !scoped.error;
  }
  if (!allowed && call.buyerId) {
    const buyer = await prisma.buyerRecord.findUnique({
      where: { id: call.buyerId },
      select: { ownerId: true, poolStatus: true, deletedAt: true, market: true },
    });
    allowed = !!buyer && (await canTouchBuyer(me, buyer));
  }
  if (!allowed) return NextResponse.json({ error: "Not permitted" }, { status: 403 });

  // ── Fetch from provider (auth header only when same-host as the API) ────────
  const cfg = telephonyConfig();
  const headers: Record<string, string> = {};
  try {
    const recHost = new URL(call.recordingUrl).host;
    const apiHost = new URL(cfg.baseUrl || providerSpec(cfg.provider).defaultBaseUrl).host;
    if (cfg.apiKey && recHost === apiHost) headers.Authorization = `Bearer ${cfg.apiKey}`;
  } catch { /* non-absolute URL — fetch as-is */ }

  const upstream = await fetch(call.recordingUrl, { headers }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return NextResponse.json({ error: "Could not fetch recording from provider" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "audio/mpeg";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("ogg") ? "ogg" : "mp3";
  const download = new URL(req.url).searchParams.get("download") === "1";
  const stamp = call.startedAt ? call.startedAt.toISOString().slice(0, 10) : "recording";
  const filename = `call-${stamp}-${callId.slice(-6)}.${ext}`;

  const res = new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    },
  });
  const len = upstream.headers.get("content-length");
  if (len) res.headers.set("Content-Length", len);
  return res;
}
