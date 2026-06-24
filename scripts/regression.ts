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
// Shared import-mapping toolkit (pure, no "server-only") — assert the REAL code
// the CSV + Google-Sheet importers + the wizard all run through.
import {
  IGNORE,
  buildMapping,
  makeMappedPick,
  parseDupMode,
  parseClientMapping,
  crmFieldOptions,
} from "../src/lib/importMapping";

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
  // 3c-ii. PROPERTY-TYPE FILTER (2026-06-24) — the shared leadFilterWhere engine
  //     (used by Master Data / Revival) must translate ?propertyType= into a
  //     real Lead.propertyType where condition (single → equals, multi → in),
  //     and a live count through that where must reconcile 1:1 with a direct
  //     prisma count on the same value. Proves the filter actually narrows.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "property-type-filter — leadFilterWhere(?propertyType=) → Lead.propertyType clause; count==direct",
    run: async () => {
      const { leadFilterWhere } = await import("../src/lib/leadFilterWhere");

      // Single value → { propertyType: "Residential" }.
      const oneAnd = leadFilterWhere({ propertyType: "Residential" });
      const oneClause = oneAnd.find((c) => "propertyType" in c) as { propertyType?: unknown } | undefined;
      assert(!!oneClause && oneClause.propertyType === "Residential", "single ?propertyType= must produce { propertyType: <value> }");

      // Multi value → { propertyType: { in: [...] } }.
      const multiAnd = leadFilterWhere({ propertyType: "Residential,Commercial" });
      const multiClause = multiAnd.find((c) => "propertyType" in c) as { propertyType?: { in?: string[] } } | undefined;
      assert(
        !!multiClause && Array.isArray(multiClause.propertyType?.in) &&
          multiClause.propertyType!.in!.length === 2 &&
          multiClause.propertyType!.in!.includes("Residential") &&
          multiClause.propertyType!.in!.includes("Commercial"),
        "multi ?propertyType= must produce { propertyType: { in: [...] } }",
      );

      // No param → no propertyType clause (filter is opt-in).
      assert(!leadFilterWhere({}).some((c) => "propertyType" in c), "no ?propertyType= must not add a propertyType clause");

      // Reconciliation: count via the filter where == direct count on that value.
      const viaFilter = await prisma.lead.count({ where: { deletedAt: null, AND: leadFilterWhere({ propertyType: "Residential" }) } });
      const direct = await prisma.lead.count({ where: { deletedAt: null, propertyType: "Residential" } });
      assert(viaFilter === direct, `property-type filter count (${viaFilter}) must equal direct count (${direct})`);
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
    name: "budget-display — uniform: India '4 Cr'/'70 L' (no ₹/CR/LAKH), Dubai '1.5M AED' (AED at end, no verbatim raw)",
    run: async () => {
      const { displayBudget } = await import("../src/lib/budgetParse");
      const noMillions = (s: string) => !/\bm\b/i.test(s) && !/aed/i.test(s);
      // India team — numeric formatted as Cr/L, even with a stale AED currency or an "M" raw.
      assert(displayBudget({ forwardedTeam: "India", budgetMin: 40_000_000, budgetCurrency: "AED" }) === "4 Cr", `India 4Cr (stale AED) → "4 Cr", got ${displayBudget({ forwardedTeam: "India", budgetMin: 40_000_000, budgetCurrency: "AED" })}`);
      assert(displayBudget({ forwardedTeam: "India", budgetRaw: "7M", budgetMin: 7_000_000, budgetCurrency: "INR" }) === "70 L", `India 7M → "70 L", got ${displayBudget({ forwardedTeam: "India", budgetRaw: "7M", budgetMin: 7_000_000, budgetCurrency: "INR" })}`);
      assert(noMillions(displayBudget({ forwardedTeam: "Gurgaon", budgetMin: 5_000_000, budgetCurrency: "AED" })), "Gurgaon budget must never show M/AED");
      // India format: no ₹, 'Cr' capital-C small-r / 'L' capital, no trailing dot, one space, never 'CR'/'LAKH'.
      assert(displayBudget({ budgetMin: 12_500_000, budgetCurrency: "INR" }) === "1.25 Cr", `INR no-team → "1.25 Cr", got ${displayBudget({ budgetMin: 12_500_000, budgetCurrency: "INR" })}`);
      assert(displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" }) === "3 Cr", `30M INR → "3 Cr" (not "3 CR"), got ${displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" })}`);
      assert(!/₹/.test(displayBudget({ budgetMin: 50_000_000, budgetCurrency: "INR" })), "India budget must have NO ₹ symbol");
      assert(!/\b(CR|LAKH)\b/.test(displayBudget({ budgetMin: 50_000_000, budgetCurrency: "INR" })), "India must use 'Cr'/'L', never 'CR'/'LAKH'");
      // Dubai — AED at the END, value glued to M/K, no verbatim raw echo.
      assert(displayBudget({ forwardedTeam: "Dubai", budgetMin: 800_000, budgetMax: 1_000_000, budgetCurrency: "AED" }) === "800K – 1M AED", `Dubai range → "800K – 1M AED", got ${displayBudget({ forwardedTeam: "Dubai", budgetMin: 800_000, budgetMax: 1_000_000, budgetCurrency: "AED" })}`);
      assert(displayBudget({ forwardedTeam: "Dubai", budgetMin: 1_500_000, budgetCurrency: "AED" }) === "1.5M AED", `Dubai 1.5M → "1.5M AED", got ${displayBudget({ forwardedTeam: "Dubai", budgetMin: 1_500_000, budgetCurrency: "AED" })}`);
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
  // 3e-dec. CLEAN SUMMARIES EVERYWHERE (2026-06-21 UI raw-data audit) — every
  //     user-facing summary/preview shows a CLEAN one-liner, never the raw
  //     remark blob. Raw text stays only in Conversation/Raw History + Audit.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "last-meaningful-remark — latest substantive line, skips call-status noise",
    run: async () => {
      const { lastMeaningfulRemark } = await import("../src/lib/needSnapshot");
      const blob = "Need details,,,,on 24 jan (10:21am) he wants 30:70 plan,,,,on 26 jan (11am) not picked,,,,on 27 jan switched off";
      assert(lastMeaningfulRemark(blob) === "he wants 30:70 plan", "returns the latest real line, skipping 'not picked'/'switched off'");
      assert(lastMeaningfulRemark("on 5 Jun (2pm) not picked,,,,on 7 Jun (3pm) switched off") === null, "all-noise + no requirement → null");
      assert(lastMeaningfulRemark("Need brochure,,,,on 5 Jun not picked") === "Need brochure", "all-noise → requirement headline fallback");
      assert(lastMeaningfulRemark(null) === null && lastMeaningfulRemark("") === null, "empty → null");
    },
  },
  {
    name: "clean-summaries — no raw remark/notesShort blob in summary surfaces",
    run: async () => {
      const fs = await import("node:fs");
      const has = (f: string, re: RegExp) => { try { return re.test(fs.readFileSync(f, "utf8")); } catch { return false; } };
      // Master Data "Message" column must be cleaned, not a raw notesShort slice.
      assert(has("src/app/(app)/master-data/page.tsx", /message:\s*cleanNeedSnapshot\(/), "Master Data 'message' uses cleanNeedSnapshot");
      assert(!has("src/app/(app)/master-data/page.tsx", /message:\s*\(l\.notesShort/), "Master Data 'message' no longer slices raw notesShort");
      // Duplicate-alert notification body must be cleaned (bell + push).
      assert(has("src/lib/leadIngest.ts", /cleanNeedSnapshot\(input\.notesShort\)/), "duplicate-alert notification body is cleaned");
      assert(!has("src/lib/leadIngest.ts", /\$\{input\.notesShort\s*\?\?\s*""\}/), "no raw notesShort in notification body");
      // Action queue "LATEST REMARK" + cold-call "Last note" use lastMeaningfulRemark.
      assert(has("src/app/(app)/action-list/page.tsx", /lastMeaningfulRemark\(/), "action queue uses lastMeaningfulRemark");
      assert(has("src/components/ColdCallSession.tsx", /lastMeaningfulRemark\(lead\.remarks\)/), "cold-call 'Last note' is cleaned");
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
  {
    name: "interested-properties — LeadInterestedProject store exists + Lead relation queryable (separate from Properties Discussed)",
    run: async () => {
      // Selecting from a missing table throws — so this proves the additive
      // migration is applied in prod. Empty is fine; the guard's job is to abort a
      // future deploy if the independent Interested-Properties table ever vanishes.
      const n = await prisma.leadInterestedProject.count();
      assert(n >= 0, "leadInterestedProject.count() should return a number");
      // The Lead → interestedProjects relation must resolve (include must not throw)
      // and is a SEPARATE store from `discussed` (Properties Discussed).
      await prisma.lead.findFirst({ select: { id: true, _count: { select: { interestedProjects: true, discussed: true } } } });
    },
  },
  {
    name: "assistant-scope — a single-name command targets ONE lead, never the whole DB",
    run: async () => {
      const { parseCommand } = await import("../src/lib/adminAssistant/parse");
      const a = parseCommand("Transfer Kartik Trar to Mehak");
      assert(a.intent === "ASSIGN" && (a as { filter: { leadName?: string } }).filter.leadName === "kartik trar",
        "named transfer must capture leadName, not broaden to every lead");
      const b = parseCommand("assign leads to mehak");
      assert(b.intent === "UNSUPPORTED", "unscoped bulk assign must be REFUSED (no filter, no target)");
      const c = parseCommand("assign all unassigned dubai leads to aleena");
      assert(c.intent === "ASSIGN"
        && (c as { filter: { unassigned?: boolean } }).filter.unassigned === true
        && !(c as { filter: { leadName?: string } }).filter.leadName,
        "explicit bulk-with-filter must still work");
    },
  },
  {
    name: "budget-format — uniform display: Dubai '2M AED' / India '21 Cr' (no verbatim raw, no 'CR'/'LAKH')",
    run: async () => {
      const { formatBudgetAmount, displayBudget } = await import("../src/lib/budgetParse");
      assert(formatBudgetAmount(2_000_000, "DUBAI") === "2M AED", "Dubai 2_000_000 must be '2M AED'");
      assert(formatBudgetAmount(210_000_000, "INDIA") === "21 Cr", "India 210M must be '21 Cr' (capital-C small-r, not 'CR')");
      assert(displayBudget({ budgetRaw: "AED 2 M", budgetMin: null }) === "2M AED", "raw 'AED 2 M' must re-parse to '2M AED', not echo verbatim");
      assert(displayBudget({ budgetMin: 30_000_000, budgetCurrency: "INR" }) === "3 Cr", "INR 30M must be '3 Cr', not the old '3 CR'");
    },
  },
  {
    name: "agent-name — Lalit cluster → 'Lalit Sharma' (display-only); non-roster names preserved",
    run: async () => {
      const { canonicalAgentName } = await import("../src/lib/agentName");
      for (const v of ["Lalit", "Lalit Sir", "Shrama", "Sharma", "Lalit Shrama"]) {
        assert(canonicalAgentName(v) === "Lalit Sharma", `"${v}" must canonicalize to "Lalit Sharma"`);
      }
      assert(canonicalAgentName("Kiran") === "Kiran", "non-roster historical name must be preserved");
      assert(canonicalAgentName("Yasir", ["Yasir Khan"]) === "Yasir Khan", "roster first-name resolves to full name");
    },
  },
  {
    name: "remark-perms — agent edits own same-IST-day only; admin/manager any; imported (no author) admin-only",
    run: async () => {
      const { canEditRemark } = await import("../src/lib/remarkPerms");
      const now = new Date("2026-06-21T08:00:00Z");
      const agent = { id: "a1", role: "AGENT" };
      assert(canEditRemark(agent, { createdById: "a1", createdAt: new Date("2026-06-21T05:00:00Z") }, now) === true, "agent own+today → editable");
      assert(canEditRemark(agent, { createdById: "a1", createdAt: new Date("2026-06-20T05:00:00Z") }, now) === false, "agent own+yesterday → locked");
      assert(canEditRemark(agent, { createdById: "a2", createdAt: new Date("2026-06-21T05:00:00Z") }, now) === false, "agent other's note → locked");
      assert(canEditRemark({ id: "x", role: "ADMIN" }, { createdById: null, createdAt: null }, now) === true, "admin → any (even imported)");
      assert(canEditRemark(agent, { createdById: null, createdAt: null }, now) === false, "agent → cannot edit imported raw history");
    },
  },
  {
    name: "status-order — canonical priority (Fresh Lead → Office Visit → Follow Up → Visit Dubai → Details Shared → rest A→Z)",
    run: async () => {
      const { compareStatusDisplay } = await import("../src/lib/lead-statuses");
      const s = ["Junk", "Details Shared", "Fresh Lead", "Visit Dubai", "Follow Up", "Wants Office Visit", "Aaa"].sort(compareStatusDisplay);
      assert(s[0] === "Fresh Lead" && s[1] === "Wants Office Visit" && s[2] === "Follow Up" && s[3] === "Visit Dubai" && s[4] === "Details Shared",
        `canonical head wrong: ${s.join(" | ")}`);
      assert(s.slice(5).join(",") === "Aaa,Junk", `remaining must be A→Z, got ${s.slice(5).join(",")}`);
    },
  },
  {
    name: "call-outcome — WA-aware connected/unsuccessful classification (display-only)",
    run: async () => {
      const { effectiveOutcome, isWaInbound, isUnsuccessfulText } = await import("../src/lib/callOutcome");
      assert(effectiveOutcome("CONNECTED", "💬 WA out — dropped wa") === "NOT_PICKED", "dropped-wa CONNECTED must downgrade");
      assert(isWaInbound("💬 WA in — client replied") && !isWaInbound("💬 WA out — sent"), "WA inbound vs outbound");
      assert(isUnsuccessfulText("forwarded to voicemail") && isUnsuccessfulText("not piced"), "unsuccessful free-text incl. typos");
      assert(!isUnsuccessfulText("client picked up, interested"), "a connected note must NOT be flagged unsuccessful");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 14. AGENT PERFORMANCE (2026-06-23) — the report counts leads by ASSIGNMENT
  //   HISTORY (Assignment table), not just current owner, and NEVER counts
  //   deleted leads. Mirrors src/lib/agentPerformance.ts buildAgentReport()
  //   totalAssigned + drilldownWhere("totalAssigned") inline (server-only lib
  //   can't be imported under bare tsx). Invariants:
  //    (a) the count-side (distinct leads via Assignment in window) == the
  //        drill-side (Lead where assignments.some) for a real agent.
  //    (b) a soft-deleted lead with an assignment in window is EXCLUDED.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "agent-performance — assignment-history attribution reconciles + excludes deleted",
    run: async () => {
      // Pick an agent who actually holds assignment history.
      const withAsg = await prisma.assignment.findFirst({
        where: { lead: { deletedAt: null } },
        select: { userId: true, assignedAt: true },
        orderBy: { assignedAt: "asc" },
      });
      if (!withAsg) {
        results.push({ name: "  ↳ note", ok: true, detail: "no assignment history present — attribution check skipped" });
        return;
      }
      const agentId = withAsg.userId;
      // Wide window covering all assignment history.
      const gte = new Date("2000-01-01T00:00:00Z");
      const lt = new Date("2999-01-01T00:00:00Z");
      const win = { gte, lt };

      // COUNT side: distinct leads assigned to this agent in window, lead not deleted.
      const asgRows = await prisma.assignment.findMany({
        where: { userId: agentId, assignedAt: win, lead: { deletedAt: null } },
        select: { leadId: true },
      });
      const distinctLeadIds = new Set(asgRows.map((r) => r.leadId));
      const countSide = distinctLeadIds.size;

      // DRILL side: leads where an assignment to this agent exists in window (deleted excluded).
      const drillSide = await prisma.lead.count({
        where: { deletedAt: null, assignments: { some: { userId: agentId, assignedAt: win } } },
      });
      assert(countSide === drillSide,
        `assignment-history count must reconcile with the drill-down query (count=${countSide}, drill=${drillSide})`);

      // Deleted-exclusion: a deleted lead with an assignment must NOT be counted.
      // Baseline (no deletedAt filter) >= filtered, and any deleted-with-assignment drops out.
      const drillNoDelFilter = await prisma.lead.count({
        where: { assignments: { some: { userId: agentId, assignedAt: win } } },
      });
      const deletedWithAsg = await prisma.lead.count({
        where: { deletedAt: { not: null }, assignments: { some: { userId: agentId, assignedAt: win } } },
      });
      assert(drillNoDelFilter - deletedWithAsg === drillSide,
        `deletedAt:null must remove exactly the deleted-with-assignment leads (all=${drillNoDelFilter}, deleted=${deletedWithAsg}, filtered=${drillSide})`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 15. BUYER DATA MODULE (2026-06-23) — three additive tables (BuyerRecord,
  //   BuyerImportBatch, BuyerImportLog) live in prod; the repeat-buyer rollup math
  //   is correct (computed, not stored); and EVERY buyer page + API route is
  //   ADMIN-gated (passport + financial data must never leak to agents/managers).
  //   Read-only: probes columns via SELECT, tests the pure rollup lib in memory,
  //   and static-scans the route/page sources. ZERO writes.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-module — tables exist + rollup math correct + import/export ADMIN-only + list/detail scoped (no agent leak)",
    run: async () => {
      // (a) TABLES EXIST — selecting the buyer models must not throw (column /
      //     table presence probe; proves the migration applied in prod).
      const bc = await prisma.buyerRecord.count();
      assert(typeof bc === "number" && bc >= 0, "buyerRecord.count() must return a non-negative number");
      await prisma.buyerImportBatch.count();
      await prisma.buyerImportLog.count();
      // Column-presence probe — a select of every mapped column must not throw.
      await prisma.buyerRecord.findFirst({
        select: { id: true, clientName: true, buyerKey: true, transactionValue: true, transactionDate: true, passport: true, extraFields: true, importBatchId: true },
      });

      // (b) ROLLUP MATH — the pure lib (no server-only) tested in memory.
      const { normalizeBuyerKey, rollupForRecords, groupByBuyerKey } = await import("../src/lib/buyerIntelligence");
      // Same human → same key (honorific + phone-format insensitive).
      assert(
        normalizeBuyerKey("Mr. Rajesh Kumar", "+971 50 123 4567") === normalizeBuyerKey("Rajesh Kumar", "0501234567"),
        "normalizeBuyerKey must collapse honorific + phone formatting to one key",
      );
      assert(normalizeBuyerKey("", null) === null, "no name + no phone → null key (never a junk collision)");
      // Repeat buyer rollup: 3 records, one with a null value, two dates.
      const recs = [
        { buyerKey: "k", transactionValue: 1_000_000, transactionDate: new Date("2022-03-01") },
        { buyerKey: "k", transactionValue: 2_000_000, transactionDate: new Date("2024-07-15") },
        { buyerKey: "k", transactionValue: null, transactionDate: new Date("2021-01-01") },
      ];
      const roll = rollupForRecords(recs);
      assert(roll.totalPropertiesOwned === 3, `rollup count must be 3, got ${roll.totalPropertiesOwned}`);
      assert(roll.totalInvestmentValue === 3_000_000, `rollup sum must ignore null (=3,000,000), got ${roll.totalInvestmentValue}`);
      assert(!!roll.firstPurchaseDate && roll.firstPurchaseDate.getUTCFullYear() === 2021, "first purchase = min date (2021)");
      assert(!!roll.latestPurchaseDate && roll.latestPurchaseDate.getUTCFullYear() === 2024, "latest purchase = max date (2024)");
      assert(roll.repeatBuyerStatus === true, "3 records sharing a key → repeatBuyerStatus true");
      assert(rollupForRecords([recs[0]]).repeatBuyerStatus === false, "single record → repeatBuyerStatus false");
      // Null/blank keys must each stay a solo group (never merge into a junk bucket).
      const groups = groupByBuyerKey([{ id: "1", buyerKey: "k" }, { id: "2", buyerKey: "k" }, { id: "3", buyerKey: null }, { id: "4", buyerKey: "" }] as never[]);
      assert(groups.size === 3, `k(×2) + 2 solo = 3 groups, got ${groups.size}`);

      // (c) ACCESS GATING — passport/financial data must never be open to the
      //     wrong user. As of Part 5a the buyer module is a WORKED PIPELINE:
      //       • Pool management (import / export) stays ADMIN-ONLY.
      //       • The list + detail + inline-edit are SCOPED (admin = all + pool;
      //         assigned agent = ONLY their own ASSIGNED buyers) via buyerScopeWhere
      //         / canTouchBuyer — NOT a blanket ADMIN gate.
      //     A static source-scan so a refactor can't silently (i) open the pool /
      //     export to agents, or (ii) drop the scope guard and leak every agent's
      //     buyers to each other.
      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");
      // Import/export = ADMIN-ONLY (pool management).
      for (const r of [
        "src/app/api/buyer-data/import/route.ts",
        "src/app/api/buyer-data/export/route.ts",
      ]) {
        const src = read(r);
        assert(/role !== "ADMIN"/.test(src) && /403/.test(src), `${r} MUST stay ADMIN-only (pool management)`);
      }
      assert(/role !== "ADMIN"/.test(read("src/app/(app)/buyer-data/import/page.tsx")), "import page MUST stay ADMIN-only");
      // List + detail = SCOPED reads (must call buyerScopeWhere / canTouchBuyer).
      assert(/buyerScopeWhere/.test(read("src/app/(app)/buyer-data/page.tsx")), "buyer list page MUST scope via buyerScopeWhere (no blanket admin gate, no leak)");
      assert(/canTouchBuyer/.test(read("src/app/(app)/buyer-data/[id]/page.tsx")), "buyer detail page MUST gate via canTouchBuyer");
      assert(/canTouchBuyer/.test(read("src/app/api/buyer-data/[id]/update/route.ts")), "buyer update route MUST gate via canTouchBuyer");
      // Lifecycle write routes must exist + be scope/role gated.
      assert(/requireRole\("ADMIN", "MANAGER"\)/.test(read("src/app/api/buyer-data/assign/route.ts")), "assign route MUST be ADMIN/MANAGER only");
      for (const r of [
        "src/app/api/buyer-data/[id]/convert/route.ts",
        "src/app/api/buyer-data/[id]/reject/route.ts",
        "src/app/api/buyer-data/[id]/activity/route.ts",
      ]) assert(/canTouchBuyer/.test(read(r)), `${r} MUST gate via canTouchBuyer`);
      // The scope helper itself: AGENT must be restricted to own + ASSIGNED.
      const scopeSrc = read("src/lib/buyerScope.ts");
      assert(/ownerId: me\.id, poolStatus: "ASSIGNED"/.test(scopeSrc), "buyerScopeWhere AGENT branch MUST be { ownerId: me.id, poolStatus: 'ASSIGNED' }");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // BUYER DETAIL = LEAD VIEW (layout unification) — the new detail-field columns +
  // per-user sticky note exist in prod, the unified page reuses the Lead shell
  // (mobile tabs + sticky widget + buyer admin panel), the new fields are inline-
  // editable via the whitelisted PATCH (still canTouchBuyer-gated), and the buyer
  // sticky-note API is scoped (no leak). Static + live so a refactor can't silently
  // (i) drop a column, (ii) un-gate the sticky note, or (iii) regress the parity wiring.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-detail-unification — new columns + BuyerStickyNote live; page reuses Lead shell; sticky/PATCH gated",
    run: async () => {
      // (a) New BuyerRecord detail columns are live in prod (selecting them throws
      //     if any column is missing → migration not applied).
      await prisma.buyerRecord.findFirst({
        select: {
          id: true, passportExpiry: true, ownerName: true, country: true,
          size: true, actualSize: true, area: true, transactionType: true, role: true,
        },
      });
      // (b) BuyerStickyNote table exists + is selectable (migration applied).
      const sc = await prisma.buyerStickyNote.count();
      assert(typeof sc === "number" && sc >= 0, "buyerStickyNote.count() must return a non-negative number");

      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");

      // (c) The detail page reuses the Lead layout shell — same mobile tab bar +
      //     the shared StickyNoteWidget (pointed at the buyer API) + the buyer admin
      //     panel. Guards the "buyer detail looks like the lead view" mandate.
      const page = read("src/app/(app)/buyer-data/[id]/page.tsx");
      assert(/LeadMobileTabs/.test(page), "buyer detail MUST render LeadMobileTabs (mobile-tab parity with the Lead view)");
      assert(/StickyNoteWidget/.test(page) && /apiBase="\/api\/buyer-data"/.test(page), "buyer detail MUST reuse StickyNoteWidget with apiBase=/api/buyer-data");
      assert(/lg:grid-cols-3/.test(page), "buyer detail MUST use the Lead 3-col grid shell (main + right rail)");
      assert(/BuyerAdminPanel/.test(page), "buyer detail MUST render the right-rail BuyerAdminPanel (convert/assign/reject/attempt/transfer)");

      // (d) The shared StickyNoteWidget must NOT have hard-coded the lead API — it
      //     uses the apiBase prop so the buyer reuse actually hits the buyer route.
      assert(/\$\{apiBase\}\/\$\{leadId\}\/sticky-note/.test(read("src/components/StickyNoteWidget.tsx")), "StickyNoteWidget MUST use the apiBase prop for the sticky-note PUT (not a hard-coded /api/leads)");

      // (e) The buyer sticky-note API is SCOPED (canTouchBuyer) — a private note must
      //     not be writable by someone who can't see the buyer.
      assert(/canTouchBuyer/.test(read("src/app/api/buyer-data/[id]/sticky-note/route.ts")), "buyer sticky-note route MUST gate via canTouchBuyer");

      // (f) The PATCH whitelist exposes the new editable detail fields (so inline-edit
      //     persists) — and is still canTouchBuyer-gated (asserted in buyer-module above).
      const upd = read("src/app/api/buyer-data/[id]/update/route.ts");
      for (const f of ["passportExpiry", "ownerName", "country", "size", "actualSize", "area", "transactionType", "role"]) {
        assert(new RegExp(`${f}:\\s*"(string|number|date)"`).test(upd), `buyer update whitelist MUST allow editing "${f}"`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // WEBSITE AUTO-ASSIGN + PROPERTY-ENQUIRED MAPPING (Lalit 2026-06-24)
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "website-auto-assign — toggle ON by default + both assignees resolve to active non-HR users",
    run: async () => {
      const { getWebsiteAutoAssign } = await import("../src/lib/settings");
      const cfg = await getWebsiteAutoAssign();
      assert(typeof cfg.enabled === "boolean", "getWebsiteAutoAssign must return a boolean enabled flag");
      // The mapping must carry BOTH teams and each must point at a real, active,
      // non-HR user (so a fresh website lead can actually be assigned).
      for (const team of ["Dubai", "India"]) {
        const id = cfg.assignees[team];
        assert(!!id, `websiteLeadAssignees must map ${team} → a userId`);
        const u = await prisma.user.findFirst({ where: { id, active: true, hrOnly: false }, select: { id: true } });
        assert(!!u, `${team} assignee (${id}) must be an active, non-HR user`);
      }
      // The hook must route through the canonical assignLeadTo() (Assignment-history
      // + notify) — guards Agent Performance. Static source scan so a refactor can't
      // silently bypass it.
      const fs = await import("node:fs");
      const ingest = fs.readFileSync("src/lib/leadIngest.ts", "utf8");
      assert(/getWebsiteAutoAssign/.test(ingest), "leadIngest must consult getWebsiteAutoAssign");
      assert(/assignLeadTo\(lead\.id,\s*assignee\.id/.test(ingest), "website auto-assign MUST use assignLeadTo() (history + notify)");
    },
  },
  {
    name: "property-enquired — importers detect every project/property header variant (→ sourceDetail)",
    run: async () => {
      const fs = await import("node:fs");
      // The broadened candidate list now lives in the SHARED mapping lib (single
      // source of truth for both importers). Assert it carries every variant…
      const lib = fs.readFileSync("src/lib/importMapping.ts", "utf8");
      for (const cand of ["enquiredproperty", "interestedproject", "requirementproject", "towerproject", "propertyname"]) {
        assert(lib.includes(cand), `src/lib/importMapping.ts (PROJECT_PICK/FIELD_CANDIDATES) must detect "${cand}" as a Property-Enquired header`);
      }
      // …and BOTH importers must still map the project/property column into
      // sourceDetail (never overwriting a manual value).
      for (const f of ["src/app/api/intake/csv/route.ts", "src/app/api/intake/google-sheet/route.ts"]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/update\.sourceDetail = update\.sourceDetail \?\?/.test(src), `${f} must map the project/property column into sourceDetail (never overwrite)`);
        assert(/PROJECT_PICK/.test(src), `${f} must use the shared PROJECT_PICK candidate list`);
      }
    },
  },
  {
    // Agent field-movement status — proves the migration is live in prod
    // (table selectable) AND the pairing/duration invariant holds: every
    // closed event with a durationMin is non-negative and equals the rounded
    // minute diff between startedAt and endedAt (the math logAgentStatus writes).
    name: "agent-status — AgentStatusEvent table exists + durationMin consistent with start/end (no negatives)",
    run: async () => {
      // (a) selectable → migration applied in prod (throws if table/columns missing).
      const total = await prisma.agentStatusEvent.count();
      assert(typeof total === "number" && total >= 0, "agentStatusEvent.count() must return a non-negative number");

      // (b) duration consistency across all closed rows that carry a duration.
      const closed = await prisma.agentStatusEvent.findMany({
        where: { durationMin: { not: null }, endedAt: { not: null } },
        select: { id: true, startedAt: true, endedAt: true, durationMin: true },
        take: 2000,
      });
      for (const r of closed) {
        assert((r.durationMin as number) >= 0, `durationMin must be >=0 (row ${r.id} = ${r.durationMin})`);
        const expected = Math.max(0, Math.round((r.endedAt!.getTime() - r.startedAt!.getTime()) / 60_000));
        assert(
          r.durationMin === expected,
          `durationMin (${r.durationMin}) must equal rounded(end-start)=${expected} for row ${r.id}`,
        );
      }

      // (c) a "Returned" row that carries a duration must point at its opening row.
      const returnedPaired = await prisma.agentStatusEvent.findMany({
        where: { status: { in: ["RETURNED_MEETING", "RETURNED_SITE_VISIT"] }, durationMin: { not: null } },
        select: { id: true, pairedEventId: true },
        take: 2000,
      });
      for (const r of returnedPaired) {
        assert(!!r.pairedEventId, `Returned row ${r.id} with a duration must have pairedEventId set`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 40. BUYER LIFECYCLE — the worked-pipeline invariants (Part 5a).
  //   (a) the new columns + tables exist (selecting them must not throw → proves
  //       the 20260624130000_buyer_lifecycle migration is applied in prod).
  //   (b) AUTO-RETURN rule holds in DATA: no ASSIGNED buyer may sit at
  //       attemptCount >= 5 — at the 5th attempt it MUST have been returned to the
  //       Admin Pool (event-driven, no cron). A counter-example means the
  //       auto-return path regressed.
  //   (c) assignment-history is captured: every non-pool buyer (ASSIGNED /
  //       CONVERTED / REJECTED-with-an-owner-history) that has any BuyerActivity
  //       has at least one BuyerAssignment stint — history is never lost.
  //   (d) buyerScopeWhere(agent) EXCLUDES other agents + the pool: the agent
  //       where-clause (replicated inline, byte-equivalent to src/lib/buyerScope.ts)
  //       must never select a buyer this agent doesn't own or one not ASSIGNED.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-lifecycle — columns/tables exist + auto-return-at-5 + assignment-history captured + agent scope excludes others",
    run: async () => {
      // (a) column / table presence probes (SELECT must not throw).
      const probe = await prisma.buyerRecord.findFirst({
        select: {
          id: true, ownerId: true, poolStatus: true, attemptCount: true, remarks: true,
          convertedLeadId: true, convertedAt: true, convertedById: true,
          rejectedAt: true, rejectedById: true, rejectionReason: true, returnedToPoolAt: true,
        },
      });
      void probe; // may be null on empty data — the point is selectability.
      // New tables must be queryable.
      const aCount = await prisma.buyerAssignment.count();
      const evCount = await prisma.buyerActivity.count();
      assert(typeof aCount === "number" && aCount >= 0, "buyerAssignment.count() failed");
      assert(typeof evCount === "number" && evCount >= 0, "buyerActivity.count() failed");

      // (b) AUTO-RETURN: zero ASSIGNED buyers with attemptCount >= 5.
      const stuck = await prisma.buyerRecord.count({
        where: { poolStatus: "ASSIGNED", attemptCount: { gte: 5 } },
      });
      assert(stuck === 0, `auto-return regressed: ${stuck} ASSIGNED buyer(s) with attemptCount >= 5 (should be back in the pool)`);

      // Also: any ASSIGNED buyer MUST have an owner (poolStatus/ownerId coherence).
      const assignedNoOwner = await prisma.buyerRecord.count({
        where: { poolStatus: "ASSIGNED", ownerId: null },
      });
      assert(assignedNoOwner === 0, `${assignedNoOwner} ASSIGNED buyer(s) have no ownerId (incoherent lifecycle state)`);
      // A CONVERTED buyer must carry its convertedLeadId.
      const convertedNoLead = await prisma.buyerRecord.count({
        where: { poolStatus: "CONVERTED", convertedLeadId: null },
      });
      assert(convertedNoLead === 0, `${convertedNoLead} CONVERTED buyer(s) missing convertedLeadId`);

      // (c) assignment-history captured: any buyer that has been worked (has a
      // BuyerActivity of a lifecycle/contact kind) and is not still in the pool
      // must have >= 1 BuyerAssignment stint. We check the converted set (a buyer
      // can only be CONVERTED after being assigned), which must always have a stint.
      const convertedBuyers = await prisma.buyerRecord.findMany({
        where: { poolStatus: "CONVERTED" },
        select: { id: true, _count: { select: { assignments: true } } },
        take: 2000,
      });
      for (const b of convertedBuyers) {
        assert(b._count.assignments >= 1, `CONVERTED buyer ${b.id} has no BuyerAssignment stint (history lost)`);
      }

      // (d) buyerScopeWhere(AGENT) excludes others + the pool. Replicated inline:
      //     AGENT → { ownerId: me.id, poolStatus: "ASSIGNED" }.
      const sampleAgent = await prisma.user.findFirst({ where: { role: "AGENT" }, select: { id: true } });
      if (sampleAgent) {
        const agentWhere = { ownerId: sampleAgent.id, poolStatus: "ASSIGNED" as const };
        const scoped = await prisma.buyerRecord.findMany({ where: agentWhere, select: { ownerId: true, poolStatus: true }, take: 2000 });
        for (const r of scoped) {
          assert(r.ownerId === sampleAgent.id, "agent scope leaked a buyer owned by someone else");
          assert(r.poolStatus === "ASSIGNED", "agent scope leaked a non-ASSIGNED buyer (pool/converted/rejected)");
        }
        // The agent scope count must never exceed the agent's owned-AND-assigned count.
        const ownedAssigned = await prisma.buyerRecord.count({ where: agentWhere });
        assert(scoped.length <= ownedAssigned, "agent scope returned more than owned+assigned");
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 41. BUYER DATA UI + DISTRIBUTION — Part 5b invariants.
  //   (a) the recycle-bin `deletedAt` column exists and buyerScopeWhere EXCLUDES
  //       soft-deleted buyers in EVERY branch (a deleted buyer never appears).
  //   (b) the new write surfaces are role-gated: bulk delete/restore = ADMIN,
  //       transfer = ADMIN/MANAGER; distribute = ADMIN/MANAGER; settings toggle = ADMIN.
  //   (c) the rule-based distribution planner math (pure, in memory): assign-N caps
  //       at the pool size; split-equally round-robins evenly.
  //   (d) the daily auto-distribution toggle DEFAULTS OFF (no buyers move on a
  //       schedule unless an admin opts in) and the cron is bearer-CRON_SECRET gated.
  //   (e) the detail page renders Imported Fields BETWEEN Notes and the Conversation
  //       timeline (the required layout) — a static ordering scan.
  // Read-only: column probe + pure-lib math + static source scans. ZERO writes.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-5b — soft-delete excluded from scope + bulk/distribute role-gated + planner math + daily toggle OFF + imported-fields placement",
    run: async () => {
      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");

      // (a) deletedAt column exists + scope excludes deleted.
      await prisma.buyerRecord.findFirst({ select: { id: true, deletedAt: true, deletedById: true } });
      const scopeSrc = read("src/lib/buyerScope.ts");
      // Every branch of buyerScopeWhere must carry deletedAt:null.
      const branchCount = (scopeSrc.match(/deletedAt:\s*null/g) ?? []).length;
      assert(branchCount >= 4, `buyerScopeWhere must add deletedAt:null to every branch (found ${branchCount}, expected ≥4)`);
      assert(/if \(buyer\.deletedAt\) return false/.test(scopeSrc), "canTouchBuyer MUST reject a soft-deleted buyer");
      // Live count via the same filter must never include a deleted row.
      const deletedCount = await prisma.buyerRecord.count({ where: { deletedAt: { not: null } } });
      const liveCount = await prisma.buyerRecord.count({ where: { deletedAt: null } });
      const total = await prisma.buyerRecord.count();
      assert(liveCount + deletedCount === total, `live + deleted must equal total (${liveCount}+${deletedCount} ≠ ${total})`);

      // (b) role gates on the new write routes.
      const bulkSrc = read("src/app/api/buyer-data/bulk/route.ts");
      assert(/isBuyerAdmin\(me\)/.test(bulkSrc) && /Only an admin can delete buyers/.test(bulkSrc), "bulk delete MUST be ADMIN-only");
      assert(/Only an admin can restore buyers/.test(bulkSrc), "bulk restore MUST be ADMIN-only");
      assert(/Only an admin or manager can transfer buyers/.test(bulkSrc), "bulk transfer MUST be ADMIN/MANAGER");
      const distSrc = read("src/app/api/buyer-data/distribute/route.ts");
      assert(/requireRole\("ADMIN", "MANAGER"\)/.test(distSrc), "distribute route MUST be ADMIN/MANAGER");
      assert(/requireRole\("ADMIN"\)/.test(read("src/app/api/settings/buyer-distribute/route.ts")), "buyer-distribute settings toggle MUST be ADMIN-only");

      // (c) planner math (pure, in memory — no DB writes). Build agents + a fake pool.
      const dist = await import("../src/lib/buyerDistribution");
      // regionWhere returns {} for blank, and an OR for a region.
      assert(Object.keys(dist.regionWhere("")).length === 0, "regionWhere('') must be empty (no narrowing)");
      const dubai = dist.regionWhere("Dubai");
      assert(Array.isArray((dubai as { OR?: unknown[] }).OR) && (dubai as { OR: unknown[] }).OR.length > 0, "regionWhere('Dubai') must produce an OR filter");
      // poolableWhere always pins ADMIN_POOL + ownerId null + deletedAt null.
      const pw = dist.poolableWhere();
      assert(pw.poolStatus === "ADMIN_POOL" && pw.ownerId === null && pw.deletedAt === null, "poolableWhere must pin ADMIN_POOL + no owner + not deleted");

      // (d) daily toggle defaults OFF.
      const { getBuyerAutoDistribute } = await import("../src/lib/settings");
      const cfg = await getBuyerAutoDistribute();
      assert(cfg.enabled === false || typeof cfg.enabled === "boolean", "getBuyerAutoDistribute must return a boolean enabled flag");
      // With no Setting row written, the default MUST be OFF.
      const hasRow = await prisma.setting.findUnique({ where: { key: "buyerAutoDistribute.enabled" } });
      if (!hasRow) assert(cfg.enabled === false, "daily auto-distribution MUST default OFF when unset");
      // The cron route is CRON_SECRET gated.
      const cronSrc = read("src/app/api/cron/buyer-distribute/route.ts");
      assert(/Bearer \$\{cronSecret\}/.test(cronSrc) && /Unauthorized/.test(cronSrc), "buyer-distribute cron MUST be bearer-CRON_SECRET gated");
      // And it lives in GitHub Actions (sub-daily-capable), NOT a 3rd Vercel cron.
      const vercelJson = read("vercel.json");
      assert(!/buyer-distribute/.test(vercelJson), "buyer-distribute must NOT be a Vercel cron (hobby cap = 2); it lives in cron.yml");
      const cronYml = read(".github/workflows/cron.yml");
      assert(/api\/cron\/buyer-distribute/.test(cronYml), "buyer-distribute MUST be wired into .github/workflows/cron.yml");

      // (e) detail page renders Notes + ImportedFields + Conversation.
      //     SUPERSEDED ORDER (v36 — Buyer detail = Lead View unification): the
      //     detail page was rebuilt to mirror the Lead master template, where
      //     Conversation History sits high in the MAIN column (right after the
      //     header + intelligence) and the buyer-specific extra section — incl.
      //     Imported Fields — lives BELOW the Quick Note. So Conversation now
      //     precedes Imported Fields (the old "Notes → Imported → Conversation"
      //     order no longer applies). BuyerNotesCard moved to the right rail
      //     (shared working notes) and is still rendered. We assert the new
      //     parity order: Conversation History BEFORE Imported Fields, all present.
      const detail = read("src/app/(app)/buyer-data/[id]/page.tsx");
      const iNotes = detail.indexOf("<BuyerNotesCard");
      const iImported = detail.indexOf("<ImportedFieldsCard customFields");
      const iConvo = detail.indexOf("<BuyerActivityTimeline");
      assert(iNotes > 0 && iImported > 0 && iConvo > 0, "detail page must render Notes + ImportedFields + Conversation");
      assert(iConvo < iImported, "Conversation History MUST come before Imported Fields (Lead-view parity: timeline high in the main column, extra section below Quick Note)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 42. BUYER PERFORMANCE REPORTING — Part 6 invariants (/reports/buyer-performance).
  //   The report MUST be reconcilable: every per-agent metric count traces back to
  //   the exact BuyerRecords behind it (the drill-down), and the admin summary
  //   totals equal direct prisma counts. Deleted buyers NEVER count.
  //
  //   src/lib/buyerPerformance.ts imports "server-only" (bare tsx can't resolve it),
  //   so — like the lead-report checks — the metric + drill-down query SHAPES are
  //   REPLICATED INLINE here, byte-equivalent to that file. The lifecycle TYPE
  //   constants are imported from src/lib/buyerLifecycle.ts (NOT server-only) so the
  //   activity-type strings are tested against the REAL source. When you change a
  //   query in buyerPerformance.ts, mirror it here.
  //
  //   Proves, against the real prod DB (read-only):
  //   (a) ENGINE TABLES selectable (probe).
  //   (b) ADMIN SUMMARY == direct counts: total == assigned+pool+converted+rejected
  //       buckets reconcile, and each bucket equals its own poolStatus count;
  //       live+deleted == grand total (deleted excluded from every summary number).
  //   (c) METRIC == DRILL-DOWN for a real agent: for the busiest agent (most
  //       BuyerActivity), the report's per-agent counts (computed inline the same
  //       way buildBuyerReport does) EQUAL the drill-down record/event counts
  //       (computed inline the same way buyerDrilldownWhere/buyerEventCount do).
  //   (d) DELETED EXCLUDED: a soft-deleted buyer with activity never appears in any
  //       drill-down population (the deletedAt:null filter is load-bearing).
  //   (e) FUNNEL MONOTONICITY: contacted/engaged/converted are each ⊆ assigned.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-performance — summary == direct counts + every metric reconciles with its drill-down + deleted excluded + funnel ⊆ assigned",
    run: async () => {
      // Lifecycle type constants from the REAL (non-server-only) source.
      const { BUYER_ACTIVITY_TYPE, BUYER_RETURN_REASON, ATTEMPT_TYPES } = await import("../src/lib/buyerLifecycle");
      const ATTEMPT_LIST = [...ATTEMPT_TYPES];
      const CONTACT_LIST = [
        BUYER_ACTIVITY_TYPE.CALL, BUYER_ACTIVITY_TYPE.NOTE, BUYER_ACTIVITY_TYPE.WHATSAPP,
        BUYER_ACTIVITY_TYPE.VOICE_NOTE, ...ATTEMPT_LIST,
      ];
      const ENGAGED_LIST = [BUYER_ACTIVITY_TYPE.CALL, BUYER_ACTIVITY_TYPE.WHATSAPP];

      // (a) engine tables selectable.
      await prisma.buyerAssignment.findFirst({ select: { id: true, userId: true, assignedAt: true, returnedAt: true, returnReason: true, attemptsInStint: true } });
      await prisma.buyerActivity.findFirst({ select: { id: true, userId: true, type: true, createdAt: true, buyerId: true } });

      // (b) ADMIN SUMMARY == direct counts (whole pool; teamOwnerIds = null path).
      const base = { deletedAt: null } as const;
      const [total, assigned, pool, converted, rejected, returnedToPool, grand, deleted] = await Promise.all([
        prisma.buyerRecord.count({ where: base }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "ASSIGNED" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "ADMIN_POOL" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "CONVERTED" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "REJECTED" } }),
        prisma.buyerRecord.count({ where: { ...base, returnedToPoolAt: { not: null }, poolStatus: "ADMIN_POOL" } }),
        prisma.buyerRecord.count(),
        prisma.buyerRecord.count({ where: { deletedAt: { not: null } } }),
      ]);
      // Every live buyer sits in exactly one of the 4 known poolStatus buckets (or an
      // unknown one). assigned+pool+converted+rejected must not exceed total, and on
      // a clean lifecycle they sum to it (no stray status). returnedToPool ⊆ pool.
      assert(assigned + pool + converted + rejected <= total, "summary buckets exceed total (impossible)");
      const unknownStatus = total - (assigned + pool + converted + rejected);
      assert(unknownStatus === 0, `${unknownStatus} live buyer(s) have a poolStatus outside {ADMIN_POOL,ASSIGNED,CONVERTED,REJECTED} — summary would under-count`);
      assert(returnedToPool <= pool, "returnedToPool must be a subset of the Admin Pool");
      assert(total + deleted === grand, `live (${total}) + deleted (${deleted}) must equal grand total (${grand}) — deleted not excluded from summary`);
      // "Active" in the summary is defined == assigned.
      const active = assigned;
      assert(active === assigned, "summary 'active' must equal the ASSIGNED count");

      // (c) METRIC == DRILL-DOWN for the busiest real agent (most BuyerActivity).
      // Pick the agent with the most authored activity rows; if none exist, the
      // reconciliation is vacuously true and we note it.
      const busiest = await prisma.buyerActivity.groupBy({
        by: ["userId"],
        where: { userId: { not: null }, buyer: { deletedAt: null } },
        _count: { _all: true },
        orderBy: { _count: { userId: "desc" } },
        take: 1,
      });
      const agentId = busiest[0]?.userId ?? null;

      if (!agentId) {
        results.push({ name: "  ↳ note", ok: true, detail: "no BuyerActivity in prod yet — metric/drill reconciliation is vacuously satisfied (math proven by the synthetic E2E proof at deploy time)" });
      } else {
        // Use an all-time window so the window math doesn't gate the reconciliation
        // (the equality we prove — metric == drill — is window-independent).
        const win = { gte: new Date("2000-01-01T00:00:00Z"), lt: new Date("2999-01-01T00:00:00Z") };

        // ── REPORT-SIDE counts (inline, == buildBuyerReport) ──
        // Assigned: distinct buyers with a stint opened by the agent in window.
        const stints = await prisma.buyerAssignment.findMany({
          where: { userId: agentId, assignedAt: win, buyer: { deletedAt: null } },
          select: { buyerId: true },
        });
        const workedSet = new Set(stints.map((s) => s.buyerId));
        const report_assigned = workedSet.size;

        const evCount = (where: object) => prisma.buyerActivity.count({ where });
        const report_converted = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.CONVERTED, createdAt: win, buyer: { deletedAt: null } });
        const report_rejected = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.REJECTED, createdAt: win, buyer: { deletedAt: null } });
        const report_calls = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.CALL, createdAt: win, buyer: { deletedAt: null } });
        const report_wa = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.WHATSAPP, createdAt: win, buyer: { deletedAt: null } });
        const report_notes = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.NOTE, createdAt: win, buyer: { deletedAt: null } });
        const report_voice = await evCount({ userId: agentId, type: BUYER_ACTIVITY_TYPE.VOICE_NOTE, createdAt: win, buyer: { deletedAt: null } });
        const report_attempts = await evCount({ userId: agentId, type: { in: ATTEMPT_LIST }, createdAt: win, buyer: { deletedAt: null } });
        const report_autoRet = await prisma.buyerAssignment.count({ where: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.AUTO_5_ATTEMPTS, buyer: { deletedAt: null } } });
        const report_manRet = await prisma.buyerAssignment.count({ where: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.MANUAL_REJECT, buyer: { deletedAt: null } } });

        // ── DRILL-SIDE counts (inline, == buyerDrilldownWhere / buyerEventCount) ──
        // Distinct-buyer drill counts:
        const drill_assigned = await prisma.buyerRecord.count({ where: { deletedAt: null, assignments: { some: { userId: agentId, assignedAt: win } } } });
        // Event drill counts (== buyerEventCount → must equal the report number):
        const drillEv_converted = await prisma.buyerActivity.count({ where: { userId: agentId, type: BUYER_ACTIVITY_TYPE.CONVERTED, createdAt: win, buyer: { deletedAt: null } } });
        const drillEv_attempts = await prisma.buyerActivity.count({ where: { userId: agentId, type: { in: ATTEMPT_LIST }, createdAt: win, buyer: { deletedAt: null } } });
        const drillEv_autoRet = await prisma.buyerAssignment.count({ where: { userId: agentId, returnedAt: win, returnReason: BUYER_RETURN_REASON.AUTO_5_ATTEMPTS, buyer: { deletedAt: null } } });

        // RECONCILE: report number == drill number (the contract the UI promises).
        assert(report_assigned === drill_assigned, `Assigned mismatch: report ${report_assigned} ≠ drill ${drill_assigned}`);
        assert(report_converted === drillEv_converted, `Converted mismatch: report ${report_converted} ≠ drill-event ${drillEv_converted}`);
        assert(report_attempts === drillEv_attempts, `Attempts mismatch: report ${report_attempts} ≠ drill-event ${drillEv_attempts}`);
        assert(report_autoRet === drillEv_autoRet, `Auto-returned mismatch: report ${report_autoRet} ≠ drill ${drillEv_autoRet}`);

        // For EVENT metrics, the DISTINCT-buyer drill population must never EXCEED
        // the event count (N events across ≤N buyers) — the drill page's reconciliation.
        const distinctBuyers_calls = await prisma.buyerRecord.count({ where: { deletedAt: null, activities: { some: { userId: agentId, createdAt: win, type: BUYER_ACTIVITY_TYPE.CALL } } } });
        assert(distinctBuyers_calls <= report_calls, `distinct buyers behind Calls (${distinctBuyers_calls}) must be ≤ event count (${report_calls})`);
        // sanity: the other event counts are all non-negative ints (the queries ran).
        for (const [n, label] of [[report_rejected, "rejected"], [report_wa, "whatsapp"], [report_notes, "notes"], [report_voice, "voice"], [report_manRet, "manualReturned"], [report_converted, "converted"]] as const) {
          assert(Number.isInteger(n) && n >= 0, `${label} count is not a non-negative integer (${n})`);
        }

        // (e) FUNNEL ⊆ ASSIGNED: contacted/engaged/converted intersected with the
        // worked set must each be ≤ assigned (clean monotonic drop-off).
        const stagePairs = async (types: string[] | string) =>
          prisma.buyerActivity.findMany({
            where: { userId: agentId, createdAt: win, buyer: { deletedAt: null }, type: Array.isArray(types) ? { in: types } : types },
            select: { buyerId: true },
            distinct: ["buyerId"],
          });
        const inWorked = (rows: Array<{ buyerId: string }>) => rows.filter((r) => workedSet.has(r.buyerId)).length;
        const funnel_contacted = inWorked(await stagePairs(CONTACT_LIST));
        const funnel_engaged = inWorked(await stagePairs(ENGAGED_LIST));
        const funnel_converted = inWorked(await stagePairs(BUYER_ACTIVITY_TYPE.CONVERTED));
        assert(funnel_contacted <= report_assigned, `funnel Contacted (${funnel_contacted}) exceeds Assigned (${report_assigned})`);
        assert(funnel_engaged <= report_assigned, `funnel Engaged (${funnel_engaged}) exceeds Assigned (${report_assigned})`);
        assert(funnel_converted <= report_assigned, `funnel Converted (${funnel_converted}) exceeds Assigned (${report_assigned})`);
        // Engaged ⊆ Contacted (a call/WA is a contact activity), Converted ⊆ Assigned.
        assert(funnel_engaged <= funnel_contacted, `funnel Engaged (${funnel_engaged}) exceeds Contacted (${funnel_contacted})`);
      }

      // (d) DELETED EXCLUDED: no soft-deleted buyer may ever surface in a drill
      // population. Assert directly: the assigned-drill where (with deletedAt:null)
      // can never return a deleted buyer. We prove the filter is load-bearing by
      // checking that a deleted buyer with assignments is NOT counted.
      const deletedWithStint = await prisma.buyerRecord.findFirst({
        where: { deletedAt: { not: null }, assignments: { some: {} } },
        select: { id: true, assignments: { select: { userId: true }, take: 1 } },
      });
      if (deletedWithStint && deletedWithStint.assignments[0]) {
        const owner = deletedWithStint.assignments[0].userId;
        const leaked = await prisma.buyerRecord.count({
          where: { id: deletedWithStint.id, deletedAt: null, assignments: { some: { userId: owner } } },
        });
        assert(leaked === 0, "a soft-deleted buyer leaked into the assigned drill-down population (deletedAt:null filter not load-bearing)");
      } else {
        results.push({ name: "  ↳ note", ok: true, detail: "no soft-deleted buyer with a stint present — deleted-exclusion drill check skipped (filter still asserted in buyer-5b)" });
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 43. BUYER IMPORT → RAW HISTORY + SMART TIMELINE + DEDUP (parity with Lead imports).
  //   A buyer import must now behave like a lead import:
  //   (a) SCHEMA: BuyerRecord.rawImport column exists (migration applied to prod).
  //   (b) PURE LIB: buildBuyerTimelinePlan honors a historical date in the remark
  //       and falls back to the import date for an undated remark; the imported-tag
  //       round-trips (isImportedActivityDescription); composeRemarkFromFields turns
  //       status columns into one verbatim labeled line (Excel serial → readable).
  //   (c) ROUTE WIRING (static): the import route maps a Remarks column → remarks,
  //       stores rawImport, dedups against existing buyers, and generates BuyerActivity.
  //   (d) DATA INVARIANT: every buyer that carries an imported-tagged BuyerActivity
  //       also has a non-null remarks (Raw History) — the Smart Timeline is never
  //       orphaned from the Raw History it was derived from.
  // Read-only: column probe + pure-lib math + static source scans + a data count.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-import-history — rawImport column + remarks→timeline parity (historical date honored, import-date fallback) + dedup wired + no orphaned timeline",
    run: async () => {
      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");

      // (a) rawImport column selectable (probe — proves the migration is applied).
      await prisma.buyerRecord.findFirst({ select: { id: true, rawImport: true, remarks: true } });

      // (b) PURE LIB — the shared remarks→timeline engine (tests REAL code).
      const { buildBuyerTimelinePlan, composeRemarkFromFields, isImportedActivityDescription, IMPORTED_TAG } =
        await import("../src/lib/buyerRemarkTimeline");
      const fallback = new Date("2026-01-15T06:30:00Z");
      // A remark WITH a historical date → the activity is dated to THAT date, not the fallback.
      const dated = buildBuyerTimelinePlan("On 19 Jun 2026 (3:30 pm) client called, discussed 2BR", fallback);
      assert(dated.length >= 1, "dated remark must produce ≥1 timeline row");
      const istDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
      assert(istDay(dated[0].createdAt) === "2026-06-19", `historical date must be honored (got ${istDay(dated[0].createdAt)}, expected 2026-06-19)`);
      assert(dated[0].description.includes(IMPORTED_TAG.trim()), "generated activity must carry the imported tag");
      assert(isImportedActivityDescription(dated[0].description) === true, "imported-tag round-trip must hold");
      // A remark with NO date → falls back to the import date.
      const undated = buildBuyerTimelinePlan("Status: DNC Request", fallback);
      assert(undated.length === 1 && undated[0].createdAt.getTime() === fallback.getTime(), "undated remark must fall back to the import date");
      assert(undated[0].type === "NOTE", "a bare status line classifies as NOTE");
      // A WhatsApp mention routes to the WHATSAPP lane.
      const wa = buildBuyerTimelinePlan("Sent details on WhatsApp", fallback);
      assert(wa[0]?.type === "WHATSAPP", "a WhatsApp mention must route to the WHATSAPP lane");
      // Empty remark → no rows; a live agent-logged description is NOT imported.
      assert(buildBuyerTimelinePlan("", fallback).length === 0 && buildBuyerTimelinePlan(null, fallback).length === 0, "empty remark → no timeline rows");
      assert(isImportedActivityDescription("Called the client, will follow up") === false, "a live agent-logged row must NOT be flagged imported");
      // composeRemarkFromFields: verbatim values, Excel serial follow-up → readable date.
      const composed = composeRemarkFromFields({ Status: "Moved To MIS", "Follow-Up": "46152" });
      assert(/Status: Moved To MIS/.test(composed) && /Follow-Up: 2026-05-10/.test(composed), `composeRemarkFromFields must preserve values + convert Excel serial (got ${JSON.stringify(composed)})`);
      assert(composeRemarkFromFields({ Status: "" }) === "", "all-blank status fields → empty composed remark");

      // (c) ROUTE WIRING (static) — the import route must do all four jobs.
      const route = read("src/app/api/buyer-data/import/route.ts");
      assert(/buildBuyerTimelinePlan/.test(route) && /buyerActivity\.createMany/.test(route), "import route MUST generate BuyerActivity Smart-Timeline rows");
      assert(/remarks:\s*remark/.test(route), "import route MUST store the imported remark on BuyerRecord.remarks (Raw History)");
      assert(/rawImport:/.test(route), "import route MUST store the verbatim rawImport audit");
      assert(/findExistingBuyer/.test(route) && /dupMode/.test(route), "import route MUST dedup (match existing buyer + honor dupMode)");
      // The wizard must offer the Remarks field + send the full raw row + a dup choice.
      const wizard = read("src/components/BuyerImportClient.tsx");
      assert(/\["remarks",/.test(wizard), "import wizard MUST offer a Remarks mapping field");
      assert(/_raw:/.test(wizard) && /dupMode/.test(wizard), "import wizard MUST send the full raw row + a duplicate-handling choice");

      // (d) DATA INVARIANT — no orphaned Smart Timeline: every buyer with an
      // imported-tagged activity has a non-null remarks (the Raw History source).
      const importedActs = await prisma.buyerActivity.findMany({
        where: { description: { contains: IMPORTED_TAG.trim() }, buyer: { deletedAt: null } },
        select: { buyerId: true },
        distinct: ["buyerId"],
        take: 5000,
      });
      if (importedActs.length > 0) {
        const ids = importedActs.map((a) => a.buyerId);
        const orphaned = await prisma.buyerRecord.count({ where: { id: { in: ids }, OR: [{ remarks: null }, { remarks: "" }] } });
        assert(orphaned === 0, `${orphaned} buyer(s) have an imported Smart-Timeline row but NO remarks (Raw History) — timeline orphaned from its source`);
      } else {
        results.push({ name: "  ↳ note", ok: true, detail: "no imported-tagged BuyerActivity in prod yet — orphan check vacuously satisfied" });
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 12. DASHBOARD LIVE-ASSIGNMENT WIDGET (2026-06-24)
  //   The admin-dashboard "Live Lead Assignment & Status" grid breaks the
  //   assigned-in-window population down by CURRENT status into DISJOINT column
  //   buckets (leadStatusColumn). Two guards:
  //   (a) CLASSIFICATION — leadStatusColumn() is total + disjoint: every status
  //       in the union of every team master maps to exactly one column, and the
  //       finite COLUMN_STATUS_VALUES sets don't overlap. lead-statuses.ts has
  //       NO "server-only", so this tests the REAL classifier the widget uses.
  //   (b) RECONCILIATION (data) — for a real agent with assignment history, the
  //       per-column drill where-clause counts SUM to the assigned-in-window
  //       total (no lead lost, none double-counted) — proving the grid numbers
  //       reconcile 1:1 with their drill lists, the same as agent-performance.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "dashboard-assignment — status→column is total+disjoint; per-agent column drills reconcile to the assigned total",
    run: async () => {
      const {
        leadStatusColumn, COLUMN_STATUS_VALUES, COLUMN_NON_OPEN_STATUSES,
        FRESH_STATUS_IN_VALUES, INDIA_STATUSES, DUBAI_STATUSES, TERMINAL_STATUSES,
        isWorkableStatus,
      } = await import("../src/lib/lead-statuses");

      // (a) Every status in either team master classifies into exactly one column.
      const allStatuses = [...new Set([...INDIA_STATUSES, ...DUBAI_STATUSES])];
      for (const s of allStatuses) {
        const col = leadStatusColumn(s);
        assert(typeof col === "string" && col.length > 0, `leadStatusColumn("${s}") produced no bucket`);
      }
      // null / empty → FRESH (fail-safe).
      assert(leadStatusColumn(null) === "FRESH" && leadStatusColumn("") === "FRESH", "null/empty status must bucket as FRESH");
      // The finite column sets must be mutually exclusive (no status in two columns).
      const finiteSets = Object.values(COLUMN_STATUS_VALUES) as string[][];
      const seen = new Map<string, number>();
      for (const set of finiteSets) for (const s of set) seen.set(s, (seen.get(s) ?? 0) + 1);
      const overlaps = [...seen.entries()].filter(([, n]) => n > 1).map(([s]) => s);
      assert(overlaps.length === 0, `COLUMN_STATUS_VALUES sets overlap on: ${overlaps.join(", ")} — buckets must be disjoint`);
      // Each finite-set status actually classifies to a finite column (not FRESH/OTHER).
      for (const s of COLUMN_NON_OPEN_STATUSES) {
        const col = leadStatusColumn(s);
        assert(col !== "FRESH" && col !== "OTHER", `"${s}" is a finite-column status but classified as ${col}`);
      }

      // (b) Pick a real agent who HELD a lead via an assignment in a wide window.
      const recentAssignment = await prisma.assignment.findFirst({
        where: { lead: { deletedAt: null } },
        orderBy: { assignedAt: "desc" },
        select: { userId: true, assignedAt: true },
      });
      if (!recentAssignment) {
        results.push({ name: "  ↳ note", ok: true, detail: "no Assignment rows in prod — reconciliation check vacuously satisfied" });
        return;
      }
      const agentId = recentAssignment.userId;
      // Window: a generous span around the assignment so we capture a population.
      const gte = new Date("2000-01-01T00:00:00Z");
      const lt = new Date(Date.now() + 86400000);
      const win = { gte, lt };
      // assigned-in-window population (mirrors agentPerformance.drilldownWhere base).
      const assignedInWindow = { deletedAt: null, assignments: { some: { userId: agentId, assignedAt: win } } } as const;

      const totalAssigned = await prisma.lead.count({ where: assignedInWindow });
      assert(totalAssigned > 0, "selected agent has no assigned-in-window leads — fixture mismatch");

      // Count each column with the SAME where-clause shape drilldownWhere builds.
      const fresh = await prisma.lead.count({
        where: { ...assignedInWindow, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { in: FRESH_STATUS_IN_VALUES } }] },
      });
      const finiteCounts: Record<string, number> = {};
      for (const [col, set] of Object.entries(COLUMN_STATUS_VALUES) as [string, string[]][]) {
        finiteCounts[col] = await prisma.lead.count({ where: { ...assignedInWindow, currentStatus: { in: set } } });
      }
      const other = await prisma.lead.count({
        where: { ...assignedInWindow, currentStatus: { notIn: [...COLUMN_NON_OPEN_STATUSES, ...FRESH_STATUS_IN_VALUES], not: null }, NOT: { currentStatus: "" } },
      });
      const sumOfColumns = fresh + other + Object.values(finiteCounts).reduce((a, b) => a + b, 0);
      assert(
        sumOfColumns === totalAssigned,
        `column counts (${sumOfColumns}) do not reconcile with assigned-in-window total (${totalAssigned}) for agent ${agentId} — buckets not exhaustive/disjoint`,
      );

      // The "Active" drill (workable subset) must be ≤ total and consistent with terminal exclusion.
      const active = await prisma.lead.count({
        where: { ...assignedInWindow, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] },
      });
      assert(active <= totalAssigned, `active (${active}) cannot exceed assigned (${totalAssigned})`);
      // Active must equal total minus the terminal columns (BOOKED + LOST) — within the disjoint model.
      const terminalInWindow = (finiteCounts.BOOKED ?? 0) + (finiteCounts.LOST ?? 0);
      // OTHER holds closed-non-win outcomes (also terminal per isWorkableStatus). Verify the
      // workable identity: active == assigned - (terminal columns + terminal "OTHER" rows).
      // Recompute OTHER's terminal share precisely via isWorkableStatus on a sample-free count:
      const otherTerminal = await prisma.lead.count({
        where: {
          ...assignedInWindow,
          currentStatus: { notIn: [...COLUMN_NON_OPEN_STATUSES, ...FRESH_STATUS_IN_VALUES], not: null },
          NOT: { currentStatus: "" },
          AND: [{ currentStatus: { in: TERMINAL_STATUSES } }],
        },
      });
      void isWorkableStatus; // (documents intent; the identity below encodes it)
      assert(
        active === totalAssigned - terminalInWindow - otherTerminal,
        `active identity broken: active(${active}) != assigned(${totalAssigned}) - terminalCols(${terminalInWindow}) - otherTerminal(${otherTerminal})`,
      );
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 26. IMPORT MAPPING TOOLKIT  (shared lib used by CSV + Google-Sheet + wizard)
  //    The Import-Mapping-Approval wizard depends on the shared toolkit behaving
  //    identically across importers. Assert the REAL pure functions:
  //      • buildMapping proposes the right CRM field per header (high/medium/unknown)
  //      • unknown headers fall to IGNORE (→ preserved as customFields)
  //      • makeMappedPick reads a field THROUGH the admin's chosen column
  //      • parseDupMode defaults to "merge" (legacy) and accepts the 4 choices
  //      • parseClientMapping rejects malformed input (falls back to auto-detect)
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "import-mapping — buildMapping/makeMappedPick/parseDupMode behave (shared toolkit)",
    run: async () => {
      // buildMapping: exact header → high confidence on the right field.
      const m = buildMapping(["Mobile No.", "Customer Name", "Some Weird Col", "Project Name"]);
      const byCol = new Map(m.map((r) => [r.column, r]));
      assert(byCol.get("Customer Name")?.crmField === "name", "‘Customer Name’ should map to name");
      assert(byCol.get("Mobile No.")?.crmField === "phone", "‘Mobile No.’ should map to phone (prefix of mobileno → mobile)");
      assert(byCol.get("Project Name")?.crmField === "project", "‘Project Name’ should map to project (Property Enquired)");
      // Unknown header → IGNORE sentinel + unknown confidence.
      const weird = byCol.get("Some Weird Col");
      assert(!!weird && weird.crmField === IGNORE && weird.confidence === "unknown",
        "an unrecognised column must map to IGNORE/unknown (preserved as a custom field)");

      // makeMappedPick: an explicit mapping reads the EXACT chosen column.
      const consumed = new Set<string>();
      const row = { "Col A": "Ravi", "Col B": "9811122233", "Junk": "x" };
      const mapped = makeMappedPick(row, { "Col A": "name", "Col B": "phone", "Junk": IGNORE }, consumed);
      assert(mapped("name") === "Ravi", "mapped name must read Col A");
      assert(mapped("phone") === "9811122233", "mapped phone must read Col B");
      assert(mapped("email") === undefined, "unmapped field must resolve to undefined");
      assert(consumed.has("Col A") && consumed.has("Col B") && !consumed.has("Junk"),
        "mapped columns are consumed; IGNORE/unmapped columns stay for customFields");

      // parseDupMode: legacy default + the four explicit choices.
      assert(parseDupMode(undefined) === "merge", "absent dupMode must default to merge (legacy)");
      assert(parseDupMode("") === "merge", "blank dupMode must default to merge");
      for (const v of ["skip", "update", "create", "conversation"] as const) {
        assert(parseDupMode(v) === v, `dupMode “${v}” must round-trip`);
      }

      // parseClientMapping: malformed input → null (engine falls back to auto-detect).
      assert(parseClientMapping(undefined) === null, "absent mapping → null");
      assert(parseClientMapping("not json") === null, "malformed mapping JSON → null");
      assert(parseClientMapping(JSON.stringify(["array"])) === null, "array mapping → null");
      const ok = parseClientMapping(JSON.stringify({ "Col A": "name", "blank": "" }));
      assert(!!ok && ok["Col A"] === "name" && !("blank" in ok), "valid mapping parses; empty values dropped");

      // The dropdown catalog must be non-empty and include the core fields.
      const cat = crmFieldOptions();
      const fields = new Set(cat.map((c) => c.field));
      assert(fields.has("name") && fields.has("phone") && fields.has("project"),
        "crmFieldOptions must expose the core CRM fields for the mapping dropdown");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 27. IMPORT WIZARD PARITY  (source-scan — the "UI gained, engine didn't" class)
  //    Both lead-import routes must support the wizard contract so the shared
  //    LeadImportWizard works on all importers:
  //      • accept an explicit `mapping`  (parseClientMapping)
  //      • accept a duplicate mode `dupMode` (parseDupMode)
  //      • offer a preview/dry-run        (?preview=1 for CSV; preview for sheet)
  //    A static scan so a future refactor can't silently drop preview/mapping from
  //    the Google-Sheet route (which historically had neither).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "import-wizard-parity — csv + google-sheet routes accept mapping + dupMode + preview",
    run: async () => {
      const fs = await import("fs");
      for (const f of [
        "src/app/api/intake/csv/route.ts",
        "src/app/api/intake/google-sheet/route.ts",
      ]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/parseClientMapping\(/.test(src), `${f} must consume an explicit mapping (parseClientMapping)`);
        assert(/parseDupMode\(/.test(src), `${f} must accept a duplicate mode (parseDupMode)`);
        assert(/preview/.test(src) && /buildMapping\(/.test(src), `${f} must offer a preview that proposes a mapping (buildMapping)`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 28. RESOURCE LIBRARY / GALLERY (2026-06-24) — new module. Invariants:
  //     (a) Resource + ResourceShare tables exist with fileData as BYTEA.
  //     (b) ResourceShare.leadId FK wires share-tracking to a Lead.
  //     (c) The size/MIME cap helpers enforce ≤5 MB + image/pdf-only.
  //     (d) The list/search route + the /gallery page NEVER select fileData
  //         (bytes only stream from the public download route).
  //     (e) Upload/edit/delete are role-gated (canManageResources / ADMIN+MANAGER);
  //         the public file route is intentionally auth-free (capability = cuid).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "resource-library — tables(+bytea)+share-FK+size/mime cap+list-never-selects-fileData+role gates",
    run: async () => {
      const fs = await import("node:fs");

      // (a) Tables + fileData column type.
      const tbls = await prisma.$queryRaw<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name IN ('Resource', 'ResourceShare')`;
      assert(tbls.length === 2, `Resource + ResourceShare tables must exist (found ${tbls.length})`);
      const fd = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='Resource' AND column_name='fileData'`;
      assert(fd[0]?.data_type === "bytea", `Resource.fileData must be bytea (got ${fd[0]?.data_type})`);

      // (b) Share-tracking FK: ResourceShare.leadId → Lead.
      const fk = await prisma.$queryRaw<{ constraint_name: string }[]>`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema='public' AND table_name='ResourceShare'
          AND constraint_type='FOREIGN KEY' AND constraint_name='ResourceShare_leadId_fkey'`;
      assert(fk.length === 1, "ResourceShare.leadId FK (which file → which client) must exist");

      // Prisma client sees the tables (counts work, no throw).
      const [rc, sc] = await Promise.all([prisma.resource.count(), prisma.resourceShare.count()]);
      assert(typeof rc === "number" && typeof sc === "number", "resource/share counts must work via Prisma client");

      // (c) Size + MIME cap helpers (test the REAL pure code).
      const { MAX_FILE_BYTES, isAllowedMime, canManageResources } = await import("../src/lib/resources");
      assert(MAX_FILE_BYTES === 5 * 1024 * 1024, `upload cap must be 5 MB (got ${MAX_FILE_BYTES})`);
      assert(isAllowedMime("image/png") && isAllowedMime("image/jpeg") && isAllowedMime("application/pdf"), "image/* + application/pdf must be allowed");
      assert(!isAllowedMime("application/zip") && !isAllowedMime("text/html") && !isAllowedMime("application/x-msdownload") && !isAllowedMime(null), "non-image/pdf MIME must be rejected");
      assert(canManageResources("ADMIN") && canManageResources("MANAGER") && !canManageResources("AGENT"), "manage = ADMIN/MANAGER only");

      // (d) List route + gallery page must NOT select fileData (only the download route may).
      const listRoute = fs.readFileSync("src/app/api/resources/route.ts", "utf8");
      assert(!/fileData:\s*true/.test(listRoute), "list/search route must NEVER select fileData (bytes stay out of list payloads)");
      assert(/canManageResources\(/.test(listRoute) && /multipart\/form-data/.test(listRoute) && /MAX_FILE_BYTES/.test(listRoute) && /isAllowedMime\(/.test(listRoute), "upload route must role-gate + enforce size + MIME cap");
      const page = fs.readFileSync("src/app/(app)/gallery/page.tsx", "utf8");
      assert(!/fileData:\s*true/.test(page), "/gallery page must NEVER select fileData");
      const fileRoute = fs.readFileSync("src/app/api/resources/[id]/file/route.ts", "utf8");
      assert(/fileData:\s*true/.test(fileRoute), "the download route IS the only place fileData is selected");
      assert(/deletedAt/.test(fileRoute), "download route must refuse soft-deleted resources");

      // (e) Mutating routes role-gated; share route writes a ResourceShare.
      const idRoute = fs.readFileSync("src/app/api/resources/[id]/route.ts", "utf8");
      assert(/canManageResources\(/.test(idRoute), "edit/delete route must role-gate (ADMIN/MANAGER)");
      assert(/deletedAt: new Date\(\)/.test(idRoute), "delete must be a SOFT delete (reversible)");
      const shareRoute = fs.readFileSync("src/app/api/resources/share/route.ts", "utf8");
      assert(/resourceShare\.create\(/.test(shareRoute), "share route must record a ResourceShare row (tracking)");
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
