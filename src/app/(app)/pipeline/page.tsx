import { prisma } from "@/lib/prisma";
import { LeadStatus, AIScore } from "@prisma/client";
import Link from "next/link";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";

export const dynamic = "force-dynamic";

const stages: { key: LeadStatus; label: string }[] = [
  { key: LeadStatus.NEW,          label: "New" },
  { key: LeadStatus.CONTACTED,    label: "Contacted" },
  { key: LeadStatus.QUALIFIED,    label: "Qualified" },
  { key: LeadStatus.SITE_VISIT,   label: "Site Visit" },
  { key: LeadStatus.NEGOTIATION,  label: "Negotiation" },
  { key: LeadStatus.WON,          label: "Won" },
];

const aiClass = (s: AIScore | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : "chip-cold";

export default async function PipelinePage() {
  const leads = await prisma.lead.findMany({
    where: { status: { in: stages.map(s => s.key) } },
    orderBy: { updatedAt: "desc" },
    include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
  });

  const open = leads.filter(l => ["QUALIFIED", "SITE_VISIT", "NEGOTIATION"].includes(l.status));
  const aedOpen = open.filter(l => l.budgetCurrency === "AED").reduce((s, l) => s + (l.budgetMin ?? 0), 0);
  const inrOpen = open.filter(l => l.budgetCurrency === "INR").reduce((s, l) => s + (l.budgetMin ?? 0), 0);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Pipeline</h1>
          <p className="text-sm text-gray-500">{leads.length} leads in pipeline · open value {fmtMoneyDual({ aed: aedOpen, inr: inrOpen })}</p>
        </div>
        <div className="seg">
          <button className="on">Kanban</button>
          <Link href="/leads">List</Link>
        </div>
      </div>

      <div className="grid grid-cols-6 gap-3">
        {stages.map((stage) => {
          const items = leads.filter(l => l.status === stage.key);
          const aedSum = items.filter(l => l.budgetCurrency === "AED").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          const inrSum = items.filter(l => l.budgetCurrency === "INR").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          return (
            <div key={stage.key} className="col">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm">{stage.label} <span className="text-gray-500 font-normal">· {items.length}</span></div>
                <span className="text-[10px] text-gray-500">{(aedSum + inrSum) > 0 ? fmtMoneyDual({ aed: aedSum, inr: inrSum }) : "—"}</span>
              </div>
              {items.slice(0, 12).map(l => {
                const proj = l.interestedUnits[0]?.unit;
                return (
                  <Link key={l.id} href={`/leads/${l.id}`} className="kanban-card block">
                    <div className="font-semibold text-sm">{l.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {proj ? `${proj.project.name} ${proj.configuration}` : l.configuration ?? "—"}
                      {l.budgetMin ? ` · ${fmtMoney(l.budgetMin, l.budgetCurrency)}` : ""}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {l.aiScore && <span className={`chip ${aiClass(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span>}
                      {l.owner && <div className={`avatar ${l.owner.avatarColor ?? "bg-slate-500"}`}>{l.owner.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</div>}
                    </div>
                  </Link>
                );
              })}
              {items.length > 12 && <div className="kanban-card text-xs text-gray-500">+ {items.length - 12} more…</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}
