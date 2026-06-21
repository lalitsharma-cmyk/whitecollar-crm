// ────────────────────────────────────────────────────────────────────────────
// scripts/test-assistant-scope.ts   (npx tsx scripts/test-assistant-scope.ts)
//
// Unit tests for the Admin Assistant scope guard — proves a single-lead command
// ("transfer Kartik Trar to Mehak") targets exactly one lead and never broadens
// into a 442-lead bulk reassignment. Pure parser tests, no DB.
// ────────────────────────────────────────────────────────────────────────────
import { parseCommand, type ParsedCommand } from "../src/lib/adminAssistant/parse";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, p?: ParsedCommand): void {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}${p ? "  → " + JSON.stringify(p) : ""}`); }
}
const f = (p: ParsedCommand) => (p as { filter?: Record<string, unknown> }).filter ?? {};

// 1. THE BUG: a single named lead must be captured exactly, never broaden.
let p = parseCommand("Transfer Kartik Trar to Mehak");
check("transfer named lead → ASSIGN", p.intent === "ASSIGN", p);
check("  → leadName = kartik trar", f(p).leadName === "kartik trar", p);
check("  → agent = mehak", p.intent === "ASSIGN" && p.agentName === "mehak", p);

// 2. Quoted "by the name of" form.
p = parseCommand('Transfer this lead by the name of "Kartik Trar" to Mehak');
check("quoted named lead → leadName captured", f(p).leadName === "kartik trar", p);

// 3. Another plain named lead.
p = parseCommand("Assign Aman Goel to Yasir");
check("assign Aman Goel → leadName", p.intent === "ASSIGN" && f(p).leadName === "aman goel", p);

// 4. Legitimate bulk (filtered) — NO leadName, scoped to unassigned + Dubai.
p = parseCommand("assign all unassigned dubai leads to aleena");
check("bulk unassigned dubai → ASSIGN, no leadName", p.intent === "ASSIGN" && !f(p).leadName && f(p).unassigned === true && f(p).team === "Dubai", p);

// 5. "move … to <agent>" is also assign.
p = parseCommand("move unassigned Dubai leads to Mehak");
check("move unassigned dubai → ASSIGN bulk", p.intent === "ASSIGN" && f(p).unassigned === true && f(p).team === "Dubai", p);

// 6. Dangerous unscoped bulk → REFUSED.
p = parseCommand("assign leads to mehak");
check("assign leads to X (no scope) → UNSUPPORTED", p.intent === "UNSUPPORTED", p);

// 7. "this lead" with no identifier → REFUSED (ask which lead).
p = parseCommand("assign this lead to mehak");
check("assign 'this lead' (no id) → UNSUPPORTED", p.intent === "UNSUPPORTED", p);

// 8. Phone target.
p = parseCommand("transfer +91 98765 43210 to yasir");
check("transfer by phone → ASSIGN with phone", p.intent === "ASSIGN" && typeof f(p).phone === "string" && (f(p).phone as string).length >= 10, p);

// 9. Bulk follow-up (filtered) works.
p = parseCommand("set follow-up for unassigned dubai leads to tomorrow");
check("set followup bulk → SET_FOLLOWUP", p.intent === "SET_FOLLOWUP" && f(p).unassigned === true, p);

// 10. Unscoped follow-up → REFUSED.
p = parseCommand("set follow-up to tomorrow");
check("set followup no scope → UNSUPPORTED", p.intent === "UNSUPPORTED", p);

// 11. Tag a single named lead.
p = parseCommand("tag Kartik Trar as priority");
check("tag named lead → TAG + leadName", p.intent === "TAG" && f(p).leadName === "kartik trar" && p.tag === "priority", p);

// 12. Tag a filtered set (source) — no leadName.
p = parseCommand("tag leads from facebook as priority");
check("tag facebook leads → TAG + source", p.intent === "TAG" && f(p).source === "facebook" && !f(p).leadName, p);

// 13. Explicit bulk WITH a filter is allowed end-to-end.
p = parseCommand("assign all unassigned leads to mehak");
check("assign all unassigned → ASSIGN bulk", p.intent === "ASSIGN" && f(p).unassigned === true, p);

// 14. Read-only query still works.
p = parseCommand("how many unassigned dubai leads");
check("query unassigned dubai → QUERY", p.intent === "QUERY" && f(p).unassigned === true, p);

// 15. Team-scope: a named lead on the India team stays India-scoped.
p = parseCommand("assign india lead Rahul Verma to tanuj");
check("named India lead → leadName + team India", p.intent === "ASSIGN" && f(p).leadName === "rahul verma" && f(p).team === "India", p);

console.log(`\nASSISTANT-SCOPE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
