"use client";
import { useState } from "react";

interface Props { initial: { calls: number; connected: number; virtual: number; f2f: number; fresh: number; deals: number } }
export default function DailyTargetsForm({ initial }: Props) {
  const [vals, setVals] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const fields: { key: keyof typeof vals; label: string }[] = [
    { key: "calls", label: "Total Calls" },
    { key: "connected", label: "Connected Calls" },
    { key: "virtual", label: "Virtual Meetings" },
    { key: "f2f", label: "Site Visits (F2F)" },
    { key: "fresh", label: "Fresh Clients" },
    { key: "deals", label: "Deals Closed" },
  ];
  async function save() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/targets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(vals) });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {fields.map(({ key, label }) => (
          <div key={key}>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">{label}</label>
            <input
              type="number" min={0} value={vals[key]}
              onChange={e => setVals(v => ({ ...v, [key]: Number(e.target.value) }))}
              className="mt-1 w-full border border-gray-200 dark:border-slate-600 rounded-lg px-3 py-2 text-sm dark:bg-slate-800 dark:text-white focus:outline-none focus:border-[#c9a24b]"
            />
          </div>
        ))}
      </div>
      <button onClick={save} disabled={saving} className="btn btn-primary">
        {saving ? "Saving…" : saved ? "✓ Saved" : "Save Targets"}
      </button>
    </div>
  );
}
