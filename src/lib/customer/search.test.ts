// ────────────────────────────────────────────────────────────────────────────
// Customer layer — PURE unit tests for the search RANKING comparator (Rule 5).
//
// Only the pure ranking function is tested here (resolveCustomers itself is
// "server-only" + DB-bound and is build/typecheck-verified). Convention matches
// compute.test.ts / detect.test.ts: a self-contained runner with FIXED inputs.
// ────────────────────────────────────────────────────────────────────────────

import { rankCustomerSearchRows, type CustomerSearchRow } from "./searchRank";

export interface TestReport {
  passed: number;
  failed: number;
  failures: string[];
}

function row(p: Partial<CustomerSearchRow> & Pick<CustomerSearchRow, "customerId">): CustomerSearchRow {
  return {
    displayName: p.customerId,
    status: "Active",
    ownerOfRecord: "u1",
    enquiryCount: 1,
    lastActivityAt: null,
    confidence: 60,
    verifiedMobile: false,
    verifiedEmail: false,
    phones: [],
    emails: [],
    ...p,
  };
}

export function runSearchTests(): TestReport {
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  function check(name: string, cond: boolean): void {
    if (cond) passed++;
    else { failed++; failures.push(name); }
  }

  // 1. confidence dominates everything else.
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "low", confidence: 60, enquiryCount: 99, lastActivityAt: new Date("2030-01-01") }),
      row({ customerId: "high", confidence: 100, enquiryCount: 1, lastActivityAt: null }),
    ]);
    check("rank: higher confidence first", out[0].customerId === "high");
  }

  // 2. equal confidence → most recent activity first.
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "older", confidence: 80, lastActivityAt: new Date("2026-01-01") }),
      row({ customerId: "newer", confidence: 80, lastActivityAt: new Date("2026-06-01") }),
    ]);
    check("rank: more recent activity first", out[0].customerId === "newer");
  }

  // 3. equal confidence + equal activity → higher enquiry count first.
  {
    const t = new Date("2026-03-01");
    const out = rankCustomerSearchRows([
      row({ customerId: "few", confidence: 80, lastActivityAt: t, enquiryCount: 2 }),
      row({ customerId: "many", confidence: 80, lastActivityAt: t, enquiryCount: 9 }),
    ]);
    check("rank: more enquiries first", out[0].customerId === "many");
  }

  // 4. all else equal → active-first (Active < Converted < Closed).
  {
    const t = new Date("2026-03-01");
    const out = rankCustomerSearchRows([
      row({ customerId: "closed", confidence: 80, lastActivityAt: t, enquiryCount: 3, status: "Closed" }),
      row({ customerId: "active", confidence: 80, lastActivityAt: t, enquiryCount: 3, status: "Active" }),
      row({ customerId: "converted", confidence: 80, lastActivityAt: t, enquiryCount: 3, status: "Converted" }),
    ]);
    check("rank: active before converted before closed",
      out[0].customerId === "active" && out[1].customerId === "converted" && out[2].customerId === "closed");
  }

  // 5. null activity sorts after a real activity at equal confidence.
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "nullact", confidence: 80, lastActivityAt: null }),
      row({ customerId: "hasact", confidence: 80, lastActivityAt: new Date("2026-01-01") }),
    ]);
    check("rank: real activity before null activity", out[0].customerId === "hasact");
  }

  // ── 6-step order: verified-mobile / verified-email tie-breaks (steps 2 & 3) ──

  // 6. At equal confidence, a VERIFIED MOBILE match outranks a non-verified hit
  //    (the locked rule: verified mobile beats similar-name). Give the name-only
  //    row MORE recent activity + MORE enquiries to prove steps 2–3 fire BEFORE
  //    steps 4–5.
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "nameHit", confidence: 100, verifiedMobile: false, verifiedEmail: false,
            lastActivityAt: new Date("2030-01-01"), enquiryCount: 99 }),
      row({ customerId: "verifiedMobileHit", confidence: 100, verifiedMobile: true, verifiedEmail: false,
            lastActivityAt: new Date("2026-01-01"), enquiryCount: 1 }),
    ]);
    check("rank: verified mobile outranks similar-name (despite worse recency/count)",
      out[0].customerId === "verifiedMobileHit");
  }

  // 7. Verified mobile outranks verified email at equal confidence (step 2 before step 3).
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "emailHit", confidence: 100, verifiedMobile: false, verifiedEmail: true }),
      row({ customerId: "mobileHit", confidence: 100, verifiedMobile: true, verifiedEmail: false }),
    ]);
    check("rank: verified mobile before verified email", out[0].customerId === "mobileHit");
  }

  // 8. Verified email outranks a non-verified (name-only) hit at equal confidence.
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "nameOnly", confidence: 100, verifiedMobile: false, verifiedEmail: false,
            lastActivityAt: new Date("2030-06-01") }),
      row({ customerId: "emailHit", confidence: 100, verifiedMobile: false, verifiedEmail: true,
            lastActivityAt: new Date("2026-01-01") }),
    ]);
    check("rank: verified email outranks similar-name", out[0].customerId === "emailHit");
  }

  // 9. NEGATIVE: when neither row is verified (both fuzzy name hits), the verified
  //    flags don't reorder — fall through to recency (step 4).
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "olderFuzzy", confidence: 90, verifiedMobile: false, verifiedEmail: false, lastActivityAt: new Date("2026-01-01") }),
      row({ customerId: "newerFuzzy", confidence: 90, verifiedMobile: false, verifiedEmail: false, lastActivityAt: new Date("2026-06-01") }),
    ]);
    check("rank: two fuzzy hits fall through to recency", out[0].customerId === "newerFuzzy");
  }

  // 10. Confidence still dominates the verified flags: a higher-confidence
  //     non-verified row beats a lower-confidence verified-mobile row (step 1 first).
  {
    const out = rankCustomerSearchRows([
      row({ customerId: "lowConfVerified", confidence: 60, verifiedMobile: true }),
      row({ customerId: "highConfFuzzy", confidence: 100, verifiedMobile: false }),
    ]);
    check("rank: confidence outranks the verified tie-breaks", out[0].customerId === "highConfFuzzy");
  }

  return { passed, failed, failures };
}

if (typeof require !== "undefined" && require.main === module) {
  const r = runSearchTests();
  console.log(`customer search tests: ${r.passed} passed, ${r.failed} failed`);
  if (r.failures.length) {
    console.log("FAILURES:");
    for (const f of r.failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  process.exit(0);
}
