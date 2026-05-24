import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const roleChip: Record<string,string> = { ADMIN: "chip-hot", MANAGER: "chip-warm", AGENT: "chip-new" };

export default async function TeamPage() {
  const users = await prisma.user.findMany({
    where: { active: true },
    include: { _count: { select: { ownedLeads: true, callLogs: true } } },
  });
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Team & Roles</h1>
        <button className="btn btn-primary self-start sm:self-auto justify-center">+ Invite User</button>
      </div>
      <div className="card overflow-x-auto">
        <table className="tbl min-w-[640px]">
          <thead><tr><th>User</th><th>Role</th><th>Team</th><th>Active leads</th><th>Total calls</th></tr></thead>
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
                <td>{u._count.ownedLeads}</td>
                <td>{u._count.callLogs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card p-5">
        <div className="font-semibold mb-2">Permission matrix</div>
        <table className="w-full text-sm">
          <thead><tr className="text-xs text-gray-500"><th className="text-left py-2">Capability</th><th>Admin</th><th>Manager</th><th>Agent</th></tr></thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            <tr><td className="py-2">View all leads</td><td className="text-center">✅</td><td className="text-center">✅ team</td><td className="text-center">Own only</td></tr>
            <tr><td className="py-2">Reassign leads</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">—</td></tr>
            <tr><td className="py-2">Manage users & roles</td><td className="text-center">✅</td><td className="text-center">—</td><td className="text-center">—</td></tr>
            <tr><td className="py-2">Bulk CSV import</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">—</td></tr>
            <tr><td className="py-2">Use AI assistant</td><td className="text-center">✅</td><td className="text-center">✅</td><td className="text-center">✅</td></tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
