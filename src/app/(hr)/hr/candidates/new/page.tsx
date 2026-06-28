import { requireHrPage } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import HRAddCandidateForm from "@/components/HRAddCandidateForm";
import { getHrUsers } from "@/lib/hrUsers";
import { UserPlus, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  const { me } = await requireHrPage();
  const agents = await getHrUsers();
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-300">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Add Candidate</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400">Fill in the candidate details below.</p>
          </div>
        </div>
        <Link href="/hr/candidates" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 transition">
          <ArrowLeft className="w-4 h-4" /> Candidates
        </Link>
      </div>
      <HRAddCandidateForm agents={agents} meId={me.id} />
    </div>
  );
}
