import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { triggerLabel } from "@/lib/templates";
import TemplateEditor from "@/components/TemplateEditor";

export const dynamic = "force-dynamic";

// ──────────────────────────────────────────────────────────
// Tone vocab + chip colors (spec §9.16)
// ──────────────────────────────────────────────────────────
const TONE_STYLES: Record<string, string> = {
  Luxury:             "bg-amber-100 text-amber-800 border border-amber-200",
  Assertive:          "bg-red-100 text-red-800 border border-red-200",
  Soft:               "bg-blue-100 text-blue-800 border border-blue-200",
  Investor:           "bg-emerald-100 text-emerald-800 border border-emerald-200",
  HNI:                "bg-purple-100 text-purple-800 border border-purple-200",
  Scarcity:           "bg-orange-100 text-orange-800 border border-orange-200",
  "Relationship-first": "bg-pink-100 text-pink-800 border border-pink-200",
  Commercial:         "bg-slate-100 text-slate-800 border border-slate-200",
};

/** Derive tones from template name + trigger when there's no `tone` column. */
function deriveTones(name: string, trigger: string): string[] {
  const n = name.toLowerCase();
  const tones: string[] = [];
  if (/(luxury|premium|villa|penthouse|branded)/.test(n)) tones.push("Luxury");
  if (/(hni|ultra|elite|vip)/.test(n)) tones.push("HNI");
  if (/(investor|roi|yield|rental|payback)/.test(n)) tones.push("Investor");
  if (/(commercial|office|retail|warehouse)/.test(n)) tones.push("Commercial");
  if (/(urgent|hurry|last|limited|closing|now)/.test(n) || trigger === "NEGOTIATION") tones.push("Scarcity");
  if (/(assertive|direct|firm|push)/.test(n)) tones.push("Assertive");
  if (/(gentle|soft|warm|hello|hi |intro)/.test(n) || trigger === "FIRST_QUERY") tones.push("Soft");
  if (/(follow|relation|thank|appreciate|family|trust)/.test(n) || trigger === "POST_VISIT" || trigger === "AFTER_CALL") {
    tones.push("Relationship-first");
  }
  // De-dup, cap at 3 chips
  return Array.from(new Set(tones)).slice(0, 3);
}

/** Derive a "Best for:" label from template name + trigger. */
function deriveBestUse(name: string, trigger: string): string {
  const n = name.toLowerCase();
  if (/cold/.test(n) || trigger === "REENGAGE_COLD") return "Best for: cold revival";
  if (/follow.?up/.test(n)) return "Best for: follow-ups";
  if (/site.?visit|post.?visit/.test(n) || trigger === "POST_VISIT") return "Best for: post-site-visit";
  if (/not.?picked|missed|callback/.test(n) || trigger === "AFTER_NOT_PICKED") return "Best for: missed calls";
  if (/schedule|visit|book/.test(n) || trigger === "SCHEDULE_VISIT") return "Best for: scheduling visits";
  if (/negotia|offer|close|deal/.test(n) || trigger === "NEGOTIATION") return "Best for: closing & negotiation";
  if (/welcome|intro|first|new/.test(n) || trigger === "FIRST_QUERY") return "Best for: first contact";
  if (/after.?call|recap/.test(n) || trigger === "AFTER_CALL") return "Best for: post-call recap";
  return "Best for: general outreach";
}

/** Composite performance score: (sends * 10) + (replies * 50). */
function scoreOf(sends: number, replies: number): number {
  return sends * 10 + replies * 50;
}

function scoreChipClass(score: number): string {
  if (score >= 500) return "bg-emerald-100 text-emerald-800 border border-emerald-200";
  if (score >= 100) return "bg-blue-100 text-blue-800 border border-blue-200";
  if (score > 0)    return "bg-gray-100 text-gray-700 border border-gray-200";
  return "bg-gray-50 text-gray-400 border border-gray-200";
}

export default async function TemplatesPage() {
  await requireRole("ADMIN", "MANAGER");
  const templates = await prisma.template.findMany({ orderBy: [{ kind: "asc" }, { trigger: "asc" }, { name: "asc" }] });

  // ── Per-template send + reply stats (WhatsApp only — no EmailLog model). ──
  // Sends: count of OUTBOUND WhatsAppMessage rows with templateId === t.id
  // Replies: INBOUND WhatsAppMessage from same lead within 24h after a send.
  const waTemplateIds = templates.filter(t => t.kind === "WHATSAPP").map(t => t.id);

  // Pull every outbound send tied to one of our templates (with leadId + timestamp).
  const outbound = waTemplateIds.length
    ? await prisma.whatsAppMessage.findMany({
        where: { templateId: { in: waTemplateIds }, direction: "OUTBOUND" },
        select: { templateId: true, leadId: true, receivedAt: true },
      })
    : [];

  // Tally sends per template.
  const sendsByTemplate = new Map<string, number>();
  for (const m of outbound) {
    if (!m.templateId) continue;
    sendsByTemplate.set(m.templateId, (sendsByTemplate.get(m.templateId) || 0) + 1);
  }

  // For replies, pull all INBOUND WA messages for any lead that has ever received
  // one of our template sends, then match in-memory (cheaper than N queries).
  const leadIdsWithSends = Array.from(new Set(outbound.map(m => m.leadId).filter((x): x is string => !!x)));
  const inbound = leadIdsWithSends.length
    ? await prisma.whatsAppMessage.findMany({
        where: { leadId: { in: leadIdsWithSends }, direction: "INBOUND" },
        select: { leadId: true, receivedAt: true },
      })
    : [];

  // Build a lead→sorted-inbound-times map for binary-search-friendly lookup.
  const inboundByLead = new Map<string, number[]>();
  for (const m of inbound) {
    if (!m.leadId) continue;
    const arr = inboundByLead.get(m.leadId) || [];
    arr.push(m.receivedAt.getTime());
    inboundByLead.set(m.leadId, arr);
  }
  for (const arr of inboundByLead.values()) arr.sort((a, b) => a - b);

  // Count replies: for each send, is there an inbound from same lead within 24h?
  const DAY_MS = 24 * 60 * 60 * 1000;
  const repliesByTemplate = new Map<string, number>();
  for (const send of outbound) {
    if (!send.templateId || !send.leadId) continue;
    const sentAt = send.receivedAt.getTime();
    const times = inboundByLead.get(send.leadId);
    if (!times) continue;
    const hit = times.some(t => t >= sentAt && t <= sentAt + DAY_MS);
    if (hit) repliesByTemplate.set(send.templateId, (repliesByTemplate.get(send.templateId) || 0) + 1);
  }

  const waCount = templates.filter(t => t.kind === "WHATSAPP").length;
  const emailCount = templates.filter(t => t.kind === "EMAIL").length;

  /** Render the polish bits (best-use pill, tone chips, send count, score) for any template. */
  const renderMeta = (t: typeof templates[number]) => {
    const tones = deriveTones(t.name, t.trigger);
    const bestUse = deriveBestUse(t.name, t.trigger);
    const sends = t.kind === "WHATSAPP" ? (sendsByTemplate.get(t.id) || 0) : null;
    const replies = t.kind === "WHATSAPP" ? (repliesByTemplate.get(t.id) || 0) : null;
    const score = sends != null && replies != null ? scoreOf(sends, replies) : null;
    return (
      <>
        {/* Best-use pill + score chip row */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 font-medium whitespace-nowrap">
            {bestUse}
          </span>
          {score != null ? (
            <span
              title={`(${sends} sends × 10) + (${replies} replies × 50) = ${score}`}
              className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${scoreChipClass(score)}`}
            >
              ⚡ {score}
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-gray-200 whitespace-nowrap">
              ⚡ —
            </span>
          )}
        </div>
        {/* Tone chips */}
        {tones.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {tones.map(tone => (
              <span key={tone} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TONE_STYLES[tone] || "bg-gray-100 text-gray-700"}`}>
                {tone}
              </span>
            ))}
          </div>
        )}
        {/* Send count badge */}
        <div className="mb-2">
          <span className="text-[10px] text-gray-500">
            {sends != null
              ? (sends > 0
                  ? `📨 Sent ${sends} time${sends === 1 ? "" : "s"}${replies && replies > 0 ? ` · ${replies} repl${replies === 1 ? "y" : "ies"}` : ""}`
                  : "📨 Sent — never")
              : "📨 Sent —"}
          </span>
        </div>
      </>
    );
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">📝 Message Templates</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Reusable WhatsApp + email templates. Use <code className="bg-gray-100 px-1 rounded">{`{{name}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{agent}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{project}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{budget}}`}</code> as placeholders.
            <br />Currently: {waCount} WhatsApp · {emailCount} Email templates.
          </p>
        </div>
        <TemplateEditor mode="new" />
      </div>

      <div className="card p-4">
        <div className="font-semibold text-sm mb-2">📖 Placeholders cheat sheet</div>
        <div className="text-xs text-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
          <div><code>{`{{name}}`}</code> → lead first name</div>
          <div><code>{`{{fullname}}`}</code> → full name</div>
          <div><code>{`{{agent}}`}</code> → your first name</div>
          <div><code>{`{{agent_full}}`}</code> → your full name</div>
          <div><code>{`{{project}}`}</code> → first interested project</div>
          <div><code>{`{{city}}`}</code> → project city</div>
          <div><code>{`{{budget}}`}</code> → formatted budget min</div>
          <div><code>{`{{phone}}`}</code> → lead phone (E.164)</div>
        </div>
      </div>

      {/* Tone legend */}
      <div className="card p-3">
        <div className="font-semibold text-xs mb-2 text-gray-700">🎨 Tone presets</div>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(TONE_STYLES).map(([tone, cls]) => (
            <span key={tone} className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${cls}`}>
              {tone}
            </span>
          ))}
        </div>
      </div>

      {/* WhatsApp section */}
      <section>
        <h2 className="text-base font-bold mb-2">💬 WhatsApp templates ({waCount})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.filter(t => t.kind === "WHATSAPP").map(t => (
            <div key={t.id} className="card p-4 border-l-4 border-emerald-500">
              {renderMeta(t)}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-sm">{t.name}</div>
                <span className="text-[10px] chip src whitespace-nowrap">{triggerLabel(t.trigger)}</span>
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono mt-1 bg-gray-50 p-2 rounded">{t.body}</pre>
              <div className="mt-2 flex justify-end">
                <TemplateEditor mode="edit" template={{ id: t.id, kind: t.kind, trigger: t.trigger, name: t.name, subject: t.subject, body: t.body }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Email section */}
      <section>
        <h2 className="text-base font-bold mb-2">✉ Email templates ({emailCount})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.filter(t => t.kind === "EMAIL").map(t => (
            <div key={t.id} className="card p-4 border-l-4 border-blue-500">
              {renderMeta(t)}
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  {t.subject && <div className="text-xs text-gray-500 mt-0.5"><b>Subject:</b> {t.subject}</div>}
                </div>
                <span className="text-[10px] chip src whitespace-nowrap">{triggerLabel(t.trigger)}</span>
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono mt-1 bg-gray-50 p-2 rounded max-h-40 overflow-y-auto">{t.body}</pre>
              <div className="mt-2 flex justify-end">
                <TemplateEditor mode="edit" template={{ id: t.id, kind: t.kind, trigger: t.trigger, name: t.name, subject: t.subject, body: t.body }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
