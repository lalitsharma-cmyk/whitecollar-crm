import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import HRAddCandidateForm from "@/components/HRAddCandidateForm";

export const dynamic = "force-dynamic";

export default async function NewCandidatePage() {
  const me = await requireUser();
  const agents = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-xl font-bold mb-4">Add Candidate</h1>
      <HRAddCandidateForm agents={agents} meId={me.id} />
    </div>
  );
}
