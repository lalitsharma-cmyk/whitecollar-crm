"use client";
import { useState } from "react";

export default function ProfilePasswordChange() {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (next.length < 8) { setMsg("New password must be at least 8 characters"); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/profile/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); return; }
      setMsg("✓ Password updated");
      setCur(""); setNext("");
      setTimeout(() => setMsg(null), 3000);
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
      <input
        type="password"
        placeholder="Current password"
        value={cur}
        onChange={(e) => setCur(e.target.value)}
        autoComplete="current-password"
        required
        className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
      />
      <input
        type="password"
        placeholder="New password (min 8 chars)"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
        required
        minLength={8}
        className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
      />
      <button type="submit" disabled={busy || !cur || !next} className="btn btn-primary text-sm justify-center sm:col-span-2 sm:w-fit">
        {busy ? "Updating…" : "Update password"}
      </button>
      {msg && <div className={`text-xs sm:col-span-2 ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>{msg}</div>}
    </form>
  );
}
