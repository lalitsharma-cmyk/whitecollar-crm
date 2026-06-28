import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { locationLabel } from "@/lib/device";
import { DeviceRowActions, UserLogoutAll, UserDeviceLimit, ForceLogoutEveryone } from "@/components/DeviceActions";

// Admin / Super-Admin device & session control. requireRole("ADMIN") covers
// super-admins. Shows every user's devices (approve/reject/block/remove) + live
// sessions + the force-logout kill switch.
export const dynamic = "force-dynamic";

const fmt = (d: Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

const STATUS_CHIP: Record<string, string> = {
  APPROVED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  PENDING: "bg-amber-100 text-amber-800 border-amber-200",
  BLOCKED: "bg-rose-100 text-rose-700 border-rose-200",
};

export default async function DevicesPage() {
  await requireRole("ADMIN");
  const now = new Date();
  const users = await prisma.user.findMany({
    where: { active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, email: true, role: true, isSuperAdmin: true, deviceLimitExtra: true,
      devices: { orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }], include: { approvedBy: { select: { name: true } } } },
      loginSessions: {
        where: { revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastActiveAt: "desc" },
        take: 8,
      },
    },
  });

  const pendingCount = users.reduce((n, u) => n + u.devices.filter((d) => d.status === "PENDING").length, 0);
  const enforce = process.env.DEVICE_SECURITY_ENFORCE === "true";
  // Surface users with pending devices first.
  const sorted = [...users].sort((a, b) => {
    const ap = a.devices.some((d) => d.status === "PENDING") ? 0 : 1;
    const bp = b.devices.some((d) => d.status === "PENDING") ? 0 : 1;
    return ap - bp;
  });

  return (
    <>
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Devices &amp; Sessions</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Trusted-device control · <span className="font-semibold">{pendingCount}</span> pending approval ·
            mode: <span className={`font-semibold ${enforce ? "text-rose-600" : "text-amber-600"}`}>{enforce ? "Enforcing" : "Monitoring"}</span>
          </p>
        </div>
        {/* Rollout step 1 — sign everyone out so each real device is re-captured on
            next login. Monitor-safe: re-login just works (no approval needed yet). */}
        <ForceLogoutEveryone />
      </div>

      {!enforce && (
        <div className="card p-3 border-l-4 border-amber-500 bg-amber-50/60 text-sm text-amber-900 dark:bg-slate-800 dark:text-amber-200">
          🛡️ <b>Monitoring mode</b> — every device is being recorded and you&apos;re alerted on new ones, but nobody is blocked yet.
          Once every real device shows <b>Approved</b> here, flip enforcement on to block unapproved devices.
        </div>
      )}

      <div className="space-y-4">
        {sorted.map((u) => (
          <div key={u.id} className="card p-0 overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[#e5e7eb] dark:border-slate-700 bg-gray-50/60 dark:bg-slate-800/60">
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {u.name}{" "}
                  <span className="text-xs font-normal text-gray-500">· {u.isSuperAdmin ? "Super Admin" : u.role === "ADMIN" ? "Admin" : u.role === "MANAGER" ? "Manager" : "Agent"}</span>
                </div>
                <div className="text-xs text-gray-500 truncate">{u.email} · {u.loginSessions.length} active session(s)</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <UserDeviceLimit userId={u.id} extra={u.deviceLimitExtra} />
                <UserLogoutAll userId={u.id} name={u.name} />
              </div>
            </div>

            {u.devices.length === 0 ? (
              <div className="px-4 py-3 text-xs text-gray-400">No devices recorded yet (user hasn&apos;t logged in since device-security went live).</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#f1f5f9] dark:border-slate-700">
                      <th className="px-4 py-2 font-semibold">Device</th>
                      <th className="px-3 py-2 font-semibold">Type</th>
                      <th className="px-3 py-2 font-semibold hidden md:table-cell">IP / Location</th>
                      <th className="px-3 py-2 font-semibold hidden lg:table-cell">First seen</th>
                      <th className="px-3 py-2 font-semibold hidden sm:table-cell">Last seen</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {u.devices.map((d) => (
                      <tr key={d.id} className="border-b border-[#f1f5f9] dark:border-slate-700">
                        <td className="px-4 py-2">
                          <div className="font-medium">{d.name}</div>
                          <div className="text-xs text-gray-500">{d.os ?? "—"} · {d.browser ?? "—"}</div>
                          {(() => {
                            const ua = u.loginSessions.find((s) => s.deviceRef === d.id)?.userAgent;
                            return ua ? <div className="text-[10px] text-gray-400 truncate max-w-[240px]" title={ua}>{ua}</div> : null;
                          })()}
                        </td>
                        <td className="px-3 py-2 capitalize text-gray-600 dark:text-slate-300">{d.type}</td>
                        <td className="px-3 py-2 hidden md:table-cell text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">
                          {d.lastIp ?? "—"}<br />{locationLabel(d.lastCity, d.lastCountry)}
                        </td>
                        <td className="px-3 py-2 hidden lg:table-cell text-xs text-gray-500 whitespace-nowrap tabular-nums">{fmt(d.createdAt)}</td>
                        <td className="px-3 py-2 hidden sm:table-cell text-xs text-gray-500 whitespace-nowrap tabular-nums">{fmt(d.lastSeenAt)}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CHIP[d.status] ?? ""}`}>{d.status === "BLOCKED" ? "BLOCKED / REJECTED" : d.status}</span>
                          {d.status === "APPROVED" && d.approvedBy?.name && <div className="text-[10px] text-gray-400 mt-0.5">by {d.approvedBy.name}{d.approvedAt ? ` · ${fmt(d.approvedAt)}` : ""}</div>}
                        </td>
                        <td className="px-3 py-2"><DeviceRowActions deviceId={d.id} status={d.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
