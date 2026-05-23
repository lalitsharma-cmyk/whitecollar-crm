import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, AIScore } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { fmtMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const srcChip: Record<LeadSource, string> = {
  WEBSITE: "src-web", WHATSAPP: "src-wa", CSV_IMPORT: "src-csv", EVENT: "src-event",
  REFERRAL: "src", INBOUND_CALL: "src-call", FACEBOOK_ADS: "src-web", GOOGLE_ADS: "src-csv",
  PORTAL_99ACRES: "src", PORTAL_MAGICBRICKS: "src", PORTAL_HOUSING: "src", OTHER: "src",
};
const srcLabel: Record<LeadSource, string> = {
  WEBSITE: "Website", WHATSAPP: "WhatsApp", CSV_IMPORT: "CSV", EVENT: "Event",
  REFERRAL: "Referral", INBOUND_CALL: "Inbound Call", FACEBOOK_ADS: "Facebook",
  GOOGLE_ADS: "Google", PORTAL_99ACRES: "99acres", PORTAL_MAGICBRICKS: "MagicBricks",
  PORTAL_HOUSING: "Housing", OTHER: "Other",
};
const statusChip: Record<LeadStatus, string> = {
  NEW: "chip-new", CONTACTED: "chip-warm", QUALIFIED: "chip-warm", SITE_VISIT: "chip-warm",
  NEGOTIATION: "chip-warm", BOOKING_DONE: "chip-won", WON: "chip-won", LOST: "chip-lost",
};
const aiChip = (s: AIScore | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : "chip-cold";

export default async function LeadsPage() {
  const [leads, total, hot, newToday] = await Promise.all([
    prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { owner: true, interestedUnits: { include: { unit: { include: { project: true } } }, take: 1 } },
    }),
    prisma.lead.count(),
    prisma.lead.count({ where: { aiScore: AIScore.HOT } }),
    prisma.lead.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } }),
  ]);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-gray-500">{total} total · {newToday} new in last 24h · {hot} hot</p>
        </div>
        <div className="flex gap-2">
          <Link href="/intake" className="btn btn-ghost">Import / Intake</Link>
          <button className="btn btn-ghost">Export CSV</button>
          <button className="btn btn-primary">+ New Lead</button>
        </div>
      </div>

      <div className="card p-4 flex flex-wrap gap-2 items-center">
        <select className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"><option>All sources</option>{Object.values(LeadSource).map(s => <option key={s}>{srcLabel[s]}</option>)}</select>
        <select className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"><option>All statuses</option>{Object.values(LeadStatus).map(s => <option key={s}>{s.replaceAll("_", " ")}</option>)}</select>
        <select className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"><option>AI score: any</option><option>Hot</option><option>Warm</option><option>Cold</option></select>
        <input type="search" placeholder="Search name / phone / email" className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]" />
      </div>

      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr>
            <th></th><th>Lead</th><th>Team</th><th>Source</th><th>Budget</th><th>Stage</th><th>AI Score</th><th>Owner</th><th>Last touch</th><th></th>
          </tr></thead>
          <tbody>
            {leads.map((l) => {
              const interest = l.interestedUnits[0];
              const teamChipClass = l.forwardedTeam === "India" ? "src-csv" : "src-wa";
              return (
                <tr key={l.id}>
                  <td><input type="checkbox" /></td>
                  <td>
                    <Link href={`/leads/${l.id}`} className="font-semibold text-[#0b1a33] hover:underline">{l.name}</Link>
                    <div className="text-xs text-gray-500">{l.phone}{l.email ? ` · ${l.email}` : ""}</div>
                    {interest && <div className="text-[11px] text-gray-500">→ {interest.unit.project.name} {interest.unit.configuration}</div>}
                  </td>
                  <td><span className={`chip ${teamChipClass}`}>{l.forwardedTeam ?? "—"}</span></td>
                  <td><span className={`chip ${srcChip[l.source]}`}>{srcLabel[l.source]}</span></td>
                  <td className="text-sm font-semibold">{l.budgetMin ? fmtMoney(l.budgetMin, l.budgetCurrency) : <span className="text-gray-400 font-normal">—</span>}</td>
                  <td><span className={`chip ${statusChip[l.status]}`}>{l.status.replaceAll("_", " ")}</span></td>
                  <td>{l.aiScore ? <span className={`chip ${aiChip(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span> : <span className="text-gray-400">—</span>}</td>
                  <td>{l.owner ? <div className={`avatar ${l.owner.avatarColor ?? "bg-slate-500"}`}>{l.owner.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</div> : <span className="text-gray-400">—</span>}</td>
                  <td className="text-xs text-gray-500">{l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: true }) : "—"}</td>
                  <td>⋯</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between p-3 text-xs text-gray-500">
          <div>Showing 1–{leads.length} of {total}</div>
        </div>
      </div>
    </>
  );
}
