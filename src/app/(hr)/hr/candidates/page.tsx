import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { HRCandidateStatus } from "@prisma/client";
import HRCandidateTable from "@/components/HRCandidateTable";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const showClosed = sp.closed === "1";
  const filterStatus = sp.status as HRCandidateStatus | undefined;

  const scope = me.role === "AGENT" ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] } : {};
  const where: NonNullable<Parameters<typeof prisma.hRCandidate.findMany>[0]>["where"] = { ...scope };
  if (filterStatus) where.status = filterStatus;
  else where.status = { notIn: showClosed ? [] : CLOSED_STATUS_KEYS };

  const [candidates, agents, counts] = await Promise.all([
    prisma.hRCandidate.findMany({
      where,
      orderBy: [{ nextActionDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
      include: {
        primaryOwner: { select: { id: true, name: true } },
        followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true } },
        interviews: { orderBy: { scheduledAt: "desc" }, take: 5, select: { scheduledAt: true, type: true, confirmationStatus: true, attendanceStatus: true } },
        activities: { orderBy: { createdAt: "desc" }, take: 1, select: { type: true, createdAt: true } },
        _count: { select: { resumes: true } },
      },
    }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.hRCandidate.groupBy({ by: ["status"], where: scope, _count: { id: true } }),
  ]);

  const countMap: Record<string, number> = {};
  counts.forEach(r => { countMap[r.status] = r._count.id; });
  const rows = candidates.map(c => ({ ...c, hasResume: c._count.resumes > 0 }));

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Candidates</h1>
        <div className="flex gap-2">
          <Link href={showClosed ? "/hr/candidates" : "/hr/candidates?closed=1"}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            {showClosed ? "Show active" : "Show closed"}
          </Link>
          {(me.role === "ADMIN" || me.role === "MANAGER") && (
            <Link href="/hr/import" className="text-sm px-4 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">📥 Import</Link>
          )}
          <Link href="/hr/candidates/new"
            className="text-sm px-4 py-1.5 rounded-lg bg-[#1a2e4a] text-white font-semibold hover:bg-[#243d60] transition">
            + Add Candidate
          </Link>
        </div>
      </div>
      <HRCandidateTable candidates={rows as never} agents={agents} countMap={countMap} meId={me.id} meRole={me.role} />
    </div>
  );
}
