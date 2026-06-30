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

  // Server pagination — 50 rows/page, navigated via ?page= (1-based). This caps
  // the per-row include fan-out (follow-ups / interviews / activities / resume
  // count) to a single page instead of the old fixed 300-row load.
  const PAGE_SIZE = 50;
  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const [total, candidates, agents, counts] = await Promise.all([
    prisma.hRCandidate.count({ where }),
    prisma.hRCandidate.findMany({
      where,
      orderBy: [{ nextActionDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: PAGE_SIZE,
      skip,
      include: {
        primaryOwner: { select: { id: true, name: true } },
        followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1, select: { dueAt: true } },
        interviews: { orderBy: { scheduledAt: "desc" }, take: 5, select: { scheduledAt: true, type: true, confirmationStatus: true, attendanceStatus: true } },
        // A small window of recent activity feeds both the "Last Activity" column
        // (index 0) and the hover preview (most-recent NOTE_ADDED + CALL_* lookup).
        activities: { orderBy: { createdAt: "desc" }, take: 12, select: { type: true, createdAt: true, notes: true } },
        // Resume presence stays a per-row relation count (cheap, direct relation).
        _count: { select: { resumes: true } },
      },
    }),
    getHrUsers(),
    prisma.hRCandidate.groupBy({ by: ["status"], where: { ...scope, deletedAt: null }, _count: { id: true } }),
  ]);

  // Unread-signal counts in TWO grouped queries over JUST the visible page's ids,
  // instead of a correlated subquery per candidate row.
  const pageIds = candidates.map(c => c.id);
  const [voiceGroups, escGroups] = pageIds.length === 0
    ? [[], []]
    : await Promise.all([
        // UNREAD voice guidance for the current viewer — GUIDANCE messages this
        // user has NOT yet marked understood (no HRVoiceMessageRead row).
        prisma.hRVoiceMessage.groupBy({
          by: ["candidateId"],
          where: { candidateId: { in: pageIds }, kind: "GUIDANCE", reads: { none: { userId: me.id } } },
          _count: { _all: true },
        }),
        // Open escalation threads (anything not yet RESOLVED).
        prisma.hREscalation.groupBy({
          by: ["candidateId"],
          where: { candidateId: { in: pageIds }, status: { not: "RESOLVED" } },
          _count: { _all: true },
        }),
      ]);
  const voiceMap = new Map(voiceGroups.map(g => [g.candidateId, g._count._all]));
  const escMap = new Map(escGroups.map(g => [g.candidateId, g._count._all]));

  const countMap: Record<string, number> = {};
  counts.forEach(r => { countMap[r.status] = r._count.id; });
  const rows = candidates.map(c => {
    const unreadVoiceCount = voiceMap.get(c.id) ?? 0;
    const openEscalationCount = escMap.get(c.id) ?? 0;
    return {
      ...c,
      hasResume: c._count.resumes > 0,
      unreadVoiceCount,
      openEscalationCount,
      hasUnread: unreadVoiceCount > 0 || openEscalationCount > 0,
    };
  });

  // Pagination window for the prev/next controls + "showing X of N".
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const fromRow = total === 0 ? 0 : skip + 1;
  const toRow = Math.min(skip + PAGE_SIZE, total);
  // Preserve the current query string (closed / status / batch) across page links.
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (sp.closed) q.set("closed", sp.closed);
    if (sp.status) q.set("status", sp.status);
    if (sp.batch) q.set("batch", sp.batch);
    q.set("page", String(p));
    return `/hr/candidates?${q.toString()}`;
  };

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

      {/* Server pagination — prev/next + showing X of N */}
      <div className="flex items-center justify-between flex-wrap gap-2 pt-1">
        <div className="text-xs text-gray-500 dark:text-slate-400">
          {total === 0 ? "No candidates" : <>Showing <span className="font-semibold text-gray-700 dark:text-slate-200">{fromRow}–{toRow}</span> of <span className="font-semibold text-gray-700 dark:text-slate-200">{total}</span></>}
        </div>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            {page > 1
              ? <Link href={pageHref(page - 1)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition">← Prev</Link>
              : <span className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-300 dark:text-slate-600 cursor-not-allowed">← Prev</span>}
            <span className="text-xs text-gray-500 dark:text-slate-400">Page {page} of {totalPages}</span>
            {page < totalPages
              ? <Link href={pageHref(page + 1)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800 transition">Next →</Link>
              : <span className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-300 dark:text-slate-600 cursor-not-allowed">Next →</span>}
          </div>
        )}
      </div>
    </div>
  );
}
