import { CONNECTED_OUTCOMES, UNSUCCESSFUL_OUTCOMES, effectiveOutcome, isUnsuccessfulText, isWaNote, isWaInbound } from "@/lib/callOutcome";

interface CallLog {
  durationSec?: number | null;
  outcome?: string | null;
  notes?: string | null;
  startedAt: Date | string;
}

interface WaMsg { direction: "INBOUND" | "OUTBOUND"; }

interface Props {
  callLogs: CallLog[];
  waMessages?: WaMsg[];
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

export default function CallStatsBar({ callLogs, waMessages = [] }: Props) {
  if ((!callLogs || callLogs.length === 0) && waMessages.length === 0) return null;

  // Connected = calls that connected, incl. a WhatsApp *call/reply* logged CONNECTED
  // (a "💬 WA in —" reply). A one-way WA send is logged NOT_PICKED and never counts.
  const connectedCount = callLogs.filter(c => CONNECTED_OUTCOMES.has(effectiveOutcome(c.outcome ?? "", c.notes))).length;
  // Unsuccessful = mapped unsuccessful outcomes PLUS free-text variants (no answer /
  // not picked / forwarded to voicemail / will call back / call later / not recieved …).
  const unsuccessfulCount = callLogs.filter(c => {
    const eff = effectiveOutcome(c.outcome ?? "", c.notes);
    if (CONNECTED_OUTCOMES.has(eff)) return false; // a connected call is never "unsuccessful"
    return UNSUCCESSFUL_OUTCOMES.has(eff) || isUnsuccessfulText(c.notes);
  }).length;

  // Two-way WhatsApp conversations = the client replied — a WA-inbound log, or a WA
  // log that connected, plus any inbound WhatsAppMessage. One-way sends excluded.
  const waTwoWay = callLogs.filter(c =>
    isWaInbound(c.notes) || (isWaNote(c.notes) && effectiveOutcome(c.outcome ?? "", c.notes) === "CONNECTED")).length
    + waMessages.filter(m => m.direction === "INBOUND").length;

  // Talk time — sum durationSec for connected calls only (meaningless on missed calls)
  const talkSec = callLogs
    .filter(c => CONNECTED_OUTCOMES.has(effectiveOutcome(c.outcome ?? "", c.notes)))
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
      {waTwoWay > 0 && (
        <span>
          <span className="font-medium text-gray-700">💬 WhatsApp:</span>{" "}
          {waTwoWay}
        </span>
      )}
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
