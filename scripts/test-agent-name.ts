// scripts/test-agent-name.ts   (npx tsx scripts/test-agent-name.ts)
// Unit tests for the display-only agent-name canonicalizer.
import { canonicalAgentName } from "../src/lib/agentName";

let pass = 0, fail = 0;
function eq(name: string, got: string, want: string): void {
  if (got === want) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}: got "${got}" want "${want}"`); }
}

for (const v of ["Lalit", "Lalit Sir", "lalit  sir", "Shrama", "Sharma", "Lalit Shrama", "LALIT SHARMA", "Lalit Sharma Ji"]) {
  eq(`"${v}" → Lalit Sharma`, canonicalAgentName(v), "Lalit Sharma");
}
eq("Yasir + roster → Yasir Khan", canonicalAgentName("Yasir", ["Yasir Khan", "Mehak Mukhija"]), "Yasir Khan");
eq("ambiguous Rahul → unchanged", canonicalAgentName("Rahul", ["Rahul A", "Rahul B"]), "Rahul");
eq("empty → empty", canonicalAgentName(""), "");
eq("null → empty", canonicalAgentName(null), "");
eq("honorific strip 'Yasir Sir' (no roster) → Yasir", canonicalAgentName("Yasir Sir"), "Yasir");
eq("non-roster 'Kiran' preserved", canonicalAgentName("Kiran"), "Kiran");
eq("3-word place+name preserved", canonicalAgentName("Expressway Gurgaon Tanuj"), "Expressway Gurgaon Tanuj");

console.log(`\nAGENT-NAME: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
