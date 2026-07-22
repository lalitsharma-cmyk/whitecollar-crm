import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import AdminUsersClient from "@/components/AdminUsersClient";
import { excludePendingCallsWhere } from "@/lib/ghosting";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const me = await requireRole("ADMIN");

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      team: true,
      active: true,
      employmentStatus: true,
      lastWorkingDate: true,
      offboardReason: true,
      createdAt: true,
      // "Calls" column — unresolved dials (INITIATED / RINGING) excluded so the
      // per-user total counts calls placed, not Call-button taps. Matches the
      // "Total calls" column on /team for the same user.
      _count: { select: { ownedLeads: true, callLogs: { where: { ...excludePendingCallsWhere() } } } },
    },
  });

  return (
    <div className="space-y-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
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

      <AdminUsersClient initialUsers={users} currentUserId={me.id} />
    </div>
  );
}
