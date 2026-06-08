import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import HRShell from "@/components/HRShell";

export default async function HRLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // HR module is for HR users only — Sales agents / managers cannot view it.
  if (!user.hrOnly && !user.hrTeam && user.role !== "ADMIN") redirect("/dashboard");

  // Badge count for Missed Follow-Ups (overdue + no next action)
  const overdueCount = await prisma.hRFollowUp.count({
    where: {
      completedAt: null,
      dueAt: { lt: new Date() },
      candidate: user.role === "AGENT"
        ? { OR: [{ primaryOwnerId: user.id }, { secondaryOwnerId: user.id }] }
        : {},
    },
  });

  return (
    <HRShell
      user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-indigo-500" }}
      overdueCount={overdueCount}
    >
      {children}
    </HRShell>
  );
}
