import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { canViewPresence, getPresenceHistory } from "@/lib/presence";
import { isValidDateKey } from "@/lib/datetime";

// GET /api/admin/presence/history?userId=…&date=YYYY-MM-DD
//
// One user's presence SESSION HISTORY for a single IST calendar day: when
// each browser/PWA session started, last activity, device, derived duration.
// This is session telemetry, NOT attendance — attendance stays the existing
// /admin/attendance module.
//
// Same strict RBAC as the overview: full ADMIN and not hr-only; 403 JSON for
// everyone else, 401 when signed out. Each access is audit-logged.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canViewPresence(me)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const userId = (sp.get("userId") ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });

  const dateRaw = (sp.get("date") ?? "").trim();
  if (dateRaw && !isValidDateKey(dateRaw)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const data = await getPresenceHistory(userId, dateRaw || undefined);
  if (!data) return NextResponse.json({ error: "User not found." }, { status: 404 });

  await audit({
    userId: me.id,
    action: "presence.history",
    entity: "User",
    entityId: userId,
    meta: { date: data.date },
    request: reqMeta(req),
  });

  return NextResponse.json(data);
}
