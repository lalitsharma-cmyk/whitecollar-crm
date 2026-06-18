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
