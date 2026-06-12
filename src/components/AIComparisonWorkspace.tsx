"use client";

import { useState, useCallback, useRef } from "react";
import type { IntelligenceResult } from "@/lib/ai-intelligence-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnalysisState {
  id: string; createdAt: string; model: string;
  inputTokens: number; outputTokens: number; costMicroUsd: number;
  ok: boolean; error?: string | null; result: IntelligenceResult | null;
}
interface Props {
  leadId: string; claudeEnabled: boolean; gptEnabled: boolean; geminiEnabled: boolean;
  initialClaude: AnalysisState | null; initialGpt: AnalysisState | null; initialGemini: AnalysisState | null;
}
type ModelKey = "claude" | "gpt" | "gemini";
type ModelScore = { claude: number; gpt: number; gemini: number };

// ─── Constants ────────────────────────────────────────────────────────────────

const MODELS: Record<ModelKey, { label: string; short: string; badge: string; color: string; bg: string; border: string; ring: string; endpoint: string }> = {
  claude: { label: "Claude Sonnet 4.6", short: "Claude", badge: "Anthropic", color: "text-violet-700", bg: "bg-violet-50", border: "border-violet-200", ring: "ring-violet-300", endpoint: "claude" },
  gpt:    { label: "GPT-4.1 Mini",      short: "GPT",    badge: "OpenAI",    color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", ring: "ring-emerald-300", endpoint: "gpt-intelligence" },
  gemini: { label: "Gemini 2.5 Flash",  short: "Gemini", badge: "Google",    color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200",   ring: "ring-blue-300",   endpoint: "gemini-intelligence" },
};
const MODEL_ORDER: ModelKey[] = ["claude", "gpt", "gemini"];

const SECTIONS = [
  { key: "summary",                label: "Summary",           emoji: "👤" },
  { key: "salesDirectorTest",      label: "Sales Director",    emoji: "🎯" },
  { key: "closingProbability",     label: "Closing Prob.",     emoji: "📈" },
  { key: "whyNotClosed",           label: "Why Not Closed",    emoji: "❌" },
  { key: "nextBestAction",         label: "Next Action",       emoji: "▶" },
  { key: "humanPsychology",        label: "Psychology",        emoji: "🧠" },
  { key: "bantIntelligence",       label: "BANT",              emoji: "📊" },
  { key: "effortRecommendation",   label: "Effort",            emoji: "⚡" },
  { key: "callStrategy",           label: "Call Strategy",     emoji: "📞" },
  { key: "whatsAppDraft",          label: "WhatsApp Draft",    emoji: "💬" },
  { key: "emailDraft",             label: "Email Draft",       emoji: "📧" },
  { key: "projectRecommendations", label: "Projects",          emoji: "🏢" },
  { key: "opportunityDiscovery",   label: "Opportunity",       emoji: "💡" },
  { key: "revivalIntelligence",    label: "Revival",           emoji: "🔄" },
  { key: "wcrIntelligenceScore",   label: "WCR Score",         emoji: "⭐" },
  { key: "capabilityDiscovery",    label: "AI Capabilities",   emoji: "🚀" },
  { key: "automationAssessment",   label: "Automation",        emoji: "🤖" },
  { key: "managementInsights",     label: "Management",        emoji: "📋" },
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

const URGENCY_CLS: Record<string, string> = { Immediate:"bg-red-100 text-red-700", Today:"bg-orange-100 text-orange-700", ThisWeek:"bg-amber-100 text-amber-700", NextWeek:"bg-blue-100 text-blue-600", NextMonth:"bg-gray-100 text-gray-500" };
const SCORE_CLS:   Record<string, string> = { Strong:"bg-green-100 text-green-700", Moderate:"bg-amber-100 text-amber-700", Weak:"bg-red-100 text-red-600", Unknown:"bg-gray-100 text-gray-500" };
const EFFORT_CLS:  Record<string, string> = { HighEffort:"bg-red-100 text-red-700", MediumEffort:"bg-amber-100 text-amber-700", LowEffort:"bg-blue-100 text-blue-600", LongTermNurture:"bg-gray-100 text-gray-600", NoEffort:"bg-gray-100 text-gray-400" };
const AUTO_CLS:    Record<string, string> = { Possible:"bg-green-100 text-green-700", PartiallyPossible:"bg-amber-100 text-amber-700", NotRecommended:"bg-red-100 text-red-600" };

// ─── Per-section cell renderer ─────────────────────────────────────────────────

function SectionCell({ sectionKey, r }: { sectionKey: string; r: IntelligenceResult | null }) {
  if (!r) return <span className="text-gray-300 text-xs italic">—</span>;
  switch (sectionKey) {
    case "summary": {
      const s = r.summary; if (!s) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          <p className="font-semibold text-gray-900 leading-snug text-sm">{s.oneLinerVerdict ?? s.whoIsClient}</p>
          <p className="text-gray-600">{s.whoIsClient}</p>
          <p className="text-gray-600">{s.whatTheyWant}</p>
          {s.buyingJourneyStage && <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">{s.buyingJourneyStage}</span>}
          {s.whatHappenedSoFar && <p className="text-gray-500 border-t border-gray-100 pt-2">{s.whatHappenedSoFar}</p>}
        </div>
      );
    }
    case "salesDirectorTest": {
      const sdt = r.salesDirectorTest; if (!sdt) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          <div className="bg-amber-50 border border-amber-100 rounded p-2">
            <span className="font-bold text-amber-800 block text-[10px] mb-1">▶ DO NEXT</span>
            <span className="text-amber-900">{sdt.whatWouldIDoNext}</span>
          </div>
          {sdt.why && <p className="text-gray-500 text-[11px]">{sdt.why}</p>}
          <div className="bg-red-50 border border-red-100 rounded p-2">
            <span className="font-bold text-red-700 block text-[10px] mb-1">✕ AVOID</span>
            <span className="text-red-800">{sdt.whatToAbsolutelyAvoid}</span>
          </div>
          {sdt.fastestPathToResponse && <div className="text-gray-700"><span className="font-medium text-gray-400 text-[10px]">⚡ Response: </span>{sdt.fastestPathToResponse}</div>}
          {sdt.fastestPathToMeeting && <div className="text-gray-700"><span className="font-medium text-gray-400 text-[10px]">🤝 Meeting: </span>{sdt.fastestPathToMeeting}</div>}
          {sdt.fastestPathToSiteVisit && <div className="text-gray-700"><span className="font-medium text-gray-400 text-[10px]">🏢 Site Visit: </span>{sdt.fastestPathToSiteVisit}</div>}
          {sdt.fastestPathToClosure && <div className="text-gray-700"><span className="font-medium text-gray-400 text-[10px]">🔑 Closure: </span>{sdt.fastestPathToClosure}</div>}
          {sdt.shouldLalitPersonallyIntervene && (
            <div className="text-purple-700 font-semibold text-[10px] bg-purple-50 border border-purple-100 rounded px-2 py-1.5">
              ⭐ Lalit should personally intervene
              {sdt.lalitInterventionReason && <span className="font-normal block text-purple-600 mt-0.5">{sdt.lalitInterventionReason}</span>}
            </div>
          )}
        </div>
      );
    }
    case "closingProbability": {
      const cp = r.closingProbability; if (!cp) return <span className="text-gray-300 text-xs">—</span>;
      const cls = { VeryHigh:"text-green-600", High:"text-blue-600", Medium:"text-amber-600", Low:"text-orange-600", Dead:"text-gray-400" }[cp.classification] ?? "text-gray-700";
      return (
        <div className="space-y-2 text-xs">
          <div className="text-center py-2">
            <div className={`text-5xl font-black ${cls}`}>{cp.percentage}%</div>
            <div className={`text-xs font-bold uppercase tracking-wider mt-1 ${cls}`}>{cp.classification}</div>
          </div>
          {cp.reasoning && <p className="text-gray-600">{cp.reasoning}</p>}
          {!!cp.positiveSignals?.length && <div><span className="text-[10px] text-green-600 font-medium block mb-0.5">✅ Positive</span><Bullets items={cp.positiveSignals} /></div>}
          {!!cp.negativeSignals?.length && <div><span className="text-[10px] text-red-500 font-medium block mb-0.5">⚠ Risks</span><Bullets items={cp.negativeSignals} /></div>}
        </div>
      );
    }
    case "whyNotClosed": {
      const w = r.whyNotClosed; if (!w) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          <div className="bg-red-50 border border-red-100 rounded p-2 font-medium text-red-800">{w.biggestBlocker}</div>
          {w.hiddenObjection && <div><span className="text-gray-400">Hidden: </span><span className="text-gray-700">{w.hiddenObjection}</span></div>}
          {w.buyingTrigger && <div className="text-green-700"><span className="text-gray-400">Trigger: </span>{w.buyingTrigger}</div>}
          {w.delayReason && <div><span className="text-gray-400">Delay: </span><span className="text-gray-700">{w.delayReason}</span></div>}
          {!!w.missingInformation?.length && <div><span className="text-gray-400 block mb-0.5">Missing info:</span><Bullets items={w.missingInformation} /></div>}
        </div>
      );
    }
    case "nextBestAction": {
      const n = r.nextBestAction; if (!n) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-gray-800">{n.action?.replace(/([A-Z])/g, " $1").trim()}</span>
            {n.urgency && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${URGENCY_CLS[n.urgency] ?? ""}`}>{n.urgency}</span>}
          </div>
          {n.openingLine && <div className="flex items-start gap-1"><span className="italic text-gray-600 flex-1">&ldquo;{n.openingLine}&rdquo;</span><CopyBtn text={n.openingLine} /></div>}
          {n.reasoning && <p className="text-gray-500">{n.reasoning}</p>}
          {n.specificInstructions && <p className="bg-gray-50 rounded p-1.5 text-gray-700">{n.specificInstructions}</p>}
        </div>
      );
    }
    case "humanPsychology": {
      const hp = r.humanPsychology; if (!hp) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          {hp.overallPsychProfile && <p className="text-gray-700 font-medium">{hp.overallPsychProfile}</p>}
          {!!hp.buyingSignals?.length && <div><span className="text-green-600 font-medium text-[10px]">✅ Buying signals</span><div className="mt-0.5"><Bullets items={hp.buyingSignals} /></div></div>}
          {!!hp.fearSignals?.length && <div><span className="text-red-500 font-medium text-[10px]">😨 Fear signals</span><div className="mt-0.5"><Bullets items={hp.fearSignals} /></div></div>}
          {!!hp.delaySignals?.length && <div><span className="text-amber-600 font-medium text-[10px]">⏳ Delay signals</span><div className="mt-0.5"><Bullets items={hp.delaySignals} /></div></div>}
          {!!hp.trustSignals?.length && <div><span className="text-blue-600 font-medium text-[10px]">🤝 Trust signals</span><div className="mt-0.5"><Bullets items={hp.trustSignals} /></div></div>}
          {hp.howToInfluence && <div className="bg-blue-50 border border-blue-100 rounded p-2"><span className="font-medium text-blue-700">Influence: </span>{hp.howToInfluence}</div>}
        </div>
      );
    }
    case "bantIntelligence": {
      const b = r.bantIntelligence; if (!b) return <span className="text-gray-300 text-xs">—</span>;
      const ovCls = b.overallBANT === "Qualifies" ? "bg-green-100 text-green-700" : b.overallBANT === "NotQualified" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
      return (
        <div className="space-y-2 text-xs">
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ovCls}`}>{b.overallBANT}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(["budget","authority","need","timeline"] as const).map(k => (
              <div key={k} className="border border-gray-100 rounded p-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">{k[0].toUpperCase()}</div>
                <span className={`text-[10px] px-1 py-0.5 rounded ${SCORE_CLS[b[k].score] ?? ""}`}>{b[k].score}</span>
                <div className="text-[10px] text-gray-400 mt-0.5">{b[k].confidence}% conf.</div>
                {(b[k] as { amount?: string | null }).amount && <div className="text-[10px] text-gray-600 mt-0.5">{(b[k] as { amount: string }).amount}</div>}
              </div>
            ))}
          </div>
          {b.bantVerdict && <p className="text-gray-500">{b.bantVerdict}</p>}
        </div>
      );
    }
    case "effortRecommendation": {
      const e = r.effortRecommendation; if (!e) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
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
      const c = r.callStrategy; if (!c) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          {c.objective && <div className="bg-blue-50 border border-blue-100 rounded p-2 text-blue-900">{c.objective}</div>}
          {c.openingLine && <div className="flex items-start gap-1"><span className="italic text-gray-600 flex-1">&ldquo;{c.openingLine}&rdquo;</span><CopyBtn text={c.openingLine} /></div>}
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
          <div className="flex items-center justify-between mb-1"><span className="text-[10px] text-gray-400 font-medium">Message</span><CopyBtn text={r.whatsAppDraft} /></div>
          <p className="whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-2">{r.whatsAppDraft}</p>
        </div>
      );
    }
    case "emailDraft": {
      const ed = r.emailDraft; if (!ed) return <span className="text-gray-300 text-xs">—</span>;
      const full = `Subject: ${ed.subject ?? ""}\n\n${ed.body ?? ""}\n\n${ed.cta ?? ""}`;
      return (
        <div className="space-y-2 text-xs">
          <div className="flex items-start justify-between gap-1">{ed.subject && <span className="font-semibold text-gray-800 flex-1">{ed.subject}</span>}<CopyBtn text={full} /></div>
          {ed.body && <p className="whitespace-pre-wrap text-gray-700 bg-gray-50 rounded p-2">{ed.body}</p>}
          {ed.cta && <div className="bg-green-50 rounded p-2 text-green-800">{ed.cta}</div>}
        </div>
      );
    }
    case "projectRecommendations": {
      const pr = r.projectRecommendations; if (!pr?.length) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          {pr.map((p, i) => (
            <div key={i} className="border border-gray-100 rounded p-2">
              <div className="font-semibold text-gray-800">{p.projectName}</div>
              <p className="text-gray-500 text-[10px] mt-0.5">{p.matchReason}</p>
              {p.pitch && <p className="text-blue-700 italic text-[10px] mt-0.5">{p.pitch}</p>}
            </div>
          ))}
        </div>
      );
    }
    case "opportunityDiscovery": {
      const od = r.opportunityDiscovery; if (!od) return <span className="text-gray-300 text-xs">—</span>;
      const entries = Object.entries(od).filter(([, v]) => v);
      if (!entries.length) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
          {entries.map(([k, v]) => (
            <div key={k}><span className="text-gray-400 text-[10px]">{k.replace(/([A-Z])/g, " $1").trim()}: </span><span className="text-gray-700">{v as string}</span></div>
          ))}
        </div>
      );
    }
    case "revivalIntelligence": {
      const rv = r.revivalIntelligence; if (!rv) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          <div className="flex gap-1.5 flex-wrap">
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${rv.isWorthAttempting ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{rv.isWorthAttempting ? "Worth Attempting" : "Low Priority"}</span>
            <span className="text-[10px] text-gray-400">{rv.confidence}% confidence</span>
          </div>
          {rv.angle && <div><span className="text-gray-400">Angle: </span><span className="text-blue-700">{rv.angle}</span></div>}
          {rv.suggestedMessage && <div><div className="flex items-center justify-between mb-0.5"><span className="text-[10px] text-gray-400">Message</span><CopyBtn text={rv.suggestedMessage} /></div><p className="bg-gray-50 rounded p-2 whitespace-pre-wrap">{rv.suggestedMessage}</p></div>}
        </div>
      );
    }
    case "wcrIntelligenceScore": {
      const wis = r.wcrIntelligenceScore; if (!wis) return <span className="text-gray-300 text-xs">—</span>;
      const totCls = wis.total >= 80 ? "text-green-600" : wis.total >= 60 ? "text-amber-600" : "text-red-500";
      return (
        <div className="space-y-2 text-xs">
          <div className={`text-4xl font-black text-center ${totCls}`}>{wis.total}<span className="text-sm font-normal text-gray-400">/100</span></div>
          <div className="space-y-1">
            {Object.entries(wis.breakdown).map(([k, v]) => {
              const val = v as number;
              const bar = val >= 80 ? "bg-green-500" : val >= 60 ? "bg-amber-500" : val >= 40 ? "bg-orange-500" : "bg-red-500";
              return (
                <div key={k} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 w-24 shrink-0 truncate capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-1.5 ${bar} rounded-full`} style={{ width: `${val}%` }} /></div>
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
      const cd = r.capabilityDiscovery; if (!cd) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-2 text-xs">
          {cd.biggestOpportunity && <div className="bg-violet-50 border border-violet-100 rounded p-2 text-violet-800">{cd.biggestOpportunity}</div>}
          {cd.additionalCapabilities?.map((cap, i) => (
            <div key={i} className="border border-gray-100 rounded p-2">
              <div className="font-semibold text-gray-800 text-[11px]">{cap.capability}</div>
              <div className="flex gap-1 mt-0.5"><span className={`text-[10px] px-1 py-0.5 rounded ${cap.feasibility === "High" ? "bg-green-100 text-green-700" : cap.feasibility === "Medium" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{cap.feasibility}</span></div>
              <p className="text-[10px] text-gray-500 mt-0.5">{cap.businessValue}</p>
            </div>
          ))}
        </div>
      );
    }
    case "automationAssessment": {
      const aa = r.automationAssessment; if (!aa) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
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
      const mi = r.managementInsights; if (!mi) return <span className="text-gray-300 text-xs">—</span>;
      return (
        <div className="space-y-1.5 text-xs">
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
    default: return <span className="text-gray-300 text-xs">—</span>;
  }
}

// ─── Executive Summary ────────────────────────────────────────────────────────

function ExecutiveSummary({ results }: { results: Record<ModelKey, IntelligenceResult | null> }) {
  const rs = MODEL_ORDER.map(m => results[m]).filter(Boolean) as IntelligenceResult[];
  if (rs.length < 2) return null;

  const pcts = rs.map(r => r.closingProbability?.percentage).filter((n): n is number => n != null);
  const avgPct = pcts.length ? Math.round(pcts.reduce((a,b) => a+b,0)/pcts.length) : null;
  const pctRange = pcts.length >= 2 ? Math.max(...pcts) - Math.min(...pcts) : 0;
  const agreePct = Math.max(0, 100 - pctRange * 2);

  const bantVerdicts = rs.map(r => r.bantIntelligence?.overallBANT).filter(Boolean);
  const bantConsensus = bantVerdicts.length > 1 && bantVerdicts.every(v => v === bantVerdicts[0]) ? bantVerdicts[0] : null;

  const escalations = rs.filter(r => r.salesDirectorTest?.shouldLalitPersonallyIntervene);
  const toMeeting   = rs.find(r => r.salesDirectorTest?.fastestPathToMeeting)?.salesDirectorTest?.fastestPathToMeeting;
  const toSite      = rs.find(r => r.salesDirectorTest?.fastestPathToSiteVisit)?.salesDirectorTest?.fastestPathToSiteVisit;
  const toClosure   = rs.find(r => r.salesDirectorTest?.fastestPathToClosure)?.salesDirectorTest?.fastestPathToClosure;
  const missing     = [...new Set(rs.flatMap(r => r.whyNotClosed?.missingInformation ?? []))].slice(0, 4);
  const nextAction  = rs.find(r => r.nextBestAction?.action)?.nextBestAction;

  return (
    <div className="bg-gradient-to-r from-[#0b1a33] to-[#1e3a5f] rounded-xl border border-blue-900/40 p-4 mb-4 text-white">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm font-bold">⚡ Executive Summary — AI Consensus</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/10 text-white/60">{rs.length} models</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
        {avgPct != null && (
          <div className="bg-white/10 rounded-lg p-2.5">
            <div className="text-[10px] text-white/50 mb-1">Avg Closing %</div>
            <div className={`text-3xl font-black ${avgPct >= 60 ? "text-green-400" : avgPct >= 40 ? "text-amber-400" : "text-red-400"}`}>{avgPct}%</div>
            <div className="text-[10px] text-white/40">{Math.min(...pcts)}–{Math.max(...pcts)}% range</div>
          </div>
        )}
        <div className="bg-white/10 rounded-lg p-2.5">
          <div className="text-[10px] text-white/50 mb-1">Agreement</div>
          <div className={`text-3xl font-black ${agreePct >= 70 ? "text-green-400" : agreePct >= 40 ? "text-amber-400" : "text-red-400"}`}>{agreePct}%</div>
          <div className="text-[10px] text-white/40">Across models</div>
        </div>
        {bantConsensus && (
          <div className="bg-white/10 rounded-lg p-2.5">
            <div className="text-[10px] text-white/50 mb-1">BANT (all agree)</div>
            <div className={`text-sm font-bold ${bantConsensus === "Qualifies" ? "text-green-400" : bantConsensus === "NotQualified" ? "text-red-400" : "text-amber-400"}`}>{bantConsensus}</div>
          </div>
        )}
        <div className={`rounded-lg p-2.5 ${escalations.length === rs.length ? "bg-red-500/30" : escalations.length > 0 ? "bg-amber-500/20" : "bg-green-500/20"}`}>
          <div className="text-[10px] text-white/50 mb-1">Lalit Escalation</div>
          <div className={`text-sm font-bold ${escalations.length === rs.length ? "text-red-300" : escalations.length > 0 ? "text-amber-300" : "text-green-400"}`}>
            {escalations.length === rs.length ? "🚨 Required" : escalations.length > 0 ? "⚠ Consider" : "✓ Not needed"}
          </div>
          {escalations.length > 0 && <div className="text-[10px] text-white/40">{escalations.length}/{rs.length} flagged</div>}
        </div>
      </div>
      {(toMeeting || toSite || toClosure) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
          {toMeeting  && <div className="bg-white/5 rounded-lg p-2"><div className="text-[10px] text-white/40 mb-0.5">🤝 Fastest to Meeting</div><div className="text-xs text-white/90">{toMeeting}</div></div>}
          {toSite     && <div className="bg-white/5 rounded-lg p-2"><div className="text-[10px] text-white/40 mb-0.5">🏢 Fastest to Site Visit</div><div className="text-xs text-white/90">{toSite}</div></div>}
          {toClosure  && <div className="bg-white/5 rounded-lg p-2"><div className="text-[10px] text-white/40 mb-0.5">🔑 Fastest to Closure</div><div className="text-xs text-white/90">{toClosure}</div></div>}
        </div>
      )}
      {nextAction && (
        <div className="bg-blue-500/20 rounded-lg p-2 mb-2">
          <div className="text-[10px] text-blue-300/70 mb-0.5">▶ Highest Confidence Action</div>
          <div className="text-xs text-white/90 font-medium">{nextAction.action?.replace(/([A-Z])/g, " $1").trim()}</div>
          {nextAction.openingLine && <div className="text-[10px] text-white/50 italic mt-0.5">&ldquo;{nextAction.openingLine}&rdquo;</div>}
        </div>
      )}
      {missing.length > 0 && (
        <div className="bg-amber-500/20 rounded-lg p-2">
          <div className="text-[10px] text-amber-300/70 mb-1">⚠ Critical Missing Information</div>
          <div className="flex flex-wrap gap-1">{missing.map((m, i) => <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/30 text-amber-200">{m}</span>)}</div>
        </div>
      )}
    </div>
  );
}

// ─── AI Insights Panel ────────────────────────────────────────────────────────

function AIInsightsPanel({ results }: { results: Record<ModelKey, IntelligenceResult | null> }) {
  const available = MODEL_ORDER.filter(m => results[m]);
  if (available.length < 2) return null;
  return (
    <div className="mt-6">
      <div className="text-sm font-bold text-gray-900 mb-3">🔍 Unique AI Insights — What Each Model Saw Differently</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {available.map(model => {
          const r = results[model]!;
          const cfg = MODELS[model];
          const others = MODEL_ORDER.filter(m => m !== model && results[m]).map(m => results[m]!);
          const unique = (val: string | null | undefined, others_: (string | null | undefined)[]) => {
            if (!val) return false;
            const v = val.toLowerCase().slice(0, 40);
            return !others_.some(o => o?.toLowerCase().includes(v));
          };
          const insights: { label: string; text: string }[] = [];
          const nextDo = r.salesDirectorTest?.whatWouldIDoNext;
          if (unique(nextDo, others.map(o => o.salesDirectorTest?.whatWouldIDoNext))) insights.push({ label: "DO NEXT", text: nextDo! });
          const hidden = r.whyNotClosed?.hiddenObjection;
          if (unique(hidden, others.map(o => o.whyNotClosed?.hiddenObjection))) insights.push({ label: "Hidden objection", text: hidden! });
          const trigger = r.whyNotClosed?.buyingTrigger;
          if (unique(trigger, others.map(o => o.whyNotClosed?.buyingTrigger))) insights.push({ label: "Buying trigger", text: trigger! });
          const avoid = r.salesDirectorTest?.whatToAbsolutelyAvoid;
          if (unique(avoid, others.map(o => o.salesDirectorTest?.whatToAbsolutelyAvoid))) insights.push({ label: "Avoid", text: avoid! });
          const cp = r.closingProbability?.percentage;
          const otherPcts = others.map(o => o.closingProbability?.percentage ?? 0);
          const avgOther = otherPcts.length ? Math.round(otherPcts.reduce((a,b)=>a+b,0)/otherPcts.length) : null;
          const diff = cp != null && avgOther != null ? cp - avgOther : null;
          return (
            <div key={model} className={`rounded-xl border p-3 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                {cp != null && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold border ${cfg.border} ${cfg.color}`}>{cp}%</span>}
                {diff != null && Math.abs(diff) >= 5 && <span className={`text-[10px] font-medium ${diff > 0 ? "text-green-600" : "text-red-500"}`}>{diff > 0 ? `+${diff}` : diff}% vs avg</span>}
              </div>
              {insights.length > 0 ? (
                <ul className="space-y-1.5">
                  {insights.slice(0, 3).map((ins, i) => (
                    <li key={i} className="text-xs bg-white/70 rounded p-1.5 border border-white/80">
                      <span className="text-[10px] font-bold text-gray-400 block mb-0.5">{ins.label}</span>
                      {ins.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-gray-400 italic">Aligned with other models</p>
              )}
              {r.effortRecommendation?.level && (
                <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-1.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${EFFORT_CLS[r.effortRecommendation.level] ?? "bg-gray-100 text-gray-500"}`}>{r.effortRecommendation.level}</span>
                  <span className="text-[10px] text-gray-400">{r.effortRecommendation.followUpFrequency}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Final Decision Dashboard ─────────────────────────────────────────────────

function FinalDecisionDashboard({ scores, winners }: { scores: Record<string, ModelScore>; winners: Record<string, ModelKey> }) {
  const totals: Record<ModelKey, number> = { claude: 0, gpt: 0, gemini: 0 };
  let rated = 0;
  SECTIONS.forEach(({ key }) => {
    const s = scores[key];
    if (s && (s.claude > 0 || s.gpt > 0 || s.gemini > 0)) {
      rated++;
      totals.claude += s.claude || 0;
      totals.gpt += s.gpt || 0;
      totals.gemini += s.gemini || 0;
    }
  });
  const winCount: Record<ModelKey, number> = { claude: 0, gpt: 0, gemini: 0 };
  Object.values(winners).forEach(w => { if (w) winCount[w]++; });

  const scoreLeader = MODEL_ORDER.reduce((a, b) => totals[b] > totals[a] ? b : a, "claude" as ModelKey);
  const voteLeader  = MODEL_ORDER.reduce((a, b) => winCount[b] > winCount[a] ? b : a, "claude" as ModelKey);
  const overall     = (totals[scoreLeader] > 0 || winCount[voteLeader] > 0)
    ? (totals[scoreLeader] >= totals[voteLeader === scoreLeader ? scoreLeader : voteLeader] ? scoreLeader : voteLeader)
    : null;

  if (rated === 0 && Object.keys(winners).length === 0) {
    return (
      <div className="mt-6 rounded-xl border border-dashed border-gray-200 p-4 text-center">
        <p className="text-xs text-gray-400">Rate sections (1–10) or pick section winners to see the Final Decision Dashboard</p>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-xl border-2 border-[#0b1a33] overflow-hidden">
      <div className="bg-gradient-to-r from-[#0b1a33] to-[#1e3a5f] px-5 py-3 flex items-center gap-2">
        <span className="text-sm font-bold text-white">🏆 Final Decision Dashboard</span>
        {rated > 0 && <span className="text-[10px] text-white/50">{rated}/{SECTIONS.length} sections rated</span>}
      </div>
      <div className="p-5 bg-gradient-to-b from-[#1e3a5f]/5 to-transparent">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {MODEL_ORDER.map(m => {
            const cfg = MODELS[m];
            const total = totals[m];
            const votes = winCount[m];
            const pct = rated > 0 ? Math.round((total / (rated * 10)) * 100) : 0;
            const isOverall = overall === m;
            return (
              <div key={m} className={`rounded-xl p-4 border-2 transition-all ${isOverall ? "border-yellow-400 bg-yellow-50" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-2 mb-2">
                  {isOverall && <span className="text-yellow-500 text-xl">🏆</span>}
                  <span className={`text-sm font-bold ${cfg.color}`}>{cfg.short}</span>
                  <span className="text-[10px] text-gray-400">{cfg.badge}</span>
                </div>
                <div className={`text-4xl font-black mb-1 ${isOverall ? "text-yellow-600" : "text-gray-800"}`}>
                  {total}<span className="text-sm font-normal text-gray-400">/{rated * 10}</span>
                </div>
                {rated > 0 && (
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
                    <div className={`h-2 rounded-full transition-all ${isOverall ? "bg-yellow-400" : `${cfg.bg.replace("bg-", "bg-").replace("50", "400")}`}`} style={{ width: `${pct}%` }} />
                  </div>
                )}
                <div className="flex gap-2 text-[10px] text-gray-500">
                  {rated > 0 && <span>{pct}% score</span>}
                  {votes > 0 && <span>🏆 {votes} win{votes > 1 ? "s" : ""}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {overall && (
          <div className="bg-yellow-50 border-2 border-yellow-300 rounded-xl p-4 text-center">
            <div className="text-[10px] text-yellow-600 font-medium mb-1 uppercase tracking-wider">Overall Winner</div>
            <div className="text-lg font-black text-yellow-700">🏆 {MODELS[overall].label}</div>
            <div className="text-xs text-yellow-600 mt-1">{totals[overall]} pts · {winCount[overall]} section win{winCount[overall] !== 1 ? "s" : ""}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Score buttons ─────────────────────────────────────────────────────────────

function ScoreButtons({ value, onChange, color }: { value: number; onChange: (n: number) => void; color: string }) {
  return (
    <div className="flex gap-0.5 flex-wrap">
      {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
        <button key={n} type="button" onClick={() => onChange(n === value ? 0 : n)}
          className={`w-[18px] h-[18px] text-[9px] rounded font-medium transition-colors ${value === n ? `${color} text-white` : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
          {n}
        </button>
      ))}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AIComparisonWorkspace({
  leadId, claudeEnabled, gptEnabled, geminiEnabled,
  initialClaude, initialGpt, initialGemini,
}: Props) {
  const [analyses, setAnalyses] = useState<Record<ModelKey, AnalysisState | null>>({ claude: initialClaude, gpt: initialGpt, gemini: initialGemini });
  const [loading, setLoading] = useState<Record<ModelKey, boolean>>({ claude: false, gpt: false, gemini: false });
  const [errors, setErrors]   = useState<Record<ModelKey, string | null>>({ claude: null, gpt: null, gemini: null });
  const [syncScroll, setSyncScroll] = useState(false);
  const [mobileModel, setMobileModel] = useState<ModelKey>("claude");
  const [winners, setWinners] = useState<Record<string, ModelKey>>({});
  const [scores, setScores]   = useState<Record<string, ModelScore>>({});

  // Refs for sync-scroll: keyed by `${sectionKey}-${model}`
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const syncing  = useRef(false);

  const enabled: Record<ModelKey, boolean> = { claude: claudeEnabled, gpt: gptEnabled, gemini: geminiEnabled };

  const runModel = useCallback(async (model: ModelKey) => {
    setLoading(prev => ({ ...prev, [model]: true }));
    setErrors(prev => ({ ...prev, [model]: null }));
    try {
      const res  = await fetch(`/api/leads/${leadId}/ai/${MODELS[model].endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reanalyze: !!analyses[model] }) });
      const data = await res.json() as { analysisId?: string; result?: IntelligenceResult; error?: string };
      if (!res.ok || data.error) { setErrors(prev => ({ ...prev, [model]: data.error ?? "Analysis failed" })); return; }
      setAnalyses(prev => ({ ...prev, [model]: { id: data.analysisId ?? "", createdAt: new Date().toISOString(), model: MODELS[model].endpoint, inputTokens: 0, outputTokens: 0, costMicroUsd: 0, ok: true, result: data.result ?? null } }));
    } catch (e) {
      setErrors(prev => ({ ...prev, [model]: e instanceof Error ? e.message : "Request failed" }));
    } finally {
      setLoading(prev => ({ ...prev, [model]: false }));
    }
  }, [leadId, analyses]);

  const runAll = useCallback(() => {
    MODEL_ORDER.forEach(m => { if (enabled[m] && !loading[m]) runModel(m); });
  }, [enabled, loading, runModel]);

  function handleScroll(sectionKey: string, source: ModelKey, el: HTMLDivElement) {
    if (!syncScroll || syncing.current) return;
    syncing.current = true;
    MODEL_ORDER.forEach(m => {
      if (m !== source) {
        const ref = cellRefs.current.get(`${sectionKey}-${m}`);
        if (ref && ref.scrollTop !== el.scrollTop) ref.scrollTop = el.scrollTop;
      }
    });
    requestAnimationFrame(() => { syncing.current = false; });
  }

  const setScore = (sectionKey: string, model: ModelKey, val: number) =>
    setScores(prev => ({ ...prev, [sectionKey]: { ...(prev[sectionKey] ?? { claude: 0, gpt: 0, gemini: 0 }), [model]: val } }));

  const anyRunning = Object.values(loading).some(Boolean);
  const results: Record<ModelKey, IntelligenceResult | null> = { claude: analyses.claude?.result ?? null, gpt: analyses.gpt?.result ?? null, gemini: analyses.gemini?.result ?? null };
  const hasAny = MODEL_ORDER.some(m => analyses[m]?.result);

  // Column visibility
  const colBg: Record<ModelKey, string> = { claude: "bg-violet-50/30", gpt: "bg-emerald-50/30", gemini: "bg-blue-50/30" };
  const scoreColor: Record<ModelKey, string> = { claude: "bg-violet-500", gpt: "bg-emerald-500", gemini: "bg-blue-500" };

  return (
    <div>
      {/* ── Header bar ───────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">🤖 AI Decision War Room</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200 font-medium">Pilot · Lalit&apos;s leads</span>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Compare Claude · GPT · Gemini side-by-side · results stored independently</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* Sync scroll toggle */}
          <button type="button" onClick={() => setSyncScroll(v => !v)}
            className={`text-xs px-3 py-1.5 rounded-md border font-medium transition-colors ${syncScroll ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
            {syncScroll ? "🔗 Sync On" : "🔗 Sync Off"}
          </button>
          {MODEL_ORDER.map(m => {
            const cfg = MODELS[m];
            return (
              <button key={m} type="button" onClick={() => runModel(m)} disabled={loading[m] || !enabled[m]}
                className={`text-xs px-3 py-1.5 rounded-md font-medium border transition-colors ${!enabled[m] ? "bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed" : loading[m] ? "opacity-60 cursor-not-allowed bg-gray-100 text-gray-500 border-gray-200" : `${cfg.bg} ${cfg.color} ${cfg.border} hover:opacity-80`}`}>
                {loading[m] ? `${cfg.short}…` : `Run ${cfg.short}`}
              </button>
            );
          })}
          <button type="button" onClick={runAll} disabled={anyRunning}
            className="text-xs px-3 py-1.5 rounded-md font-semibold bg-[#0b1a33] text-white hover:bg-[#1a2d4a] transition-colors disabled:opacity-50">
            ▶ Run All
          </button>
        </div>
      </div>

      {/* ── Mobile model switcher ─────────────────────────────────────────────── */}
      <div className="flex gap-1.5 mb-3 md:hidden">
        {MODEL_ORDER.map(m => {
          const cfg = MODELS[m];
          return (
            <button key={m} type="button" onClick={() => setMobileModel(m)}
              className={`flex-1 text-xs py-2 rounded-lg border font-semibold transition-colors ${mobileModel === m ? `${cfg.bg} ${cfg.color} ${cfg.border}` : "bg-white text-gray-500 border-gray-200"}`}>
              {cfg.short}
              {analyses[m]?.result?.wcrIntelligenceScore?.total != null && (
                <span className="ml-1 text-[10px]">{analyses[m]!.result!.wcrIntelligenceScore!.total}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Executive Summary ─────────────────────────────────────────────────── */}
      {hasAny && <ExecutiveSummary results={results} />}

      {/* ── Comparison table ──────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-full md:min-w-[820px]">

            {/* Sticky model header row */}
            <div className="grid grid-cols-[100px_1fr] md:grid-cols-[148px_1fr_1fr_1fr] border-b-2 border-gray-200 bg-white shadow-sm sticky top-0 z-30">
              <div className="px-3 py-3 border-r border-gray-100 bg-white sticky left-0 z-40 flex items-end">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Section</span>
              </div>
              {MODEL_ORDER.map(m => {
                const cfg = MODELS[m];
                const a = analyses[m];
                return (
                  <div key={m} className={`px-3 py-2.5 border-r border-gray-100 last:border-r-0 ${cfg.bg} ${m !== mobileModel ? "hidden md:block" : ""}`}>
                    <div className="flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 bg-white text-gray-500 font-medium shrink-0">{cfg.badge}</span>
                          {a?.result?.wcrIntelligenceScore?.total != null && (
                            <span className={`text-xs font-black shrink-0 ${cfg.color}`}>{a.result.wcrIntelligenceScore.total}/100</span>
                          )}
                        </div>
                        {a && !loading[m] && <div className="text-[10px] text-gray-400 mt-0.5">{new Date(a.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" })} IST</div>}
                        {loading[m] && <div className="text-[10px] text-gray-400 mt-0.5 animate-pulse">Analyzing…</div>}
                        {errors[m] && <div className="text-[10px] text-red-500 mt-0.5 truncate max-w-[180px]" title={errors[m] ?? ""}>{errors[m]}</div>}
                      </div>
                      <button type="button" onClick={() => runModel(m)} disabled={loading[m] || !enabled[m]}
                        className={`text-[10px] px-2 py-1 rounded font-semibold shrink-0 transition-colors ${!enabled[m] ? "text-gray-300 cursor-not-allowed" : loading[m] ? "opacity-40 cursor-not-allowed text-gray-500" : `${cfg.color} bg-white border ${cfg.border} hover:opacity-80`}`}>
                        {!enabled[m] ? "N/A" : loading[m] ? "…" : a ? "Re-run" : "Run"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Section rows */}
            {SECTIONS.map(({ key: sectionKey, label, emoji }, idx) => (
              <div key={sectionKey} className={idx % 2 === 1 ? "bg-gray-50/40" : ""}>
                {/* Main content row */}
                <div className="grid grid-cols-[100px_1fr] md:grid-cols-[148px_1fr_1fr_1fr] border-b border-gray-100">

                  {/* Section label — sticky left */}
                  <div className="px-3 py-3 border-r border-gray-100 bg-gray-50 sticky left-0 z-20 flex flex-col gap-1 justify-start">
                    <div className="text-xl leading-none">{emoji}</div>
                    <div className="text-xs font-semibold text-gray-700 leading-tight">{label}</div>
                    <div className="text-[10px] text-gray-400">{idx + 1}/{SECTIONS.length}</div>
                  </div>

                  {/* Model cells — fixed 500px height */}
                  {MODEL_ORDER.map(m => {
                    const a = analyses[m];
                    const refKey = `${sectionKey}-${m}`;
                    return (
                      <div key={m}
                        className={`px-3 py-3 border-r border-gray-100 last:border-r-0 ${colBg[m]} ${m !== mobileModel ? "hidden md:block" : ""}`}
                        style={{ height: "500px", overflowY: "auto" }}
                        ref={el => { if (el) cellRefs.current.set(refKey, el); else cellRefs.current.delete(refKey); }}
                        onScroll={e => handleScroll(sectionKey, m, e.currentTarget)}>
                        {loading[m] ? (
                          <span className="text-xs text-gray-300 animate-pulse">Analyzing…</span>
                        ) : !enabled[m] ? (
                          <span className="text-xs text-gray-300">Not configured</span>
                        ) : !a ? (
                          <button type="button" onClick={() => runModel(m)} className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2">Run to analyze</button>
                        ) : a.ok && a.result ? (
                          <SectionCell sectionKey={sectionKey} r={a.result} />
                        ) : (
                          <span className="text-xs text-red-500 break-words">{a.error ?? "Analysis failed"}</span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Controls row — winner + scores */}
                <div className="grid grid-cols-[100px_1fr] md:grid-cols-[148px_1fr_1fr_1fr] border-b border-gray-200 bg-white">
                  <div className="px-3 py-2 border-r border-gray-100 bg-gray-50 sticky left-0 z-20">
                    <div className="text-[9px] font-bold text-gray-300 uppercase tracking-wider">Evaluate</div>
                  </div>
                  {MODEL_ORDER.map(m => {
                    const cfg = MODELS[m];
                    const isWinner = winners[sectionKey] === m;
                    const sectionScore = scores[sectionKey]?.[m] ?? 0;
                    return (
                      <div key={m} className={`px-3 py-2 border-r border-gray-100 last:border-r-0 ${m !== mobileModel ? "hidden md:flex" : "flex"} flex-col gap-1.5`}>
                        {/* Winner picker */}
                        <button type="button" onClick={() => setWinners(prev => ({ ...prev, [sectionKey]: isWinner ? (undefined as unknown as ModelKey) : m }))}
                          className={`text-[10px] px-2 py-1 rounded-md border font-semibold w-full text-center transition-all ${isWinner ? `${cfg.bg} ${cfg.color} ${cfg.border} ring-1 ${cfg.ring}` : "border-gray-200 text-gray-400 hover:border-gray-300 bg-white"}`}>
                          {isWinner ? "🏆 Best" : "Best?"}
                        </button>
                        {/* 1-10 score */}
                        <ScoreButtons value={sectionScore} onChange={val => setScore(sectionKey, m, val)} color={scoreColor[m]} />
                        {sectionScore > 0 && <div className={`text-[10px] font-bold ${cfg.color}`}>{sectionScore}/10</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

          </div>
        </div>
      </div>

      {/* ── AI Insights Panel ────────────────────────────────────────────────── */}
      {hasAny && <AIInsightsPanel results={results} />}

      {/* ── Final Decision Dashboard ─────────────────────────────────────────── */}
      <FinalDecisionDashboard scores={scores} winners={winners} />
    </div>
  );
}
