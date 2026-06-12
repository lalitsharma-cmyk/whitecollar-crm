"use client";

import { useState, useCallback } from "react";
import type { IntelligenceResult } from "@/lib/ai-intelligence-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalysisState {
  id: string;
  createdAt: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  ok: boolean;
  error?: string | null;
  result: IntelligenceResult | null;
}

interface Props {
  leadId: string;
  claudeEnabled: boolean;
  gptEnabled: boolean;
  geminiEnabled: boolean;
  initialClaude: AnalysisState | null;
  initialGpt: AnalysisState | null;
  initialGemini: AnalysisState | null;
}

type ModelKey = "claude" | "gpt" | "gemini";
type ViewMode = "tabs" | "compare";

const MODEL_CONFIG: Record<ModelKey, {
  label: string;
  badge: string;
  color: string;
  bgColor: string;
  borderColor: string;
  badgeClass: string;
  endpoint: string;
}> = {
  claude: {
    label: "Claude Sonnet 4.6",
    badge: "Anthropic",
    color: "text-violet-700",
    bgColor: "bg-violet-50",
    borderColor: "border-violet-200",
    badgeClass: "bg-violet-100 text-violet-700 border-violet-200",
    endpoint: "claude",
  },
  gpt: {
    label: "GPT-4.1 Mini",
    badge: "OpenAI",
    color: "text-emerald-700",
    bgColor: "bg-emerald-50",
    borderColor: "border-emerald-200",
    badgeClass: "bg-emerald-100 text-emerald-700 border-emerald-200",
    endpoint: "gpt-intelligence",
  },
  gemini: {
    label: "Gemini 2.5 Flash",
    badge: "Google",
    color: "text-blue-700",
    bgColor: "bg-blue-50",
    borderColor: "border-blue-200",
    badgeClass: "bg-blue-100 text-blue-700 border-blue-200",
    endpoint: "gemini-intelligence",
  },
};

const PROB_STYLES: Record<string, string> = {
  VeryHigh: "bg-green-100 text-green-800 border-green-200",
  High:     "bg-blue-100 text-blue-800 border-blue-200",
  Medium:   "bg-amber-100 text-amber-800 border-amber-200",
  Low:      "bg-orange-100 text-orange-800 border-orange-200",
  Dead:     "bg-gray-100 text-gray-500 border-gray-200",
};

const AUTOMATION_STATUS_STYLES: Record<string, string> = {
  Possible: "bg-green-100 text-green-700",
  PartiallyPossible: "bg-amber-100 text-amber-700",
  NotRecommended: "bg-red-100 text-red-700",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
      className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors shrink-0">
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Section({ title, children, defaultOpen = false, accent }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean; accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`border rounded-lg overflow-hidden ${accent ?? "border-gray-100"}`}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors text-left">
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{title}</span>
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="px-3 py-3 text-sm text-gray-700 space-y-2">{children}</div>}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-gray-400 italic text-xs">None identified</span>;
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="text-gray-400 mt-0.5 shrink-0">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 80 ? "bg-green-500" : value >= 60 ? "bg-amber-500" : value >= 40 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-44 shrink-0 truncate">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
        <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold text-gray-700 w-8 text-right">{value}</span>
    </div>
  );
}

// ─── Model Result Panel (shared renderer for all 3 models) ────────────────────

function ModelResultPanel({ r, cfg }: { r: IntelligenceResult; cfg: typeof MODEL_CONFIG[ModelKey] }) {
  const prob = r.closingProbability;
  return (
    <div className="space-y-2">

      {/* Summary banner */}
      <div className={`rounded-lg p-3 border ${cfg.borderColor} ${cfg.bgColor}`}>
        <div className="text-xs font-semibold text-gray-600 mb-1">ONE-LINER VERDICT</div>
        <p className="font-medium text-gray-800">{r.summary?.oneLinerVerdict ?? r.summary?.whoIsClient}</p>
        {r.summary?.buyingJourneyStage && (
          <span className="mt-1.5 inline-block text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-600">
            Stage: {r.summary.buyingJourneyStage}
          </span>
        )}
      </div>

      {/* Closing probability + WCR Score side by side */}
      <div className="grid grid-cols-2 gap-2">
        {prob && (
          <div className={`rounded-lg p-3 border text-center ${PROB_STYLES[prob.classification] ?? "border-gray-100"}`}>
            <div className="text-[10px] font-bold uppercase tracking-widest opacity-70 mb-1">Closing Probability</div>
            <div className="text-xl font-black">{prob.percentage}%</div>
            <div className="text-xs font-semibold">{prob.classification}</div>
          </div>
        )}
        {r.wcrIntelligenceScore && (
          <div className="rounded-lg p-3 border border-gray-200 bg-gray-50 text-center">
            <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">WCR Score</div>
            <div className="text-xl font-black text-gray-800">{r.wcrIntelligenceScore.total}<span className="text-sm font-normal text-gray-400">/100</span></div>
            <div className="text-xs text-gray-500">{r.wcrIntelligenceScore.strongestArea}</div>
          </div>
        )}
      </div>

      {/* 1. Sales Director Test */}
      <Section title="🎯 Sales Director — What To Do" defaultOpen accent="border-amber-200">
        {r.salesDirectorTest && (
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-100 rounded p-2">
              <div className="text-xs font-semibold text-amber-800 mb-1">What I would do next</div>
              <p className="text-amber-900">{r.salesDirectorTest.whatWouldIDoNext}</p>
            </div>
            <div><span className="text-xs font-medium text-gray-500">Why: </span><span className="text-sm">{r.salesDirectorTest.why}</span></div>
            <div className="bg-red-50 border border-red-100 rounded p-2">
              <span className="text-xs font-semibold text-red-700">⚠ Absolutely avoid: </span>
              <span className="text-sm text-red-800">{r.salesDirectorTest.whatToAbsolutelyAvoid}</span>
            </div>
            <div className="grid grid-cols-1 gap-1.5 mt-2">
              {[
                { label: "⚡ Fastest path to response", value: r.salesDirectorTest.fastestPathToResponse },
                { label: "🤝 Fastest path to meeting", value: r.salesDirectorTest.fastestPathToMeeting },
                { label: "🏗️ Fastest path to site visit", value: r.salesDirectorTest.fastestPathToSiteVisit },
                { label: "🔑 Fastest path to closure", value: r.salesDirectorTest.fastestPathToClosure },
              ].map(({ label, value }) => value ? (
                <div key={label} className="text-xs bg-white border border-gray-100 rounded p-2">
                  <span className="font-semibold text-gray-600">{label}: </span>
                  <span className="text-gray-700">{value}</span>
                </div>
              ) : null)}
            </div>
            {r.salesDirectorTest.shouldLalitPersonallyIntervene && (
              <div className="bg-purple-50 border border-purple-200 rounded p-2">
                <span className="text-xs font-semibold text-purple-700">⭐ Lalit should personally intervene: </span>
                <span className="text-sm text-purple-800">{r.salesDirectorTest.lalitInterventionReason}</span>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 2. Why Not Closed */}
      <Section title="❌ Why Not Closed" defaultOpen>
        {r.whyNotClosed && (
          <div className="space-y-2">
            <div className="bg-red-50 border border-red-100 rounded p-2">
              <span className="text-xs font-semibold text-red-700">Biggest Blocker: </span>
              <span className="text-red-800">{r.whyNotClosed.biggestBlocker}</span>
            </div>
            {r.whyNotClosed.hiddenObjection && (
              <div><span className="text-xs font-medium text-gray-500">Hidden objection: </span>{r.whyNotClosed.hiddenObjection}</div>
            )}
            {r.whyNotClosed.buyingTrigger && (
              <div className="text-green-700"><span className="text-xs font-medium text-gray-500">Buying trigger: </span>{r.whyNotClosed.buyingTrigger}</div>
            )}
            {r.whyNotClosed.delayReason && (
              <div><span className="text-xs font-medium text-gray-500">Delay reason: </span>{r.whyNotClosed.delayReason}</div>
            )}
            {!!r.whyNotClosed.missingInformation?.length && (
              <div><span className="text-xs font-medium text-gray-500">Missing info: </span><Bullets items={r.whyNotClosed.missingInformation} /></div>
            )}
          </div>
        )}
      </Section>

      {/* 3. Next Best Action */}
      <Section title="▶ Next Best Action" defaultOpen>
        {r.nextBestAction && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-lg">{
                { Call: "📞", WhatsApp: "💬", Email: "📧", OfficeMeeting: "🏢", VirtualMeeting: "💻", SiteVisit: "🏗️", LongTermFollowUp: "📅", Revival: "🔄" }[r.nextBestAction.action ?? ""] ?? "▶"
              }</span>
              <span className="font-semibold">{r.nextBestAction.action?.replace(/([A-Z])/g, " $1").trim()}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                { Immediate: "bg-red-100 text-red-700", Today: "bg-orange-100 text-orange-700", ThisWeek: "bg-amber-100 text-amber-700", NextWeek: "bg-blue-100 text-blue-600", NextMonth: "bg-gray-100 text-gray-500" }[r.nextBestAction.urgency ?? ""] ?? ""
              }`}>{r.nextBestAction.urgency}</span>
            </div>
            {r.nextBestAction.reasoning && <p className="text-xs text-gray-600">{r.nextBestAction.reasoning}</p>}
            {r.nextBestAction.openingLine && (
              <div className="bg-amber-50 border border-amber-100 rounded p-2">
                <span className="text-xs font-semibold text-amber-700">Opening line: </span>
                <span className="text-amber-800 italic">"{r.nextBestAction.openingLine}"</span>
                <CopyButton text={r.nextBestAction.openingLine} />
              </div>
            )}
            {r.nextBestAction.specificInstructions && (
              <p className="text-xs bg-gray-50 rounded p-2 text-gray-700">{r.nextBestAction.specificInstructions}</p>
            )}
          </div>
        )}
      </Section>

      {/* 4. Human Psychology */}
      <Section title="🧠 Human Psychology">
        {r.humanPsychology && (
          <div className="space-y-2">
            {r.humanPsychology.overallPsychProfile && (
              <p className="text-sm text-gray-700 font-medium">{r.humanPsychology.overallPsychProfile}</p>
            )}
            {!!r.humanPsychology.buyingSignals?.length && (
              <div><span className="text-xs font-medium text-green-600">✅ Buying signals:</span><div className="mt-1"><Bullets items={r.humanPsychology.buyingSignals} /></div></div>
            )}
            {!!r.humanPsychology.fearSignals?.length && (
              <div><span className="text-xs font-medium text-red-500">😨 Fear signals:</span><div className="mt-1"><Bullets items={r.humanPsychology.fearSignals} /></div></div>
            )}
            {!!r.humanPsychology.delaySignals?.length && (
              <div><span className="text-xs font-medium text-amber-600">⏳ Delay signals:</span><div className="mt-1"><Bullets items={r.humanPsychology.delaySignals} /></div></div>
            )}
            {r.humanPsychology.howToInfluence && (
              <div className="bg-blue-50 border border-blue-100 rounded p-2">
                <span className="text-xs font-semibold text-blue-700">How to influence: </span>
                <span className="text-blue-800">{r.humanPsychology.howToInfluence}</span>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 5. BANT Intelligence */}
      <Section title="📊 BANT Intelligence">
        {r.bantIntelligence && (
          <div className="space-y-2">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${{
              Qualifies: "bg-green-100 text-green-700",
              UnderReview: "bg-amber-100 text-amber-700",
              NotQualified: "bg-red-100 text-red-700",
            }[r.bantIntelligence.overallBANT] ?? ""}`}>
              BANT Verdict: {r.bantIntelligence.overallBANT}
            </span>
            {r.bantIntelligence.bantVerdict && (
              <p className="text-sm text-gray-600">{r.bantIntelligence.bantVerdict}</p>
            )}
            <div className="grid grid-cols-2 gap-2 mt-2">
              {(["budget", "authority", "need", "timeline"] as const).map(key => {
                const item = r.bantIntelligence[key];
                return (
                  <div key={key} className="rounded border p-2">
                    <div className="text-[10px] font-bold uppercase text-gray-500">{key}</div>
                    <span className={`text-xs px-1.5 rounded ${
                      { Strong: "bg-green-100 text-green-700", Moderate: "bg-amber-100 text-amber-700", Weak: "bg-red-100 text-red-600", Unknown: "bg-gray-100 text-gray-500" }[item.score] ?? ""
                    }`}>{item.score} · {item.confidence}%</span>
                    {item.source && <p className="text-[10px] text-gray-400 mt-0.5 truncate">{item.source}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Section>

      {/* 6. Call Strategy */}
      <Section title="📞 Call Strategy">
        {r.callStrategy && (
          <div className="space-y-2">
            {r.callStrategy.objective && (
              <div className="bg-blue-50 border border-blue-100 rounded p-2">
                <span className="text-xs font-semibold text-blue-700">Objective: </span>
                <span className="text-blue-900">{r.callStrategy.objective}</span>
              </div>
            )}
            {r.callStrategy.openingLine && (
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <span className="text-xs font-medium text-gray-500">Opening: </span>
                  <span className="italic">"{r.callStrategy.openingLine}"</span>
                </div>
                <CopyButton text={r.callStrategy.openingLine} />
              </div>
            )}
            {!!r.callStrategy.talkingPoints?.length && <div><span className="text-xs font-medium text-gray-500">Talking points:</span><div className="mt-1"><Bullets items={r.callStrategy.talkingPoints} /></div></div>}
            {!!r.callStrategy.questionsToAsk?.length && <div><span className="text-xs font-medium text-gray-500">Questions to ask:</span><div className="mt-1"><Bullets items={r.callStrategy.questionsToAsk} /></div></div>}
            {!!r.callStrategy.objectionsToHandle?.length && <div><span className="text-xs font-medium text-gray-500">Handle these objections:</span><div className="mt-1"><Bullets items={r.callStrategy.objectionsToHandle} /></div></div>}
          </div>
        )}
      </Section>

      {/* 7. WhatsApp Draft */}
      {r.whatsAppDraft && (
        <Section title="💬 WhatsApp Draft">
          <div className="flex items-start gap-2">
            <p className="whitespace-pre-wrap text-gray-700 flex-1 text-sm">{r.whatsAppDraft}</p>
            <CopyButton text={r.whatsAppDraft} />
          </div>
        </Section>
      )}

      {/* 8. Email Draft */}
      {r.emailDraft && (
        <Section title="📧 Email Draft">
          <div className="space-y-2">
            {r.emailDraft.subject && (
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <span className="text-xs font-medium text-gray-500">Subject: </span>
                  <span className="font-medium">{r.emailDraft.subject}</span>
                </div>
                <CopyButton text={`Subject: ${r.emailDraft.subject}\n\n${r.emailDraft.body ?? ""}\n\n${r.emailDraft.cta ?? ""}`} />
              </div>
            )}
            {r.emailDraft.body && <p className="text-sm whitespace-pre-wrap text-gray-700">{r.emailDraft.body}</p>}
            {r.emailDraft.cta && (
              <div className="bg-green-50 border border-green-100 rounded p-2">
                <span className="text-xs font-semibold text-green-700">CTA: </span>
                <span className="text-green-800">{r.emailDraft.cta}</span>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* 9. Effort + Closing Strategy */}
      <Section title="⚡ Effort Recommendation">
        {r.effortRecommendation && (
          <div className="space-y-2">
            <div className="flex gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                { HighEffort: "bg-red-100 text-red-700", MediumEffort: "bg-amber-100 text-amber-700", LowEffort: "bg-blue-100 text-blue-600", LongTermNurture: "bg-gray-100 text-gray-600", NoEffort: "bg-gray-100 text-gray-400" }[r.effortRecommendation.level] ?? ""
              }`}>{r.effortRecommendation.level}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Owner: {r.effortRecommendation.recommendedOwnership}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Freq: {r.effortRecommendation.followUpFrequency}</span>
            </div>
            <p className="text-sm text-gray-600">{r.effortRecommendation.reasoning}</p>
          </div>
        )}
      </Section>

      {/* 10. Project Recommendations */}
      {!!r.projectRecommendations?.length && (
        <Section title="🏢 Project Recommendations">
          <div className="space-y-2">
            {r.projectRecommendations.map((p, i) => (
              <div key={i} className="border border-gray-100 rounded p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-gray-800">{p.projectName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{p.angle?.replace(/([A-Z])/g, " $1").trim()}</span>
                </div>
                <p className="text-xs text-gray-600">{p.matchReason}</p>
                {p.pitch && <p className="text-xs text-blue-700 mt-1 italic">{p.pitch}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* 11. Opportunity Discovery */}
      <Section title="💡 Opportunity Discovery">
        {r.opportunityDiscovery && (
          <div className="space-y-1.5">
            {Object.entries(r.opportunityDiscovery).map(([key, val]) => val ? (
              <div key={key} className="flex gap-2 text-sm">
                <span className="text-gray-400 shrink-0">→</span>
                <div>
                  <span className="text-xs font-medium text-gray-500 capitalize">{key.replace(/([A-Z])/g, " $1").trim()}: </span>
                  <span>{val}</span>
                </div>
              </div>
            ) : null)}
          </div>
        )}
      </Section>

      {/* 12. Revival Intelligence */}
      <Section title="🔄 Revival Intelligence">
        {r.revivalIntelligence && (
          <div className="space-y-2">
            <div className="flex gap-2">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.revivalIntelligence.isWorthAttempting ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {r.revivalIntelligence.isWorthAttempting ? "Worth Attempting" : "Low Priority"}
              </span>
              <span className="text-xs text-gray-500">{r.revivalIntelligence.confidence}% confidence</span>
            </div>
            {r.revivalIntelligence.reason && <p className="text-sm text-gray-600">{r.revivalIntelligence.reason}</p>}
            {r.revivalIntelligence.angle && <div><span className="text-xs font-medium text-gray-500">Angle: </span><span className="text-blue-700">{r.revivalIntelligence.angle}</span></div>}
            {r.revivalIntelligence.suggestedMessage && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-gray-500">Suggested message:</span>
                  <CopyButton text={r.revivalIntelligence.suggestedMessage} />
                </div>
                <p className="text-xs bg-gray-50 rounded p-2 whitespace-pre-wrap">{r.revivalIntelligence.suggestedMessage}</p>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* 13. WCR Intelligence Score */}
      <Section title="⭐ WCR Intelligence Score">
        {r.wcrIntelligenceScore && (
          <div className="space-y-2">
            <div className="text-3xl font-black text-center py-2">{r.wcrIntelligenceScore.total}<span className="text-base font-normal text-gray-400">/100</span></div>
            <div className="space-y-1.5">
              {Object.entries(r.wcrIntelligenceScore.breakdown).map(([key, val]) => (
                <ScoreBar key={key} label={key.replace(/([A-Z])/g, " $1").replace(/^\w/, c => c.toUpperCase())} value={val as number} />
              ))}
            </div>
            <p className="text-xs text-gray-500 italic mt-2">{r.wcrIntelligenceScore.explanation}</p>
            <div className="flex gap-2 mt-1">
              <span className="text-xs text-green-700">✓ Best: {r.wcrIntelligenceScore.strongestArea}</span>
              <span className="text-xs text-red-500">✗ Weakest: {r.wcrIntelligenceScore.weakestArea}</span>
            </div>
          </div>
        )}
      </Section>

      {/* 14. Capability Discovery */}
      <Section title="🚀 Additional AI Capabilities">
        {r.capabilityDiscovery && (
          <div className="space-y-2">
            {r.capabilityDiscovery.biggestOpportunity && (
              <div className="bg-violet-50 border border-violet-100 rounded p-2">
                <span className="text-xs font-semibold text-violet-700">🏆 Biggest opportunity: </span>
                <span className="text-violet-800">{r.capabilityDiscovery.biggestOpportunity}</span>
              </div>
            )}
            {r.capabilityDiscovery.additionalCapabilities?.map((cap, i) => (
              <div key={i} className="border border-gray-100 rounded p-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800 text-sm">{cap.capability}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    { High: "bg-green-100 text-green-700", Medium: "bg-amber-100 text-amber-700", Low: "bg-gray-100 text-gray-500" }[cap.feasibility] ?? ""
                  }`}>{cap.feasibility} feasibility</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{cap.implementationComplexity}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1">{cap.businessValue}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* 15. Automation Assessment */}
      <Section title="🤖 Automation Capabilities">
        {r.automationAssessment && (
          <div className="space-y-1.5">
            {Object.entries(r.automationAssessment).map(([key, item]) => {
              const { status, explanation } = item as { status: string; explanation: string };
              return (
                <div key={key} className="flex items-start gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 mt-0.5 ${AUTOMATION_STATUS_STYLES[status] ?? ""}`}>{status}</span>
                  <div>
                    <span className="text-xs font-medium text-gray-600">{key.replace(/([A-Z])/g, " $1").replace(/^\w/, c => c.toUpperCase())}: </span>
                    <span className="text-xs text-gray-500">{explanation}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* 16. Management Insights */}
      <Section title="📋 Management Insights">
        {r.managementInsights && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {r.managementInsights.conversionRank && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100">Rank: {r.managementInsights.conversionRank}</span>
              )}
              {r.managementInsights.deservesSeniorAttention && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100">⭐ Senior attention needed</span>
              )}
              {r.managementInsights.needsEscalation && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">🚨 Escalation needed</span>
              )}
              {r.managementInsights.estimatedDaysToClose != null && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100">~{r.managementInsights.estimatedDaysToClose}d to close</span>
              )}
            </div>
            {r.managementInsights.seniorAttentionReason && <p className="text-xs text-purple-700">{r.managementInsights.seniorAttentionReason}</p>}
            {r.managementInsights.escalationReason && <p className="text-xs text-red-600">{r.managementInsights.escalationReason}</p>}
          </div>
        )}
      </Section>

    </div>
  );
}

// ─── Model Column (loading + empty state + result) ────────────────────────────

function ModelColumn({
  modelKey, analysis, loading, error, onRun, enabled, compact,
}: {
  modelKey: ModelKey;
  analysis: AnalysisState | null;
  loading: boolean;
  error: string | null;
  onRun: () => void;
  enabled: boolean;
  compact?: boolean;
}) {
  const cfg = MODEL_CONFIG[modelKey];
  return (
    <div className={compact ? "min-w-0" : "min-w-0"}>
      {/* Model header */}
      <div className={`rounded-t-xl border-t border-x px-4 py-3 flex items-center justify-between gap-2 ${cfg.bgColor} ${cfg.borderColor}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-sm font-bold ${cfg.color} truncate`}>{cfg.label}</span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${cfg.badgeClass}`}>{cfg.badge}</span>
          {analysis?.result?.wcrIntelligenceScore?.total != null && (
            <span className="text-xs font-black text-gray-700 shrink-0">{analysis.result.wcrIntelligenceScore.total}/100</span>
          )}
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={loading || !enabled}
          className={`text-xs px-3 py-1.5 rounded-md font-medium transition-colors shrink-0 ${
            !enabled ? "bg-gray-100 text-gray-400 cursor-not-allowed" :
            loading ? "opacity-50 cursor-not-allowed bg-gray-200 text-gray-600" :
            `${cfg.bgColor} ${cfg.color} border ${cfg.borderColor} hover:opacity-80`
          }`}
        >
          {!enabled ? "Not configured" : loading ? "Analyzing…" : analysis ? "Re-run" : "Run"}
        </button>
      </div>

      {/* Content */}
      <div className={`border-x border-b rounded-b-xl p-3 ${cfg.borderColor} min-h-[200px]`}>
        {!enabled && (
          <div className="text-center py-8 text-xs text-gray-400">
            <p className="font-medium">{cfg.badge} API key not configured</p>
            <p className="mt-1">Add {cfg.badge === "Anthropic" ? "ANTHROPIC_API_KEY" : cfg.badge === "OpenAI" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"} to Vercel</p>
          </div>
        )}
        {enabled && !analysis && !loading && !error && (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">🧠</div>
            <p className="text-sm font-medium text-gray-600">{cfg.label}</p>
            <p className="text-xs text-gray-400 mt-1">Click Run to analyze this lead</p>
          </div>
        )}
        {loading && (
          <div className="text-center py-8">
            <div className="text-2xl mb-2 animate-spin inline-block">⟳</div>
            <p className="text-sm text-gray-500">Analyzing…</p>
            <p className="text-xs text-gray-400 mt-1">Usually 15–30 seconds</p>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2 mt-2">{error}</div>
        )}
        {analysis?.ok && analysis.result && (
          <div>
            <p className="text-[10px] text-gray-400 mb-2">
              {new Date(analysis.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
              {analysis.inputTokens > 0 && ` · ${(analysis.inputTokens + analysis.outputTokens).toLocaleString()} tokens`}
              {analysis.costMicroUsd > 0 && ` · ~$${(analysis.costMicroUsd / 1_000_000).toFixed(4)}`}
            </p>
            <ModelResultPanel r={analysis.result} cfg={cfg} />
          </div>
        )}
        {analysis && !analysis.ok && analysis.error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">{analysis.error}</div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function AIComparisonWorkspace({
  leadId, claudeEnabled, gptEnabled, geminiEnabled,
  initialClaude, initialGpt, initialGemini,
}: Props) {
  const [analyses, setAnalyses] = useState<Record<ModelKey, AnalysisState | null>>({
    claude: initialClaude,
    gpt: initialGpt,
    gemini: initialGemini,
  });
  const [loading, setLoading] = useState<Record<ModelKey, boolean>>({ claude: false, gpt: false, gemini: false });
  const [errors, setErrors] = useState<Record<ModelKey, string | null>>({ claude: null, gpt: null, gemini: null });
  const [viewMode, setViewMode] = useState<ViewMode>("compare");
  const [activeTab, setActiveTab] = useState<ModelKey>("claude");

  const runModel = useCallback(async (model: ModelKey) => {
    const cfg = MODEL_CONFIG[model];
    setLoading(prev => ({ ...prev, [model]: true }));
    setErrors(prev => ({ ...prev, [model]: null }));
    try {
      const res = await fetch(`/api/leads/${leadId}/ai/${cfg.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reanalyze: !!analyses[model] }),
      });
      const data = await res.json() as { analysisId?: string; result?: IntelligenceResult; error?: string };
      if (!res.ok || data.error) {
        setErrors(prev => ({ ...prev, [model]: data.error ?? "Analysis failed" }));
        return;
      }
      setAnalyses(prev => ({
        ...prev,
        [model]: {
          id: data.analysisId ?? "",
          createdAt: new Date().toISOString(),
          model: cfg.endpoint,
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
          ok: true,
          result: data.result ?? null,
        },
      }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [model]: e instanceof Error ? e.message : "Request failed" }));
    } finally {
      setLoading(prev => ({ ...prev, [model]: false }));
    }
  }, [leadId, analyses]);

  const runAll = useCallback(() => {
    if (claudeEnabled) runModel("claude");
    if (gptEnabled) runModel("gpt");
    if (geminiEnabled) runModel("gemini");
  }, [claudeEnabled, gptEnabled, geminiEnabled, runModel]);

  const enabledModels = (["claude", "gpt", "gemini"] as ModelKey[]).filter(m =>
    m === "claude" ? claudeEnabled : m === "gpt" ? gptEnabled : geminiEnabled
  );

  return (
    <div className="space-y-3">
      {/* Workspace header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">🤖 AI Intelligence Workspace</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">Pilot · Lalit's leads</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">All models receive identical lead data. Results stored independently — never overwritten.</p>
        </div>
        {/* View mode toggle */}
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button type="button" onClick={() => setViewMode("tabs")}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === "tabs" ? "bg-[#0b1a33] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              ☰ Tabs
            </button>
            <button type="button" onClick={() => setViewMode("compare")}
              className={`px-3 py-1.5 font-medium transition-colors ${viewMode === "compare" ? "bg-[#0b1a33] text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
              ⊞ Compare All
            </button>
          </div>
        </div>
      </div>

      {/* Run buttons */}
      <div className="flex flex-wrap gap-2">
        {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
          const cfg = MODEL_CONFIG[m];
          const enabled = m === "claude" ? claudeEnabled : m === "gpt" ? gptEnabled : geminiEnabled;
          return (
            <button key={m} type="button" onClick={() => runModel(m)}
              disabled={loading[m] || !enabled}
              className={`text-xs px-3 py-1.5 rounded-md font-medium border transition-colors ${
                !enabled ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed" :
                loading[m] ? "opacity-60 cursor-not-allowed bg-gray-100 text-gray-500 border-gray-200" :
                `${cfg.bgColor} ${cfg.color} ${cfg.borderColor} hover:opacity-80`
              }`}>
              {loading[m] ? `${cfg.label} analyzing…` : `Run ${cfg.label}`}
            </button>
          );
        })}
        {enabledModels.length > 1 && (
          <button type="button" onClick={runAll}
            disabled={Object.values(loading).some(Boolean)}
            className="text-xs px-3 py-1.5 rounded-md font-semibold bg-[#0b1a33] text-white hover:bg-[#1a2d4a] transition-colors disabled:opacity-50">
            ▶ Run All Models
          </button>
        )}
      </div>

      {/* Tab view */}
      {viewMode === "tabs" && (
        <div>
          <div className="flex gap-1 border-b border-gray-200 mb-3">
            {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
              const cfg = MODEL_CONFIG[m];
              const enabled = m === "claude" ? claudeEnabled : m === "gpt" ? gptEnabled : geminiEnabled;
              if (!enabled) return null;
              return (
                <button key={m} type="button" onClick={() => setActiveTab(m)}
                  className={`px-4 py-2 text-xs font-semibold rounded-t-lg transition-colors ${
                    activeTab === m ? `${cfg.bgColor} ${cfg.color} border-t border-x ${cfg.borderColor}` : "text-gray-500 hover:text-gray-700"
                  }`}>
                  {cfg.label}
                  {analyses[m]?.result?.wcrIntelligenceScore?.total != null && (
                    <span className="ml-1.5 text-[10px] font-black">{analyses[m]!.result!.wcrIntelligenceScore.total}</span>
                  )}
                </button>
              );
            })}
          </div>
          <ModelColumn
            modelKey={activeTab}
            analysis={analyses[activeTab]}
            loading={loading[activeTab]}
            error={errors[activeTab]}
            onRun={() => runModel(activeTab)}
            enabled={activeTab === "claude" ? claudeEnabled : activeTab === "gpt" ? gptEnabled : geminiEnabled}
          />
        </div>
      )}

      {/* Compare view — side by side */}
      {viewMode === "compare" && (
        <div className={`grid gap-4 ${enabledModels.length === 3 ? "grid-cols-1 lg:grid-cols-3" : enabledModels.length === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
          {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
            const enabled = m === "claude" ? claudeEnabled : m === "gpt" ? gptEnabled : geminiEnabled;
            return (
              <ModelColumn
                key={m}
                modelKey={m}
                analysis={analyses[m]}
                loading={loading[m]}
                error={errors[m]}
                onRun={() => runModel(m)}
                enabled={enabled}
                compact
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
