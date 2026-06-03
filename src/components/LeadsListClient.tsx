"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Phone, MessageCircle, Tag, RefreshCw, XCircle, X, ExternalLink } from "lucide-react";
import LeadBulkActions from "./LeadBulkActions";
import { telLink, whatsappLink } from "@/lib/phone";

// Preset tag vocab — mirrors what Lalit asked the team to standardise on
// across the pipeline. Kept here (not server-fetched) so the popover renders
// instantly without a round-trip on first open.
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

// Same allow-list as RejectLeadClient / the single-lead reject endpoint.
const REJECT_REASONS: Array<{ v: string; label: string }> = [
  { v: "FUND_ISSUE",                  label: "💰 Fund issue" },
  { v: "WAR_FEAR",                    label: "⚔ War fear" },
  { v: "LOW_BUDGET",                  label: "📉 Low budget" },
  { v: "LOOK_AFTER_2_YEARS",          label: "📅 Look after 2 years" },
  { v: "WAITING_FOR_PROPERTY_SALE",   label: "🏠 Waiting to sell own property" },
  { v: "OTHER",                       label: "✏ Other (specify)" },
];

// Bulk-WhatsApp template presets — must match the keys the /api/leads/bulk-wa
// endpoint understands.
const WA_PRESETS: Array<{ v: string; label: string }> = [
  { v: "followup",   label: "Follow-up" },
  { v: "checkin",    label: "Check-in" },
  { v: "newlisting", label: "New listing" },
];

interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  statusName: string;
  srcChip: string;
  srcLabel: string;
  statusChip: string;
  aiScore: string | null;
  aiScoreValue: number | null;
  team: string | null;
  owner: { name: string; avatarColor: string } | null;
  budget: string | null;
  interest: string | null;
  lastTouched: string;
  lastTouchedAt?: string | Date | null;
}

const aiChip = (s: string | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : s === "COLD" ? "chip-cold" : "chip-lost";

export default function LeadsListClient({ leads, canBulk, canReassign = false, agents, showSource = true }: { leads: Row[]; canBulk: boolean; canReassign?: boolean; agents: { id: string; name: string; team: string | null }[]; showSource?: boolean; }) {
  // showSource = false → hide the source column + chip from agents.
  // Lalit's policy: agents shouldn't see where each lead came from (avoids them
  // cherry-picking high-converting sources or gaming the round-robin pool).
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedIds = Array.from(selected);

  // Bulk action UI state. The action bar is a single sticky element at the
  // bottom; popovers/modals for each action layer on top via z-50.
  const [showTagPopover, setShowTagPopover] = useState(false);
  const [showReassignPopover, setShowReassignPopover] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showWaPopover, setShowWaPopover] = useState(false);
  const [pickedTags, setPickedTags] = useState<Set<string>>(new Set());
  const [reassignPick, setReassignPick] = useState("");
  const [rejectReason, setRejectReason] = useState("FUND_ISSUE");
  const [rejectNote, setRejectNote] = useState("");
  const [waTemplate, setWaTemplate] = useState("followup");
  const [waLinks, setWaLinks] = useState<Array<{ leadId: string; name: string; phone: string; waLink: string }>>([]);
  const [waSkipped, setWaSkipped] = useState<Array<{ leadId: string; name: string; reason: string }>>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<string | null>(null);
  const [bulkCrossTeamWarn, setBulkCrossTeamWarn] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }
  function clearSelection() {
    setSelected(new Set());
    setShowTagPopover(false);
    setShowReassignPopover(false);
    setShowRejectModal(false);
    setShowWaPopover(false);
    setPickedTags(new Set());
    setReassignPick("");
    setRejectReason("FUND_ISSUE");
    setRejectNote("");
    setWaTemplate("followup");
    setWaLinks([]);
    setWaSkipped([]);
    setBulkErr(null);
  }
  const allChecked = leads.length > 0 && selected.size === leads.length;

  // ESC closes any open popover/modal first, then clears selection.
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (showTagPopover || showReassignPopover || showRejectModal || showWaPopover) {
        setShowTagPopover(false);
        setShowReassignPopover(false);
        setShowRejectModal(false);
        setShowWaPopover(false);
      } else if (selected.size > 0) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [showTagPopover, showReassignPopover, showRejectModal, showWaPopover, selected.size]);

  function togglePickedTag(t: string) {
    setPickedTags((s) => {
      const next = new Set(s);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  async function applyBulkTag() {
    if (pickedTags.size === 0 || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag", leadIds: selectedIds, addTags: Array.from(pickedTags) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReassign() {
    if (!reassignPick || bulkBusy) return;
    setBulkBusy(true); setBulkErr(null); setBulkCrossTeamWarn(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reassign", leadIds: selectedIds, ownerId: reassignPick }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      if (j.crossTeamWarningMessage) {
        setBulkCrossTeamWarn(j.crossTeamWarningMessage);
      }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  async function applyBulkReject() {
    if (bulkBusy) return;
    if (rejectReason === "OTHER" && !rejectNote.trim()) {
      setBulkErr("Please specify the reason in the note.");
      return;
    }
    setBulkBusy(true); setBulkErr(null);
    try {
      const r = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", leadIds: selectedIds, reason: rejectReason, note: rejectNote.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      clearSelection();
      router.refresh();
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Bulk WhatsApp can't send server-side (no Meta API) — the endpoint returns a
  // list of wa.me draft links the agent opens one by one. Each is also logged
  // as a PLANNED activity server-side.
  async function generateWaLinks() {
    if (bulkBusy) return;
    setBulkBusy(true); setBulkErr(null);
    setWaLinks([]); setWaSkipped([]);
    try {
      const r = await fetch("/api/leads/bulk-wa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedIds, templateKey: waTemplate }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setBulkErr(j.error ?? `Failed (${r.status})`); return; }
      setWaLinks(Array.isArray(j.links) ? j.links : []);
      setWaSkipped(Array.isArray(j.skipped) ? j.skipped : []);
      router.refresh(); // surface the new PLANNED activities
    } catch (e) {
      setBulkErr(`Network error: ${String(e).slice(0, 80)}`);
    } finally { setBulkBusy(false); }
  }

  // Open every generated link with a 300ms stagger. Browsers may block all but
  // the first — the UI shows a hint to allow popups for this site.
  function openAllWa() {
    waLinks.forEach((l, i) => {
      setTimeout(() => window.open(l.waLink, "_blank", "noopener,noreferrer"), i * 300);
    });
  }

  return (
    <>
      {/* MOBILE: card list */}
      <div className="lg:hidden space-y-2">
        {leads.length === 0 && <div className="card p-6 text-center text-gray-500 text-sm">No leads match these filters.</div>}
        {leads.map((l) => {
          const teamChip = l.team === "India" ? "src-csv" : "src-wa";
          const isFreshHot = l.aiScore === "HOT" && (!l.lastTouchedAt || new Date(l.lastTouchedAt).getTime() > Date.now() - 6 * 3600_000);
          return (
            <div key={l.id} className={`card p-3 active:bg-amber-50 ${isFreshHot ? "wcr-fresh-hot-pulse" : ""}`}>
              <div className="flex items-start gap-2">
                {canBulk && (
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1" />
                )}
                <Link href={`/leads/${l.id}`} className="flex-1 min-w-0 block">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-bold text-sm truncate">{l.name}</div>
                    <div className="flex items-center gap-1 flex-none">
                      {isFreshHot && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200 inline-flex items-center gap-0.5">
                          <span aria-hidden>🚨</span>Untouched
                        </span>
                      )}
                      {l.aiScore && <span className={`chip ${aiChip(l.aiScore)} text-[9px]`}>{l.aiScore}</span>}
                    </div>
                  </div>
                  {/* Phone gets its own line — email moved to lead detail page only.
                      Lalit asked: "no need to show email id here" and "number should
                      be shown under number field". */}
                  {l.phone && (
                    <div className="text-[11px] text-gray-600 truncate mt-0.5">📞 {l.phone}</div>
                  )}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className={`chip ${l.statusChip} text-[9px]`}>{l.statusName.replaceAll("_", " ")}</span>
                    {showSource && <span className={`chip ${l.srcChip} text-[9px]`}>{l.srcLabel}</span>}
                    {l.team && <span className={`chip ${teamChip} text-[9px]`}>{l.team}</span>}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    <span className="font-semibold">{l.budget ?? "—"}</span>
                    <span className="text-gray-500">
                      {l.owner ? <span className={`avatar ${l.owner.avatarColor} inline-flex w-5 h-5 text-[9px] mr-1`}>{l.owner.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</span> : "—"}
                      · {l.lastTouched}
                    </span>
                  </div>
                  {l.interest && <div className="text-[10px] text-gray-500 mt-1 truncate">→ {l.interest}</div>}
                </Link>
                {/* Direct-action icons on the right edge of each mobile lead
                    card. One-tap call or WhatsApp without having to drill into
                    the lead detail page. Lalit's ask: "Mobile call, whatsapp
                    icon". stopPropagation isn't needed — these are siblings of
                    the Link now, not nested inside it. */}
                {l.phone && (
                  <div className="flex flex-col gap-1.5 flex-none">
                    <a
                      href={telLink(l.phone) || "#"}
                      aria-label={`Call ${l.name}`}
                      className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm active:bg-emerald-700"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <a
                      href={whatsappLink(l.phone) || "#"}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={`WhatsApp ${l.name}`}
                      className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-sm active:bg-[#1ea953]"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP: full table */}
      <div className="hidden lg:block card overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>{canBulk && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}</th>
              <th>Lead</th>
              <th>Team</th>
              {showSource && <th>Source</th>}
              <th>Budget</th>
              <th>Stage</th>
              <th>AI</th>
              <th>Owner</th>
              <th>Last touch</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={showSource ? 10 : 9} className="text-center py-8 text-gray-500">No leads match these filters. Try clearing some.</td></tr>
            )}
            {leads.map((l) => {
              const teamChip = l.team === "India" ? "src-csv" : "src-wa";
              const isFreshHot = l.aiScore === "HOT" && (!l.lastTouchedAt || new Date(l.lastTouchedAt).getTime() > Date.now() - 6 * 3600_000);
              // Whole row navigates to the lead detail. Lalit: "client open
              // on click on client name, it should open on full selection
              // anywhere." Implemented as onClick on <tr> (table rows can't
              // wrap a Link cleanly without breaking layout). The checkbox td
              // stops propagation so bulk-select still works.
              const openLead = () => router.push(`/leads/${l.id}`);
              return (
                <tr
                  key={l.id}
                  onClick={openLead}
                  className={`cursor-pointer transition hover:bg-amber-50/40 ${selected.has(l.id) ? "bg-blue-50/50" : ""} ${isFreshHot ? "wcr-fresh-hot-pulse" : ""}`}
                >
                  <td onClick={(e) => e.stopPropagation()}>
                    {canBulk && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}
                  </td>
                  <td>
                    <span className="font-semibold text-[#0b1a33]">{l.name}</span>
                    {/* Phone on its own line (no email). Email is on the lead detail page only. */}
                    {l.phone && <div className="text-xs text-gray-500">📞 {l.phone}</div>}
                    {l.interest && <div className="text-[11px] text-gray-500">→ {l.interest}</div>}
                  </td>
                  <td>{l.team ? <span className={`chip ${teamChip}`}>{l.team}</span> : <span className="text-gray-400">—</span>}</td>
                  {showSource && <td><span className={`chip ${l.srcChip}`}>{l.srcLabel}</span></td>}
                  <td className="text-sm font-semibold">{l.budget ?? <span className="text-gray-400 font-normal">—</span>}</td>
                  <td><span className={`chip ${l.statusChip}`}>{l.statusName.replaceAll("_", " ")}</span></td>
                  <td>{l.aiScore ? <span className={`chip ${aiChip(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span> : <span className="text-gray-400">—</span>}</td>
                  <td>{l.owner ? <div className={`avatar ${l.owner.avatarColor}`} title={l.owner.name}>{l.owner.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div> : <span className="text-gray-400">—</span>}</td>
                  <td className="text-xs text-gray-500">{l.lastTouched}</td>
                  <td>⋯</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canBulk && <LeadBulkActions selectedIds={selectedIds} agents={agents} onClear={() => setSelected(new Set())} />}

      {/* ─── New bulk action bar (Tag · Reassign · Reject) ─────────────
          Renders ABOVE the legacy LeadBulkActions bar (email/delete) when
          rows are selected. Same z-50 sticky-bottom pattern as our modal
          bottom-bars. Safe-bottom inset so iPhone home indicator doesn't
          eat the buttons. */}
      {canBulk && selectedIds.length > 0 && (
        <>
          <div
            className="fixed left-0 right-0 z-50 bg-white border-t border-[#e5e7eb] shadow-2xl px-3 py-2 safe-bottom"
            style={{ bottom: "84px" /* sits above the dark LeadBulkActions bar */ }}
          >
            <div className="max-w-5xl mx-auto flex items-center gap-2 flex-wrap">
              <div className="text-xs font-semibold text-[#0b1a33] mr-1">
                {selectedIds.length} selected
              </div>
              <button
                onClick={clearSelection}
                className="text-[11px] text-gray-500 hover:text-gray-800 underline"
              >
                Clear
              </button>
              <div className="w-px h-6 bg-gray-200 mx-1" />
              <button
                onClick={() => { setShowTagPopover(v => !v); setShowReassignPopover(false); setShowWaPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-fuchsia-50 text-fuchsia-800 border border-fuchsia-300 px-3 py-2 rounded-lg min-h-11"
              >
                <Tag className="w-3.5 h-3.5" /> Tag
              </button>
              <button
                onClick={() => { setShowWaPopover(v => !v); setShowTagPopover(false); setShowReassignPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-[#e7f9ef] text-[#0f7a3d] border border-[#9ce0bb] px-3 py-2 rounded-lg min-h-11"
              >
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </button>
              {canReassign && (
                <button
                  onClick={() => { setShowReassignPopover(v => !v); setShowTagPopover(false); setShowWaPopover(false); }}
                  className="inline-flex items-center gap-1 text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-300 px-3 py-2 rounded-lg min-h-11"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reassign
                </button>
              )}
              <button
                onClick={() => { setShowRejectModal(true); setShowTagPopover(false); setShowReassignPopover(false); setShowWaPopover(false); }}
                className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-800 border border-red-300 px-3 py-2 rounded-lg min-h-11"
              >
                <XCircle className="w-3.5 h-3.5" /> Reject
              </button>
            </div>

            {/* Tag popover — multi-select checkbox grid. Anchored above the
                bar via absolute positioning relative to viewport (mb-2 from
                the bar by stacking it just above with bottom-full). */}
            {showTagPopover && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white border border-[#e5e7eb] rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33]">Add tags to {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowTagPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {PRESET_TAGS.map((t) => {
                    const on = pickedTags.has(t);
                    return (
                      <button
                        key={t}
                        onClick={() => togglePickedTag(t)}
                        className={`px-2.5 py-1.5 rounded-full text-[11px] font-semibold border ${on ? "bg-fuchsia-600 text-white border-fuchsia-600" : "bg-white text-gray-700 border-[#e5e7eb] hover:bg-gray-50"}`}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowTagPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkTag}
                    disabled={bulkBusy || pickedTags.size === 0}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Applying…" : `Apply (${pickedTags.size})`}
                  </button>
                </div>
              </div>
            )}

            {/* Reassign popover — single-select agent dropdown. */}
            {showReassignPopover && canReassign && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white border border-[#e5e7eb] rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33]">Reassign {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}</div>
                  <button onClick={() => setShowReassignPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>
                <select
                  value={reassignPick}
                  onChange={(e) => setReassignPick(e.target.value)}
                  className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white mb-3"
                >
                  <option value="">Pick an agent…</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
                </select>
                {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                {bulkCrossTeamWarn && <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">⚠️ {bulkCrossTeamWarn}</div>}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setShowReassignPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                  <button
                    onClick={applyBulkReassign}
                    disabled={bulkBusy || !reassignPick}
                    className="btn btn-primary text-xs"
                  >
                    {bulkBusy ? "Reassigning…" : "Apply"}
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp popover — pick a template, generate wa.me draft links.
                WhatsApp can't be sent server-side (no Meta API), so the agent
                opens each link one-by-one (or "Open all" with a 300ms stagger). */}
            {showWaPopover && (
              <div className="absolute left-3 right-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-md bottom-full mb-2 bg-white border border-[#e5e7eb] rounded-xl shadow-2xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-[#0b1a33] inline-flex items-center gap-1.5">
                    <MessageCircle className="w-4 h-4 text-[#0f7a3d]" />
                    WhatsApp {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowWaPopover(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
                </div>

                {waLinks.length === 0 && waSkipped.length === 0 ? (
                  <>
                    <label className="text-[11px] font-semibold text-gray-600">Template</label>
                    <select
                      value={waTemplate}
                      onChange={(e) => setWaTemplate(e.target.value)}
                      className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
                    >
                      {WA_PRESETS.map(p => <option key={p.v} value={p.v}>{p.label}</option>)}
                    </select>
                    {bulkErr && <div className="text-[11px] text-red-600 mb-2">{bulkErr}</div>}
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setShowWaPopover(false)} className="btn btn-ghost text-xs">Cancel</button>
                      <button
                        onClick={generateWaLinks}
                        disabled={bulkBusy}
                        className="btn btn-primary text-xs"
                      >
                        {bulkBusy ? "Generating…" : "Generate links"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 mb-2">
                      {waLinks.length} link{waLinks.length === 1 ? "" : "s"} ready. Tap each to open WhatsApp with the message pre-typed, then hit Send.
                      {waLinks.length > 1 && " “Open all” staggers them — your browser may block extras, so allow popups for this site."}
                    </p>
                    {waLinks.length > 0 && (
                      <div className="max-h-56 overflow-y-auto border border-[#eef0f3] rounded-lg divide-y divide-[#f1f3f5] mb-2">
                        {waLinks.map((l) => (
                          <a
                            key={l.leadId}
                            href={l.waLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-[#f3fbf6]"
                          >
                            <span className="truncate font-medium text-[#0b1a33]">Open WhatsApp — {l.name}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-[#0f7a3d] flex-none" />
                          </a>
                        ))}
                      </div>
                    )}
                    {waSkipped.length > 0 && (
                      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mb-2">
                        Skipped {waSkipped.length} (no phone): {waSkipped.slice(0, 5).map(s => s.name).join(", ")}{waSkipped.length > 5 ? "…" : ""}
                      </div>
                    )}
                    <div className="flex justify-between gap-2">
                      <button
                        onClick={() => { setWaLinks([]); setWaSkipped([]); setBulkErr(null); }}
                        className="btn btn-ghost text-xs"
                      >
                        Back
                      </button>
                      {waLinks.length > 0 && (
                        <button onClick={openAllWa} className="btn btn-primary text-xs">
                          Open all ({waLinks.length})
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Reject modal — full-screen overlay so the textarea has room. */}
          {showRejectModal && (
            <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={() => !bulkBusy && setShowRejectModal(false)}>
              <div
                className="bg-white sm:rounded-xl rounded-t-2xl max-w-md w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto safe-bottom"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="font-semibold text-lg flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-red-600" />
                    Reject {selectedIds.length} lead{selectedIds.length === 1 ? "" : "s"}
                  </div>
                  <button onClick={() => setShowRejectModal(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-gray-500 mb-4">
                  Each lead is marked LOST, removed from Today's follow-ups, and the reason is recorded in Reports.
                </p>

                <label className="text-xs font-semibold text-gray-600">Reason *</label>
                <select
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full mt-1 mb-3 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
                >
                  {REJECT_REASONS.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
                </select>

                <label className="text-xs font-semibold text-gray-600">
                  {rejectReason === "OTHER" ? "Specify *" : "Note (optional)"}
                </label>
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  rows={3}
                  placeholder={
                    rejectReason === "OTHER"
                      ? "e.g. Client passed away, moved abroad, family dispute…"
                      : "Add context — what did they say?"
                  }
                  className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono text-[13px]"
                />

                {bulkErr && <div className="text-xs text-red-600 mt-2">{bulkErr}</div>}

                <div className="flex justify-end gap-2 mt-4">
                  <button onClick={() => setShowRejectModal(false)} className="btn btn-ghost">Cancel</button>
                  <button
                    onClick={applyBulkReject}
                    disabled={bulkBusy}
                    className="btn bg-red-600 hover:bg-red-700 text-white"
                  >
                    {bulkBusy ? "Rejecting…" : `Reject ${selectedIds.length}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {/* §12.3 Hot Lead Alert — subtle red pulse on HOT leads that haven't been
          touched yet (or were touched within the last 6h). Keyframes inlined
          because this is a "use client" island and we don't want to bloat the
          global Tailwind layer for a single component. */}
      <style dangerouslySetInnerHTML={{ __html: `
@keyframes wcr-fresh-hot-pulse-kf {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.30), inset 0 0 0 1px rgba(239,68,68,0.0); }
  50%      { box-shadow: 0 0 0 4px rgba(239,68,68,0.10), inset 0 0 0 1px rgba(239,68,68,0.25); }
}
.wcr-fresh-hot-pulse { animation: wcr-fresh-hot-pulse-kf 2.4s ease-in-out infinite; }
` }} />
    </>
  );
}
