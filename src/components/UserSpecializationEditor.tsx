"use client";
// Inline editor for an agent's specialization tags + daily call target.
// Used on /team. ADMIN/MANAGER only — read-only chips render when !canEdit.
// Spec §9.13 vocab is fixed; users pick from a closed list.

import { useState } from "react";

// Fixed vocabulary — keep in sync with src/app/api/admin/users/[id]/profile/route.ts.
export const SPECIALIZATION_OPTIONS = [
  "Dubai investor",
  "Gurgaon luxury",
  "Villa closer",
  "Commercial",
  "NRI",
  "First-time buyer",
  "Negotiation support",
] as const;

export function parseSpecializations(s: string | null): string[] {
  if (!s) return [];
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function serializeSpecializations(arr: string[]): string {
  // Dedupe while preserving order
  const seen = new Set<string>();
  return arr.filter((t) => (seen.has(t) ? false : (seen.add(t), true))).join(",");
}

interface Props {
  userId: string;
  initialSpecializations: string | null;
  initialDailyCallTarget: number;
  canEdit: boolean;
}

export default function UserSpecializationEditor({
  userId,
  initialSpecializations,
  initialDailyCallTarget,
  canEdit,
}: Props) {
  const [tags, setTags] = useState<string[]>(parseSpecializations(initialSpecializations));
  const [target, setTarget] = useState<number>(initialDailyCallTarget);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState<null | "tags" | "target">(null);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

  async function persist(payload: { specializations?: string | null; dailyCallTarget?: number }, kind: "tags" | "target") {
    setSaving(kind);
    setStatus("idle");
    try {
      const r = await fetch(`/api/admin/users/${userId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
    } finally {
      setSaving(null);
    }
  }

  function toggleTag(tag: string) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(next);
    const serialized = serializeSpecializations(next);
    persist({ specializations: serialized === "" ? null : serialized }, "tags");
  }

  function onTargetBlur() {
    const n = Math.max(0, Math.min(1000, Math.round(target || 0)));
    if (n !== target) setTarget(n);
    if (n === initialDailyCallTarget) return;
    persist({ dailyCallTarget: n }, "target");
  }

  // READ-ONLY: agent viewing their own /team row
  if (!canEdit) {
    return (
      <div className="flex flex-col gap-1 min-w-[180px]">
        <div className="flex flex-wrap gap-1">
          {tags.length === 0 ? (
            <span className="text-xs text-gray-500">—</span>
          ) : (
            tags.map((t) => (
              <span key={t} className="chip chip-new text-[10px] whitespace-nowrap">
                {t}
              </span>
            ))
          )}
        </div>
        <div className="text-xs text-gray-600">
          Target: <span className="font-mono font-semibold">{target}</span>/day
        </div>
      </div>
    );
  }

  // EDITABLE
  return (
    <div className="flex flex-col gap-1.5 min-w-[200px] relative">
      <div className="flex flex-wrap gap-1 items-center">
        {tags.length === 0 ? (
          <span className="text-xs text-gray-400 italic">No tags</span>
        ) : (
          tags.map((t) => (
            <span key={t} className="chip chip-new text-[10px] whitespace-nowrap">
              {t}
            </span>
          ))
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-[10px] px-1.5 py-0.5 rounded border border-[#e5e7eb] hover:bg-gray-50"
        >
          {open ? "Close" : "Edit"}
        </button>
      </div>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-[#e5e7eb] rounded-lg shadow-lg p-2 w-64">
          <div className="text-[10px] uppercase text-gray-500 mb-1.5 font-semibold">Specializations</div>
          <div className="flex flex-wrap gap-1">
            {SPECIALIZATION_OPTIONS.map((opt) => {
              const active = tags.includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggleTag(opt)}
                  className={`chip text-[10px] cursor-pointer whitespace-nowrap ${
                    active ? "chip-hot" : "chip-new opacity-60 hover:opacity-100"
                  }`}
                >
                  {active ? "✓ " : ""}
                  {opt}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <label className="flex items-center gap-1.5 text-xs text-gray-700">
        <span>Target:</span>
        <input
          type="number"
          min={0}
          max={1000}
          step={1}
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          onBlur={onTargetBlur}
          className="border border-[#e5e7eb] rounded px-1.5 py-0.5 text-xs font-mono w-14"
        />
        <span className="text-gray-500">/day</span>
        {saving && <span className="text-[10px] text-gray-400">…</span>}
        {!saving && status === "saved" && <span className="text-[10px] text-emerald-600">✓</span>}
        {!saving && status === "error" && <span className="text-[10px] text-red-600">✕</span>}
      </label>
    </div>
  );
}
