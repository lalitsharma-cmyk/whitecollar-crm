import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { canViewPresence, getPresenceOverview, OVERVIEW_REFRESH_MS } from "@/lib/presence";
import PresenceDashboard from "./PresenceDashboard";

// /admin/presence — Team Presence (Admin-only).
//
// Live "who is on the CRM right now" board: Online / Idle / Offline /
// Never-Active-Today per user, last seen, per-device sessions (browser, OS,
// PWA, current module + route) and a per-user session-history drawer.
//
// PAGE-LEVEL GUARD (not just the API): a manager/agent/HR account must not
// even render a shell of this page — same redirect target requireRole()
// uses. The APIs it polls re-check RBAC on every request.
export const dynamic = "force-dynamic";

export default async function PresencePage() {
  const me = await requireUser();
  if (!canViewPresence(me)) redirect("/dashboard");

  // Server-rendered first paint (no blank flash); the client then keeps it
  // fresh by polling GET /api/admin/presence every 30s while visible.
  // getPresenceOverview() also runs the opportunistic stale-session cleanup.
  const initial = await getPresenceOverview({});

  // Audit the page view itself (the API only audits its own accesses).
  await audit({ userId: me.id, action: "presence.view", entity: "System", meta: { via: "page" } });

  return (
    <>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Team Presence</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Who is on the CRM right now — live status, last seen, devices &amp; session history ·
            auto-refreshes every {Math.round(OVERVIEW_REFRESH_MS / 1000)}s
          </p>
        </div>
      </div>
      <PresenceDashboard initial={initial} />
    </>
  );
}
