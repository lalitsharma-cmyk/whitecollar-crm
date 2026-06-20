"use client";
/**
 * AiTrialClient — all interactive state for the AI Trial admin page.
 * Rendered inside the server shell (page.tsx) which passes the initial
 * ai.enabled / ai.trialMode.enabled flags read from the DB.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { fmtIST } from "@/lib/datetime";

// ─── types matching the API / aiTrial lib ────────────────────────────────────

interface AiTrialRun {
  id: string;
  status: string;
  sampleSize: number;
  team: string | null;
  source: string | null;
  features: string[];
  provider: string | null;
  model: string | null;
  totalLeads: number;
  processed: number;
  failed: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  estCostMicroUsd: number | null;
  avgCostPerLead: number;
  avgMs: number;
  createdById: string | null;
  createdAt: string;
  confirmedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  qualityNote: string | null;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function microUsdToUsd(micro: number | null | undefined): string {
  if (micro == null) return "$—";
  return `$${(micro / 1_000_000).toFixed(4)}`;
}

function microUsdToUsdShort(micro: number | null | undefined): string {
  if (micro == null) return "$—";
  const usd = micro / 1_000_000;
  return `$${usd.toFixed(2)}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmtIST(iso);
}

// ─── feature labels ───────────────────────────────────────────────────────────

const FEATURES = [
  { key: "score",         label: "Lead Score",          desc: "AI quality/intent score (0-100)" },
  { key: "summary",       label: "Lead Summary",         desc: "Plain-English client situation" },
  { key: "nextAction",    label: "Next Action",          desc: "Recommended follow-up step" },
  { key: "waDraft",       label: "WhatsApp Draft",       desc: "Draft WA message for agent" },
  { key: "coldRevival",   label: "Cold Revival Score",   desc: "Revival potential for cold leads" },
  { key: "propertyMatch", label: "Property Match",       desc: "Best-fit property recommendations" },
];

const SOURCES = ["WEBSITE", "WHATSAPP", "CSV_IMPORT", "FACEBOOK", "INSTAGRAM", "REFERRAL", "WALK_IN", "OTHER"];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT:    "bg-gray-100 text-gray-700",
    RUNNING:  "bg-emerald-100 text-emerald-800",
    PAUSED:   "bg-amber-100 text-amber-800",
    STOPPED:  "bg-red-100 text-red-700",
    DONE:     "bg-blue-100 text-blue-800",
    FAILED:   "bg-red-200 text-red-900",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colors[status] ?? "bg-gray-100 text-gray-700"}`}>
      {status}
    </span>
  );
}

// ─── Monthly cost card ────────────────────────────────────────────────────────

function MonthlyCostCard({ spentMicroUsd, capUsd }: { spentMicroUsd: number; capUsd: number }) {
  const spentUsd = spentMicroUsd / 1_000_000;
  const pct = capUsd > 0 ? Math.min(100, Math.round((spentUsd / capUsd) * 100)) : null;
  const now = new Date();
  const monthLabel = now.toLocaleString("default", { month: "long", year: "numeric" });

  const barColor =
    pct == null ? "bg-blue-400"
    : pct >= 90 ? "bg-red-500"
    : pct >= 70 ? "bg-amber-500"
    : "bg-blue-500";

  return (
    <div className="card p-5 border-l-4 border-blue-300">
      <h2 className="font-semibold text-base mb-3">F — Monthly AI Cost Report</h2>
      <p className="text-xs text-gray-500 mb-3">{monthLabel} (calendar month, UTC)</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm mb-4">
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Spent this month</div>
          <div className="font-semibold text-blue-700">${spentUsd.toFixed(4)}</div>
          <div className="text-[11px] text-gray-400">{spentMicroUsd.toLocaleString()} µUSD</div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Monthly cap</div>
          <div className="font-semibold">{capUsd > 0 ? `$${capUsd}` : "None"}</div>
          <div className="text-[11px] text-gray-400">
            {capUsd > 0 ? "Change in Settings → AI Features" : "Set in Settings → AI Features"}
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <div className="text-xs text-gray-500">Budget used</div>
          <div className={`font-semibold ${pct != null && pct >= 90 ? "text-red-600" : pct != null && pct >= 70 ? "text-amber-600" : "text-gray-700"}`}>
            {pct != null ? `${pct}%` : "—"}
          </div>
          <div className="text-[11px] text-gray-400">
            {capUsd === 0 ? "No cap configured" : pct != null && pct >= 100 ? "Cap reached — AI blocked" : "Of monthly cap"}
          </div>
        </div>
      </div>
      {capUsd > 0 && pct != null && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>${spentUsd.toFixed(2)} spent</span>
            <span>${capUsd} cap</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`${barColor} h-2 rounded-full transition-all`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {pct >= 100 && (
            <p className="text-xs text-red-700 mt-2 font-medium">
              Monthly cap reached. All AI calls are blocked until next month or the cap is raised.
            </p>
          )}
          {pct >= 70 && pct < 100 && (
            <p className="text-xs text-amber-700 mt-2">
              Approaching monthly cap. Review usage in the run history above.
            </p>
          )}
        </div>
      )}
      <p className="text-[11px] text-gray-400 mt-2">
        Data reflects <code>AiUsageLog</code> rows for this calendar month. Refreshes on page load.
      </p>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

interface Props {
  initialAiEnabled: boolean;
  initialTrialModeEnabled: boolean;
  initialMonthlySpentMicroUsd: number;
  initialMonthlyCostCapUsd: number;
}

export default function AiTrialClient({ initialAiEnabled, initialTrialModeEnabled, initialMonthlySpentMicroUsd, initialMonthlyCostCapUsd }: Props) {
  const router = useRouter();

  // ── A: Global AI state ─────────────────────────────────────────────────────
  const [aiEnabled, setAiEnabled] = useState(initialAiEnabled);
  const [trialModeEnabled, setTrialModeEnabled] = useState(initialTrialModeEnabled);
  const [toggleBusy, setToggleBusy] = useState<"ai" | "trial" | null>(null);

  async function toggleSetting(field: "ai" | "trial") {
    setToggleBusy(field);
    const newAi = field === "ai" ? !aiEnabled : aiEnabled;
    const newTrial = field === "trial" ? !trialModeEnabled : trialModeEnabled;
    try {
      const r = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: newAi, trialModeEnabled: newTrial }),
      });
      if (r.ok) {
        setAiEnabled(newAi);
        setTrialModeEnabled(newTrial);
        router.refresh();
      }
    } finally {
      setToggleBusy(null);
    }
  }

  // ── B: New trial run form ──────────────────────────────────────────────────
  const [sampleSize, setSampleSize] = useState<number>(10);
  const [team, setTeam] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [features, setFeatures] = useState<string[]>(["score"]);
  const [estimating, setEstimating] = useState(false);
  const [draftRun, setDraftRun] = useState<AiTrialRun | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function toggleFeature(key: string) {
    setFeatures(prev =>
      prev.includes(key) ? prev.filter(f => f !== key) : [...prev, key]
    );
  }

  async function handleEstimate() {
    if (features.length === 0) { setFormError("Select at least one feature."); return; }
    setFormError(null);
    setEstimating(true);
    setDraftRun(null);
    try {
      const r = await fetch("/api/ai/trial/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleSize,
          team: team || undefined,
          source: source || undefined,
          features,
        }),
      });
      const json = await r.json();
      if (!r.ok) { setFormError(json.error ?? "Failed to create run"); return; }
      setDraftRun(json.run);
    } finally {
      setEstimating(false);
    }
  }

  // ── C: Active run progress ─────────────────────────────────────────────────
  const [activeRun, setActiveRun] = useState<AiTrialRun | null>(null);
  const [stepping, setStepping] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const stepLoopRef = useRef(false);

  const startStepLoop = useCallback((runId: string) => {
    stepLoopRef.current = true;
    setStepping(true);
    setStepError(null);

    async function doStep() {
      if (!stepLoopRef.current) { setStepping(false); return; }
      try {
        const r = await fetch(`/api/ai/trial/${runId}/step`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchSize: 5 }),
        });
        const json = await r.json();
        if (!r.ok) {
          setStepError(json.error ?? "Step failed");
          setStepping(false);
          stepLoopRef.current = false;
          if (json.run) setActiveRun(json.run);
          return;
        }
        setActiveRun(json.run);
        if (json.done || !stepLoopRef.current) {
          setStepping(false);
          stepLoopRef.current = false;
          return;
        }
        // small delay to avoid hammering the server
        setTimeout(doStep, 300);
      } catch (e) {
        setStepError(e instanceof Error ? e.message : "Unknown error");
        setStepping(false);
        stepLoopRef.current = false;
      }
    }

    doStep();
  }, []);

  async function handleConfirm() {
    if (!draftRun) return;
    setConfirming(true);
    setFormError(null);
    try {
      const r = await fetch(`/api/ai/trial/${draftRun.id}/confirm`, { method: "POST" });
      const json = await r.json();
      if (!r.ok) { setFormError(json.error ?? "Failed to confirm"); return; }
      setDraftRun(null);
      setActiveRun(json.run);
      startStepLoop(json.run.id);
    } finally {
      setConfirming(false);
    }
  }

  async function handlePause() {
    if (!activeRun) return;
    stepLoopRef.current = false;
    setStepping(false);
    const r = await fetch(`/api/ai/trial/${activeRun.id}/pause`, { method: "POST" });
    const json = await r.json();
    if (r.ok) setActiveRun(json.run);
  }

  async function handleResume() {
    if (!activeRun) return;
    const r = await fetch(`/api/ai/trial/${activeRun.id}/confirm`, { method: "POST" });
    const json = await r.json();
    if (r.ok) {
      setActiveRun(json.run);
      startStepLoop(json.run.id);
    }
  }

  async function handleStop() {
    if (!activeRun) return;
    stepLoopRef.current = false;
    setStepping(false);
    const r = await fetch(`/api/ai/trial/${activeRun.id}/stop`, { method: "POST" });
    const json = await r.json();
    if (r.ok) setActiveRun(json.run);
  }

  // ── D: Report section ──────────────────────────────────────────────────────
  const [qualityNote, setQualityNote] = useState<string>("");
  const [savingNote, setSavingNote] = useState(false);
  const [clearing, setClearing] = useState(false);

  const reportRun = activeRun && (activeRun.status === "DONE" || activeRun.status === "STOPPED") ? activeRun : null;

  useEffect(() => {
    if (reportRun?.qualityNote) setQualityNote(reportRun.qualityNote);
  }, [reportRun?.id, reportRun?.qualityNote]);

  async function saveQualityNote() {
    if (!reportRun) return;
    setSavingNote(true);
    await fetch(`/api/ai/trial/${reportRun.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qualityNote }),
    });
    setSavingNote(false);
  }

  async function handleClear() {
    if (!reportRun) return;
    setClearing(true);
    const r = await fetch(`/api/ai/trial/${reportRun.id}/clear`, { method: "POST" });
    const json = await r.json();
    if (r.ok) {
      setActiveRun(json.run);
      setQualityNote("");
    }
    setClearing(false);
  }

  // ── E: Run history ─────────────────────────────────────────────────────────
  const [history, setHistory] = useState<AiTrialRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedReport, setSelectedReport] = useState<AiTrialRun | null>(null);

  // Re-fetch history when active run status changes (run finishes/stops)
  const activeRunStatus = activeRun?.status;
  useEffect(() => {
    let alive = true;
    setHistoryLoading(true);
    fetch("/api/ai/trial")
      .then(r => r.json())
      .then(json => { if (alive) setHistory(json.runs ?? []); })
      .catch(() => {})
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; };
  }, [activeRunStatus]);

  async function loadReport(run: AiTrialRun) {
    const r = await fetch(`/api/ai/trial/${run.id}/report`);
    if (r.ok) {
      const json = await r.json();
      setSelectedReport(json.report ?? run);
    } else {
      setSelectedReport(run);
    }
  }

  // ── progress helpers ───────────────────────────────────────────────────────
  const progressPct = activeRun && activeRun.totalLeads > 0
    ? Math.round((activeRun.processed / activeRun.totalLeads) * 100)
    : 0;

  const isActiveRunInProgress = activeRun && (activeRun.status === "RUNNING" || activeRun.status === "PAUSED");

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Section A: Global AI status ──────────────────────────────────── */}
      <div className="card p-5 border-l-4 border-blue-400">
        <h2 className="font-semibold text-base mb-3">A — Global AI Status</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* ai.enabled */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-gray-50">
            <div>
              <div className="text-sm font-medium">AI Features</div>
              <div className="text-xs text-gray-500">Global AI scoring / summaries / runs</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${aiEnabled ? "text-emerald-700" : "text-gray-500"}`}>
                {aiEnabled ? "ON" : "OFF"}
              </span>
              <button
                onClick={() => toggleSetting("ai")}
                disabled={toggleBusy !== null}
                aria-label="Toggle AI Features"
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${aiEnabled ? "bg-emerald-500" : "bg-gray-400"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${aiEnabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
          </div>

          {/* ai.trialMode.enabled */}
          <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-gray-50">
            <div>
              <div className="text-sm font-medium">Trial Mode</div>
              <div className="text-xs text-gray-500">Bounded trial while global AI is OFF</div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${trialModeEnabled ? "text-blue-700" : "text-gray-500"}`}>
                {trialModeEnabled ? "ON" : "OFF"}
              </span>
              <button
                onClick={() => toggleSetting("trial")}
                disabled={toggleBusy !== null}
                aria-label="Toggle AI Trial Mode"
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${trialModeEnabled ? "bg-blue-500" : "bg-gray-400"}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${trialModeEnabled ? "translate-x-6" : "translate-x-1"}`} />
              </button>
            </div>
          </div>
        </div>

        {!aiEnabled && !trialModeEnabled && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
            No AI will run — enable <b>Trial Mode</b> above to start a trial, or enable <b>AI Features</b> for live AI.
          </div>
        )}
        {!aiEnabled && trialModeEnabled && (
          <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-2 text-sm text-blue-800">
            Trial Mode is ON. Configure and confirm a trial run below to call the AI provider on a small sample.
          </div>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Also configurable from <a href="/settings" className="underline">Settings</a>.
        </p>
      </div>

      {/* ── Section B: New Trial Run form ──────────────────────────────────── */}
      {!isActiveRunInProgress && !reportRun && (
        <div className="card p-5">
          <h2 className="font-semibold text-base mb-4">B — New Trial Run</h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            {/* Sample size */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Sample size</label>
              <select
                value={sampleSize}
                onChange={e => setSampleSize(Number(e.target.value))}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value={10}>10 — safest (recommended)</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Team */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Team filter</label>
              <select
                value={team}
                onChange={e => setTeam(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">All teams</option>
                <option value="India">India</option>
                <option value="Dubai">Dubai</option>
              </select>
            </div>

            {/* Source */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Source filter (optional)</label>
              <select
                value={source}
                onChange={e => setSource(e.target.value)}
                className="w-full text-sm border border-gray-300 rounded px-2 py-1.5"
              >
                <option value="">Any source</option>
                {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Features */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-2">Features to run</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {FEATURES.map(f => (
                <label key={f.key} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={features.includes(f.key)}
                    onChange={() => toggleFeature(f.key)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="text-sm font-medium">{f.label}</div>
                    <div className="text-xs text-gray-500">{f.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {formError && (
            <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{formError}</div>
          )}

          <button
            onClick={handleEstimate}
            disabled={estimating || features.length === 0}
            className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {estimating ? "Estimating…" : "Estimate Cost"}
          </button>

          {/* Cost estimate + confirm */}
          {draftRun && (
            <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
              <div className="font-semibold text-blue-800 mb-2">Cost estimate</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <div className="text-xs text-gray-500">Sample leads</div>
                  <div className="font-semibold">{draftRun.totalLeads} / {draftRun.sampleSize} requested</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Features</div>
                  <div className="font-semibold text-xs">{draftRun.features.join(", ")}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Estimated cost</div>
                  <div className="font-semibold text-blue-700">{microUsdToUsd(draftRun.estCostMicroUsd)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-500">Model</div>
                  <div className="font-semibold text-xs">{draftRun.model ?? draftRun.provider ?? "—"}</div>
                </div>
              </div>
              {!trialModeEnabled && (
                <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
                  Trial Mode is OFF — enable it in Section A above before confirming.
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleConfirm}
                  disabled={confirming || !trialModeEnabled}
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                >
                  {confirming ? "Starting…" : "Confirm & Start Trial"}
                </button>
                <button
                  onClick={() => setDraftRun(null)}
                  className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Section C: Active run progress ──────────────────────────────────── */}
      {isActiveRunInProgress && activeRun && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">C — Run Progress</h2>
            <StatusBadge status={activeRun.status} />
          </div>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>{activeRun.processed} / {activeRun.totalLeads} leads</span>
              <span>{progressPct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className="bg-blue-500 h-3 rounded-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Processed</div>
              <div className="font-semibold text-emerald-700">{activeRun.processed}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Failed</div>
              <div className="font-semibold text-red-600">{activeRun.failed}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Input tokens</div>
              <div className="font-semibold">{activeRun.inputTokens.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Output tokens</div>
              <div className="font-semibold">{activeRun.outputTokens.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Current cost</div>
              <div className="font-semibold text-blue-700">{microUsdToUsdShort(activeRun.costMicroUsd)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Est. cost</div>
              <div className="font-semibold">{microUsdToUsdShort(activeRun.estCostMicroUsd)}</div>
            </div>
          </div>

          {stepError && (
            <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{stepError}</div>
          )}
          {stepping && (
            <p className="mb-3 text-sm text-blue-700 animate-pulse">Processing batch…</p>
          )}

          <div className="flex gap-2 flex-wrap">
            {activeRun.status === "RUNNING" && (
              <button
                onClick={handlePause}
                className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded hover:bg-amber-600"
              >
                Pause
              </button>
            )}
            {activeRun.status === "PAUSED" && (
              <button
                onClick={handleResume}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700"
              >
                Resume
              </button>
            )}
            <button
              onClick={handleStop}
              className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700"
            >
              Stop
            </button>
          </div>
        </div>
      )}

      {/* ── Section D: Trial cost report ─────────────────────────────────────── */}
      {reportRun && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-base">D — Trial Report</h2>
            <StatusBadge status={reportRun.status} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Leads processed</div>
              <div className="font-semibold">{reportRun.processed}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Failed / skipped</div>
              <div className="font-semibold text-red-600">{reportRun.failed} / {reportRun.skipped}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Input tokens</div>
              <div className="font-semibold">{reportRun.inputTokens.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Output tokens</div>
              <div className="font-semibold">{reportRun.outputTokens.toLocaleString()}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Model</div>
              <div className="font-semibold text-xs">{reportRun.model ?? reportRun.provider ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Est. cost</div>
              <div className="font-semibold">{microUsdToUsdShort(reportRun.estCostMicroUsd)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Actual cost</div>
              <div className="font-semibold text-blue-700">{microUsdToUsdShort(reportRun.costMicroUsd)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Avg cost / lead</div>
              <div className="font-semibold">{microUsdToUsd(reportRun.avgCostPerLead)}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Avg time / lead</div>
              <div className="font-semibold">{reportRun.avgMs ? `${Math.round(reportRun.avgMs)} ms` : "—"}</div>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <div className="text-xs text-gray-500">Finished</div>
              <div className="font-semibold text-xs">{fmtDate(reportRun.finishedAt)}</div>
            </div>
          </div>

          {/* Quality notes */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-700 mb-1">Quality notes (admin)</label>
            <textarea
              value={qualityNote}
              onChange={e => setQualityNote(e.target.value)}
              rows={3}
              placeholder="e.g. summaries were too generic, scores aligned with manual assessment…"
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 resize-y"
            />
            <button
              onClick={saveQualityNote}
              disabled={savingNote}
              className="mt-1 px-3 py-1.5 text-xs font-medium bg-gray-700 text-white rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {savingNote ? "Saving…" : "Save notes"}
            </button>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleClear}
              disabled={clearing}
              className="px-4 py-2 text-sm font-medium border border-red-300 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
            >
              {clearing ? "Clearing…" : "Clear Outputs (reset to DRAFT)"}
            </button>
            <button
              onClick={() => setActiveRun(null)}
              className="px-4 py-2 text-sm font-medium border border-gray-300 rounded hover:bg-gray-50"
            >
              Start New Trial
            </button>
          </div>
        </div>
      )}

      {/* ── Section F: Monthly AI cost report ────────────────────────────────── */}
      <MonthlyCostCard
        spentMicroUsd={initialMonthlySpentMicroUsd}
        capUsd={initialMonthlyCostCapUsd}
      />

      {/* ── Section E: Run history ─────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-semibold text-base mb-3">E — Run History</h2>

        {historyLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-gray-500">No trial runs yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b">
                  <th className="text-left pb-2 pr-3">Date</th>
                  <th className="text-left pb-2 pr-3">Size</th>
                  <th className="text-left pb-2 pr-3">Team</th>
                  <th className="text-left pb-2 pr-3">Features</th>
                  <th className="text-left pb-2 pr-3">Status</th>
                  <th className="text-left pb-2 pr-3">Cost</th>
                  <th className="text-left pb-2">Model</th>
                </tr>
              </thead>
              <tbody>
                {history.map(run => (
                  <tr
                    key={run.id}
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => loadReport(run)}
                  >
                    <td className="py-2 pr-3 text-xs text-gray-600 whitespace-nowrap">{fmtDate(run.createdAt)}</td>
                    <td className="py-2 pr-3">{run.totalLeads} / {run.sampleSize}</td>
                    <td className="py-2 pr-3 text-xs">{run.team ?? "All"}</td>
                    <td className="py-2 pr-3 text-xs">{Array.isArray(run.features) ? run.features.join(", ") : run.features}</td>
                    <td className="py-2 pr-3"><StatusBadge status={run.status} /></td>
                    <td className="py-2 pr-3 text-blue-700">{microUsdToUsdShort(run.costMicroUsd)}</td>
                    <td className="py-2 text-xs text-gray-500">{run.model ?? run.provider ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Selected history report */}
        {selectedReport && (
          <div className="mt-4 rounded-lg bg-gray-50 border p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-sm">Run report</div>
              <button onClick={() => setSelectedReport(null)} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-gray-500">Processed</div><div className="font-semibold">{selectedReport.processed}</div></div>
              <div><div className="text-xs text-gray-500">Failed / skipped</div><div className="font-semibold">{selectedReport.failed} / {selectedReport.skipped}</div></div>
              <div><div className="text-xs text-gray-500">Input tokens</div><div className="font-semibold">{selectedReport.inputTokens.toLocaleString()}</div></div>
              <div><div className="text-xs text-gray-500">Output tokens</div><div className="font-semibold">{selectedReport.outputTokens.toLocaleString()}</div></div>
              <div><div className="text-xs text-gray-500">Est. cost</div><div className="font-semibold">{microUsdToUsdShort(selectedReport.estCostMicroUsd)}</div></div>
              <div><div className="text-xs text-gray-500">Actual cost</div><div className="font-semibold text-blue-700">{microUsdToUsdShort(selectedReport.costMicroUsd)}</div></div>
              <div><div className="text-xs text-gray-500">Avg cost / lead</div><div className="font-semibold">{microUsdToUsd(selectedReport.avgCostPerLead)}</div></div>
              <div><div className="text-xs text-gray-500">Avg time</div><div className="font-semibold">{selectedReport.avgMs ? `${Math.round(selectedReport.avgMs)} ms` : "—"}</div></div>
              <div><div className="text-xs text-gray-500">Model</div><div className="font-semibold text-xs">{selectedReport.model ?? selectedReport.provider ?? "—"}</div></div>
              <div><div className="text-xs text-gray-500">Status</div><div><StatusBadge status={selectedReport.status} /></div></div>
              <div><div className="text-xs text-gray-500">Finished</div><div className="font-semibold text-xs">{fmtDate(selectedReport.finishedAt)}</div></div>
            </div>
            {selectedReport.qualityNote && (
              <div className="mt-2 text-xs text-gray-700 bg-white border rounded px-3 py-2">
                <b>Quality note:</b> {selectedReport.qualityNote}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
