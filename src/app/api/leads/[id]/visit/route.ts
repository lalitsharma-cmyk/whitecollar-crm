// Site-visit lifecycle endpoints.
//
//   POST   /api/leads/[id]/visit            { type, scheduledAt?, lat?, lng?, notes? }   → start a visit
//   PATCH  /api/leads/[id]/visit            { activityId, lat?, lng? }                   → push a track point (every 60s)
//   PUT    /api/leads/[id]/visit            { activityId, lat, lng, notes?, isNoShow?, withAgentIds? } → end visit
//
// "type" is one of OFFICE_MEETING | VIRTUAL_MEETING | SITE_VISIT.
// Mandatory location for SITE_VISIT on start — caller must include lat/lng or we 400.

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { isRevivalOrigin, REVIVAL_CALLING_ONLY_ERROR } from "@/lib/moduleSource";
import { rescoreLead } from "@/lib/leadRescorer";
import { awardXp, type AwardResult, type XpReason } from "@/lib/gamification.server";

type VisitType = "OFFICE_MEETING" | "VIRTUAL_MEETING" | "SITE_VISIT";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;
  // Revival Engine is calling-only (Lalit 2026-07-16): starting a meeting/visit
  // is blocked on cold/revival-origin leads — convert to Lead first. PATCH/PUT
  // below stay open: they only track/close an ALREADY-existing visit row.
  if (isRevivalOrigin(lead.leadOrigin)) {
    return NextResponse.json({ error: REVIVAL_CALLING_ONLY_ERROR }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  const type = String(body.type ?? "") as VisitType;
  if (!["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"].includes(type)) {
    return NextResponse.json({ error: "Invalid visit type" }, { status: 400 });
  }
  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  if (type === "SITE_VISIT" && (lat == null || lng == null)) {
    return NextResponse.json({
      error: "Location required for site visit. Enable GPS and allow location permission, then try again.",
    }, { status: 400 });
  }
  const notes = String(body.notes ?? "").trim();
  const now = new Date();

  const title =
    type === "OFFICE_MEETING" ? "🏢 Office meeting (in progress)" :
    type === "VIRTUAL_MEETING" ? "💻 Virtual meeting (in progress)" :
                                  "🚗 Site visit (in progress)";

  const activity = await prisma.activity.create({
    data: {
      leadId: id,
      userId: me.id,
      attendedByUserId: me.id,
      type: ActivityType[type],
      status: ActivityStatus.PLANNED, // becomes DONE on PUT (end)
      title,
      description: notes || undefined,
      scheduledAt: now,
      startedAt: now,
      startedLat: lat,
      startedLng: lng,
      locationTrack: lat != null && lng != null
        ? JSON.stringify([{ ts: now.toISOString(), lat, lng }])
        : null,
    },
  });
  await prisma.lead.update({ where: { id }, data: { lastTouchedAt: now } });
  return NextResponse.json({ ok: true, activityId: activity.id });
}

// Push one tracking point — called every ~60s by the client while visit is active
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));

  const activityId = String(body.activityId ?? "");
  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  if (!activityId || lat == null || lng == null) {
    return NextResponse.json({ error: "activityId + lat + lng required" }, { status: 400 });
  }

  const act = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!act || act.leadId !== id || act.attendedByUserId !== me.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const track = parseTrack(act.locationTrack);
  track.push({ ts: new Date().toISOString(), lat, lng });
  // Cap at 200 points to prevent unbounded growth
  const trimmed = track.length > 200 ? track.slice(-200) : track;
  await prisma.activity.update({
    where: { id: activityId },
    data: { locationTrack: JSON.stringify(trimmed) },
  });
  return NextResponse.json({ ok: true, points: trimmed.length });
}

// End the visit — captures end location + notes + attendance details
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));

  const activityId = String(body.activityId ?? "");
  const lat = numOrNull(body.lat);
  const lng = numOrNull(body.lng);
  const notes = String(body.notes ?? "").trim();
  const isNoShow = body.isNoShow === true;
  const withAgentIds: string[] = Array.isArray(body.withAgentIds) ? body.withAgentIds.filter((x: unknown) => typeof x === "string") : [];
  if (!activityId) return NextResponse.json({ error: "activityId required" }, { status: 400 });

  const act = await prisma.activity.findUnique({ where: { id: activityId } });
  if (!act || act.leadId !== id || act.attendedByUserId !== me.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const now = new Date();
  const typeLabel = act.type === "OFFICE_MEETING" ? "🏢 Office meeting" : act.type === "VIRTUAL_MEETING" ? "💻 Virtual meeting" : "🚗 Site visit";
  const minsActive = act.startedAt ? Math.round((now.getTime() - act.startedAt.getTime()) / 60000) : 0;

  await prisma.activity.update({
    where: { id: activityId },
    data: {
      status: ActivityStatus.DONE,
      title: `${typeLabel} (${minsActive}m${isNoShow ? " · NO-SHOW" : ""})`,
      description: notes || act.description,
      completedAt: now,
      endedAt: now,
      endedLat: lat,
      endedLng: lng,
      isNoShow,
      additionalAttendees: withAgentIds.length ? withAgentIds.join(",") : null,
    },
  });
  await prisma.lead.update({
    where: { id },
    data: {
      lastTouchedAt: now,
      ...(act.type === "SITE_VISIT" ? { siteVisitDate: act.startedAt } : { meetingDate: act.startedAt }),
    },
  });
  // Fire-and-forget behavioural re-score now that the visit is DONE
  // (rescorer awards +15 for any completed SITE_VISIT).
  rescoreLead(id).catch(() => {});

  // ── Gamification: a no-show site visit doesn't award the full tier —
  // the agent did the legwork, but it's a meeting-tier achievement.
  let awarded: AwardResult | null = null;
  if (!isNoShow) {
    let reason: XpReason | null = null;
    if (act.type === "SITE_VISIT") reason = "SITE_VISIT_COMPLETED";
    else if (act.type === "OFFICE_MEETING" || act.type === "VIRTUAL_MEETING") reason = "MEETING_BOOKED";
    if (reason) {
      try { awarded = await awardXp(me.id, reason); } catch { /* never block */ }
    }
  }
  return NextResponse.json({
    ok: true,
    awardedXp: awarded
      ? {
          amount: awarded.awarded,
          label: awarded.label,
          newXp: awarded.newXp,
          leveledUp: awarded.leveledUp,
          newLevel: awarded.leveledUp ? awarded.newLevel : null,
        }
      : null,
  });
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}
type TrackPoint = { ts: string; lat: number; lng: number };
function parseTrack(s: string | null): TrackPoint[] {
  if (!s) return [];
  try { const j = JSON.parse(s); return Array.isArray(j) ? j : []; } catch { return []; }
}
