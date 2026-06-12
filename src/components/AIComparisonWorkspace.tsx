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

// ─── Model config ─────────────────────────────────────────────────────────────

const MODELS: Record<ModelKey, {
  label: string; short: string; badge: string;
  color: string; bg: string; border: string; endpoint: string;
}> = {
  claude: { label: "Claude Sonnet 4.6", short: "Claude", badge: "Anthropic", color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200", endpoint: "claude" },
  gpt:    { label: "GPT-4.1 Mini",      short: "GPT",    badge: "OpenAI",    color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", endpoint: "gpt-intelligence" },
  gemini: { label: "Gemini 2.5 Flash",  short: "Gemini", badge: "Google",    color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200",   endpoint: "gemini-intelligence" },
};

// ─── Section definitions ──────────────────────────────────────────────────────

const SECTIONS = [
  { key: "summary",               label: "Summary",           emoji: "👤" },
  { key: "salesDirectorTest",     label: "Sales Director",    emoji: "🎯" },
  { key: "closingProbability",    label: "Closing Prob.",     emoji: "📈" },
  { key: "whyNotClosed",          label: "Why Not Closed",    emoji: "❌" },
  { key: "nextBestAction",        label: "Next Action",       emoji: "▶" },
  { key: "humanPsychology",       label: "Psychology",        emoji: "🧠" },
  { key: "bantIntelligence",      label: "BANT",              emoji: "📊" },
  { key: "effortRecommendation",  label: "Effort",            emoji: "⚡" },
  { key: "callStrategy",          label: "Call Strategy",     emoji: "📞" },
  { key: "whatsAppDraft",         label: "WhatsApp Draft",    emoji: "💬" },
  { key: "emailDraft",            label: "Email Draft",       emoji: "📧" },
  { key: "projectRecommendations",label: "Projects",          emoji: "🏢" },
  { key: "opportunityDiscovery",  label: "Opportunity",       emoji: "💡" },
  { key: "revivalIntelligence",   label: "Revival",           emoji: "🔄" },
  { key: "wcrIntelligenceScore",  label: "WCR Score",         emoji: "⭐" },
  { key: "capabilityDiscovery",   label: "AI Capabilities",   emoji: "🚀" },
  { key: "automationAssessment",  label: "Automation",        emoji: "🤖" },
  { key: "managementInsights",    label: "Management",        emoji: "📋" },
] as const;

// ─── Small helpers ─────────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 2000); })}
      className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-500 shrink-0 transition-colors">
      {done ? "✓" : "Copy"}
    </button>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (!items?.length) return <span className="text-gray-300 text-xs">—</span>;
  return (
    <ul className="space-y-0.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-1 text-xs">
          <span className="text-gray-300 shrink-0 mt-0.5 select-none">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const URGENCY_CLS: Record<string, string> = {
  Immediate: "bg-red-100 text-red-700",
  Today:     "bg-orange-100 text-orange-700",
  ThisWeek:  "bg-amber-100 text-amber-700",
  NextWeek:  "bg-blue-100 text-blue-600",
  NextMonth: "bg-gray-100 text-gray-500",
};
const SCORE_CLS: Record<string, string> = {
  Strong:   "bg-green-100 text-green-700",
  Moderate: "bg-amber-100 text-amber-700",
  Weak:     "bg-red-100 text-red-600",
  Unknown:  "bg-gray-100 text-gray-500",
};
const EFFORT_CLS: Record<string, string> = {
  HighEffort:      "bg-red-100 text-red-700",
  MediumEffort:    "bg-amber-100 text-amber-700",
  LowEffort:       "bg-blue-100 text-blue-600",
  LongTermNurture: "bg-gray-100 text-gray-600",
  NoEffort:        "bg-gray-100 text-gray-400",
};
const AUTO_CLS: Record<string, string> = {
  Possible:           "bg-green-100 text-green-700",
  PartiallyPossible:  "bg-amber-100 text-amber-700",
  NotRecommended:     "bg-red-100 text-red-600",
};

// ─── Per-section cell renderer ─────────────────────────────────────────────────

function SectionCell({ sectionKey, r }: { sectionKey: string; r: IntelligenceResult | null }) {
  if (!r) return <span className="text-gray-300 text-xs italic">—</span>;

  switch (sectionKey) {

    case "summary": {
      const s = r.summary;
      if (!s) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1 text-xs">
          <p className="font-medium text-gray-800 leading-snug">{s.oneLinerVerdict ?? s.whoIsClient}</p>
          <div className="flex gap-1 flex-wrap">
            {s.buyingJourneyStage && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{s.buyingJourneyStage}</span>}
            {s.urgencyLevel && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${s.urgencyLevel === "High" ? "bg-red-100 text-red-700" : s.urgencyLevel === "Medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{s.urgencyLevel}</span>}
          </div>
        </div>
      );
    }

    case "salesDirectorTest": {
      const sdt = r.salesDirectorTest;
      if (!sdt) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="bg-amber-50 border border-amber-100 rounded p-1.5">
            <span className="font-semibold text-amber-800 block text-[10px] mb-0.5">DO NEXT</span>
            <span className="text-amber-900">{sdt.whatWouldIDoNext}</span>
          </div>
          <div className="bg-red-50 border border-red-100 rounded p-1.5">
            <span className="font-semibold text-red-700 block text-[10px] mb-0.5">AVOID</span>
            <span className="text-red-800">{sdt.whatToAbsolutelyAvoid}</span>
          </div>
          {sdt.fastestPathToClosure && <div className="text-gray-700"><span className="font-medium text-gray-400">🔑 Close: </span>{sdt.fastestPathToClosure}</div>}
          {sdt.fastestPathToResponse && <div className="text-gray-700"><span className="font-medium text-gray-400">⚡ Response: </span>{sdt.fastestPathToResponse}</div>}
          {sdt.shouldLalitPersonallyIntervene && (
            <div className="text-purple-700 font-semibold text-[10px] bg-purple-50 border border-purple-100 rounded px-1.5 py-1">
              ⭐ Lalit should personally intervene
              {sdt.lalitInterventionReason && <span className="font-normal block text-purple-600">{sdt.lalitInterventionReason}</span>}
            </div>
          )}
        </div>
      );
    }

    case "closingProbability": {
      const cp = r.closingProbability;
      if (!cp) return <span className="text-gray-300 text-xs">—</span>;
      const cls = { VeryHigh: "text-green-600", High: "text-blue-600", Medium: "text-amber-600", Low: "text-orange-600", Dead: "text-gray-400" }[cp.classification] ?? "text-gray-700";
      return (
        <div className="space-y-1.5 text-xs">
          <div className="text-center">
            <div className={`text-3xl font-black ${cls}`}>{cp.percentage}%</div>
            <div className={`text-[10px] font-bold uppercase tracking-wider ${cls}`}>{cp.classification}</div>
          </div>
          {cp.summary && <p className="text-gray-600">{cp.summary}</p>}
          {cp.mainRisk && <div className="bg-red-50 rounded p-1.5"><span className="text-[10px] font-semibold text-red-700">Risk: </span><span className="text-red-800">{cp.mainRisk}</span></div>}
        </div>
      );
    }

    case "whyNotClosed": {
      const w = r.whyNotClosed;
      if (!w) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="bg-red-50 border border-red-100 rounded p-1.5 font-medium text-red-800">{w.biggestBlocker}</div>
          {w.hiddenObjection && <div><span className="text-gray-400">Hidden: </span><span className="text-gray-700">{w.hiddenObjection}</span></div>}
          {w.buyingTrigger && <div className="text-green-700"><span className="text-gray-400">Trigger: </span>{w.buyingTrigger}</div>}
          {w.delayReason && <div><span className="text-gray-400">Delay: </span><span className="text-gray-700">{w.delayReason}</span></div>}
          {!!w.missingInformation?.length && <div><span className="text-gray-400 block mb-0.5">Missing info:</span><Bullets items={w.missingInformation} /></div>}
        </div>
      );
    }

    case "nextBestAction": {
      const n = r.nextBestAction;
      if (!n) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-gray-800">{n.action?.replace(/([A-Z])/g, " $1").trim()}</span>
            {n.urgency && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${URGENCY_CLS[n.urgency] ?? ""}`}>{n.urgency}</span>}
          </div>
          {n.openingLine && (
            <div className="flex items-start gap-1">
              <span className="italic text-gray-600 flex-1">"{n.openingLine}"</span>
              <CopyBtn text={n.openingLine} />
            </div>
          )}
          {n.reasoning && <p className="text-gray-500">{n.reasoning}</p>}
          {n.specificInstructions && <p className="bg-gray-50 rounded p-1.5 text-gray-700">{n.specificInstructions}</p>}
        </div>
      );
    }

    case "humanPsychology": {
      const hp = r.humanPsychology;
      if (!hp) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          {hp.overallPsychProfile && <p className="text-gray-700 font-medium">{hp.overallPsychProfile}</p>}
          {!!hp.buyingSignals?.length && <div><span className="text-green-600 font-medium text-[10px]">✅ Buying signals</span><div className="mt-0.5"><Bullets items={hp.buyingSignals} /></div></div>}
          {!!hp.fearSignals?.length && <div><span className="text-red-500 font-medium text-[10px]">😨 Fear signals</span><div className="mt-0.5"><Bullets items={hp.fearSignals} /></div></div>}
          {!!hp.delaySignals?.length && <div><span className="text-amber-600 font-medium text-[10px]">⏳ Delay signals</span><div className="mt-0.5"><Bullets items={hp.delaySignals} /></div></div>}
          {hp.howToInfluence && <div className="bg-blue-50 border border-blue-100 rounded p-1.5"><span className="font-medium text-blue-700">Influence: </span>{hp.howToInfluence}</div>}
        </div>
      );
    }

    case "bantIntelligence": {
      const b = r.bantIntelligence;
      if (!b) return <span className="text-gray-300 text-xs">—</span>;
      const ovCls = b.overallBANT === "Qualifies" ? "bg-green-100 text-green-700" : b.overallBANT === "NotQualified" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
      return (
        <div className="space-y-1.5 text-xs">
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${ovCls}`}>{b.overallBANT}</span>
          <div className="grid grid-cols-2 gap-1">
            {(["budget", "authority", "need", "timeline"] as const).map(k => (
              <div key={k} className="border border-gray-100 rounded p-1.5">
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-0.5">{k[0]}</div>
                <span className={`text-[10px] px-1 py-0.5 rounded ${SCORE_CLS[b[k].score] ?? ""}`}>{b[k].score}</span>
                <div className="text-[10px] text-gray-400">{b[k].confidence}%</div>
              </div>
            ))}
          </div>
          {b.bantVerdict && <p className="text-gray-500">{b.bantVerdict}</p>}
        </div>
      );
    }

    case "effortRecommendation": {
      const e = r.effortRecommendation;
      if (!e) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="flex gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${EFFORT_CLS[e.level] ?? ""}`}>{e.level}</span>
            {e.recommendedOwnership && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{e.recommendedOwnership}</span>}
            {e.followUpFrequency && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{e.followUpFrequency}</span>}
          </div>
          {e.reasoning && <p className="text-gray-600">{e.reasoning}</p>}
        </div>
      );
    }

    case "callStrategy": {
      const c = r.callStrategy;
      if (!c) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          {c.objective && <div className="bg-blue-50 border border-blue-100 rounded p-1.5 text-blue-900">{c.objective}</div>}
          {c.openingLine && (
            <div className="flex items-start gap-1">
              <span className="italic text-gray-600 flex-1">"{c.openingLine}"</span>
              <CopyBtn text={c.openingLine} />
            </div>
          )}
          {!!c.talkingPoints?.length && <div><span className="text-[10px] font-medium text-gray-400 block mb-0.5">Talking points</span><Bullets items={c.talkingPoints} /></div>}
          {!!c.questionsToAsk?.length && <div><span className="text-[10px] font-medium text-gray-400 block mb-0.5">Ask</span><Bullets items={c.questionsToAsk} /></div>}
          {!!c.objectionsToHandle?.length && <div><span className="text-[10px] font-medium text-gray-400 block mb-0.5">Handle</span><Bullets items={c.objectionsToHandle} /></div>}
        </div>
      );
    }

    case "whatsAppDraft": {
      if (!r.whatsAppDraft) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="text-xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-400 font-medium">Message</span>
            <CopyBtn text={r.whatsAppDraft} />
          </div>
          <p className="whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-1.5">{r.whatsAppDraft}</p>
        </div>
      );
    }

    case "emailDraft": {
      const ed = r.emailDraft;
      if (!ed) return <span className="text-gray-300 text-xs">—</span>;
      const full = `Subject: ${ed.subject ?? ""}\n\n${ed.body ?? ""}\n\n${ed.cta ?? ""}`;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="flex items-start justify-between gap-1">
            {ed.subject && <span className="font-semibold text-gray-800 flex-1">{ed.subject}</span>}
            <CopyBtn text={full} />
          </div>
          {ed.body && <p className="whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-1.5">{ed.body}</p>}
          {ed.cta && <div className="bg-green-50 rounded p-1.5 text-green-800">{ed.cta}</div>}
        </div>
      );
    }

    case "projectRecommendations": {
      const pr = r.projectRecommendations;
      if (!pr?.length) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          {pr.map((p, i) => (
            <div key={i} className="border border-gray-100 rounded p-1.5">
              <div className="font-semibold text-gray-800">{p.projectName}</div>
              <p className="text-gray-500 text-[10px]">{p.matchReason}</p>
              {p.pitch && <p className="text-blue-700 italic text-[10px] mt-0.5">{p.pitch}</p>}
            </div>
          ))}
        </div>
      );
    }

    case "opportunityDiscovery": {
      const od = r.opportunityDiscovery;
      if (!od) return <span className="text-gray-300 text-xs">—</span>;
      const entries = Object.entries(od).filter(([, v]) => v);
      if (!entries.length) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1 text-xs">
          {entries.map(([k, v]) => (
            <div key={k}>
              <span className="text-gray-400 text-[10px]">{k.replace(/([A-Z])/g, " $1").trim()}: </span>
              <span className="text-gray-700">{v as string}</span>
            </div>
          ))}
        </div>
      );
    }

    case "revivalIntelligence": {
      const rv = r.revivalIntelligence;
      if (!rv) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          <div className="flex gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${rv.isWorthAttempting ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
              {rv.isWorthAttempting ? "Worth Attempting" : "Low Priority"}
            </span>
            <span className="text-[10px] text-gray-400">{rv.confidence}% confidence</span>
          </div>
          {rv.angle && <div><span className="text-gray-400">Angle: </span><span className="text-blue-700">{rv.angle}</span></div>}
          {rv.suggestedMessage && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-gray-400">Message</span>
                <CopyBtn text={rv.suggestedMessage} />
              </div>
              <p className="bg-gray-50 rounded p-1.5 whitespace-pre-wrap">{rv.suggestedMessage}</p>
            </div>
          )}
        </div>
      );
    }

    case "wcrIntelligenceScore": {
      const wis = r.wcrIntelligenceScore;
      if (!wis) return <span className="text-gray-300 text-xs">—</span>;
      const totCls = wis.total >= 80 ? "text-green-600" : wis.total >= 60 ? "text-amber-600" : "text-red-500";
      return (
        <div className="space-y-2 text-xs">
          <div className={`text-2xl font-black text-center ${totCls}`}>{wis.total}<span className="text-sm font-normal text-gray-400">/100</span></div>
          <div className="space-y-1">
            {Object.entries(wis.breakdown).map(([k, v]) => {
              const val = v as number;
              const bar = val >= 80 ? "bg-green-500" : val >= 60 ? "bg-amber-500" : val >= 40 ? "bg-orange-500" : "bg-red-500";
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-24 shrink-0 truncate capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-1.5 ${bar} rounded-full transition-all`} style={{ width: `${val}%` }} />
                  </div>
                  <span className="text-[10px] text-gray-500 w-5 text-right shrink-0">{val}</span>
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 text-[10px]">
            <span className="text-green-600">✓ {wis.strongestArea}</span>
            <span className="text-red-500">✗ {wis.weakestArea}</span>
          </div>
        </div>
      );
    }

    case "capabilityDiscovery": {
      const cd = r.capabilityDiscovery;
      if (!cd) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          {cd.biggestOpportunity && <div className="bg-violet-50 border border-violet-100 rounded p-1.5 text-violet-800">{cd.biggestOpportunity}</div>}
          {cd.additionalCapabilities?.map((cap, i) => (
            <div key={i} className="border border-gray-100 rounded p-1.5">
              <div className="font-semibold text-gray-800 text-[11px]">{cap.capability}</div>
              <div className="flex gap-1 mt-0.5">
                <span className={`text-[10px] px-1 py-0.5 rounded ${cap.feasibility === "High" ? "bg-green-100 text-green-700" : cap.feasibility === "Medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{cap.feasibility}</span>
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">{cap.businessValue}</p>
            </div>
          ))}
        </div>
      );
    }

    case "automationAssessment": {
      const aa = r.automationAssessment;
      if (!aa) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1 text-xs">
          {Object.entries(aa).map(([k, item]) => {
            const { status } = item as { status: string; explanation: string };
            const short = status === "PartiallyPossible" ? "Partial" : status === "NotRecommended" ? "No" : "Yes";
            return (
              <div key={k} className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1 py-0.5 rounded shrink-0 min-w-[36px] text-center ${AUTO_CLS[status] ?? ""}`}>{short}</span>
                <span className="text-gray-600 text-[11px]">{k.replace(/([A-Z])/g, " $1").replace(/^\w/, c => c.toUpperCase())}</span>
              </div>
            );
          })}
        </div>
      );
    }

    case "managementInsights": {
      const mi = r.managementInsights;
      if (!mi) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1 text-xs">
          <div className="flex flex-wrap gap-1">
            {mi.conversionRank && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700">{mi.conversionRank}</span>}
            {mi.deservesSeniorAttention && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700">⭐ Senior attention</span>}
            {mi.needsEscalation && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">🚨 Escalation</span>}
            {mi.estimatedDaysToClose != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-700">~{mi.estimatedDaysToClose}d to close</span>}
          </div>
          {mi.seniorAttentionReason && <p className="text-purple-600">{mi.seniorAttentionReason}</p>}
          {mi.escalationReason && <p className="text-red-500">{mi.escalationReason}</p>}
        </div>
      );
    }

    default:
      return <span className="text-gray-300 text-xs">—</span>;
  }
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AIComparisonWorkspace({
  leadId, claudeEnabled, gptEnabled, geminiEnabled,
  initialClaude, initialGpt, initialGemini,
}: Props) {
  const [analyses, setAnalyses] = useState<Record<ModelKey, AnalysisState | null>>({
    claude: initialClaude, gpt: initialGpt, gemini: initialGemini,
  });
  const [loading, setLoading] = useState<Record<ModelKey, boolean>>({ claude: false, gpt: false, gemini: false });
  const [errors, setErrors] = useState<Record<ModelKey, string | null>>({ claude: null, gpt: null, gemini: null });

  const enabled: Record<ModelKey, boolean> = {
    claude: claudeEnabled, gpt: gptEnabled, gemini: geminiEnabled,
  };

  const runModel = useCallback(async (model: ModelKey) => {
    setLoading(prev => ({ ...prev, [model]: true }));
    setErrors(prev => ({ ...prev, [model]: null }));
    try {
      const res = await fetch(`/api/leads/${leadId}/ai/${MODELS[model].endpoint}`, {
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
          model: MODELS[model].endpoint,
          inputTokens: 0, outputTokens: 0, costMicroUsd: 0,
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
    (["claude", "gpt", "gemini"] as ModelKey[]).forEach(m => {
      if (enabled[m] && !loading[m]) runModel(m);
    });
  }, [enabled, loading, runModel]);

  const anyRunning = Object.values(loading).some(Boolean);

  return (
    <div>
      {/* ── Workspace header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">🤖 AI Intelligence Workspace</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">Pilot · Lalit&apos;s leads</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Section-by-section comparison · results stored independently · never overwrites CRM data</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
            const cfg = MODELS[m];
            return (
              <button key={m} type="button" onClick={() => runModel(m)}
                disabled={loading[m] || !enabled[m]}
                className={`text-xs px-3 py-1.5 rounded-md font-medium border transition-colors ${
                  !enabled[m]  ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed" :
                  loading[m]   ? "opacity-60 cursor-not-allowed bg-gray-100 text-gray-500 border-gray-200" :
                  `${cfg.bg} ${cfg.color} ${cfg.border} hover:opacity-80`
                }`}>
                {loading[m] ? `${cfg.short} analyzing…` : `Run ${cfg.label}`}
              </button>
            );
          })}
          <button type="button" onClick={runAll} disabled={anyRunning}
            className="text-xs px-3 py-1.5 rounded-md font-semibold bg-[#0b1a33] text-white hover:bg-[#1a2d4a] transition-colors disabled:opacity-50">
            ▶ Run All
          </button>
        </div>
      </div>

      {/* ── Section-by-section comparison table ─────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">

            {/* Sticky model header row */}
            <div className="sticky top-0 z-10 grid grid-cols-[148px_1fr_1fr_1fr] border-b-2 border-gray-200 bg-white shadow-sm">
              <div className="px-3 py-3 border-r border-gray-100 flex items-end">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Section</span>
              </div>
              {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
                const cfg = MODELS[m];
                const a = analyses[m];
                return (
                  <div key={m} className={`px-3 py-2.5 border-r border-gray-100 last:border-r-0 ${cfg.bg}`}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-500 font-medium shrink-0">{cfg.badge}</span>
                          {a?.result?.wcrIntelligenceScore?.total != null && (
                            <span className={`text-xs font-black shrink-0 ${cfg.color}`}>{a.result.wcrIntelligenceScore.total}/100</span>
                          )}
                        </div>
                        {a && !loading[m] && (
                          <div className="text-[10px] text-gray-400 mt-0.5">
                            {new Date(a.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })} IST
                          </div>
                        )}
                        {loading[m] && <div className="text-[10px] text-gray-400 mt-0.5 animate-pulse">Analyzing…</div>}
                        {errors[m] && <div className="text-[10px] text-red-500 mt-0.5 truncate max-w-[180px]" title={errors[m] ?? ""}>{errors[m]}</div>}
                      </div>
                      <button type="button" onClick={() => runModel(m)}
                        disabled={loading[m] || !enabled[m]}
                        className={`text-[10px] px-2 py-1 rounded font-semibold shrink-0 transition-colors ${
                          !enabled[m]  ? "text-gray-300 cursor-not-allowed" :
                          loading[m]   ? "opacity-40 cursor-not-allowed text-gray-500" :
                          `${cfg.color} bg-white border ${cfg.border} hover:opacity-80`
                        }`}>
                        {!enabled[m] ? "N/A" : loading[m] ? "…" : a ? "Re-run" : "Run"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Section rows */}
            {SECTIONS.map(({ key: sectionKey, label, emoji }, idx) => (
              <div key={sectionKey}
                className={`grid grid-cols-[148px_1fr_1fr_1fr] border-b border-gray-100 last:border-b-0 ${idx % 2 === 1 ? "bg-gray-50/40" : ""}`}>

                {/* Section label — left column */}
                <div className="px-3 py-3 border-r border-gray-100 bg-gray-50 flex flex-col gap-0.5 justify-start">
                  <div className="text-lg leading-none">{emoji}</div>
                  <div className="text-xs font-semibold text-gray-700 leading-tight">{label}</div>
                </div>

                {/* One cell per model */}
                {(["claude", "gpt", "gemini"] as ModelKey[]).map(m => {
                  const a = analyses[m];
                  return (
                    <div key={m} className="px-3 py-3 border-r border-gray-100 last:border-r-0 max-h-[270px] overflow-y-auto">
                      {loading[m] ? (
                        <span className="text-xs text-gray-300 animate-pulse">Analyzing…</span>
                      ) : !enabled[m] ? (
                        <span className="text-xs text-gray-300">Not configured</span>
                      ) : !a ? (
                        <button type="button" onClick={() => runModel(m)}
                          className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2">
                          Run to analyze
                        </button>
                      ) : a.ok && a.result ? (
                        <SectionCell sectionKey={sectionKey} r={a.result} />
                      ) : (
                        <span className="text-xs text-red-500 break-words">{a.error ?? "Analysis failed"}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

          </div>
        </div>
      </div>
    </div>
  );
}
