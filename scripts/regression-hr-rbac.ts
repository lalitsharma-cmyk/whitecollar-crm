// HR RBAC REGRESSION — automated authorization-leak gate. Run before every HR
// deploy. Two layers:
//   (1) PURE permission-matrix unit tests (no DB) — the engine behaves per spec
//       for Admin / Senior HR / Junior HR.
//   (2) STATIC leak-scan — every /api/hr route (except public intake) is guarded
//       and no longer relies on a bare requireUser; every (hr) page is guarded;
//       list/workflow pages are candidate-scoped. Locks the invariant so a future
//       edit cannot silently reopen a hole.
// Exits non-zero on ANY failure.
import { readFileSync } from "fs";
import { execSync } from "child_process";
import {
  hrRoleOf, permissionsFor, hrPermissionsOf, hrScopeWhere, canTouchCandidate, hrRoleLabel,
  type HrUserLite,
} from "../src/lib/hrPermissions";

let failures = 0;
const ok = (m: string) => console.log(`  ✅ ${m}`);
const bad = (m: string) => { console.log(`  ❌ ${m}`); failures++; };
function eq(actual: unknown, expected: unknown, m: string) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(m);
  else bad(`${m} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── (1) PERMISSION MATRIX ────────────────────────────────────────────────────
console.log("\n=== HR RBAC — permission matrix ===");
const admin: HrUserLite   = { id: "u_admin",  role: "ADMIN",   hrOnly: false, hrTeam: false };
const senior: HrUserLite  = { id: "u_nisha",  role: "MANAGER", hrOnly: true,  hrTeam: false }; // Nisha
const seniorT: HrUserLite = { id: "u_st",     role: "ADMIN",   hrOnly: false, hrTeam: true };  // admin on HR team
const junior: HrUserLite  = { id: "u_jr",     role: "AGENT",   hrOnly: true,  hrTeam: false };
const sales: HrUserLite   = { id: "u_sales",  role: "AGENT",   hrOnly: false, hrTeam: false }; // NOT HR

eq(hrRoleOf(admin),  "ADMIN",     "admin → ADMIN");
eq(hrRoleOf(senior), "SENIOR_HR", "Nisha (hrOnly+MANAGER) → SENIOR_HR");
eq(hrRoleOf(seniorT),"ADMIN",     "admin+hrTeam → ADMIN (admin wins)");
eq(hrRoleOf(junior), "JUNIOR_HR", "hrOnly+AGENT → JUNIOR_HR");
eq(hrRoleOf(sales),  null,        "sales agent → null (no HR access)");
eq(hrRoleOf(null),   null,        "null user → null");

// Junior HR — the locked-down role
const jp = permissionsFor("JUNIOR_HR");
eq(jp.viewAllCandidates, false, "Junior: cannot view all candidates");
eq(jp.reports,           false, "Junior: no reports");
eq(jp.settings,          false, "Junior: no settings");
eq(jp.importData,        false, "Junior: no import");
eq(jp.exportData,        false, "Junior: no export");
eq(jp.manageUsers,       false, "Junior: cannot manage users");
eq(jp.assign,            false, "Junior: cannot assign");
eq(jp.bulkActions,       false, "Junior: no bulk actions");
eq(jp.deleteCandidate,   false, "Junior: cannot delete candidates");
eq(jp.sendVoiceGuidance, false, "Junior: cannot send voice guidance");
eq(jp.raiseEscalation,   true,  "Junior: CAN raise voice escalation");

// Senior HR — Nisha
const sp = permissionsFor("SENIOR_HR");
eq(sp.viewAllCandidates, true,  "Senior: views all candidates");
eq(sp.assign,            true,  "Senior: can assign/reassign");
eq(sp.reports,           true,  "Senior: reports");
eq(sp.reviewEscalations, true,  "Senior: reviews escalations");
eq(sp.sendVoiceGuidance, true,  "Senior: sends voice guidance");
eq(sp.importData,        true,  "Senior: import");
eq(sp.exportData,        true,  "Senior: export");
eq(sp.manageUsers,       false, "Senior: CANNOT manage users (admin only)");
eq(sp.systemSettings,    false, "Senior: CANNOT touch system settings");

// Admin — everything
const ap = permissionsFor("ADMIN");
eq(Object.values(ap).every(Boolean), true, "Admin: every permission true");

// Non-HR → all false
eq(Object.values(hrPermissionsOf(sales)).some(Boolean), false, "Sales agent: zero HR permissions");

// ── Scope ────────────────────────────────────────────────────────────────────
console.log("\n=== HR RBAC — candidate scope ===");
eq(hrScopeWhere(admin),  {}, "Admin scope = {} (all)");
eq(hrScopeWhere(senior), {}, "Senior scope = {} (all)");
eq(hrScopeWhere(junior), { OR: [{ primaryOwnerId: "u_jr" }, { secondaryOwnerId: "u_jr" }] }, "Junior scope = own only");
const sc = hrScopeWhere(sales) as { id?: string };
eq(typeof sc.id === "string" && sc.id !== "", true, "Non-HR scope = impossible match (sees nothing)");

const mine    = { primaryOwnerId: "u_jr",    secondaryOwnerId: null };
const notMine = { primaryOwnerId: "u_other", secondaryOwnerId: null };
const second  = { primaryOwnerId: "u_other", secondaryOwnerId: "u_jr" };
eq(canTouchCandidate(junior, mine),    true,  "Junior CAN touch own candidate");
eq(canTouchCandidate(junior, notMine), false, "Junior CANNOT touch others' candidate");
eq(canTouchCandidate(junior, second),  true,  "Junior CAN touch candidate they secondary-own");
eq(canTouchCandidate(senior, notMine), true,  "Senior CAN touch any candidate");
eq(canTouchCandidate(admin,  notMine), true,  "Admin CAN touch any candidate");
eq(canTouchCandidate(sales,  mine),    false, "Sales agent CANNOT touch any HR candidate");
void hrRoleLabel; // referenced for export presence

// ── (2) STATIC LEAK-SCAN ─────────────────────────────────────────────────────
console.log("\n=== HR RBAC — static route/page guard scan ===");
function ls(glob: string): string[] {
  // git ls-files is fast + ignores build artifacts; fall back to find.
  try { return execSync(`git ls-files "${glob}"`, { encoding: "utf8" }).split("\n").filter(Boolean); }
  catch { return []; }
}

const GUARD = /hrAccess|loadOwnedCandidate|hrApiAuth|requireHrPermission/;
const routes = ls("src/app/api/hr/**/route.ts").filter(f => !f.includes("api/intake/"));
for (const f of routes) {
  const src = readFileSync(f, "utf8");
  if (!GUARD.test(src)) { bad(`route NOT guarded: ${f}`); continue; }
  if (/from ["']@\/lib\/auth["']/.test(src) && /requireUser/.test(src))
    bad(`route still imports bare requireUser (should use a guard): ${f}`);
  else ok(`route guarded: ${f.replace("src/app/api/hr/", "")}`);
}
if (!routes.length) bad("no HR routes found — scan misconfigured");

const PAGE_GUARD = /requireHrPage|requireHrPagePermission|canTouchCandidate/;
// Accept BOTH scope helpers: hrScopeWhere and hrActiveScopeWhere (the latter is
// hrScopeWhere + {deletedAt:null} — strictly stronger). The HR dashboard redesign
// scopes via hrActiveScopeWhere, which is a genuine candidate scope; the regex must
// recognize it or it false-positives "not candidate-scoped" and blocks every deploy.
const SCOPE = /hr(?:Active)?ScopeWhere/;
const mustScope = ["candidates/page.tsx", "followups/page.tsx", "missed/page.tsx", "interviews/page.tsx", "calendar/page.tsx", "resume-bank/page.tsx", "hr/page.tsx"];
const pages = ls("src/app/(hr)/**/page.tsx");
for (const f of pages) {
  const src = readFileSync(f, "utf8");
  if (!PAGE_GUARD.test(src)) { bad(`page NOT guarded: ${f}`); continue; }
  const needsScope = mustScope.some(s => f.endsWith(s));
  if (needsScope && !SCOPE.test(src) && !/canTouchCandidate/.test(src))
    bad(`page not candidate-scoped: ${f}`);
  else ok(`page guarded: ${f.replace("src/app/(hr)/hr/", "")}`);
}
if (!pages.length) bad("no HR pages found — scan misconfigured");

// ── result ───────────────────────────────────────────────────────────────────
console.log(`\n=== HR RBAC RESULT: ${failures === 0 ? "✅ PASS — no authorization leaks" : `❌ ${failures} FAILURE(S)`} ===\n`);
process.exit(failures === 0 ? 0 : 1);
