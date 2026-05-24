import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { acefoneEnabled } from "@/lib/acefone";
import AcefoneAgentIdEdit from "@/components/AcefoneAgentIdEdit";

export const dynamic = "force-dynamic";

const roleChip: Record<string,string> = { ADMIN: "chip-hot", MANAGER: "chip-warm", AGENT: "chip-new" };

export default async function TeamPage() {
  const me = await requireUser();
  const users = await prisma.user.findMany({
    where: { active: true },
    include: { _count: { select: { ownedLeads: true, callLogs: true } } },
    orderBy: [{ team: "asc" }, { name: "asc" }],
  });
  const canEditAcefone = me.role === "ADMIN";
  const ace = acefoneEnabled();

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Team & Roles</h1>
        <button className="btn btn-primary self-start sm:self-auto justify-center">+ Invite User</button>
      </div>

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
        <table className="tbl min-w-[760px]">
          <thead><tr>
            <th>User</th><th>Role</th><th>Team</th>
            <th>Acefone agent id</th>
            <th>Active leads</th><th>Total calls</th>
          </tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td>
                  <div className="flex items-center gap-2">
                    <div className={`avatar ${u.avatarColor ?? "bg-slate-500"}`}>{u.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</div>
                    <div><div className="font-semibold">{u.name}</div><div className="text-xs text-gray-500">{u.email}</div></div>
                  </div>
                </td>
                <td><span className={`chip ${roleChip[u.role]}`}>{u.role}</span></td>
                <td>{u.team ?? "—"}</td>
                <td>
                  <AcefoneAgentIdEdit userId={u.id} initial={u.acefoneAgentId} canEdit={canEditAcefone} />
                </td>
                <td>{u._count.ownedLeads}</td>
                <td>{u._count.callLogs}</td>
              </tr>
            ))}
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
