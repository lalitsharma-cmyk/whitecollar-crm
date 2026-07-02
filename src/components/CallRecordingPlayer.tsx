"use client";
// Inline call-recording player + download. Streams through the scope-checked CRM
// proxy (/api/telephony/recording/<callId>) so the provider URL/token is never
// exposed and access is enforced. Used in the Lead call history and the Buyer
// timeline — identical UX in both. Renders nothing if there's no recording.
import { useState } from "react";

export default function CallRecordingPlayer({ callId, compact = false }: { callId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const src = `/api/telephony/recording/${callId}`;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={`inline-flex items-center gap-1 text-blue-600 hover:underline ${compact ? "text-[11px]" : "text-xs"}`}>
        ▶ Play recording
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2 mt-1">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls preload="none" src={src} className={compact ? "h-8 max-w-[220px]" : "h-9 max-w-[280px]"} />
      <a href={`${src}?download=1`} className="text-xs text-gray-500 hover:text-blue-600" title="Download recording">⬇</a>
    </div>
  );
}
