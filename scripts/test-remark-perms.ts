// scripts/test-remark-perms.ts   (npx tsx scripts/test-remark-perms.ts)
// Unit tests for canEditRemark — agent own + same-IST-day; admin/manager any.
import { canEditRemark } from "../src/lib/remarkPerms";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}`); }
}

const now = new Date("2026-06-21T08:00:00Z");            // IST 13:30, 21 Jun
const today = new Date("2026-06-21T05:00:00Z");          // IST 10:30, 21 Jun (same IST day)
const lateNightUTC20 = new Date("2026-06-20T19:00:00Z"); // IST 00:30, 21 Jun (UTC date 20, IST date 21)
const yesterday = new Date("2026-06-20T05:00:00Z");      // IST 10:30, 20 Jun
const agent = { id: "a1", role: "AGENT" };

ok("agent own + today → true", canEditRemark(agent, { createdById: "a1", createdAt: today }, now) === true);
ok("agent own + late-night UTC-20/IST-21 → true", canEditRemark(agent, { createdById: "a1", createdAt: lateNightUTC20 }, now) === true);
ok("agent own + yesterday → false", canEditRemark(agent, { createdById: "a1", createdAt: yesterday }, now) === false);
ok("agent other's today → false", canEditRemark(agent, { createdById: "a2", createdAt: today }, now) === false);
ok("agent null author → false", canEditRemark(agent, { createdById: null, createdAt: today }, now) === false);
ok("agent null date → false", canEditRemark(agent, { createdById: "a1", createdAt: null }, now) === false);
ok("admin any date → true", canEditRemark({ id: "x", role: "ADMIN" }, { createdById: "a2", createdAt: yesterday }, now) === true);
ok("admin imported (no author) → true", canEditRemark({ id: "x", role: "ADMIN" }, { createdById: null, createdAt: null }, now) === true);
ok("manager any → true", canEditRemark({ id: "m", role: "MANAGER" }, { createdById: "a2", createdAt: yesterday }, now) === true);
ok("agent imported (no author) → false", canEditRemark(agent, { createdById: null, createdAt: null }, now) === false);

console.log(`\nREMARK-PERMS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
