"use client";
import { useState } from "react";

export default function AdminPasswordReset({ userId }: { userId: string }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (pwd.length < 8) { setMsg("Password must be at least 8 characters"); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/admin/users/${userId}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: pwd }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); return; }
      setMsg("✓ Password updated");
      setPwd("");
      setTimeout(() => setMsg(null), 3000);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <input
        type="password"
        placeholder="New password (min 8 chars)"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        autoComplete="new-password"
        required
        minLength={8}
        className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm flex-1 min-w-48"
      />
      <button type="submit" disabled={busy || !pwd} className="btn btn-primary text-sm justify-center">
        {busy ? "Setting…" : "Set password"}
      </button>
      {msg && (
        <div className={`text-xs w-full ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>
          {msg}
        </div>
      )}
    </form>
  );
}
