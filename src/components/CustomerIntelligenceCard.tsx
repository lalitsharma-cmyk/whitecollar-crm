"use client";

// CustomerIntelligenceCard — shows pre-assignment intelligence for a lead.
//
// Fetches /api/leads/[id]/intelligence on mount. If matchType === "NONE" or
// no record, renders a subtle one-liner. Otherwise shows the full card with:
//   • Header badge (STRONG / MEDIUM / WEAK)
//   • Matched-by fields
//   • Existing customer summary
//   • Project insight pill
//   • AI Assessment (or rule-based fallback)
//   • History timeline (max 5, expand to all)
//   • Portfolio table
//   • Previous leads accordion
//   • "Generate AI Summary" button (admin/manager only, when no aiSummary)
//
// Props:
//   leadId        — the lead being viewed
//   leadName      — display name for the lead
//   currentRole   — me.role passed from the server page so we can gate the
//                   "Generate AI" button without a round-trip

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatchedBy {
  field: string;
  value: string;
  source: string;
  recordId: string;
}

interface HistoryEntry {
  date: string | null;
  agent: string | null;
  text: string;
  source: string;
  recordId: string;
}

interface PreviousLead {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  agentName: string | null;
  remarks: string | null;
}

interface PortfolioEntry {
  project: string;
  unit: string | null;
  tower: string | null;
  transactionValueAed: number | null;
  date: string | null;
}

interface IntelligenceResult {
  matchType: "STRONG" | "MEDIUM" | "WEAK" | "NONE";
  confidence: number;
  matchedBy: MatchedBy[];
  history: HistoryEntry[];
  previousAgentName: string | null;
  previousStatus: string | null;
  lastContactAt: string | null;
  totalRecordsFound: number;
  totalPropertiesFound: number;
  projectMatch: "SAME_PROJECT" | "DIFFERENT_PROJECT" | "EXISTING_BUYER" | null;
  projectNote: string | null;
  aiSummary: string | null;
  suggestedApproach: string | null;
  previousLeads: PreviousLead[];
  portfolioEntries: PortfolioEntry[];
}

interface Props {
  leadId: string;
  leadName: string;
  currentRole?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtAed(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M AED`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K AED`;
  return `${v} AED`;
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n) + "…";
}

const STATUS_CHIP: Record<string, string> = {
  WON: "chip-won",
  BOOKING_DONE: "chip-won",
  NEGOTIATION: "chip-warm",
  QUALIFIED: "chip-warm",
  SITE_VISIT: "chip-warm",
  CONTACTED: "chip-new",
  NEW: "chip-new",
  LOST: "chip-lost",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function BadgeForMatch({ matchType, confidence }: { matchType: string; confidence: number }) {
  if (matchType === "STRONG") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-300">
        Known Contact — {confidence}% match
      </span>
    );
  }
  if (matchType === "MEDIUM") {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
        ~ Possible Match — {confidence}%
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-700 border border-gray-300">
      ? Weak Signal — {confidence}%
    </span>
  );
}

function ProjectMatchPill({
  projectMatch,
  projectNote,
}: {
  projectMatch: string;
  projectNote: string | null;
}) {
  let label = "";
  let cls = "";
  if (projectMatch === "SAME_PROJECT") {
    label = "Repeat Enquiry for Same Project";
    cls = "bg-blue-100 text-blue-800 border-blue-300";
  } else if (projectMatch === "DIFFERENT_PROJECT") {
    label = "Previously Enquired Different Project";
    cls = "bg-purple-100 text-purple-800 border-purple-300";
  } else if (projectMatch === "EXISTING_BUYER") {
    label = "Possible Existing Buyer";
    cls = "bg-emerald-100 text-emerald-800 border-emerald-300";
  }
  if (!label) return null;
  return (
    <div className="space-y-1">
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
        {label}
      </span>
      {projectNote && (
        <p className="text-xs text-gray-600">{projectNote}</p>
      )}
    </div>
  );
}

// ─── Main card ────────────────────────────────────────────────────────────────

export default function CustomerIntelligenceCard({ leadId, leadName, currentRole }: Props) {
  const [match, setMatch] = useState<IntelligenceResult | null | undefined>(undefined); // undefined = loading
  const [error, setError] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [leadsExpanded, setLeadsExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState<string | null>(null);
  const [genOk, setGenOk] = useState(true);

  const isManager = currentRole === "ADMIN" || currentRole === "MANAGER";

  const loadIntelligence = useCallback(async () => {
    try {
      const res = await fetch(`/api/leads/${leadId}/intelligence`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { match: IntelligenceResult | null };
      setMatch(data.match);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load intelligence");
      setMatch(null);
    }
  }, [leadId]);

  useEffect(() => {
    loadIntelligence();
  }, [loadIntelligence]);

  async function generateAI() {
    if (generating) return;
    setGenerating(true);
    setGenMsg(null);
    try {
      const r = await fetch(`/api/ai/intelligence/${leadId}`, { method: "POST" });
      const j = await r.json().catch(() => ({})) as Record<string, unknown>;
      if (j.disabled) {
        setGenOk(false);
        setGenMsg("AI is not enabled. Configure GEMINI_API_KEY or ANTHROPIC_API_KEY.");
        return;
      }
      if (!r.ok || j.error) {
        setGenOk(false);
        setGenMsg(String(j.error ?? `Failed (HTTP ${r.status})`));
        return;
      }
      setGenOk(true);
      setGenMsg("AI summary generated.");
      // Reload the intelligence data
      await loadIntelligence();
    } catch (e) {
      setGenOk(false);
      setGenMsg(`Network error: ${String(e).slice(0, 80)}`);
    } finally {
      setGenerating(false);
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (match === undefined) {
    return (
      <div className="card p-3 text-xs text-gray-400 animate-pulse">
        Checking customer intelligence…
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="card p-3 text-xs text-red-600 bg-red-50 border border-red-200">
        Customer intelligence unavailable: {error}
      </div>
    );
  }

  // ── NONE / null → subtle one-liner ────────────────────────────────────────
  if (!match || match.matchType === "NONE") {
    return (
      <div className="card p-3 flex items-center gap-2 border border-gray-100 bg-gray-50">
        <span className="text-gray-400 text-sm">No previous history found for {leadName}.</span>
      </div>
    );
  }

  // ── Full card ──────────────────────────────────────────────────────────────
  const cardBorderClass =
    match.matchType === "STRONG"
      ? "border-l-4 border-red-400 bg-red-50/40"
      : match.matchType === "MEDIUM"
      ? "border-l-4 border-amber-400 bg-amber-50/40"
      : "border-l-4 border-gray-300 bg-gray-50/40";

  // History sorted desc by date
  const sortedHistory = [...match.history].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return b.date.localeCompare(a.date);
  });
  const visibleHistory = historyExpanded ? sortedHistory : sortedHistory.slice(0, 5);

  // Rule-based summary when no AI summary
  const ruleBasedSummary = (() => {
    const parts: string[] = [];
    if (match.matchedBy.length > 0) {
      const fields = match.matchedBy.map((m) => m.field).join(", ");
      parts.push(`Phone/contact matched on ${fields} in ${match.totalRecordsFound} previous lead(s).`);
    }
    if (match.previousStatus) parts.push(`Last status: ${match.previousStatus.replaceAll("_", " ")}.`);
    if (match.previousAgentName) parts.push(`Last agent: ${match.previousAgentName}.`);
    if (match.lastContactAt) parts.push(`Last contact: ${fmtDate(match.lastContactAt)}.`);
    return parts.join(" ") || "Match found in previous CRM records.";
  })();

  const existingCustomerLabel =
    match.matchType === "STRONG" ? "Yes" :
    match.matchType === "MEDIUM" ? "Possible" : "Unlikely";

  return (
    <div data-lead-section="overview" className={`card p-4 ${cardBorderClass}`}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold tracking-widest text-gray-700 uppercase">
            Customer Intelligence
          </span>
          <BadgeForMatch matchType={match.matchType} confidence={match.confidence} />
        </div>
        {isManager && !match.aiSummary && (
          <button
            type="button"
            onClick={generateAI}
            disabled={generating}
            className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded bg-white border border-[#c9a24b] text-[#0b1a33] font-semibold hover:bg-amber-50 disabled:opacity-50 min-h-8"
          >
            {generating ? "Generating…" : "Generate AI Summary"}
          </button>
        )}
      </div>

      {genMsg && (
        <div className={`mb-3 text-xs px-3 py-1.5 rounded border ${genOk ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {genMsg}
        </div>
      )}

      {/* ── Matched by ── */}
      {match.matchedBy.length > 0 && (
        <div className="mb-3 text-xs text-gray-700">
          <span className="font-semibold">Matched by:</span>{" "}
          {match.matchedBy.map((m) => `${m.field} (${m.source})`).join(", ")}
        </div>
      )}

      {/* ── Existing customer summary ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3 text-xs">
        <div className="p-2 rounded border border-[#e5e7eb] bg-white/80">
          <div className="text-gray-500 font-medium">Existing customer?</div>
          <div className={`font-bold mt-0.5 ${match.matchType === "STRONG" ? "text-red-700" : match.matchType === "MEDIUM" ? "text-amber-700" : "text-gray-600"}`}>
            {existingCustomerLabel}
          </div>
        </div>
        <div className="p-2 rounded border border-[#e5e7eb] bg-white/80">
          <div className="text-gray-500 font-medium">Match confidence</div>
          <div className="font-bold mt-0.5 text-gray-800">{match.confidence}%</div>
        </div>
        <div className="p-2 rounded border border-[#e5e7eb] bg-white/80">
          <div className="text-gray-500 font-medium">Previous records</div>
          <div className="font-semibold mt-0.5 text-gray-800">
            {match.totalRecordsFound} lead{match.totalRecordsFound === 1 ? "" : "s"}
            {match.totalPropertiesFound > 0 && `, ${match.totalPropertiesFound} propert${match.totalPropertiesFound === 1 ? "y" : "ies"}`}
          </div>
        </div>
        <div className="p-2 rounded border border-[#e5e7eb] bg-white/80">
          <div className="text-gray-500 font-medium">Last interaction</div>
          <div className="font-semibold mt-0.5 text-gray-800">{fmtDate(match.lastContactAt)}</div>
        </div>
        <div className="p-2 rounded border border-[#e5e7eb] bg-white/80 sm:col-span-2">
          <div className="text-gray-500 font-medium">Previous agent</div>
          <div className="font-semibold mt-0.5 text-gray-800">{match.previousAgentName ?? "—"}</div>
        </div>
      </div>

      {/* ── Project insight ── */}
      {match.projectMatch && (
        <div className="mb-3">
          <ProjectMatchPill projectMatch={match.projectMatch} projectNote={match.projectNote} />
        </div>
      )}

      {/* ── AI Assessment (or rule-based fallback) ── */}
      <div className="mb-3">
        <div className="text-[10px] font-bold tracking-widest text-gray-600 uppercase mb-1.5">
          {match.aiSummary ? "AI Assessment" : "Assessment"}
        </div>
        <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
          {match.aiSummary ?? ruleBasedSummary}
        </p>
        {match.suggestedApproach && (
          <div className="mt-2 p-2.5 rounded bg-amber-50 border border-amber-200 text-xs text-amber-900">
            <span className="font-semibold">Suggested Approach:</span> {match.suggestedApproach}
          </div>
        )}
        {isManager && match.aiSummary && (
          <button
            type="button"
            onClick={generateAI}
            disabled={generating}
            className="mt-2 inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-white border border-[#c9a24b] text-[#0b1a33] font-semibold hover:bg-amber-50 disabled:opacity-50"
          >
            {generating ? "Regenerating…" : "Regenerate"}
          </button>
        )}
      </div>

      {/* ── History timeline ── */}
      {sortedHistory.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-bold tracking-widest text-gray-600 uppercase mb-1.5">
            Previous History ({sortedHistory.length} record{sortedHistory.length === 1 ? "" : "s"})
          </div>
          <div className="space-y-1.5">
            {visibleHistory.map((h, i) => (
              <HistoryRow key={`${h.recordId}-${i}`} entry={h} />
            ))}
          </div>
          {sortedHistory.length > 5 && (
            <button
              type="button"
              onClick={() => setHistoryExpanded((v) => !v)}
              className="mt-1.5 text-[11px] font-semibold text-[#0b1a33] underline hover:text-amber-800"
            >
              {historyExpanded
                ? "Show less"
                : `Show all ${sortedHistory.length} records`}
            </button>
          )}
        </div>
      )}

      {/* ── Portfolio ── */}
      {match.portfolioEntries.length > 0 && (
        <div className="mb-3">
          <div className="text-[10px] font-bold tracking-widest text-gray-600 uppercase mb-1.5">
            Known Properties ({match.portfolioEntries.length})
          </div>
          <div className="overflow-x-auto rounded border border-[#e5e7eb]">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold">Project</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Unit</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Tower</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Value (AED)</th>
                  <th className="px-2 py-1.5 text-left font-semibold">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {match.portfolioEntries.map((p, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-2 py-1.5 font-medium text-gray-800 max-w-[140px] truncate">{p.project}</td>
                    <td className="px-2 py-1.5 text-gray-600">{p.unit ?? "—"}</td>
                    <td className="px-2 py-1.5 text-gray-600">{p.tower ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right text-gray-800 font-semibold">{fmtAed(p.transactionValueAed)}</td>
                    <td className="px-2 py-1.5 text-gray-500">{fmtDate(p.date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Previous leads ── */}
      {match.previousLeads.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setLeadsExpanded((v) => !v)}
            className="text-[10px] font-bold tracking-widest text-gray-600 uppercase mb-1.5 flex items-center gap-1 hover:text-[#0b1a33]"
          >
            Previous Leads ({match.previousLeads.length})
            <span className="text-gray-400">{leadsExpanded ? "▲" : "▼"}</span>
          </button>
          {leadsExpanded && (
            <div className="space-y-1.5">
              {match.previousLeads.map((l) => {
                const chipClass = STATUS_CHIP[l.status] ?? "chip-new";
                return (
                  <div
                    key={l.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-[#e5e7eb] bg-white/80 px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/leads/${l.id}`}
                        className="text-sm font-semibold text-[#0b1a33] hover:underline truncate block"
                      >
                        {l.name}
                      </Link>
                      <div className="text-[11px] text-gray-500">
                        {fmtDate(l.createdAt)}
                        {l.agentName ? ` · ${l.agentName}` : ""}
                      </div>
                      {l.remarks && (
                        <div className="text-[11px] text-gray-600 mt-0.5 truncate max-w-[260px]">
                          {truncate(l.remarks, 100)}
                        </div>
                      )}
                    </div>
                    <span className={`chip ${chipClass} text-[10px] flex-shrink-0`}>
                      {l.status.replaceAll("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── History row sub-component ────────────────────────────────────────────────

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = entry.text.length > 80;
  const displayText = expanded ? entry.text : truncate(entry.text, 80);

  return (
    <div className="flex gap-2 text-xs border-l-2 border-gray-200 pl-2">
      <div className="flex-none text-gray-400 min-w-[64px]">{fmtDate(entry.date)}</div>
      <div className="flex-1 min-w-0">
        {entry.agent && (
          <span className="font-semibold text-gray-700">{entry.agent}: </span>
        )}
        <span className="text-gray-600">{displayText}</span>
        {needsExpand && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 text-[10px] font-semibold text-[#0b1a33] underline"
          >
            {expanded ? "less" : "more"}
          </button>
        )}
        <span className="ml-1 text-[10px] text-gray-400">[{entry.source}]</span>
      </div>
    </div>
  );
}
