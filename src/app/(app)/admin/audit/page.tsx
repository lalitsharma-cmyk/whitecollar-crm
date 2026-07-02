import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { formatDistanceToNow } from "date-fns";
import { fmtIST12 } from "@/lib/datetime";
import Link from "next/link";
import AuditUserFilter from "@/components/AuditUserFilter";

export const dynamic = "force-dynamic";

// Color-code by action category so scary stuff jumps out
const categoryStyle: Record<string, string> = {
  "export":   "chip-hot",       // CSV downloads
  "auth":     "chip-warm",      // logins
  "admin":    "chip-hot",       // wipe, role changes
  "user":     "chip-warm",
  "lead":     "chip-new",
};

function actionStyle(action: string) {
  const cat = action.split(".")[0];
  return categoryStyle[cat] ?? "chip-lost";
}

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const userId = sp.userId;
  const action = sp.action;

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;
  if (action) where.action = { contains: action };

  const [entries, users, totalToday] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.auditLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } },
    }),
  ]);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🔒 Audit Log</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Append-only trail of security-sensitive actions. {totalToday} entries in last 24h · showing {entries.length} of last 1000.
        </p>
      </div>

      {/* Filters */}
      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <Link
          href="/admin/audit"
          className={`chip ${!userId && !action ? "chip-warm" : "chip-lost"}`}
        >All</Link>
        {["export", "admin", "auth.login.fail", "lead.bulk"].map((a) => (
          <Link
            key={a}
            href={`/admin/audit?action=${a}`}
            className={`chip ${action === a ? "chip-warm" : "chip-lost"}`}
          >{a}</Link>
        ))}
        <AuditUserFilter users={users.map((u) => ({ id: u.id, name: u.name }))} current={userId ?? null} />
      </div>

      {/* MOBILE: card list */}
      <div className="lg:hidden space-y-2">
        {entries.length === 0 && <div className="card p-5 text-center text-gray-500 text-sm">No entries.</div>}
        {entries.map((e) => {
          const meta = e.meta ? safeParse(e.meta) : null;
          return (
            <div key={e.id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <span className={`chip ${actionStyle(e.action)} text-[10px]`}>{e.action}</span>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">{formatDistanceToNow(e.createdAt, { addSuffix: true })}</span>
              </div>
              <div className="text-xs mt-1">
                <b>{e.user?.name ?? "anonymous"}</b>
                {e.entityId && <span className="text-gray-500"> · {e.entity}:{e.entityId.slice(0, 10)}</span>}
              </div>
              {meta != null && (
                <pre className="text-[10px] text-gray-600 mt-1 whitespace-pre-wrap break-all font-mono bg-gray-50 p-2 rounded">{JSON.stringify(meta)}</pre>
              )}
            </div>
          );
        })}
      </div>

      {/* DESKTOP: table */}
      <div className="card overflow-x-auto hidden lg:block">
        <table className="tbl min-w-[760px]">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Entity</th>
              <th>Detail (meta)</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">No entries match.</td></tr>
            )}
            {entries.map((e) => {
              const meta = e.meta ? safeParse(e.meta) : null;
              const ip = meta && typeof meta === "object" && "ip" in meta ? (meta as { ip?: string }).ip : null;
              return (
                <tr key={e.id}>
                  <td className="text-xs whitespace-nowrap">
                    {fmtIST12(e.createdAt)} IST
                    <div className="text-[10px] text-gray-500">{formatDistanceToNow(e.createdAt, { addSuffix: true })}</div>
                  </td>
                  <td className="text-xs">{e.user?.name ?? <span className="text-gray-400">anonymous</span>}</td>
                  <td><span className={`chip ${actionStyle(e.action)} text-[10px]`}>{e.action}</span></td>
                  <td className="text-xs">{e.entity}{e.entityId ? `:${e.entityId.slice(0, 8)}` : ""}</td>
                  <td>
                    {meta != null && <pre className="text-[10px] text-gray-600 whitespace-pre-wrap break-all font-mono max-w-md">{JSON.stringify(stripIpUa(meta))}</pre>}
                  </td>
                  <td className="text-[10px] text-gray-500 font-mono">{ip ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
function stripIpUa(o: unknown): unknown {
  if (!o || typeof o !== "object") return o;
  const { ip, ua, ...rest } = o as Record<string, unknown>;
  return rest;
}
