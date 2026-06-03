// LeadTimelineCard — unified activity timeline for a lead.
// Server component (no "use client"). Merges call logs, notes, and audit
// events into a single chronological feed, newest first.

export interface TimelineItem {
  id: string;
  type: "call" | "note" | "audit";
  timestamp: Date;
  actor: string;
  summary: string;
  detail?: string;
}

interface Props {
  items: TimelineItem[];
}

function formatHHMM(date: Date): string {
  const d = new Date(date);
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

function dotClass(type: TimelineItem["type"]): string {
  if (type === "call") return "bg-blue-500";
  if (type === "note") return "bg-green-500";
  return "bg-gray-400";
}

function typeIcon(type: TimelineItem["type"]): string {
  if (type === "call") return "📞";
  if (type === "note") return "📝";
  return "✏️";
}

export default function LeadTimelineCard({ items }: Props) {
  return (
    <div data-lead-section="timeline" className="card p-5">
      <div className="font-semibold mb-3 dark:text-slate-100">Activity Timeline</div>

      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-slate-400">No activity recorded yet</p>
      ) : (
        <ol className="relative border-l border-gray-200 dark:border-slate-700 space-y-4 ml-2">
          {items.map((item) => (
            <li key={item.id} className="ml-4">
              {/* Colored dot on the timeline spine */}
              <span
                className={`absolute -left-[9px] mt-1 flex h-4 w-4 items-center justify-center rounded-full ring-2 ring-white dark:ring-slate-800 ${dotClass(item.type)}`}
                aria-hidden="true"
              />

              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[11px] font-mono text-gray-400 dark:text-slate-500 shrink-0">
                  {formatHHMM(item.timestamp)}
                </span>
                <span className="text-[11px] font-semibold text-gray-500 dark:text-slate-400 shrink-0">
                  {item.actor}
                </span>
                <span className="text-sm text-gray-800 dark:text-slate-200">
                  {typeIcon(item.type)} {item.summary}
                </span>
              </div>

              {item.detail && (
                <p className="mt-0.5 text-xs text-gray-500 dark:text-slate-400 pl-0.5">
                  {item.detail}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
