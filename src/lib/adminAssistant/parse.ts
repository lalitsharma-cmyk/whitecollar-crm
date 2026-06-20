// ─────────────────────────────────────────────────────────────────────────────
// Admin AI Assistant — deterministic natural-language command parser.
//
// There is NO LLM here on purpose. A rule-based parser cannot hallucinate a
// destructive action: anything it doesn't recognise becomes UNSUPPORTED, and
// any phrasing that smells like delete / edit-remarks / edit-history is REFUSED
// up front. The parser only ever emits one of a small, safe, reversible set of
// operations (assign owner, add tag, set team, set follow-up) plus read-only
// queries. Deleted / recycle-bin leads are excluded later, in the planner.
//
// Output is a ParsedCommand the planner turns into a Prisma `where` + preview.
// ─────────────────────────────────────────────────────────────────────────────

import { INDIA_STATUSES, DUBAI_STATUSES } from "@/lib/lead-statuses";

export type Team = "Dubai" | "India";

export type LeadFilter = {
  team?: Team;
  unassigned?: boolean;
  ownerName?: string;          // "owned by Tanuj" / "Tanuj's leads"
  status?: string;             // canonical status to contains-match
  source?: string;             // contains-match against sourceRaw
  createdWithinDays?: number;  // today=1, this week=7, "last N days"=N
  noFollowup?: boolean;        // leads with no follow-up date set
  origin?: "ACTIVE_LEAD" | "REVIVAL" | "MASTER_DATA";
};

export type ParsedCommand =
  | { intent: "QUERY"; filter: LeadFilter; explanation: string }
  | { intent: "ASSIGN"; filter: LeadFilter; agentName: string; explanation: string }
  | { intent: "TAG"; filter: LeadFilter; tag: string; explanation: string }
  | { intent: "SET_TEAM"; filter: LeadFilter; team: Team; explanation: string }
  | { intent: "SET_FOLLOWUP"; filter: LeadFilter; dateISO: string; dateLabel: string; explanation: string }
  | { intent: "UNSUPPORTED"; reason: string; explanation: string };

const ALL_STATUSES = [...new Set([...INDIA_STATUSES, ...DUBAI_STATUSES])];

// What the assistant can do — surfaced to the user when a command isn't understood.
export const CAPABILITIES = [
  'Count / list leads — e.g. "how many unassigned Dubai leads", "list India leads with no follow-up"',
  'Assign — e.g. "assign all unassigned Dubai leads to Aleena"',
  'Add a tag — e.g. "tag leads from Facebook as priority"',
  'Set team — e.g. "move unassigned leads to India team"',
  'Set follow-up — e.g. "set follow-up for unassigned Dubai leads to tomorrow"',
];

// ── Destructive / off-limits intents — refused before anything else ──────────
const FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /\b(delete|erase|purge|wipe|destroy|drop|remove)\b[\s\S]*\b(lead|leads|record|records|client|clients|customer|data|everything|all)\b/i,
    reason: "The assistant can never delete leads or data. Use the recycle bin manually if a lead must be removed." },
  { re: /\b(edit|change|alter|rewrite|overwrite|modify|clear|wipe)\b[\s\S]*\b(remark|remarks|conversation|history|note|notes|timeline)\b/i,
    reason: "The assistant can never edit remarks or conversation history — those are immutable." },
  { re: /\b(change|alter|rewrite|backdate|edit|modify)\b[\s\S]*\b(created|creation|audit|log|logs)\b/i,
    reason: "The assistant can never alter creation dates or audit history." },
  { re: /\b(hard\s*delete|permanently\s*delete|empty\s*(the\s*)?(recycle|trash|bin))\b/i,
    reason: "Permanent deletion is never available through the assistant." },
];

const TEAM_WORDS: Record<string, Team> = {
  dubai: "Dubai", uae: "Dubai", emirates: "Dubai",
  india: "India", gurgaon: "India", gurugram: "India", indian: "India",
};

function detectTeam(s: string): Team | undefined {
  for (const [w, t] of Object.entries(TEAM_WORDS)) if (new RegExp(`\\b${w}\\b`).test(s)) return t;
  return undefined;
}

function detectStatus(s: string): string | undefined {
  // Longest match first so "never respond phone calls" beats "respond".
  const found = ALL_STATUSES
    .filter((st) => s.includes(st.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  return found[0];
}

function detectCreatedWindow(s: string): number | undefined {
  if (/\btoday\b/.test(s)) return 1;
  if (/\byesterday\b/.test(s)) return 2;
  if (/\bthis week\b|\bpast week\b|\bin the last week\b/.test(s)) return 7;
  if (/\bthis month\b|\bpast month\b/.test(s)) return 30;
  const m = s.match(/\blast (\d{1,3}) days?\b/);
  if (m) return Math.min(parseInt(m[1], 10), 365);
  return undefined;
}

function detectOrigin(s: string): LeadFilter["origin"] {
  if (/\brevival\b|\bcold\b/.test(s)) return "REVIVAL";
  if (/\bmaster data\b|\brepository\b/.test(s)) return "MASTER_DATA";
  return undefined;
}

// "from facebook", "source facebook", "via google ads"
function detectSource(s: string): string | undefined {
  const m = s.match(/\b(?:from|source|via|through|channel)\s+([a-z0-9][a-z0-9 .\-/]{1,30}?)(?=\s+(?:lead|leads|as|to|tag|and|with|that|who|$)|$)/);
  const v = m?.[1]?.trim();
  // don't mistake "from today"/"from india" for a source
  if (!v || detectTeam(v) || /\btoday|week|month|yesterday\b/.test(v)) return undefined;
  return v;
}

function buildFilter(s: string): LeadFilter {
  const f: LeadFilter = {};
  const team = detectTeam(s);
  if (team) f.team = team;
  if (/\bunassigned\b|\bnot assigned\b|\bwithout (an )?owner\b|\bno owner\b|\bunallocated\b/.test(s)) f.unassigned = true;
  if (/\bno follow.?up\b|\bwithout (a )?follow.?up\b|\bmissing follow.?up\b|\bno next follow.?up\b/.test(s)) f.noFollowup = true;
  const status = detectStatus(s); if (status) f.status = status;
  const src = detectSource(s); if (src) f.source = src;
  const win = detectCreatedWindow(s); if (win) f.createdWithinDays = win;
  const origin = detectOrigin(s); if (origin) f.origin = origin;
  // "owned by X" / "assigned to X" / "X's leads" — but NOT when X is a team
  const owned = s.match(/\b(?:owned by|belonging to|assigned to|handled by)\s+([a-z][a-z .'-]{1,30}?)(?=\s+(?:lead|leads|and|with|that|who|$)|$)/);
  if (owned && !detectTeam(owned[1])) f.ownerName = owned[1].trim();
  else {
    const poss = s.match(/\b([a-z][a-z'-]{1,20})'s\s+leads?\b/);
    if (poss && !detectTeam(poss[1])) f.ownerName = poss[1].trim();
  }
  return f;
}

function filterPhrase(f: LeadFilter): string {
  const parts: string[] = [];
  if (f.unassigned) parts.push("unassigned");
  if (f.team) parts.push(f.team);
  if (f.origin === "REVIVAL") parts.push("revival");
  if (f.origin === "MASTER_DATA") parts.push("master-data");
  parts.push("leads");
  if (f.ownerName) parts.push(`owned by ${f.ownerName}`);
  if (f.status) parts.push(`with status “${f.status}”`);
  if (f.source) parts.push(`from ${f.source}`);
  if (f.noFollowup) parts.push("with no follow-up set");
  if (f.createdWithinDays) parts.push(f.createdWithinDays === 1 ? "created today" : `created in the last ${f.createdWithinDays} days`);
  return parts.join(" ");
}

// ── Date parsing for SET_FOLLOWUP (noon IST so it never shows 5:30 AM) ───────
function parseFollowupDate(s: string, now: Date): { iso: string; label: string } | undefined {
  const at = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo, d, 6, 30, 0)); // 12:00 IST
    return { iso: dt.toISOString(), label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(dt) };
  };
  // IST "now" for relative dates
  const istNow = new Date(now.getTime() + 5.5 * 3600 * 1000);
  const y = istNow.getUTCFullYear(), mo = istNow.getUTCMonth(), d = istNow.getUTCDate();
  if (/\btoday\b/.test(s)) return at(y, mo, d);
  if (/\btomorrow\b/.test(s)) return at(y, mo, d + 1);
  const inDays = s.match(/\bin (\d{1,3}) days?\b/); if (inDays) return at(y, mo, d + parseInt(inDays[1], 10));
  const nextWeek = /\bnext week\b/.test(s); if (nextWeek) return at(y, mo, d + 7);
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dm = s.match(/\b(?:next |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dm) {
    const target = days.indexOf(dm[1]);
    let add = (target - istNow.getUTCDay() + 7) % 7; if (add === 0) add = 7;
    return at(y, mo, d + add);
  }
  // explicit "DD-Mon-YY", "DD Mon", "YYYY-MM-DD"
  const explicit = s.match(/\b(\d{1,2}[-/ ][a-z]{3,9}([-/ ]\d{2,4})?|\d{4}-\d{2}-\d{2})\b/);
  if (explicit) {
    const dt = new Date(explicit[1].replace(/\s+/g, "-"));
    if (!isNaN(dt.getTime()) && dt.getTime() > now.getTime() - 86400000) {
      return at(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
    }
  }
  return undefined;
}

// Extract the bare target after "to" / "as" for ASSIGN / TAG.
function afterWord(s: string, word: string): string | undefined {
  const m = s.match(new RegExp(`\\b${word}\\s+(?:the\\s+)?([a-z0-9][a-z0-9 .'\\-]{0,40})$`));
  return m?.[1]?.trim().replace(/\b(team|agent|user)\b\.?$/, "").trim() || undefined;
}

/**
 * Parse a raw admin command into a structured, SAFE ParsedCommand.
 * `now` is injected so the function stays pure/testable.
 */
export function parseCommand(raw: string, now: Date = new Date()): ParsedCommand {
  const text = (raw ?? "").trim();
  const s = text.toLowerCase().replace(/\s+/g, " ");
  if (!s) return { intent: "UNSUPPORTED", reason: "Empty command.", explanation: "Type a command, e.g. “how many unassigned Dubai leads”." };

  // 1) Refuse anything destructive up front.
  for (const f of FORBIDDEN) if (f.re.test(s)) {
    return { intent: "UNSUPPORTED", reason: f.reason, explanation: f.reason };
  }

  const filter = buildFilter(s);
  const fp = filterPhrase(filter);

  // 2) SET_TEAM — explicit team-move ("move … to India team", "set team to Dubai")
  const teamMove = s.match(/\b(?:set|change|move|forward|put|switch|assign)\b[\s\S]*\b(?:team|to)\b[\s\S]*\b(dubai|uae|india|gurgaon|gurugram)\b/);
  const mentionsTeamWord = /\bteam\b/.test(s);
  if (teamMove && (mentionsTeamWord || /\bmove\b|\bforward\b|\bswitch\b/.test(s)) && !/\bto\s+[a-z]+\s+leads?\b/.test(s)) {
    const target = detectTeam(s.slice(s.search(/\bto\b/) >= 0 ? s.search(/\bto\b/) : 0)) ?? detectTeam(s);
    if (target) {
      // The destination team is the action, not a filter — drop it from filter.
      const f2 = { ...filter }; if (f2.team === target) delete f2.team;
      return { intent: "SET_TEAM", filter: f2, team: target,
        explanation: `Set team = ${target} on ${filterPhrase(f2) || "the matching leads"}.` };
    }
  }

  // 3) TAG — "tag … as X" / "add tag X" / "label … as X"
  if (/\b(tag|label)\b/.test(s) || /\badd (a )?tag\b/.test(s)) {
    let tag = afterWord(s, "as") || afterWord(s, "tag") || afterWord(s, "label");
    if (tag) {
      tag = tag.replace(/^(a|an|the)\s+/, "").trim();
      return { intent: "TAG", filter, tag,
        explanation: `Add the tag “${tag}” to ${fp || "the matching leads"} (existing tags are kept).` };
    }
  }

  // 4) SET_FOLLOWUP — "set/schedule follow-up … to/for/on <date>"
  if (/\bfollow.?up\b/.test(s) && /\b(set|schedule|change|update|move)\b/.test(s) && !/\bno follow.?up\b/.test(s)) {
    const date = parseFollowupDate(s, now);
    if (date) return { intent: "SET_FOLLOWUP", filter, dateISO: date.iso, dateLabel: date.label,
      explanation: `Set follow-up = ${date.label} on ${fp || "the matching leads"}.` };
    return { intent: "UNSUPPORTED", reason: "I couldn't read the follow-up date.",
      explanation: 'Try a clear date, e.g. “… to tomorrow”, “… to next Monday”, or “… to 25-Jun-2026”.' };
  }

  // 5) ASSIGN — "assign/reassign/allocate/give … to <agent>"
  if (/\b(assign|reassign|re-assign|allocate|give|hand over|transfer)\b/.test(s) && /\bto\b/.test(s)) {
    const target = afterWord(s, "to");
    if (target && !detectTeam(target)) {
      const agentName = target.replace(/^(agent|user)\s+/, "").trim();
      return { intent: "ASSIGN", filter, agentName,
        explanation: `Assign ${fp || "the matching leads"} to ${agentName}.` };
    }
  }

  // 6) QUERY — questions / show / list / count
  if (/\b(how many|count|number of|show|list|find|which|what are|display|leads)\b/.test(s)) {
    return { intent: "QUERY", filter, explanation: `Count and sample ${fp || "all leads"} (read-only).` };
  }

  // 7) Fallback
  return {
    intent: "UNSUPPORTED",
    reason: "I couldn't match that to a supported operation.",
    explanation: "Supported: " + CAPABILITIES.join(" · "),
  };
}
