import type { DuplicateIntent } from "@/lib/duplicateIntent";

// "Duplicate-Intent" banner — shown on a lead when the SAME customer has
// reached out to us through genuine inbound channels MORE THAN ONCE. Unlike the
// Previous-History panel (which lists every record, including imports/restores),
// this counts ONLY real re-enquiries (website / WhatsApp / event / inbound call /
// referral / manual) and shows the evidence (source · date · section) behind the
// count. Returns null unless there are at least 2 genuine enquiries.

const sectionChip: Record<string, string> = {
  "Leads": "bg-emerald-100 text-emerald-700",
  "Revival": "bg-sky-100 text-sky-700",
  "Master Data": "bg-slate-200 text-slate-600",
  "Closed/Archived": "bg-amber-100 text-amber-700",
};

// Friendly labels for the LeadSource enum values that can reach this banner.
const sourceLabel: Record<string, string> = {
  WEBSITE: "Website",
  WHATSAPP: "WhatsApp",
  EVENT: "Event",
  INBOUND_CALL: "Inbound call",
  REFERRAL: "Referral",
  OTHER: "Manual",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

export default function DuplicateIntentBanner({ intent }: { intent: DuplicateIntent | null }) {
  // Only surface a genuine REPEAT — needs the data and at least 2 enquiries.
  if (!intent || intent.genuineCount < 2) return null;

  return (
    <div data-lead-section="overview" className="card p-4 border-l-4 border-rose-400">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="font-semibold text-gray-900 dark:text-slate-100">
          🔁 Genuine repeat enquiries: {intent.genuineCount}
          <span className="text-[11px] font-normal text-rose-700 ml-1.5">
            same customer reached out {intent.genuineCount} times through real inbound channels
          </span>
        </div>
        <span className="text-[11px] text-gray-500">Intent score: <b>{intent.score}</b></span>
      </div>

      <div className="mt-3 space-y-1.5">
        {intent.evidence.map((ev, i) => (
          <div
            key={`${ev.source}-${ev.date}-${i}`}
            className="flex items-start gap-2 text-sm rounded-lg px-2.5 py-1.5 bg-gray-50 dark:bg-slate-800/50"
          >
            <div className="text-[10px] text-gray-400 w-20 shrink-0 pt-0.5 tabular-nums">
              {fmtDate(ev.date)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-gray-700 dark:text-slate-200">
                  {sourceLabel[ev.source] ?? ev.source}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sectionChip[ev.section] ?? "bg-gray-200 text-gray-600"}`}>
                  {ev.section}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
