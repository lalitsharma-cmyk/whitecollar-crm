import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

const roleChip: Record<string, string> = {
  ADMIN:   "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  MANAGER: "bg-blue-100   text-blue-800   dark:bg-blue-900/40   dark:text-blue-300",
  AGENT:   "bg-green-100  text-green-800  dark:bg-green-900/40  dark:text-green-300",
};

const teamBadge: Record<string, string> = {
  Dubai: "bg-blue-100  text-blue-800  dark:bg-blue-900/40  dark:text-blue-300",
  India: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
};

export default async function AdminUsersPage() {
  await requireRole("ADMIN");

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      team: true,
      createdAt: true,
      _count: { select: { ownedLeads: true, callLogs: true } },
    },
  });

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/audit"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">👥 User Management</h1>
        <span className="text-sm text-gray-500 dark:text-slate-400">{users.length} user{users.length !== 1 ? "s" : ""} total</span>
      </div>

      {users.length === 0 && (
        <div className="text-sm text-gray-400 p-8 text-center border rounded-xl">No users found.</div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Team</th>
              <th className="px-4 py-3 font-medium text-right">Leads</th>
              <th className="px-4 py-3 font-medium text-right">Calls</th>
              <th className="px-4 py-3 font-medium">Joined</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const chipClass = roleChip[user.role] ?? roleChip.AGENT;
              const teamClass = user.team ? (teamBadge[user.team] ?? "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300") : "";

              return (
                <tr
                  key={user.id}
                  className="border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-800/40"
                >
                  {/* Name */}
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap">
                    {user.name}
                  </td>

                  {/* Email */}
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-400 max-w-[220px] truncate">
                    {user.email}
                  </td>

                  {/* Role chip */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${chipClass}`}>
                      {user.role}
                    </span>
                  </td>

                  {/* Team badge */}
                  <td className="px-4 py-3">
                    {user.team ? (
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${teamClass}`}>
                        {user.team}
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-slate-700 dark:text-slate-400">
                        Unassigned
                      </span>
                    )}
                  </td>

                  {/* Leads count — links to /leads?owner=userId */}
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/leads?owner=${user.id}`}
                      className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                    >
                      {user._count.ownedLeads}
                    </Link>
                  </td>

                  {/* Call logs count */}
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-300 font-medium">
                    {user._count.callLogs}
                  </td>

                  {/* Joined date */}
                  <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap">
                    {format(user.createdAt, "MMM yyyy")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
