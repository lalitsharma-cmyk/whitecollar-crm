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

  // ── Fetch from provider — SSRF-guarded (recordingUrl originates from a webhook,
  //    so a spoofed one must not turn the CRM into a proxy to internal services).
  //    Block loopback/private/link-local/metadata hosts, validate every redirect
  //    hop, and only attach the provider auth header to the provider's own host. ──
  const cfg = telephonyConfig();
  let apiHost = "";
  try { apiHost = new URL(cfg.baseUrl || providerSpec(cfg.provider).defaultBaseUrl).host; } catch { /* ignore */ }

  const upstream = await safeRecordingFetch(call.recordingUrl, cfg.apiKey, apiHost);
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

/** Block loopback / private / link-local / CGNAT / cloud-metadata hosts (SSRF guard). */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/:\d+$/, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    const [a, b] = h.split(".").map(Number);
    if (a === 127 || a === 10 || a === 0) return true;          // loopback / private / this-network
    if (a === 169 && b === 254) return true;                     // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;            // private
    if (a === 192 && b === 168) return true;                     // private
    if (a === 100 && b >= 64 && b <= 127) return true;           // CGNAT
    return false;
  }
  if (h === "::1" || h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // IPv6 loopback/link-local/ULA
  return false;
}

/** Fetch a recording with per-hop host validation (max 3 redirects). The provider
 *  auth header is attached ONLY to the provider's own host, never a redirect target. */
async function safeRecordingFetch(rawUrl: string, apiKey: string | null, apiHost: string): Promise<Response | null> {
  let url = rawUrl;
  for (let hop = 0; hop < 3; hop++) {
    let u: URL;
    try { u = new URL(url); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (isBlockedHost(u.host)) return null;
    const headers: Record<string, string> = apiKey && u.host === apiHost ? { Authorization: `Bearer ${apiKey}` } : {};
    const resp = await fetch(url, { headers, redirect: "manual" }).catch(() => null);
    if (!resp) return null;
    if (resp.status >= 300 && resp.status < 400 && resp.headers.get("location")) {
      url = new URL(resp.headers.get("location")!, url).toString();
      continue;
    }
    return resp;
  }
  return null;
}
