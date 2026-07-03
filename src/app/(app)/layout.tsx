import AttendancePing from "@/components/AttendancePing";
import MobileShell from "@/components/MobileShell";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SUPPRESSED_STATUSES, TERMINAL_STATUSES } from "@/lib/lead-statuses";
import { overdueFollowupBoundary } from "@/lib/datetime";
import { getTestingModeEnabled } from "@/lib/settings";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  // HR-only users (e.g. Nisha, HR Intern) must not access the Sales CRM.
  // Redirect them to the HR workspace immediately.
  if ((user as { hrOnly?: boolean }).hrOnly) redirect("/hr");
  const testingMode = await getTestingModeEnabled();
  // Count of leads sitting in the admin "Awaiting team assignment" queue.
  // Only ADMIN + MANAGER ever see the link, so skip the query for agents.
  // Lalit's mandatory-team policy (2026-06) parks null-team leads in this
  // queue until an admin picks Dubai or India — the badge keeps it visible.
  // MY overdue follow-ups (FU-4 safeguard) — leads I own whose follow-up date is
  // before today (IST) and are still workable. Badged on the "Leads" nav item so
  // every user sees their own overdue count the moment they log in. Personal
  // (ownerId = me) so the number stays actionable, not a team-wide firehose.
  // Uses the ONE canonical overdue boundary so it can't drift from the Leads
  // "Overdue" chip / Action List / compliance report.
  const [awaitingTeamCount, myOverdueFollowups] = await Promise.all([
    (user.role === "ADMIN" || user.role === "MANAGER")
      ? prisma.lead.count({ where: { deletedAt: null, forwardedTeam: null, currentStatus: { notIn: SUPPRESSED_STATUSES } } })
      : Promise.resolve(0),
    prisma.lead.count({
      where: {
        deletedAt: null,
        ownerId: user.id,
        currentStatus: { notIn: TERMINAL_STATUSES },
        followupDate: { not: null, lt: overdueFollowupBoundary() },
      },
    }),
  ]);
  return (
    <>
      {process.env.NEXT_PUBLIC_SANDBOX === "1" && (
        <div className="sticky top-0 z-[210] w-full bg-amber-500 text-black text-[11px] font-bold px-4 py-2 text-center flex items-center justify-center gap-2 border-b border-amber-600">
          🧪 SANDBOX ENVIRONMENT — NOT PRODUCTION
          <span className="font-normal opacity-90 hidden sm:inline">
            &nbsp;—&nbsp; dummy data only. Nothing here affects the live CRM. Safe to import, delete, and experiment.
          </span>
        </div>
      )}
      {testingMode && user.role !== "AGENT" && (
        <div className="sticky top-0 z-[200] w-full bg-red-500 text-white text-[11px] font-bold px-4 py-2 text-center flex items-center justify-center gap-2 border-b border-red-600">
          🧪 DESTRUCTIVE-OPS MODE
          <span className="font-normal opacity-90 hidden sm:inline">
            &nbsp;—&nbsp; lead-wipe enabled. Automation &amp; notifications are unaffected (Settings → Automation Controls).
          </span>
        </div>
      )}
      <AttendancePing />
      <MobileShell
        user={{ id: user.id, name: user.name, role: user.role, avatarColor: user.avatarColor ?? "bg-slate-500", photoUrl: user.photoUrl, team: user.team, leadOpsOnly: (user as { leadOpsOnly?: boolean }).leadOpsOnly }}
        awaitingTeamCount={awaitingTeamCount}
        myOverdueFollowups={myOverdueFollowups}
      >
        {children}
      </MobileShell>
    </>
  );
}
