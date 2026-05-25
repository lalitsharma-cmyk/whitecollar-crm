// Dedicated server component for the lead-detail "Remarks" panel.
//
// Extracted from the inline IIFE that previously lived in leads/[id]/page.tsx —
// Lalit reported the card was "missing" for several leads even though the DB
// had full 2000+ char conversation histories. Switching to a real component
// removed the IIFE complexity and made the conditional rendering trivially
// debuggable.
//
// IMPORTANT: this card now ALWAYS renders. When remarks is null/empty we show
// a clear "No remarks yet — click to add" placeholder so the agent isn't
// confused into thinking the card was hidden by a bug.

import InlineEdit from "./InlineEdit";
import LeadAIActions from "./LeadAIActions";

interface Props {
  leadId: string;
  remarks: string | null | undefined;
}

export default function RemarksCard({ leadId, remarks }: Props) {
  const hasRemarks = !!(remarks && remarks.trim().length > 0);
  const entryCount = hasRemarks
    ? (remarks!.match(/[oO]n\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/g) ?? []).length
    : 0;
  const charCount = hasRemarks ? remarks!.length : 0;

  return (
    <div className="card p-5 border-l-4 border-[#0b1a33] bg-[#fafafa]">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="font-semibold flex items-center gap-2 text-base">
          📝 Remarks
          <span className="text-[10px] text-gray-500 font-normal">
            {hasRemarks ? "full history from import sheet, click to edit" : "no remarks yet — click below to add"}
          </span>
        </div>
        {hasRemarks && (
          <div className="text-[10px] text-gray-500 font-mono flex items-center gap-2 flex-wrap">
            {entryCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800">
                📅 {entryCount} call entr{entryCount === 1 ? "y" : "ies"}
              </span>
            )}
            <span>{charCount.toLocaleString()} chars</span>
          </div>
        )}
      </div>
      <div className="text-sm text-gray-800 leading-relaxed max-h-[600px] overflow-y-auto border border-[#e5e7eb] rounded-lg p-3 bg-white">
        <InlineEdit
          leadId={leadId}
          field="remarks"
          type="textarea"
          value={remarks ?? ""}
          placeholder="Add remarks here — sheet history, call notes, anything"
        />
      </div>
      {hasRemarks && <LeadAIActions leadId={leadId} hasRemarks={hasRemarks} />}
    </div>
  );
}
