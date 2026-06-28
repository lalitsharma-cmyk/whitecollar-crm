import { requireHrPage, canTouchCandidate } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import HRCandidateDetail from "@/components/HRCandidateDetail";
import { getHrUsers } from "@/lib/hrUsers";

export const dynamic = "force-dynamic";

export default async function CandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { me, perms } = await requireHrPage();
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
        // Voice + escalations feed the unified conversation timeline. Audio bytes
        // (audioData) are NEVER selected here — they stream from the play endpoint.
        // The Voice & Escalations card self-fetches its own full state separately.
        voiceMessages:  {
          orderBy: { createdAt: "desc" },
          select: { id: true, kind: true, createdById: true, title: true, textNote: true, transcript: true, durationSec: true, escalationId: true, createdAt: true },
        },
        escalations:    {
          orderBy: { createdAt: "desc" },
          select: { id: true, reason: true, status: true, raisedById: true, resolvedAt: true, createdAt: true },
        },
      },
    }),
    getHrUsers(),
  ]);

  if (!candidate) notFound();
  if (candidate.deletedAt) notFound(); // soft-deleted (recycle-bin) → 404
  if (!canTouchCandidate(me, candidate)) notFound();

  return (
    <HRCandidateDetail
      candidate={candidate as never}
      agents={agents}
      me={{ id: me.id, name: me.name, role: me.role }}
      voicePerms={{
        canGuide: perms.sendVoiceGuidance,
        canEscalate: perms.raiseEscalation,
        canReview: perms.reviewEscalations,
      }}
    />
  );
}
