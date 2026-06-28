import { requireHrPage, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import HRResumeUploadWidget from "@/components/HRResumeUploadWidget";
import HRResumeBankClient, { type CandidateResumes } from "@/components/HRResumeBankClient";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import { FolderArchive } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ResumeBankPage() {
  const { me } = await requireHrPage();

  // Candidate scope — in HR scope, not soft-deleted. Used both for the upload
  // picker (open candidates only) and to bound the resume query.
  const candidateScope = { AND: [hrScopeWhere(me), { deletedAt: null }] };

  const [pickerCandidates, resumes] = await Promise.all([
    // Upload picker: open (non-closed) candidates in scope.
    prisma.hRCandidate.findMany({
      where: { AND: [hrScopeWhere(me), { deletedAt: null }, { status: { notIn: CLOSED_STATUS_KEYS as never[] } }] },
      select: { id: true, name: true, currentProfile: true },
      orderBy: { name: "asc" },
    }),
    // All resumes in scope (full version history), newest-first within candidate.
    prisma.hRResume.findMany({
      where: { candidate: candidateScope },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        candidateId: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        isActive: true,
        createdAt: true,
        candidate: { select: { id: true, name: true, currentProfile: true } },
        uploadedBy: { select: { name: true } },
      },
    }),
  ]);

  // Group resumes by candidate, preserving the active-first / newest-first order.
  const byCandidate = new Map<string, CandidateResumes>();
  for (const r of resumes) {
    let g = byCandidate.get(r.candidateId);
    if (!g) {
      g = {
        candidateId: r.candidateId,
        candidateName: r.candidate.name,
        currentProfile: r.candidate.currentProfile,
        versions: [],
      };
      byCandidate.set(r.candidateId, g);
    }
    g.versions.push({
      id: r.id,
      filename: r.filename,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
      uploadedByName: r.uploadedBy?.name ?? null,
    });
  }
  const groups = Array.from(byCandidate.values());

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-300">
            <FolderArchive className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Resume Bank</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              {resumes.length} resume{resumes.length !== 1 ? "s" : ""} across {groups.length} candidate{groups.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Quick upload — attach to a candidate */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 p-5">
        <h2 className="font-semibold text-sm mb-3 text-gray-700 dark:text-slate-200">Upload Resume</h2>
        <HRResumeUploadWidget candidates={pickerCandidates} />
      </div>

      {/* Searchable / sortable / paginated resume list with version history */}
      <HRResumeBankClient groups={groups} />
    </div>
  );
}
