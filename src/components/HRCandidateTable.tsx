"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Phone, MessageCircle, Target, Bookmark, BookmarkPlus, Trash2, Columns3, X, Mic, AlertTriangle, Mail, StickyNote, ExternalLink, Sparkles, Search, CheckCircle2 } from "lucide-react";
import { ACTIVE_STATUS_DEFS, CLOSED_STATUS_DEFS, CLOSED_STATUS_KEYS, statusColor, displayStatus } from "@/lib/hrStatus";
import ColumnHeaderFilter, { type ColKind, type ColFilterState, type ColSortDir, isColFilterActive } from "@/components/ColumnHeaderFilter";
import HRCandidateRowPreview, { type PreviewData } from "@/components/HRCandidateRowPreview";
import { waHref, openWhatsApp } from "@/lib/waOpen";
import { backdropProps } from "@/lib/useDismiss";

const SOURCES = ["Naukri", "Indeed", "Referral", "Walk-in", "LinkedIn", "Database", "Consultant", "Email", "Whatsapp", "Other"];
const POSITIONS = ["Sales Executive", "BDE", "BDM", "Team Leader", "Manager", "HR", "Marketing", "Other"];
const NOTICE = ["Immediate", "7 days", "15 days", "30 days", "45 days", "60 days", "90 days", "Serving Notice"];
const CONFIRM = ["PENDING", "CONFIRMED", "NOT_CONFIRMED", "NOT_REACHABLE", "RESCHEDULED", "CANCELLED"];
const CLOSED_SET = new Set<string>(CLOSED_STATUS_KEYS);

const CHIPS: [string, string][] = [
  ["all", "All"], ["today", "Today's Actions"], ["overdue", "Overdue"], ["not-called", "Not Called"],
  ["pipeline", "Pipeline"], ["interview-today", "Interview Today"], ["f2f", "F2F Scheduled"],
  ["pending-confirm", "Pending Confirmation"], ["no-show", "No Show"], ["shortlisted", "Shortlisted"],
  ["offer", "Offer Released"], ["joined", "Joined"], ["closed", "Closed"],
];

// Map each quick-filter chip to the status key(s) it counts (countMap is keyed by
// HRCandidate.status). Chips that are pure derived signals (today / overdue /
// interview-today / pending-confirm) have no status count and render 0.
const CHIP_STATUS_KEYS: Record<string, string[]> = {
  "not-called": ["NOT_CALLED"],
  "pipeline": ["PIPELINE"],
  "f2f": ["F2F_INTERVIEW_SCHEDULED"],
  "no-show": ["NO_SHOW"],
  "shortlisted": ["SHORTLISTED"],
  "offer": ["OFFER_RELEASED"],
  "joined": ["JOINED"],
  "closed": [...CLOSED_STATUS_KEYS],
};
// Resolve a chip's count from the server-supplied status countMap.
function chipCount(key: string, countMap: Record<string, number>): number {
  if (key === "all") return Object.values(countMap).reduce((a, b) => a + b, 0);
  const keys = CHIP_STATUS_KEYS[key];
  if (!keys) return 0;
  return keys.reduce((sum, k) => sum + (countMap[k] ?? 0), 0);
}

// Toggleable table columns, in the canonical spec order (Created Date first).
// `key` doubles as the persisted hidden-set token and the header label source.
// `always` columns can't be hidden (Candidate Name + Actions).
const COLUMNS: { key: string; label: string; always?: boolean }[] = [
  { key: "createdDate", label: "Created Date", always: true },
  { key: "candidate", label: "Candidate Name", always: true },
  { key: "phone", label: "Phone" },
  { key: "position", label: "Position Applied" },
  { key: "profile", label: "Current Profile" },
  { key: "exp", label: "Experience" },
  { key: "currentSal", label: "Current Salary" },
  { key: "expectedSal", label: "Expected Salary" },
  { key: "status", label: "Current Status" },
  { key: "nextAction", label: "Next Action" },
  { key: "followUp", label: "Follow-up Date" },
  { key: "interview", label: "Interview" },
  { key: "owner", label: "Owner" },
  { key: "lastActivity", label: "Last Activity" },
  { key: "actions", label: "Actions", always: true },
];
// Columns hidden by default to keep the first load compact.
const DEFAULT_HIDDEN = new Set<string>([]);
const HIDDEN_COLS_KEY = "hr-candidate-hidden-cols-v2";

interface Interview { scheduledAt: string; type: string; confirmationStatus: string; attendanceStatus: string; }
interface Activity { type: string; createdAt: string; notes?: string | null; user?: { name: string | null } | null; }
interface Candidate {
  id: string; name: string; phone: string | null; whatsappPhone: string | null; email: string | null;
  location: string | null; city: string | null; remarks: string | null; currentCompany: string | null; currentProfile: string | null; positionApplied: string | null;
  experience: string | null; currentSalary: number | null; expectedSalary: number | null; noticePeriod: string | null;
  source: string | null; status: string; originalStatus: string | null; nextAction: string | null; nextActionDate: string | null; createdAt: string;
  primaryOwner: { id: string; name: string } | null; secondaryOwnerId: string | null;
  followUps: { dueAt: string }[];
  interviews: Interview[];
  activities: Activity[];
  hasResume: boolean;
  // Unread voice/escalation signals (computed server-side, scoped to the viewer).
  unreadVoiceCount?: number;
  openEscalationCount?: number;
  hasUnread?: boolean;
}
interface TablePerms {
  importData: boolean;
  exportData: boolean;
  bulkActions: boolean;
  assign: boolean;
  deleteCandidate: boolean;
}
const NO_PERMS: TablePerms = { importData: false, exportData: false, bulkActions: false, assign: false, deleteCandidate: false };

interface Props {
  candidates: Candidate[];
  agents: { id: string; name: string }[];
  countMap: Record<string, number>;
  // Current server-side ?q= value. The server search box is seeded with this and
  // submits a fresh ?q= (resetting to page 1) so search spans ALL pages, not just
  // the loaded one. Empty string = no active server search.
  serverSearch?: string;
  meId: string; meRole: string;
  perms?: TablePerms;
}

interface SavedView { id: string; name: string; query: string; isShared: boolean; isOwn: boolean; }

function fmtDate(s: string) { return new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }); }
function fmtDateFull(s: string) { return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }); }
function fmtAct(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
// Time-of-day in IST (e.g. "06:15 PM"), independent of the viewer's locale/zone.
function fmtTimeIST(s: string) { return new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }); }
// Map an HRActivity.type to a short, friendly action label for the Last Activity cell.
const ACTIVITY_LABELS: Record<string, string> = {
  CALL_CONNECTED: "Call Connected",
  CALL_NOT_ANSWERED: "Call Not Answered",
  CALL_BUSY: "Call Busy",
  CALL_SWITCHED_OFF: "Call Switched Off",
  CALL_WRONG_NUMBER: "Wrong Number",
  CALL_LATER: "Call Later",
  WHATSAPP_SENT: "WhatsApp Sent",
  WHATSAPP_RECEIVED: "WhatsApp Received",
  EMAIL_LOGGED: "Email Logged",
  INTERVIEW_SCHEDULED: "Interview Scheduled",
  INTERVIEW_ATTENDED: "Interview Attended",
  INTERVIEW_NO_SHOW: "Interview No-Show",
  INTERVIEW_RESCHEDULED: "Interview Rescheduled",
  OFFER_RELEASED: "Offer Released",
  OFFER_DECLINED: "Offer Declined",
  CANDIDATE_JOINED: "Candidate Joined",
  FOLLOWUP_CREATED: "Follow-up Set",
  FOLLOWUP_COMPLETED: "Follow-up Done",
  STATUS_CHANGED: "Status Changed",
  NOTE_ADDED: "Note Added",
  RESUME_UPLOADED: "Resume Uploaded",
  VOICE_NOTE: "Voice Note",
  VOICE_GUIDANCE: "Voice Guidance",
  ESCALATION_RAISED: "Escalation Raised",
  ESCALATION_REPLIED: "Escalation Replied",
  ESCALATION_RESOLVED: "Escalation Resolved",
};
function friendlyAct(type: string) { return ACTIVITY_LABELS[type] ?? fmtAct(type); }
function fmtSal(n: number | null) { if (!n) return "—"; return n >= 100000 ? `₹${(n / 100000).toFixed(1)}L` : `₹${(n / 1000).toFixed(0)}K`; }
function expYears(s: string | null): number | null { if (!s) return null; const m = s.match(/\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; }
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function endOfToday() { const d = startOfToday(); return new Date(d.getTime() + 24 * 3600_000); }

// Derived per-candidate signals used by chips, columns and filters.
function signals(c: Candidate, now: Date) {
  const todayS = startOfToday(), todayE = endOfToday();
  const nextFU = c.followUps[0]?.dueAt ?? c.nextActionDate ?? null;
  const upcoming = c.interviews
    .filter(iv => (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED") && new Date(iv.scheduledAt) >= now)
    .sort((a, b) => +new Date(a.scheduledAt) - +new Date(b.scheduledAt));
  const nextIV = upcoming[0] ?? c.interviews[0] ?? null;
  const interviewToday = c.interviews.some(iv => { const t = new Date(iv.scheduledAt); return t >= todayS && t < todayE && (iv.attendanceStatus === "SCHEDULED" || iv.attendanceStatus === "RESCHEDULED"); });
  const pendingConfirm = upcoming.some(iv => iv.confirmationStatus === "PENDING");
  const hasNoShow = c.interviews.some(iv => iv.attendanceStatus === "NO_SHOW");
  const fuOverdue = nextFU ? new Date(nextFU) < now : false;
  const fuToday = nextFU ? (new Date(nextFU) >= todayS && new Date(nextFU) < todayE) : false;
  return { nextFU, nextIV, interviewToday, pendingConfirm, hasNoShow, fuOverdue, fuToday };
}

// ── Excel header-filter column model (drives ColumnHeaderFilter + sort) ───────
// Same model the Buyer/Master-Data tables use: every filterable column declares
// a kind, a display-string accessor (multi-select picker + text match) and, for
// number/date kinds, a numeric accessor. The non-business columns (selection,
// Candidate Name link, Actions) are excluded from this list so they get no
// header filter — exactly like the Sales/Buyer tables.
type ColKey = "createdDate" | "phone" | "position" | "profile" | "exp" | "currentSal" | "expectedSal" | "status" | "nextAction" | "followUp" | "interview" | "owner" | "lastActivity";

type HFCol = {
  key: ColKey;
  kind: ColKind;
  str: (c: Candidate, s: ReturnType<typeof signals>) => string;
  num?: (c: Candidate, s: ReturnType<typeof signals>) => number;
  ordered?: boolean;
  options?: (rows: Candidate[]) => string[];
};

const STATUS_ORDER = [...ACTIVE_STATUS_DEFS, ...CLOSED_STATUS_DEFS];

const HF_COLS: HFCol[] = [
  { key: "createdDate", kind: "date", str: (c) => fmtDateFull(c.createdAt), num: (c) => +new Date(c.createdAt) },
  { key: "phone", kind: "text", str: (c) => c.phone ?? "—" },
  { key: "position", kind: "select", ordered: false, str: (c) => c.positionApplied ?? "—", options: () => POSITIONS },
  { key: "profile", kind: "text", str: (c) => c.currentProfile ?? "—" },
  { key: "exp", kind: "number", str: (c) => c.experience ?? "—", num: (c) => expYears(c.experience) ?? -1 },
  { key: "currentSal", kind: "number", str: (c) => fmtSal(c.currentSalary), num: (c) => c.currentSalary ?? -1 },
  { key: "expectedSal", kind: "number", str: (c) => fmtSal(c.expectedSalary), num: (c) => c.expectedSalary ?? -1 },
  // Status filters on the LABEL the user sees (displayStatus); options = canonical order.
  { key: "status", kind: "select", ordered: true, str: (c) => displayStatus(c), options: (rows) => {
      const canon = STATUS_ORDER.map(s => s.label);
      const seen = Array.from(new Set(rows.map(displayStatus)));
      // Keep canonical order first, then any verbatim originalStatus values not in it.
      return [...canon, ...seen.filter(v => !canon.includes(v))];
    } },
  { key: "nextAction", kind: "text", str: (c) => c.nextAction ?? "—" },
  { key: "followUp", kind: "date", str: (_c, s) => (s.nextFU ? fmtDateFull(s.nextFU) : "—"), num: (_c, s) => (s.nextFU ? +new Date(s.nextFU) : -1) },
  { key: "interview", kind: "date", str: (_c, s) => (s.nextIV ? fmtDateFull(s.nextIV.scheduledAt) : "—"), num: (_c, s) => (s.nextIV ? +new Date(s.nextIV.scheduledAt) : -1) },
  { key: "owner", kind: "text", str: (c) => c.primaryOwner?.name ?? "—" },
  { key: "lastActivity", kind: "date", str: (c) => (c.activities[0] ? fmtDateFull(c.activities[0].createdAt) : "—"), num: (c) => (c.activities[0] ? +new Date(c.activities[0].createdAt) : -1) },
];
const HF_BY_KEY = new Map(HF_COLS.map(c => [c.key, c]));

// ── Saved-view presets (spec #11) ────────────────────────────────────────────
// Recruiter-friendly one-click views layered on top of the saved-filters bar.
// Each maps to a snapshot the table understands (same shape as snapshotState()).
const PRESETS: { name: string; build: () => Record<string, unknown> }[] = [
  { name: "Today's Calls", build: () => ({ chip: "today" }) },
  { name: "Interview Today", build: () => ({ chip: "interview-today" }) },
  { name: "Salary Above ₹50K", build: () => ({ curMin: "50000" }) },
  { name: "Team Leader Candidates", build: () => ({ fPosition: "Team Leader" }) },
  { name: "Gurgaon Candidates", build: () => ({ fLocation: "Gurgaon" }) },
  { name: "Dubai Candidates", build: () => ({ fLocation: "Dubai" }) },
];

export default function HRCandidateTable({ candidates, agents, countMap = {}, serverSearch = "", perms = NO_PERMS }: Props) {
  const now = new Date();
  // UI gating is driven by the permission matrix (server re-enforces every action).
  const canExport = perms.exportData;
  // Only users who can run bulk actions get the row-selection checkboxes + toolbar
  // (no point letting Junior HR select rows that lead to an empty/absent toolbar).
  const canBulk = perms.bulkActions;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkOwner, setBulkOwner] = useState("");
  const [bulkFollowUp, setBulkFollowUp] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  // Brief confirmation shown after a successful bulk Apply (e.g. "✓ 3 updated").
  // Auto-clears after a few seconds; cleared eagerly on the next bulk action.
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  // Server-side search box value (submits ?q= to the page, spanning ALL pages).
  // Seeded from the current server param so it survives navigation/refresh.
  const [serverQ, setServerQ] = useState(serverSearch);
  useEffect(() => { setServerQ(serverSearch); }, [serverSearch]);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState("all");
  const [view, setView] = useState<"table" | "cards">("table");
  const [showAdv, setShowAdv] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showCols, setShowCols] = useState(false);

  // Advanced filters
  const [fStatus, setFStatus] = useState("");
  const [fSource, setFSource] = useState("");
  const [fPosition, setFPosition] = useState("");
  const [fProfile, setFProfile] = useState("");
  const [fLocation, setFLocation] = useState("");
  const [fCity, setFCity] = useState("");
  const [fEmail, setFEmail] = useState("");
  const [fRemarks, setFRemarks] = useState("");
  const [fOwner, setFOwner] = useState("");
  // Free-text owner NAME match (complements the id-based fOwner dropdown).
  const [fOwnerName, setFOwnerName] = useState("");
  const [fNotice, setFNotice] = useState("");
  const [fConfirm, setFConfirm] = useState("");
  const [fResume, setFResume] = useState("");
  const [fNoShow, setFNoShow] = useState(false);
  const [expMin, setExpMin] = useState(""); const [expMax, setExpMax] = useState("");
  const [curMin, setCurMin] = useState(""); const [curMax, setCurMax] = useState("");
  const [expSalMin, setExpSalMin] = useState(""); const [expSalMax, setExpSalMax] = useState("");
  const [fuFrom, setFuFrom] = useState(""); const [fuTo, setFuTo] = useState("");
  const [ivFrom, setIvFrom] = useState(""); const [ivTo, setIvTo] = useState("");

  // ── Excel per-column header filters + sort (client-state) ──────────────────
  const [colFilters, setColFilters] = useState<Record<string, ColFilterState>>({});
  const [sortKey, setSortKey] = useState<ColKey>("createdDate");
  const [sortDir, setSortDir] = useState<ColSortDir>("desc");

  // ── Column show/hide (persisted client-side via localStorage) ──────────────
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_COLS_KEY);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, []);
  const persistHidden = useCallback((s: Set<string>) => {
    try { localStorage.setItem(HIDDEN_COLS_KEY, JSON.stringify([...s])); } catch {}
  }, []);
  function toggleCol(key: string) {
    setHidden(h => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); persistHidden(n); return n; });
  }
  const visible = useCallback((key: string) => !hidden.has(key), [hidden]);

  // ── Saved Views (filter + column snapshot via /api/hr/saved-filters) ───────
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewsLoaded, setViewsLoaded] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveShared, setSaveShared] = useState(false);
  const [savingView, setSavingView] = useState(false);

  async function loadViews() {
    try {
      const r = await fetch("/api/hr/saved-filters", { cache: "no-store" });
      if (!r.ok) { setViewsLoaded(true); return; }
      const j = await r.json();
      setViews(j.items ?? []);
    } catch {} finally { setViewsLoaded(true); }
  }
  useEffect(() => { loadViews(); }, []);

  // Snapshot every filter + column-visibility + per-column-filter + sort piece of
  // state into one JSON blob (serializing Sets → arrays).
  function serCol(cf: Record<string, ColFilterState>) {
    return Object.fromEntries(Object.entries(cf).filter(([, f]) => isColFilterActive(f)).map(([k, f]) => [k, { values: [...f.values], min: f.min, max: f.max }]));
  }
  function snapshotState() {
    return {
      search, chip, hidden: [...hidden], sortKey, sortDir, colFilters: serCol(colFilters),
      fStatus, fSource, fPosition, fProfile, fLocation, fCity, fEmail, fRemarks, fOwner, fOwnerName, fNotice, fConfirm, fResume, fNoShow,
      expMin, expMax, curMin, curMax, expSalMin, expSalMax, fuFrom, fuTo, ivFrom, ivTo,
    };
  }
  // Apply a snapshot object (from a saved view OR a preset). Anything absent
  // resets to its default, so presets behave as clean one-click views.
  function applySnapshotObj(v: Record<string, unknown>) {
    const str = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
    setSearch(str("search")); setChip(str("chip") || "all");
    setFStatus(str("fStatus")); setFSource(str("fSource")); setFPosition(str("fPosition"));
    setFProfile(str("fProfile")); setFLocation(str("fLocation")); setFOwner(str("fOwner"));
    setFCity(str("fCity")); setFEmail(str("fEmail")); setFRemarks(str("fRemarks")); setFOwnerName(str("fOwnerName"));
    setFNotice(str("fNotice")); setFConfirm(str("fConfirm")); setFResume(str("fResume"));
    setFNoShow(v.fNoShow === true);
    setExpMin(str("expMin")); setExpMax(str("expMax")); setCurMin(str("curMin")); setCurMax(str("curMax"));
    setExpSalMin(str("expSalMin")); setExpSalMax(str("expSalMax"));
    setFuFrom(str("fuFrom")); setFuTo(str("fuTo")); setIvFrom(str("ivFrom")); setIvTo(str("ivTo"));
    setSortKey((typeof v.sortKey === "string" && HF_BY_KEY.has(v.sortKey as ColKey)) ? (v.sortKey as ColKey) : "createdDate");
    setSortDir(v.sortDir === "asc" ? "asc" : "desc");
    if (Array.isArray(v.hidden)) {
      const h = new Set((v.hidden as unknown[]).filter(x => typeof x === "string") as string[]);
      setHidden(h); persistHidden(h);
    } else { setHidden(new Set(DEFAULT_HIDDEN)); persistHidden(new Set(DEFAULT_HIDDEN)); }
    const cf = v.colFilters as Record<string, { values: string[]; min: string; max: string }> | undefined;
    setColFilters(cf ? Object.fromEntries(Object.entries(cf).map(([k, f]) => [k, { values: new Set(f.values), min: f.min, max: f.max }])) : {});
  }
  function applySnapshot(raw: string) {
    let v: Record<string, unknown>;
    try { v = JSON.parse(raw); } catch { return; }
    applySnapshotObj(v);
  }
  async function saveView() {
    if (savingView || !saveName.trim()) return;
    setSavingView(true);
    try {
      const r = await fetch("/api/hr/saved-filters", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: saveName.trim(), query: JSON.stringify(snapshotState()), isShared: saveShared }),
      });
      if (r.ok) { setShowSaveDialog(false); setSaveName(""); setSaveShared(false); await loadViews(); }
    } finally { setSavingView(false); }
  }
  async function deleteView(v: SavedView) {
    if (!confirm(`Delete saved view "${v.name}"?`)) return;
    const r = await fetch(`/api/hr/saved-filters?id=${encodeURIComponent(v.id)}`, { method: "DELETE" });
    if (r.ok) await loadViews();
  }

  // Submit the server-side search: navigate to the page with a fresh ?q= and
  // page reset to 1, preserving the existing closed/status/batch params. This
  // makes search span ALL pages (server filters before pagination) rather than
  // only the 50 rows already loaded.
  function submitServerSearch(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    const v = serverQ.trim();
    if (v) params.set("q", v); else params.delete("q");
    params.delete("page"); // back to page 1 on any new search
    const qs = params.toString();
    router.push(qs ? `/hr/candidates?${qs}` : "/hr/candidates");
  }
  function clearServerSearch() {
    setServerQ("");
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.delete("q");
    params.delete("page");
    const qs = params.toString();
    router.push(qs ? `/hr/candidates?${qs}` : "/hr/candidates");
  }

  function chipMatch(c: Candidate, s: ReturnType<typeof signals>): boolean {
    switch (chip) {
      case "all": return true;
      case "today": return s.fuToday || s.interviewToday;
      case "overdue": return s.fuOverdue;
      case "not-called": return c.status === "NOT_CALLED";
      case "pipeline": return c.status === "PIPELINE";
      case "interview-today": return s.interviewToday;
      case "f2f": return c.status === "F2F_INTERVIEW_SCHEDULED";
      case "pending-confirm": return s.pendingConfirm;
      case "no-show": return c.status === "NO_SHOW" || s.hasNoShow;
      case "shortlisted": return c.status === "SHORTLISTED";
      case "offer": return c.status === "OFFER_RELEASED";
      case "joined": return c.status === "JOINED";
      case "closed": return CLOSED_SET.has(c.status);
      default: return true;
    }
  }

  function advMatch(c: Candidate, s: ReturnType<typeof signals>): boolean {
    if (fStatus && c.status !== fStatus) return false;
    if (fSource && (c.source ?? "") !== fSource) return false;
    if (fPosition && (c.positionApplied ?? "") !== fPosition) return false;
    if (fProfile && !(c.currentProfile ?? "").toLowerCase().includes(fProfile.toLowerCase())) return false;
    if (fLocation && !(c.location ?? "").toLowerCase().includes(fLocation.toLowerCase())) return false;
    if (fCity && !(c.city ?? "").toLowerCase().includes(fCity.toLowerCase())) return false;
    if (fEmail && !(c.email ?? "").toLowerCase().includes(fEmail.toLowerCase())) return false;
    if (fRemarks && !(c.remarks ?? "").toLowerCase().includes(fRemarks.toLowerCase())) return false;
    if (fOwner && c.primaryOwner?.id !== fOwner) return false;
    if (fOwnerName && !(c.primaryOwner?.name ?? "").toLowerCase().includes(fOwnerName.toLowerCase())) return false;
    if (fNotice && (c.noticePeriod ?? "") !== fNotice) return false;
    if (fResume === "yes" && !c.hasResume) return false;
    if (fResume === "no" && c.hasResume) return false;
    if (fNoShow && !(c.status === "NO_SHOW" || s.hasNoShow)) return false;
    if (fConfirm && !c.interviews.some(iv => iv.confirmationStatus === fConfirm)) return false;
    const ey = expYears(c.experience);
    if (expMin && (ey === null || ey < parseFloat(expMin))) return false;
    if (expMax && (ey === null || ey > parseFloat(expMax))) return false;
    if (curMin && (c.currentSalary === null || c.currentSalary < parseFloat(curMin))) return false;
    if (curMax && (c.currentSalary === null || c.currentSalary > parseFloat(curMax))) return false;
    if (expSalMin && (c.expectedSalary === null || c.expectedSalary < parseFloat(expSalMin))) return false;
    if (expSalMax && (c.expectedSalary === null || c.expectedSalary > parseFloat(expSalMax))) return false;
    if (fuFrom && (!s.nextFU || new Date(s.nextFU) < new Date(fuFrom))) return false;
    if (fuTo && (!s.nextFU || new Date(s.nextFU) > new Date(fuTo + "T23:59:59"))) return false;
    if (ivFrom && (!s.nextIV || new Date(s.nextIV.scheduledAt) < new Date(ivFrom))) return false;
    if (ivTo && (!s.nextIV || new Date(s.nextIV.scheduledAt) > new Date(ivTo + "T23:59:59"))) return false;
    return true;
  }

  // Per-column Excel header-filter match (composes AND with chip/adv/search).
  const colEntries = useMemo(() => Object.entries(colFilters).filter(([, f]) => isColFilterActive(f)), [colFilters]);
  function colMatch(c: Candidate, s: ReturnType<typeof signals>): boolean {
    const dayStart = (str: string) => { const t = new Date(str + "T00:00:00").getTime(); return isNaN(t) ? null : t; };
    const dayEnd = (str: string) => { const t = new Date(str + "T23:59:59.999").getTime(); return isNaN(t) ? null : t; };
    for (const [key, f] of colEntries) {
      const col = HF_BY_KEY.get(key as ColKey);
      if (!col) continue;
      if (col.kind === "text" || col.kind === "select") {
        if (f.values.size > 0 && !f.values.has(col.str(c, s) || "—")) return false;
      } else if (col.kind === "number") {
        const v = col.num ? col.num(c, s) : 0;
        if (f.min !== "" && v < Number(f.min)) return false;
        if (f.max !== "" && v > Number(f.max)) return false;
      } else if (col.kind === "date") {
        const v = col.num ? col.num(c, s) : 0;
        if (f.min !== "") { const lo = dayStart(f.min); if (lo != null && (v < 0 || v < lo)) return false; }
        if (f.max !== "") { const hi = dayEnd(f.max); if (hi != null && (v < 0 || v > hi)) return false; }
      }
    }
    return true;
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = candidates.filter(c => {
      const s = signals(c, now);
      if (!chipMatch(c, s)) return false;
      if (!advMatch(c, s)) return false;
      if (!colMatch(c, s)) return false;
      if (q && !(
        c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q) ||
        (c.whatsappPhone ?? "").includes(q) ||
        (c.email ?? "").toLowerCase().includes(q) || (c.currentCompany ?? "").toLowerCase().includes(q) ||
        (c.currentProfile ?? "").toLowerCase().includes(q) ||
        (c.city ?? "").toLowerCase().includes(q) || (c.remarks ?? "").toLowerCase().includes(q) ||
        (c.primaryOwner?.name ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
    // Sort by the active header-filter column.
    const dir = sortDir === "asc" ? 1 : -1;
    const col = HF_BY_KEY.get(sortKey);
    return out.slice().sort((a, b) => {
      const sa = signals(a, now), sb = signals(b, now);
      if (col?.num) return (col.num(a, sa) - col.num(b, sb)) * dir;
      const va = col ? col.str(a, sa) : "";
      const vb = col ? col.str(b, sb) : "";
      return va.localeCompare(vb, undefined, { numeric: true }) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, search, chip, fStatus, fSource, fPosition, fProfile, fLocation, fCity, fEmail, fRemarks, fOwner, fOwnerName, fNotice, fConfirm, fResume, fNoShow, expMin, expMax, curMin, curMax, expSalMin, expSalMax, fuFrom, fuTo, ivFrom, ivTo, colFilters, sortKey, sortDir]);

  // Distinct option lists for text/select header filters (over loaded rows).
  const colOptions = useMemo(() => {
    const m = new Map<ColKey, string[]>();
    for (const col of HF_COLS) {
      if (col.kind !== "text" && col.kind !== "select") continue;
      if (col.options) { m.set(col.key, col.options(candidates)); continue; }
      const vals = Array.from(new Set(candidates.map(c => col.str(c, signals(c, now)) || "—"))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      m.set(col.key, vals);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates]);

  const setColFilter = (key: ColKey, next: ColFilterState) => {
    setColFilters(prev => { const n = { ...prev }; if (isColFilterActive(next)) n[key] = next; else delete n[key]; return n; });
  };
  const setSort = (key: ColKey, dir: ColSortDir) => { setSortKey(key); setSortDir(dir); };
  const activeColCount = colEntries.length;

  function resetAdv() {
    // "Reset all" — clears the advanced drawer AND the top-level chip + search so
    // nothing stays silently active after the user clears filters.
    setSearch(""); setChip("all");
    setFStatus(""); setFSource(""); setFPosition(""); setFProfile(""); setFLocation(""); setFOwner("");
    setFCity(""); setFEmail(""); setFRemarks(""); setFOwnerName("");
    setFNotice(""); setFConfirm(""); setFResume(""); setFNoShow(false);
    setExpMin(""); setExpMax(""); setCurMin(""); setCurMax(""); setExpSalMin(""); setExpSalMax("");
    setFuFrom(""); setFuTo(""); setIvFrom(""); setIvTo("");
    setColFilters({});
  }

  function toggleSel(id: string) { setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }
  function toggleAll() { setSelected(s => s.size === filtered.length ? new Set() : new Set(filtered.map(c => c.id))); }
  async function applyBulk() {
    if (selected.size === 0 || (!bulkStatus && !bulkOwner && !bulkFollowUp)) return;
    setBulkBusy(true); setBulkError(null); setBulkSuccess(null);
    try {
      const res = await fetch("/api/hr/candidates/bulk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], status: bulkStatus || undefined, primaryOwnerId: bulkOwner || undefined, followUpDate: bulkFollowUp || undefined }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkError(j?.error || "Bulk update failed. Please try again.");
        return; // do NOT clear the selection or pretend success
      }
      // A 200 with updated:0 means nothing actually changed (e.g. no-op / invalid
      // action) — warn instead of pretending success.
      if (typeof j?.updated === "number" && j.updated <= 0) {
        setBulkError("No candidates were updated.");
        return;
      }
      // Show a brief success confirmation with the actual count the server reported
      // (falls back to the selected count) before clearing the selection.
      const n = typeof j?.updated === "number" ? j.updated : selected.size;
      setBulkSuccess(`✓ ${n} updated`);
      setSelected(new Set()); setBulkStatus(""); setBulkOwner(""); setBulkFollowUp(""); router.refresh();
    } catch {
      setBulkError("Network error — bulk update did not complete.");
    } finally {
      setBulkBusy(false);
    }
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!window.confirm(`Move ${selected.size} candidate${selected.size === 1 ? "" : "s"} to the recycle bin? Their follow-ups, interviews, timeline and resumes are preserved and can be restored.`)) return;
    setBulkBusy(true); setBulkError(null);
    try {
      const res = await fetch("/api/hr/candidates/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [...selected], action: "delete" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBulkError(j?.error || "Delete failed. Please try again.");
        return;
      }
      // Confirm the server actually deleted rows before claiming success.
      if (typeof j?.deleted === "number" && j.deleted <= 0) {
        setBulkError("No candidates were deleted.");
        return;
      }
      setSelected(new Set()); router.refresh();
    } catch {
      setBulkError("Network error — delete did not complete.");
    } finally {
      setBulkBusy(false);
    }
  }

  // RBAC-safe export: build a link to the server endpoint, which re-checks the
  // exportData permission AND re-scopes rows server-side. NEVER assemble the CSV
  // in-memory here (that would let a Junior HR call exportRows() via the console
  // and read rows outside their scope). The endpoint only emits the
  // server-derivable filters (status/position/source/date); the on-screen "All"
  // link stays unfiltered. "Selected" passes the chosen ids.
  function exportHref(which: "all" | "filtered" | "selected"): string {
    const params = new URLSearchParams({ format: "csv" });
    if (which === "selected") {
      params.set("ids", [...selected].join(","));
    } else if (which === "filtered") {
      if (fStatus) params.set("status", fStatus);
      if (fPosition) params.set("position", fPosition);
      if (fSource) params.set("source", fSource);
    }
    // "all" → no extra filters (server still scopes to the caller).
    return `/api/hr/candidates/export?${params.toString()}`;
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs dark:bg-slate-800 dark:border-slate-600";
  const lbl = "block text-[10px] font-semibold text-gray-500 mb-1 uppercase tracking-wide";

  // Unread voice / open-escalation badges next to a candidate's name.
  const UnreadBadges = ({ c }: { c: Candidate }) => {
    const voice = c.unreadVoiceCount ?? 0;
    const esc = c.openEscalationCount ?? 0;
    if (voice <= 0 && esc <= 0) return null;
    return (
      <span className="inline-flex items-center gap-1 align-middle">
        {voice > 0 && (
          <span title={`${voice} unread voice guidance message${voice === 1 ? "" : "s"}`}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            <Mic className="w-2.5 h-2.5" />{voice}
          </span>
        )}
        {esc > 0 && (
          <span title={`${esc} open escalation${esc === 1 ? "" : "s"}`}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
            <AlertTriangle className="w-2.5 h-2.5" />{esc}
          </span>
        )}
      </span>
    );
  };

  // Row action buttons. Each stops row-click propagation so the row's open-on-click
  // never fights a quick action. Reuse the detail deep-links for schedule/note/voice.
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const RowActions = ({ c }: { c: Candidate }) => (
    <div className="flex items-center gap-0.5" onClick={stop}>
      {c.phone && <a href={`tel:${c.phone}`} onClick={stop} title="Call" className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400"><Phone className="w-3.5 h-3.5" /></a>}
      {(c.whatsappPhone ?? c.phone) && <a href={waHref(c.whatsappPhone ?? c.phone)} target="_blank" rel="noopener noreferrer" onClick={(e) => { stop(e); e.preventDefault(); openWhatsApp(c.whatsappPhone ?? c.phone); }} title="WhatsApp" className="p-1 rounded hover:bg-green-50 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400"><MessageCircle className="w-3.5 h-3.5" /></a>}
      <Link href={`/hr/candidates/${c.id}?do=voice`} onClick={stop} title="Voice Note" className="p-1 rounded hover:bg-sky-50 dark:hover:bg-sky-900/30 text-sky-600 dark:text-sky-400"><Mic className="w-3.5 h-3.5" /></Link>
      {c.email && <a href={`mailto:${c.email}`} onClick={stop} title="Email" className="p-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-400"><Mail className="w-3.5 h-3.5" /></a>}
      <Link href={`/hr/candidates/${c.id}?do=interview`} onClick={stop} title="Schedule Interview" className="p-1 rounded hover:bg-purple-50 dark:hover:bg-purple-900/30 text-purple-600 dark:text-purple-400"><Target className="w-3.5 h-3.5" /></Link>
      <Link href={`/hr/candidates/${c.id}?do=note`} onClick={stop} title="Add Note" className="p-1 rounded hover:bg-amber-50 dark:hover:bg-amber-900/30 text-amber-600 dark:text-amber-400"><StickyNote className="w-3.5 h-3.5" /></Link>
      <Link href={`/hr/candidates/${c.id}`} onClick={stop} title="Open" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700 text-gray-500 dark:text-slate-400"><ExternalLink className="w-3.5 h-3.5" /></Link>
    </div>
  );

  // Build the hover-preview payload for a candidate from already-loaded fields.
  function previewOf(c: Candidate, s: ReturnType<typeof signals>): PreviewData {
    const lastNoteAct = c.activities.find(a => a.type === "NOTE_ADDED" && a.notes && a.notes.trim());
    const lastCallAct = c.activities.find(a => a.type.startsWith("CALL_"));
    return {
      name: c.name,
      lastNote: lastNoteAct?.notes?.trim() ?? null,
      lastCallDate: lastCallAct?.createdAt ?? null,
      lastFollowUp: s.nextFU,
      lastFollowUpOverdue: s.fuOverdue,
      recruiter: c.primaryOwner?.name ?? null,
      hasResume: c.hasResume,
      currentStage: displayStatus(c),
      statusClass: statusColor(c.status),
    };
  }

  // ── Hover preview positioning (fixed card next to the hovered row) ──────────
  const [preview, setPreview] = useState<{ data: PreviewData; top: number; left: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onRowEnter(e: React.MouseEvent, c: Candidate, s: ReturnType<typeof signals>) {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const data = previewOf(c, s);
    hoverTimer.current = setTimeout(() => {
      // Prefer right of the row; flip left if it would overflow the viewport.
      const cardW = 288; // w-72
      const left = rect.right + cardW + 12 < window.innerWidth ? rect.right + 8 : Math.max(8, rect.left - cardW - 8);
      const top = Math.min(rect.top, window.innerHeight - 260);
      setPreview({ data, top: Math.max(8, top), left });
    }, 350);
  }
  function onRowLeave() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setPreview(null);
  }
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  // Auto-dismiss the bulk-success confirmation after a few seconds.
  useEffect(() => {
    if (!bulkSuccess) return;
    const t = setTimeout(() => setBulkSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [bulkSuccess]);

  // Sticky-column offsets (selection 32px → Created Date → Candidate → Phone).
  // These let the first three business columns stay pinned on horizontal scroll.
  const STICKY = {
    sel: "left-0 w-8",
    created: "left-8",
    candidate: "left-[136px]",
    phone: "left-[256px]",
  };
  const stickyBg = "bg-white dark:bg-slate-900 group-hover:bg-gray-50/80 dark:group-hover:bg-slate-800/50";
  const stickyHeadBg = "bg-gray-50 dark:bg-slate-800";

  // Header cells in column order, honoring visibility (excludes the always cols
  // which are rendered explicitly so they can be sticky).
  const dynHeaders = COLUMNS.filter(col => !["createdDate", "candidate", "phone", "actions"].includes(col.key) && visible(col.key));

  // Sort-trigger label + Excel header filter (a SPAN, so it can live inside any
  // <th> — sticky headers wrap it, dynamic headers wrap it via renderTh()). These
  // are render HELPERS (functions returning JSX), not nested components, so they
  // don't trip the static-components lint rule.
  const renderHeaderLabel = (colKey: ColKey, label: string, right = false) => (
    <span className={`inline-flex items-center ${right ? "justify-end" : ""}`}>
      <span className="cursor-pointer" onClick={() => setSort(colKey, sortKey === colKey && sortDir === "asc" ? "desc" : "asc")}>{label}</span>
      <ColumnHeaderFilter
        label={label}
        kind={HF_BY_KEY.get(colKey)!.kind}
        sortActive={sortKey === colKey}
        sortDir={sortDir}
        onSort={(dir) => setSort(colKey, dir)}
        filter={colFilters[colKey]}
        onApply={(next) => setColFilter(colKey, next)}
        options={colOptions.get(colKey) ?? []}
      />
    </span>
  );

  // Compact dynamic header cell (non-sticky columns). `cls` carries extra classes.
  const renderTh = (colKey: ColKey, label: string, cls = "", right = false) => (
    <th key={colKey} className={`px-2 py-2 whitespace-nowrap font-semibold ${right ? "text-right" : "text-left"} ${cls}`}>
      {renderHeaderLabel(colKey, label, right)}
    </th>
  );

  const anyAdv = !!(fStatus || fSource || fPosition || fProfile || fLocation || fCity || fEmail || fRemarks || fOwner || fOwnerName || fNotice || fConfirm || fResume || fNoShow ||
    expMin || expMax || curMin || curMax || expSalMin || expSalMax || fuFrom || fuTo || ivFrom || ivTo || activeColCount > 0);

  return (
    <div className="space-y-3">
      {/* Server-side search — spans ALL pages (filters before pagination), unlike the
          client search below which only refines the rows already loaded on this page. */}
      <form onSubmit={submitServerSearch} className="flex gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={serverQ} onChange={e => setServerQ(e.target.value)}
            placeholder="Search all candidates — name, phone, email, position, company, city, owner, notes…"
            className="w-full border border-gray-200 rounded-xl pl-9 pr-9 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2e4a]/20 dark:bg-slate-800 dark:border-slate-600" />
          {serverQ && (
            <button type="button" onClick={clearServerSearch} title="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <button type="submit"
          className="px-4 py-2 rounded-xl text-sm font-semibold bg-[#1a2e4a] text-white hover:bg-[#243d60] transition whitespace-nowrap inline-flex items-center gap-1.5">
          <Search className="w-4 h-4" /> Search
        </button>
      </form>
      {serverSearch && (
        <div className="text-xs text-gray-500 dark:text-slate-400 -mt-1">
          Showing all-pages results for <span className="font-semibold text-gray-700 dark:text-slate-200">“{serverSearch}”</span>.
          <button type="button" onClick={clearServerSearch} className="ml-1 text-[#1a2e4a] dark:text-blue-400 underline hover:no-underline">Clear</button>
        </div>
      )}
      {/* Search + view toggle */}
      <div className="flex gap-2 flex-wrap items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="🔍  Refine this page — name, phone, email, company, profile, city, owner, notes…"
          className="flex-1 min-w-[220px] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1a2e4a]/20 dark:bg-slate-800 dark:border-slate-600" />
        <button type="button" onClick={() => setShowAdv(s => !s)}
          className={`px-3 py-2 rounded-xl text-sm border ${showAdv || anyAdv ? "bg-[#1a2e4a] text-white border-[#1a2e4a]" : "border-gray-300 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
          ⚙ Filters{anyAdv ? " •" : ""}
        </button>
        {/* Column show/hide */}
        <div className="relative">
          <button type="button" onClick={() => setShowCols(s => !s)}
            className="px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5">
            <Columns3 className="w-4 h-4" /> Columns
          </button>
          {showCols && (
            <div className="absolute right-0 mt-1 z-30 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1.5 text-sm w-52 max-h-80 overflow-y-auto">
              <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Show columns</div>
              {COLUMNS.filter(col => !col.always).map(col => (
                <label key={col.key} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={visible(col.key)} onChange={() => toggleCol(col.key)} />
                  <span className="text-gray-700 dark:text-slate-200">{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="flex rounded-xl border border-gray-300 dark:border-slate-700 overflow-hidden text-sm">
          <button type="button" onClick={() => setView("table")} className={`px-3 py-2 ${view === "table" ? "bg-[#1a2e4a] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"}`}>Table</button>
          <button type="button" onClick={() => setView("cards")} className={`px-3 py-2 ${view === "cards" ? "bg-[#1a2e4a] text-white" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800"}`}>Cards</button>
        </div>
        {canExport && (
          <div className="relative">
            <button type="button" onClick={() => setShowExport(s => !s)} className="px-3 py-2 rounded-xl text-sm border border-gray-300 dark:border-slate-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-slate-800">⬇ Export</button>
            {showExport && (
              <div className="absolute right-0 mt-1 z-20 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl shadow-lg py-1 text-sm w-64">
                {/* All export links hit the server endpoint, which re-checks the
                    exportData permission and re-scopes rows — no client-side CSV. */}
                <a href={exportHref("filtered")} onClick={() => setShowExport(false)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800">Filtered → CSV</a>
                {selected.size > 0 && <a href={exportHref("selected")} onClick={() => setShowExport(false)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800">Selected → CSV ({selected.size})</a>}
                <a href={exportHref("all")} onClick={() => setShowExport(false)} className="block w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-slate-800 border-t border-gray-100 dark:border-slate-800">All candidates → CSV</a>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Saved Views bar — presets + user-saved views */}
      <div className="flex flex-wrap items-center gap-1.5 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-3 py-2">
        <Bookmark className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] text-gray-500 font-bold tracking-widest uppercase mr-1">Saved views</span>
        {/* One-click presets (spec #11) */}
        {PRESETS.map(p => (
          <button key={p.name} type="button" onClick={() => applySnapshotObj(p.build())}
            className="text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap bg-[#1a2e4a]/5 dark:bg-blue-900/20 text-[#1a2e4a] dark:text-blue-300 border border-[#1a2e4a]/15 dark:border-blue-800 hover:bg-[#1a2e4a]/10 inline-flex items-center gap-1 transition"
            title={`Preset: ${p.name}`}>
            <Sparkles className="w-3 h-3" />{p.name}
          </button>
        ))}
        <span className="w-px h-4 bg-gray-200 dark:bg-slate-700 mx-0.5" />
        {!viewsLoaded && <span className="text-xs text-gray-400">Loading…</span>}
        {viewsLoaded && views.length === 0 && <span className="text-xs text-gray-400">Set filters, then save your own.</span>}
        {views.map(v => (
          <span key={v.id} className="inline-flex items-center group">
            <button type="button" onClick={() => applySnapshot(v.query)}
              className="text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-200 hover:bg-amber-50 hover:text-[#1a2e4a] transition"
              title={v.isShared ? "Shared view" : "Private view"}>
              {v.isShared ? "👥 " : "⭐ "}{v.name}
            </button>
            {v.isOwn && (
              <button type="button" onClick={() => deleteView(v)}
                className="opacity-0 group-hover:opacity-100 ml-0.5 text-gray-400 hover:text-red-600 p-0.5 transition" title={`Delete "${v.name}"`}>
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </span>
        ))}
        <button type="button" onClick={() => setShowSaveDialog(true)}
          className="text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 inline-flex items-center gap-1">
          <BookmarkPlus className="w-3 h-3" /> Save current
        </button>
      </div>

      {/* Quick filter chips */}
      <div className="flex gap-1.5 flex-wrap">
        {CHIPS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setChip(k)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition ${chip === k ? "bg-[#1a2e4a] text-white border-[#1a2e4a]" : "bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:border-gray-400"}`}>
            {label} ({chipCount(k, countMap)})
          </button>
        ))}
      </div>

      {/* Advanced filter drawer */}
      {showAdv && (
        <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div><label className={lbl}>Status</label>
              <select className={inp} value={fStatus} onChange={e => setFStatus(e.target.value)}>
                <option value="">Any</option>
                <optgroup label="Active">{ACTIVE_STATUS_DEFS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
                <optgroup label="Closed">{CLOSED_STATUS_DEFS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</optgroup>
              </select></div>
            <div><label className={lbl}>Source</label>
              <select className={inp} value={fSource} onChange={e => setFSource(e.target.value)}><option value="">Any</option>{SOURCES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lbl}>Position Applied</label>
              <select className={inp} value={fPosition} onChange={e => setFPosition(e.target.value)}><option value="">Any</option>{POSITIONS.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lbl}>Current Profile</label><input className={inp} value={fProfile} onChange={e => setFProfile(e.target.value)} placeholder="e.g. Sales" /></div>
            <div><label className={lbl}>Location</label><input className={inp} value={fLocation} onChange={e => setFLocation(e.target.value)} /></div>
            <div><label className={lbl}>City</label><input className={inp} value={fCity} onChange={e => setFCity(e.target.value)} placeholder="home city" /></div>
            <div><label className={lbl}>Email</label><input className={inp} value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="contains…" /></div>
            <div><label className={lbl}>Remarks / Notes</label><input className={inp} value={fRemarks} onChange={e => setFRemarks(e.target.value)} placeholder="contains…" /></div>
            <div><label className={lbl}>Owner</label>
              <select className={inp} value={fOwner} onChange={e => setFOwner(e.target.value)}><option value="">Any</option>{agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
            <div><label className={lbl}>Owner Name</label><input className={inp} value={fOwnerName} onChange={e => setFOwnerName(e.target.value)} placeholder="name contains…" /></div>
            <div><label className={lbl}>Notice Period</label>
              <select className={inp} value={fNotice} onChange={e => setFNotice(e.target.value)}><option value="">Any</option>{NOTICE.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><label className={lbl}>Confirmation Status</label>
              <select className={inp} value={fConfirm} onChange={e => setFConfirm(e.target.value)}><option value="">Any</option>{CONFIRM.map(s => <option key={s} value={s}>{fmtAct(s)}</option>)}</select></div>
            <div><label className={lbl}>Resume</label>
              <select className={inp} value={fResume} onChange={e => setFResume(e.target.value)}><option value="">Any</option><option value="yes">Uploaded</option><option value="no">Not uploaded</option></select></div>
            <div><label className={lbl}>Experience (yrs)</label><div className="flex gap-1"><input className={inp} value={expMin} onChange={e => setExpMin(e.target.value)} type="number" placeholder="min" /><input className={inp} value={expMax} onChange={e => setExpMax(e.target.value)} type="number" placeholder="max" /></div></div>
            <div><label className={lbl}>Current Salary</label><div className="flex gap-1"><input className={inp} value={curMin} onChange={e => setCurMin(e.target.value)} type="number" placeholder="min" /><input className={inp} value={curMax} onChange={e => setCurMax(e.target.value)} type="number" placeholder="max" /></div></div>
            <div><label className={lbl}>Expected Salary</label><div className="flex gap-1"><input className={inp} value={expSalMin} onChange={e => setExpSalMin(e.target.value)} type="number" placeholder="min" /><input className={inp} value={expSalMax} onChange={e => setExpSalMax(e.target.value)} type="number" placeholder="max" /></div></div>
            <div><label className={lbl}>Follow-Up From → To</label><div className="flex gap-1"><input className={inp} value={fuFrom} onChange={e => setFuFrom(e.target.value)} type="date" /><input className={inp} value={fuTo} onChange={e => setFuTo(e.target.value)} type="date" /></div></div>
            <div><label className={lbl}>Interview From → To</label><div className="flex gap-1"><input className={inp} value={ivFrom} onChange={e => setIvFrom(e.target.value)} type="date" /><input className={inp} value={ivTo} onChange={e => setIvTo(e.target.value)} type="date" /></div></div>
            <label className="flex items-center gap-2 text-xs text-gray-600 mt-5"><input type="checkbox" checked={fNoShow} onChange={e => setFNoShow(e.target.checked)} /> No-show only</label>
          </div>
          <div className="flex justify-end"><button type="button" onClick={resetAdv} className="text-xs text-gray-500 hover:text-gray-700 underline">Reset all</button></div>
        </div>
      )}

      {/* Bulk toolbar — only for users who can perform bulk actions. */}
      {selected.size > 0 && canBulk && (
        <div className="bg-[#1a2e4a] text-white rounded-xl px-3 py-2 text-sm space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{selected.size} selected</span>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} className="text-gray-800 rounded px-2 py-1 text-xs">
              <option value="">Set status…</option>
              {ACTIVE_STATUS_DEFS.concat(CLOSED_STATUS_DEFS).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {perms.assign && (
              <select value={bulkOwner} onChange={e => setBulkOwner(e.target.value)} className="text-gray-800 rounded px-2 py-1 text-xs">
                <option value="">Assign owner…</option>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            <label className="flex items-center gap-1 text-xs" title="Set a follow-up / call-back date for all selected">📅 <input type="date" value={bulkFollowUp} onChange={e => setBulkFollowUp(e.target.value)} className="text-gray-800 rounded px-2 py-1 text-xs" /></label>
            <button type="button" disabled={bulkBusy || (!bulkStatus && !bulkOwner && !bulkFollowUp)} onClick={applyBulk} className="px-3 py-1 rounded bg-white text-[#1a2e4a] text-xs font-semibold disabled:opacity-50">{bulkBusy ? "Applying…" : "Apply"}</button>
            {perms.deleteCandidate && <button type="button" disabled={bulkBusy} onClick={bulkDelete} className="px-3 py-1 rounded bg-red-600 text-white text-xs font-semibold disabled:opacity-50">🗑 Delete</button>}
            <button type="button" onClick={() => setSelected(new Set())} className="text-xs text-white/70 hover:text-white">Clear</button>
          </div>
          {bulkError && <div className="text-xs font-medium text-red-200 bg-red-900/40 rounded px-2 py-1">{bulkError}</div>}
        </div>
      )}
      {/* Bulk success confirmation — rendered OUTSIDE the toolbar (which unmounts once
          the selection clears) so the user sees the result of their Apply. */}
      {bulkSuccess && (
        <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 rounded-xl px-3 py-2">
          <CheckCircle2 className="w-4 h-4" /> {bulkSuccess}
        </div>
      )}
      <div className="text-xs text-gray-500">
        {filtered.length} candidate{filtered.length !== 1 ? "s" : ""}
        {anyAdv && <span className="text-amber-600 dark:text-amber-400"> (filtered{activeColCount > 0 ? ` · ${activeColCount} column${activeColCount === 1 ? "" : "s"}` : ""})</span>}
      </div>

      {/* Table view — sticky header + sticky first 3 columns, compact density */}
      {view === "table" && (
        <div className="hidden sm:block overflow-x-auto overflow-y-auto max-h-[72vh] rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="min-w-[900px] w-full text-xs border-separate border-spacing-0">
            <thead className="sticky top-0 z-20">
              <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide">
                <th className={`px-2 py-2 ${stickyHeadBg} sticky ${STICKY.sel} z-10 border-b border-gray-200 dark:border-slate-700`}>
                  {canBulk && <input type="checkbox" aria-label="Select all" checked={filtered.length > 0 && selected.size === filtered.length} onChange={toggleAll} />}
                </th>
                {visible("createdDate") && <th className={`px-2 py-2 whitespace-nowrap font-semibold ${stickyHeadBg} sticky ${STICKY.created} z-10 border-b border-r border-gray-100 dark:border-slate-700`}>{renderHeaderLabel("createdDate", "Created")}</th>}
                <th className={`px-2 py-2 whitespace-nowrap font-semibold ${stickyHeadBg} sticky ${STICKY.candidate} z-10 border-b border-gray-200 dark:border-slate-700`}>Candidate</th>
                {visible("phone") && <th className={`px-2 py-2 whitespace-nowrap font-semibold ${stickyHeadBg} sticky ${STICKY.phone} z-10 border-b border-r border-gray-200 dark:border-slate-700`}>{renderHeaderLabel("phone", "Phone")}</th>}
                {dynHeaders.map(col => {
                  const right = col.key === "currentSal" || col.key === "expectedSal" || col.key === "exp";
                  return renderTh(col.key as ColKey, col.label, `${stickyHeadBg} border-b border-gray-200 dark:border-slate-700`, right);
                })}
                <th className={`px-2 py-2 whitespace-nowrap font-semibold ${stickyHeadBg} border-b border-gray-200 dark:border-slate-700`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr><td colSpan={dynHeaders.length + 4} className="px-4 py-10 text-center text-gray-400 text-xs">No candidates match these filters.</td></tr>}
              {filtered.map(c => {
                const s = signals(c, now);
                const lastAct = c.activities[0];
                const sel = selected.has(c.id);
                return (
                  <tr key={c.id}
                    onClick={() => router.push(`/hr/candidates/${c.id}`)}
                    onMouseEnter={(e) => onRowEnter(e, c, s)}
                    onMouseLeave={onRowLeave}
                    className={`group cursor-pointer hover:bg-gray-50/80 dark:hover:bg-slate-800/50 transition ${sel ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}>
                    <td className={`px-2 py-1.5 sticky ${STICKY.sel} z-[5] ${sel ? "bg-amber-50/40 dark:bg-amber-900/10" : stickyBg} border-b border-gray-100 dark:border-slate-800`} onClick={stop}>
                      {canBulk && <input type="checkbox" aria-label="Select" checked={sel} onChange={() => toggleSel(c.id)} />}
                    </td>
                    {visible("createdDate") && <td className={`px-2 py-1.5 text-gray-500 whitespace-nowrap sticky ${STICKY.created} z-[5] ${sel ? "bg-amber-50/40 dark:bg-amber-900/10" : stickyBg} border-b border-r border-gray-100 dark:border-slate-800`}>{fmtDateFull(c.createdAt)}</td>}
                    <td className={`px-2 py-1.5 min-w-[120px] sticky ${STICKY.candidate} z-[5] ${sel ? "bg-amber-50/40 dark:bg-amber-900/10" : stickyBg} border-b border-gray-100 dark:border-slate-800`}>
                      <div className="flex items-center gap-1 flex-wrap">
                        <Link href={`/hr/candidates/${c.id}`} onClick={stop} className="font-semibold text-[#1a2e4a] dark:text-blue-400 hover:underline">{c.name}</Link>
                        <UnreadBadges c={c} />
                      </div>
                      {c.currentCompany && <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{c.currentCompany}</div>}
                    </td>
                    {visible("phone") && <td className={`px-2 py-1.5 text-gray-600 whitespace-nowrap sticky ${STICKY.phone} z-[5] ${sel ? "bg-amber-50/40 dark:bg-amber-900/10" : stickyBg} border-b border-r border-gray-100 dark:border-slate-800`}>{c.phone ? <a href={`tel:${c.phone}`} onClick={stop} className="hover:text-blue-600">{c.phone}</a> : "—"}</td>}
                    {visible("position") && <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap border-b border-gray-100 dark:border-slate-800">{c.positionApplied ?? "—"}</td>}
                    {visible("profile") && <td className="px-2 py-1.5 text-gray-600 max-w-[120px] truncate border-b border-gray-100 dark:border-slate-800">{c.currentProfile ?? "—"}</td>}
                    {visible("exp") && <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap text-right border-b border-gray-100 dark:border-slate-800">{c.experience ?? "—"}</td>}
                    {visible("currentSal") && <td className="px-2 py-1.5 text-gray-600 whitespace-nowrap text-right tabular-nums border-b border-gray-100 dark:border-slate-800">{fmtSal(c.currentSalary)}</td>}
                    {visible("expectedSal") && <td className="px-2 py-1.5 font-medium text-gray-800 dark:text-slate-200 whitespace-nowrap text-right tabular-nums border-b border-gray-100 dark:border-slate-800">{fmtSal(c.expectedSalary)}</td>}
                    {visible("status") && <td className="px-2 py-1.5 border-b border-gray-100 dark:border-slate-800"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${statusColor(c.status)}`}>{displayStatus(c)}</span></td>}
                    {visible("nextAction") && <td className="px-2 py-1.5 text-gray-600 max-w-[130px] border-b border-gray-100 dark:border-slate-800"><div className="truncate">{c.nextAction ?? "—"}</div></td>}
                    {visible("followUp") && <td className="px-2 py-1.5 whitespace-nowrap border-b border-gray-100 dark:border-slate-800">{s.nextFU ? <span className={s.fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>{s.fuOverdue ? "⚠ " : ""}{fmtDate(s.nextFU)}</span> : "—"}</td>}
                    {visible("interview") && <td className="px-2 py-1.5 whitespace-nowrap border-b border-gray-100 dark:border-slate-800">{s.nextIV ? <span className="text-indigo-600">🎯 {fmtDate(s.nextIV.scheduledAt)}</span> : "—"}</td>}
                    {visible("owner") && <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap border-b border-gray-100 dark:border-slate-800">{c.primaryOwner?.name?.split(" ")[0] ?? "—"}</td>}
                    {visible("lastActivity") && <td className="px-2 py-1.5 text-[11px] text-gray-500 whitespace-nowrap border-b border-gray-100 dark:border-slate-800">{lastAct ? <><div className="text-gray-700 dark:text-slate-300 font-medium">{friendlyAct(lastAct.type)}</div><div>{fmtDate(lastAct.createdAt)} · {fmtTimeIST(lastAct.createdAt)}</div>{lastAct.user?.name && <div className="text-gray-400">By {lastAct.user.name}</div>}</> : "—"}</td>}
                    <td className="px-2 py-1.5 border-b border-gray-100 dark:border-slate-800"><RowActions c={c} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Fixed hover preview card (desktop table only) */}
      {preview && view === "table" && (
        <div className="hidden sm:block fixed z-[60] pointer-events-none" style={{ top: preview.top, left: preview.left }}>
          <HRCandidateRowPreview data={preview.data} />
        </div>
      )}

      {/* Card view — always rendered; CSS toggles table (desktop) ↔ cards (mobile or cards mode) */}
      <div className={`${view === "cards" ? "grid" : "sm:hidden grid"} grid-cols-1 md:grid-cols-2 gap-2`}>
          {filtered.map(c => {
            const s = signals(c, now);
            return (
              <div key={c.id} className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-700 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    <Link href={`/hr/candidates/${c.id}`} className="font-semibold text-sm text-[#1a2e4a] dark:text-blue-400 hover:underline">{c.name}</Link>
                    <UnreadBadges c={c} />
                  </div>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${statusColor(c.status)}`}>{displayStatus(c)}</span>
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{[c.positionApplied, c.currentProfile, c.currentCompany].filter(Boolean).join(" · ") || "—"}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-gray-500">
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.source && <span>🏷 {c.source}</span>}
                  {c.noticePeriod && <span>⏳ {c.noticePeriod}</span>}
                  {c.expectedSalary && <span>Exp ₹ {fmtSal(c.expectedSalary)}</span>}
                  {s.nextFU && <span className={s.fuOverdue ? "text-red-600 font-semibold" : "text-amber-600"}>{s.fuOverdue ? "⚠ Overdue" : `📅 ${fmtDate(s.nextFU)}`}</span>}
                  {s.nextIV && <span className="text-indigo-600">🎯 {fmtDate(s.nextIV.scheduledAt)}</span>}
                  {c.primaryOwner?.name && <span>👤 {c.primaryOwner.name.split(" ")[0]}</span>}
                  <span>🕑 {fmtDateFull(c.createdAt)}</span>
                </div>
                {c.nextAction && <div className="text-[11px] text-gray-400 mt-1 truncate">⏭ {c.nextAction}</div>}
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-800"><RowActions c={c} /></div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center text-gray-400 text-sm py-8 col-span-full">No candidates match these filters.</div>}
      </div>

      {/* Save view dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" {...backdropProps(() => !savingView && setShowSaveDialog(false))}>
          <div className="bg-white dark:bg-slate-900 rounded-xl max-w-sm w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg text-gray-900 dark:text-white">Save current view</div>
              <button type="button" onClick={() => setShowSaveDialog(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">Snapshots the active filters, search, column filters and visible columns.</p>
            <label className="text-xs font-semibold text-gray-600 dark:text-slate-300">Name</label>
            <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="e.g. Sales — Immediate Joiners" className="w-full mt-1 mb-3 border border-gray-200 dark:border-slate-600 dark:bg-slate-800 rounded-lg px-3 py-2 text-sm" autoFocus />
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300 mb-4">
              <input type="checkbox" checked={saveShared} onChange={e => setSaveShared(e.target.checked)} />
              Share with the whole HR team
            </label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowSaveDialog(false)} disabled={savingView} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
              <button type="button" onClick={saveView} disabled={savingView || !saveName.trim()} className="px-4 py-1.5 rounded-lg bg-[#1a2e4a] text-white text-sm font-semibold disabled:opacity-50">{savingView ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
