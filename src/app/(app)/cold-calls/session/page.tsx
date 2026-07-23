import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import ColdCallSession from "@/components/ColdCallSession";

export const dynamic = "force-dynamic";

// 🎯 Cold-call Power-Dial Session
// Loads up to 20 cold-call candidates owned by the agent and hands them to
// the client component for one-tap outcome logging. "Stale" cut-off is 7 days
// since lastTouchedAt (or never touched) so we don't keep redialing the same
// number every hour.
export default async function ColdCallSessionPage() {
  const me = await requireUser();
  const cutoff = new Date(Date.now() - 7 * 86400_000);

  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      ownerId: me.id,
      isColdCall: true,
      // Null/blank-status cold leads are the FRESHEST — a bare `notIn` drops them in
      // Postgres (NULL is neither in nor not-in a set), hiding the very leads the main
      // list's "Fresh" chip keeps. Nested under AND so it composes with the OR below.
      AND: [{ OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: SUPPRESSED_STATUSES } }] }],
      OR: [
        { lastTouchedAt: null },
        { lastTouchedAt: { lt: cutoff } },
      ],
    },
    orderBy: [{ aiScore: "desc" }, { budgetMin: "desc" }],
    take: 20,
    select: {
      id: true,
      name: true,
      phone: true,
      budgetMin: true,
      budgetMax: true,
      budgetCurrency: true,
      aiScore: true,
      whoIsClient: true,
      remarks: true,
      coldCallReason: true,
      lastTouchedAt: true,
    },
  });

  // Serialise Date → ISO string so the prop is JSON-safe for the client boundary.
  const safe = leads.map((l) => ({
    ...l,
    lastTouchedAt: l.lastTouchedAt ? l.lastTouchedAt.toISOString() : null,
  }));

  return <ColdCallSession leads={safe} />;
}
