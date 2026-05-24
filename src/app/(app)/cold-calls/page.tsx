import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { LeadStatus, Prisma } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { whatsappLink, telLink } from "@/lib/phone";
import ColdCallToggle from "@/components/ColdCallToggle";

export const dynamic = "force-dynamic";

// A "cold call" is a prospect, NOT an active sales lead. Three ways a lead
// lands here:
//   1) Manager flagged isColdCall=true explicitly
//   2) BANT verdict = NOT_QUALIFIED (we still want to nurture, just slower cadence)
//   3) No contact in 30+ days AND status NEW / CONTACTED (orphaned outbound list)
//
// Everything here is filtered OUT of the main /leads view so agents focus on
// real warm pipeline. They can be re-promoted to leads with one click.

const COLD_DAYS = 30;

export default async function ColdCallsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const showOnly = sp.kind ?? "all";
  const cutoff = new Date(Date.now() - COLD_DAYS * 86400 * 1000);

  const scope: Prisma.LeadWhereInput = me.role === "AGENT" ? { ownerId: me.id } : {};

  // Three sub-buckets — used to render the counts
  const manualCold: Prisma.LeadWhereInput = { isColdCall: true };
  const bantNot: Prisma.LeadWhereInput = { bantStatus: "NOT_QUALIFIED" };
  const stale: Prisma.LeadWhereInput = {
    status: { in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
    lastTouchedAt: { lt: cutoff },
    isColdCall: false,
    bantStatus: { not: "NOT_QUALIFIED" },
  };
  const allCold: Prisma.LeadWhereInput = {
    AND: [scope, { OR: [manualCold, bantNot, stale] }],
  };

  const where: Prisma.LeadWhereInput =
    showOnly === "manual" ? { AND: [scope, manualCold] } :
    showOnly === "bant" ? { AND: [scope, bantNot] } :
    showOnly === "stale" ? { AND: [scope, stale] } :
    allCold;

  const [leads, manualCount, bantCount, staleCount, totalCount] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: { owner: true },
      orderBy: { lastTouchedAt: "asc" },
      take: 200,
    }),
    prisma.lead.count({ where: { AND: [scope, manualCold] } }),
    prisma.lead.count({ where: { AND: [scope, bantNot] } }),
    prisma.lead.count({ where: { AND: [scope, stale] } }),
    prisma.lead.count({ where: allCold }),
  ]);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🧊 Cold Calls</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Prospects that aren't active leads. Outbound cadence — call once a week, not daily.
          Use BANT verdict on a lead to send it here automatically.
        </p>
      </div>

      {/* Sub-bucket tabs */}
      <div className="seg flex-wrap">
        <Link href="/cold-calls" className={showOnly === "all" ? "on" : ""}>All · {totalCount}</Link>
        <Link href="/cold-calls?kind=manual" className={showOnly === "manual" ? "on" : ""}>Manual cold · {manualCount}</Link>
        <Link href="/cold-calls?kind=bant" className={showOnly === "bant" ? "on" : ""}>BANT not qualified · {bantCount}</Link>
        <Link href="/cold-calls?kind=stale" className={showOnly === "stale" ? "on" : ""}>{COLD_DAYS}d+ stale · {staleCount}</Link>
      </div>

      {leads.length === 0 && (
        <div className="card p-8 text-center text-gray-500 text-sm">
          Nothing in this bucket. Either your team is on top of follow-ups (✅) or there are no leads in this stage.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {leads.map((l) => {
          const wa = l.phone ? whatsappLink(l.phone, `Hi ${l.name.split(" ")[0]}, this is from White Collar Realty. Just checking in — any update on your property search?`) : "";
          const tel = l.phone ? telLink(l.phone) : "";
          const reasonChips: { label: string; cls: string }[] = [];
          if (l.isColdCall) reasonChips.push({ label: "Manual cold", cls: "chip-cold" });
          if (l.bantStatus === "NOT_QUALIFIED") reasonChips.push({ label: "BANT ❌", cls: "chip-lost" });
          if (l.lastTouchedAt && l.lastTouchedAt < cutoff && !l.isColdCall && l.bantStatus !== "NOT_QUALIFIED") {
            reasonChips.push({ label: `${COLD_DAYS}d+ stale`, cls: "chip-warm" });
          }

          return (
            <div key={l.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${l.id}`} className="font-bold text-sm hover:underline truncate block">{l.name}</Link>
                  <div className="text-[11px] text-gray-500 truncate">{l.phone}</div>
                </div>
                <ColdCallToggle leadId={l.id} initial={l.isColdCall} />
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {reasonChips.map((c, i) => <span key={i} className={`chip ${c.cls} text-[9px]`}>{c.label}</span>)}
              </div>
              {l.coldCallReason && <div className="text-[11px] text-gray-700 mt-1 italic">"{l.coldCallReason}"</div>}
              <div className="text-[11px] text-gray-500 mt-2">
                {l.owner ? `Owner: ${l.owner.name}` : "Unassigned"} · last touch {l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: true }) : "never"}
              </div>
              {l.phone && (
                <div className="flex gap-2 mt-2">
                  <a href={tel} className="btn text-xs bg-emerald-600 text-white flex-1 justify-center">📞 Call</a>
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="btn text-xs bg-[#25D366] text-white flex-1 justify-center">💬 WhatsApp</a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
