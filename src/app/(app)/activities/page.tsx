import { prisma } from "@/lib/prisma";
import { ActivityStatus } from "@prisma/client";
import { startOfDay, endOfDay, format, isAfter, isBefore } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

function bucket(d: Date) {
  const h = d.getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

export default async function ActivitiesPage() {
  const dayStart = startOfDay(new Date());
  const dayEnd = endOfDay(new Date());

  const [today, overdue, upcoming] = await Promise.all([
    prisma.activity.findMany({
      where: { status: ActivityStatus.PLANNED, scheduledAt: { gte: dayStart, lte: dayEnd } },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true, user: true },
    }),
    prisma.activity.findMany({
      where: { status: ActivityStatus.PLANNED, scheduledAt: { lt: dayStart } },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true, user: true },
      take: 20,
    }),
    prisma.activity.findMany({
      where: { status: ActivityStatus.PLANNED, scheduledAt: { gt: dayEnd } },
      orderBy: { scheduledAt: "asc" },
      include: { lead: true, user: true },
      take: 20,
    }),
  ]);

  const groups: Record<"morning"|"afternoon"|"evening", typeof today> = { morning: [], afternoon: [], evening: [] };
  for (const a of today) if (a.scheduledAt) groups[bucket(a.scheduledAt)].push(a);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Activities & Follow-ups</h1>
          <p className="text-sm text-gray-500">{format(new Date(), "PPP")} · {today.length} planned today · {overdue.length} overdue</p>
        </div>
      </div>

      {overdue.length > 0 && (
        <div className="card p-5 border-amber-300 bg-amber-50">
          <div className="font-semibold text-amber-800 mb-2">⚠ Overdue ({overdue.length})</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {overdue.slice(0, 6).map(a => (
              <Link key={a.id} href={a.lead ? `/leads/${a.lead.id}` : "#"} className="p-3 border border-amber-200 rounded-lg bg-white text-sm hover:bg-amber-100">
                <div className="text-xs text-amber-700">{a.scheduledAt && format(a.scheduledAt, "PP p")} · {a.type}</div>
                <div className="font-semibold">{a.title} {a.lead && `· ${a.lead.name}`}</div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(["morning", "afternoon", "evening"] as const).map((b) => (
          <div key={b} className="card p-4">
            <div className="font-semibold mb-3 capitalize">{b}</div>
            <div className="space-y-2 text-sm">
              {groups[b].length === 0 && <div className="text-gray-400 text-xs">Nothing scheduled.</div>}
              {groups[b].map((a) => (
                <Link key={a.id} href={a.lead ? `/leads/${a.lead.id}` : "#"} className="block p-3 border border-[#e5e7eb] rounded-lg hover:border-[#c9a24b]">
                  <div className="text-xs text-gray-500">{a.scheduledAt && format(a.scheduledAt, "p")} · {a.type}</div>
                  <div className="font-semibold">{a.title} {a.lead && `· ${a.lead.name}`}</div>
                  {a.user && <div className="text-xs text-gray-500 mt-1">{a.user.name}</div>}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <div className="font-semibold mb-3">Upcoming this week</div>
        <div className="space-y-2 text-sm">
          {upcoming.length === 0 && <div className="text-gray-500 text-xs">Nothing scheduled yet.</div>}
          {upcoming.map((a) => (
            <Link key={a.id} href={a.lead ? `/leads/${a.lead.id}` : "#"} className="flex items-center justify-between p-3 border border-[#e5e7eb] rounded-lg hover:border-[#c9a24b]">
              <div>
                <div className="font-semibold">{a.title} {a.lead && `· ${a.lead.name}`}</div>
                <div className="text-xs text-gray-500">{a.scheduledAt && format(a.scheduledAt, "PP p")} · {a.user?.name ?? "—"}</div>
              </div>
              <span className="chip src">{a.type}</span>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
