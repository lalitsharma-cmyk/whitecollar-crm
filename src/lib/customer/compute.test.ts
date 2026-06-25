// ────────────────────────────────────────────────────────────────────────────
// Customer layer — PURE unit tests for the computed helpers (Step 1 foundation).
//
// No test framework is configured in this repo (the convention is the read-only
// regression harness). So these tests are written as a pure, self-contained
// function `runComputeTests()` that:
//   • uses FIXED inputs only (no Date.now(), no DB, no I/O) — fully deterministic
//   • returns { passed, failed, failures[] } so it can be (a) run standalone via
//     `npx tsx src/lib/customer/compute.test.ts` and (b) imported + asserted by
//     scripts/regression.ts (the `customer-computed-layer` invariant).
//
// Coverage includes EVERY owner-confirmed status example:
//   ≥1 active → Active · all rejected → Closed · qualified+rejected → Active ·
//   all converted → Converted · converted+rejected-no-active → Converted.
// ────────────────────────────────────────────────────────────────────────────

import {
  computeCustomerStatus,
  computeCustomerOwner,
  computeCustomerConfidence,
  computeCustomerSummary,
} from "./compute";
import { MULTIPLE_OWNERS, type CustomerEnquiryInput } from "./types";

export interface TestReport {
  passed: number;
  failed: number;
  failures: string[];
}

/** Minimal enquiry factory — only the fields the pure fns read. */
function enq(p: Partial<CustomerEnquiryInput> & Pick<CustomerEnquiryInput, "id">): CustomerEnquiryInput {
  return {
    currentStatus: null,
    ownerId: null,
    ...p,
  };
}

export function runComputeTests(): TestReport {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  function check(name: string, cond: boolean): void {
    if (cond) {
      passed++;
    } else {
      failed++;
      failures.push(name);
    }
  }
  function eq<T>(name: string, actual: T, expected: T): void {
    check(`${name} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`, actual === expected);
  }

  // ── computeCustomerStatus — owner-confirmed precedence examples ─────────────
  // Concrete statuses chosen from lead-statuses.ts:
  //   WORKABLE: "Fresh Lead", "Follow Up", "Meeting"
  //   CLOSED (converted/deal done): "Booked With Us", "Sell Out"
  //   LOST (rejected): "Not Interested", "Junk", "Number Changed"

  // (1) ≥1 active → Active
  eq("status: single Fresh → Active",
    computeCustomerStatus([enq({ id: "a", currentStatus: "Fresh Lead" })]), "Active");
  eq("status: active among terminals → Active",
    computeCustomerStatus([
      enq({ id: "a", currentStatus: "Booked With Us" }),
      enq({ id: "b", currentStatus: "Not Interested" }),
      enq({ id: "c", currentStatus: "Follow Up" }),
    ]), "Active");

  // (2) all rejected → Closed
  eq("status: all rejected → Closed",
    computeCustomerStatus([
      enq({ id: "a", currentStatus: "Not Interested" }),
      enq({ id: "b", currentStatus: "Junk" }),
      enq({ id: "c", currentStatus: "Number Changed" }),
    ]), "Closed");

  // (3) qualified + rejected → Active (a qualified/workable status wins)
  eq("status: qualified (Meeting) + rejected → Active",
    computeCustomerStatus([
      enq({ id: "a", currentStatus: "Meeting" }),
      enq({ id: "b", currentStatus: "Junk" }),
    ]), "Active");

  // (4) all converted → Converted
  eq("status: all converted → Converted",
    computeCustomerStatus([
      enq({ id: "a", currentStatus: "Booked With Us" }),
      enq({ id: "b", currentStatus: "Sell Out" }),
    ]), "Converted");

  // (5) converted + rejected, NO active → Converted
  eq("status: converted + rejected (no active) → Converted",
    computeCustomerStatus([
      enq({ id: "a", currentStatus: "Booked With Us" }),
      enq({ id: "b", currentStatus: "Not Interested" }),
    ]), "Converted");

  // Edge: null / unknown status is WORKABLE (fail-safe) → Active
  eq("status: null status → Active (fail-safe workable)",
    computeCustomerStatus([enq({ id: "a", currentStatus: null })]), "Active");
  eq("status: empty status → Active (fail-safe workable)",
    computeCustomerStatus([enq({ id: "a", currentStatus: "" })]), "Active");
  // Edge: no enquiries → Closed
  eq("status: no enquiries → Closed", computeCustomerStatus([]), "Closed");

  // ── computeCustomerOwner ────────────────────────────────────────────────────
  // canonical override always wins, even across multiple owners
  eq("owner: canonical override wins",
    computeCustomerOwner(
      [enq({ id: "a", ownerId: "u1" }), enq({ id: "b", ownerId: "u2" })],
      "uX",
    ), "uX");
  // single shared owner → that owner
  eq("owner: single shared owner",
    computeCustomerOwner(
      [enq({ id: "a", ownerId: "u1" }), enq({ id: "b", ownerId: "u1" })],
      null,
    ), "u1");
  // multiple distinct owners, no canonical → MULTIPLE
  eq("owner: multiple owners → MULTIPLE",
    computeCustomerOwner(
      [enq({ id: "a", ownerId: "u1" }), enq({ id: "b", ownerId: "u2" })],
      null,
    ), MULTIPLE_OWNERS);
  // no owners at all → MULTIPLE (none to single out)
  eq("owner: no owners → MULTIPLE",
    computeCustomerOwner([enq({ id: "a", ownerId: null })], null), MULTIPLE_OWNERS);
  // empty canonical string is treated as unset (falls through to derivation)
  eq("owner: empty canonical falls through to single owner",
    computeCustomerOwner([enq({ id: "a", ownerId: "u1" })], ""), "u1");

  // ── computeCustomerConfidence ───────────────────────────────────────────────
  {
    const r = computeCustomerConfidence({ sameMobile: true });
    check("confidence: sameMobile reason present", r.reasons.includes("Same mobile"));
    check("confidence: sameMobile score 60", r.score === 60);
  }
  {
    const r = computeCustomerConfidence({ sameEmail: true, similarName: true });
    check("confidence: email+name reasons present",
      r.reasons.includes("Same email") && r.reasons.includes("Similar name"));
    check("confidence: email+name score 80", r.score === 55 + 25);
  }
  {
    const r = computeCustomerConfidence({});
    check("confidence: no factors → score 0", r.score === 0);
    check("confidence: no factors → no reasons", r.reasons.length === 0);
  }
  {
    // Clamp: many factors must not exceed 100.
    const r = computeCustomerConfidence({
      sameMobile: true, sameEmail: true, sameAlternateNumber: true,
      sameCompany: true, similarName: true,
    });
    check("confidence: score clamped at 100", r.score === 100);
    check("confidence: all five reasons present", r.reasons.length === 5);
    // Strongest-first ordering: "Same mobile" before "Same company".
    check("confidence: reasons ordered strongest-first",
      r.reasons.indexOf("Same mobile") < r.reasons.indexOf("Same company"));
  }
  {
    const r = computeCustomerConfidence({ sameCompany: true, sameAlternateNumber: true });
    check("confidence: alt-number reason present", r.reasons.includes("Same alternate number"));
    check("confidence: company reason present", r.reasons.includes("Same company"));
  }

  // ── computeCustomerSummary (additive union) ─────────────────────────────────
  {
    const d1 = new Date("2026-01-10T00:00:00.000Z");
    const d2 = new Date("2026-03-20T00:00:00.000Z");
    const d3 = new Date("2026-02-15T00:00:00.000Z");
    const s = computeCustomerSummary([
      enq({ id: "a", phone: "+91111", email: "RAVI@x.com", sourceDetail: "Binghatti Skyflame", sourceRaw: "Website - Property", ownerId: "u1", createdAt: d1 }),
      enq({ id: "b", phone: "+91222", altPhone: "+91111", email: "ravi@x.com", altEmail: "r2@x.com", sourceDetail: "Binghatti Titania", sourceRaw: "Website - Property", ownerId: "u2", createdAt: d2 }),
      enq({ id: "c", phone: "+91222", sourceDetail: "Binghatti Skyflame", ownerId: "u1", createdAt: d3 }),
    ]);
    eq("summary: enquiryCount", s.enquiryCount, 3);
    // phones unioned + de-duped: +91111, +91222 (alt +91111 dupes)
    check("summary: phones unioned/deduped", s.phones.length === 2 && s.phones.includes("+91111") && s.phones.includes("+91222"));
    // emails case-insensitive de-dupe: RAVI@x.com == ravi@x.com → one, plus r2@x.com
    check("summary: emails case-insensitive dedupe", s.emails.length === 2);
    // projects de-duped: 2 distinct
    check("summary: projects deduped", s.projects.length === 2);
    // sources de-duped: 1 distinct ("Website - Property")
    check("summary: sources deduped", s.sources.length === 1);
    // owners: u1, u2
    check("summary: owners unioned", s.owners.length === 2);
    // first/last enquiry dates
    eq("summary: firstEnquiryAt = earliest", s.firstEnquiryAt?.getTime() ?? -1, d1.getTime());
    eq("summary: lastEnquiryAt = latest", s.lastEnquiryAt?.getTime() ?? -1, d2.getTime());
  }
  {
    // Empty input → empty rollup, null dates.
    const s = computeCustomerSummary([]);
    check("summary: empty → 0 enquiries, null dates",
      s.enquiryCount === 0 && s.firstEnquiryAt === null && s.lastEnquiryAt === null && s.phones.length === 0);
  }

  return { passed, failed, failures };
}

// Standalone runner: `npx tsx src/lib/customer/compute.test.ts`
// (guarded so importing this module for the regression harness has no side effect)
if (typeof require !== "undefined" && require.main === module) {
  const r = runComputeTests();
  console.log(`customer compute tests: ${r.passed} passed, ${r.failed} failed`);
  if (r.failures.length) {
    console.log("FAILURES:");
    for (const f of r.failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}
