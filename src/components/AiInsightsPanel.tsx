"use client";

import { useState, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types mirroring the JSON schema in ai-openai.ts
// ─────────────────────────────────────────────────────────────────────────────
type FieldExtItem = {
  currentCrmValue: string | null;
  aiSuggestedValue: string | null;
  confidence: number;
  sourceRemark: string | null;
  reasoning: string;
};

type BantField = {
  value?: string | null;
  range?: string | null;
  currency?: string | null;
  isConfirmed?: boolean;
  decisionMaker?: string | null;
  othersInvolved?: string[];
  configuration?: string | null;
  propertyType?: string | null;
  purpose?: string | null;
  details?: string | null;
  label?: string | null;
  confidence: number;
  sourceRemark: string | null;
};

type ClientInfoField = {
  value: string | boolean | null;
  confidence: number;
  sourceRemark: string | null;
};

type ProjectDiscussed = {
  name: string;
  dateDiscussed: string | null;
  context: string;
  clientReaction: string | null;
  agent: string | null;
  status: string;
  sourceRemark: string;
};

type InterestedProperty = {
  projectName: string;
  configuration: string | null;
  unit: string | null;
  budget: string | null;
  paymentPlanInterest: boolean;
  reasonForInterest: string | null;
  objection: string | null;
  currentStatus: string;
};

type MeetingItem = {
  type: string;
  date: string | null;
  agent?: string | null;
  notes: string | null;
  sourceRemark: string;
  confidence: number;
};

type Objection = {
  type: string;
  description: string;
  handling: string;
  sourceRemark: string | null;
};

type AiResult = {
  summary?: string;
  fieldExtraction?: Record<string, FieldExtItem>;
  bant?: {
    budget?: BantField;
    authority?: BantField;
    need?: BantField;
    timeline?: BantField;
  };
  clientInfo?: Record<string, ClientInfoField>;
  projectsDiscussed?: ProjectDiscussed[];
  interestedProperties?: InterestedProperty[];
  meetings?: {
    completed?: MeetingItem[];
    planned?: Array<{ type: string; date: string | null; notes: string | null; confidence: number }>;
  };
  scheduling?: {
    recommendedNextAction?: string;
    recommendedFollowUpDate?: string | null;
    reason?: string;
    confidence?: number;
    sourceRemark?: string | null;
  };
  leadQuality?: {
    classification?: string;
    closingProbability?: string;
    reason?: string;
    biggestBlocker?: string | null;
    missingInfo?: string[];
    whyNotClosed?: string | null;
    leadStatus?: string;
  };
  objections?: Objection[];
  salesStrategy?: {
    recommendedProject?: string | null;
    recommendedCommunicationChannel?: string;
    recommendedFollowUpTiming?: string;
    alternativeProjects?: string[];
    opportunityAngle?: string | null;
  };
  nextBestAction?: { action: string; reason: string };
  whatsAppDraft?: string;
  emailDraft?: { subject: string; body: string; cta: string };
  callStrategy?: {
    objective?: string;
    talkingPoints?: string[];
    questionsToAsk?: string[];
    objectionsToHandle?: string[];
  };
  fieldsNeedingReview?: Array<{ field: string; reason: string }>;
  overallConfidence?: number;
  abbreviationsFound?: Record<string, string>;
};

type Feedback = {
  id: string;
  fieldName: string;
  action: string;
};

type SavedAnalysis = {
  id: string;
  createdAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  ok: boolean;
  error: string | null;
  result: AiResult | null;
  feedbacks: Feedback[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper components
// ─────────────────────────────────────────────────────────────────────────────
function ConfidenceBadge({ pct }: { pct: number }) {
  const cls = pct >= 80 ? "bg-emerald-100 text-emerald-800 border-emerald-300"
    : pct >= 50 ? "bg-amber-100 text-amber-800 border-amber-300"
    : "bg-red-100 text-red-800 border-red-300";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold ${cls}`}>
      {pct}%
    </span>
  );
}

function SectionHeader({ title, icon }: { title: string; icon: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 border-b border-gray-100 dark:border-slate-700 pb-2">
      <span>{icon}</span>
      <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300 uppercase">{title}</span>
    </div>
  );
}

function SourceTag({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="mt-1 text-[10px] text-gray-400 dark:text-slate-500 italic truncate" title={text}>
      Source: {text}
    </div>
  );
}

// Accept / Edit / Reject controls
function FeedbackControls({
  analysisId,
  leadId,
  fieldName,
  aiValue,
  existingAction,
  onDone,
}: {
  analysisId: string;
  leadId: string;
  fieldName: string;
  aiValue: string;
  existingAction?: string;
  onDone: (action: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(aiValue);

  const submit = useCallback(async (action: "ACCEPT" | "EDIT" | "REJECT", editedValue?: string) => {
    setSubmitting(true);
    await fetch(`/api/leads/${leadId}/ai/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysisId, fieldName, aiValue, action, editedValue }),
    });
    setSubmitting(false);
    setEditing(false);
    onDone(action);
  }, [analysisId, leadId, fieldName, aiValue, onDone]);

  if (existingAction) {
    const cls = existingAction === "ACCEPT" ? "text-emerald-600" : existingAction === "REJECT" ? "text-red-500" : "text-blue-600";
    return <span className={`text-[10px] font-semibold ${cls}`}>{existingAction === "ACCEPT" ? "✓ Accepted" : existingAction === "REJECT" ? "✗ Rejected" : "✏ Edited"}</span>;
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1 mt-1">
        <textarea
          value={editVal}
          onChange={e => setEditVal(e.target.value)}
          rows={2}
          className="text-xs border rounded px-2 py-1 w-full dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100"
        />
        <div className="flex gap-1">
          <button onClick={() => submit("EDIT", editVal)} disabled={submitting} className="text-[10px] px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">Save</button>
          <button onClick={() => setEditing(false)} className="text-[10px] px-2 py-0.5 border rounded dark:border-slate-600">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-1 mt-1">
      <button onClick={() => submit("ACCEPT")} disabled={submitting} className="text-[10px] px-2 py-0.5 bg-emerald-100 text-emerald-700 border border-emerald-300 rounded hover:bg-emerald-200 disabled:opacity-50">✓ Accept</button>
      <button onClick={() => setEditing(true)} disabled={submitting} className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-300 rounded hover:bg-blue-100 disabled:opacity-50">✏ Edit</button>
      <button onClick={() => submit("REJECT")} disabled={submitting} className="text-[10px] px-2 py-0.5 bg-red-50 text-red-700 border border-red-300 rounded hover:bg-red-100 disabled:opacity-50">✗ Reject</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy button
// ─────────────────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className="text-[10px] px-2 py-0.5 border rounded dark:border-slate-600 text-gray-500 hover:text-gray-800 dark:hover:text-slate-100"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section: Field Extraction Table
// ─────────────────────────────────────────────────────────────────────────────
const FIELD_LABELS: Record<string, string> = {
  budget: "Budget", authority: "Authority", need: "Need", timeline: "Timeline",
  profession: "Profession", company: "Company", city: "City", country: "Country",
  configuration: "Configuration", meetingStatus: "Meeting Status",
  siteVisitStatus: "Site Visit Status", virtualMeetingStatus: "Virtual Meeting Status",
  nextAction: "Next Action", leadTemperature: "Lead Temperature",
  objection: "Objection", decisionMaker: "Decision Maker",
  familyInvolvement: "Family Involvement", investmentPurpose: "Investment Purpose",
};

function FieldExtractionTable({
  data, analysisId, leadId, feedbacks,
}: {
  data: Record<string, FieldExtItem>;
  analysisId: string;
  leadId: string;
  feedbacks: Feedback[];
}) {
  const [localFeedback, setLocalFeedback] = useState<Record<string, string>>({});

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-[10px] text-gray-500 dark:text-slate-400 border-b dark:border-slate-700">
            <th className="text-left py-1 pr-3 font-semibold">Field</th>
            <th className="text-left py-1 pr-3 font-semibold">CRM Value</th>
            <th className="text-left py-1 pr-3 font-semibold">AI Suggested</th>
            <th className="text-left py-1 pr-3 font-semibold">Conf.</th>
            <th className="text-left py-1 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([key, item]) => {
            const existingFb = feedbacks.find(f => f.fieldName === key);
            const localAct = localFeedback[key];
            const action = localAct ?? existingFb?.action;
            const rowCls = action === "ACCEPT" ? "bg-emerald-50/50 dark:bg-emerald-900/10"
              : action === "REJECT" ? "bg-red-50/50 dark:bg-red-900/10"
              : action === "EDIT" ? "bg-blue-50/50 dark:bg-blue-900/10"
              : "";

            return (
              <tr key={key} className={`border-b dark:border-slate-700/50 ${rowCls}`}>
                <td className="py-1.5 pr-3 font-medium text-gray-700 dark:text-slate-300 align-top whitespace-nowrap">
                  {FIELD_LABELS[key] ?? key}
                </td>
                <td className="py-1.5 pr-3 text-gray-500 dark:text-slate-400 align-top">
                  {item.currentCrmValue ?? <span className="italic text-gray-300">—</span>}
                </td>
                <td className="py-1.5 pr-3 align-top">
                  <div className="font-medium text-gray-800 dark:text-slate-100">
                    {item.aiSuggestedValue ?? <span className="italic text-gray-300">Not detected</span>}
                  </div>
                  {item.reasoning && (
                    <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{item.reasoning}</div>
                  )}
                  <SourceTag text={item.sourceRemark} />
                </td>
                <td className="py-1.5 pr-3 align-top">
                  <ConfidenceBadge pct={item.confidence} />
                </td>
                <td className="py-1.5 align-top">
                  {item.aiSuggestedValue ? (
                    <FeedbackControls
                      analysisId={analysisId}
                      leadId={leadId}
                      fieldName={key}
                      aiValue={item.aiSuggestedValue}
                      existingAction={action}
                      onDone={act => setLocalFeedback(prev => ({ ...prev, [key]: act }))}
                    />
                  ) : <span className="text-[10px] text-gray-300">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Collapsible section wrapper
// ─────────────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  title, icon, children, defaultOpen = false,
}: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 dark:border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 bg-gray-50 dark:bg-slate-800/50 hover:bg-gray-100 dark:hover:bg-slate-700/50 text-left"
      >
        <div className="flex items-center gap-2">
          <span>{icon}</span>
          <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300 uppercase">{title}</span>
        </div>
        <span className="text-gray-400 dark:text-slate-500 text-sm">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────
export default function AiInsightsPanel({
  leadId,
  initialAnalysis,
}: {
  leadId: string;
  initialAnalysis: SavedAnalysis | null;
}) {
  const [analysis, setAnalysis] = useState<SavedAnalysis | null>(initialAnalysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async (reanalyze = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/ai/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reanalyze }),
      });
      const data = await res.json() as { analysisId?: string; result?: AiResult; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Analysis failed");
        return;
      }
      // Reload the full analysis (with feedbacks)
      const getRes = await fetch(`/api/leads/${leadId}/ai/analyze`);
      const getData = await getRes.json() as { analysis: SavedAnalysis | null };
      setAnalysis(getData.analysis);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  const r = analysis?.result;

  const qualityColor = (c?: string) => {
    if (c === "Hot") return "text-red-600 bg-red-50 border-red-300";
    if (c === "Warm") return "text-amber-700 bg-amber-50 border-amber-300";
    if (c === "Cold") return "text-blue-600 bg-blue-50 border-blue-300";
    if (c === "RevivalCandidate") return "text-purple-600 bg-purple-50 border-purple-300";
    return "text-gray-600 bg-gray-50 border-gray-300";
  };

  const probColor = (p?: string) => {
    if (p === "High") return "text-emerald-700 font-bold";
    if (p === "Medium") return "text-amber-700 font-semibold";
    return "text-red-600";
  };

  return (
    <div className="space-y-3">
      {/* Header bar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-800 dark:text-slate-100">AI Copilot</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 border border-violet-300 rounded font-semibold">GPT-4.1 Mini • Pilot</span>
          {r && <span className="text-[10px] text-gray-400">Overall confidence: <ConfidenceBadge pct={r.overallConfidence ?? 0} /></span>}
        </div>
        <div className="flex gap-2">
          {!analysis ? (
            <button
              onClick={() => runAnalysis(false)}
              disabled={loading}
              className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 font-semibold"
            >
              {loading ? "Analyzing…" : "Analyze Lead"}
            </button>
          ) : (
            <button
              onClick={() => runAnalysis(true)}
              disabled={loading}
              className="text-xs px-3 py-1.5 border border-violet-400 text-violet-600 rounded hover:bg-violet-50 disabled:opacity-50 font-semibold dark:hover:bg-violet-900/20"
            >
              {loading ? "Analyzing…" : "Re-analyze Lead"}
            </button>
          )}
        </div>
      </div>

      {/* Loading spinner */}
      {loading && (
        <div className="flex items-center gap-3 p-4 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
          <div className="animate-spin w-5 h-5 border-2 border-violet-600 border-t-transparent rounded-full" />
          <div className="text-sm text-violet-700 dark:text-violet-300">
            GPT-4.1 Mini is reading the full conversation history…
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && !analysis && (
        <div className="p-6 rounded-lg border-2 border-dashed border-violet-200 dark:border-violet-800 text-center">
          <div className="text-3xl mb-2">🤖</div>
          <div className="text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">AI Insights not yet generated</div>
          <div className="text-xs text-gray-500 dark:text-slate-400">Click "Analyze Lead" to have GPT-4.1 Mini read the full conversation history and produce structured insights.</div>
        </div>
      )}

      {/* Analysis results */}
      {r && analysis && (
        <div className="space-y-2">
          {/* Meta info */}
          <div className="text-[10px] text-gray-400 dark:text-slate-500">
            Analyzed {new Date(analysis.createdAt).toLocaleString("en-IN")} · {analysis.model} · {analysis.inputTokens + analysis.outputTokens} tokens · ~${((analysis.costMicroUsd) / 1_000_000).toFixed(4)} USD
          </div>

          {/* 1. AI Lead Summary */}
          {r.summary && (
            <div className="p-3 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-700">
              <SectionHeader title="AI Lead Summary" icon="📋" />
              <p className="text-sm text-gray-700 dark:text-slate-200">{r.summary}</p>
            </div>
          )}

          {/* 2. Lead Quality + Next Best Action — always visible */}
          {r.leadQuality && (
            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700">
              <SectionHeader title="Lead Quality & Closing Probability" icon="🎯" />
              <div className="flex flex-wrap gap-3 mb-3">
                <span className={`px-3 py-1 rounded-full border text-sm font-bold ${qualityColor(r.leadQuality.classification)}`}>
                  {r.leadQuality.classification?.replace(/([A-Z])/g, " $1").trim()}
                </span>
                <div className="text-sm">
                  Closing: <span className={probColor(r.leadQuality.closingProbability)}>{r.leadQuality.closingProbability}</span>
                </div>
              </div>
              {r.leadQuality.reason && <p className="text-xs text-gray-600 dark:text-slate-300 mb-2">{r.leadQuality.reason}</p>}
              {r.leadQuality.biggestBlocker && (
                <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded p-2 mb-2">
                  🚧 <strong>Biggest Blocker:</strong> {r.leadQuality.biggestBlocker}
                </div>
              )}
              {r.leadQuality.whyNotClosed && (
                <div className="text-xs text-gray-600 dark:text-slate-300 mb-2">
                  <strong>Why not closed:</strong> {r.leadQuality.whyNotClosed}
                </div>
              )}
              {r.leadQuality.missingInfo && r.leadQuality.missingInfo.length > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>Missing info:</strong> {r.leadQuality.missingInfo.join(", ")}
                </div>
              )}
            </div>
          )}

          {/* Next Best Action */}
          {r.nextBestAction && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700">
              <SectionHeader title="Next Best Action" icon="⚡" />
              <div className="text-sm font-bold text-emerald-800 dark:text-emerald-200 mb-1">{r.nextBestAction.action}</div>
              <div className="text-xs text-emerald-700 dark:text-emerald-300">{r.nextBestAction.reason}</div>
            </div>
          )}

          {/* 3. BANT */}
          <CollapsibleSection title="BANT Extraction" icon="📊" defaultOpen>
            {r.bant ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Budget */}
                <div className="p-2.5 rounded border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-700">
                  <div className="text-[10px] font-bold tracking-widest text-blue-700 dark:text-blue-300 mb-1">💰 BUDGET</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                    {r.bant.budget?.range ?? r.bant.budget?.value ?? "Not detected"}
                    {r.bant.budget?.currency ? ` (${r.bant.budget.currency})` : ""}
                  </div>
                  {r.bant.budget?.isConfirmed !== undefined && (
                    <div className="text-[10px] mt-0.5">{r.bant.budget.isConfirmed ? "✅ Confirmed" : "⚠ Assumed"}</div>
                  )}
                  <ConfidenceBadge pct={r.bant.budget?.confidence ?? 0} />
                  <SourceTag text={r.bant.budget?.sourceRemark} />
                </div>
                {/* Authority */}
                <div className="p-2.5 rounded border border-purple-200 bg-purple-50 dark:bg-purple-900/20 dark:border-purple-700">
                  <div className="text-[10px] font-bold tracking-widest text-purple-700 dark:text-purple-300 mb-1">👤 AUTHORITY</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                    {r.bant.authority?.decisionMaker ?? "Not detected"}
                  </div>
                  {r.bant.authority?.othersInvolved && r.bant.authority.othersInvolved.length > 0 && (
                    <div className="text-[10px] mt-0.5 text-purple-600">Also: {r.bant.authority.othersInvolved.join(", ")}</div>
                  )}
                  <ConfidenceBadge pct={r.bant.authority?.confidence ?? 0} />
                  <SourceTag text={r.bant.authority?.sourceRemark} />
                </div>
                {/* Need */}
                <div className="p-2.5 rounded border border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-700">
                  <div className="text-[10px] font-bold tracking-widest text-emerald-700 dark:text-emerald-300 mb-1">🏠 NEED</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                    {r.bant.need?.configuration ?? r.bant.need?.propertyType ?? "Not detected"}
                  </div>
                  {r.bant.need?.purpose && <div className="text-[10px] mt-0.5 text-emerald-600">{r.bant.need.purpose}</div>}
                  {r.bant.need?.details && <div className="text-[10px] text-gray-500 dark:text-slate-400">{r.bant.need.details}</div>}
                  <ConfidenceBadge pct={r.bant.need?.confidence ?? 0} />
                  <SourceTag text={r.bant.need?.sourceRemark} />
                </div>
                {/* Timeline */}
                <div className="p-2.5 rounded border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
                  <div className="text-[10px] font-bold tracking-widest text-amber-700 dark:text-amber-300 mb-1">⏰ TIMELINE</div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                    {r.bant.timeline?.label?.replace(/([A-Z])/g, " $1").trim() ?? "Not detected"}
                  </div>
                  {r.bant.timeline?.details && <div className="text-[10px] mt-0.5 text-gray-500 dark:text-slate-400">{r.bant.timeline.details}</div>}
                  <ConfidenceBadge pct={r.bant.timeline?.confidence ?? 0} />
                  <SourceTag text={r.bant.timeline?.sourceRemark} />
                </div>
              </div>
            ) : <div className="text-xs text-gray-400">No BANT data extracted.</div>}
          </CollapsibleSection>

          {/* 4. Field Extraction Testing Layer */}
          {r.fieldExtraction && (
            <CollapsibleSection title="AI Field Extraction (Testing Layer)" icon="🔬">
              <p className="text-[10px] text-gray-400 dark:text-slate-500 mb-3">
                Compare AI-suggested values vs current CRM values. Accept/Edit/Reject each suggestion. Nothing is saved automatically.
              </p>
              <FieldExtractionTable
                data={r.fieldExtraction}
                analysisId={analysis.id}
                leadId={leadId}
                feedbacks={analysis.feedbacks}
              />
            </CollapsibleSection>
          )}

          {/* 5. Projects Discussed */}
          {r.projectsDiscussed && r.projectsDiscussed.length > 0 && (
            <CollapsibleSection title="Projects Discussed" icon="🏗️">
              <div className="space-y-2">
                {r.projectsDiscussed.map((p, i) => (
                  <div key={i} className="p-2 rounded border border-gray-100 dark:border-slate-700 text-xs">
                    <div className="font-semibold text-gray-800 dark:text-slate-100">{p.name}</div>
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      <span className="text-gray-500">{p.dateDiscussed ?? "Date unknown"}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        p.status === "liked" || p.status === "shortlisted" ? "bg-emerald-100 text-emerald-700"
                        : p.status === "rejected" ? "bg-red-100 text-red-700"
                        : p.status === "visited" ? "bg-blue-100 text-blue-700"
                        : "bg-gray-100 text-gray-600"
                      }`}>{p.status}</span>
                    </div>
                    {p.clientReaction && <div className="mt-1 text-gray-600 dark:text-slate-300">Reaction: {p.clientReaction}</div>}
                    {p.agent && <div className="text-gray-400">Agent: {p.agent}</div>}
                    <SourceTag text={p.sourceRemark} />
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* 6. Interested Properties */}
          {r.interestedProperties && r.interestedProperties.length > 0 && (
            <CollapsibleSection title="Genuinely Interested Properties" icon="⭐">
              <div className="space-y-2">
                {r.interestedProperties.map((p, i) => (
                  <div key={i} className="p-2 rounded border border-amber-100 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-900/10 text-xs">
                    <div className="font-semibold text-gray-800 dark:text-slate-100">{p.projectName}</div>
                    <div className="flex flex-wrap gap-2 mt-0.5">
                      {p.configuration && <span className="text-gray-600">{p.configuration}</span>}
                      {p.budget && <span className="text-emerald-700 font-medium">{p.budget}</span>}
                      {p.paymentPlanInterest && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 rounded">Payment plan interest</span>}
                    </div>
                    {p.reasonForInterest && <div className="mt-1 text-gray-600 dark:text-slate-300">Why: {p.reasonForInterest}</div>}
                    {p.objection && <div className="text-red-600 dark:text-red-400 mt-0.5">Objection: {p.objection}</div>}
                    <div className="text-gray-400 mt-0.5">{p.currentStatus}</div>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* 7. Meetings */}
          {r.meetings && (
            <CollapsibleSection title="Meetings / Site Visits / Virtual Meetings" icon="📅">
              {r.meetings.completed && r.meetings.completed.length > 0 && (
                <div className="mb-3">
                  <div className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 mb-2">COMPLETED</div>
                  <div className="space-y-2">
                    {r.meetings.completed.map((m, i) => (
                      <div key={i} className="p-2 rounded border border-emerald-100 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-900/10 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{m.type}</span>
                          {m.date && <span className="text-gray-500">{m.date}</span>}
                          {m.agent && <span className="text-gray-400">by {m.agent}</span>}
                          <ConfidenceBadge pct={m.confidence} />
                        </div>
                        {m.notes && <div className="mt-0.5 text-gray-600 dark:text-slate-300">{m.notes}</div>}
                        <SourceTag text={m.sourceRemark} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {r.meetings.planned && r.meetings.planned.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-amber-700 dark:text-amber-400 mb-2">PLANNED / SCHEDULED</div>
                  <div className="space-y-2">
                    {r.meetings.planned.map((m, i) => (
                      <div key={i} className="p-2 rounded border border-amber-100 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-900/10 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{m.type}</span>
                          {m.date && <span className="text-gray-500">{m.date}</span>}
                          <ConfidenceBadge pct={m.confidence} />
                        </div>
                        {m.notes && <div className="mt-0.5 text-gray-600 dark:text-slate-300">{m.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(!r.meetings.completed?.length && !r.meetings.planned?.length) && (
                <div className="text-xs text-gray-400">No meetings detected.</div>
              )}
            </CollapsibleSection>
          )}

          {/* 8. Scheduling & Next Action */}
          {r.scheduling && r.scheduling.recommendedNextAction && (
            <CollapsibleSection title="Scheduling & Next Action" icon="📌">
              <div className="space-y-2 text-xs">
                <div><strong>Recommended Action:</strong> {r.scheduling.recommendedNextAction}</div>
                {r.scheduling.recommendedFollowUpDate && (
                  <div><strong>Follow-up Date:</strong> {r.scheduling.recommendedFollowUpDate}</div>
                )}
                <div className="text-gray-600 dark:text-slate-300">{r.scheduling.reason}</div>
                {r.scheduling.confidence !== undefined && <ConfidenceBadge pct={r.scheduling.confidence} />}
                <SourceTag text={r.scheduling.sourceRemark} />
              </div>
            </CollapsibleSection>
          )}

          {/* 9. Objections */}
          {r.objections && r.objections.length > 0 && (
            <CollapsibleSection title="Objections Detected" icon="⚠️">
              <div className="space-y-2">
                {r.objections.map((o, i) => (
                  <div key={i} className="p-2 rounded border border-red-100 dark:border-red-800/40 bg-red-50/50 dark:bg-red-900/10 text-xs">
                    <div className="font-semibold text-red-700 dark:text-red-300">{o.type}</div>
                    <div className="text-gray-700 dark:text-slate-200 mt-0.5">{o.description}</div>
                    <div className="text-emerald-700 dark:text-emerald-300 mt-1">💡 Handling: {o.handling}</div>
                    <SourceTag text={o.sourceRemark} />
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* 10. Sales Strategy */}
          {r.salesStrategy && (
            <CollapsibleSection title="Sales Strategy" icon="🎲">
              <div className="space-y-2 text-xs">
                {r.salesStrategy.recommendedProject && (
                  <div><strong>Recommended Project:</strong> {r.salesStrategy.recommendedProject}</div>
                )}
                {r.salesStrategy.recommendedCommunicationChannel && (
                  <div><strong>Best Channel:</strong> {r.salesStrategy.recommendedCommunicationChannel}</div>
                )}
                {r.salesStrategy.recommendedFollowUpTiming && (
                  <div><strong>Follow-up Timing:</strong> {r.salesStrategy.recommendedFollowUpTiming}</div>
                )}
                {r.salesStrategy.alternativeProjects && r.salesStrategy.alternativeProjects.length > 0 && (
                  <div><strong>Alt Projects:</strong> {r.salesStrategy.alternativeProjects.join(", ")}</div>
                )}
                {r.salesStrategy.opportunityAngle && (
                  <div className="text-emerald-700 dark:text-emerald-300">{r.salesStrategy.opportunityAngle}</div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* 11. WhatsApp Draft */}
          {r.whatsAppDraft && (
            <CollapsibleSection title="WhatsApp Draft" icon="💬">
              <div className="relative">
                <div className="p-3 rounded bg-[#dcf8c6] dark:bg-emerald-900/30 border border-[#b7e4a0] dark:border-emerald-700 text-sm text-gray-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed font-sans">
                  {r.whatsAppDraft}
                </div>
                <div className="mt-2">
                  <CopyButton text={r.whatsAppDraft} />
                </div>
              </div>
            </CollapsibleSection>
          )}

          {/* 12. Email Draft */}
          {r.emailDraft?.body && (
            <CollapsibleSection title="Email Draft" icon="📧">
              <div className="space-y-2 text-xs">
                <div><strong>Subject:</strong> {r.emailDraft.subject}</div>
                <div className="p-3 rounded border dark:border-slate-700 bg-white dark:bg-slate-800 whitespace-pre-wrap">{r.emailDraft.body}</div>
                <div><strong>CTA:</strong> {r.emailDraft.cta}</div>
                <CopyButton text={`Subject: ${r.emailDraft.subject}\n\n${r.emailDraft.body}`} />
              </div>
            </CollapsibleSection>
          )}

          {/* 13. Call Strategy */}
          {r.callStrategy?.objective && (
            <CollapsibleSection title="Call Strategy" icon="📞">
              <div className="space-y-2 text-xs">
                <div><strong>Objective:</strong> {r.callStrategy.objective}</div>
                {r.callStrategy.talkingPoints && r.callStrategy.talkingPoints.length > 0 && (
                  <div>
                    <strong>Talking Points:</strong>
                    <ul className="list-disc ml-4 mt-1 space-y-0.5">{r.callStrategy.talkingPoints.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
                {r.callStrategy.questionsToAsk && r.callStrategy.questionsToAsk.length > 0 && (
                  <div>
                    <strong>Questions to Ask:</strong>
                    <ul className="list-disc ml-4 mt-1 space-y-0.5">{r.callStrategy.questionsToAsk.map((q, i) => <li key={i}>{q}</li>)}</ul>
                  </div>
                )}
                {r.callStrategy.objectionsToHandle && r.callStrategy.objectionsToHandle.length > 0 && (
                  <div>
                    <strong>Expected Objections:</strong>
                    <ul className="list-disc ml-4 mt-1 space-y-0.5">{r.callStrategy.objectionsToHandle.map((o, i) => <li key={i}>{o}</li>)}</ul>
                  </div>
                )}
              </div>
            </CollapsibleSection>
          )}

          {/* 14. Client Info Extracted */}
          {r.clientInfo && Object.keys(r.clientInfo).some(k => r.clientInfo![k]?.value != null) && (
            <CollapsibleSection title="Client Information Extracted" icon="👤">
              <div className="space-y-1.5">
                {Object.entries(r.clientInfo).map(([key, item]) => {
                  if (item?.value == null) return null;
                  return (
                    <div key={key} className="flex items-start gap-2 text-xs py-1 border-b dark:border-slate-700/50 last:border-0">
                      <span className="w-32 shrink-0 text-gray-500 capitalize">{key.replace(/([A-Z])/g, " $1")}</span>
                      <span className="text-gray-800 dark:text-slate-100 font-medium">{String(item.value)}</span>
                      <ConfidenceBadge pct={item.confidence} />
                      {item.sourceRemark && <span className="text-gray-400 italic text-[10px] truncate max-w-[200px]" title={item.sourceRemark}>{item.sourceRemark}</span>}
                    </div>
                  );
                })}
              </div>
            </CollapsibleSection>
          )}

          {/* 15. Fields Needing Human Review */}
          {r.fieldsNeedingReview && r.fieldsNeedingReview.length > 0 && (
            <CollapsibleSection title="Fields Needing Human Review" icon="🔍">
              <div className="space-y-1">
                {r.fieldsNeedingReview.map((f, i) => (
                  <div key={i} className="text-xs flex gap-2">
                    <span className="font-medium text-amber-700 dark:text-amber-300">{f.field}:</span>
                    <span className="text-gray-600 dark:text-slate-300">{f.reason}</span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}

          {/* 16. Abbreviations found */}
          {r.abbreviationsFound && Object.keys(r.abbreviationsFound).length > 0 && (
            <CollapsibleSection title="Abbreviations Found in Remarks" icon="📖">
              <div className="flex flex-wrap gap-2">
                {Object.entries(r.abbreviationsFound).map(([abbr, meaning]) => (
                  <div key={abbr} className="text-[10px] px-2 py-1 bg-gray-100 dark:bg-slate-700 rounded border dark:border-slate-600">
                    <strong>{abbr}</strong> = {meaning}
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  );
}
