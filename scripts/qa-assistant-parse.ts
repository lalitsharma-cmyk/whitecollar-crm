import { parseCommand } from "../src/lib/adminAssistant/parse";
const now = new Date("2026-06-21T08:00:00Z");
const cases: [string, string][] = [
  ["delete all leads", "UNSUPPORTED"],
  ["please remove all Dubai leads permanently", "UNSUPPORTED"],
  ["edit the remarks for unassigned leads", "UNSUPPORTED"],
  ["change conversation history", "UNSUPPORTED"],
  ["backdate created date of all leads", "UNSUPPORTED"],
  ["empty the recycle bin", "UNSUPPORTED"],
  ["how many unassigned dubai leads", "QUERY"],
  ["list india leads with no follow-up", "QUERY"],
  ["assign all unassigned dubai leads to Aleena", "ASSIGN"],
  ["reassign Tanuj's leads to Sameer", "ASSIGN"],
  ["tag leads from facebook as priority", "TAG"],
  ["move unassigned leads to india team", "SET_TEAM"],
  ["set follow-up for unassigned dubai leads to tomorrow", "SET_FOLLOWUP"],
  ["schedule followup for india leads to next monday", "SET_FOLLOWUP"],
  ["bake me a cake", "UNSUPPORTED"],
];
let pass = 0, fail = 0;
for (const [cmd, want] of cases) {
  const r = parseCommand(cmd, now);
  const ok = r.intent === want;
  if (ok) pass++; else fail++;
  const extra = r.intent === "ASSIGN" ? ` agent=${(r as any).agentName}` 
    : r.intent === "TAG" ? ` tag=${(r as any).tag} src=${JSON.stringify((r as any).filter.source)}`
    : r.intent === "SET_TEAM" ? ` team=${(r as any).team}`
    : r.intent === "SET_FOLLOWUP" ? ` date=${(r as any).dateLabel}`
    : r.intent === "QUERY" ? ` filter=${JSON.stringify((r as any).filter)}` : "";
  console.log(`${ok ? "✓" : "✗ WANT "+want+" GOT"} [${r.intent}] "${cmd}"${extra}`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
