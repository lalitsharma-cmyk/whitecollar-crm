import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Call Records</h1>
        <button className="btn btn-primary">+ Log Call</button>
      </div>
      <div className="card overflow-hidden">
        <table className="tbl">
          <thead><tr><th>Time</th><th>Lead</th><th>Agent</th><th>Direction</th><th>Outcome</th><th>Duration</th></tr></thead>
          <tbody>
            {calls.map(c => (
              <tr key={c.id}>
                <td className="text-sm">{format(c.startedAt, "PP p")}</td>
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
