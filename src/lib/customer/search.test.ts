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
