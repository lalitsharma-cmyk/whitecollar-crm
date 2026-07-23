"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDismiss } from "@/lib/useDismiss";

// LeadTagsEditor — chips + popover for editing Lead.tags (comma-separated string).
// PATCHes the existing /api/leads/[id]/update endpoint, which accepts
// { tags: "NRI,Investor" } directly (see ALLOWED whitelist in route.ts).

interface Props {
  leadId: string;
  initialTags: string | null;
}

// Common tag vocab Lalit's teams use — surfaced as one-tap presets in the
// popover. Agents can still type any free-form tag in the custom input.
const PRESET_TAGS = [
  "NRI",
  "Investor",
  "End-user",
  "HNI",
  "First-time buyer",
  "Repeat client",
  "Referral",
  "Hot prospect",
  "Cold revival",
];

// Eight Tailwind chip palettes hashed by tag string for visual consistency —
// the same tag always renders in the same colour across pages/leads so the
// eye learns "purple = NRI" without us tracking the mapping in the DB.
const CHIP_COLORS = [
  "bg-rose-100 text-rose-800 border-rose-300",
  "bg-amber-100 text-amber-800 border-amber-300",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
  "bg-teal-100 text-teal-800 border-teal-300",
  "bg-sky-100 text-sky-800 border-sky-300",
  "bg-indigo-100 text-indigo-800 border-indigo-300",
  "bg-purple-100 text-purple-800 border-purple-300",
  "bg-pink-100 text-pink-800 border-pink-300",
];

function colorFor(tag: string): string {
  // Simple djb2-ish hash → bucket. Stable across renders / leads.
  let h = 5381;
  for (let i = 0; i < tag.length; i++) h = ((h << 5) + h + tag.charCodeAt(i)) | 0;
  return CHIP_COLORS[Math.abs(h) % CHIP_COLORS.length];
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export default function LeadTagsEditor({ leadId, initialTags }: Props) {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>(parseTags(initialTags));
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Close the popover ONLY on a genuine outside interaction — never when a text
  // selection that began inside (e.g. the custom-tag input) ends outside. Was a raw
  // mousedown listener that dropped the box mid-selection; now the shared useDismiss.
  const popoverRef = useDismiss<HTMLDivElement>(open, () => setOpen(false));

  async function persist(next: string[]) {
    setBusy(true);
    setErr(null);
    try {
      const value = next.join(",");
      const r = await fetch(`/api/leads/${leadId}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Endpoint accepts {[field]: value} — same shape InlineEdit.tsx uses.
        body: JSON.stringify({ tags: value }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setErr(j.error ?? `Save failed (${r.status})`);
        return;
      }
      setTags(next);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setBusy(false);
    }
  }

  function addTag(t: string) {
    const trimmed = t.trim();
    if (!trimmed) return;
    // De-dupe case-insensitively so "NRI" + "nri" don't both stick.
    if (tags.some((x) => x.toLowerCase() === trimmed.toLowerCase())) return;
    void persist([...tags, trimmed]);
  }

  function removeTag(t: string) {
    void persist(tags.filter((x) => x !== t));
  }

  function onCustomSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!custom.trim()) return;
    addTag(custom);
    setCustom("");
  }

  // Filter the preset list to those not yet on this lead so the popover
  // only ever offers something new — avoids dead "add" buttons.
  const availablePresets = PRESET_TAGS.filter(
    (p) => !tags.some((t) => t.toLowerCase() === p.toLowerCase()),
  );

  return (
    <div className="inline-flex flex-wrap items-center gap-1.5 relative">
      {tags.map((t) => (
        <span
          key={t}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${colorFor(t)}`}
        >
          {t}
          <button
            type="button"
            onClick={() => removeTag(t)}
            disabled={busy}
            aria-label={`Remove ${t}`}
            className="hover:bg-black/10 rounded-full w-4 h-4 inline-flex items-center justify-center text-[10px] leading-none"
            title="Remove tag"
          >
            ×
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="px-2 py-0.5 rounded-full text-[11px] font-semibold border border-dashed border-gray-400 text-gray-600 hover:bg-gray-50"
      >
        + Add tag
      </button>
      {err && <span className="text-[10px] text-red-600 ml-1">⚠ {err}</span>}

      {open && (
        <div
          ref={popoverRef}
          className="absolute z-20 top-full left-0 mt-1 w-64 bg-white border border-[#e5e7eb] rounded-lg shadow-lg p-3 space-y-2"
        >
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
            Preset tags
          </div>
          {availablePresets.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {availablePresets.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => addTag(p)}
                  disabled={busy}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border hover:opacity-80 ${colorFor(p)}`}
                >
                  + {p}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-gray-400 italic">All presets already added.</div>
          )}
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold pt-1">
            Custom
          </div>
          <form onSubmit={onCustomSubmit} className="flex gap-1">
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Type and press Enter"
              className="border border-[#c9a24b] rounded px-2 py-1 text-xs flex-1 min-w-0"
              maxLength={40}
              autoFocus
            />
            <button
              type="submit"
              disabled={busy || !custom.trim()}
              className="btn btn-primary text-xs py-1 px-2"
            >
              Add
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
