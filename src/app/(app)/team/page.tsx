import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { acefoneEnabled } from "@/lib/acefone";
import { fmtMoneyDual } from "@/lib/money";
import { TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { activeLeadWhere, ACTIVE_ORIGINS } from "@/lib/leadScope";
import AcefoneAgentIdEdit from "@/components/AcefoneAgentIdEdit";
import WhatsAppNumberEdit from "@/components/WhatsAppNumberEdit";
import ManagerPicker from "@/components/ManagerPicker";
import UserSpecializationEditor from "@/components/UserSpecializationEditor";
import AgentLeavePanel from "@/components/AgentLeavePanel";
import { getOnLeaveEntries } from "@/lib/leave";
import Link from "next/link";

export const dynamic = "force-dynamic";

const roleChip: Record<string,string> = { ADMIN: "chip-hot", MANAGER: "chip-warm", AGENT: "chip-new" };

// JS getDay() index (0=Sun … 6=Sat) → short label, for the weekly-off chip.
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type PipelineRow = { ownerId: string; currency: string; total: number };
type ResponseRow = { ownerId: string; avgMinutes: number | null };

export default async function TeamPage() {
  // ADMIN/MANAGER only — this page exposes every teammate's call counts,
  // pipeline value, and response times (competitive data) plus role/Acefone
  // editors. Agents are redirected to /dashboard; they have /profile +
  // /leaderboards for their own stats and the (intended) public rankings.
  const me = await requireRole("ADMIN", "MANAGER");
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [users, activeLeadCounts, pipelineRows, responseRows] = await Promise.all([
    // SALES roster only — HR/non-sales users (hrOnly, e.g. Nisha) NEVER appear on
    // the Team scoreboard (call counts / pipeline / response times are sales data).
    // Driven off the canonical hrOnly flag, not a name. Admins stay (cross-team owners).
    prisma.user.findMany({
      where: { active: true, hrOnly: false },
      // "Active leads" column — CANONICAL active envelope (ACTIVE_LEAD origin,
      // non-deleted, non-terminal status). Identical to the Workload column and
      // every reporting surface for the same agent.
      include: { _count: { select: { ownedLeads: { where: { deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS }, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] } }, callLogs: true } } },
      orderBy: [{ team: "asc" }, { name: "asc" }],
    }),
    prisma.lead.groupBy({
      by: ["ownerId"],
      // Workload — same canonical active envelope, scoped to owned leads.
      where: activeLeadWhere({ ownerId: { not: null } }),
      _count: { _all: true },
    }),
    prisma.$queryRaw<PipelineRow[]>`
      SELECT "ownerId", COALESCE("budgetCurrency", 'AED') AS currency, SUM("budgetMin")::float AS total
      FROM "Lead"
      WHERE "ownerId" IS NOT NULL
        AND "currentStatus" IS NOT NULL
        AND "budgetMin" IS NOT NULL
        AND "leadOrigin" NOT IN ('COLD','REVIVAL')
        AND "updatedAt" >= ${ninetyDaysAgo}
      GROUP BY "ownerId", COALESCE("budgetCurrency", 'AED')
    `,
    prisma.$queryRaw<ResponseRow[]>`
      WITH first_calls AS (
        SELECT DISTINCT ON (cl."leadId") cl."leadId", cl."startedAt"
        FROM "CallLog" cl
        ORDER BY cl."leadId", cl."startedAt" ASC
      )
      SELECT l."ownerId" AS "ownerId",
             AVG(EXTRACT(EPOCH FROM (fc."startedAt" - l."createdAt")) / 60.0) AS "avgMinutes"
      FROM "Lead" l
      JOIN first_calls fc ON fc."leadId" = l."id"
      WHERE l."ownerId" IS NOT NULL
        AND l."createdAt" >= ${thirtyDaysAgo}
        AND fc."startedAt" >= l."createdAt"
      GROUP BY l."ownerId"
    `,
  ]);

  const activeCountByOwner = new Map<string, number>();
  for (const row of activeLeadCounts) {
    if (row.ownerId) activeCountByOwner.set(row.ownerId, row._count._all);
  }

  const pipelineByOwner = new Map<string, { aed: number; inr: number }>();
  for (const row of pipelineRows) {
    if (!row.ownerId) continue;
    const cur = pipelineByOwner.get(row.ownerId) ?? { aed: 0, inr: 0 };
    const total = Number(row.total) || 0;
    if ((row.currency || "AED").toUpperCase() === "INR") cur.inr += total;
    else cur.aed += total;
    pipelineByOwner.set(row.ownerId, cur);
  }

  const responseByOwner = new Map<string, number | null>();
  for (const row of responseRows) {
    if (!row.ownerId) continue;
    responseByOwner.set(row.ownerId, row.avgMinutes == null ? null : Number(row.avgMinutes));
  }

  const canEditAcefone = me.role === "ADMIN";
  const canEditProfile = me.role === "ADMIN" || me.role === "MANAGER";
  const ace = acefoneEnabled();

  // Agent leave-cover (#16) — admin-only panel to mark agents on/off leave today.
  const onLeaveMap = new Map((await getOnLeaveEntries()).map((e) => [e.userId, e.until]));
  const leaveAgents = users.map((u) => ({
    id: u.id, name: u.name, team: u.team,
    onLeave: onLeaveMap.has(u.id), until: onLeaveMap.get(u.id) ?? null,
  }));

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Team &amp; Roles</h1>
      </div>

      {/* Leave-cover control — ADMIN only (managers see the roster but don't set leave) */}
      {me.role === "ADMIN" && <AgentLeavePanel agents={leaveAgents} />}

      {/* Acefone setup banner */}
      <div className={`card p-4 border-l-4 ${ace ? "border-emerald-500 bg-emerald-50" : "border-amber-500 bg-amber-50"}`}>
        <div className="flex items-start gap-3">
          <div className="text-2xl">📞</div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">
              Acefone click-to-call · {ace ? <span className="text-emerald-700">Connected</span> : <span className="text-amber-700">Not configured</span>}
            </div>
            {ace ? (
              <p className="text-xs text-gray-700 mt-1">
                Map each agent's Acefone agent id below. When an agent clicks "📞 Call via Acefone" on a lead, Acefone rings <b>their</b> phone first, then dials the lead.
                All call events (answered, missed, recorded) auto-create CallLog entries via webhook.
              </p>
            ) : (
              <div className="text-xs text-gray-700 mt-1 space-y-1">
                <p>To turn on, add these to Vercel → <b>Project → Settings → Environment Variables</b>:</p>
                <ul className="list-disc ml-5 space-y-0.5">
                  <li><code className="bg-white px-1 rounded">ACEFONE_API_KEY</code> — from Acefone dashboard → API Tokens</li>
                  <li><code className="bg-white px-1 rounded">ACEFONE_DID_NUMBER</code> — your virtual number (e.g. <code>+91…</code> or <code>+971…</code>)</li>
                  <li><code className="bg-white px-1 rounded">ACEFONE_WEBHOOK_TOKEN</code> — any random string (32+ chars) — used to verify webhooks</li>
                  <li><code className="bg-white px-1 rounded">ACEFONE_BASE_URL</code> — optional; defaults to <code>https://api.acefone.in</code> (use <code>https://api.acefone.co.uk</code> for UK accounts)</li>
                </ul>
                <p className="mt-2">Then in Acefone dashboard → <b>Webhooks</b>, paste this URL for every trigger:</p>
                <code className="block bg-white px-2 py-1 rounded text-[11px] break-all">https://crm.whitecollarrealty.com/api/acefone/webhook?token=&lt;your-webhook-token&gt;</code>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[1500px]">
          <thead><tr>
            <th>User</th><th>Role</th><th>Team</th>
            <th>Manager</th>
            <th>Specializations & target</th>
            <th>Acefone agent id</th>
            <th>Company WhatsApp #</th>
            <th>Active leads</th><th>Total calls</th>
            <th>Workload</th>
            <th>Pipeline value (90d)</th>
            <th>Avg response</th>
          </tr></thead>
          <tbody>
            {users.map(u => {
              const workload = activeCountByOwner.get(u.id) ?? 0;
              const workloadColor =
                workload >= 50 ? "text-red-700 bg-red-50 border-red-200"
                : workload >= 20 ? "text-amber-700 bg-amber-50 border-amber-200"
                : "text-emerald-700 bg-emerald-50 border-emerald-200";

              const pipeline = pipelineByOwner.get(u.id) ?? { aed: 0, inr: 0 };
              const pipelineLabel = fmtMoneyDual(pipeline);

              const avg = responseByOwner.get(u.id);
              const avgMins = avg == null ? null : Math.round(avg);
              const avgLabel = avgMins == null ? "—" : `${avgMins}m`;
              const avgColor =
                avgMins == null ? "text-gray-500"
                : avgMins < 15 ? "text-emerald-700"
                : avgMins <= 60 ? "text-amber-700"
                : "text-red-700";

              return (
                <tr key={u.id}>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className={`avatar ${u.avatarColor ?? "bg-slate-500"}`}>{u.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</div>
                      <div>
                        <div className="font-semibold">
                          <Link href={"/team/" + u.id} className="hover:underline text-[#0b1a33]">
                            {u.name}
                          </Link>
                        </div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`chip ${roleChip[u.role]}`}>{u.role}</span></td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <span>{u.team ?? "—"}</span>
                      {u.weeklyOff != null && DOW_SHORT[u.weeklyOff] && (
                        <span className="inline-flex w-fit items-center rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                          Off: {DOW_SHORT[u.weeklyOff]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td>
                    <ManagerPicker
                      userId={u.id}
                      initial={u.managerId}
                      candidates={users.map(c => ({ id: c.id, name: c.name }))}
                      canEdit={canEditAcefone}
                    />
                  </td>
                  <td>
                    <UserSpecializationEditor
                      userId={u.id}
                      initialSpecializations={u.specializations}
                      initialDailyCallTarget={u.dailyCallTarget}
                      canEdit={canEditProfile}
                    />
                  </td>
                  <td>
                    <AcefoneAgentIdEdit userId={u.id} initial={u.acefoneAgentId} canEdit={canEditAcefone} />
                  </td>
                  <td>
                    <WhatsAppNumberEdit userId={u.id} initial={u.companyWhatsAppNumber} canEdit={canEditAcefone} />
                  </td>
                  <td>{u._count.ownedLeads}</td>
                  <td>{u._count.callLogs}</td>
                  <td>
                    <span className={`inline-flex items-center justify-center min-w-[2.5rem] px-2 py-0.5 rounded-full border text-xs font-semibold ${workloadColor}`}>
                      {workload}
                    </span>
                  </td>
                  <td className="text-xs font-medium whitespace-nowrap">{pipelineLabel}</td>
                  <td className={`text-sm font-semibold ${avgColor}`}>{avgLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <div className="font-semibold mb-2">Permission matrix</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[500px]">
            <thead><tr className="text-xs text-gray-500"><th className="text-left py-2">Capability</th><th>Admin</th><th>Manager</th><th>Agent</th></tr></thead>
            <tbody className="divide-y divide-[#e5e7eb]">
              <tr><td className="py-2">View all leads</td><td className="text-center">✅</td><td className="text-center">✅ team</td><td className="text-center">Own only</td></tr>
              <tr><td className="py-2">Reassign leads</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">—</td></tr>
              <tr><td className="py-2">Manage users & roles</td><td className="text-center">✅</td><td className="text-center">—</td><td className="text-center">—</td></tr>
              <tr><td className="py-2">Set Acefone agent ids</td><td className="text-center">✅</td><td className="text-center">—</td><td className="text-center">—</td></tr>
              <tr><td className="py-2">Bulk CSV import</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">—</td></tr>
              <tr><td className="py-2">Use AI assistant</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">✅</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
