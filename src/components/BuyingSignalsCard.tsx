// Rules-based buying signals card (spec §6.5 / §9.4 "Buying signals").
// No AI — purely a synchronous reducer over fields already loaded by the
// lead detail page query. The card hides itself if there are zero positive
// signals AND zero risk signals (nothing useful to say).
//
// Lead is typed loosely (`any`) because the calling page uses Prisma `include`
// with several nested relations; the precise generated type would force the
// caller into a `Prisma.LeadGetPayload<{ include: { ... } }>` shape and we'd
// have to keep it in sync. The rules below are defensive (optional chaining +
// `?? []`) so a partially-populated object won't crash render.

type Props = { lead: any };

const MEETING_TYPES = ["OFFICE_MEETING", "VIRTUAL_MEETING", "SITE_VISIT"];

export default function BuyingSignalsCard({ lead }: Props) {
  const signals: string[] = [];
  const risks: string[] = [];

  const callLogs: any[] = Array.isArray(lead?.callLogs) ? lead.callLogs : [];
  const activities: any[] = Array.isArray(lead?.activities) ? lead.activities : [];
  const discussed: any[] = Array.isArray(lead?.discussed) ? lead.discussed : [];

  // 1. Multiple project interest
  if (discussed.length >= 2) signals.push("🔥 Multiple project interest");

  // 2. Pipeline mover — past QUALIFIED into NEGOTIATION/SITE_VISIT
  if (lead?.status === "NEGOTIATION" || lead?.status === "SITE_VISIT") {
    signals.push("📈 Pipeline mover");
  }

  // 3. EOI in progress
  if (lead?.eoiStage) signals.push("💸 EOI in progress");

  // 4. Engaged caller — ≥3 CONNECTED outcomes
  const connectedCalls = callLogs.filter((c) => c?.outcome === "CONNECTED");
  if (connectedCalls.length >= 3) signals.push("📞 Engaged caller");

  // 5. Booked a meeting (any DONE meeting/site visit)
  const hasDoneMeeting = activities.some(
    (a) => MEETING_TYPES.includes(a?.type) && a?.status === "DONE"
  );
  if (hasDoneMeeting) signals.push("📅 Booked a meeting");

  // 6. Fast response history — any connected call within 24h of lead creation
  const createdAtMs = lead?.createdAt ? new Date(lead.createdAt).getTime() : null;
  if (createdAtMs != null) {
    const fastResponse = connectedCalls.some((c) => {
      if (!c?.startedAt) return false;
      const t = new Date(c.startedAt).getTime();
      return t - createdAtMs <= 24 * 60 * 60 * 1000 && t - createdAtMs >= 0;
    });
    if (fastResponse) signals.push("⚡ Fast response history");
  }

  // 7. Qualified
  if (lead?.bantStatus === "QUALIFIES") signals.push("✅ Qualified");

  // 8. Budget confirmed
  if (lead?.fundReadiness === "CASH_READY" || lead?.fundReadiness === "BANK_APPROVED") {
    signals.push("💰 Budget confirmed");
  }

  // 9. Action this week (followupDate within next 7 days)
  if (lead?.followupDate) {
    const f = new Date(lead.followupDate).getTime();
    const now = Date.now();
    if (f >= now && f - now <= 7 * 24 * 60 * 60 * 1000) {
      signals.push("⏰ Action this week");
    }
  }

  // 10. HOT score
  if (lead?.aiScore === "HOT") signals.push("🚩 HOT score");

  // Risks
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
  const lastTouchedMs = lead?.lastTouchedAt
    ? new Date(lead.lastTouchedAt).getTime()
    : null;

  if (lastTouchedMs == null || now - lastTouchedMs > sevenDaysMs) {
    risks.push("⚠ Not touched in 7+ days");
  }
  if (lead?.budgetMin == null) risks.push("⚠ No budget");
  if (lastTouchedMs != null && now - lastTouchedMs > fourteenDaysMs) {
    risks.push("⚠ Stuck > 14d");
  }

  // "Why this score" line — Agent I. Pulls lead.aiSummary (populated by the
  // AI rescorer or rule-based fallback). Only renders when present.
  const whyThisScore: string | null = typeof lead?.aiSummary === "string" && lead.aiSummary.trim()
    ? lead.aiSummary.trim()
    : null;

  if (signals.length === 0 && risks.length === 0 && !whyThisScore) return null;

  // Tone scaling based on signal count
  let cardClass = "card p-4";
  let label: string | null = null;
  if (signals.length >= 5) {
    cardClass = "card p-4 border-l-4 border-emerald-500 bg-emerald-50";
    label = "Closing window";
  } else if (signals.length >= 3) {
    cardClass = "card p-4 border-l-4 border-amber-400 bg-amber-50";
  } else if (signals.length >= 1) {
    cardClass = "card p-4 border-l-4 border-gray-300 bg-gray-50";
  }

  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-bold tracking-widest text-gray-600">BUYING SIGNALS</span>
        {label && (
          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
            {label}
          </span>
        )}
      </div>
      {whyThisScore && (
        <div className="mb-2 text-[12px] leading-snug text-gray-700 italic border-l-2 border-gray-300 pl-2">
          <span className="not-italic font-semibold text-gray-600">Why this score:</span>{" "}
          {whyThisScore}
        </div>
      )}
      {signals.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {signals.map((s) => (
            <span
              key={s}
              className="text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-800"
            >
              {s}
            </span>
          ))}
        </div>
      )}
      {risks.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {risks.map((r) => (
            <span
              key={r}
              className="text-[11px] bg-red-50 border border-red-200 rounded-full px-2 py-0.5 text-red-700"
            >
              {r}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
