// Parses multi-line remark cells from Nitisha MIS / Master Sheet into per-date CallLog rows.
// Handles ALL these real-world formats:
//   "Neeraj: On 6 April 2025 (5:30PM) Called at 93 degree..."   ← named entry
//   "On 24 Jul 2025 (4:26)Call busy"                            ← unnamed (inherits last name)
//   ",,,,,,On 23 Sep 2025 (12:43) not interested"               ← comma-separated noise
//   "From(24Jul-16 Sep 2025)"                                   ← date-range, skipped
// Free-form intro text before the first dated entry is ignored (kept in Lead.remarks).

import { CallOutcome } from "@prisma/client";

export interface ParsedRemark {
  agentName: string;
  when: Date;
  outcome: CallOutcome;
  text: string;
}

const MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
};

function parseDateTime(dateStr: string, timeStr?: string): Date | null {
  const m = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const yr = parseInt(m[3]);
  const d = new Date(yr, mon, day);
  if (timeStr) {
    const tm = timeStr.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
    if (tm) {
      let h = parseInt(tm[1]);
      const mins = parseInt(tm[2] || "0");
      const ampm = (tm[3] ?? "").toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
      d.setHours(h, mins);
    }
  }
  return d;
}

function guessOutcome(text: string): CallOutcome {
  const t = text.toLowerCase();
  if (/not\s*picked|did not pick|didn[''']?t pick|no answer|nai pick|not pick|wa dropped/i.test(t)) return CallOutcome.NOT_PICKED;
  if (/switched\s*off|switch off|switch-off/i.test(t)) return CallOutcome.SWITCHED_OFF;
  if (/(call\s*)?busy|in meeting/i.test(t)) return CallOutcome.BUSY;
  if (/wrong\s*number|not the right person/i.test(t)) return CallOutcome.WRONG_NUMBER;
  if (/callback|call back|call later|will call|connect (later|after|tomorrow|sunday|monday)/i.test(t)) return CallOutcome.CALLBACK;
  if (/not\s*interested|do not call|cancel my query|drop my query/i.test(t)) return CallOutcome.NOT_INTERESTED;
  if (/interested|positive|liked|wants|booked|will buy|ready to/i.test(t)) return CallOutcome.INTERESTED;
  if (text.trim().length >= 20) return CallOutcome.CONNECTED;
  return CallOutcome.CONNECTED;
}

export function parseRemarks(cell: string): ParsedRemark[] {
  if (!cell || typeof cell !== "string") return [];
  const text = cell.replace(/,{2,}/g, "\n").replace(/\s+\n/g, "\n");

  const results: ParsedRemark[] = [];
  const re = /(?:([A-Z][A-Za-z]{2,15})\s*:\s*)?[oO]n\s+([\dA-Za-z]+(?:\s+[\dA-Za-z]+){1,3})\s*\(([^)]+)\)\s*([^]*?)(?=(?:[A-Z][A-Za-z]{2,15}\s*:\s*[oO]n\s+)|(?:[oO]n\s+\d)|$)/g;

  let currentAgent = "Unknown";
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, agent, dateStr, timeStr, rawMsg] = m;
    if (agent) currentAgent = agent.trim();
    const when = parseDateTime(dateStr.trim(), timeStr.trim());
    if (!when) continue;
    const msg = (rawMsg || "").trim()
      .replace(/^[,\s]+/, "")
      .replace(/[,\s]+$/, "")
      .replace(/\s+/g, " ")
      .replace(/^From\s*\([^)]+\)\s*/, "");
    if (msg.length < 2) continue;
    results.push({ agentName: currentAgent, when, outcome: guessOutcome(msg), text: msg });
  }

  results.sort((a, b) => a.when.getTime() - b.when.getTime());
  return results;
}
