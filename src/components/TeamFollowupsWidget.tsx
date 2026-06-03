import Link from "next/link";

interface FollowupItem {
  id: string;
  name: string;
  followupDate: Date | string | null;
  potential: string | null;
  owner: { name: string } | null;
}

interface Props {
  items: FollowupItem[];
}

function potentialEmoji(potential: string | null): string {
  if (potential === "HIGH") return "🔥";
  if (potential === "MEDIUM") return "🌤";
  return "❄";
}

function fmtFollowupDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

export default function TeamFollowupsWidget({ items }: Props) {
  // Group by agent name
  const grouped = new Map<string, FollowupItem[]>();
  for (const item of items) {
    const agentName = item.owner?.name ?? "Unassigned";
    if (!grouped.has(agentName)) grouped.set(agentName, []);
    grouped.get(agentName)!.push(item);
  }

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">📅 Team Follow-ups This Week</h3>
        <Link href="/leads?followup=week" className="text-xs text-blue-600 hover:underline">
          View all →
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-gray-500 dark:text-slate-400">
          No follow-ups scheduled for the rest of this week
        </div>
      ) : (
        <div className="space-y-4">
          {Array.from(grouped.entries()).map(([agentName, leads]) => (
            <div key={agentName}>
              <div className="text-[10px] font-bold uppercase tracking-widest text-gray-400 dark:text-slate-500 mb-1.5">
                {agentName}
              </div>
              <div className="space-y-1">
                {leads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="flex items-center gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg px-2 py-1.5 -mx-2 group"
                  >
                    <span className="text-sm flex-none">
                      {potentialEmoji(lead.potential)}
                    </span>
                    <span className="text-sm font-medium flex-1 truncate group-hover:underline">
                      {lead.name}
                    </span>
                    <span className="text-[11px] text-gray-400 dark:text-slate-500 flex-none">
                      {fmtFollowupDate(lead.followupDate)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-slate-700">
        <Link
          href="/leads?followup=week"
          className="text-xs text-gray-500 dark:text-slate-400 hover:text-blue-600 hover:underline"
        >
          See all team follow-ups for this week →
        </Link>
      </div>
    </div>
  );
}
