import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HRAddCandidateForm from "@/components/HRAddCandidateForm";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  const me = await requireUser();
  const agents = await getHrUsers();
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-1 text-gray-900 dark:text-white">Add Candidate</h1>
      <p className="text-sm text-gray-500 mb-4">Fill in the candidate details below.</p>
      <HRAddCandidateForm agents={agents} meId={me.id} />
    </div>
  );
}
