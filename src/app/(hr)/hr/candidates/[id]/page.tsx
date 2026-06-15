import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import HRCandidateDetail from "@/components/HRCandidateDetail";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const [candidate, agents] = await Promise.all([
    prisma.hRCandidate.findUnique({
      where: { id },
      include: {
        primaryOwner:   { select: { id: true, name: true, avatarColor: true } },
        secondaryOwner: { select: { id: true, name: true, avatarColor: true } },
        activities:     { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
        interviews:     { orderBy: { scheduledAt: "asc" }, include: { interviewer: { select: { name: true } } } },
        followUps:      { orderBy: { dueAt: "asc" }, include: { user: { select: { name: true } } } },
        resumes:        { orderBy: { createdAt: "desc" }, take: 5 },
        applications:   { orderBy: { submittedAt: "desc" } },  // website/form application history
      },
    }),
    getHrUsers(),
  ]);

  if (!candidate) notFound();

  return <HRCandidateDetail candidate={candidate as never} agents={agents} me={{ id: me.id, name: me.name, role: me.role }} />;
}
