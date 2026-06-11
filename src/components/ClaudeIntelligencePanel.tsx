"use client";

import { useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaudeSummary {
  whoIsClient?: string;
  whatTheyWant?: string;
  whatHappenedSoFar?: string;
  buyingJourneyStage?: string;
}
interface WhyNotClosed {
  biggestBlocker?: string;
  hiddenObjection?: string | null;
  missingInformation?: string[];
  buyingTrigger?: string | null;
  delayReason?: string | null;
}
interface ClosingProbability {
  classification?: "VeryHigh" | "High" | "Medium" | "Low" | "Dead";
  percentage?: number;
  reasoning?: string;
}
interface NextBestAction {
  action?: string;
  reasoning?: string;
  urgency?: string;
  specificInstructions?: string;
}
interface CallStrategy {
  objective?: string;
  talkingPoints?: string[];
  questionsToAsk?: string[];
  objectionsToHandle?: string[];
}
interface EmailDraft {
  subject?: string;
  body?: string;
  cta?: string;
}
interface AlternativeProject {
  projectName?: string;
  reason?: string;
  angle?: string;
}
interface RevivalIntelligence {
  isWorthAttempting?: boolean;
  confidence?: number;
  reason?: string;
  angle?: string | null;
  suggestedMessage?: string | null;
}
interface ManagementInsights {
  deservesSeniorAttention?: boolean;
  seniorAttentionReason?: string | null;
  isLowPriority?: boolean;
  lowPriorityReason?: string | null;
  conversionRank?: "Top" | "High" | "Average" | "Low";
  needsEscalation?: boolean;
  escalationReason?: string | null;
  estimatedDaysToClose?: number | null;
}

interface ClaudeResult {
  summary?: ClaudeSummary;
  whyNotClosed?: WhyNotClosed;
  closingProbability?: ClosingProbability;
  nextBestAction?: NextBestAction;
  callStrategy?: CallStrategy;
  whatsAppDraft?: string;
  emailDraft?: EmailDraft;
  alternativeProjects?: AlternativeProject[];
  revivalIntelligence?: RevivalIntelligence;
  managementInsights?: ManagementInsights;
}

interface AnalysisState {
  id: string;
  createdAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  ok: boolean;
  error?: string | null;
  result: ClaudeResult | null;
}

interface Props {
  leadId: string;
  initialAnalysis: AnalysisState | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROB_STYLES: Record<string, string> = {
  VeryHigh: "bg-green-100 text-green-800 border-green-200",
  High:     "bg-blue-100 text-blue-800 border-blue-200",
  Medium:   "bg-amber-100 text-amber-800 border-amber-200",
  Low:      "bg-orange-100 text-orange-800 border-orange-200",
  Dead:     "bg-gray-100 text-gray-500 border-gray-200",
};
const PROB_LABELS: Record<string, string> = {
  VeryHigh: "Very High",
  High:     "High",
  Medium:   "Medium",
  Low:      "Low",
  Dead:     "Dead",
};

const ACTION_ICONS: Record<string, string> = {
  Call: "📞",
  WhatsApp: "💬",
  Email: "📧",
  OfficeMeeting: "🏢",
  VirtualMeeting: "💻",
  SiteVisit: "🏗️",
  LongTermFollowUp: "📅",
  Revival: "🔄",
};
const URGENCY_STYLES: Record<string, string> = {
  Immediate: "text-red-600 font-semibold",
  Today:     "text-orange-600 font-semibold",
  ThisWeek:  "text-amber-600",
  NextWeek:  "text-blue-600",
  NextMonth: "text-gray-500",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-3 py-3 text-sm text-gray-700 space-y-2">{children}</div>}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-gray-400 italic">None identified</span>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-gray-400 mt-0.5 shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ClaudeIntelligencePanel({ leadId, initialAnalysis }: Props) {
  const [analysis, setAnalysis] = useState<AnalysisState | null>(initialAnalysis);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = useCallback(async (reanalyze = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}/ai/claude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reanalyze }),
      });
      const data = await res.json() as { analysisId?: string; result?: ClaudeResult; error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Analysis failed");
        return;
      }
      setAnalysis({
        id: data.analysisId ?? "",
        createdAt: new Date().toISOString(),
        model: "claude-sonnet-4-6",
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        ok: true,
        result: data.result ?? null,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  const r = analysis?.result;
  const prob = r?.closingProbability;
  const nba = r?.nextBestAction;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-900">Claude Intelligence</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 border border-violet-200">
            Claude Sonnet 4.6 · Pilot
          </span>
          {prob?.classification && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PROB_STYLES[prob.classification] ?? ""}`}>
              {prob.percentage != null ? `${prob.percentage}% · ` : ""}{PROB_LABELS[prob.classification] ?? prob.classification}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => runAnalysis(!!analysis)}
          disabled={loading}
          className="text-xs px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-medium transition-colors shrink-0"
        >
          {loading ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze with Claude"}
        </button>
      </div>

      {/* Meta */}
      {analysis && (
        <p className="text-[10px] text-gray-400">
          Analyzed {new Date(analysis.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
          {analysis.inputTokens > 0 && ` · ${analysis.inputTokens + analysis.outputTokens} tokens`}
          {analysis.costMicroUsd > 0 && ` · ~$${(analysis.costMicroUsd / 1_000_000).toFixed(4)}`}
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!analysis && !loading && !error && (
        <div className="text-center py-6 text-sm text-gray-500">
          <div className="text-2xl mb-2">🧠</div>
          <p className="font-medium text-gray-700">Claude Sales Intelligence</p>
          <p className="text-xs mt-1 text-gray-400">Closing probability · Next best action · Call strategy · WhatsApp draft · Revival analysis</p>
        </div>
      )}

      {loading && (
        <div className="text-center py-6 text-sm text-gray-500">
          <div className="animate-spin text-2xl mb-2">⟳</div>
          <p>Claude is analyzing this lead…</p>
          <p className="text-xs text-gray-400 mt-1">Usually 10–20 seconds</p>
        </div>
      )}

      {/* Results */}
      {r && (
        <div className="space-y-2">

          {/* 1. Lead Intelligence Summary */}
          <Section title="Lead Intelligence Summary" defaultOpen>
            {r.summary && (
              <div className="space-y-2">
                {r.summary.whoIsClient && (
                  <div><span className="font-medium text-gray-500 text-xs">Who is the client</span><p className="mt-0.5">{r.summary.whoIsClient}</p></div>
                )}
                {r.summary.whatTheyWant && (
                  <div><span className="font-medium text-gray-500 text-xs">What they want</span><p className="mt-0.5">{r.summary.whatTheyWant}</p></div>
                )}
                {r.summary.whatHappenedSoFar && (
                  <div><span className="font-medium text-gray-500 text-xs">What's happened so far</span><p className="mt-0.5">{r.summary.whatHappenedSoFar}</p></div>
                )}
                {r.summary.buyingJourneyStage && (
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-500 text-xs">Stage</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">{r.summary.buyingJourneyStage}</span>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* 2. Why Not Closed */}
          <Section title="Why Has This Lead Not Closed?" defaultOpen>
            {r.whyNotClosed && (
              <div className="space-y-2">
                {r.whyNotClosed.biggestBlocker && (
                  <div className="bg-red-50 border border-red-100 rounded p-2">
                    <span className="text-xs font-semibold text-red-700">Biggest Blocker</span>
                    <p className="mt-1 text-red-800">{r.whyNotClosed.biggestBlocker}</p>
                  </div>
                )}
                {r.whyNotClosed.hiddenObjection && (
                  <div><span className="font-medium text-gray-500 text-xs">Hidden Objection</span><p className="mt-0.5">{r.whyNotClosed.hiddenObjection}</p></div>
                )}
                {r.whyNotClosed.buyingTrigger && (
                  <div><span className="font-medium text-gray-500 text-xs">Buying Trigger</span><p className="mt-0.5 text-green-700">{r.whyNotClosed.buyingTrigger}</p></div>
                )}
                {r.whyNotClosed.delayReason && (
                  <div><span className="font-medium text-gray-500 text-xs">Delay Reason</span><p className="mt-0.5">{r.whyNotClosed.delayReason}</p></div>
                )}
                {!!r.whyNotClosed.missingInformation?.length && (
                  <div>
                    <span className="font-medium text-gray-500 text-xs">Missing Information</span>
                    <div className="mt-1"><BulletList items={r.whyNotClosed.missingInformation ?? []} /></div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* 3. Closing Probability */}
          {prob && (
            <Section title="Closing Probability" defaultOpen>
              <div className="flex items-center gap-3 mb-2">
                <span className={`text-sm font-bold px-3 py-1 rounded-full border ${PROB_STYLES[prob.classification ?? ""] ?? ""}`}>
                  {PROB_LABELS[prob.classification ?? ""] ?? prob.classification}
                  {prob.percentage != null && ` — ${prob.percentage}%`}
                </span>
              </div>
              {prob.reasoning && <p className="text-gray-600">{prob.reasoning}</p>}
            </Section>
          )}

          {/* 4. Next Best Action */}
          {nba && (
            <Section title="Next Best Action" defaultOpen>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{ACTION_ICONS[nba.action ?? ""] ?? "▶"}</span>
                <span className="font-semibold">{nba.action?.replace(/([A-Z])/g, " $1").trim()}</span>
                {nba.urgency && (
                  <span className={`text-xs ml-1 ${URGENCY_STYLES[nba.urgency] ?? ""}`}>· {nba.urgency}</span>
                )}
              </div>
              {nba.reasoning && <p className="text-gray-600 text-xs">{nba.reasoning}</p>}
              {nba.specificInstructions && (
                <div className="mt-2 bg-amber-50 border border-amber-100 rounded p-2 text-xs text-amber-800">
                  <span className="font-semibold">How: </span>{nba.specificInstructions}
                </div>
              )}
            </Section>
          )}

          {/* 5. Call Strategy */}
          {r.callStrategy && (
            <Section title="Call Strategy">
              <div className="space-y-3">
                {r.callStrategy.objective && (
                  <div className="bg-blue-50 border border-blue-100 rounded p-2">
                    <span className="text-xs font-semibold text-blue-700">Objective</span>
                    <p className="mt-1 text-blue-900 font-medium">{r.callStrategy.objective}</p>
                  </div>
                )}
                {!!r.callStrategy.talkingPoints?.length && (
                  <div>
                    <span className="font-medium text-gray-500 text-xs">Talking Points</span>
                    <div className="mt-1"><BulletList items={r.callStrategy.talkingPoints} /></div>
                  </div>
                )}
                {!!r.callStrategy.questionsToAsk?.length && (
                  <div>
                    <span className="font-medium text-gray-500 text-xs">Questions to Ask</span>
                    <div className="mt-1"><BulletList items={r.callStrategy.questionsToAsk} /></div>
                  </div>
                )}
                {!!r.callStrategy.objectionsToHandle?.length && (
                  <div>
                    <span className="font-medium text-gray-500 text-xs">Objections to Handle</span>
                    <div className="mt-1"><BulletList items={r.callStrategy.objectionsToHandle} /></div>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 6. WhatsApp Draft */}
          {r.whatsAppDraft && (
            <Section title="WhatsApp Draft">
              <div className="flex items-start justify-between gap-2">
                <p className="whitespace-pre-wrap text-gray-700 flex-1">{r.whatsAppDraft}</p>
                <CopyButton text={r.whatsAppDraft} />
              </div>
            </Section>
          )}

          {/* 7. Email Draft */}
          {r.emailDraft && (
            <Section title="Email Draft">
              <div className="space-y-2">
                {r.emailDraft.subject && (
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <span className="text-xs font-semibold text-gray-500">Subject</span>
                      <p className="font-medium">{r.emailDraft.subject}</p>
                    </div>
                    <CopyButton text={`Subject: ${r.emailDraft.subject}\n\n${r.emailDraft.body ?? ""}\n\n${r.emailDraft.cta ?? ""}`} />
                  </div>
                )}
                {r.emailDraft.body && (
                  <div>
                    <span className="text-xs font-semibold text-gray-500">Body</span>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700">{r.emailDraft.body}</p>
                  </div>
                )}
                {r.emailDraft.cta && (
                  <div className="bg-green-50 border border-green-100 rounded p-2">
                    <span className="text-xs font-semibold text-green-700">CTA</span>
                    <p className="mt-0.5 text-green-800">{r.emailDraft.cta}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 8. Alternative Projects */}
          {!!r.alternativeProjects?.length && (
            <Section title="Alternative Project Recommendations">
              <div className="space-y-2">
                {r.alternativeProjects.map((p, i) => (
                  <div key={i} className="border border-gray-100 rounded p-2">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-gray-800">{p.projectName}</span>
                      {p.angle && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{p.angle.replace(/([A-Z])/g, " $1").trim()}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">{p.reason}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 9. Revival Intelligence */}
          {r.revivalIntelligence && (
            <Section title="Revival Intelligence">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.revivalIntelligence.isWorthAttempting ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                    {r.revivalIntelligence.isWorthAttempting ? "Worth Attempting" : "Low Priority"}
                  </span>
                  {r.revivalIntelligence.confidence != null && (
                    <span className="text-xs text-gray-500">{r.revivalIntelligence.confidence}% confidence</span>
                  )}
                </div>
                {r.revivalIntelligence.reason && <p className="text-gray-600">{r.revivalIntelligence.reason}</p>}
                {r.revivalIntelligence.angle && (
                  <div><span className="font-medium text-gray-500 text-xs">Revival Angle</span><p className="mt-0.5 text-blue-700">{r.revivalIntelligence.angle}</p></div>
                )}
                {r.revivalIntelligence.suggestedMessage && (
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-500 text-xs">Suggested Message</span>
                      <CopyButton text={r.revivalIntelligence.suggestedMessage} />
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-2 text-xs">{r.revivalIntelligence.suggestedMessage}</p>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* 10. Management Insights */}
          {r.managementInsights && (
            <Section title="Management Insights">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {r.managementInsights.conversionRank && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">
                      Rank: {r.managementInsights.conversionRank}
                    </span>
                  )}
                  {r.managementInsights.deservesSeniorAttention && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100">⭐ Needs Senior Attention</span>
                  )}
                  {r.managementInsights.needsEscalation && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">🚨 Escalation Needed</span>
                  )}
                  {r.managementInsights.isLowPriority && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-50 text-gray-500 border border-gray-200">Low Priority</span>
                  )}
                  {r.managementInsights.estimatedDaysToClose != null && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">~{r.managementInsights.estimatedDaysToClose}d to close</span>
                  )}
                </div>
                {r.managementInsights.seniorAttentionReason && (
                  <p className="text-xs text-gray-600"><span className="font-medium">Senior attention: </span>{r.managementInsights.seniorAttentionReason}</p>
                )}
                {r.managementInsights.escalationReason && (
                  <p className="text-xs text-red-600"><span className="font-medium">Escalation: </span>{r.managementInsights.escalationReason}</p>
                )}
                {r.managementInsights.lowPriorityReason && (
                  <p className="text-xs text-gray-500"><span className="font-medium">Low priority because: </span>{r.managementInsights.lowPriorityReason}</p>
                )}
              </div>
            </Section>
          )}

        </div>
      )}
    </div>
  );
}
