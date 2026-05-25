"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "PRESENT" | "LATE" | "ABSENT" | "ON_LEAVE";

interface Props { userId: string; date: string; current: Status | null; }

const OPTIONS: { v: Status | ""; label: string; emoji: string }[] = [
  { v: "",         label: "—",        emoji: "·" },
  { v: "PRESENT",  label: "Present",  emoji: "✅" },
  { v: "LATE",     label: "Late",     emoji: "🕓" },
  { v: "ABSENT",   label: "Absent",   emoji: "❌" },
  { v: "ON_LEAVE", label: "On leave", emoji: "🌴" },
];

/**
 * Tiny inline editor on the attendance grid — admin clicks a cell, picks a new
 * status. PATCH /api/admin/attendance/[userId]/[date] writes through.
 */
export default function AttendanceCellEditor({ userId, date, current }: Props) {
  const router = useRouter();
  const [val, setVal] = useState<Status | "">(current ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: Status | "") {
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, date, status: next || null }),
      });
      if (r.ok) {
        setVal(next);
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  const opt = OPTIONS.find((o) => o.v === val) ?? OPTIONS[0];

  return (
    <select
      value={val}
      disabled={busy}
      onChange={(e) => save(e.target.value as Status | "")}
      title={opt.label}
      className="bg-transparent text-base outline-none cursor-pointer text-center w-10"
    >
      {OPTIONS.map((o) => (
        <option key={o.v} value={o.v}>{o.emoji}</option>
      ))}
    </select>
  );
}
