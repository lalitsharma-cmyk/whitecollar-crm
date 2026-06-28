import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import HRShell from "@/components/HRShell";
import { hrRoleOf, permissionsFor } from "@/lib/hrPermissions";
import { hrScopeWhere } from "@/lib/hrAccess";

export default async function HRLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // HR module is for HR users only — Sales agents / managers cannot view it.
  if (!user.hrOnly && !user.hrTeam && user.role !== "ADMIN") redirect("/dashboard");

  // Role-aware nav: the backend already enforces every permission; this hides
  // nav items the user lacks so they don't see dead/confusing links.
  const hrRole = hrRoleOf(user);
  const perms = permissionsFor(hrRole);

  // Badge count for Missed Follow-Ups (overdue + no next action). Scope by the HR
  // permission model (not raw role) so the badge matches what the user can see.
  const overdueCount = await prisma.hRFollowUp.count({
    where: {
      completedAt: null,
      dueAt: { lt: new Date() },
      candidate: { AND: [hrScopeWhere(user), { deletedAt: null }] },
    },
  });

  return (
    <HRShell
      user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-indigo-500" }}
      hrRole={hrRole}
      perms={{ reports: perms.reports, settings: perms.settings, importData: perms.importData }}
      overdueCount={overdueCount}
    >
      {children}
    </HRShell>
  );
}
