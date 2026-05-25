// Dedicated server component for the lead-detail "📞 Call history" panel.
//
// Lalit asked: "Put Call History in front after name etc field in leads —
// agent can read all history first before calling".
//
// Extracted from the right rail of leads/[id]/page.tsx so it can sit at the
// top of the LEFT column (right under the header + remarks) where it's the
// first thing an agent sees before dialling. The right rail used to hide it
// below 4 other cards on mobile.

import { fmtISTParen } from "@/lib/datetime";
import { aggregateCalls } from "@/lib/callStats";
import type { CallLog } from "@prisma/client";

// Accept any Prisma CallLog row that includes the user relation. The page-level
// findMany already includes user, so this shape matches what gets passed in.
type CallLogWithUser = CallLog & { user: { name: string } };

interface Props {
  callLogs: CallLogWithUser[];
}

export default function CallHistoryCard({ callLogs }: Props) {
  // aggregateCalls expects the same shape — we already pass it in.
  const callStats = aggregateCalls(callLogs);

  return (
    <div className="card p-5 border-l-4 border-emerald-500 bg-emerald-50/30">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="font-semibold flex items-center gap-2 text-base">
          📞 Call history
          <span className="text-[10px] text-gray-500 font-normal">— read this before calling</span>
        </div>
        <div className="text-[10px] text-gray-500">{callStats.total} total</div>
      </div>

      {/* Breakdown badges — the agent should scan these first */}
      <div className="grid grid-cols-4 gap-1.5 text-center text-xs mb-3">
        <div className="p-2 rounded bg-blue-50 border border-blue-200">
          <div className="text-lg font-bold text-blue-700">{callStats.total}</div>
          <div className="text-[10px] text-gray-600">Dialed</div>
        </div>
        <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
          <div className="text-lg font-bold text-emerald-700">{callStats.connected}</div>
          <div className="text-[10px] text-gray-600">Connected</div>
        </div>
        <div className="p-2 rounded bg-red-50 border border-red-200">
          <div className="text-lg font-bold text-red-700">{callStats.notPicked}</div>
          <div className="text-[10px] text-gray-600">Not picked</div>
        </div>
        <div className="p-2 rounded bg-amber-50 border border-amber-200">
          <div className="text-lg font-bold text-amber-700">{callStats.callback}</div>
          <div className="text-[10px] text-gray-600">Callback</div>
        </div>
      </div>

      {callStats.notPickedStreak >= 2 && (
        <div className="text-xs bg-amber-50 border border-amber-300 rounded p-2 mb-3 text-amber-800">
          ⚠ <b>{callStats.notPickedStreak} not-picked in a row</b> — try a different time slot or WhatsApp first
        </div>
      )}

      {/* Chronological log — date · agent · outcome · remark.
          Max-height + scroll keeps the card from pushing the rest of the page down
          when there are 50+ entries. */}
      <div className="space-y-2 text-sm max-h-[480px] overflow-y-auto pr-1">
        {callLogs.length === 0 && (
          <div className="text-gray-500 text-xs text-center py-4">
            No calls logged yet. Use the 📝 Log Call button above to record the first one.
          </div>
        )}
        {callLogs.map((c) => (
          <div key={c.id} className="border-l-2 border-[#e5e7eb] pl-3 py-1.5">
            <div className="text-[11px] text-gray-500">
              <b>{c.user.name}</b> · {fmtISTParen(c.startedAt)} IST
              {c.durationSec ? ` · ${Math.floor(c.durationSec / 60)}m ${c.durationSec % 60}s` : ""}
              {c.ivrProvider && <span className="ml-1 chip src text-[9px]">{c.ivrProvider}</span>}
            </div>
            <div className="text-xs font-semibold mt-0.5">{c.outcome.replaceAll("_", " ")}</div>
            {c.notes && <div className="text-xs mt-1 text-gray-700 whitespace-pre-wrap">{c.notes}</div>}
            {c.recordingUrl && (
              <div className="mt-1.5">
                <audio controls preload="none" src={c.recordingUrl} className="w-full h-8" />
                <a href={c.recordingUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#0b1a33] underline">Open recording in new tab ↗</a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
