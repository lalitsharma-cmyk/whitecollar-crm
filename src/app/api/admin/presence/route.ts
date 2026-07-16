import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { canViewPresence, getPresenceOverview } from "@/lib/presence";

// GET /api/admin/presence — the live "who is on the CRM" overview.
//
// STRICT RBAC (Lalit spec): full ADMIN (Super-Admin carries role ADMIN) and
// NOT hr-only. Managers, agents and HR (Nisha) get an explicit 403 JSON —
// never an empty 200 (an empty 200 would look like "nobody online" and hide
// the leak). Signed-out → 401.
//
// Query params: ?status=ONLINE|IDLE|OFFLINE|NEVER_ACTIVE_TODAY  ?team=…
//               ?role=ADMIN|MANAGER|AGENT  ?q=<name/email>  ?poll=1
//
// Every admin ACCESS is audit-logged (action "presence.view"). The page's
// 30-second background auto-refresh passes poll=1 and is NOT re-logged —
// the initial page view / manual filter change already recorded the access,
// and logging every poll would write ~2,880 AuditLog rows per open tab per
// day. The initial audit row records that auto-refresh was on.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!canViewPresence(me)) {
    return NextResponse.json({ error: "Admin only." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const filters = {
    status: sp.get("status"),
    team: sp.get("team"),
    role: sp.get("role"),
    q: sp.get("q"),
  };
  const isPoll = sp.get("poll") === "1";

  const data = await getPresenceOverview(filters);

  if (!isPoll) {
    await audit({
      userId: me.id,
      action: "presence.view",
      entity: "System",
      meta: {
        status: filters.status ?? undefined,
        team: filters.team ?? undefined,
        role: filters.role ?? undefined,
        q: filters.q ? "(search)" : undefined, // don't persist the search text itself
        autoRefresh: true,
      },
      request: reqMeta(req),
    });
  }

  return NextResponse.json(data);
}
