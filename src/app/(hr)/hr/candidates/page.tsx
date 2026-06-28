import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import type { HRCandidateStatus } from "@prisma/client";
import HRCandidateTable from "@/components/HRCandidateTable";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<Record<string,string>> }) {
  const { me, perms } = await requireHrPage();
  const sp = await searchParams;
  const showClosed = sp.closed === "1";
  const filterStatus = sp.status as HRCandidateStatus | undefined;

  const scope = hrScopeWhere(me);
  // ALWAYS exclude soft-deleted (recycle-bin) candidates from the list + counts.
  const where: NonNullable<Parameters<typeof prisma.hRCandidate.findMany>[0]>["where"] = { ...scope, deletedAt: null };
  if (sp.batch) {
    // Viewing the records created by a specific import batch — show all statuses.
    where.importBatchId = sp.batch;
  } else if (filterStatus) {
    where.status = filterStatus;
  } else {
    where.status = { notIn: showClosed ? [] : CLOSED_STATUS_KEYS };
  }

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
        _count: {
          select: {
            resumes: true,
            // UNREAD voice guidance for the current viewer — GUIDANCE messages this
            // user has NOT yet marked understood (no HRVoiceMessageRead row).
            voiceMessages: { where: { kind: "GUIDANCE", reads: { none: { userId: me.id } } } },
            // Open escalation threads (anything not yet RESOLVED).
            escalations: { where: { status: { not: "RESOLVED" } } },
          },
        },
      },
    }),
    getHrUsers(),
    prisma.hRCandidate.groupBy({ by: ["status"], where: { ...scope, deletedAt: null }, _count: { id: true } }),
  ]);

  const countMap: Record<string, number> = {};
  counts.forEach(r => { countMap[r.status] = r._count.id; });
  const rows = candidates.map(c => {
    const unreadVoiceCount = c._count.voiceMessages;
    const openEscalationCount = c._count.escalations;
    return {
      ...c,
      hasResume: c._count.resumes > 0,
      unreadVoiceCount,
      openEscalationCount,
      hasUnread: unreadVoiceCount > 0 || openEscalationCount > 0,
    };
  });

  return (
    <div className="p-4 sm:p-6 max-w-full space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Candidates</h1>
        <div className="flex gap-2">
          <Link href={showClosed ? "/hr/candidates" : "/hr/candidates?closed=1"}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            {showClosed ? "Show active" : "Show closed"}
          </Link>
          {perms.importData && (
            <Link href="/hr/import" className="text-sm px-4 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition">📥 Import</Link>
          )}
          <Link href="/hr/candidates/new"
            className="text-sm px-4 py-1.5 rounded-lg bg-[#1a2e4a] text-white font-semibold hover:bg-[#243d60] transition">
            + Add Candidate
          </Link>
        </div>
      </div>
      <HRCandidateTable
        candidates={rows as never}
        agents={agents}
        countMap={countMap}
        meId={me.id}
        meRole={me.role}
        perms={{
          importData: perms.importData,
          exportData: perms.exportData,
          bulkActions: perms.bulkActions,
          assign: perms.assign,
          deleteCandidate: perms.deleteCandidate,
        }}
      />
    </div>
  );
}
