// scripts/test-status-order.ts   (npx tsx scripts/test-status-order.ts)
// Unit tests for compareStatusDisplay — canonical priority then A→Z.
import { compareStatusDisplay } from "../src/lib/lead-statuses";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name}`); }

const sorted = ["Junk", "Details Shared", "Fresh Lead", "Visit Dubai", "Follow Up", "Wants Office Visit", "Booked With Us", "Aaa"]
  .sort(compareStatusDisplay);

ok("Fresh Lead first", sorted[0] === "Fresh Lead");
ok("Wants Office Visit second", sorted[1] === "Wants Office Visit");
ok("Follow Up third", sorted[2] === "Follow Up");
ok("Visit Dubai fourth", sorted[3] === "Visit Dubai");
ok("Details Shared fifth", sorted[4] === "Details Shared");
ok("remaining are alpha (Aaa, Booked With Us, Junk)", sorted.slice(5).join(",") === "Aaa,Booked With Us,Junk");
ok("case-insensitive rank", compareStatusDisplay("fresh lead", "Junk") < 0);
ok("legacy 'Want Office Visit' also ranks", compareStatusDisplay("Want Office Visit", "Junk") < 0);

console.log(`\nSTATUS-ORDER: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
