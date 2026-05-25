"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  userId: string;
  initial: string | null;
  candidates: { id: string; name: string }[];
  canEdit: boolean;
}

/** Inline picker on /team — admin can set or clear a user's reporting manager. */
export default function ManagerPicker({ userId, initial, candidates, canEdit }: Props) {
  const router = useRouter();
  const [val, setVal] = useState(initial ?? "");
  const [busy, setBusy] = useState(false);

  if (!canEdit) {
    const m = candidates.find(c => c.id === initial);
    return <span className="text-xs text-gray-600">{m?.name ?? "—"}</span>;
  }

  async function save(next: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/users/${userId}/manager`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerId: next || null }),
      });
      if (r.ok) { setVal(next); router.refresh(); }
    } finally { setBusy(false); }
  }

  return (
    <select
      value={val}
      disabled={busy}
      onChange={(e) => save(e.target.value)}
      className="text-xs border border-[#e5e7eb] rounded px-2 py-1 bg-white"
    >
      <option value="">— no manager —</option>
      {candidates.filter(c => c.id !== userId).map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}
