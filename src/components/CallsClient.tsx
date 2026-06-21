"use client";
import { useState } from "react";
import Link from "next/link";
import { fmtIST12, fmtISTDate } from "@/lib/datetime";
import { formatLeadName } from "@/lib/leadName";
import { formatBudgetAmount } from "@/lib/budgetParse";
import { Phone, MessageCircle, X, ChevronRight } from "lucide-react";
import { telLink, whatsappLink } from "@/lib/phone";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

const oc: Record<string, string> = {
  CONNECTED: "chip-won", NOT_PICKED: "chip-lost", CALLBACK: "chip-warm",
  WRONG_NUMBER: "chip-lost", BUSY: "chip-warm", SWITCHED_OFF: "chip-lost",
  INTERESTED: "chip-won", NOT_INTERESTED: "chip-lost",
};

export interface CallRowData {
  id: string;
  startedAt: string;             // ISO string
  outcome: string;
  direction: string;
  durationSec: number | null;
  notes: string | null;
  phoneNumber: string | null;
  agentName: string;
  attributedAgentName: string | null;
  lead: LeadSummary | null;
}

export interface LeadSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  status: string;
  aiScore: string | null;
  aiScoreValue: number | null;
  bantStatus: string | null;
  bantReason: string | null;
  budgetMin: number | null;
  budgetCurrency: string | null;
  configuration: string | null;
  whoIsClient: string | null;
  followupDate: string | null;   // ISO string or null
  todoNext: string | null;
  team: string | null;
  currentStatus: string | null;
  categorization: string | null;
  ownerName: string | null;
  recentCallSummary: Array<{ at: string; outcome: string; agent: string; note: string | null }>;
}

/**
 * Call Records page client wrapper.
 *
 * Lalit: "From Call records Right hand side should show a summary of client
 * so all call records have not to be seen by agent all time. All important
 * information and conversation should be in Summary."
 *
 * Implementation: pure-data summary (no AI). Click a call row → the
 * right-side panel (or bottom-sheet on mobile) shows the lead's structured
 * details — BANT, stage, budget, recent calls, next follow-up, who is client,
 * tap-to-call/WA shortcuts. Pulled straight from the DB; updated whenever
 * the user clicks a different row.
 */
export default function CallsClient({ calls }: { calls: CallRowData[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(calls[0]?.id ?? null);
  // Mobile bottom-sheet open state is separate from selectedId — on desktop the
  // panel is always visible (sticky right rail), on mobile we only open it
  // explicitly when the user taps a row. Lock body scroll only while the
  // mobile sheet is up; desktop sticky panel never needs the lock.
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const selected = calls.find((c) => c.id === selectedId) ?? null;
  const lead = selected?.lead ?? null;
  useBodyScrollLock(mobileSheetOpen);

  return (
    <>
      {/* MOBILE: card list with bottom-sheet summary on tap */}
      <div className="lg:hidden space-y-2">
        {calls.length === 0 && <div className="card p-6 text-center text-gray-500 text-sm">No calls logged yet.</div>}
        {calls.map((c) => (
          <CallCard key={c.id} c={c} onTap={() => { setSelectedId(c.id); setMobileSheetOpen(true); }} />
        ))}
        {/* Mobile bottom-sheet summary — explicit open state so the sheet only
            appears when the user taps a row, not as soon as a row is selected. */}
        {mobileSheetOpen && selected && lead && (
          <div className="fixed inset-0 z-50 lg:hidden" onClick={() => setMobileSheetOpen(false)}>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl max-h-[85vh] overflow-y-auto safe-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sticky top-0 bg-white flex items-center justify-between px-4 py-3 border-b border-[#e5e7eb]">
                <div className="font-semibold text-base">Client Summary</div>
                <button onClick={() => setMobileSheetOpen(false)} className="p-2 -mr-2"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-4">
                <SummaryPanel lead={lead} call={selected} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* DESKTOP: side-by-side — list on left, sticky summary panel on right */}
      <div className="hidden lg:grid grid-cols-3 gap-4 items-start">
        <div className="card overflow-hidden col-span-2">
          <table className="tbl w-full">
            <thead>
              <tr><th>Time</th><th>Lead</th><th>Agent</th><th>Outcome</th><th>Duration</th></tr>
            </thead>
            <tbody>
              {calls.map((c) => {
                const active = c.id === selectedId;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className={`cursor-pointer transition ${active ? "bg-amber-50" : "hover:bg-gray-50"}`}
                  >
                    <td className="text-sm whitespace-nowrap">{fmtIST12(c.startedAt)} IST</td>
                    <td className="text-sm font-medium">{c.lead?.name ? formatLeadName(c.lead.name) : (c.phoneNumber ?? "—")}</td>
                    <td className="text-sm">{c.attributedAgentName ?? c.agentName}</td>
                    <td><span className={`chip ${oc[c.outcome] ?? "src"} text-[10px]`}>{c.outcome.replaceAll("_"," ")}</span></td>
                    <td className="text-sm">{c.durationSec ? `${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="lg:sticky lg:top-20 col-span-1">
          {selected && lead ? (
            <div className="card p-4">
              <SummaryPanel lead={lead} call={selected} />
            </div>
          ) : (
            <div className="card p-6 text-center text-sm text-gray-500">
              Click a call row → the client's summary appears here.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CallCard({ c, onTap }: { c: CallRowData; onTap: () => void }) {
  return (
    <button onClick={onTap} className="card block p-3 w-full text-left active:bg-amber-50">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-bold text-sm truncate">{c.lead?.name ? formatLeadName(c.lead.name) : c.phoneNumber}</div>
          <div className="text-[11px] text-gray-500">{c.attributedAgentName ?? c.agentName} · {fmtIST12(c.startedAt)} IST</div>
        </div>
        <span className={`chip ${oc[c.outcome] ?? "src"} text-[9px] flex-none`}>{c.outcome.replaceAll("_"," ")}</span>
      </div>
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-gray-500">
        <span>{c.direction}</span>
        <span>{c.durationSec ? `${Math.floor(c.durationSec/60)}m ${c.durationSec%60}s` : "—"}</span>
      </div>
      {c.notes && <div className="text-[11px] text-gray-700 mt-1 line-clamp-2">{c.notes}</div>}
      <div className="text-[10px] text-[#0b1a33] mt-1.5 flex items-center gap-1 font-semibold">View summary <ChevronRight className="w-3 h-3" /></div>
    </button>
  );
}

function SummaryPanel({ lead, call }: { lead: LeadSummary; call: CallRowData }) {
  const aiChip = lead.aiScore === "HOT" ? "chip-hot" : lead.aiScore === "WARM" ? "chip-warm" : lead.aiScore === "COLD" ? "chip-cold" : "chip-lost";
  const bantChip = lead.bantStatus === "QUALIFIES" ? "chip-won" : lead.bantStatus === "NOT_QUALIFIED" ? "chip-lost" : "chip-warm";
  return (
    <div className="space-y-3 text-sm">
      {/* Header: name + chips */}
      <div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <Link href={`/leads/${lead.id}`} className="font-bold text-base text-[#0b1a33] underline">
            {formatLeadName(lead.name)}
          </Link>
          {lead.aiScore && <span className={`chip ${aiChip} text-[10px]`}>{lead.aiScore}{lead.aiScoreValue ? ` · ${lead.aiScoreValue}` : ""}</span>}
        </div>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <span className="chip chip-warm text-[9px]">{lead.status.replaceAll("_"," ")}</span>
          {lead.team && <span className={`chip ${lead.team === "India" ? "src-csv" : "src-wa"} text-[9px]`}>{lead.team}</span>}
          {lead.currentStatus && <span className="chip src text-[9px]">{lead.currentStatus}</span>}
        </div>
      </div>

      {/* Tap-to-call / WA shortcuts */}
      {lead.phone && (
        <div className="grid grid-cols-2 gap-1.5">
          <a href={telLink(lead.phone) ?? "#"} className="flex items-center justify-center gap-1 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold">
            <Phone className="w-3.5 h-3.5" /> Call
          </a>
          <a href={whatsappLink(lead.phone) ?? "#"} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1 py-2 rounded-lg bg-[#25D366] text-white text-xs font-semibold">
            <MessageCircle className="w-3.5 h-3.5" /> WA
          </a>
        </div>
      )}

      {/* BANT verdict */}
      <div className="border-t border-[#e5e7eb] pt-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">BANT</div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`chip ${bantChip} text-[10px]`}>{(lead.bantStatus ?? "UNDER_REVIEW").replaceAll("_"," ")}</span>
          {lead.bantReason && <span className="text-[11px] text-gray-600 italic">"{lead.bantReason}"</span>}
        </div>
      </div>

      {/* Budget + Configuration */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Budget</div>
          <div className="font-semibold text-[#0b1a33]">
            {lead.budgetMin
              ? formatBudgetInline(lead.budgetMin, (lead.budgetCurrency === "INR" ? "INR" : "AED"))
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Config</div>
          <div className="font-semibold text-[#0b1a33]">{lead.configuration ?? "—"}</div>
        </div>
      </div>

      {/* Next steps */}
      {(lead.todoNext || lead.followupDate) && (
        <div className="border-t border-[#e5e7eb] pt-3 space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Next steps</div>
          {lead.followupDate && (
            <div className="text-xs">📅 Follow-up: <b>{fmtISTDate(lead.followupDate)}</b></div>
          )}
          {lead.todoNext && (
            <div className="text-xs">✅ To-do: <b>{lead.todoNext}</b></div>
          )}
        </div>
      )}

      {/* Who is client */}
      {lead.whoIsClient && (
        <div className="border-t border-[#e5e7eb] pt-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Who is the client</div>
          <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{lead.whoIsClient}</p>
        </div>
      )}

      {/* Latest 5 calls — the agent's running conversation memory */}
      <div className="border-t border-[#e5e7eb] pt-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Recent calls</div>
        <div className="space-y-1.5">
          {lead.recentCallSummary.length === 0 && <div className="text-xs text-gray-500 italic">No calls logged.</div>}
          {lead.recentCallSummary.map((rc, i) => (
            <div key={i} className={`text-[11px] border-l-2 pl-2 ${rc.outcome === "CONNECTED" || rc.outcome === "INTERESTED" ? "border-emerald-400" : rc.outcome === "NOT_PICKED" || rc.outcome === "SWITCHED_OFF" ? "border-red-300" : "border-gray-300"}`}>
              <div className="font-semibold text-gray-700">{rc.agent} · {fmtISTDate(rc.at)} · <span className="text-gray-500">{rc.outcome.replaceAll("_"," ")}</span></div>
              {rc.note && <div className="text-gray-600 truncate">{rc.note}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Owner + categorization footer */}
      <div className="border-t border-[#e5e7eb] pt-3 flex items-center justify-between text-[11px] text-gray-500">
        <span>Owner: <b className="text-[#0b1a33]">{lead.ownerName ?? "Unassigned"}</b></span>
        {lead.categorization && <span className="truncate max-w-[160px]">{lead.categorization}</span>}
      </div>

      {/* Open full lead button */}
      <Link
        href={`/leads/${lead.id}`}
        className="btn btn-primary w-full justify-center text-xs"
      >
        Open full lead →
      </Link>

      {/* Current call note (the row they clicked) */}
      <div className="border-t border-[#e5e7eb] pt-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">This call's note</div>
        <div className="text-[11px] text-gray-700 whitespace-pre-wrap">{call.notes ?? <span className="italic text-gray-400">(no note)</span>}</div>
      </div>
    </div>
  );
}

// Canonical house format (Dubai "2M AED" / India "21 Cr") — single source of truth.
function formatBudgetInline(n: number, currency: "AED" | "INR"): string {
  return formatBudgetAmount(n, currency === "INR" ? "INDIA" : "DUBAI");
}
