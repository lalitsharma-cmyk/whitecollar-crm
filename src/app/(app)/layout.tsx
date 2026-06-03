import MobileShell from "@/components/MobileShell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTestingModeEnabled } from "@/lib/settings";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const testingMode = await getTestingModeEnabled();
  // Count of leads sitting in the admin "Awaiting team assignment" queue.
  // Only ADMIN + MANAGER ever see the link, so skip the query for agents.
  // Lalit's mandatory-team policy (2026-06) parks null-team leads in this
  // queue until an admin picks Dubai or India — the badge keeps it visible.
  const awaitingTeamCount = (user.role === "ADMIN" || user.role === "MANAGER")
    ? await prisma.lead.count({ where: { forwardedTeam: null, status: { not: "LOST" } } })
    : 0;
  return (
    <>
      {testingMode && (
        <div className="sticky top-0 z-[200] w-full bg-amber-400 text-amber-950 text-[11px] font-bold px-4 py-2 text-center flex items-center justify-center gap-2 border-b border-amber-500">
          ⚠ TEST MODE ACTIVE
          <span className="font-normal opacity-80 hidden sm:inline">
            &nbsp;—&nbsp; Automation Disabled: WhatsApp · Assignment · Escalations · Notifications · Scheduled Actions
          </span>
        </div>
      )}
      <MobileShell
        user={{ name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-slate-500", photoUrl: user.photoUrl }}
        awaitingTeamCount={awaitingTeamCount}
      >
        {children}
      </MobileShell>
    </>
  );
}
