// ────────────────────────────────────────────────────────────────────────────
// scripts/regression.ts — READ-ONLY regression suite + deployment gate
//
//   npx tsx scripts/regression.ts        (also: npm run regression)
//
// WHY THIS EXISTS
//   Past deploys silently broke shipped invariants (deleted leads reappearing in
//   duplicate detection, the source migration regressing to raw enum tokens,
//   importer cross-field contamination, remark truncation). The Vercel build
//   only gates on `next build` (types + compile). It does NOT prove the live
//   DATA still satisfies the business invariants. This suite does: it runs a
//   battery of PASS/FAIL assertions against the real prod DB and exits non-zero
//   if ANY fails — so `scripts/deploy.sh` can abort the push before a regression
//   ships.
//
// HARD CONSTRAINTS (do not relax)
//   • READ-ONLY. This script performs ZERO writes — no create/update/delete,
//     no $executeRaw. Only counts, findMany/findFirst (select), and read-only
//     $queryRaw SELECTs. Safe to run against production Neon any number of times.
//   • Server-only libs (dedup.ts, customerHistory.ts, leadScope.ts,
//     investorMatch.ts) import "server-only", which bare `tsx` cannot resolve.
//     So the relevant `where` clauses are REPLICATED INLINE here, kept
//     byte-for-byte equivalent to the source. When you change a query in those
//     libs, mirror it here. Pure libs WITHOUT "server-only" are imported directly
//     (sourceLabel.ts, importValidate.ts) so those assertions test the REAL code.
//
// OUTPUT
//   One line per assertion (✓/✗), then `REGRESSION: X passed, Y failed`.
//   process.exit(1) on any failure, else exit 0.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "../src/lib/prisma";
// Pure libs (NO "server-only") — import the REAL implementations so these
// assertions test production code, not a copy.
import { sourceBreakdown } from "../src/lib/sourceLabel";
import {
  validBudgetRaw,
  validEmail,
  validPhone,
  looksLikeStatus,
  looksLikeDate,
} from "../src/lib/importValidate";

// ── tiny assertion harness ──────────────────────────────────────────────────
type Check = { name: string; run: () => Promise<void> };

let passed = 0;
let failed = 0;
const results: { name: string; ok: boolean; detail: string }[] = [];

/** Throw with a clear message when `cond` is false. */
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// last-10 digits canonical phone key — mirrors customerHistory.last10 / dedup.
function last10(s?: string | null): string {
  return (s ?? "").replace(/\D/g, "").slice(-10);
}

// ── the suite ────────────────────────────────────────────────────────────────
const checks: Check[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // 0. SCHEMA / CONNECTIVITY
  //    prisma connects, lead.count works, and the audit/source columns exist
  //    (selecting them must not throw — proves the migration is applied in prod).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "schema/connectivity — lead.count() + rawRemarks/rawImport/sourceRaw columns exist",
    run: async () => {
      const total = await prisma.lead.count();
      assert(typeof total === "number", "lead.count() did not return a number");
      assert(total >= 0, `lead.count() returned a negative number: ${total}`);
      // Selecting the audit/source columns must succeed (column-presence probe).
      const row = await prisma.lead.findFirst({
        select: { id: true, rawRemarks: true, rawImport: true, sourceRaw: true, source: true },
      });
      // row may be null on an empty DB; the point is the SELECT itself didn't throw.
      void row;
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 0b. ENDPOINT AUTH  — the recurring "UI-gated but API-open" class.
  //    Lead import endpoints MUST role-gate their POST (requireRole), not just
  //    requireUser(). A static source-scan so a future refactor can't silently
  //    re-open them to any logged-in agent (who could overwrite leads on dedupe).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "endpoint-auth — lead import endpoints are role-gated (requireRole, not open)",
    run: async () => {
      const fs = await import("fs");
      for (const f of [
        "src/app/api/intake/csv/route.ts",
        "src/app/api/intake/google-sheet/route.ts",
      ]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/requireRole\(/.test(src), `${f} POST must be role-gated (requireRole) — reverted to requireUser()?`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DELETED-LEAD EXCLUSION  (project-deleted-dup-exclusion + deleted-dup)
  //    A soft-deleted lead (deletedAt != null) must NOT surface in:
  //      (a) the Previous-History query   { deletedAt: null, OR:[phone/email] }
  //      (b) the dedup query              AND:[{deletedAt:null}, {OR:[...]}]
  //      (c) the investor-match SQL       WHERE "deletedAt" IS NULL
  //    For each, assert the BASELINE (no deletedAt filter) DOES match the fixture
  //    and the FILTERED query does NOT — proving the filter is what excludes it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "deleted-exclusion — soft-deleted lead hidden from history/dedup/investor-match (baseline matches, filtered does not)",
    run: async () => {
      // Pick a REAL soft-deleted lead with something to match on (phone or email).
      const fixture = await prisma.lead.findFirst({
        where: { deletedAt: { not: null }, OR: [{ phone: { not: null } }, { email: { not: null } }] },
        select: { id: true, phone: true, altPhone: true, email: true, deletedAt: true },
      });

      if (!fixture) {
        // No soft-deleted lead exists right now → nothing to assert. Don't fail
        // the gate over absent fixture data; the filters are still proven by the
        // import-batch rollback flow. Treat as a no-op pass.
        results.push({ name: "  ↳ note", ok: true, detail: "no soft-deleted fixture present — exclusion checks skipped" });
        return;
      }
      assert(fixture.deletedAt != null, "fixture is not actually soft-deleted");

      const p10 = last10(fixture.phone);
      const emailLc = (fixture.email ?? "").trim().toLowerCase();
      assert(p10.length >= 7 || emailLc.length > 0, "fixture has neither a usable phone nor email to match on");

      // Build the same OR clause customerHistory uses (phone endsWith last-10 OR email insensitive).
      const historyOR: Array<Record<string, unknown>> = [];
      if (p10.length >= 7) historyOR.push({ phone: { endsWith: p10 } }, { altPhone: { endsWith: p10 } });
      if (emailLc) historyOR.push({ email: { equals: emailLc, mode: "insensitive" } });

      // (a) customerHistory — getCustomerHistory uses where:{ deletedAt:null, OR }.
      const baselineHistory = await prisma.lead.count({ where: { OR: historyOR } });
      const filteredHistory = await prisma.lead.count({ where: { deletedAt: null, OR: historyOR } });
      assert(baselineHistory >= 1, "history baseline (no deletedAt filter) did not match the deleted fixture — fixture/query mismatch");
      // The fixture itself is deleted; filtered must not count it. (Other LIVE leads
      // sharing the contact may still match — so assert filtered < baseline, i.e.
      // at least the deleted one dropped out.)
      assert(filteredHistory < baselineHistory, `deletedAt:null did NOT exclude the soft-deleted lead from Previous-History (baseline=${baselineHistory}, filtered=${filteredHistory})`);

      // (b) dedup — findPossibleDuplicates final where is AND:[ scope, {deletedAt:null}, {OR} ].
      // Mirror the email + exact-phone OR clauses (the parts that match our fixture).
      const dedupOR: Array<Record<string, unknown>> = [];
      if (fixture.phone) { dedupOR.push({ phone: fixture.phone }, { altPhone: fixture.phone }); }
      if (emailLc) dedupOR.push({ email: { equals: emailLc, mode: "insensitive" } });
      assert(dedupOR.length > 0, "could not build a dedup OR clause for the fixture");
      const dedupBaseline = await prisma.lead.count({ where: { OR: dedupOR } });
      const dedupFiltered = await prisma.lead.count({ where: { AND: [{ deletedAt: null }, { OR: dedupOR }] } });
      assert(dedupBaseline >= 1, "dedup baseline did not match the deleted fixture");
      assert(dedupFiltered < dedupBaseline, `dedup AND:[{deletedAt:null},{OR}] did NOT exclude the soft-deleted lead (baseline=${dedupBaseline}, filtered=${dedupFiltered})`);

      // (c) investor-match — raw SQL: WHERE "phone" IS NOT NULL AND "deletedAt" IS NULL
      //     AND RIGHT(REGEXP_REPLACE("phone",'\D','','g'),10) = $tail.
      //     Only meaningful when the fixture has a 10-digit phone.
      if (p10.length === 10) {
        const baseRows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Lead"
          WHERE "phone" IS NOT NULL
            AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 10) = ${p10}`;
        const filtRows = await prisma.$queryRaw<{ id: string }[]>`
          SELECT "id" FROM "Lead"
          WHERE "phone" IS NOT NULL
            AND "deletedAt" IS NULL
            AND RIGHT(REGEXP_REPLACE("phone", '\D', '', 'g'), 10) = ${p10}`;
        const baseIds = new Set(baseRows.map((r) => r.id));
        const filtIds = new Set(filtRows.map((r) => r.id));
        assert(baseIds.has(fixture.id), "investor-match baseline SQL did not match the deleted fixture by phone tail");
        assert(!filtIds.has(fixture.id), `investor-match WHERE "deletedAt" IS NULL did NOT exclude the soft-deleted fixture`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 2. SOURCE MIGRATION  (project-wcr-crm source overhaul)
  //    sourceBreakdown over live leads must yield HUMAN labels, never a bare
  //    enum token like "CSV_IMPORT" / "FACEBOOK_ADS". Distinct sourceRaw >= 5.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "source-migration — sourceBreakdown returns human labels (no raw enum tokens) + >=5 distinct sourceRaw",
    run: async () => {
      const rows = await prisma.lead.findMany({
        where: { deletedAt: null },
        select: { source: true, sourceRaw: true },
      });
      const breakdown = sourceBreakdown(rows);
      assert(breakdown.length > 0, "sourceBreakdown produced no rows over live leads");

      // A raw enum token = ALL CAPS with an underscore, or a known SOURCE_ENUM key.
      // effectiveSource() must never surface these (it maps them to friendly labels
      // or prefers verbatim sourceRaw).
      const RAW_ENUM_TOKENS = new Set([
        "WEBSITE", "WHATSAPP", "CSV_IMPORT", "EVENT", "REFERRAL", "INBOUND_CALL",
        "FACEBOOK_ADS", "GOOGLE_ADS", "PORTAL_99ACRES", "PORTAL_MAGICBRICKS",
        "PORTAL_HOUSING", "OTHER",
      ]);
      const offenders = breakdown
        .map((b) => b.source)
        .filter((s) => RAW_ENUM_TOKENS.has(s) || /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(s));
      assert(
        offenders.length === 0,
        `sourceBreakdown leaked raw enum token(s): ${offenders.join(", ")} — source UI/reporting must show human labels`,
      );

      // Distinct sourceRaw options must be a real vocabulary (>= 5).
      const distinct = await prisma.lead.findMany({
        where: { deletedAt: null, sourceRaw: { not: null } },
        select: { sourceRaw: true },
        distinct: ["sourceRaw"],
      });
      assert(distinct.length >= 5, `expected >=5 distinct sourceRaw values, found ${distinct.length}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3. IMPORT FIELD VALIDATION  (importValidate.ts — cross-field contamination)
  //    The importer's per-field guards reject values leaked from other columns.
  //    These test the REAL imported functions.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "import-validation — budget/email/phone/status guards reject cross-field contamination",
    run: async () => {
      // Budget: a person's name in the budget cell → rejected (no digits).
      assert(validBudgetRaw("Lalit Sir") === undefined, `validBudgetRaw("Lalit Sir") should reject (got ${JSON.stringify(validBudgetRaw("Lalit Sir"))})`);
      assert(validBudgetRaw("Tanuj") === undefined, "validBudgetRaw('Tanuj') should reject");
      // ...but a real budget with digits passes (verbatim).
      assert(validBudgetRaw("10 Cr") === "10 Cr", `validBudgetRaw("10 Cr") should pass verbatim (got ${JSON.stringify(validBudgetRaw("10 Cr"))})`);

      // Email: the boolean "false" (leaked from a TRUE/FALSE column) → rejected.
      assert(validEmail("false") === undefined, `validEmail("false") should reject (got ${JSON.stringify(validEmail("false"))})`);
      // ...but a real email normalises to lowercase.
      assert(validEmail("A@B.com") === "a@b.com", `validEmail("A@B.com") should normalise (got ${JSON.stringify(validEmail("A@B.com"))})`);

      // Phone: a country-code-only "+91" → rejected (too few digits).
      assert(validPhone("+91") === undefined, `validPhone("+91") should reject (got ${JSON.stringify(validPhone("+91"))})`);
      // ...but a full E.164 passes through.
      assert(validPhone("+919876543210") === "+919876543210", `validPhone("+919876543210") should pass (got ${JSON.stringify(validPhone("+919876543210"))})`);

      // Status: a boolean token "FALSE" (from a Meeting/Site-Visit column) is NOT a status.
      assert(looksLikeStatus("FALSE") === false, "looksLikeStatus('FALSE') should be false");
      // ...but a real status label IS.
      assert(looksLikeStatus("Callback today") === true, "looksLikeStatus('Callback today') should be true");

      // Date guard (2026-06-19): a date is never a budget, and is detected so the
      // importer keeps it OUT of name/company/city/address/configuration/BANT.
      assert(looksLikeDate("19-Jun-26") === true && looksLikeDate("2026-06-19") === true && looksLikeDate("19/06/2026") === true, "looksLikeDate should detect date formats");
      assert(looksLikeDate("Mumbai") === false && looksLikeDate("7000000") === false && looksLikeDate("2 BHK") === false, "looksLikeDate must NOT flag a city / pure-number budget / config");
      assert(validBudgetRaw("19-Jun-26") === undefined, "validBudgetRaw must reject a date value");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3b. UNLABELED CONVERSATION COLUMN (2026-06-20 regression)
  //     Yasir/Dinesh MIS sheets keep call history in a BLANK-HEADER column. The
  //     P0 date-leak fix dropped all blank-header columns, silently losing their
  //     conversation. The importer now RESCUES a genuine conversation column to
  //     Remarks — but ONLY a blank-header column, ONLY when no labeled Remarks
  //     column exists, and ONLY if the content is call-log-like (never a date
  //     column → the date-leak must not return through this path).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "conversation-column — rescue unlabeled call-log col, ignore labeled/date/short cols",
    run: async () => {
      const { detectConversationColumn, detectConversationKeyFromRows, looksLikeConversation } = await import("../src/lib/conversationColumn");

      // A real call note is conversation; a date / status / number is NOT.
      assert(looksLikeConversation("On 25 Sep 2021 looking 4550 sqft in Trump Towers, will visit next week") === true, "a dated call note must be conversation");
      assert(looksLikeConversation("17-Apr-26") === false, "a bare date is NOT conversation");
      assert(looksLikeConversation("Cold") === false && looksLikeConversation("9650536365") === false, "a status word / phone number is NOT conversation");

      // Yasir-shape: conversation sits under a BLANK header (index 3) → rescued.
      const headersBlank = ["Date", "Name", "Contact", ""];
      const rowsBlank = [
        ["25-Sep-21", "Meena", "9650536365", "On 25 Sep 2021 looking 4550 sqft in Trump Towers, curious to see sample apartment"],
        ["16-Oct-21", "Gagan", "9810112801", "On 16 Oct 2021 call on wait. On 17 Oct call him at 5pm, not picked"],
        ["18-Oct-21", "Asha", "9818860113", "On 18 Oct 2021 looking for site visit, discuss 4750 and villa, will come this week"],
        ["20-Aug-25", "Sumeet", "9810264604", "Yasir: on 20 Aug 2025 (5:55pm) not picked, WhatsApp message sent, will follow up"],
      ];
      assert(detectConversationColumn(headersBlank, rowsBlank) === 3, "unlabeled conversation column (idx 3) must be detected");

      // Labeled "Remarks" present → normal mapping owns it, detector stays out (-1).
      const headersLabeled = ["Date", "Name", "Remarks✍️"];
      const rowsLabeled = rowsBlank.map((r) => [r[0], r[1], r[3]]);
      assert(detectConversationColumn(headersLabeled, rowsLabeled) === -1, "a labeled Remarks column must keep detector OUT (-1)");

      // A blank-header DATE column must NOT be mistaken for conversation (no date-leak).
      const headersDate = ["Date", "Name", ""];
      const rowsDate = [["25-Sep-21", "Meena", "17-Apr-26"], ["16-Oct-21", "Gagan", "22-Jun-26"], ["18-Oct-21", "Asha", "01-Jan-26"], ["20-Aug-25", "Sumeet", "05-May-26"]];
      assert(detectConversationColumn(headersDate, rowsDate) === -1, "a blank-header DATE column must NOT be treated as conversation");

      // GOTCHA: Papa.parse maps a blank header to the key "" — which is FALSY.
      // The Google-Sheet route guard MUST be `convKey !== null`, never a truthiness
      // check, or the rescue silently no-ops on the exact case it's for. Lock it in.
      const papaRows = [
        { Date: "25-Sep-21", Name: "Meena", "": "On 25 Sep 2021 looking 4550 sqft in Trump Towers, will visit next week" },
        { Date: "16-Oct-21", Name: "Gagan", "": "On 16 Oct 2021 call on wait, on 17 Oct call him at 5pm not picked busy" },
        { Date: "18-Oct-21", Name: "Asha", "": "On 18 Oct 2021 site visit, discuss 4750 and villa, will come this week" },
      ];
      assert(detectConversationKeyFromRows(papaRows) === "", `Papa blank-header conversation key must be "" (falsy → route guard must be !== null), got ${JSON.stringify(detectConversationKeyFromRows(papaRows))}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3c. TEAM-STATUS isolation + reject-reason rework + property-type (2026-06-20)
  //     Gurgaon (India) and Dubai status masters are never merged; "Booked With
  //     Us" is gone from the reject dropdown (and never maps to the winning
  //     status); Property Type allows Residential/Commercial/Mixed Use only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "team-status isolation + reject-reasons + property-type",
    run: async () => {
      const { isStatusValidForTeam, NEEDS_REVIEW, statusesForTeam } = await import("../src/lib/lead-statuses");
      const { REJECT_REASONS, rejectionStatusFor, rejectReasonLabel } = await import("../src/lib/reject-reasons");
      const { inferPropertyType, isPropertyType, PROPERTY_TYPES } = await import("../src/lib/propertyType");

      // Team isolation — a Dubai status is invalid for India and vice-versa.
      assert(isStatusValidForTeam("Mail Sent", "Dubai") === true, "'Mail Sent' is a Dubai status");
      assert(isStatusValidForTeam("Mail Sent", "India") === false, "'Mail Sent' (Dubai) must be INVALID for India");
      assert(isStatusValidForTeam("Details Shared", "India") === true, "'Details Shared' is an India status");
      assert(isStatusValidForTeam("Details Shared", "Dubai") === false, "'Details Shared' (India) must be INVALID for Dubai");
      assert(isStatusValidForTeam("Follow Up", "India") && isStatusValidForTeam("Follow Up", "Dubai"), "shared status valid for both teams");
      assert(isStatusValidForTeam("Booked With Us", "India") === true, "terminal outcomes are team-agnostic (booked lead not re-flagged on team move)");
      assert(isStatusValidForTeam(NEEDS_REVIEW, "India") && isStatusValidForTeam(NEEDS_REVIEW, "Dubai"), "'Needs Review' is valid for any team");
      // The two masters must NOT bleed into each other.
      assert(!(statusesForTeam("India") as readonly string[]).includes("Mail Sent"), "India master must not contain Dubai-only 'Mail Sent'");
      assert(!(statusesForTeam("Dubai") as readonly string[]).includes("Details Shared"), "Dubai master must not contain India-only 'Details Shared'");

      // Reject reasons — "Booked With Us" removed from the dropdown; 2 new reasons in.
      const vals = REJECT_REASONS.map((r) => r.value);
      assert(!vals.includes("BOOKED_WITH_US"), "'Booked With Us' must NOT be an offered reject reason");
      assert(!REJECT_REASONS.some((r) => /booked with us/i.test(r.label)), "no offered reason may be labeled 'Booked With Us'");
      assert(vals.includes("PURCHASED_ELSEWHERE") && vals.includes("BOOKED_OTHER_CHANNEL"), "both closed-elsewhere reasons must be offered");
      // Reject reason → status must NEVER be the winning "Booked With Us".
      assert(rejectionStatusFor("PURCHASED_ELSEWHERE") === "Purchased Elsewhere", "PURCHASED_ELSEWHERE → 'Purchased Elsewhere'");
      assert(rejectionStatusFor("BOOKED_OTHER_CHANNEL") === "Booked Through Another Channel", "BOOKED_OTHER_CHANNEL → its own status");
      assert(rejectionStatusFor("BOOKED_WITH_US") !== "Booked With Us", "legacy reject must NOT resolve to the winning status (it inflated commission)");
      assert(rejectReasonLabel("BOOKED_WITH_US") === "Booked With Us", "legacy value still resolves a human label for historical records");
      assert(rejectionStatusFor("JUNK") === "Junk", "Junk Lead → canonical 'Junk' status");

      // Property Type — Mixed Use is allowed; Source values are not.
      assert(PROPERTY_TYPES.length === 3 && isPropertyType("Mixed Use"), "Mixed Use is an allowed property type");
      assert(!isPropertyType("Import") && !isPropertyType("Google"), "Source values must NOT be valid property types");
      assert(inferPropertyType({ projectCategory: "Mixed Use Development" }) === "Mixed Use", "category 'mixed' → Mixed Use");
      assert(inferPropertyType({ configuration: "Office Space" }) === "Commercial", "office → Commercial (unchanged)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3d. SITE-VISIT classification (2026-06-20) — sharing collateral (sample video,
  //     brochure, floor plan, price/payment plan, location map, inventory,
  //     presentation, details) must NEVER count as a Site Visit; only explicit
  //     physical-visit evidence does.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "site-visit — shared collateral is NOT a visit; explicit visits still count",
    run: async () => {
      const { classifyText } = await import("../src/lib/remarkParser");
      const notVisit = [
        "Shared sample video", "Shared project video", "Shared brochure", "Shared floor plan",
        "Shared price list", "Shared payment plan", "Shared location map", "Shared inventory",
        "Shared presentation", "Shared details on WhatsApp", "Shared project information",
        "saw sample video", "showed sample video",
      ];
      for (const p of notVisit) {
        const c = classifyText(p);
        assert(c !== "SITE_VISIT" && c !== "MEETING" && c !== "VIRTUAL_MEETING", `"${p}" must NOT be a visit/meeting (got ${c})`);
      }
      const isVisit = ["Site visit done", "Visited project", "Site visit completed", "Client visited site", "Physical visit conducted", "came for site visit", "saw sample flat"];
      for (const p of isVisit) assert(classifyText(p) === "SITE_VISIT", `"${p}" must classify as SITE_VISIT (got ${classifyText(p)})`);
      // A real visit AND a collateral mention in the same remark → still a visit.
      assert(classifyText("site visit done, shared brochure afterwards") === "SITE_VISIT", "explicit visit + collateral mention must still count");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e. TEAM-AWARE BUDGET DISPLAY (2026-06-20) — India/Gurgaon must render INR
  //     Lakh/Cr (never Millions/AED); Dubai renders AED K/M.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "budget-display — India ₹ Lakh/Cr (never M/AED); Dubai AED K/M",
    run: async () => {
      const { displayBudget } = await import("../src/lib/budgetParse");
      const noMillions = (s: string) => !/\d\s*m(?:n|illion)?\b/i.test(s) && !/aed/i.test(s);
      // India team — numeric formatted as ₹, even with a stale AED currency or an "M" raw.
      assert(displayBudget({ forwardedTeam: "India", budgetMin: 40_000_000, budgetCurrency: "AED" }) === "4 CR", `India 4Cr (stale AED) → "4 CR", got ${displayBudget({ forwardedTeam: "India", budgetMin: 40_000_000, budgetCurrency: "AED" })}`);
      assert(displayBudget({ forwardedTeam: "India", budgetRaw: "7M", budgetMin: 7_000_000, budgetCurrency: "INR" }) === "70 LAKH", `India raw "7M" → "70 LAKH", got ${displayBudget({ forwardedTeam: "India", budgetRaw: "7M", budgetMin: 7_000_000, budgetCurrency: "INR" })}`);
      assert(noMillions(displayBudget({ forwardedTeam: "Gurgaon", budgetMin: 5_000_000, budgetCurrency: "AED" })), "Gurgaon budget must never show M/AED");
      // Standard India format: no ₹, uppercase CR, no trailing dot, one space.
      assert(displayBudget({ budgetMin: 12_500_000, budgetCurrency: "INR" }) === "1.25 CR", `INR no-team → "1.25 CR", got ${displayBudget({ budgetMin: 12_500_000, budgetCurrency: "INR" })}`);
      assert(displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" }) === "3 CR", `30M INR → "3 CR", got ${displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" })}`);
      assert(!/₹/.test(displayBudget({ budgetMin: 50_000_000, budgetCurrency: "INR" })), "India budget must have NO ₹ symbol");
      // Dubai — verbatim raw preserved; numeric → AED K/M.
      assert(displayBudget({ forwardedTeam: "Dubai", budgetRaw: "AED 800K - 1M", budgetMin: 800_000 }) === "AED 800K - 1M", "Dubai verbatim raw preserved");
      assert(displayBudget({ forwardedTeam: "Dubai", budgetMin: 1_500_000, budgetCurrency: "AED" }) === "AED 1.5 M", `Dubai 1.5M → "AED 1.5 M", got ${displayBudget({ forwardedTeam: "Dubai", budgetMin: 1_500_000, budgetCurrency: "AED" })}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-bis. ADMIN AI ASSISTANT SAFETY (2026-06-21) — the NL parser refuses every
  //     destructive intent, and the planner ALWAYS forces deletedAt:null so
  //     recycle-bin leads can never be counted or mutated.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "assistant-safety — refuses destructive commands; planner always excludes deleted",
    run: async () => {
      const { parseCommand } = await import("../src/lib/adminAssistant/parse");
      const { buildWhere } = await import("../src/lib/adminAssistant/engine");
      for (const cmd of ["delete all leads", "remove all Dubai leads permanently", "edit the remarks for india leads", "change conversation history", "backdate created date of all leads", "empty the recycle bin"]) {
        assert(parseCommand(cmd).intent === "UNSUPPORTED", `assistant MUST refuse destructive command: "${cmd}"`);
      }
      assert(parseCommand("assign unassigned dubai leads to Aleena").intent === "ASSIGN", "safe ASSIGN must parse");
      assert(parseCommand("how many india leads with no follow-up").intent === "QUERY", "safe QUERY must parse");
      const { where } = await buildWhere({ team: "Dubai", unassigned: true });
      assert((where as { deletedAt?: unknown }).deletedAt === null, "planner where MUST force deletedAt:null (recycle-bin leads never in scope)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-ter. PROJECT MARKET SEGREGATION (2026-06-21) — India agents see only India
  //     projects, Dubai agents only UAE; admin/manager see all; cross-market
  //     attach is blocked server-side.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "market-segregation — agent sees only own market; cross-market blocked; admin sees all",
    run: async () => {
      const { userCanAccessProjectCountry, projectWhereForUser, teamToCountry } = await import("../src/lib/propertyScope");
      const indiaAgent = { role: "AGENT" as const, team: "India" };
      const dubaiAgent = { role: "AGENT" as const, team: "Dubai" };
      const admin = { role: "ADMIN" as const, team: "HQ" };
      assert(teamToCountry("India") === "India" && teamToCountry("Dubai") === "UAE", "team→country mapping (India→India, Dubai→UAE)");
      assert(userCanAccessProjectCountry(indiaAgent, "India") === true, "India agent → India project allowed");
      assert(userCanAccessProjectCountry(indiaAgent, "UAE") === false, "India agent → UAE project MUST be blocked");
      assert(userCanAccessProjectCountry(dubaiAgent, "India") === false, "Dubai agent → India project MUST be blocked");
      assert(userCanAccessProjectCountry(dubaiAgent, "UAE") === true, "Dubai agent → UAE project allowed");
      assert(userCanAccessProjectCountry(admin, "India") && userCanAccessProjectCountry(admin, "UAE"), "admin → all markets");
      assert(JSON.stringify(projectWhereForUser(indiaAgent)) === JSON.stringify({ country: "India" }), "India agent project where = {country:India}");
      assert(Object.keys(projectWhereForUser(admin)).length === 0, "admin project where = {} (all markets)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-quater. AGENT CANNOT CREATE LEADS (2026-06-21) — both create server-actions
  //     + the page gate AGENT (security regression fix).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "agent-no-create — create server-actions + page block AGENT (not just the button)",
    run: async () => {
      const fs = await import("node:fs");
      const action = fs.readFileSync("src/app/(app)/leads/new/actions.ts", "utf8");
      assert(/role === "AGENT"/.test(action), "quickCreateLeadAction MUST block AGENT (direct POST vector)");
      const page = fs.readFileSync("src/app/(app)/leads/new/page.tsx", "utf8");
      assert(/createLeadAction/.test(page) && /role === "AGENT"/.test(page), "createLeadAction MUST block AGENT");
      const exp = fs.readFileSync("src/app/api/leads/export/route.ts", "utf8");
      assert(/role === "AGENT"/.test(exp) && /403/.test(exp), "lead export route MUST block AGENT");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-quinque. REMARK INLINE-TIME IST (2026-06-21) — a written clock time in the
  //     comma/space form promotes to the IST event time, no shift; numbers that
  //     aren't times stay date-only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "remark-IST-inline — comma/space clock time → IST event time (no shift); budgets stay date-only",
    run: async () => {
      const { parseRemarksTimeline } = await import("../src/lib/remarkParser");
      const ev = parseRemarksTimeline("On 19 Jun 2026, 3:30 PM call not picked", [])[0];
      const hm = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(ev.date!);
      assert(hm === "15:30", `comma-form clock time must promote to 15:30 IST (no shift), got ${hm}`);
      assert(/call not picked/.test(ev.text) && !/3:30/.test(ev.text), "promoted time is stripped from the body text");
      const ev2 = parseRemarksTimeline("On 19 Jun 2026 discussed 3 BHK budget 2.5M", [])[0];
      assert(ev2.date!.getUTCHours() === 6 && ev2.date!.getUTCMinutes() === 30, "non-time numbers (3 BHK / 2.5M) must NOT become a clock time — stays date-only noon");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-sext. LEAD DEFAULT SORT TIERS (2026-06-21) — today's fresh on top, future
  //     / other sink to the bottom.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-sort-tier — 6-tier default order (today-fresh top; future/other bottom)",
    run: async () => {
      const { leadSortTier, isFreshStatus } = await import("../src/lib/lead-statuses");
      const today = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") };
      const D = (s: string) => new Date(s);
      assert(leadSortTier({ currentStatus: "Fresh Lead", createdAt: D("2026-06-21T05:00:00Z"), followupDate: D("2026-06-21T09:00:00Z") }, today) === 1, "fresh created-today = tier 1 (must beat today-followup)");
      assert(leadSortTier({ currentStatus: "Interested", createdAt: D("2026-06-10T05:00:00Z"), followupDate: D("2026-06-21T08:00:00Z") }, today) === 2, "today follow-up = tier 2");
      assert(leadSortTier({ currentStatus: "Fresh Lead", createdAt: D("2026-06-18T05:00:00Z"), followupDate: null }, today) === 3, "old fresh = tier 3");
      assert(leadSortTier({ currentStatus: "Negotiating", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-19T08:00:00Z") }, today) === 4, "overdue follow-up = tier 4");
      assert(leadSortTier({ currentStatus: "Interested", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-25T08:00:00Z") }, today) === 5, "future follow-up = tier 5 (must sink below actionable)");
      assert(leadSortTier({ currentStatus: "Call Back Later", createdAt: D("2026-06-01T05:00:00Z"), followupDate: null }, today) === 6, "worked, no follow-up = tier 6");
      assert(isFreshStatus(null) && isFreshStatus("Fresh Lead") && !isFreshStatus("Interested"), "isFreshStatus: null/Fresh true, worked false");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-sept. FOLLOW-UP AUTO-ROLLOVER (2026-06-21) — nightly cron is bearer-gated,
  //     excludes closed/rejected/deleted/no-followup, logs to field history,
  //     never touches remarks.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "followup-rollover — bearer-gated cron; excludes terminal/deleted/no-followup; logs to history, not remarks",
    run: async () => {
      const fs = await import("node:fs");
      const route = fs.readFileSync("src/app/api/cron/followup-rollover/route.ts", "utf8");
      assert(/CRON_SECRET/.test(route) && /Bearer/.test(route), "rollover cron MUST be bearer-gated");
      const lib = fs.readFileSync("src/lib/followupRollover.ts", "utf8");
      assert(/TERMINAL_STATUSES/.test(lib), "rollover MUST exclude terminal (closed+rejected) statuses");
      assert(/deletedAt: null/.test(lib), "rollover MUST exclude deleted/recycle-bin leads");
      assert(/followupDate: \{ not: null/.test(lib), "rollover MUST skip no-follow-up leads");
      assert(/source: "system-rollover"/.test(lib), "rollover MUST log each move to LeadFieldHistory");
      assert(!/rawRemarks/.test(lib) && !/\bremarks\b/.test(lib), "rollover MUST NOT touch remarks/conversation history");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-oct. MEETING / SITE-VISIT 1-HOUR REMINDER (2026-06-21) — agent + manager,
  //     distinct sounds, re-arm on reschedule.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "meeting-reminder-1h — agent+manager, distinct titles/sounds, reschedule re-arm",
    run: async () => {
      const fs = await import("node:fs");
      const cron = fs.readFileSync("src/app/api/cron/pre-meeting-reminder/route.ts", "utf8");
      assert(/reminderSentAt1h/.test(cron) && /57\.5/.test(cron), "1-hour reminder window + dedupe flag must exist");
      assert(/isSuperAdmin: true/.test(cron) && /manager/.test(cron), "manager (Lalit) must also be notified");
      assert(/Site Visit Reminder/.test(cron) && /Meeting Reminder/.test(cron), "distinct reminder titles drive distinct sounds");
      const meeting = fs.readFileSync("src/app/api/leads/[id]/meeting/route.ts", "utf8");
      assert(/reminderSentAt1h: null/.test(meeting), "reschedule must re-arm the 1-hour reminder");
      const sounds = fs.readFileSync("src/lib/notifSounds.ts", "utf8");
      assert(/playReminderSound/.test(sounds), "distinct reminder-sound helper must exist");
      const bell = fs.readFileSync("src/components/NotifBell.tsx", "utf8");
      assert(/playReminderSound/.test(bell) && /site visit reminder/i.test(bell), "NotifBell must play distinct sound for reminders");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3e-nov. NEED SNAPSHOT (2026-06-21) — the §8 one-liner under the lead name shows
  //     a CLEAN requirement, never the raw notesShort blob (comma garbage + dated
  //     call-log tail belong in Conversation History).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "need-snapshot — clean requirement under name, never the raw notesShort blob",
    run: async () => {
      const { cleanNeedSnapshot } = await import("../src/lib/needSnapshot");
      assert(cleanNeedSnapshot("Need details for trump tower 2,,,,,Tanuj: on 24 jan 2026 (10:21am) not picked") === "Need details for trump tower 2", "strips comma garbage + dated call-log tail");
      assert(cleanNeedSnapshot("Looking for a 3BHK in Gurgaon") === "Looking for a 3BHK in Gurgaon", "clean requirement passes through");
      assert(cleanNeedSnapshot("On 19 Jun 2026 (3:30 pm) called, no answer") === null, "pure conversation log → no headline");
      assert(cleanNeedSnapshot(null) === null && cleanNeedSnapshot("") === null, "empty → null");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3f. WEBSITE MESSAGE → CONVERSATION (2026-06-20) — a genuine form message
  //     becomes a dated (IST) conversation entry; the source/campaign name never
  //     does; an empty message creates nothing.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "website-remark — message → conversation (IST), source name excluded",
    run: async () => {
      const { websiteMessageRemark, isSourceEcho } = await import("../src/lib/websiteRemark");
      // Source / campaign / form / event labels are NOT remarks.
      for (const echo of ["Dubai Property Expo This Weekend", "DAMAC Expo", "Website Inquiry", "Facebook Lead Form", "Google Ads", "Inbound Call"]) {
        assert(isSourceEcho(echo) === true, `"${echo}" must be treated as a source label, not a remark`);
        assert(websiteMessageRemark(echo, new Date(0)) === null, `"${echo}" must NOT become a conversation entry`);
      }
      // The message matching the source/campaign is suppressed (no duplicate).
      assert(websiteMessageRemark("Danube Breez", new Date(0), { sourceDetail: "Danube Breez" }) === null, "message == sourceDetail → no entry");
      // Empty → nothing.
      assert(websiteMessageRemark("", new Date(0)) === null && websiteMessageRemark(null, new Date(0)) === null, "blank message → no entry");
      // A genuine message → a dated IST entry the timeline can parse.
      const when = new Date("2026-06-20T11:05:00Z"); // 16:35 IST
      const r = websiteMessageRemark("I am interested in a 3BHK property in Dubai.", when, { sourceDetail: "Danube Breez" });
      assert(!!r && /On 20 Jun 2026 \(4:35\s*PM\)/i.test(r) && /Website \/ Client Message:/.test(r) && /3BHK/.test(r), `genuine message → dated IST entry, got ${JSON.stringify(r)}`);
      const { parseRemarksTimeline } = await import("../src/lib/remarkParser");
      const ev = parseRemarksTimeline(r!, [])[0];
      const istHM = ev?.date ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(ev.date) : "∅";
      assert(istHM === "16:35", `timeline must date it 16:35 IST (lead-generated time), got ${istHM}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 4. REMARKS PRESERVATION  (project-crm-remarks-overhaul — immutable rawRemarks)
  //    Some leads carry rawRemarks, and the longest is large (proves no
  //    truncation of the imported conversation history).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "remarks-preservation — rawRemarks populated + longest is large (no truncation)",
    run: async () => {
      const withRaw = await prisma.lead.count({ where: { rawRemarks: { not: null } } });
      assert(withRaw > 0, "no leads have rawRemarks — remark preservation appears broken");

      const [{ maxlen }] = await prisma.$queryRaw<{ maxlen: number | null }[]>`
        SELECT MAX(LENGTH("rawRemarks"))::int AS maxlen FROM "Lead"`;
      assert(maxlen != null, "could not compute MAX(LENGTH(rawRemarks))");
      assert(
        (maxlen ?? 0) > 1000,
        `longest rawRemarks is only ${maxlen} chars — expected > 1000; conversation history may be getting truncated`,
      );
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. REPORTS SANITY
  //    Lead counts return numbers; a source groupBy via findMany + sourceBreakdown
  //    yields rows (the reporting path other dashboards depend on).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "reports-sanity — counts are numbers + source groupBy yields rows",
    run: async () => {
      const [total, live, dubai, india] = await Promise.all([
        prisma.lead.count(),
        prisma.lead.count({ where: { deletedAt: null } }),
        prisma.lead.count({ where: { deletedAt: null, forwardedTeam: "Dubai" } }),
        prisma.lead.count({ where: { deletedAt: null, forwardedTeam: "India" } }),
      ]);
      for (const [label, n] of [["total", total], ["live", live], ["dubai", dubai], ["india", india]] as const) {
        assert(typeof n === "number" && n >= 0, `report count "${label}" is not a non-negative number (got ${n})`);
      }
      assert(live <= total, `live (${live}) cannot exceed total (${total})`);

      const rows = await prisma.lead.findMany({
        where: { deletedAt: null },
        select: { source: true, sourceRaw: true },
      });
      const breakdown = sourceBreakdown(rows);
      assert(Array.isArray(breakdown) && breakdown.length > 0, "source groupBy (findMany + sourceBreakdown) yielded no rows");
      assert(breakdown.every((r) => typeof r.n === "number" && r.n > 0), "source breakdown contains a non-positive count");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. PERMISSIONS / SCOPING DATA CONTRACT  (leadScope.ts)
  //    A DB script can't do a static grep of the scope code, so we assert the
  //    DATA CONTRACT instead: there exist live leads with a non-null ownerId, so
  //    ownership scoping (AGENT → ownerId === me.id) has data to act on. Light by design.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "permissions-data — live leads with non-null ownerId exist (scoping has data to act on)",
    run: async () => {
      const owned = await prisma.lead.count({ where: { deletedAt: null, ownerId: { not: null } } });
      assert(owned > 0, "no live leads have a non-null ownerId — ownership scoping would be a no-op");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 7. BUDGET INTEGRITY  (no corrupted / auto-guessed budgets)
  //    (a) No LIVE lead has a digit-less budgetRaw — that's corrupted import data
  //        (an agent name like "Lalit Sir" leaked into the budget column), which
  //        displayBudget() now refuses to render. The DATA must stay clean too.
  //    (b) Budget is never silently guessed from remark prose: extractFromRemarks
  //        must emit NO budget (the guess produced wrong bands like "12M–45M").
  //        remarkAutofill has no "server-only" import, so we test the REAL code.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "budget-integrity — no digit-less budgetRaw on live leads + remark autofill emits no budget",
    run: async () => {
      const withRaw = await prisma.lead.findMany({
        where: { deletedAt: null, budgetRaw: { not: null } },
        select: { id: true, budgetRaw: true },
      });
      const junk = withRaw.filter((l) => !/\d/.test((l.budgetRaw ?? "").trim()));
      assert(junk.length === 0, `${junk.length} live lead(s) have a digit-less budgetRaw (corrupted, e.g. "Lalit Sir") — should be 0`);

      const { extractFromRemarks } = await import("../src/lib/remarkAutofill");
      const s = extractFromRemarks("budget is 3-4 cr, AED 2.5M, around 30 lakh — please call back tomorrow");
      assert(
        s.budgetMin == null && s.budgetMax == null && s.budgetCurrency == null,
        `remark autofill still emits a budget (${JSON.stringify({ min: s.budgetMin, max: s.budgetMax, ccy: s.budgetCurrency })}) — must stay blank (no guessing from prose)`,
      );
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 11. IMPORT BLANK-HEADER LEAK (2026-06-19 P0)
  //   A sheet column with a blank/symbol-only header normalises to "" and, under
  //   the old pick() prefix match, `candidate.startsWith("")` was always true — so
  //   that column's value (typically the Date) leaked into city/budget/remarks/…
  //   for every row. Two guards:
  //   (a) CODE: a blank header must never wildcard-match a CRM field.
  //   (b) DATA: no live lead may still carry the leak signature (a rawImport
  //       blank-header value sitting in city / budgetRaw / remarks).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "import-blank-header — blank header never maps to a field (code) + no live lead carries the leak (data)",
    run: async () => {
      const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
      // (a) CODE invariant — the fixed pick() must skip a "" header. Replicate the
      // exact guard: a blank-normalized header is skipped, so it can't win a field.
      const pick = (row: Record<string, string>, ...cands: string[]) => {
        const wanted = cands.map(norm).filter(Boolean);
        for (const k of Object.keys(row)) {
          const nk = norm(k);
          if (!nk) continue;
          for (const t of wanted) if (nk === t || nk.startsWith(t) || t.startsWith(nk)) { const v = row[k]?.trim(); if (v) return v; }
        }
      };
      const leakRow = { "": "19-Jun-26", "👤 Customer": "Real Name", "Remarks": "real remark" };
      assert(pick(leakRow, "city", "location") === undefined, `blank-header column leaked into city: got ${JSON.stringify(pick(leakRow, "city", "location"))}`);
      assert(pick(leakRow, "customer", "name") === "Real Name", `name lookup broke: got ${JSON.stringify(pick(leakRow, "customer", "name"))}`);
      assert(pick(leakRow, "remarks", "remark") === "real remark", `remarks lookup broke: got ${JSON.stringify(pick(leakRow, "remarks", "remark"))}`);

      // (b) DATA invariant — no live lead still has a blank-header value sitting in
      // city / budgetRaw / remarks (the corruption signature).
      const imported = await prisma.lead.findMany({
        where: { deletedAt: null, rawImport: { not: { equals: null } as never } },
        select: { id: true, name: true, rawImport: true, city: true, budgetRaw: true, remarks: true },
      });
      const leaked = imported.filter((l) => {
        const ri = l.rawImport as Record<string, unknown> | null;
        if (!ri) return false;
        const blanks = Object.keys(ri).filter((k) => norm(k) === "").map((k) => String(ri[k]).trim());
        if (blanks.length === 0) return false;
        const set = new Set(blanks);
        return [l.city, l.budgetRaw, l.remarks].some((v) => v != null && set.has(String(v).trim()));
      });
      assert(leaked.length === 0, `${leaked.length} live lead(s) still carry the blank-header leak (e.g. ${leaked.slice(0, 3).map((l) => l.name).join(", ")}) — re-run scripts/repair-import-leak.ts`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 12. REMARK TIMELINE = IST (2026-06-19)
  //   Imported remark times are IST wall-clock. The parser must (a) keep a timed
  //   remark at its IST instant, (b) accept "." as a time separator ("5.30 pm"),
  //   and (c) store a DATE-ONLY remark at the noon-IST sentinel (06:30 UTC) so the
  //   UI renders the date alone instead of a spurious "6:30 am".
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "remark-timeline-IST — timed remark keeps IST instant · dotted time parses · date-only uses noon sentinel",
    run: async () => {
      const { parseRemarksTimeline } = await import("../src/lib/remarkParser");
      const istHM = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(d);

      const timed = parseRemarksTimeline("On 19 Jun 2026 (9:15 PM) client will visit", [])[0];
      assert(!!timed?.date && istHM(timed.date) === "21:15", `"(9:15 PM)" should render 21:15 IST, got ${timed?.date ? istHM(timed.date) : "∅"}`);

      const dotted = parseRemarksTimeline("On 5 Jan 2025 (5.30 pm) site visit done", [])[0];
      assert(!!dotted?.date && istHM(dotted.date) === "17:30", `"(5.30 pm)" should render 17:30 IST, got ${dotted?.date ? istHM(dotted.date) : "∅"}`);

      const dateOnly = parseRemarksTimeline("On 17 Jun 2026 client called, interested in 3BHK", [])[0];
      assert(!!dateOnly?.date, "date-only remark must still produce a date");
      assert(
        dateOnly!.date!.getUTCHours() === 6 && dateOnly!.date!.getUTCMinutes() === 30,
        `date-only remark must use the noon-IST sentinel (06:30 UTC) so no spurious clock time shows — got ${dateOnly!.date!.toISOString()}`,
      );

      // Hyphenated MIS dates ("19-Jun-26") must PARSE — not become undated and fold
      // into the previous timeline card. Two dated remarks = two independent events.
      const hy = parseRemarksTimeline("Javed: On 17-May-26 shared district. Lalit: On 19-Jun-26 call not pick", ["Lalit Sharma", "Javed"]);
      assert(hy.length === 2, `two hyphenated-date remarks must be 2 entries, got ${hy.length}`);
      assert(!!hy[0]?.date && !!hy[1]?.date, "both hyphenated-date remarks must be DATED (not undated → fold-in)");
      assert(!!hy[0]?.date && !!hy[1]?.date && hy[0].date!.getTime() !== hy[1].date!.getTime(), "the two entries must keep DIFFERENT dates (no fold-in into the older card)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 13. LOCATION ENRICHMENT (2026-06-19) — curated City→Country map covers our
  //   markets + canonicalizes country names to one CRM form (no UAE vs "United
  //   Arab Emirates" split). Nominatim is a live, supervised fallback only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "location-enrich — curated City→Country (Istanbul/Dubai/Gurgaon) + country canonicalization",
    run: async () => {
      const { inferCountryFromCity, inferCountryFromCityFuzzy, inferStateFromCity, canonicalCountry } = await import("../src/lib/cityCountry");
      assert(inferStateFromCity("Gurgaon") === "Haryana" && inferStateFromCity("Gurugram") === "Haryana", `Gurgaon/Gurugram → Haryana (state)`);
      assert(inferStateFromCity("Dubai") === "Dubai" && inferStateFromCity("Mumbai") === "Maharashtra" && inferStateFromCity("Istanbul") === "Istanbul", `Dubai/Mumbai/Istanbul state mapping`);
      assert(inferCountryFromCity("Istanbul") === "Turkey", `Istanbul should map to Turkey, got ${inferCountryFromCity("Istanbul")}`);
      assert(inferCountryFromCity("Dubai") === "UAE", `Dubai should map to UAE, got ${inferCountryFromCity("Dubai")}`);
      assert(inferCountryFromCity("Gurgaon") === "India", `Gurgaon should map to India, got ${inferCountryFromCity("Gurgaon")}`);
      assert(inferCountryFromCityFuzzy("Sheikh Zayed Road") === "UAE", `messy UAE city should fuzzy-map to UAE`);
      assert(inferCountryFromCity("London") === "United Kingdom", `London should map to "United Kingdom" (canonical), got ${inferCountryFromCity("London")}`);
      assert(canonicalCountry("United Arab Emirates") === "UAE", `"United Arab Emirates" must canonicalize to UAE`);
      assert(canonicalCountry("UK") === "United Kingdom" && canonicalCountry("United Kingdom") === "United Kingdom", `UK variants must canonicalize to "United Kingdom"`);
    },
  },
];

// ── runner ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("REGRESSION HARNESS — read-only invariants vs. prod DB");
  console.log("=".repeat(72));

  for (const c of checks) {
    try {
      await c.run();
      console.log(`✓ ${c.name}`);
      results.push({ name: c.name, ok: true, detail: "" });
      passed++;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${c.name}`);
      console.log(`    → ${detail}`);
      results.push({ name: c.name, ok: false, detail });
      failed++;
    }
  }

  console.log("=".repeat(72));
  console.log(`REGRESSION: ${passed} passed, ${failed} failed`);

  await prisma.$disconnect();
  // Non-zero exit on ANY failure so scripts/deploy.sh aborts the deploy.
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async (err) => {
  // A throw OUTSIDE a check (e.g. DB unreachable) is itself a gate failure.
  console.error("✗ REGRESSION HARNESS CRASHED:", err);
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
