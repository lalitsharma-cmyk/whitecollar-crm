"use client";
import { useState } from "react";

interface Props {
  remarks: string;
  callLogsCount: number;
}

export default function RemarksCard({ remarks, callLogsCount }: Props) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW_CHARS = 400;
  const isLong = remarks.length > PREVIEW_CHARS;
  const displayText = expanded || !isLong ? remarks : remarks.slice(0, PREVIEW_CHARS) + "…";
  const lineCount = remarks.split("\n").filter(l => l.trim()).length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-sm">📄 Original Remarks</h3>
        <span className="text-[10px] text-gray-400">{lineCount} lines · {callLogsCount} entries parsed into call log</span>
      </div>
      <pre className="text-xs text-gray-700 dark:text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">{displayText}</pre>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-xs text-blue-600 hover:underline"
        >
          {expanded ? "Show less ↑" : `Show more (${remarks.length - PREVIEW_CHARS} more chars) ↓`}
        </button>
      )}
    </div>
  );
}
