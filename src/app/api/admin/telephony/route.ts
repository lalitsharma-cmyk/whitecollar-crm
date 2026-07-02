// Admin telephony console API — ADMIN only.
//   GET  → provider + masked config status, webhook URL, agent mapping, recent raw
//          events, retry-queue health, call-volume counts.
//   POST → { action: "sync" | "retry" | "replay", eventId? } manual controls.
import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { telephonyConfig, configStatus } from "@/lib/telephony/config";
import { providerSpec } from "@/lib/telephony/providers";
import { telephonyEnabled } from "@/lib/telephony/client";
import { syncRecentCalls } from "@/lib/telephony/syncEngine";
import { processQueue } from "@/lib/telephony/retryQueue";
import { recordCallEvent } from "@/lib/telephony/recordCall";

export const dynamic = "force-dynamic";

const WEBHOOK_BASE = process.env.PUBLIC_BASE_URL || "https://crm.whitecollarrealty.com";

export async function GET() {
  await requireRole("ADMIN");
  const cfg = telephonyConfig();
  const spec = providerSpec(cfg.provider);

  const [events, pending, failed, failedTasks, byProvider, unlinked, mappedUsers, unmappedUsers] = await Promise.all([
    prisma.callEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 15, select: { id: true, provider: true, providerCallId: true, direction: true, eventType: true, processed: true, error: true, receivedAt: true } }),
    prisma.callSyncTask.count({ where: { status: "PENDING" } }),
    prisma.callSyncTask.count({ where: { status: "FAILED" } }),
    prisma.callSyncTask.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, kind: true, refId: true, attempts: true, lastError: true, updatedAt: true } }),
    prisma.callLog.groupBy({ by: ["ivrProvider"], _count: true }),
    prisma.callLog.count({ where: { leadId: null, buyerId: null, ivrProvider: { not: null } } }),
    prisma.user.findMany({ where: { acefoneAgentId: { not: null }, active: true }, select: { id: true, name: true, acefoneAgentId: true, team: true }, orderBy: { name: "asc" } }),
    prisma.user.count({ where: { acefoneAgentId: null, active: true, role: { not: "ADMIN" } } }),
  ]);

  return NextResponse.json({
    provider: cfg.provider,
    ready: telephonyEnabled(),
    missing: spec.missing(cfg),
    config: configStatus(cfg),
    webhookUrl: `${WEBHOOK_BASE}/api/telephony/webhook${cfg.webhookToken ? "?token=<AS_PHONE_WEBHOOK_TOKEN>" : ""}`,
    signsWithHmac: !!cfg.secret,
    counts: { byProvider: byProvider.map((r) => ({ provider: r.ivrProvider ?? "manual", count: r._count })), unlinked },
    queue: { pending, failed, failedTasks },
    events,
    agents: { mapped: mappedUsers, unmappedCount: unmappedUsers },
  });
}

export async function POST(req: NextRequest) {
  await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");

  if (action === "sync") {
    const res = await syncRecentCalls();
    return NextResponse.json({ ok: true, ...res });
  }
  if (action === "retry") {
    const res = await processQueue();
    return NextResponse.json({ ok: true, ...res });
  }
  if (action === "replay") {
    const eventId = String(body.eventId ?? "");
    const ev = await prisma.callEvent.findUnique({ where: { id: eventId } });
    if (!ev) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const spec = providerSpec(ev.provider);
    // Rebuild the flat string map from the stored raw payload, strip $ prefixes.
    const raw = (ev.rawPayload ?? {}) as Record<string, unknown>;
    const data: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) data[k.replace(/^\$/, "")] = String(v ?? "");
    const parsed = spec.parseWebhook(data, telephonyConfig());
    if (!parsed) return NextResponse.json({ error: "Event is not a parseable call" }, { status: 400 });
    try {
      const r = await recordCallEvent(parsed);
      await prisma.callEvent.update({ where: { id: eventId }, data: { processed: true, callLogId: r.callLogId, error: null } });
      return NextResponse.json({ ok: true, callLogId: r.callLogId, linked: r.leadId ? "lead" : r.buyerId ? "buyer" : "none" });
    } catch (e) {
      return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 500 });
    }
  }
  return NextResponse.json({ error: `Unknown action: ${action || "(none)"}. Use sync | retry | replay.` }, { status: 400 });
}
