"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";

interface Card {
  id: string;
  name: string;
  configuration: string | null;
  budgetMin: number | null;
  budgetCurrency: string;
  ownerName: string | null;
  ownerAvatar: string | null;
  team: string | null;
  aiScore: "HOT" | "WARM" | "COLD" | null;
  aiScoreValue: number | null;
  projectName: string | null;
  // §9.7 — computed on the server, see pipeline/page.tsx
  daysInStage?: number;
  momentum?: "healthy" | "slowing" | "stuck";
  risks?: string[];
}

interface Stage { key: string; label: string; }

interface Props {
  stages: Stage[];
  leadsByStage: Record<string, Card[]>;
  agents: { id: string; name: string }[];
}

const aiClass = (s: string | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : "chip-cold";
const initialsOf = (n: string) => n.split(" ").map(s => s[0]).slice(0, 2).join("");

// §9.7 preset reasons — the 7 most common "why did this stage change?"
// answers per the master spec. Chip click appends to the free-text note
// (with a · separator) so the agent can combine multiple reasons.
const REASON_PRESETS = [
  "Budget confirmed",
  "Site visit done",
  "Family involved",
  "Payment issue",
  "Negotiation started",
  "Client delayed",
  "Competitor involved",
];

// §9.7 momentum chip — tiny, color-coded, sits on each card. Same vocab
// as the server (healthy / slowing / stuck) so the meaning is consistent
// across the page and the AI nudges.
const momentumStyle: Record<NonNullable<Card["momentum"]>, { bg: string; text: string; emoji: string; label: (d: number) => string }> = {
  healthy: { bg: "bg-emerald-100", text: "text-emerald-800", emoji: "⚡", label: (d) => `${d}d` },
  slowing: { bg: "bg-amber-100",   text: "text-amber-800",   emoji: "🐢", label: (d) => `${d}d` },
  stuck:   { bg: "bg-rose-100",    text: "text-rose-800",    emoji: "🚨", label: (d) => `${d}d stuck` },
};

export default function KanbanBoard({ stages, leadsByStage, agents }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // §9.7 "What changed?" prompt — set when an agent drops a card on a new
  // stage. Holds the pending move so we can apply it after the agent fills
  // (or skips) the note. Null when no move is pending.
  const [pendingMove, setPendingMove] = useState<null | { leadId: string; leadName: string; from: string; to: string }>(null);
  const [noteDraft, setNoteDraft] = useState("");
  // Mobile stage picker — tapping "↕ Move Stage" on a card opens a bottom
  // sheet listing all stages. Picking one transitions to the normal
  // pendingMove flow (same "What changed?" modal as drag-and-drop).
  const [mobilePick, setMobilePick] = useState<null | { leadId: string; leadName: string; fromStage: string }>(null);

  function update(key: string, value: string) {
    const p = new URLSearchParams(sp);
    if (value) p.set(key, value); else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`);
  }

  // Look up a card's display name across all stages — needed for the prompt
  // header when we capture a drop. Keeps us from threading the name through
  // the dataTransfer payload (which would be brittle to drag images).
  function findCardName(leadId: string, fromStage: string): string {
    const c = (leadsByStage[fromStage] ?? []).find(x => x.id === leadId);
    return c?.name ?? "this lead";
  }

  function onDrop(stageKey: string, e: React.DragEvent) {
    e.preventDefault();
    setHoverStage(null);
    const leadId = e.dataTransfer.getData("text/lead-id");
    const fromStage = e.dataTransfer.getData("text/from-stage");
    if (!leadId || fromStage === stageKey) return;
    // Open the "What changed?" prompt instead of posting immediately. The
    // actual API call runs from confirmMove() once the agent submits/skips.
    setPendingMove({ leadId, leadName: findCardName(leadId, fromStage), from: fromStage, to: stageKey });
    setNoteDraft("");
  }

  async function confirmMove(skipNote = false) {
    if (!pendingMove) return;
    setBusy(true);
    const note = skipNote ? "" : noteDraft.trim();
    const { leadId, to } = pendingMove;
    try {
      const r = await fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, changeNote: note || undefined }),
      });
      if (r.ok) router.refresh();
    } finally {
      setBusy(false);
      setPendingMove(null);
      setNoteDraft("");
    }
  }

  // Totals — kept unchanged so the header line still reads the same.
  const allLeads = Object.values(leadsByStage).flat();
  const aedOpen = allLeads.filter(l => l.budgetCurrency === "AED" && ["QUALIFIED","SITE_VISIT","NEGOTIATION"].includes(stages.find(s => leadsByStage[s.key].includes(l))?.key ?? "")).reduce((s,l) => s + (l.budgetMin ?? 0), 0);
  const inrOpen = allLeads.filter(l => l.budgetCurrency === "INR" && ["QUALIFIED","SITE_VISIT","NEGOTIATION"].includes(stages.find(s => leadsByStage[s.key].includes(l))?.key ?? "")).reduce((s,l) => s + (l.budgetMin ?? 0), 0);

  // Total at-risk count across the board — drives a small banner so Lalit
  // can spot how many deals need attention without scanning each column.
  const atRiskCount = allLeads.filter(l => (l.risks?.length ?? 0) > 0).length;

  return (
    <>
      {/* Filter bar */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 mr-1">Filter:</span>
        <select value={sp.get("team") ?? ""} onChange={(e) => update("team", e.target.value)} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-slate-100">
          <option value="">All teams</option>
          <option value="Dubai">Dubai</option>
          <option value="India">India</option>
        </select>
        <select value={sp.get("owner") ?? ""} onChange={(e) => update("owner", e.target.value)} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-slate-100">
          <option value="">All owners</option>
          <option value="unassigned">⚠ Unassigned</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={sp.get("ai") ?? ""} onChange={(e) => update("ai", e.target.value)} className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-1.5 text-sm dark:bg-slate-700 dark:text-slate-100">
          <option value="">AI: any</option>
          <option value="HOT">🔥 Hot</option>
          <option value="WARM">☀ Warm</option>
          <option value="COLD">🧊 Cold</option>
        </select>
        {atRiskCount > 0 && (
          <span className="text-[11px] font-semibold px-2 py-1 rounded-full bg-rose-100 text-rose-800 border border-rose-200">
            🚨 {atRiskCount} at risk
          </span>
        )}
        <span className="text-xs text-gray-500 dark:text-slate-400 ml-auto">Open value: {fmtMoneyDual({ aed: aedOpen, inr: inrOpen })}</span>
      </div>

      <div className="overflow-x-auto -mx-3 lg:mx-0 px-3 lg:px-0"><div className="grid grid-cols-6 gap-3 min-w-[1080px] lg:min-w-0">
        {stages.map((stage) => {
          const items = leadsByStage[stage.key] ?? [];
          const aedSum = items.filter(l => l.budgetCurrency === "AED").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          const inrSum = items.filter(l => l.budgetCurrency === "INR").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          const isHover = hoverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`col transition-colors ${isHover ? "bg-amber-50 ring-2 ring-[#c9a24b]" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setHoverStage(stage.key); }}
              onDragLeave={() => setHoverStage(null)}
              onDrop={(e) => onDrop(stage.key, e)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm dark:text-slate-200">{stage.label} <span className="text-gray-500 dark:text-slate-400 font-normal">· {items.length}</span></div>
                <span className="text-[10px] text-gray-500 dark:text-slate-400">{(aedSum + inrSum) > 0 ? fmtMoneyDual({ aed: aedSum, inr: inrSum }) : "—"}</span>
              </div>
              {items.slice(0, 25).map((l) => {
                const m = l.momentum ? momentumStyle[l.momentum] : null;
                const atRisk = (l.risks?.length ?? 0) > 0;
                return (
                <div
                  key={l.id}
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/lead-id", l.id);
                    e.dataTransfer.setData("text/from-stage", stage.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={`kanban-card group cursor-grab active:cursor-grabbing ${atRisk ? "ring-1 ring-rose-300" : ""}`}
                  title={atRisk ? l.risks!.join(" · ") : undefined}
                >
                  <Link href={`/leads/${l.id}`} className="block">
                    <div className="flex items-start justify-between gap-1.5">
                      <div className="font-semibold text-sm truncate">{l.name}</div>
                      {m && (
                        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full ${m.bg} ${m.text}`} title={`${l.daysInStage}d in this stage`}>
                          {m.emoji} {m.label(l.daysInStage ?? 0)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-slate-400 truncate">
                      {l.projectName ? l.projectName : l.configuration ?? "—"}
                      {l.budgetMin ? ` · ${fmtMoney(l.budgetMin, l.budgetCurrency)}` : ""}
                    </div>
                    {l.budgetMin != null && (
                      // §9.7 — tiny commission hint at 2% of budgetMin. Lets
                      // the agent eyeball deal value without opening the lead.
                      <div className="text-[10px] text-[#c9a24b] font-semibold">
                        ~{fmtMoney(l.budgetMin * 0.02, l.budgetCurrency)} (2%)
                      </div>
                    )}
                    {atRisk && (
                      // Top risk only — tooltip on the card carries the rest.
                      // Avoids stacking 3 chips inside a 220-wide column on
                      // mobile-width kanbans.
                      <div className="mt-1 text-[10px] font-semibold text-rose-700 truncate">
                        ⚠ {l.risks![0]}
                      </div>
                    )}
                    <div className="flex items-center justify-between mt-2">
                      {l.aiScore ? <span className={`chip ${aiClass(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span> : <span className="text-[10px] text-gray-400 dark:text-slate-500">no score</span>}
                      {l.ownerName && <div className={`avatar ${l.ownerAvatar ?? "bg-slate-500"}`} title={l.ownerName}>{initialsOf(l.ownerName)}</div>}
                    </div>
                  </Link>
                  {/* Mobile-only: stage mover button. Drag-and-drop doesn't work
                      on touch screens so agents had no way to change stages on
                      mobile. Opens a bottom-sheet stage picker, then flows into
                      the same "What changed?" modal used by desktop drag. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMobilePick({ leadId: l.id, leadName: l.name, fromStage: stage.key });
                    }}
                    className="sm:hidden mt-2 w-full text-[11px] font-semibold text-[#0b1a33] dark:text-slate-200 bg-gray-100 dark:bg-slate-700 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg py-1.5 transition-colors disabled:opacity-50"
                  >
                    ↕ Move Stage
                  </button>
                </div>
                );
              })}
              {items.length > 25 && <div className="kanban-card text-xs text-gray-500 dark:text-slate-400">+ {items.length - 25} more…</div>}
              {items.length === 0 && <div className="text-xs text-gray-400 dark:text-slate-500 text-center py-6">Drop a card here</div>}
            </div>
          );
        })}
      </div></div>

      {/* §9.7 "What changed?" prompt — fires after each drag-drop stage move.
          Modal style (centered + backdrop) so the agent has to acknowledge
          before the move applies. They can Skip without a note (free move) OR
          add a quick reason that lands in the timeline. */}
      {pendingMove && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => !busy && setPendingMove(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border dark:border-slate-700 max-w-md w-full p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
              Stage change
            </div>
            <div className="mt-1 font-bold text-[#0b1a33] dark:text-white text-base">
              {pendingMove.leadName}
            </div>
            <div className="text-xs text-gray-600 dark:text-slate-300 mt-0.5">
              <span className="font-semibold">{pendingMove.from.replaceAll("_", " ")}</span>
              <span className="mx-1.5">→</span>
              <span className="font-semibold">{pendingMove.to.replaceAll("_", " ")}</span>
            </div>

            <label className="block mt-4 text-xs font-semibold text-gray-700 dark:text-slate-300">
              What changed?
              <span className="text-gray-400 dark:text-slate-500 font-normal"> (optional, helps the manager)</span>
            </label>

            {/* §9.7 — preset reason chips. Click appends to the textarea
                with a · separator. Multiple selections allowed; agent can
                still type freely below. */}
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-slate-400 font-semibold mb-1">
                Common reasons
              </div>
              <div className="flex flex-wrap gap-1.5">
                {REASON_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setNoteDraft((prev) =>
                        prev.trim() ? `${prev.trim()} · ${preset}` : preset
                      )
                    }
                    className="text-[11px] px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-amber-100 hover:text-amber-900 dark:hover:bg-amber-900/40 dark:hover:text-yellow-300 transition-colors disabled:opacity-50"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              autoFocus
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="e.g. Client confirmed budget · agreed to site visit Saturday · waiting on bank pre-approval"
              className="mt-2 w-full border dark:border-slate-600 rounded-lg p-2 text-sm dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500"
              disabled={busy}
            />
            <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1 text-right">{noteDraft.length}/500</div>

            <div className="flex gap-2 mt-3 justify-end">
              <button
                type="button"
                onClick={() => !busy && setPendingMove(null)}
                disabled={busy}
                className="btn btn-ghost text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => confirmMove(true)}
                disabled={busy}
                className="btn text-xs bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 hover:bg-gray-200 dark:hover:bg-slate-600"
              >
                Skip note
              </button>
              <button
                type="button"
                onClick={() => confirmMove(false)}
                disabled={busy}
                className="btn btn-primary text-xs"
              >
                {busy ? "Moving…" : "Move stage"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile stage picker — bottom sheet, sm:hidden equivalent via JS
          (this component already can't conditionally render server-side).
          Lists all stages so the agent taps the target; then hands off to
          the normal pendingMove "What changed?" flow. */}
      {mobilePick && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          onClick={() => setMobilePick(null)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl border dark:border-slate-700 w-full max-w-sm p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] uppercase tracking-widest text-[#c9a24b] font-bold">
              Move to stage
            </div>
            <div className="mt-1 font-bold text-[#0b1a33] dark:text-white text-base truncate">
              {mobilePick.leadName}
            </div>
            <div className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
              Currently: <span className="font-semibold">{mobilePick.fromStage.replaceAll("_", " ")}</span>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {stages.map((s) => {
                const isCurrent = s.key === mobilePick.fromStage;
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={isCurrent || busy}
                    onClick={() => {
                      setMobilePick(null);
                      setPendingMove({
                        leadId: mobilePick.leadId,
                        leadName: mobilePick.leadName,
                        from: mobilePick.fromStage,
                        to: s.key,
                      });
                      setNoteDraft("");
                    }}
                    className={`w-full text-sm font-semibold rounded-xl px-4 py-3 text-left transition-colors
                      ${isCurrent
                        ? "bg-gray-100 dark:bg-slate-700 text-gray-400 dark:text-slate-500 cursor-default"
                        : "bg-gray-50 dark:bg-slate-700 text-[#0b1a33] dark:text-slate-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 hover:text-amber-900 dark:hover:text-yellow-300"
                      }`}
                  >
                    {isCurrent ? `✓ ${s.label} (current)` : s.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => setMobilePick(null)}
              className="mt-4 w-full text-xs text-gray-500 dark:text-slate-400 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
