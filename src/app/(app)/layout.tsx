import MobileShell from "@/components/MobileShell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Count of leads sitting in the admin "Awaiting team assignment" queue.
  // Only ADMIN + MANAGER ever see the link, so skip the query for agents.
  // Lalit's mandatory-team policy (2026-06) parks null-team leads in this
  // queue until an admin picks Dubai or India — the badge keeps it visible.
  const awaitingTeamCount = (user.role === "ADMIN" || user.role === "MANAGER")
    ? await prisma.lead.count({ where: { forwardedTeam: null, status: { not: "LOST" } } })
    : 0;
  return (
    <MobileShell
      user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-slate-500", photoUrl: user.photoUrl }}
      awaitingTeamCount={awaitingTeamCount}
    >
      {children}
    </MobileShell>
  );
}
