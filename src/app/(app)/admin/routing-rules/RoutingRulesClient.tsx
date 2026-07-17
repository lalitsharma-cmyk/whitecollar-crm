"use client";
// Lead Routing Scheduler — admin client UI (rules table + create/edit modal +
// history drawer + the global Pause Automatic Assignment override).
// Server guard lives in page.tsx; every API this calls re-checks ADMIN.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { backdropProps, useDismiss } from "@/lib/useDismiss";
import {
  fmtIST12,
  fmtISTDate,
  fmtIST,
  istDateKey,
  toISTLocalInput,
  fromISTLocalInput,
} from "@/lib/datetime";
import { allowedSourceOptions, sourceLabel } from "@/lib/lead-sources";
import { ActionButton } from "@/components/actions/ActionButton";
import {
  BUDGET_OPS,
  BUDGET_OP_LABELS,
  NUMERIC_BUDGET_OPS,
  currencyForTeam,
  budgetConditionLabel,
  type BudgetOp,
  type BudgetCondition,
} from "@/lib/budgetRouting";
import { formatBudget } from "@/lib/budgetParse";

// ── Keep in sync with src/lib/leadRouting.ts (server-only, not importable here) ──
const MODULE_OPTIONS = [
  { value: "lead-intake", label: "Website + API intake" },
  { value: "master-convert", label: "Master Data converts" },
  { value: "buyer-convert", label: "Buyer converts" },
  { value: "revival-promote", label: "Revival promotions" },
  { value: "import", label: "Imports" },
] as const;
const STRATEGY_LABELS: Record<string, string> = {
  single: "Single",
  round_robin: "Round Robin",
  weighted: "Weighted %",
};

type Scope = {
  all?: boolean;
  modules?: string[];
  teams?: string[];
  markets?: string[];
  sources?: string[];
  projects?: string[];
  countries?: string[];
  budget?: BudgetCondition; // { op, min?, max? } — currency implied by the single team
};
type Recipient = { userId: string; weight?: number; assigned?: number };
export type RuleRow = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  startsAt: string;
  endsAt: string | null;
  scope: Scope;
  recipients: Recipient[];
  strategy: string;
  assignedCount: number;
  disabledAt: string | null;
  createdAt: string;
  createdByName: string | null;
  deleted: boolean;
  status: "Active" | "Scheduled" | "Expired" | "Disabled" | "Deleted";
};
type UserOpt = { id: string; name: string; team: string; role: string };
type ProjectOpt = { name: string; country: string };

type VersionRow = {
  id: string;
  action: string;
  snapshot: Record<string, unknown>;
  changedByName: string;
  changedAt: string;
};

// ── IST window preset helpers (all math on IST calendar days) ────────────────
const DAY = 86400000;
const dayStart = (key: string) => new Date(`${key}T00:00:00+05:30`);
const addDaysKey = (key: string, n: number) => istDateKey(new Date(dayStart(key).getTime() + n * DAY));
const weekdayOf = (key: string) => dayStart(key).getUTCDay(); // 0=Sun … 6=Sat
const monthStartKey = (key: string) => `${key.slice(0, 7)}-01`;
function nextMonthStartKey(key: string): string {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
/** Monday of the IST week containing `key`. */
function mondayKey(key: string): string {
  const wd = weekdayOf(key); // Sun=0
  const back = wd === 0 ? 6 : wd - 1;
  return addDaysKey(key, -back);
}

const PRESETS = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This Week (Mon–Sun)" },
  { value: "next_week", label: "Next Week (Mon–Sun)" },
  { value: "this_month", label: "This Month" },
  { value: "next_month", label: "Next Month" },
  { value: "custom", label: "Custom range" },
  { value: "permanent", label: "Permanent (until disabled)" },
] as const;
type PresetKey = (typeof PRESETS)[number]["value"];

/** [startsLocal, endsLocal, permanent] as IST datetime-local strings. */
function presetWindow(preset: PresetKey): { starts: string; ends: string; permanent: boolean } {
  const today = istDateKey();
  const local = (key: string) => `${key}T00:00`;
  switch (preset) {
    case "today":      return { starts: local(today), ends: local(addDaysKey(today, 1)), permanent: false };
    case "tomorrow":   return { starts: local(addDaysKey(today, 1)), ends: local(addDaysKey(today, 2)), permanent: false };
    case "this_week": { const mon = mondayKey(today); return { starts: local(mon), ends: local(addDaysKey(mon, 7)), permanent: false }; }
    case "next_week": { const mon = addDaysKey(mondayKey(today), 7); return { starts: local(mon), ends: local(addDaysKey(mon, 7)), permanent: false }; }
    case "this_month": return { starts: local(monthStartKey(today)), ends: local(nextMonthStartKey(today)), permanent: false };
    case "next_month": { const n = nextMonthStartKey(today); return { starts: local(n), ends: local(nextMonthStartKey(n)), permanent: false }; }
    case "permanent":  return { starts: toISTLocalInput(new Date()), ends: "", permanent: true };
    default:           return { starts: toISTLocalInput(new Date()), ends: "", permanent: false };
  }
}

/** Human window label: whole-IST-day spans render as dates, else full datetimes. */
function windowLabel(startsAt: string, endsAt: string | null): string {
  const s = new Date(startsAt);
  if (!endsAt) return `From ${fmtISTDate(s)} — permanent`;
  const e = new Date(endsAt);
  const midnight = (d: Date) => toISTLocalInput(d).endsWith("T00:00");
  if (midnight(s) && midnight(e)) {
    const lastDay = new Date(e.getTime() - 1);
    const sd = fmtISTDate(s);
    const ed = fmtISTDate(lastDay);
    return sd === ed ? sd : `${sd} – ${ed}`;
  }
  return `${fmtIST12(s)} → ${fmtIST12(e)}`;
}

// ── Budget-condition UI helpers (spec §10) ───────────────────────────────────
// Amount unit selector — the admin types a natural number + picks a unit; the
// value POSTED in scope.budget.min/max is always the NORMALIZED absolute number.
type BudgetUnit = "abs" | "lakh" | "cr" | "k" | "m";
const UNIT_MULT: Record<BudgetUnit, number> = {
  abs: 1,
  lakh: 100_000,
  cr: 10_000_000,
  k: 1_000,
  m: 1_000_000,
};
const INR_UNITS: { value: BudgetUnit; label: string }[] = [
  { value: "abs", label: "₹ (absolute)" },
  { value: "lakh", label: "Lakh" },
  { value: "cr", label: "Cr (crore)" },
];
const AED_UNITS: { value: BudgetUnit; label: string }[] = [
  { value: "abs", label: "AED (absolute)" },
  { value: "k", label: "Thousand (K)" },
  { value: "m", label: "Million (M)" },
];
function unitsFor(ccy: "INR" | "AED" | null) {
  return ccy === "AED" ? AED_UNITS : INR_UNITS;
}
function defaultUnit(ccy: "INR" | "AED" | null): BudgetUnit {
  return ccy === "AED" ? "m" : "cr";
}
/** A budget-amount condition needs an unambiguous currency, so it is only allowed
 *  when EXACTLY one team is selected (India → INR, Dubai → AED). */
function budgetCcyOf(teams: string[] | undefined): "INR" | "AED" | null {
  return teams && teams.length === 1 ? currencyForTeam(teams[0]) : null;
}
function isNumericOp(op: BudgetOp | "none"): boolean {
  return op !== "none" && (NUMERIC_BUDGET_OPS as string[]).includes(op);
}
/** Trim float noise: 1.5000001 → "1.5", 5 → "5". */
function trimNum(n: number): string {
  if (!isFinite(n)) return "";
  return String(Number(n.toFixed(4)));
}
/** Absolute number → the friendliest {amount, unit} for the currency — the inverse
 *  of normalizeAmt, used to hydrate the edit modal from a stored value. */
function friendlyUnit(n: number, ccy: "INR" | "AED" | null): { amt: string; unit: BudgetUnit } {
  if (ccy === "AED") {
    if (n >= 1_000_000) return { amt: trimNum(n / 1_000_000), unit: "m" };
    if (n >= 1_000) return { amt: trimNum(n / 1_000), unit: "k" };
    return { amt: trimNum(n), unit: "abs" };
  }
  if (n >= 10_000_000) return { amt: trimNum(n / 10_000_000), unit: "cr" };
  if (n >= 100_000) return { amt: trimNum(n / 100_000), unit: "lakh" };
  return { amt: trimNum(n), unit: "abs" };
}
/** {amount string, unit} → the normalized absolute number to POST, or null if blank/invalid. */
function normalizeAmt(amt: string, unit: BudgetUnit): number | null {
  const raw = amt.trim();
  if (!raw) return null;
  const n = Number(raw);
  if (!isFinite(n) || n < 0) return null;
  return Math.round(n * UNIT_MULT[unit]);
}
/** Currency-marked money for previews / summaries: ₹5 Cr (India) / 2M AED (Dubai,
 *  already self-marked by formatBudget). */
function fmtMoney(n: number, ccy: "INR" | "AED" | null): string {
  const c: "INR" | "AED" = ccy ?? "INR";
  const s = formatBudget(n, c);
  return c === "INR" ? `₹${s}` : s;
}

function scopeSummary(scope: Scope): string {
  const bits: string[] = [];
  if (scope.all) {
    bits.push("All leads");
  } else {
    if (scope.modules?.length) {
      bits.push(scope.modules.map((m) => MODULE_OPTIONS.find((o) => o.value === m)?.label ?? m).join(" + "));
    }
    if (scope.teams?.length) bits.push(scope.teams.join(" + "));
    if (scope.sources?.length) bits.push(`Sources: ${scope.sources.map(sourceLabel).join(", ")}`);
    if (scope.projects?.length) bits.push(scope.projects.length <= 2 ? `Projects: ${scope.projects.join(", ")}` : `${scope.projects.length} projects`);
    if (scope.countries?.length) bits.push(`Countries: ${scope.countries.join(", ")}`);
  }
  // Budget is enforced even under all:true — always show it when present.
  if (scope.budget) {
    const ccy = budgetCcyOf(scope.teams);
    const lbl = budgetConditionLabel(scope.budget, (n) => fmtMoney(n, ccy));
    if (lbl) bits.push(lbl);
  }
  return bits.length ? bits.join(" · ") : "All leads";
}

const STATUS_CHIP: Record<RuleRow["status"], string> = {
  Active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Scheduled: "bg-blue-100 text-blue-700 border-blue-200",
  Expired: "bg-gray-100 text-gray-500 border-gray-300",
  Disabled: "bg-amber-100 text-amber-800 border-amber-200",
  Deleted: "bg-rose-100 text-rose-700 border-rose-200",
};

// ── Draft (modal) state ──────────────────────────────────────────────────────
type DraftRecipient = { userId: string; weight: string };
type Draft = {
  id: string | null;
  name: string;
  priority: string;
  prioTouched: boolean;
  preset: PresetKey;
  startsLocal: string;
  endsLocal: string;
  permanent: boolean;
  mode: "single" | "round_robin" | "weighted";
  recipients: DraftRecipient[];
  modules: string[];
  teams: string[];
  sources: string[];
  projects: string[];
  countries: string;
  // Budget condition (spec §10). "none" = no condition. Amounts are raw values in
  // the chosen unit; saveDraft normalizes them to absolute numbers before POSTing.
  budgetOp: BudgetOp | "none";
  budgetMinAmt: string;
  budgetMinUnit: BudgetUnit;
  budgetMaxAmt: string;
  budgetMaxUnit: BudgetUnit;
};

function emptyDraft(): Draft {
  const w = presetWindow("today");
  return {
    id: null, name: "", priority: "10", prioTouched: false,
    preset: "today", startsLocal: w.starts, endsLocal: w.ends, permanent: false,
    mode: "round_robin", recipients: [],
    modules: ["lead-intake"], teams: [], sources: [], projects: [], countries: "",
    budgetOp: "none", budgetMinAmt: "", budgetMinUnit: "cr", budgetMaxAmt: "", budgetMaxUnit: "cr",
  };
}

function draftFromRule(r: RuleRow): Draft {
  // Hydrate the budget section from scope.budget, converting the stored absolute
  // number back to a friendly unit in the rule's (single-team) currency.
  const teams = r.scope.teams ?? [];
  const ccy = budgetCcyOf(teams);
  const b = r.scope.budget;
  const minF = b?.min != null ? friendlyUnit(b.min, ccy) : null;
  const maxF = b?.max != null ? friendlyUnit(b.max, ccy) : null;
  return {
    id: r.id,
    name: r.name,
    priority: String(r.priority),
    prioTouched: true,
    preset: "custom",
    startsLocal: toISTLocalInput(new Date(r.startsAt)),
    endsLocal: r.endsAt ? toISTLocalInput(new Date(r.endsAt)) : "",
    permanent: !r.endsAt,
    mode: (r.strategy === "single" || r.strategy === "weighted" ? r.strategy : "round_robin") as Draft["mode"],
    recipients: r.recipients.map((x) => ({ userId: x.userId, weight: x.weight != null ? String(x.weight) : "" })),
    modules: r.scope.modules ?? [],
    teams,
    sources: r.scope.sources ?? [],
    projects: r.scope.projects ?? [],
    countries: (r.scope.countries ?? []).join(", "),
    budgetOp: b?.op ?? "none",
    budgetMinAmt: minF?.amt ?? "",
    budgetMinUnit: minF?.unit ?? defaultUnit(ccy),
    budgetMaxAmt: maxF?.amt ?? "",
    budgetMaxUnit: maxF?.unit ?? defaultUnit(ccy),
  };
}

/** Keep the amount units valid for the currently-selected team's currency. When
 *  the team (hence currency) changes, a unit that no longer belongs to that
 *  currency (e.g. "cr" after switching to Dubai) is reset to the currency default.
 *  The operator itself is never auto-cleared — saveDraft validates numeric-op ↔
 *  single-team, and the operator dropdown disables numeric ops without a team. */
function reconcileBudget(d: Draft): Draft {
  const ccy = budgetCcyOf(d.teams);
  const valid = new Set(unitsFor(ccy).map((u) => u.value));
  const budgetMinUnit = valid.has(d.budgetMinUnit) ? d.budgetMinUnit : defaultUnit(ccy);
  const budgetMaxUnit = valid.has(d.budgetMaxUnit) ? d.budgetMaxUnit : defaultUnit(ccy);
  if (budgetMinUnit === d.budgetMinUnit && budgetMaxUnit === d.budgetMaxUnit) return d;
  return { ...d, budgetMinUnit, budgetMaxUnit };
}

/** Suggested priority encoding Lalit's Date > Source > Team > Default ladder. */
function suggestedPriority(d: Draft): number {
  if (!d.permanent) return 10;         // date-window rule
  if (d.sources.length > 0) return 50; // source rule
  if (d.teams.length > 0) return 90;   // team rule
  return 100;
}

export default function RoutingRulesClient({
  rules,
  users,
  projects,
  pausedInitial,
}: {
  rules: RuleRow[];
  users: UserOpt[];
  projects: ProjectOpt[];
  pausedInitial: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [paused, setPaused] = useState(pausedInitial);
  const [pauseConfirm, setPauseConfirm] = useState(false);
  const [pauseAck, setPauseAck] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ ruleName: string; versions: VersionRow[] } | null>(null);
  // ── "Apply rule to existing matching leads" (spec §9) ──
  type ApplyPreview = {
    count: number;
    distribution: { ownerId: string | null; ownerName: string; count: number }[];
    recipientName: string;
    ruleName: string;
    live: boolean;
    exceedsLimit: boolean;
    maxApply: number;
  };
  const [applyId, setApplyId] = useState<string | null>(null);
  const [applyState, setApplyState] = useState<"loading" | "ready" | "unavailable" | "error" | "done">("loading");
  const [applyPreview, setApplyPreview] = useState<ApplyPreview | null>(null);
  const [applyAck, setApplyAck] = useState(false);
  const [applyErr, setApplyErr] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ reassigned: number; skipped: number } | null>(null);

  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name] as const)), [users]);
  const visible = rules.filter((r) => showDeleted || !r.deleted);
  const sourceOpts = useMemo(() => allowedSourceOptions(), []);

  const historyRef = useDismiss<HTMLDivElement>(historyId != null, () => setHistoryId(null));

  async function api(path: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    if (busy) return null;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(path, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) { setMsg(String(j.error ?? `Failed (${r.status})`)); return null; }
      return j;
    } catch (e) {
      setMsg(`Network error: ${String(e).slice(0, 80)}`);
      return null;
    } finally { setBusy(false); }
  }

  async function togglePause(next: boolean) {
    const j = await api("/api/admin/routing-rules/pause", next ? "POST" : "DELETE");
    if (j) { setPaused(next); setPauseConfirm(false); setPauseAck(false); router.refresh(); }
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) { setMsg("Rule name is required."); return; }
    if (draft.recipients.length === 0) { setMsg("Pick at least one recipient."); return; }
    if (draft.mode === "single" && draft.recipients.length !== 1) { setMsg("Single strategy takes exactly one recipient."); return; }
    const starts = fromISTLocalInput(draft.startsLocal);
    if (!starts) { setMsg("Start of window is required."); return; }
    let ends: Date | null = null;
    if (!draft.permanent) {
      ends = fromISTLocalInput(draft.endsLocal);
      if (!ends) { setMsg("End of window is required (or mark the rule Permanent)."); return; }
      if (ends.getTime() <= starts.getTime()) { setMsg("End of window must be after its start."); return; }
    }
    let recipients: { userId: string; weight?: number }[];
    if (draft.mode === "weighted") {
      recipients = [];
      let sum = 0;
      for (const r of draft.recipients) {
        const w = Number(r.weight);
        if (!isFinite(w) || w <= 0) { setMsg(`Give ${nameOf.get(r.userId) ?? "every recipient"} a % weight.`); return; }
        sum += w;
        recipients.push({ userId: r.userId, weight: w });
      }
      if (Math.abs(sum - 100) > 0.01) { setMsg(`Weights must sum to 100% (currently ${sum}%).`); return; }
    } else {
      recipients = draft.recipients.map((r) => ({ userId: r.userId }));
    }
    // Budget condition (spec §10). Omit entirely when op is "none". Numeric ops
    // need exactly one team (currency must be unambiguous) — mirrors the server
    // validator so we fail here with a friendly message instead of a 400.
    let budget: { op: BudgetOp; min?: number; max?: number } | undefined;
    if (draft.budgetOp !== "none") {
      const op = draft.budgetOp;
      if (isNumericOp(op)) {
        const ccy = budgetCcyOf(draft.teams);
        if (!ccy) { setMsg("Select exactly one team (India or Dubai) to route by a budget amount, or pick a presence check."); return; }
        const min = normalizeAmt(draft.budgetMinAmt, draft.budgetMinUnit);
        if (min == null) { setMsg("Enter a valid budget amount for the budget condition."); return; }
        if (op === "between") {
          const max = normalizeAmt(draft.budgetMaxAmt, draft.budgetMaxUnit);
          if (max == null) { setMsg("Enter both a Minimum and a Maximum for a Between budget rule."); return; }
          if (max < min) { setMsg("Budget Maximum must be greater than or equal to Minimum."); return; }
          budget = { op, min, max };
        } else {
          budget = { op, min };
        }
      } else {
        budget = { op }; // presence op (blank / invalid / available) — no currency, no amount
      }
    }
    const payload = {
      name: draft.name.trim(),
      priority: Number(draft.priority) || suggestedPriority(draft),
      startsAt: starts.toISOString(),
      endsAt: ends ? ends.toISOString() : null,
      strategy: draft.mode,
      recipients,
      scope: {
        ...(draft.modules.length ? { modules: draft.modules } : {}),
        ...(draft.teams.length ? { teams: draft.teams } : {}),
        ...(draft.sources.length ? { sources: draft.sources } : {}),
        ...(draft.projects.length ? { projects: draft.projects } : {}),
        ...(draft.countries.trim()
          ? { countries: draft.countries.split(",").map((s) => s.trim()).filter(Boolean) }
          : {}),
        ...(budget ? { budget } : {}),
      },
    };
    const j = draft.id
      ? await api(`/api/admin/routing-rules/${draft.id}`, "PATCH", payload)
      : await api("/api/admin/routing-rules", "POST", payload);
    if (j) { setDraft(null); router.refresh(); }
  }

  async function openHistory(id: string) {
    setHistoryId(id); setHistory(null);
    const j = await api(`/api/admin/routing-rules/${id}/versions`, "GET");
    if (j) setHistory({ ruleName: String(j.ruleName ?? ""), versions: (j.versions as VersionRow[]) ?? [] });
    else setHistoryId(null);
  }

  const closeApply = () => {
    setApplyId(null); setApplyState("loading"); setApplyPreview(null);
    setApplyAck(false); setApplyErr(null); setApplyResult(null);
  };

  // GET the preview (read-only). A 404 (or any network failure) means the service
  // isn't deployed yet — fail gracefully, never crash the panel.
  async function openApply(id: string) {
    setApplyId(id); setApplyState("loading"); setApplyPreview(null);
    setApplyAck(false); setApplyErr(null); setApplyResult(null);
    try {
      const r = await fetch(`/api/admin/routing-rules/${id}/apply-existing`, { method: "GET" });
      if (r.status === 404) { setApplyState("unavailable"); return; }
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) { setApplyErr(String(j.error ?? `Failed (${r.status})`)); setApplyState("error"); return; }
      setApplyPreview({
        count: Number(j.count ?? 0),
        distribution: Array.isArray(j.distribution)
          ? (j.distribution as { ownerId: string | null; ownerName: string; count: number }[])
          : [],
        recipientName: String(j.recipientName ?? ""),
        ruleName: String(j.ruleName ?? ""),
        live: j.live !== false,
        exceedsLimit: j.exceedsLimit === true,
        maxApply: Number(j.maxApply ?? 2000),
      });
      setApplyState("ready");
    } catch {
      setApplyState("unavailable");
    }
  }

  async function confirmApply() {
    if (!applyId) return;
    setApplyState("loading"); setApplyErr(null);
    try {
      const r = await fetch(`/api/admin/routing-rules/${applyId}/apply-existing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (r.status === 404) { setApplyState("unavailable"); return; }
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) { setApplyErr(String(j.error ?? `Failed (${r.status})`)); setApplyState("error"); return; }
      setApplyResult({ reassigned: Number(j.reassigned ?? 0), skipped: Number(j.skipped ?? 0) });
      setApplyState("done");
      router.refresh();
    } catch {
      setApplyErr("Network error while applying the rule."); setApplyState("error");
    }
  }

  const input = "px-2 py-1.5 text-sm border border-gray-200 dark:border-slate-600 rounded-lg dark:bg-slate-700 w-full";
  const label = "text-xs font-semibold text-gray-600 dark:text-slate-300";

  // ── Draft field updaters ──
  const upd = (patch: Partial<Draft>) =>
    setDraft((d) => {
      if (!d) return d;
      let next = { ...d, ...patch };
      if (!next.prioTouched) next.priority = String(suggestedPriority(next));
      next = reconcileBudget(next);
      return next;
    });
  const toggleIn = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  function addRecipient(userId: string) {
    if (!draft || !userId) return;
    if (draft.mode === "single") { upd({ recipients: [{ userId, weight: "" }] }); return; }
    if (draft.recipients.some((r) => r.userId === userId)) return;
    upd({ recipients: [...draft.recipients, { userId, weight: "" }] });
  }
  function addTeam(team: string) {
    if (!draft) return;
    const ids = users.filter((u) => u.team === team).map((u) => u.id);
    const merged = [...draft.recipients];
    for (const id of ids) if (!merged.some((r) => r.userId === id)) merged.push({ userId: id, weight: "" });
    upd({ recipients: merged, mode: draft.mode === "single" ? "round_robin" : draft.mode });
  }

  const weightSum = draft?.mode === "weighted"
    ? draft.recipients.reduce((s, r) => s + (Number(r.weight) || 0), 0)
    : null;

  // Currency for the budget section is driven by the (single) selected team.
  const budgetCcy = budgetCcyOf(draft?.teams);

  // One number-input + unit-select + live normalized preview.
  function amountField(
    labelText: string,
    amt: string,
    unit: BudgetUnit,
    onAmt: (v: string) => void,
    onUnit: (u: BudgetUnit) => void,
    ccy: "INR" | "AED",
  ) {
    const norm = normalizeAmt(amt, unit);
    return (
      <div>
        <div className={label}>{labelText}</div>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="number" min={0} step="any" value={amt} onChange={(e) => onAmt(e.target.value)}
            placeholder="0" className={`${input} max-w-[7rem]`} />
          <select value={unit} onChange={(e) => onUnit(e.target.value as BudgetUnit)} className={`${input} max-w-[11rem]`}>
            {unitsFor(ccy).map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
          <span className="text-xs font-semibold text-gray-500 dark:text-slate-400 whitespace-nowrap">
            = {norm != null ? fmtMoney(norm, ccy) : "—"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ── Persistent red banner while routing is paused ── */}
      {paused && (
        <div className="card p-3 border-l-4 border-rose-600 bg-rose-50 dark:bg-rose-950/40">
          <div className="text-sm font-bold text-rose-800 dark:text-rose-200">⏸ Automatic assignment is PAUSED</div>
          <div className="text-xs text-rose-700 dark:text-rose-300 mt-0.5">
            Every new lead stays <b>unassigned</b> until you distribute it manually or resume automatic assignment.
            Routing rules and the default team rule are all suspended. Manual assignment still works normally.
          </div>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton action="assign" label="＋ New rule" title="Create a routing rule" onClick={() => { setMsg(null); setDraft(emptyDraft()); }} />
        <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-slate-400 ml-1">
          <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          Show deleted
        </label>
        <div className="flex-1" />
        {paused ? (
          <ActionButton action="complete" label="Resume Automatic Assignment" title="Resume automatic assignment" loading={busy} onClick={() => togglePause(false)} />
        ) : (
          <ActionButton action="snooze" label="⏸ Pause Automatic Assignment" title="Emergency: stop ALL automatic assignment" onClick={() => { setPauseAck(false); setPauseConfirm(true); }} />
        )}
      </div>

      {msg && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">{msg}</div>}

      {/* ── Rules table ── */}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
              <th className="px-3 py-2 font-semibold">Rule</th>
              <th className="px-3 py-2 font-semibold">Window (IST)</th>
              <th className="px-3 py-2 font-semibold hidden md:table-cell">Applies to</th>
              <th className="px-3 py-2 font-semibold">Recipients</th>
              <th className="px-3 py-2 font-semibold hidden sm:table-cell">Priority</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold text-right">Leads</th>
              <th className="px-3 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-gray-400">
                No routing rules yet. With zero rules the CRM keeps its default assignment
                (Dubai → Lalit · Tuesday-IST India → Yasir · else Tanuj). Create a rule to override it for a date window.
              </td></tr>
            )}
            {visible.map((r) => {
              const names = r.recipients.map((x) => nameOf.get(x.userId) ?? "Unknown");
              const nameStr = names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
              return (
                <tr key={r.id} className={`border-b border-[#f1f5f9] dark:border-slate-700 align-top ${r.deleted || r.status === "Disabled" || r.status === "Expired" ? "opacity-60" : ""}`}>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-[11px] text-gray-400">by {r.createdByName ?? "—"} · {fmtISTDate(new Date(r.createdAt))}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">{windowLabel(r.startsAt, r.endsAt)}</td>
                  <td className="px-3 py-2 text-xs hidden md:table-cell max-w-[220px]">{scopeSummary(r.scope)}</td>
                  <td className="px-3 py-2 text-xs">
                    <div>{nameStr || "—"}</div>
                    <div className="text-[11px] text-gray-400">{STRATEGY_LABELS[r.strategy] ?? r.strategy}{r.strategy === "weighted" ? ` (${r.recipients.map((x) => `${x.weight ?? 0}%`).join("/")})` : ""}</div>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">{r.priority}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${STATUS_CHIP[r.status]}`}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">{r.assignedCount}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {!r.deleted && (
                      <>
                        {r.status === "Disabled" ? (
                          <button disabled={busy} onClick={async () => { if (await api(`/api/admin/routing-rules/${r.id}/enable`, "POST")) router.refresh(); }} className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold px-1.5" title="Enable this rule">Enable</button>
                        ) : (
                          <button disabled={busy} onClick={async () => { if (await api(`/api/admin/routing-rules/${r.id}/disable`, "POST")) router.refresh(); }} className="text-xs text-amber-700 dark:text-amber-400 font-semibold px-1.5" title="Disable without deleting">Disable</button>
                        )}
                        <button disabled={busy} onClick={() => { setMsg(null); setDraft(draftFromRule(r)); }} className="text-xs text-gray-500 hover:text-[#0b1a33] dark:hover:text-blue-300 px-1.5" title="Edit rule">✎ Edit</button>
                        <button onClick={() => openApply(r.id)} className="text-xs text-blue-600 dark:text-blue-400 font-semibold px-1.5" title="Apply this rule to existing matching leads">📥 Apply</button>
                      </>
                    )}
                    <button disabled={busy} onClick={() => openHistory(r.id)} className="text-xs text-gray-500 hover:text-[#0b1a33] dark:hover:text-blue-300 px-1.5" title="Change history">🕘 History</button>
                    {!r.deleted && (
                      <button disabled={busy} onClick={() => setDeleteId(r.id)} className="text-xs text-rose-600 dark:text-rose-400 px-1.5" title="Soft-delete (history preserved)">Delete</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 dark:text-slate-500">
        Lower priority runs first when several rules match. Suggested numbers keep Lalit&apos;s order —
        date-window rules <b>10</b> · source rules <b>50</b> · team rules <b>90</b> (default team rule = the fallback when nothing matches).
        Rules never touch manually assigned leads. Recipients on leave are skipped automatically.
      </p>

      {/* ── Create / Edit modal ── */}
      {draft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-y-auto p-3 sm:p-6" {...backdropProps(() => setDraft(null))}>
          <div className="card w-full max-w-2xl p-4 sm:p-5 space-y-4 my-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">{draft.id ? "Edit routing rule" : "New routing rule"}</h2>
              <button onClick={() => setDraft(null)} className="btn btn-ghost text-sm">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className={`${label} sm:col-span-2`}>Rule name *
                <input autoFocus value={draft.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Diwali week — India to Yasir & Tanuj" className={input} />
              </label>
              <label className={label}>Priority
                <input type="number" min={1} max={9999} value={draft.priority}
                  onChange={(e) => setDraft((d) => d ? { ...d, priority: e.target.value, prioTouched: true } : d)} className={input} />
                <span className="font-normal text-[11px] text-gray-400 block mt-0.5">Lower runs first · date 10, source 50, team 90</span>
              </label>
            </div>

            {/* Window */}
            <div className="space-y-2">
              <div className={label}>When does this rule apply? (IST)</div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.value} type="button"
                    onClick={() => { const w = presetWindow(p.value); upd({ preset: p.value, startsLocal: w.starts, endsLocal: w.ends, permanent: w.permanent }); }}
                    className={`text-xs px-2.5 py-1 rounded-full border ${draft.preset === p.value ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={label}>Starts
                  <input type="datetime-local" value={draft.startsLocal} onChange={(e) => upd({ startsLocal: e.target.value, preset: "custom" })} className={input} />
                </label>
                <label className={label}>Ends {draft.permanent && <span className="font-normal text-gray-400">(permanent)</span>}
                  <input type="datetime-local" value={draft.endsLocal} disabled={draft.permanent}
                    onChange={(e) => upd({ endsLocal: e.target.value, preset: "custom" })} className={`${input} disabled:opacity-50`} />
                  <span className="font-normal text-[11px] text-gray-400 flex items-center gap-1 mt-0.5">
                    <input type="checkbox" checked={draft.permanent} onChange={(e) => upd({ permanent: e.target.checked, preset: "custom", ...(e.target.checked ? { endsLocal: "" } : {}) })} />
                    No end date — runs until disabled
                  </span>
                </label>
              </div>
            </div>

            {/* Scope */}
            <div className="space-y-2">
              <div className={label}>Which leads? <span className="font-normal text-gray-400">(leave a group empty = all)</span></div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {MODULE_OPTIONS.map((m) => (
                  <label key={m.value} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={draft.modules.includes(m.value)} onChange={() => upd({ modules: toggleIn(draft.modules, m.value) })} />
                    {m.label}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-[11px] text-gray-400 w-14">Teams</span>
                {["India", "Dubai"].map((t) => (
                  <label key={t} className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={draft.teams.includes(t)} onChange={() => upd({ teams: toggleIn(draft.teams, t) })} />
                    {t === "India" ? "🇮🇳 India" : "🇦🇪 Dubai"}
                  </label>
                ))}
              </div>
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-slate-400">Sources {draft.sources.length > 0 && <b>({draft.sources.length} selected)</b>}</summary>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 pl-1">
                  {sourceOpts.map((s) => (
                    <label key={s.value} className="flex items-center gap-1.5">
                      <input type="checkbox" checked={draft.sources.includes(s.value)} onChange={() => upd({ sources: toggleIn(draft.sources, s.value) })} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </details>
              <details className="text-xs">
                <summary className="cursor-pointer text-gray-500 dark:text-slate-400">Projects {draft.projects.length > 0 && <b>({draft.projects.length} selected)</b>}</summary>
                <div className="mt-1.5 pl-1 space-y-1.5">
                  <select value="" onChange={(e) => { if (e.target.value) upd({ projects: toggleIn(draft.projects, e.target.value) }); }} className={input}>
                    <option value="">＋ Add a project…</option>
                    {projects.filter((p) => !draft.projects.includes(p.name)).map((p) => (
                      <option key={p.name} value={p.name}>{p.name} ({p.country})</option>
                    ))}
                  </select>
                  {draft.projects.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {draft.projects.map((p) => (
                        <span key={p} className="px-2 py-0.5 rounded-full border border-gray-200 dark:border-slate-600 flex items-center gap-1">
                          {p}<button type="button" onClick={() => upd({ projects: draft.projects.filter((x) => x !== p) })} className="text-gray-400 hover:text-rose-600">✕</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </details>
              <label className={`${label} block`}>Countries <span className="font-normal text-gray-400">(optional, comma-separated)</span>
                <input value={draft.countries} onChange={(e) => upd({ countries: e.target.value })} placeholder="e.g. India, UAE" className={input} />
              </label>
            </div>

            {/* Budget condition (spec §10) */}
            <div className="space-y-2">
              <div className={label}>Budget condition <span className="font-normal text-gray-400">(optional)</span></div>
              <div className="text-[11px] text-gray-400">
                {budgetCcy
                  ? `Route by the lead's budget. Amounts are in ${budgetCcy === "INR" ? "₹ INR (India team)" : "AED (Dubai team)"}.`
                  : "Select a single team above (India or Dubai) to route by a budget amount. Presence checks (blank / invalid / available) work without a team."}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className={label}>Operator
                  <select value={draft.budgetOp} onChange={(e) => upd({ budgetOp: e.target.value as BudgetOp | "none" })} className={input}>
                    <option value="none">No budget condition</option>
                    {BUDGET_OPS.map((op) => (
                      <option key={op} value={op} disabled={isNumericOp(op) && !budgetCcy}>
                        {BUDGET_OP_LABELS[op]}{isNumericOp(op) && !budgetCcy ? " — needs one team" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {/* Single-threshold amount (lt/lte/gt/gte/eq) */}
              {draft.budgetOp !== "none" && draft.budgetOp !== "between" && isNumericOp(draft.budgetOp) && budgetCcy &&
                amountField("Amount", draft.budgetMinAmt, draft.budgetMinUnit, (v) => upd({ budgetMinAmt: v }), (u) => upd({ budgetMinUnit: u }), budgetCcy)}
              {/* Between → Minimum + Maximum */}
              {draft.budgetOp === "between" && budgetCcy && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {amountField("Minimum", draft.budgetMinAmt, draft.budgetMinUnit, (v) => upd({ budgetMinAmt: v }), (u) => upd({ budgetMinUnit: u }), budgetCcy)}
                  {amountField("Maximum", draft.budgetMaxAmt, draft.budgetMaxUnit, (v) => upd({ budgetMaxAmt: v }), (u) => upd({ budgetMaxUnit: u }), budgetCcy)}
                </div>
              )}
              {/* Numeric op chosen but no single team → blocked with a hint */}
              {isNumericOp(draft.budgetOp) && !budgetCcy && (
                <div className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  Pick exactly one team above to enter a budget amount — or choose a presence check instead.
                </div>
              )}
              {/* Presence ops carry no amount */}
              {draft.budgetOp !== "none" && !isNumericOp(draft.budgetOp) && (
                <div className="text-[11px] text-gray-400">
                  Matches on budget presence only — no amount needed ({BUDGET_OP_LABELS[draft.budgetOp]}).
                </div>
              )}
            </div>

            {/* Recipients */}
            <div className="space-y-2">
              <div className={label}>Who receives these leads?</div>
              <div className="flex flex-wrap gap-1.5">
                {([["single", "Single user"], ["round_robin", "Multiple — Round Robin"], ["weighted", "Multiple — Weighted %"]] as const).map(([v, lbl]) => (
                  <button key={v} type="button"
                    onClick={() => upd({ mode: v, ...(v === "single" && draft.recipients.length > 1 ? { recipients: draft.recipients.slice(0, 1) } : {}) })}
                    className={`text-xs px-2.5 py-1 rounded-full border ${draft.mode === v ? "bg-[#0b1a33] text-white border-[#0b1a33]" : "border-gray-200 dark:border-slate-600 text-gray-600 dark:text-slate-300"}`}>
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select value="" onChange={(e) => addRecipient(e.target.value)} className={`${input} max-w-xs`}>
                  <option value="">＋ Add {draft.mode === "single" ? "the user" : "a user"}…</option>
                  {["India", "Dubai", "HQ", ""].map((team) => {
                    const group = users.filter((u) => (u.team || "") === team && !draft.recipients.some((r) => r.userId === u.id));
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={team || "other"} label={team || "Other"}>
                        {group.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role.toLowerCase()})</option>)}
                      </optgroup>
                    );
                  })}
                </select>
                {draft.mode !== "single" && (
                  <>
                    <button type="button" onClick={() => addTeam("India")} className="btn btn-ghost text-xs">＋ Whole India team</button>
                    <button type="button" onClick={() => addTeam("Dubai")} className="btn btn-ghost text-xs">＋ Whole Dubai team</button>
                  </>
                )}
              </div>
              {draft.recipients.length > 0 && (
                <div className="space-y-1">
                  {draft.recipients.map((r, i) => (
                    <div key={r.userId} className="flex items-center gap-2 text-sm">
                      <span className="w-5 text-[11px] text-gray-400">{i + 1}.</span>
                      <span className="flex-1 min-w-0 truncate">{nameOf.get(r.userId) ?? r.userId}</span>
                      {draft.mode === "weighted" && (
                        <span className="flex items-center gap-1 text-xs">
                          <input type="number" min={1} max={100} value={r.weight} placeholder="%"
                            onChange={(e) => upd({ recipients: draft.recipients.map((x) => x.userId === r.userId ? { ...x, weight: e.target.value } : x) })}
                            className="w-16 px-2 py-1 text-sm border border-gray-200 dark:border-slate-600 rounded dark:bg-slate-700" />%
                        </span>
                      )}
                      <button type="button" onClick={() => upd({ recipients: draft.recipients.filter((x) => x.userId !== r.userId) })} className="text-gray-400 hover:text-rose-600 text-xs px-1">✕</button>
                    </div>
                  ))}
                  {draft.mode === "weighted" && (
                    <div className={`text-xs font-semibold ${Math.abs((weightSum ?? 0) - 100) <= 0.01 ? "text-emerald-600" : "text-rose-600"}`}>
                      Total: {weightSum}% {Math.abs((weightSum ?? 0) - 100) > 0.01 && "— must equal 100%"}
                    </div>
                  )}
                  {draft.mode === "round_robin" && draft.recipients.length > 1 && (
                    <div className="text-[11px] text-gray-400">Leads rotate {draft.recipients.length}-way in this order. On-leave members are skipped.</div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1 border-t border-gray-100 dark:border-slate-700">
              <button onClick={() => setDraft(null)} className="btn btn-ghost text-sm">Cancel</button>
              <ActionButton action="complete" label={draft.id ? "Save changes" : "Create rule"} title="Save routing rule" loading={busy} onClick={saveDraft} />
            </div>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" {...backdropProps(() => setDeleteId(null))}>
          <div className="card w-full max-w-sm p-4 space-y-3">
            <div className="font-bold">Delete this rule?</div>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              The rule stops applying immediately. Its history and lead counts are preserved (soft delete) and it stays
              visible under “Show deleted”. Already-assigned leads are not touched.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteId(null)} className="btn btn-ghost text-sm">Cancel</button>
              <ActionButton action="reject" label="Delete rule" title="Soft-delete this rule" loading={busy}
                onClick={async () => { const id = deleteId; if (await api(`/api/admin/routing-rules/${id}`, "DELETE")) { setDeleteId(null); router.refresh(); } }} />
            </div>
          </div>
        </div>
      )}

      {/* ── Apply rule to existing leads (spec §9) ── */}
      {applyId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" {...backdropProps(closeApply)}>
          <div className="card w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-bold">Apply rule to existing leads{applyPreview?.ruleName ? ` — ${applyPreview.ruleName}` : ""}</div>
              <button onClick={closeApply} className="btn btn-ghost text-sm">✕</button>
            </div>

            {applyState === "loading" && <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>}

            {applyState === "unavailable" && (
              <div className="text-sm text-amber-700 dark:text-amber-400 py-3">
                Preview unavailable — the &ldquo;apply to existing leads&rdquo; service isn&apos;t reachable yet.
                This rule still routes every <b>new</b> matching lead automatically; only the one-time backfill of
                existing leads is offline. Try again shortly.
              </div>
            )}

            {applyState === "error" && (
              <div className="text-sm text-rose-600 dark:text-rose-400 py-3">{applyErr ?? "Something went wrong."}</div>
            )}

            {applyState === "done" && applyResult && (
              <div className="space-y-2 py-2">
                <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Reassigned {applyResult.reassigned} lead{applyResult.reassigned === 1 ? "" : "s"}.
                </div>
                {applyResult.skipped > 0 && (
                  <div className="text-xs text-gray-500 dark:text-slate-400">
                    {applyResult.skipped} skipped (already on target, or no eligible recipient right now).
                  </div>
                )}
                <div className="text-xs text-gray-500 dark:text-slate-400">
                  This bulk reassignment is revertable in <b>Admin → Operations</b>.
                </div>
              </div>
            )}

            {applyState === "ready" && applyPreview && (
              <div className="space-y-3">
                {applyPreview.count === 0 ? (
                  <div className="text-sm text-gray-500 dark:text-slate-400">
                    No existing leads currently match this rule&apos;s scope. Nothing to reassign.
                  </div>
                ) : (
                  <>
                    <div className="text-sm">
                      <b>{applyPreview.count}</b> existing lead{applyPreview.count === 1 ? "" : "s"} match this rule
                      {applyPreview.recipientName ? <> and will be reassigned to <b>{applyPreview.recipientName}</b></> : null}.
                    </div>
                    {applyPreview.distribution.length > 0 && (
                      <div className="text-xs text-gray-500 dark:text-slate-400">
                        <div className="font-semibold mb-0.5">Current owners:</div>
                        <ul className="space-y-0.5 max-h-32 overflow-y-auto">
                          {applyPreview.distribution.map((d) => (
                            <li key={d.ownerId ?? "unassigned"}>{d.ownerName || "Unassigned"} — {d.count}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {!applyPreview.live && (
                      <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                        This rule isn&apos;t currently active (scheduled, expired, or disabled). Activate it before applying to existing leads.
                      </div>
                    )}
                    {applyPreview.exceedsLimit && (
                      <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                        Matches more than {applyPreview.maxApply} leads — narrow the rule&apos;s scope (team, source, budget, dates) before applying.
                      </div>
                    )}
                    {applyPreview.live && !applyPreview.exceedsLimit && (
                      <label className="flex items-start gap-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
                        <input type="checkbox" checked={applyAck} onChange={(e) => setApplyAck(e.target.checked)} className="mt-0.5" />
                        Reassign these {applyPreview.count} existing lead{applyPreview.count === 1 ? "" : "s"} now. I understand this changes ownership (revertable in Admin → Operations).
                      </label>
                    )}
                    {applyErr && <div className="text-xs text-rose-600">{applyErr}</div>}
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1 border-t border-gray-100 dark:border-slate-700">
              <button onClick={closeApply} className="btn btn-ghost text-sm">{applyState === "done" ? "Close" : "Cancel"}</button>
              {applyState === "ready" && applyPreview && applyPreview.count > 0 && applyPreview.live && !applyPreview.exceedsLimit && (
                <ActionButton action="assign"
                  label={`Reassign ${applyPreview.count} lead${applyPreview.count === 1 ? "" : "s"}`}
                  title="Reassign matching leads to this rule's recipients"
                  disabled={!applyAck} onClick={confirmApply} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Pause confirm (strong) ── */}
      {pauseConfirm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" {...backdropProps(() => setPauseConfirm(false))}>
          <div className="card w-full max-w-md p-4 space-y-3 border-l-4 border-rose-600">
            <div className="font-bold text-rose-700 dark:text-rose-300">⏸ Pause ALL automatic assignment?</div>
            <p className="text-xs text-gray-600 dark:text-slate-300">
              This is the emergency override. While paused:
            </p>
            <ul className="text-xs text-gray-600 dark:text-slate-300 list-disc pl-4 space-y-1">
              <li>Every new lead (website, Meta, email, API, quick-add) stays <b>UNASSIGNED</b>.</li>
              <li>All routing rules and the default team rule are suspended.</li>
              <li>Nothing is lost — leads queue for manual distribution, and you can resume any time.</li>
              <li>Manual assignment keeps working normally.</li>
            </ul>
            <label className="flex items-start gap-2 text-xs font-semibold text-gray-700 dark:text-slate-200">
              <input type="checkbox" checked={pauseAck} onChange={(e) => setPauseAck(e.target.checked)} className="mt-0.5" />
              I understand every new lead will remain unassigned until I distribute it manually or resume.
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPauseConfirm(false)} className="btn btn-ghost text-sm">Cancel</button>
              <ActionButton action="escalate" label="Pause assignment" title="Pause all automatic assignment now" disabled={!pauseAck} loading={busy} onClick={() => togglePause(true)} />
            </div>
          </div>
        </div>
      )}

      {/* ── History drawer ── */}
      {historyId && (
        <div className="fixed inset-0 z-50 bg-black/30">
          <div ref={historyRef} className="absolute inset-y-0 right-0 w-full sm:w-[440px] bg-white dark:bg-slate-800 shadow-2xl p-4 overflow-y-auto space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">Rule history{history?.ruleName ? ` — ${history.ruleName}` : ""}</h3>
              <button onClick={() => setHistoryId(null)} className="btn btn-ghost text-sm">✕</button>
            </div>
            {!history && <div className="text-sm text-gray-400 py-6 text-center">Loading…</div>}
            {history && history.versions.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">No history yet.</div>}
            {history?.versions.map((v) => {
              const s = v.snapshot as Record<string, unknown>;
              const chip =
                v.action === "created" ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                : v.action === "deleted" ? "bg-rose-100 text-rose-700 border-rose-200"
                : v.action === "disabled" ? "bg-amber-100 text-amber-800 border-amber-200"
                : v.action === "enabled" ? "bg-blue-100 text-blue-700 border-blue-200"
                : "bg-gray-100 text-gray-600 border-gray-300";
              const recips = Array.isArray(s.recipients) ? (s.recipients as Recipient[]) : [];
              return (
                <div key={v.id} className="border border-gray-100 dark:border-slate-700 rounded-lg p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={`px-2 py-0.5 rounded-full border font-semibold ${chip}`}>{v.action}</span>
                    <span className="text-gray-400">{fmtIST(new Date(v.changedAt))} IST</span>
                  </div>
                  <div className="text-gray-500 dark:text-slate-400">by <b>{v.changedByName}</b></div>
                  <div className="text-gray-600 dark:text-slate-300">
                    <b>{String(s.name ?? "")}</b> · priority {String(s.priority ?? "")} · {STRATEGY_LABELS[String(s.strategy)] ?? String(s.strategy ?? "")}
                    {" · "}{recips.length} recipient{recips.length === 1 ? "" : "s"}
                    {" · "}{windowLabel(String(s.startsAt ?? new Date().toISOString()), (s.endsAt as string | null) ?? null)}
                  </div>
                  <div className="text-gray-400">{s.assignedCount != null ? `${s.assignedCount} leads assigned at this point` : ""}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
