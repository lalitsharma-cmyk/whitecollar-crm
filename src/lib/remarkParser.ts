// Parses multi-line remark cells used in Nitisha MIS into per-date CallLog rows.
// Patterns supported:
//   "Nitisha: on 9 May 2026 (7:03) not picked"
//   "Kiran: On 22 Jul 2025 (10:12) He said I am from Sec-65..."
//   "Neeraj: On 6 April 2025 (5:30PM) Called at 93 degree..."

import { CallOutcome } from "@prisma/client";

export interface ParsedRemark {
  agentName: string;
  when: Date;
  outcome: CallOutcome;
  text: string;
}

// Heuristic outcome detection from remark text
function guessOutcome(text: string): CallOutcome {
  const t = text.toLowerCase();
  if (/not\s*picked|did not pick|didn't pick|missed|no answer|nai pick/i.test(t)) return CallOutcome.NOT_PICKED;
  if (/switched\s*off|switch off/i.test(t)) return CallOutcome.SWITCHED_OFF;
  if (/busy|in meeting/i.test(t)) return CallOutcome.BUSY;
  if (/wrong\s*number|not the right/i.test(t)) return CallOutcome.WRONG_NUMBER;
  if (/callback|call back|call later|will call/i.test(t)) return CallOutcome.CALLBACK;
  if (/not\s*interested|drop|disqualified/i.test(t)) return CallOutcome.NOT_INTERESTED;
  if (/interested|positive|liked|wants/i.test(t)) return CallOutcome.INTERESTED;
  // Default: if it looks like a substantive conversation, assume connected
  if (text.length > 30) return CallOutcome.CONNECTED;
  return CallOutcome.CONNECTED;
}

function parseDate(s: string, time?: string): Date | null {
  // Try direct parse first
  let d = new Date(s + (time ? ` ${time}` : ""));
  if (!isNaN(d.getTime())) return d;

  // Try various Indian/Dubai patterns: "9 May 2026", "22 Jul 2025"
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
  };
  const m = s.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (m) {
    const day = parseInt(m[1]);
    const mon = months[m[2].toLowerCase()];
    const yr = parseInt(m[3]);
    if (mon !== undefined) {
      d = new Date(yr, mon, day);
      if (time) {
        const tm = time.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm|AM|PM)?/);
        if (tm) {
          let h = parseInt(tm[1]);
          const mins = parseInt(tm[2] || "0");
          if (/pm/i.test(tm[3] ?? "") && h < 12) h += 12;
          if (/am/i.test(tm[3] ?? "") && h === 12) h = 0;
          d.setHours(h, mins);
        }
      }
      return d;
    }
  }
  return null;
}

/** Splits one multi-line remark cell into ordered ParsedRemarks. */
export function parseRemarks(cell: string): ParsedRemark[] {
  if (!cell) return [];
  const results: ParsedRemark[] = [];

  // Pattern: "Name: on/On Date (Time) message..."
  //   Allows the message to span lines until the next "Name: on" header.
  const re = /([A-Z][A-Za-z]+)\s*:\s*[oO]n\s+([\dA-Za-z\s,]+?)\s*\(([^)]+)\)\s*([^]*?)(?=(?:[A-Z][A-Za-z]+\s*:\s*[oO]n\s+)|$)/g;
  let m;
  while ((m = re.exec(cell)) !== null) {
    const [, agent, dateStr, timeStr, msg] = m;
    const when = parseDate(dateStr.trim(), timeStr.trim());
    if (!when) continue;
    const text = msg.trim().replace(/\s+/g, " ");
    results.push({
      agentName: agent.trim(),
      when,
      outcome: guessOutcome(text),
      text: text || "(no remark)",
    });
  }

  return results;
}
