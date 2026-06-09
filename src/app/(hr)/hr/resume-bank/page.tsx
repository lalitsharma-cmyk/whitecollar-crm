import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRResumeUploadWidget from "@/components/HRResumeUploadWidget";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";

export const dynamic = "force-dynamic";

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function ResumeBankPage() {
  const me = await requireUser();
  const scope = me.role === "AGENT"
    ? { OR: [{ primaryOwnerId: me.id }, { secondaryOwnerId: me.id }] }
    : {};

  // All candidates — for the "attach to candidate" picker
  const [candidates, resumes] = await Promise.all([
    prisma.hRCandidate.findMany({
      where: { ...scope, status: { notIn: CLOSED_STATUS_KEYS as never[] } },
      select: { id: true, name: true, currentProfile: true },
      orderBy: { name: "asc" },
    }),
    prisma.hRResume.findMany({
      where: { candidate: scope },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { candidate: { select: { id: true, name: true } }, uploadedBy: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Resume Bank</h1>
          <p className="text-sm text-gray-500">{resumes.length} resume{resumes.length !== 1 ? "s" : ""} stored</p>
        </div>
      </div>

      {/* Quick upload — attach to a candidate */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
        <h2 className="font-semibold text-sm mb-3 text-gray-700 dark:text-slate-200">📎 Upload Resume</h2>
        <HRResumeUploadWidget candidates={candidates} />
      </div>

      {/* All resumes */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-slate-800 text-sm font-semibold text-gray-700 dark:text-slate-200">
          All Resumes
        </div>
        {resumes.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <div className="text-3xl mb-2">📁</div>
            <div className="text-sm">No resumes uploaded yet.</div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-slate-800">
            {resumes.map(r => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3">
                {/* File type icon */}
                <div className="w-9 h-9 rounded-lg bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0 text-lg">
                  {r.mimeType.startsWith("image/") ? "🖼️" : "📄"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 dark:text-slate-200 truncate">{r.filename}</span>
                    {r.isActive && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">Active</span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex flex-wrap gap-2">
                    <Link href={`/hr/candidates/${r.candidateId}`} className="font-medium text-blue-600 hover:underline">{r.candidate.name}</Link>
                    {r.sizeBytes && <span>{fmtSize(r.sizeBytes)}</span>}
                    {r.uploadedBy?.name && <span>by {r.uploadedBy.name.split(" ")[0]}</span>}
                    <span>{new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {/* View/download */}
                  <a href={`/api/hr/candidates/${r.candidateId}/resume?resumeId=${r.id}${r.mimeType.startsWith("image/") ? "" : "&download=1"}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-blue-300 text-blue-700 bg-white hover:bg-blue-50">
                    {r.mimeType.startsWith("image/") ? "View" : "Download"}
                  </a>
                  <Link href={`/hr/candidates/${r.candidateId}`}
                    className="text-[11px] px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 bg-white hover:bg-gray-50">
                    Profile →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
