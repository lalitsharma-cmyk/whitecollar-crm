"use client";
import { useEffect, useState } from "react";

interface Props {
  leadId: string;
}

interface ChecklistItem {
  id: string;
  label: string;
}

interface Section {
  key: "before" | "during" | "after";
  title: string;
  emoji: string;
  items: ChecklistItem[];
}

// Stable item IDs so localStorage state survives label tweaks. Don't rename
// the `id` strings without a migration plan — would silently un-check
// every existing checklist on every device.
const SECTIONS: Section[] = [
  {
    key: "before",
    title: "Before the visit",
    emoji: "📋",
    items: [
      { id: "pre-1", label: "Reviewed lead notes + remarks" },
      { id: "pre-2", label: "Pulled relevant unit brochures + pricing" },
      { id: "pre-3", label: "Confirmed family/decision-maker attendance" },
      { id: "pre-4", label: "Sent meeting-point WhatsApp with map link" },
      { id: "pre-5", label: "Updated meeting date in CRM" },
    ],
  },
  {
    key: "during",
    title: "During the visit",
    emoji: "🏢",
    items: [
      { id: "dur-1", label: "Pitched 3 best-fit units" },
      { id: "dur-2", label: "Asked about timeline + decision process" },
      { id: "dur-3", label: "Captured objections" },
      { id: "dur-4", label: "Discussed payment plan" },
      { id: "dur-5", label: "Took photos for follow-up (with consent)" },
    ],
  },
  {
    key: "after",
    title: "After the visit",
    emoji: "✅",
    items: [
      { id: "post-1", label: "Logged the visit in CRM (via Start/End site visit)" },
      { id: "post-2", label: "Sent post-visit WhatsApp thank-you" },
      { id: "post-3", label: "Scheduled the next follow-up call" },
      { id: "post-4", label: "Updated lead status if needed" },
      { id: "post-5", label: "Added notes to the lead" },
    ],
  },
];

type State = Record<string, boolean>;

/**
 * Per-lead site-visit checklist. Pure client UI — no API, no schema change.
 * State persists in localStorage under `wcr-svc-{leadId}` so the agent can
 * tick items on phone during the visit, then resume from desktop.
 *
 * Surfaces only when the lead is in SITE_VISIT stage or has a future
 * siteVisitDate — see the page-level guard for the visibility rule.
 */
export default function SiteVisitChecklist({ leadId }: Props) {
  const storageKey = `wcr-svc-${leadId}`;
  const [state, setState] = useState<State>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage on mount. We can't read it during initial
  // render — SSR would mismatch — so we render empty first, then sync.
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object") {
          setState(parsed as State);
        }
      }
    } catch {
      // Corrupt JSON — ignore and start fresh.
    }
    setHydrated(true);
  }, [storageKey]);

  // Persist whenever state changes (post-hydration only — don't blow away
  // existing data with the empty initial state on first render).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Quota exceeded / disabled — fail silently, checklist is non-critical.
    }
  }, [state, storageKey, hydrated]);

  function toggle(itemId: string) {
    setState((prev) => {
      const next = { ...prev };
      if (next[itemId]) {
        delete next[itemId];
      } else {
        next[itemId] = true;
      }
      return next;
    });
  }

  function reset() {
    setState({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }

  return (
    <div className="card p-5 border-l-4 border-[#c9a24b]">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div>
          <div className="font-semibold">🗂 Site Visit Checklist</div>
          <div className="text-[11px] text-gray-500">Saved locally on this device · per lead</div>
        </div>
      </div>

      <div className="space-y-4">
        {SECTIONS.map((section) => {
          const done = section.items.filter((it) => state[it.id]).length;
          const total = section.items.length;
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          return (
            <div key={section.key} className="border border-[#e5e7eb] rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold">
                  {section.emoji} {section.title}
                </div>
                <div className="text-[11px] text-gray-500 font-medium tabular-nums">
                  {done} of {total} done
                </div>
              </div>
              <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden mb-3">
                <div
                  className={`h-full transition-all duration-200 ${
                    done === total && total > 0 ? "bg-emerald-500" : "bg-[#c9a24b]"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <ul className="space-y-1.5">
                {section.items.map((item) => {
                  const checked = !!state[item.id];
                  return (
                    <li key={item.id}>
                      <label className="flex items-start gap-2 text-sm cursor-pointer select-none group">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(item.id)}
                          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-[#0b1a33] focus:ring-[#c9a24b] flex-none"
                        />
                        <span
                          className={
                            checked
                              ? "text-gray-400 line-through"
                              : "text-gray-800 group-hover:text-[#0b1a33]"
                          }
                        >
                          {item.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={reset}
          className="text-xs text-gray-500 hover:text-red-600 font-medium"
        >
          Reset checklist
        </button>
      </div>
    </div>
  );
}
