// ────────────────────────────────────────────────────────────────────────────
// Customer layer — PURE unit tests for the detection engine (Step 1 foundation).
//
// Same convention as compute.test.ts: a self-contained `runDetectTests()` over
// FIXED inputs (no DB, no Date.now()) returning { passed, failed, failures } so
// it runs standalone (`npx tsx src/lib/customer/detect.test.ts`) and is
// assertable from scripts/regression.ts.
// ────────────────────────────────────────────────────────────────────────────

import { detectCandidates, scoreCandidate, namesSimilar, tierForFactors } from "./detect";
import type { DetectCandidate } from "./detect";
import type { CustomerEnquiryInput } from "./types";

export interface TestReport {
  passed: number;
  failed: number;
  failures: string[];
}

function lead(p: Partial<CustomerEnquiryInput> & Pick<CustomerEnquiryInput, "id">): CustomerEnquiryInput {
  return { currentStatus: null, ownerId: null, ...p };
}
function cand(p: Partial<DetectCandidate> & Pick<DetectCandidate, "id">): DetectCandidate {
  return { currentStatus: null, ownerId: null, ...p };
}

export function runDetectTests(): TestReport {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  function check(name: string, cond: boolean): void {
    if (cond) passed++;
    else { failed++; failures.push(name); }
  }

  // ── namesSimilar ────────────────────────────────────────────────────────────
  check("name: exact match", namesSimilar("Ravi", "Ravi"));
  check("name: case/space-insensitive", namesSimilar("ravi  Upadhyay", "Ravi Upadhyay"));
  check("name: ≤3 edits similar", namesSimilar("Ravi Upadhyay", "Ravi Upadhyey"));
  check("name: very different not similar", !namesSimilar("Ravi", "Mahendra Singh"));
  check("name: empty never similar", !namesSimilar("", "Ravi") && !namesSimilar("Ravi", null));

  // ── Very High: same email, different phone (the REAL Ravi shape) ─────────────
  {
    const subject = lead({ id: "a", name: "Ravi", phone: "+917018120792", email: "upadhyay84ravi@gmail.com" });
    const pool = [cand({ id: "b", name: "Ravi", phone: "+919999999999", email: "upadhyay84ravi@gmail.com" })];
    const m = detectCandidates(subject, pool);
    check("ravi: one match returned", m.length === 1);
    check("ravi: tier Very High", m[0]?.tier === "Very High");
    check("ravi: reasons include Same email", !!m[0]?.reasons.includes("Same email"));
    check("ravi: reasons include Similar name", !!m[0]?.reasons.includes("Similar name"));
    check("ravi: sameEmail factor true, sameMobile false", m[0]?.factors.sameEmail === true && m[0]?.factors.sameMobile === false);
    check("ravi: score 80 (55 email + 25 name)", m[0]?.score === 80);
    check("ravi: matchedLeadId is candidate", m[0]?.matchedLeadId === "b");
  }

  // ── Very High: same mobile ──────────────────────────────────────────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Anil", phone: "+919876543210" }),
      cand({ id: "b", name: "Different Name", phone: "9876543210" }), // same last-10, no +91
    );
    check("same-mobile: matched", !!m);
    check("same-mobile: Very High", m?.tier === "Very High");
    check("same-mobile: reason Same mobile", !!m?.reasons.includes("Same mobile"));
  }

  // ── High: alternate-number overlap (no primary match, no email) ─────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Person One", phone: "+911111111111", altPhone: "+912222222222" }),
      cand({ id: "b", name: "Totally Other", phone: "+913333333333", altPhone: "+912222222222" }),
    );
    check("alt-number: matched", !!m);
    check("alt-number: High tier", m?.tier === "High");
    check("alt-number: sameAlternateNumber factor", m?.factors.sameAlternateNumber === true);
    check("alt-number: sameMobile false", m?.factors.sameMobile === false);
    check("alt-number: reason Same alternate number", !!m?.reasons.includes("Same alternate number"));
  }

  // ── Medium: similar name + same company (no phone/email overlap) ─────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Sunita Sharma", phone: "+915555500001", company: "Acme Corp" }),
      cand({ id: "b", name: "Sunita Sharmaa", phone: "+915555599999", company: "acme corp" }),
    );
    check("medium: matched", !!m);
    check("medium: Medium tier", m?.tier === "Medium");
    check("medium: reasons include Similar name + Same company",
      !!m?.reasons.includes("Similar name") && !!m?.reasons.includes("Same company"));
  }

  // ── Medium: name-only (similar name, nothing else) ──────────────────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Rohit Mehta", phone: "+916000000001" }),
      cand({ id: "b", name: "Rohit Mehta", phone: "+916000000002" }),
    );
    check("name-only: matched", !!m);
    check("name-only: Medium tier", m?.tier === "Medium");
  }

  // ── No signal → no match ────────────────────────────────────────────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Alpha Person", phone: "+917000000001", email: "alpha@x.com" }),
      cand({ id: "b", name: "Beta Other", phone: "+918000000002", email: "beta@y.com" }),
    );
    check("no-signal: null (no match)", m === null);
  }

  // ── Company-only is too weak → dropped ──────────────────────────────────────
  {
    const m = scoreCandidate(
      lead({ id: "a", name: "Alpha Person", company: "SharedCo", phone: "+917000000001" }),
      cand({ id: "b", name: "Beta Other", company: "SharedCo", phone: "+918000000002" }),
    );
    check("company-only: dropped (too weak)", m === null);
  }

  // ── Deleted candidate excluded ──────────────────────────────────────────────
  {
    const subject = lead({ id: "a", name: "Ravi", email: "upadhyay84ravi@gmail.com" });
    const pool = [cand({ id: "b", name: "Ravi", email: "upadhyay84ravi@gmail.com", deleted: true })];
    const m = detectCandidates(subject, pool);
    check("deleted: excluded from results", m.length === 0);
  }

  // ── Self never matches self ─────────────────────────────────────────────────
  {
    const subject = lead({ id: "a", name: "Ravi", email: "upadhyay84ravi@gmail.com" });
    const m = detectCandidates(subject, [cand({ id: "a", name: "Ravi", email: "upadhyay84ravi@gmail.com" })]);
    check("self: never matches self", m.length === 0);
  }

  // ── Sorting: strongest first ────────────────────────────────────────────────
  {
    const subject = lead({ id: "a", name: "Ravi Kumar", phone: "+919876543210", email: "ravi@x.com", company: "Acme" });
    const pool = [
      cand({ id: "weakMedium", name: "Ravi Kumar", phone: "+910000000000" }),                 // Medium (name only)
      cand({ id: "strongVH", name: "Ravi Kumar", phone: "+919876543210" }),                   // Very High (same mobile)
      cand({ id: "midHigh", name: "Zzz Other", phone: "+911111111111", altPhone: "+919876543210" }), // High (alt overlap)
    ];
    const m = detectCandidates(subject, pool);
    check("sort: three matches", m.length === 3);
    check("sort: strongest (Very High) first", m[0]?.matchedLeadId === "strongVH");
    check("sort: scores descending", (m[0]?.score ?? 0) >= (m[1]?.score ?? 0) && (m[1]?.score ?? 0) >= (m[2]?.score ?? 0));
  }

  // ── tierForFactors direct ───────────────────────────────────────────────────
  check("tier: sameMobile → Very High", tierForFactors({ sameMobile: true, sameEmail: false, similarName: false, sameCompany: false, sameAlternateNumber: false }) === "Very High");
  check("tier: sameEmail → Very High", tierForFactors({ sameMobile: false, sameEmail: true, similarName: false, sameCompany: false, sameAlternateNumber: false }) === "Very High");
  check("tier: alt only → High", tierForFactors({ sameMobile: false, sameEmail: false, similarName: false, sameCompany: false, sameAlternateNumber: true }) === "High");
  check("tier: name only → Medium", tierForFactors({ sameMobile: false, sameEmail: false, similarName: true, sameCompany: false, sameAlternateNumber: false }) === "Medium");
  check("tier: nothing → None", tierForFactors({ sameMobile: false, sameEmail: false, similarName: false, sameCompany: false, sameAlternateNumber: false }) === "None");

  return { passed, failed, failures };
}

if (typeof require !== "undefined" && require.main === module) {
  const r = runDetectTests();
  console.log(`customer detect tests: ${r.passed} passed, ${r.failed} failed`);
  if (r.failures.length) {
    console.log("FAILURES:");
    for (const f of r.failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}
