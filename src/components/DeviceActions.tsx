"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const btn = "text-xs font-semibold px-2 py-1 rounded border disabled:opacity-50 whitespace-nowrap";

async function call(body: Record<string, unknown>): Promise<void> {
  await fetch("/api/admin/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function DeviceRowActions({ deviceId, status }: { deviceId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run(action: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    try { await call({ action, deviceId }); router.refresh(); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex flex-wrap gap-1">
      {status !== "APPROVED" && (
        <button disabled={busy} onClick={() => run("approve")} className={`${btn} bg-emerald-50 text-emerald-800 border-emerald-300`}>Approve</button>
      )}
      {status === "PENDING" && (
        <button disabled={busy} onClick={() => run("reject", "Reject this device request? Access stays blocked.")} className={`${btn} bg-amber-50 text-amber-800 border-amber-300`}>Reject</button>
      )}
      {status !== "BLOCKED" && (
        <button disabled={busy} onClick={() => run("block", "Block this device? The user is signed out and can't log in from it.")} className={`${btn} bg-red-50 text-red-700 border-red-300`}>Block</button>
      )}
      <button disabled={busy} onClick={() => run("logout_device", "Sign out this device now?")} className={`${btn} bg-white text-gray-700 border-gray-300`}>Logout</button>
      <button disabled={busy} onClick={() => run("remove", "Remove this device record? A future login from it needs approval again.")} className={`${btn} bg-white text-gray-500 border-gray-300`}>Remove</button>
    </div>
  );
}

// Per-user device limit setter. Default allowance is 2; admin can set 1–5 total
// (stored as deviceLimitExtra = total − 2, range −1…3). Shows + saves immediately.
// Monitor-safe — only matters once enforcement is on.
export function UserDeviceLimit({ userId, extra }: { userId: string; extra: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const total = Math.max(1, 3 + (extra || 0));
  async function set(newTotal: number) {
    setBusy(true);
    try { await call({ action: "set_device_limit", userId, extra: newTotal - 3 }); router.refresh(); }
    finally { setBusy(false); }
  }
  return (
    <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-slate-300">
      <span className="text-gray-400">Limit</span>
      <select
        value={total}
        disabled={busy}
        onChange={(e) => set(Number(e.target.value))}
        className="text-xs border border-gray-300 dark:border-slate-600 rounded px-1.5 py-0.5 dark:bg-slate-800 disabled:opacity-50"
        title="Approved devices allowed for this user (default 3). Set 1 to lock to a single device."
      >
        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} device{n === 1 ? "" : "s"}</option>)}
      </select>
    </label>
  );
}

// GLOBAL kill switch — force-logout EVERY user (rollout step 1). Two-step confirm
// so it can't be clicked by accident. Everyone simply logs back in afterwards.
export function ForceLogoutEveryone() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function run() {
    if (!confirm("Force-logout EVERY user from ALL devices now?\n\nEveryone (including you) will have to log in again.")) return;
    if (!confirm("Are you sure? This signs out the entire team immediately.")) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/admin/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout_everyone" }) });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? `✅ Signed out ${j.count ?? 0} session(s). Everyone must log in again.` : `⚠ ${j.error ?? "Failed"}`);
      router.refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button disabled={busy} onClick={run} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-red-400 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
        ⚠ Force-logout ALL users
      </button>
      {msg && <span className="text-[11px] text-gray-600 dark:text-slate-300">{msg}</span>}
    </div>
  );
}

export function UserLogoutAll({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function run() {
    if (!confirm(`Sign ${name} out of ALL devices right now?`)) return;
    setBusy(true);
    try { await call({ action: "logout_all", userId }); router.refresh(); }
    finally { setBusy(false); }
  }
  return (
    <button disabled={busy} onClick={run} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-red-300 bg-red-50 text-red-700 disabled:opacity-50">
      Logout all devices
    </button>
  );
}
