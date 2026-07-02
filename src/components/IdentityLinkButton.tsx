"use client";
// Resolution Center — "Link as one customer" button. Confirms an admin's decision
// to link a candidate duplicate group into ONE virtual Customer (reversible). On
// success, refreshes so the resolved group drops off the list.
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function IdentityLinkButton({ leadIds, count }: { leadIds: string[]; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function link() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/admin/identity/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error ?? "Link failed"); return; }
      router.refresh();
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {err && <span className="text-[11px] text-red-600">{err}</span>}
      <button
        type="button"
        onClick={link}
        disabled={busy}
        title="Link these records into one customer profile (reversible — records stay separate)"
        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#0b1a33] text-white hover:bg-[#0b1a33]/90 disabled:opacity-50 whitespace-nowrap"
      >
        {busy ? "Linking…" : `🔗 Link ${count} as one customer`}
      </button>
    </div>
  );
}
