import { prisma } from "@/lib/prisma";
import { fmtIST12 } from "@/lib/datetime";

export const dynamic = "force-dynamic";

const oc: Record<string, string> = {
  CONNECTED: "chip-won", NOT_PICKED: "chip-lost", CALLBACK: "chip-warm",
  WRONG_NUMBER: "chip-lost", BUSY: "chip-warm", SWITCHED_OFF: "chip-lost",
  INTERESTED: "chip-won", NOT_INTERESTED: "chip-lost",
};

export default async function CallsPage() {
  const calls = await prisma.callLog.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
    include: { lead: true, user: true },
  });
  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold">Call Records</h1>
        <p className="text-xs text-gray-500 sm:hidden">Tap a row to call back.</p>
      </div>

      {/* MOBILE: card list */}
      <div className="lg:hidden space-y-2">
        {calls.length === 0 && <div className="card p-6 text-center text-gray-500 text-sm">No calls logged yet.</div>}
        {calls.map((c) => (
          <div key={c.id} className="card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm truncate">{c.lead?.name ?? c.phoneNumber}</div>
                <div className="text-[11px] text-gray-500">{c.user.name} · {fmtIST12(c.startedAt)} IST</div>
              </div>
              <span className={`chip ${oc[c.outcome] ?? "src"} text-[9px] flex-none`}>{c.outcome.replaceAll("_"," ")}</span>
            </div>
            <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-500">
              <span>{c.direction}</span>
              <span>{c.durationSec ? `${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : "—"}</span>
            </div>
            {c.notes && <div className="text-[11px] text-gray-700 mt-1 line-clamp-2">{c.notes}</div>}
          </div>
        ))}
      </div>

      {/* DESKTOP: table */}
      <div className="card overflow-x-auto hidden lg:block">
        <table className="tbl min-w-[640px]">
          <thead><tr><th>Time</th><th>Lead</th><th>Agent</th><th>Direction</th><th>Outcome</th><th>Duration</th></tr></thead>
          <tbody>
            {calls.map(c => (
              <tr key={c.id}>
                <td className="text-sm">{fmtIST12(c.startedAt)} IST</td>
                <td>{c.lead?.name ?? c.phoneNumber}</td>
                <td>{c.user.name}</td>
                <td><span className="chip src">{c.direction}</span></td>
                <td><span className={`chip ${oc[c.outcome] ?? "src"}`}>{c.outcome.replaceAll("_"," ")}</span></td>
                <td>{c.durationSec ? `${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
