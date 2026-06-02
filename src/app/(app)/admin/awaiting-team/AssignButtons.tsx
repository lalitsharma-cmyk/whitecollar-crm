"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Tiny per-row action: two buttons that POST to /api/admin/awaiting-team/assign
 * with the chosen team. Once the response lands, we router.refresh() so the
 * row falls off the list (the page query filters forwardedTeam IS NULL).
 *
 * Kept intentionally minimal — Lalit's brief: "small client component" only.
 */
export default function AssignButtons({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "Dubai" | "India">("");
  const [msg, setMsg] = useState<string | null>(null);

  async function assign(team: "Dubai" | "India") {
    if (busy) return;
    setBusy(team);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/awaiting-team/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, team }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(j.error ?? "Failed");
        return;
      }
      // Row will disappear on refresh; show a brief confirmation in case the
      // user has many rows queued and wants to know what just happened.
      setMsg(j.assignedTo
        ? `✓ ${team} → ${j.assignedTo}`
        : `✓ Tagged ${team} (no agent available, will retry)`);
      router.refresh();
    } catch {
      setMsg("Network error");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1.5">
        <button
          onClick={() => assign("Dubai")}
          disabled={!!busy}
          className="btn btn-primary text-xs px-2 py-1"
        >
          {busy === "Dubai" ? "…" : "Assign Dubai"}
        </button>
        <button
          onClick={() => assign("India")}
          disabled={!!busy}
          className="btn btn-ghost text-xs px-2 py-1"
        >
          {busy === "India" ? "…" : "Assign India"}
        </button>
      </div>
      {msg && (
        <div className={`text-[10px] ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>
          {msg}
        </div>
      )}
    </div>
  );
}
