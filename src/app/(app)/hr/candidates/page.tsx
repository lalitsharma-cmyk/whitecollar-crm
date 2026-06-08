import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { HRCandidateStatus } from "@prisma/client";
import HRCandidatesClient from "@/components/HRCandidatesClient";

export const dynamic = "force-dynamic";

const ACTIVE_STATUSES: HRCandidateStatus[] = [
  "NEW","NOT_CALLED","PIPELINE",
  "VIRTUAL_INTERVIEW_SCHEDULED","HR_INTERVIEW_COMPLETED",
  "FINAL_INTERVIEW_SCHEDULED","FINAL_INTERVIEW_COMPLETED",
  "SHORTLISTED","OFFER_RELEASED","JOINED","HOLD",
];
const CLOSED_STATUSES: HRCandidateStatus[] = [
  "NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE",
  "REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF",
  "NEVER_RESPONSE","NOT_RESPONDING",
];

export default async function HRCandidatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const showClosed = sp.closed === "1";
  const filterStatus = sp.status as HRCandidateStatus | undefined;

  const scope = me.role === "AGENT"
    ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] }
    : {};

  const where: NonNullable<Parameters<typeof prisma.hRCandidate.findMany>[0]>["where"] = { ...scope };
  if (filterStatus) {
    where.status = filterStatus;
  } else {
    where.status = { notIn: showClosed ? [] : CLOSED_STATUSES };
  }

  const [candidates, agents, statusCounts] = await Promise.all([
    prisma.hRCandidate.findMany({
      where,
      orderBy: [{ nextActionDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 100,
      include: {
        primaryOwner:   { select: { name: true, avatarColor: true } },
        followUps:      { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1 },
        interviews:     { where: { attendanceStatus: "SCHEDULED" }, orderBy: { scheduledAt: "asc" }, take: 1 },
        _count:         { select: { activities: true } },
      },
    }),
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, avatarColor: true },
      orderBy: { name: "asc" },
    }),
    prisma.hRCandidate.groupBy({
      by: ["status"],
      where: scope,
      _count: { id: true },
    }),
  ]);

  const countMap: Partial<Record<HRCandidateStatus, number>> = {};
  for (const r of statusCounts) countMap[r.status] = r._count.id;
  const totalActive = ACTIVE_STATUSES.reduce((s, st) => s + (countMap[st] ?? 0), 0);
  const totalClosed = CLOSED_STATUSES.reduce((s, st) => s + (countMap[st] ?? 0), 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold">Candidates</h1>
          <p className="text-xs text-gray-500">
            {totalActive} active · {totalClosed} closed
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/hr/candidates?closed=1"
            className={`text-xs px-3 py-1.5 rounded-full border transition ${showClosed ? "bg-gray-800 text-white border-gray-800" : "text-gray-500 border-gray-300 hover:border-gray-500"}`}>
            {showClosed ? "← Back to active" : "Show closed"}
          </Link>
          <Link href="/hr/candidates/new" className="btn btn-primary text-sm">+ Add Candidate</Link>
        </div>
      </div>

      <HRCandidatesClient
        candidates={candidates as never}
        agents={agents}
        meId={me.id}
        meRole={me.role}
        activeStatuses={ACTIVE_STATUSES}
        closedStatuses={CLOSED_STATUSES}
        countMap={countMap as Record<string, number>}
      />
    </div>
  );
}
