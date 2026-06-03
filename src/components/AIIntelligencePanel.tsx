"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AIExtractionResult, ExtractedField, ExtractedProject } from "@/lib/aiExtractor";

interface Props {
  leadId: string;
  initial: AIExtractionResult | null;
  lastRunAt: string | null;  // ISO string
  aiEnabled: boolean;
}

function ConfidencePip({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-400" : "bg-orange-400";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-gray-500">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      {pct}%
    </span>
  );
}

function EvidenceChip({ sourceText, sourceDate }: { sourceText: string; sourceDate?: string }) {
  const [open, setOpen] = useState(false);
  if (!sourceText) return null;
  return (
    <span className="ml-1">
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] text-blue-500 hover:underline"
        title="Show source evidence"
      >
        {open ? "▲ hide" : "📎 source"}
      </button>
      {open && (
        <div className="mt-1 text-[10px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1 italic max-w-sm">
          {sourceDate && <span className="text-gray-400 not-italic mr-1">{sourceDate} ·</span>}
          &ldquo;{sourceText}&rdquo;
        </div>
      )}
    </span>
  );
}

function FieldRow({
  label, field, onApply, applied,
}: {
  label: string;
  field: ExtractedField | ExtractedProject | null | undefined;
  onApply?: (value: string) => void;
  applied?: boolean;
}) {
  if (!field) return null;
  const value = "name" in field ? field.name : (field as ExtractedField).value;
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-gray-100 last:border-0">
      <span className="text-[10px] font-semibold text-gray-500 w-28 shrink-0 pt-0.5">{label}</span>
      <div className="flex-1 min-w-0">
        <span className="text-sm text-gray-800 font-medium">{String(value)}</span>
        <span className="ml-2"><ConfidencePip confidence={field.confidence} /></span>
        <EvidenceChip sourceText={field.sourceText} sourceDate={field.sourceDate} />
      </div>
      {onApply && !applied && (
        <button
          onClick={() => onApply(String(value))}
          className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 flex-none whitespace-nowrap"
        >
          Apply
        </button>
      )}
      {applied && <span className="text-[10px] text-emerald-600 flex-none">✓ Applied</span>}
    </div>
  );
}

export default function AIIntelligencePanel({ leadId, initial, lastRunAt, aiEnabled }: Props) {
  const router = useRouter();
  const [result, setResult] = useState<AIExtractionResult | null>(initial);
  const [runAt, setRunAt] = useState<string | null>(lastRunAt);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"summary" | "bant" | "projects" | "insights">("summary");

  async function runScan() {
    setScanning(true);
    setError(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/ai-extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggeredBy: "manual" }),
      });
      if (r.status === 402) {
        setError("AI is disabled. Enable it in Settings → AI Intelligence.");
        return;
      }
      if (!r.ok) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        setError(j.error ?? "Extraction failed. Check the lead has call notes or remarks.");
        return;
      }
      const j = await r.json() as { result?: AIExtractionResult };
      if (j.result) {
        setResult(j.result);
        setRunAt(new Date().toISOString());
        router.refresh();
      }
    } finally {
      setScanning(false);
    }
  }

  async function applyField(field: string, value: string) {
    await fetch(`/api/leads/${leadId}/update`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    setApplied((prev) => new Set([...prev, field]));
    router.refresh();
  }

  const fmtAt = (iso: string | null) => {
    if (!iso) return null;
    try {
      return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
    } catch { return null; }
  };

  const hasAnyResult = result && (
    result.budget || result.authority || result.need || result.timeline ||
    result.configuration || result.locationPreference || result.purpose ||
    result.projectsDiscussed?.length || result.connectedStatus ||
    result.bestTimeToCall || result.buyingSignals?.length ||
    result.objections?.length || result.clientSummary
  );

  const tabs = [
    { key: "summary" as const, label: "Summary" },
    { key: "bant" as const, label: "BANT" },
    { key: "projects" as const, label: "Projects" },
    { key: "insights" as const, label: "Insights" },
  ];

  return (
    <div className="card p-4">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300">
            🤖 AI INTELLIGENCE
          </span>
          {runAt && (
            <span className="text-[10px] text-gray-400">
              Last scan: {fmtAt(runAt)}
            </span>
          )}
          {!aiEnabled && (
            <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5 border border-amber-200">
              AI disabled — enable in Settings
            </span>
          )}
        </div>
        <button
          onClick={runScan}
          disabled={scanning || !aiEnabled}
          className="text-[10px] px-3 py-1.5 rounded-lg bg-[#0b1a33] text-white font-semibold hover:bg-[#1a2f55] disabled:opacity-50 flex items-center gap-1"
        >
          {scanning ? "Scanning…" : "🔍 Re-scan"}
        </button>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {!hasAnyResult && !scanning && (
        <div className="text-sm text-gray-500 py-2">
          {aiEnabled
            ? <>No extraction yet. Click &ldquo;Re-scan&rdquo; to analyse this lead&apos;s history.</>
            : "Enable AI in Settings to run the intelligence engine on this lead."}
        </div>
      )}

      {hasAnyResult && (
        <>
          {/* ── Tab bar ──────────────────────────────────────────────────── */}
          <div className="flex gap-1 mb-3 border-b border-gray-100">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`text-xs px-3 py-1.5 -mb-px border-b-2 font-medium transition-colors ${
                  tab === t.key
                    ? "border-[#0b1a33] text-[#0b1a33] dark:border-slate-300 dark:text-slate-200"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* ── Summary tab ──────────────────────────────────────────────── */}
          {tab === "summary" && (
            <div className="space-y-3">
              {result.clientSummary && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-500 mb-1">CLIENT SUMMARY</div>
                  <p className="text-sm text-gray-700 dark:text-slate-300 leading-relaxed">{result.clientSummary}</p>
                </div>
              )}
              {result.nextBestAction && (
                <div>
                  <div className="text-[10px] font-semibold text-gray-500 mb-1">NEXT BEST ACTION</div>
                  <p className="text-sm text-gray-700 dark:text-slate-300 font-medium">⚡ {result.nextBestAction}</p>
                </div>
              )}
              {result.connectedStatus && (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold text-gray-500">CONNECTED STATUS</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                    result.connectedStatus.value === "connected"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-red-100 text-red-700"
                  }`}>
                    {result.connectedStatus.value === "connected" ? "✅ Connected" : "❌ Not Connected"}
                  </span>
                  <ConfidencePip confidence={result.connectedStatus.confidence} />
                  <EvidenceChip sourceText={result.connectedStatus.sourceText} sourceDate={result.connectedStatus.sourceDate} />
                </div>
              )}
              {result.bestTimeToCall && (
                <FieldRow label="Best time to call" field={result.bestTimeToCall} />
              )}
            </div>
          )}

          {/* ── BANT tab ─────────────────────────────────────────────────── */}
          {tab === "bant" && (
            <div>
              <FieldRow
                label="Budget"
                field={result.budget}
              />
              <FieldRow
                label="Authority"
                field={result.authority}
                onApply={(v) => applyField("authorityPerson", v)}
                applied={applied.has("authorityPerson")}
              />
              <FieldRow
                label="Need"
                field={result.need}
                onApply={(v) => applyField("needSummary", v)}
                applied={applied.has("needSummary")}
              />
              <FieldRow
                label="Timeline"
                field={result.timeline}
              />
              <FieldRow
                label="Configuration"
                field={result.configuration}
                onApply={(v) => applyField("configuration", v)}
                applied={applied.has("configuration")}
              />
              <FieldRow
                label="Location"
                field={result.locationPreference}
              />
              <FieldRow
                label="Purpose"
                field={result.purpose}
              />
              {!result.budget && !result.authority && !result.need && !result.timeline &&
               !result.configuration && !result.locationPreference && !result.purpose && (
                <p className="text-sm text-gray-500 py-2">No BANT fields extracted from the conversation history.</p>
              )}
            </div>
          )}

          {/* ── Projects tab ─────────────────────────────────────────────── */}
          {tab === "projects" && (
            <div>
              {result.projectsDiscussed && result.projectsDiscussed.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-[10px] text-gray-500 mb-2">
                    AI-detected projects are added to the "Suggested" queue below. Accept or reject each one.
                  </p>
                  {result.projectsDiscussed.map((p, i) => (
                    <div key={i} className="p-2.5 border border-blue-200 bg-blue-50/60 rounded-lg">
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <span className="text-sm font-semibold text-gray-800">{p.name}</span>
                          <span className="ml-2"><ConfidencePip confidence={p.confidence} /></span>
                        </div>
                      </div>
                      <EvidenceChip sourceText={p.sourceText} sourceDate={p.sourceDate} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 py-2">
                  No project names found in the conversation history.
                  Projects are only detected when the exact project name appears in the text.
                </p>
              )}
            </div>
          )}

          {/* ── Insights tab ─────────────────────────────────────────────── */}
          {tab === "insights" && (
            <div className="space-y-4">
              {result.buyingSignals && result.buyingSignals.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-emerald-700 mb-1.5">✅ BUYING SIGNALS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.buyingSignals.map((s, i) => (
                      <span key={i} className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-full px-2.5 py-0.5">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {result.objections && result.objections.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold text-red-600 mb-1.5">⚠️ OBJECTIONS</div>
                  <div className="flex flex-wrap gap-1.5">
                    {result.objections.map((o, i) => (
                      <span key={i} className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-full px-2.5 py-0.5">
                        {o}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(!result.buyingSignals?.length && !result.objections?.length) && (
                <p className="text-sm text-gray-500 py-2">No buying signals or objections detected.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
