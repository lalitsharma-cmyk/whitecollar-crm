// 👻 Ghosting metric card — self-contained SERVER component for the dashboard.
//
// Shows the viewer-scoped count of display-eligible ghosting leads (current
// owner logged ≥ghostingThreshold call attempts, zero connects, still owned,
// status neither terminal nor closing) + the average attempt count, and links
// to /reports/ghosting. The where is imported from the Ghosting report's
// shared builder so the card, the report and the /leads?ghost=1 drill can
// never drift apart (one envelope, three surfaces).
//
// Scoping matches every other lead surface via leadScopeWhere:
//   ADMIN → all leads · MANAGER → their team · AGENT → their own.
// Zero-state: renders nothing for an AGENT with 0 ghosting leads (don't nag);
// admins/managers still see the calm zero card so the metric stays discoverable.
import Link from "next/link";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leadScopeWhere } from "@/lib/leadScope";
import { ghostingDisplayWhere } from "@/app/(app)/reports/ghosting/ghosting";

export interface GhostingMetricViewer {
  id: string;
  role: Role | "ADMIN" | "MANAGER" | "AGENT";
  team?: string | null;
}

export default async function GhostingMetricCard({ viewer }: { viewer: GhostingMetricViewer }) {
  const scope = await leadScopeWhere({ id: viewer.id, role: viewer.role as Role, team: viewer.team ?? null });
  const where = ghostingDisplayWhere(scope);

  const [count, agg] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.aggregate({ _avg: { attemptCount: true }, where }),
  ]);

  // Agents with nothing ghosting get no card at all — zero-state nagging helps
  // nobody. Leadership keeps the (gray) zero card for discoverability.
  if (count === 0 && viewer.role === "AGENT") return null;

  const avg = agg._avg.attemptCount;

  return (
    <Link
      href="/reports/ghosting"
      className={`card p-4 border-l-4 hover:shadow-lg transition ${
        count > 0 ? "border-violet-500 active:bg-violet-50" : "border-gray-300 active:bg-gray-50"
      }`}
      title="Open the Ghosting Report"
    >
      <div className={`text-3xl font-extrabold ${count > 0 ? "text-violet-700 dark:text-violet-300" : "text-gray-400"}`}>
        {count}
      </div>
      <div className="text-xs font-semibold text-violet-900 dark:text-violet-300 mt-1">👻 Ghosting Leads</div>
      <div className="text-[10px] text-violet-700/70 dark:text-violet-400/70 mt-0.5">
        {count > 0 && avg != null ? `avg ${avg.toFixed(1)} attempts · no response` : "10+ call attempts · no response"}
      </div>
    </Link>
  );
}
