// POST /api/admin/agent-leave — ADMIN-only. Mark a sales agent on/off leave for
// today (or through an explicit `until` IST day). Backs the leave-cover engine
// (#16): while on leave, no NEW lead auto-assigns to them (redirects to a cover).
// Reversible + audited. Body: { userId: string, onLeave: boolean, until?: "YYYY-MM-DD" }.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { getSetting, setSetting } from "@/lib/settings";
import { AGENTS_ON_LEAVE_KEY } from "@/lib/leave";
import { parseLeaveEntries } from "@/lib/leaveCover";
import { istDateKey } from "@/lib/datetime";
import { audit, reqMeta } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({} as { userId?: unknown; onLeave?: unknown; until?: unknown }));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const onLeave = body.onLeave === true;
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  // Only real, active, non-HR sales users can be flagged (matches who auto-assign targets).
  const user = await prisma.user.findFirst({
    where: { id: userId, active: true, hrOnly: false },
    select: { id: true, name: true },
  });
  if (!user) return NextResponse.json({ error: "Unknown agent" }, { status: 404 });

  const today = istDateKey();
  const until =
    typeof body.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.until) && body.until >= today
      ? body.until
      : today; // default: on leave for TODAY only (auto-expires tomorrow IST)

  // Start from the current entries, dropping any already-expired ones as housekeeping.
  const current = parseLeaveEntries(await getSetting(AGENTS_ON_LEAVE_KEY)).filter((e) => e.until >= today);
  const others = current.filter((e) => e.userId !== userId);
  const next = onLeave ? [...others, { userId, until }] : others;
  await setSetting(AGENTS_ON_LEAVE_KEY, JSON.stringify(next));

  await audit({
    userId: me.id,
    action: "agent.leave.set",
    entity: "User",
    entityId: userId,
    meta: { agent: user.name, onLeave, until },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, userId, onLeave, until, entries: next });
}
