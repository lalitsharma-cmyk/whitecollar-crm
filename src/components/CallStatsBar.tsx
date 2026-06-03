const CONNECTED_OUTCOMES = new Set(["CONNECTED", "INTERESTED", "NOT_INTERESTED"]);
const UNSUCCESSFUL_OUTCOMES = new Set(["NOT_PICKED", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER", "CALLBACK"]);

interface CallLog {
  durationSec?: number | null;
  outcome?: string | null;
  startedAt: Date | string;
}

interface Props {
  callLogs: CallLog[];
}

function formatTalkTime(totalSec: number): string {
  if (totalSec <= 0) return "0s";
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatHour(hour: number): string {
  if (hour === 0) return "~12am";
  if (hour < 12) return `~${hour}am`;
  if (hour === 12) return "~12pm";
  return `~${hour - 12}pm`;
}

function lastOutcomeLabel(outcome: string): string {
  const map: Record<string, string> = {
    CONNECTED: "✅ Connected",
    NOT_PICKED: "📵 Not Picked",
    CALLBACK: "🔁 Callback",
    WRONG_NUMBER: "🚫 Wrong Number",
    BUSY: "⏳ Busy",
    SWITCHED_OFF: "📴 Switched Off",
    INTERESTED: "✅ Connected",
    NOT_INTERESTED: "🛑 Not Interested",
  };
  return map[outcome] ?? outcome.toLowerCase().replace(/_/g, " ");
}

export default function CallStatsBar({ callLogs }: Props) {
  if (!callLogs || callLogs.length === 0) return null;

  const connectedCount = callLogs.filter(c => CONNECTED_OUTCOMES.has(c.outcome ?? "")).length;
  const unsuccessfulCount = callLogs.filter(c => UNSUCCESSFUL_OUTCOMES.has(c.outcome ?? "")).length;

  // Talk time — sum durationSec for connected calls only (meaningless on missed calls)
  const talkSec = callLogs
    .filter(c => CONNECTED_OUTCOMES.has(c.outcome ?? ""))
    .reduce((sum, c) => sum + (c.durationSec ?? 0), 0);
  const talkTime = formatTalkTime(talkSec);

  // Most recent call by startedAt
  const sorted = [...callLogs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );
  const lastOutcome = sorted[0]?.outcome ?? null;

  // Best hour (IST = UTC+5:30) — hour with most calls
  const hourCounts: Record<number, number> = {};
  for (const c of callLogs) {
    const d = new Date(c.startedAt);
    const istMs = d.getTime() + 330 * 60 * 1000;
    const hour = new Date(istMs).getUTCHours();
    hourCounts[hour] = (hourCounts[hour] ?? 0) + 1;
  }
  let bestHour = 10;
  let bestCount = 0;
  for (const [h, count] of Object.entries(hourCounts)) {
    if (count > bestCount) {
      bestCount = count;
      bestHour = Number(h);
    }
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 px-1 mb-2">
      <span>
        <span className="font-medium text-gray-700">📞 Connected:</span>{" "}
        {connectedCount}
      </span>
      <span>
        <span className="font-medium text-gray-700">📵 Unsuccessful:</span>{" "}
        {unsuccessfulCount}
      </span>
      <span>
        <span className="font-medium text-gray-700">Talk time:</span>{" "}
        {talkTime}
      </span>
      {lastOutcome && (
        <span>
          <span className="font-medium text-gray-700">Last outcome:</span>{" "}
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600 border border-gray-200">
            {lastOutcomeLabel(lastOutcome)}
          </span>
        </span>
      )}
      <span>
        <span className="font-medium text-gray-700">Best time:</span>{" "}
        {formatHour(bestHour)}
      </span>
    </div>
  );
}
