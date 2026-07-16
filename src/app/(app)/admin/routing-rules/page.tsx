import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Role } from "@prisma/client";
import { isRoutingPaused } from "@/lib/leadRouting";
import { serializeRule } from "@/app/api/admin/routing-rules/shared";
import RoutingRulesClient from "./RoutingRulesClient";

export const dynamic = "force-dynamic";

// Lead Routing Scheduler — ADMIN-only. Date-windowed rules that override the
// default auto-assignment (manual assignment always wins; rules fire only where
// auto-assign fires). No cron: activation/expiry derive from startsAt/endsAt at
// assignment time. Agents/managers/HR are redirected — the page never renders
// for them and it is deliberately absent from any nav they see.
export default async function RoutingRulesPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN" || me.hrOnly) redirect("/dashboard");

  const now = new Date();
  const [rulesRaw, users, projects, paused] = await Promise.all([
    prisma.routingRule.findMany({
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      include: {
        createdBy: { select: { name: true } },
        versions: { orderBy: { changedAt: "desc" }, take: 1, select: { action: true } },
      },
    }),
    // Recipient picker roster: real, active, non-HR sales-side users (agents,
    // managers, admins — Lalit himself is a routing target today).
    prisma.user.findMany({
      where: { active: true, hrOnly: false, role: { in: [Role.AGENT, Role.MANAGER, Role.ADMIN] } },
      select: { id: true, name: true, team: true, role: true },
      orderBy: [{ team: "asc" }, { name: "asc" }],
    }),
    prisma.project.findMany({
      where: { active: true },
      select: { name: true, country: true },
      orderBy: { name: "asc" },
    }),
    isRoutingPaused(),
  ]);

  const rules = rulesRaw.map((r) => serializeRule(r, now));
  const activeCount = rules.filter((r) => r.status === "Active").length;

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Lead Routing Scheduler</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
          Date-windowed rules that decide WHO new leads auto-assign to —{" "}
          <span className="font-semibold">{activeCount}</span> active now. Rules apply only where the CRM
          auto-assigns; a human picking an owner always wins. Rules activate and expire by their dates
          automatically (checked at assignment time — no scheduler involved).
        </p>
      </div>
      <RoutingRulesClient
        rules={rules}
        users={users.map((u) => ({ id: u.id, name: u.name, team: u.team ?? "", role: u.role }))}
        projects={projects.map((p) => ({ name: p.name, country: p.country }))}
        pausedInitial={paused}
      />
    </>
  );
}
