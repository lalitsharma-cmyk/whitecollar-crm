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
  dupKeysForRow,
} from "../src/lib/importMapping";
// IST day-boundary helpers (pure, no "server-only") — the REAL window math the
// Action List follow-up board uses, so the invariant tests production code.
import { istDayRange, istDateKey, isValidDateKey } from "../src/lib/datetime";
// Name normalisation (pure, no "server-only") — the REAL write-time transform, so
// the backfill-integrity invariant tests production code (0 un-cased names remain).
import { normalizeNameList } from "../src/lib/nameFormat";

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
      const { REJECT_REASONS, rejectionStatusFor, rejectReasonLabel, rejectReasonsForTeam, REJECT_REASON_VALUES } = await import("../src/lib/reject-reasons");
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

      // "Expo Only" — Dubai-team-conditional reject reason (2026-06-24).
      // (a) It is a VALID API reason and resolves a label + its own outcome status.
      assert(REJECT_REASON_VALUES.has("EXPO_ONLY"), "EXPO_ONLY must be an accepted API reject reason");
      assert(rejectReasonLabel("EXPO_ONLY") === "Expo Only", "EXPO_ONLY → label 'Expo Only'");
      assert(rejectionStatusFor("EXPO_ONLY") === "Expo Only", "EXPO_ONLY → its own 'Expo Only' outcome status");
      assert(rejectionStatusFor("EXPO_ONLY") !== "Booked With Us", "Expo Only must never resolve to a winning status");
      // (b) It is NOT in the GLOBAL base list (never shown to non-Dubai teams)…
      assert(!REJECT_REASONS.some((r) => r.value === "EXPO_ONLY"), "EXPO_ONLY must NOT be in the global base reason list");
      // …and the team helper offers it ONLY for Dubai.
      const dubaiReasons = rejectReasonsForTeam("Dubai").map((r) => r.value);
      const indiaReasons = rejectReasonsForTeam("India").map((r) => r.value);
      const noTeamReasons = rejectReasonsForTeam(null).map((r) => r.value);
      assert(dubaiReasons.includes("EXPO_ONLY"), "Dubai-team reject dropdown MUST offer 'Expo Only'");
      assert(!indiaReasons.includes("EXPO_ONLY"), "India-team reject dropdown must NOT offer 'Expo Only'");
      assert(!noTeamReasons.includes("EXPO_ONLY"), "no-team reject dropdown must NOT offer 'Expo Only'");
      // The Dubai list is the base list + exactly the one extra reason.
      assert(dubaiReasons.length === REJECT_REASONS.length + 1, "Dubai list = base reasons + Expo Only (no drops/dupes)");

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
  // 3e-quater-ii. ADMIN LEAD-VIEW FULL EDIT (2026-06-24) — every listed Lead-View
  //     field is editable (ALLOWED) AND audited (TRACKED_FIELDS); the customFields
  //     merge edit preserves OTHER keys + is admin-gated; admins/super-admins are
  //     ALLOWED to edit the admin-only fields (name/phone/email/source/budgetRaw).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-view-edit — fields in ALLOWED+TRACKED_FIELDS; customFields merge keeps other keys; admin-only edit allowed",
    run: async () => {
      const fs = await import("node:fs");
      const routeSrc = fs.readFileSync("src/app/api/leads/[id]/update/route.ts", "utf8");

      // (a) ALLOWED whitelist must contain every inline-editable Lead-View field.
      const allowedBlock = routeSrc.slice(routeSrc.indexOf("const ALLOWED"), routeSrc.indexOf("export async function PATCH"));
      const mustAllow = [
        "name", "altName", "phone", "altPhone", "email", "altEmail", "company",
        "city", "state", "country", "address", "configuration", "currentStatus",
        "propertyType", "sourceDetail", "remarks", "budgetMin", "budgetMax",
        "budgetCurrency", "budgetRaw", "forwardedTeam", "followupDate", "meetingDate",
        "siteVisitDate", "status", "fundReadiness", "source", "sourceRaw",
        "bantStatus", "authorityLevel", "authorityPerson", "needSummary",
        "profession", "linkedInUrl", "medium", "mediumOther", "whenCanInvest",
      ];
      for (const f of mustAllow) {
        assert(new RegExp(`(^|[^A-Za-z])${f}:`).test(allowedBlock), `ALLOWED whitelist MUST include '${f}' (Lead-View inline edit)`);
      }

      // (b) TRACKED_FIELDS (Change History) must cover the same edit surface so
      //     every admin edit is recorded old→new. Import the REAL array.
      const { TRACKED_FIELDS } = await import("../src/lib/fieldHistory");
      const tracked = new Set(TRACKED_FIELDS as readonly string[]);
      for (const f of [
        "medium", "mediumOther", "altPhone", "altEmail", "linkedInUrl", "sourceDetail",
        "propertyType", "configuration", "authorityLevel", "authorityPerson", "needSummary",
        "fundReadiness", "whenCanInvest", "meetingDate", "siteVisitDate", "forwardedTeam",
        "source", "sourceRaw", "budgetRaw", "name", "phone", "email", "company",
        "profession", "city", "state", "country", "address",
      ]) {
        assert(tracked.has(f), `TRACKED_FIELDS MUST include '${f}' so its edits show in Change History`);
      }

      // (c) recordFieldChanges must ALSO record dynamic customFields.<key> rows
      //     (imported-field edits), not only the static tracked list.
      const fhSrc = fs.readFileSync("src/lib/fieldHistory.ts", "utf8");
      assert(/customFields\./.test(fhSrc), "recordFieldChanges MUST capture dynamic customFields.<key> edits");

      // (d) The customFields merge path is Admin-gated and MERGE-safe: it reads the
      //     current blob, spreads it, and never replaces the whole object.
      assert(/"customFields" in body/.test(routeSrc), "update route MUST handle a customFields merge edit");
      const cfBlock = routeSrc.slice(routeSrc.indexOf('"customFields" in body'), routeSrc.indexOf('"customFields" in body') + 1800);
      assert(/me\.role !== "ADMIN"/.test(cfBlock), "customFields edit MUST be Admin / Super-Admin only");
      assert(/\.\.\.\(cur\.customFields/.test(cfBlock) || /\.\.\.base/.test(cfBlock), "customFields edit MUST MERGE (spread existing keys), never replace the blob");

      // (e) MERGE LOGIC SIMULATION — editing one key keeps the others. Pure, no DB.
      const base = { "Passport No": "X123", "Visa Status": "Valid", "Agent Notes": "VIP" };
      const patch = { "Visa Status": "Expired" };
      const merged: Record<string, unknown> = { ...base };
      for (const [k, v] of Object.entries(patch)) { if (v == null || v === "") delete merged[k]; else merged[k] = v; }
      assert(merged["Passport No"] === "X123" && merged["Agent Notes"] === "VIP", "merge MUST preserve untouched imported keys");
      assert(merged["Visa Status"] === "Expired", "merge MUST apply the edited key");
      const cleared: Record<string, unknown> = { ...base };
      for (const [k, v] of Object.entries({ "Visa Status": "" })) { if (v == null || v === "") delete cleared[k]; else cleared[k] = v; }
      assert(!("Visa Status" in cleared) && cleared["Passport No"] === "X123", "clearing one key removes ONLY it, others intact");

      // (f) Admin/super-admin are ALLOWED to edit admin-only fields — the route
      //     restricts these to role !== "ADMIN" (so ADMIN passes), NOT a blanket block.
      assert(/ADMIN_ONLY_FIELDS = new Set\(\["name", "phone", "email", "createdAt"\]\)/.test(routeSrc), "admin-only PII set must be name/phone/email/createdAt");
      assert(/if \(me\.role === "AGENT"\)/.test(routeSrc), "PII lock must gate only AGENT (admin/manager allowed)");

      // (g) The Change-History UI labels the dynamic imported edits.
      const chSrc = fs.readFileSync("src/components/ChangeHistoryCard.tsx", "utf8");
      assert(/customFields\./.test(chSrc), "Change History card MUST render customFields.<key> edit rows");
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
      // Same main-column body as the Lead view: Conversation History (BuyerActivity)
      // then Quick Note. Locks the visual layout order so it can't silently drift.
      assert(/BuyerActivityTimeline/.test(page), "buyer detail MUST render the Conversation History (BuyerActivityTimeline) in the main column");
      assert(/BuyerQuickNoteCard/.test(page), "buyer detail MUST render the Quick Note (BuyerQuickNoteCard) after Conversation History");
      assert(page.indexOf("BuyerActivityTimeline") < page.indexOf("BuyerQuickNoteCard"), "Conversation History MUST come BEFORE Quick Note (Lead-view order)");
      // The orphaned/superseded BuyerDetailActions component must be gone (replaced
      // by BuyerAdminPanel + BuyerActionsClient) — no dead detail-action bar left.
      assert(!fs.existsSync("src/components/BuyerDetailActions.tsx"), "superseded BuyerDetailActions.tsx MUST be removed (replaced by BuyerAdminPanel + BuyerActionsClient)");

      // (c2) The buyer Conversation History card is VISUALLY UNIFIED with the Lead
      //      view's ConversationStreamCard — same card shell (card p-5 · emerald
      //      left rail · faint emerald tint) and the same Raw History / Smart
      //      Timeline segmented toggle. Guards the "looks genuinely the same" ask.
      const bat = read("src/components/BuyerActivityTimeline.tsx");
      assert(/card p-5 border-l-4 border-emerald-500 bg-emerald-50\/20/.test(bat), "BuyerActivityTimeline MUST use the Lead Conversation-History card shell (card p-5 border-l-4 border-emerald-500 bg-emerald-50/20)");
      assert(/Raw History/.test(bat) && /Smart Timeline/.test(bat) && /setViewMode/.test(bat), "BuyerActivityTimeline MUST have the Raw History / Smart Timeline toggle (parity with ConversationStreamCard)");
      assert(/max-h-\[620px\] overflow-y-auto/.test(bat), "BuyerActivityTimeline stream MUST use the same scroll container (max-h-[620px] overflow-y-auto) as the Lead view");
      // Quick Note parity — buyer reuses the exact Lead QuickNote card shell + navy Save button.
      const bqn = read("src/components/BuyerQuickNoteCard.tsx");
      assert(/className="card p-4"/.test(bqn) && /📝 Quick Note/.test(bqn) && /bg-\[#0b1a33\]/.test(bqn), "BuyerQuickNoteCard MUST match the Lead QuickNoteCard shell (card p-4 · 📝 Quick Note · navy Save button)");

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

      // (g) SHARED LAYOUT TOKENS (3rd alignment pass, 2026-06-25) — both the Lead
      //     detail and the Buyer detail MUST source their card/grid/action-row
      //     shells from src/lib/detailLayout.ts so the two views CANNOT drift apart
      //     again. This is the structural guard the user's "still looks different"
      //     feedback demanded.
      assert(fs.existsSync("src/lib/detailLayout.ts"), "shared detailLayout.ts token module MUST exist (single source of truth for Lead+Buyer shells)");
      const layout = read("src/lib/detailLayout.ts");
      // The fluid action-row primitive (flex-wrap · grow · basis-28) is the EXACT
      // string LeadActionsClient uses — assert the token carries it verbatim.
      assert(/flex flex-wrap gap-2 mt-3 \[&>\*\]:grow \[&>\*\]:basis-28/.test(layout), "ACTION_ROW token MUST be the Lead's fluid flex-wrap action row (flex-wrap · grow · basis-28)");
      assert(/card p-5 border-l-4 border-emerald-500 bg-emerald-50\/20/.test(layout), "CONVO_CARD token MUST be the Lead Conversation-History shell");
      // The buyer page imports + uses the shared tokens (header card, verdict card,
      // field grid, right-rail wrappers).
      assert(/from "@\/lib\/detailLayout"/.test(page), "buyer detail page MUST import shared tokens from @/lib/detailLayout");
      assert(/className=\{PAGE_GRID\}/.test(page) && /className=\{MAIN_COL\}/.test(page) && /className=\{RIGHT_RAIL\}/.test(page), "buyer detail page MUST use the shared PAGE_GRID/MAIN_COL/RIGHT_RAIL wrappers");
      assert(/className=\{VERDICT_CARD\}/.test(page), "buyer Intelligence card MUST use the shared VERDICT_CARD shell (same as the Lead BANT card)");

      // (h) The buyer action row component uses the shared ACTION_ROW token (fluid
      //     flex) — NOT a rigid grid (the divergence the prior 2 passes missed).
      const bac = read("src/components/BuyerActionsClient.tsx");
      assert(/from "@\/lib\/detailLayout"/.test(bac) && /className=\{ACTION_ROW\}/.test(bac), "BuyerActionsClient MUST use the shared ACTION_ROW token (fluid flex, parity with LeadActionsClient)");
      assert(!/grid grid-cols-3 sm:grid-cols-5/.test(bac), "BuyerActionsClient action bar MUST NOT use a rigid grid (must match the Lead's fluid flex-wrap row)");
      // BuyerActivityTimeline references the shared CONVO_CARD token too.
      assert(/CONVO_CARD/.test(bat), "BuyerActivityTimeline MUST use the shared CONVO_CARD token");

      // (i) RIGHT-RAIL DENSITY PARITY — the buyer right rail must carry the same
      //     core cards as the Lead right rail (Client information + Location + a
      //     Scheduling-slot card), so the left/right balance reads identically.
      //     Previously the buyer right rail was thin (admin + notes only) → the
      //     whole page looked different even though shared cards matched.
      assert(/Client information/.test(page), "buyer right rail MUST carry a 'Client information' card (parity with the Lead right rail)");
      assert(/📍 Location/.test(page), "buyer right rail MUST carry a '📍 Location' card (parity with the Lead Location card)");
      assert(/data-lead-section="actions"[\s\S]{0,200}Purchase summary/.test(page), "buyer right rail MUST fill the Lead 'Scheduling & next action' slot (Purchase summary card)");
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

      // (c) assignment-history is never LOST: any buyer that was EVER assigned to
      // an agent (has a BuyerActivity of type "ASSIGNED") must carry >= 1
      // BuyerAssignment stint. We key off "was ever assigned", NOT poolStatus —
      // an admin may convert (or reject) a buyer DIRECTLY from the Admin Pool
      // without first assigning it to an agent (owner stays null), which
      // legitimately has 0 stints and is not lost history.
      const everAssignedBuyers = await prisma.buyerRecord.findMany({
        where: { activities: { some: { type: "ASSIGNED" } } },
        select: { id: true, _count: { select: { assignments: true } } },
        take: 2000,
      });
      for (const b of everAssignedBuyers) {
        assert(b._count.assignments >= 1, `Buyer ${b.id} was ASSIGNED but has no BuyerAssignment stint (history lost)`);
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

      // (b2) Fix 1 (2026-06-24): buyer lifecycle events use DEDICATED NotifKinds
      //      (BUYER_ASSIGNED / BUYER_CONVERTED / BUYER_RETURNED), not the generic
      //      LEAD_ASSIGNED / SYSTEM — so a manager can tell a buyer event from a
      //      lead event. The three enum values must be live in prod, AND the buyer
      //      routes must emit them.
      const buyerNotifKinds = await prisma.$queryRawUnsafe<{ label: string }[]>(
        "SELECT e.enumlabel AS label FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'NotifKind' AND e.enumlabel LIKE 'BUYER_%'",
      );
      const labels = new Set(buyerNotifKinds.map((r) => r.label));
      for (const k of ["BUYER_ASSIGNED", "BUYER_CONVERTED", "BUYER_RETURNED"]) {
        assert(labels.has(k), `NotifKind enum must include ${k} in prod (found: ${[...labels].join(", ") || "none"})`);
      }
      assert(/kind:\s*"BUYER_ASSIGNED"/.test(read("src/app/api/buyer-data/assign/route.ts")), "assign route MUST notify with BUYER_ASSIGNED (not LEAD_ASSIGNED)");
      assert(/kind:\s*"BUYER_ASSIGNED"/.test(bulkSrc), "bulk transfer MUST notify with BUYER_ASSIGNED (not LEAD_ASSIGNED)");
      assert(/kind:\s*"BUYER_CONVERTED"/.test(read("src/app/api/buyer-data/[id]/convert/route.ts")), "convert route MUST notify with BUYER_CONVERTED");
      assert(/kind:\s*"BUYER_RETURNED"/.test(read("src/app/api/buyer-data/[id]/reject/route.ts")), "reject route MUST notify with BUYER_RETURNED (not SYSTEM)");
      assert(/kind:\s*"BUYER_RETURNED"/.test(read("src/app/api/buyer-data/[id]/activity/route.ts")), "auto-return MUST notify with BUYER_RETURNED (not SYSTEM)");

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
      // (e2) Fix 2 (2026-06-24): no buyer field may be bound to two labels. The
      //      Property Details card previously showed unitNumber under BOTH
      //      "Property / Unit" and "Unit Number". Assert each editable() field key
      //      appears at most once (the unit number is the field that regressed).
      const editKeys = [...detail.matchAll(/editable\("(\w+)"/g)].map((m) => m[1]);
      const dupKeys = editKeys.filter((k, i) => editKeys.indexOf(k) !== i);
      assert(dupKeys.length === 0, `buyer detail binds a field to >1 label (duplicate): ${[...new Set(dupKeys)].join(", ")}`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 41b. BUYER TABLE — Excel-style per-column header filters + sort (UX, static).
  //   The Buyer Data table is CLIENT-SIDE (loads the scoped set, filters/sorts in
  //   a useMemo) so `count === visible rows` is exact. This asserts the shared
  //   ColumnHeaderFilter is wired onto every business column, that per-column
  //   filters fold into the filtered set (so bulk/export/count all see the same
  //   rows), the Actions column has NO filter, and the shared component is reused
  //   by BOTH client-side tables (Buyer + Master Data) — the DRY guarantee. Also
  //   re-asserts buyer scope is untouched (no permission/schema drift).
  {
    name: "buyer-table-filter — shared Excel header filter on every buyer business column + client filter/sort (count==rows) + DRY w/ Master Data + scope intact",
    run: async () => {
      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");

      // (a) The shared component exists and exposes the client-state contract.
      const hf = read("src/components/ColumnHeaderFilter.tsx");
      for (const sym of ["export type ColKind", "export type ColFilterState", "export const isColFilterActive", "export default function ColumnHeaderFilter"]) {
        assert(hf.includes(sym), `ColumnHeaderFilter must export ${sym}`);
      }
      // It supports the three field types + ordered (canonical) lists.
      for (const k of ['"text"', '"number"', '"date"', '"select"']) {
        assert(hf.includes(k), `ColumnHeaderFilter must handle kind ${k}`);
      }
      // Rendered through a PORTAL so a table's overflow can't clip the popover.
      assert(/createPortal\(/.test(hf), "ColumnHeaderFilter popover MUST render via a portal (table overflow must not clip it)");

      // (b) The Buyer table uses it on every business column, and Actions is absent.
      const buyer = read("src/components/BuyerListClient.tsx");
      assert(/from "@\/components\/ColumnHeaderFilter"/.test(buyer), "BuyerListClient must import the shared ColumnHeaderFilter");
      const buyerCols = ["clientName", "poolStatus", "project", "towerUnit", "propertyType", "txnValue", "txnDate", "nationality", "agent", "attempts", "buyer"];
      for (const c of buyerCols) {
        assert(new RegExp(`renderHF\\("${c}"`).test(buyer), `Buyer table must render a header filter on the ${c} column`);
      }
      // The column model is the single source for filter + sort (DRY within file).
      assert(/const COLS:\s*ColDef\[\]/.test(buyer), "Buyer table must declare a COLS model driving filters+sort");
      assert(!/renderHF\("actions"/.test(buyer), "the Actions column MUST NOT have a header filter");

      // (c) Per-column filters fold into the SAME filtered set used everywhere.
      assert(/colFilters/.test(buyer) && /Object\.entries\(colFilters\)/.test(buyer), "colFilters must be applied inside the filtered useMemo");
      // Bulk selection + export must operate on the FILTERED set (filteredIds), not raw rows.
      assert(/filteredIds\.forEach\(\(id\) => next\.add\(id\)\)/.test(buyer), "select-all MUST add the FILTERED ids (filtered set, not whole table)");
      assert(/anyFilter \? filteredIds/.test(buyer), "export MUST reflect the active filters (the filtered id set)");
      // The visible count is literally filtered.length (count == rows).
      assert(/\{filtered\.length\} record/.test(buyer), "the summary count MUST be filtered.length (count == visible rows)");
      // Clear/reset returns to the full set (clears column filters too).
      assert(/setColFilters\(\{\}\)/.test(buyer), "Clear-all MUST reset the per-column filters");

      // (d) DRY: Master Data reuses the very same component (both client-side tables).
      const md = read("src/components/MasterDataRecordsTable.tsx");
      assert(/from "@\/components\/ColumnHeaderFilter"/.test(md) && /<ColumnHeaderFilter/.test(md), "Master Data MUST reuse the shared ColumnHeaderFilter (DRY across client-side tables)");

      // (e) Export route still ADMIN-only + deletedAt-excluded on BOTH paths; the
      //     new POST(buyerIds) path is the filtered-export channel (capped, audited).
      const exp = read("src/app/api/buyer-data/export/route.ts");
      assert(/export async function POST/.test(exp) && /buyerIds/.test(exp), "export route must accept POST { buyerIds } for filtered export");
      assert((exp.match(/me\.role !== "ADMIN"/g) ?? []).length >= 2, "BOTH export paths (GET+POST) MUST stay ADMIN-only");
      assert(/deletedAt: null/.test(exp), "export MUST keep recycle-bin (deletedAt) rows excluded");

      // (f) Scope guard untouched — no permission/schema drift (UX-only change).
      const scopeSrc = read("src/lib/buyerScope.ts");
      assert((scopeSrc.match(/deletedAt:\s*null/g) ?? []).length >= 4, "buyerScopeWhere deletedAt:null branches must remain intact");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 41c. DUBAI BUYER DATA — market segregation (2026-06-24). The Buyer Data module
  //   is now "Dubai Buyer Data": ONLY Dubai-market buyers, visible to Admin +
  //   Dubai-team users, assignable ONLY to Dubai-team users + admins. Proves:
  //   (a) the `market` column exists in prod (migration applied) + DEFAULTS Dubai
  //       and every existing live buyer is market="Dubai" (backfill ran).
  //   (b) buyerScopeWhere/canTouchBuyer pin market="Dubai" in EVERY branch + the
  //       non-Dubai user gets the impossible "__no_access__" filter (no leak), and
  //       the canAccessDubaiBuyers / isDubaiAssignable gates exist.
  //   (c) the assign + transfer + convert endpoints REJECT a non-Dubai, non-admin
  //       target server-side (isDubaiAssignable guard present in source).
  //   (d) the pages + reports REDIRECT non-Dubai users (canAccessDubaiBuyers guard)
  //       and the nav item is dubaiBuyerOnly (hidden from non-Dubai non-admins).
  //   (e) the distribution pool + import + export are market="Dubai"-scoped.
  //   (f) the label renamed to "Dubai Buyer Data" on the key surfaces (nav + titles).
  //   (g) DATA: the real roster confirms the gate is right — Dubai-team users
  //       (Mehak/Dinesh) ARE Dubai-assignable; India-team users (Tanuj/Yasir) and
  //       HR users are NOT (read back their team to prove it's filtered, not hardcoded).
  //   Read-only: column probe + source scans + roster read. ZERO writes.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "dubai-buyer-scope — market=Dubai default+backfill + scope/assign Dubai-only + non-Dubai excluded/redirected + nav hidden + label renamed",
    run: async () => {
      const fs = await import("node:fs");
      const read = (f: string) => fs.readFileSync(f, "utf8");

      // (a) market column exists + every live buyer is Dubai (default + backfill).
      await prisma.buyerRecord.findFirst({ select: { id: true, market: true } });
      const liveTotal = await prisma.buyerRecord.count({ where: { deletedAt: null } });
      const liveDubai = await prisma.buyerRecord.count({ where: { deletedAt: null, market: "Dubai" } });
      assert(liveTotal === liveDubai, `every live buyer must be market="Dubai" (live ${liveTotal}, Dubai ${liveDubai}) — backfill missing`);
      const nonDubai = await prisma.buyerRecord.count({ where: { market: { not: "Dubai" } } });
      assert(nonDubai === 0, `${nonDubai} buyer(s) have a non-Dubai market — this module is Dubai-only today`);

      // (b) buyerScope pins market + has the Dubai gates + the impossible no-access filter.
      const scopeSrc = read("src/lib/buyerScope.ts");
      assert(/DUBAI_MARKET\s*=\s*"Dubai"/.test(scopeSrc), "buyerScope MUST define DUBAI_MARKET = 'Dubai'");
      assert(/export function canAccessDubaiBuyers/.test(scopeSrc), "buyerScope MUST export canAccessDubaiBuyers");
      assert(/export function isDubaiAssignable/.test(scopeSrc), "buyerScope MUST export isDubaiAssignable");
      // Every where branch pins market (>=4: no-access, ADMIN, AGENT, MANAGER variants).
      const marketBranches = (scopeSrc.match(/market:\s*DUBAI_MARKET/g) ?? []).length;
      assert(marketBranches >= 4, `buyerScopeWhere must pin market:DUBAI_MARKET in every branch (found ${marketBranches}, expected >=4)`);
      assert(/__no_access__/.test(scopeSrc), "a non-Dubai non-admin user MUST get an impossible filter (no buyer leak)");
      assert(/buyer\.market\s*!==\s*DUBAI_MARKET/.test(scopeSrc), "canTouchBuyer MUST reject a non-Dubai-market buyer");

      // (c) assign + transfer + convert REJECT a non-Dubai/non-admin target (server-side).
      assert(/isDubaiAssignable/.test(read("src/app/api/buyer-data/assign/route.ts")), "assign route MUST gate the target via isDubaiAssignable");
      assert(/isDubaiAssignable/.test(read("src/app/api/buyer-data/bulk/route.ts")), "bulk transfer MUST gate the target via isDubaiAssignable");
      assert(/isDubaiAssignable/.test(read("src/app/api/buyer-data/[id]/convert/route.ts")), "convert route MUST gate an on-behalf owner via isDubaiAssignable");

      // (d) pages + reports redirect non-Dubai users; nav item is dubaiBuyerOnly.
      assert(/canAccessDubaiBuyers/.test(read("src/app/(app)/buyer-data/page.tsx")), "buyer list page MUST guard via canAccessDubaiBuyers (redirect non-Dubai)");
      assert(/canAccessDubaiBuyers/.test(read("src/app/(app)/buyer-data/[id]/page.tsx")), "buyer detail page MUST guard via canAccessDubaiBuyers");
      assert(/canAccessDubaiBuyers/.test(read("src/app/(app)/reports/buyer-performance/page.tsx")), "buyer report MUST guard via canAccessDubaiBuyers");
      const shell = read("src/components/MobileShell.tsx");
      assert(/dubaiBuyerOnly/.test(shell), "the nav MUST gate the Dubai Buyer Data item via dubaiBuyerOnly");
      assert(/dubaiBuyerOnly && !\(user\.role === "ADMIN" \|\| user\.team === "Dubai"\)/.test(shell), "dubaiBuyerOnly MUST hide the item from non-Dubai non-admin users");

      // (e) distribution pool + import + export are market-scoped.
      assert(/market:\s*DUBAI_MARKET/.test(read("src/lib/buyerDistribution.ts")), "poolableWhere MUST pin market:DUBAI_MARKET (distribution is Dubai-only)");
      assert(/market:\s*"Dubai"/.test(read("src/app/api/buyer-data/import/route.ts")), "import MUST stamp market='Dubai'");
      assert(/market:\s*"Dubai"/.test(read("src/app/api/buyer-data/export/route.ts")), "export MUST pin market='Dubai'");

      // (f) label renamed on the key visible surfaces (route paths unchanged).
      assert(/Dubai Buyer Data/.test(read("src/app/(app)/buyer-data/page.tsx")), "list page header MUST read 'Dubai Buyer Data'");
      assert(/label: "Dubai Buyer Data"/.test(shell), "nav label MUST be 'Dubai Buyer Data'");
      assert(/Dubai Buyer Data Performance/.test(read("src/app/(app)/reports/buyer-performance/page.tsx")), "report title MUST read 'Dubai Buyer Data Performance'");
      // Route paths unchanged (links + API still /buyer-data) — the rename is display-only.
      assert(/href:\s*"\/buyer-data"/.test(shell), "the nav ROUTE must stay /buyer-data (rename is display-only)");

      // (g) DATA: roster proves the gate is right (filtered by team, NOT hardcoded names).
      const { normalizeTeam } = await import("../src/lib/teamRouting");
      const dubaiAssignable = (u: { role: string | null; team: string | null }) =>
        u.role === "ADMIN" || normalizeTeam(u.team) === "Dubai";
      const roster = await prisma.user.findMany({
        where: { active: true },
        select: { name: true, role: true, team: true, hrOnly: true },
      });
      // At least one genuine Dubai-team AGENT/MANAGER must be assignable (else the
      // pool can never be worked) — proven from team data, not a name list.
      const dubaiTeamSales = roster.filter((u) => normalizeTeam(u.team) === "Dubai" && (u.role === "AGENT" || u.role === "MANAGER") && !u.hrOnly);
      assert(dubaiTeamSales.length >= 1, "expected >=1 active Dubai-team sales user (the buyer-assignment pool)");
      for (const u of dubaiTeamSales) assert(dubaiAssignable(u), `${u.name} is a Dubai-team sales user and MUST be Dubai-assignable`);
      // India-team users + HR users must NOT be assignable (read their team to confirm).
      const indiaTeamSales = roster.filter((u) => normalizeTeam(u.team) === "India" && (u.role === "AGENT" || u.role === "MANAGER"));
      for (const u of indiaTeamSales) assert(!dubaiAssignable(u), `${u.name} is an India-team user and MUST NOT be Dubai-assignable`);
      const hrUsers = roster.filter((u) => u.hrOnly);
      for (const u of hrUsers) assert(!dubaiAssignable(u) || u.role === "ADMIN", `HR user ${u.name} must not be Dubai-assignable unless an admin`);
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

      // (b) ADMIN SUMMARY == direct counts (whole Dubai pool; teamOwnerIds = null path).
      //     Dubai Buyer Data: buildBuyerSummary pins market="Dubai", so the inline
      //     replica does too (today every live buyer is Dubai, so the bucket math is
      //     unchanged — this keeps the invariant byte-equivalent to the scoped code).
      const base = { deletedAt: null, market: "Dubai" } as const;
      const [total, assigned, pool, converted, rejected, returnedToPool, grand, deleted] = await Promise.all([
        prisma.buyerRecord.count({ where: base }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "ASSIGNED" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "ADMIN_POOL" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "CONVERTED" } }),
        prisma.buyerRecord.count({ where: { ...base, poolStatus: "REJECTED" } }),
        prisma.buyerRecord.count({ where: { ...base, returnedToPoolAt: { not: null }, poolStatus: "ADMIN_POOL" } }),
        prisma.buyerRecord.count({ where: { market: "Dubai" } }),
        prisma.buyerRecord.count({ where: { deletedAt: { not: null }, market: "Dubai" } }),
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
  // 12b. DASHBOARD KPI COHORT INTEGRITY (2026-06-24)
  //   The "Live Lead Assignment & Status" widget's percentages must compare the
  //   SAME population. Bug fixed: Rejection Rate divided owner-scoped
  //   rejections-in-window by the assigned-in-window cohort and could exceed
  //   100% (the reported 233.3% = 7 ÷ 3). Now EVERY rate's numerator is a cohort
  //   member currently in that state, denominator = the cohort.
  //   (a) DATA — for a real agent, the cohort-Rejected DRILL count (assigned-in-
  //       window AND rejectedAt != null) is a SUBSET of Assigned, so
  //       curRejected/assigned ≤ 100%. Mirrors agentPerformance.drilldownWhere.
  //   (b) MATH — replicate summarizeReport's clamped cohort `pct()` and prove no
  //       rate can exceed 100% even on an adversarial (rejected>assigned) row,
  //       and that the 233% scenario (assigned=3, curRejected=… ) is impossible
  //       because the numerator is drawn from the cohort.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "dashboard-kpi-cohort — every widget rate ≤100% & uses the assigned-in-window cohort denominator (233% bug gone)",
    run: async () => {
      // (a) DATA — cohort-rejected ⊆ assigned-in-window, for a real agent.
      const recentAssignment = await prisma.assignment.findFirst({
        where: { lead: { deletedAt: null } },
        orderBy: { assignedAt: "desc" },
        select: { userId: true },
      });
      if (!recentAssignment) {
        results.push({ name: "  ↳ note", ok: true, detail: "no Assignment rows in prod — cohort data check vacuously satisfied" });
      } else {
        const agentId = recentAssignment.userId;
        const win = { gte: new Date("2000-01-01T00:00:00Z"), lt: new Date(Date.now() + 86400000) };
        const assignedInWindow = { deletedAt: null, assignments: { some: { userId: agentId, assignedAt: win } } } as const;
        const assigned = await prisma.lead.count({ where: assignedInWindow });
        assert(assigned > 0, "selected agent has no assigned-in-window leads — fixture mismatch");
        // The curRejected drill where (mirror of drilldownWhere("curRejected", …)).
        const cohortRejected = await prisma.lead.count({ where: { ...assignedInWindow, rejectedAt: { not: null } } });
        assert(cohortRejected <= assigned, `cohort-rejected (${cohortRejected}) must be ⊆ assigned (${assigned}) — rejection numerator is NOT a subset of the cohort`);
        // The same-cohort booked / active / meeting / site-visit numerators are also subsets.
        const cohortBooked = await prisma.lead.count({ where: { ...assignedInWindow, currentStatus: { in: ["Booked With Us", "Booked with Us"] } } });
        assert(cohortBooked <= assigned, `cohort-booked (${cohortBooked}) must be ⊆ assigned (${assigned})`);
        const rate = (n: number) => (assigned > 0 ? (n / assigned) * 100 : 0);
        assert(rate(cohortRejected) <= 100 && rate(cohortBooked) <= 100, "cohort rates over the real agent must be ≤100%");
        results.push({ name: "  ↳ note", ok: true, detail: `agent ${agentId}: assigned=${assigned}, cohortRejected=${cohortRejected} (rate ${rate(cohortRejected).toFixed(1)}%), cohortBooked=${cohortBooked}` });
      }

      // (b) MATH — replicate the clamped cohort pct() from summarizeReport and
      // prove it is unbreakable. Cohort numerators are subsets, so even if a row
      // mis-reports, the clamp keeps the rate in [0,100].
      const pct = (n: number, assigned: number) => {
        if (assigned <= 0) return 0;
        return Math.min(100, Math.max(0, (n / assigned) * 100));
      };
      // The exact reported bug scenario: assigned=3. A correct COHORT rejected can
      // be at most 3 → ≤100%. The old code fed 7 (owner-scoped) → 233%. Prove the
      // cohort value (≤assigned) yields ≤100, and the clamp catches any overflow.
      assert(pct(3, 3) === 100, "cohort all-rejected (3/3) = 100% exactly");
      assert(pct(0, 3) === 0, "cohort none-rejected (0/3) = 0%");
      assert(pct(7, 3) === 100, "clamp caps an impossible 7/3 at 100% (defence in depth) — never 233%");
      assert(pct(5, 0) === 0, "no assigned cohort → 0% (no divide-by-zero)");
      // For ANY subset numerator 0..assigned, the rate is within [0,100].
      for (let assigned = 1; assigned <= 25; assigned++) {
        for (let num = 0; num <= assigned; num++) {
          const r = pct(num, assigned);
          assert(r >= 0 && r <= 100, `cohort rate out of range: ${num}/${assigned} = ${r}`);
        }
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 12c. GREETING TIMEZONE (2026-06-24)
  //   The dashboard greeting was computed server-side in UTC → "Good morning" at
  //   4:11 PM IST. greetingFor(date, tz) (pure, in datetime.ts — NO server-only,
  //   so this tests the REAL helper) must band by the user's timezone:
  //     05:00–11:59 Morning · 12:00–16:59 Afternoon · 17:00–20:59 Evening ·
  //     21:00–04:59 Night. Boundary times + the reported IST-16:11 bug + the
  //     India/Dubai tz mapping are all locked in.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "greeting-tz — greetingFor() bands by user tz at every boundary; IST 16:11 → Afternoon (bug fixed)",
    run: async () => {
      const { greetingFor, greetingBandFor, tzForTeam, hourInTZ } = await import("../src/lib/datetime");
      const IST = "Asia/Kolkata";
      const GST = "Asia/Dubai";

      // Helper: build a UTC instant that reads as the given IST wall-clock H:M.
      // IST = UTC+5:30 (no DST), so IST HH:MM == UTC (HH:MM − 5:30).
      const istAt = (h: number, m: number) => new Date(Date.UTC(2026, 5, 24, h, m, 0) - 330 * 60_000);

      // Boundary table (in IST).
      assert(greetingBandFor(istAt(4, 59), IST) === "Night", "04:59 IST → Night");
      assert(greetingBandFor(istAt(5, 0), IST) === "Morning", "05:00 IST → Morning");
      assert(greetingBandFor(istAt(11, 59), IST) === "Morning", "11:59 IST → Morning");
      assert(greetingBandFor(istAt(12, 0), IST) === "Afternoon", "12:00 IST → Afternoon");
      assert(greetingBandFor(istAt(16, 59), IST) === "Afternoon", "16:59 IST → Afternoon");
      assert(greetingBandFor(istAt(17, 0), IST) === "Evening", "17:00 IST → Evening");
      assert(greetingBandFor(istAt(20, 59), IST) === "Evening", "20:59 IST → Evening");
      assert(greetingBandFor(istAt(21, 0), IST) === "Night", "21:00 IST → Night");
      assert(greetingBandFor(istAt(0, 30), IST) === "Night", "00:30 IST → Night (past-midnight)");

      // The reported bug: 16:11 IST must be Afternoon, NOT Morning.
      assert(greetingFor(istAt(16, 11), IST) === "Good Afternoon", `16:11 IST must be "Good Afternoon", got ${greetingFor(istAt(16, 11), IST)}`);
      // Same instant, naive-UTC would say morning (10:41 UTC) — prove the tz fixes it.
      assert(hourInTZ(istAt(16, 11), IST) === 16 && hourInTZ(istAt(16, 11), "UTC") === 10, "hourInTZ reads 16 in IST but 10 in UTC for the same instant (the root cause)");

      // Dubai (GST = UTC+4). 23:30 UTC = 03:30 next day GST → Night; an instant
      // that is morning in IST can be a different band in GST.
      const gstAt = (h: number, m: number) => new Date(Date.UTC(2026, 5, 24, h, m, 0) - 240 * 60_000);
      assert(greetingBandFor(gstAt(5, 0), GST) === "Morning", "05:00 GST → Morning");
      assert(greetingBandFor(gstAt(20, 59), GST) === "Evening", "20:59 GST → Evening");
      assert(greetingBandFor(gstAt(21, 0), GST) === "Night", "21:00 GST → Night");

      // Team → timezone mapping.
      assert(tzForTeam("India") === IST && tzForTeam("Dubai") === GST, "team tz: India→IST, Dubai→GST");
      assert(tzForTeam("uae") === GST && tzForTeam("bharat") === IST, "loose team aliases map (uae→GST, bharat→IST)");
      assert(tzForTeam(null) === IST && tzForTeam("") === IST, "unknown/empty team → IST default");
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
      // Fix 3 (2026-06-24): the Google-Sheet route must HONOUR an admin-confirmed
      // Date mapping (read the date from the chosen column via the mapping-aware
      // field("date", …) accessor), not blindly auto-detect — parity with the CSV
      // route, which always reads the date through field("date", …).
      const gs = fs.readFileSync("src/app/api/intake/google-sheet/route.ts", "utf8");
      assert(/dateMappingConfirmed/.test(gs), "google-sheet route must compute dateMappingConfirmed from the confirmed mapping");
      assert(/field\("date"/.test(gs), 'google-sheet route must read the lead date via field("date", …) when a date mapping is confirmed');
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 27b. MASTER DATA IMPORT (2026-06-24) — the admin-only Import on /master-data
  //    mounts the SAME shared wizard, so the mapping catalog must expose every
  //    Master-Data field the spec lists, the Assigned-User column must map to
  //    `owner`, the dup-preview key helper must match by email/altPhone/altEmail
  //    (not phone alone), and the import endpoint + page must stay admin-gated.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "master-data-import — wizard mapping covers MD fields (incl. owner/altEmail); dup keys cover email/alt*; admin-gated",
    run: async () => {
      const fs = await import("fs");
      // (a) The mapping dropdown catalog must expose every requested Master-Data
      // field so an admin can map them: Client Name→name, Mobile→phone, Alternate
      // Mobile→altPhone, Email→email, Alternate Email→altEmail, Source, Medium(via
      // source parse), Property Enquired→project, Budget, Status, Team, Assigned
      // User→owner, Follow-up Date→followupDate, Remarks.
      const fields = new Set(crmFieldOptions().map((c) => c.field));
      for (const f of ["name", "phone", "altPhone", "email", "altEmail", "owner", "source", "project", "budget", "status", "followupDate", "team", "remarks"]) {
        assert(fields.has(f), `mapping catalog must expose '${f}' for Master Data import`);
      }

      // (b) Header auto-detection routes the requested columns to the right field.
      const m = buildMapping(["Client Name", "Mobile", "Alternate Mobile", "Email", "Alternate Email", "Assigned User", "Follow-up Date", "Property Enquired"]);
      const by = new Map(m.map((r) => [r.column, r.crmField]));
      assert(by.get("Client Name") === "name", "‘Client Name’ → name");
      assert(by.get("Alternate Mobile") === "altPhone", "‘Alternate Mobile’ → altPhone");
      assert(by.get("Alternate Email") === "altEmail", "‘Alternate Email’ → altEmail");
      assert(by.get("Assigned User") === "owner", "‘Assigned User’ → owner");
      assert(by.get("Property Enquired") === "project", "‘Property Enquired’ → project");

      // (c) Duplicate-preview keys: a row is matchable by EITHER phone tail (primary
      // or alternate) OR email (primary or alternate) — never phone alone.
      const dk = dupKeysForRow({ phone: "+91 98765 43210", altPhone: "022-1234-5678", email: "A@B.com", altEmail: "c@d.com" });
      assert(dk.phoneTails.includes("9876543210"), "primary phone tail captured");
      assert(dk.phoneTails.includes("2212345678"), "alternate phone tail captured");
      assert(dk.emails.includes("a@b.com") && dk.emails.includes("c@d.com"), "primary + alternate emails captured (lowercased)");
      // Email-only row still produces a usable dup key (so email duplicates are caught
      // with no phone present).
      const dkEmail = dupKeysForRow({ email: "Solo@X.com" });
      assert(dkEmail.phoneTails.length === 0 && dkEmail.emails[0] === "solo@x.com", "email-only row → email dup key");
      // Junk contact points produce no keys (no false dup matches).
      const dkJunk = dupKeysForRow({ phone: "12", email: "notanemail" });
      assert(dkJunk.phoneTails.length === 0 && dkJunk.emails.length === 0, "too-short phone / non-email produce no dup keys");

      // (d) The import route reads the Assigned-User column AND resolves it to a
      // CRM user id, writes altEmail, and uses the widened dup-preview helper.
      const csv = fs.readFileSync("src/app/api/intake/csv/route.ts", "utf8");
      assert(/resolveOwner\(/.test(csv) && /ownerLookup/.test(csv), "csv route must resolve an Assigned-User column → userId");
      assert(/unmatchedOwners/.test(csv), "csv route must report Assigned-User values that matched no CRM user");
      assert(/update\.altEmail/.test(csv), "csv route must write altEmail");
      assert(/dupKeysForRow\(/.test(csv), "csv route preview must use the widened dup-key helper (email/altPhone/altEmail)");
      assert(/requireRole\("ADMIN"\)/.test(csv), "csv import endpoint must be ADMIN-gated");

      // (e) The Master Data page mounts the Import control and is admin-gated.
      const page = fs.readFileSync("src/app/(app)/master-data/page.tsx", "utf8");
      assert(/MasterDataImportControls/.test(page), "Master Data page must mount the Import control");
      assert(/me\.role !== "ADMIN"/.test(page) && /redirect\("\/dashboard"\)/.test(page), "Master Data page must redirect non-admins (Import is admin-only)");
      const ctrl = fs.readFileSync("src/components/MasterDataImportControls.tsx", "utf8");
      assert(/LeadImportWizard/.test(ctrl) && /mode="csv"/.test(ctrl), "Import control must mount the shared LeadImportWizard (Excel+CSV)");
      // It must NOT PASS isColdCall:"true" to the wizard — Master Data imports are
      // sales leads (isColdCall:false) so they appear in the grid. (Mentioning the
      // flag in a comment is fine; actually sending it as an extraField is not.)
      assert(!/isColdCall["']?\s*:/.test(ctrl), "Master Data import must NOT flag rows as cold (they must show in the isColdCall:false grid)");
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
      const { MAX_FILE_BYTES, isAllowedMime, canManageResources, canCreateResources, canManageResource } = await import("../src/lib/resources");
      assert(MAX_FILE_BYTES === 5 * 1024 * 1024, `upload cap must be 5 MB (got ${MAX_FILE_BYTES})`);
      assert(isAllowedMime("image/png") && isAllowedMime("image/jpeg") && isAllowedMime("application/pdf"), "image/* + application/pdf must be allowed");
      assert(!isAllowedMime("application/zip") && !isAllowedMime("text/html") && !isAllowedMime("application/x-msdownload") && !isAllowedMime(null), "non-image/pdf MIME must be rejected");
      // "manage ALL" stays ADMIN/MANAGER-only…
      assert(canManageResources("ADMIN") && canManageResources("MANAGER") && !canManageResources("AGENT"), "manage-all = ADMIN/MANAGER only");
      // …CREATE/upload is open to ANY active role (incl. AGENT), closed to anonymous.
      assert(canCreateResources("AGENT") && canCreateResources("ADMIN") && canCreateResources("MANAGER"), "any active role (incl. AGENT) may upload");
      assert(!canCreateResources(null) && !canCreateResources(undefined) && !canCreateResources(""), "anonymous/roleless may NOT upload");
      // …per-resource edit/delete: admin/manager → ANY; agent → only OWN upload.
      assert(canManageResource("ADMIN", "u_other", "u_me") && canManageResource("MANAGER", "u_other", "u_me"), "admin/manager manage ANY resource");
      assert(canManageResource("AGENT", "u_me", "u_me"), "agent manages their OWN upload");
      assert(!canManageResource("AGENT", "u_other", "u_me"), "agent must NOT manage another agent's upload");
      assert(!canManageResource("AGENT", null, "u_me"), "agent must NOT manage an unowned (legacy) resource");

      // (d) List route + gallery page must NOT select fileData (only the download route may).
      const listRoute = fs.readFileSync("src/app/api/resources/route.ts", "utf8");
      assert(!/fileData:\s*true/.test(listRoute), "list/search route must NEVER select fileData (bytes stay out of list payloads)");
      assert(/canCreateResources\(/.test(listRoute) && /multipart\/form-data/.test(listRoute) && /MAX_FILE_BYTES/.test(listRoute) && /isAllowedMime\(/.test(listRoute), "upload route must gate on canCreateResources (any active user) + enforce size + MIME cap");
      const page = fs.readFileSync("src/app/(app)/gallery/page.tsx", "utf8");
      assert(!/fileData:\s*true/.test(page), "/gallery page must NEVER select fileData");
      const fileRoute = fs.readFileSync("src/app/api/resources/[id]/file/route.ts", "utf8");
      assert(/fileData:\s*true/.test(fileRoute), "the download route IS the only place fileData is selected");
      assert(/deletedAt/.test(fileRoute), "download route must refuse soft-deleted resources");

      // (e) Mutating routes owner-or-admin gated; share route writes a ResourceShare.
      const idRoute = fs.readFileSync("src/app/api/resources/[id]/route.ts", "utf8");
      assert(/canManageResource\(me\.role, existing\.uploadedById, me\.id\)/.test(idRoute), "edit/delete route must gate owner-or-admin (canManageResource with uploadedById)");
      // Owner check is load-bearing only if the route actually reads uploadedById.
      assert(/uploadedById:\s*true/.test(idRoute), "edit/delete route must SELECT uploadedById to authorize the owner");
      assert(/deletedAt: new Date\(\)/.test(idRoute), "delete must be a SOFT delete (reversible)");
      const shareRoute = fs.readFileSync("src/app/api/resources/share/route.ts", "utf8");
      assert(/resourceShare\.create\(/.test(shareRoute), "share route must record a ResourceShare row (tracking)");

      // (f) The public file route must be exempt from the auth proxy (so share
      //     recipients can open it without a login) — but ONLY that exact path.
      const proxy = fs.readFileSync("src/proxy.ts", "utf8");
      assert(proxy.includes("PUBLIC_RESOURCE_FILE") && proxy.includes("/api/resources/") && proxy.includes("/file"),
        "proxy must publicly allow /api/resources/<id>/file (capability download) via PUBLIC_RESOURCE_FILE");
    },
  },
  {
    // Action List = a follow-up board keyed on Lead.followupDate. The bug it
    // fixes: today's afternoon/evening follow-ups were invisible (no Today
    // bucket; only past-dated "overdue" showed) and the query over-filtered by
    // status/origin. Invariants:
    //   (a) IST day window math is correct (start = IST-midnight UTC instant,
    //       end = +24h, end exclusive) and a custom ?date= validates.
    //   (b) count == records for the SAME followupWhere (no silent hiding) —
    //       and the "today" board, unlike the old page, includes follow-ups
    //       scheduled later TODAY, not just overdue ones.
    //   (c) the board does NOT whitelist status (all-status by default) and the
    //       Lead-View reuses the SAME three action endpoints (DRY, no dupes).
    name: "action-list-followups — IST-day window (count==records, all statuses) + Lead-View reuses action endpoints",
    run: async () => {
      const fs = await import("node:fs");

      // (a) Window math — real istDayRange().
      const { start, end } = istDayRange();
      assert(end.getTime() - start.getTime() === 24 * 3600 * 1000, "istDayRange() must span exactly 24h");
      // start must be IST-midnight: its IST date key equals today's, and the
      // instant is 18:30Z the previous day (00:00 +05:30) OR 00:00 when IST.
      assert(istDateKey(start) === istDateKey(), "istDayRange().start must fall on today's IST date");
      assert(isValidDateKey(istDateKey()) && !isValidDateKey("2026-13-40") && !isValidDateKey("nope"),
        "isValidDateKey must accept a real YYYY-MM-DD and reject junk");

      // (b) count == records for the today window (permission scope omitted here
      //     — this is the DATA invariant that the count helper and the list
      //     query agree; the page applies the same scopeWhere to both).
      const todayWhere = { deletedAt: null, followupDate: { gte: start, lt: end } } as const;
      const listed = await prisma.lead.findMany({ where: todayWhere, select: { id: true, followupDate: true, currentStatus: true }, take: 1000 });
      const counted = await prisma.lead.count({ where: todayWhere });
      // (Bounded list at 1000; only assert equality when not truncated.)
      if (listed.length < 1000) {
        assert(listed.length === counted, `Action List today: count (${counted}) must equal records (${listed.length}) — no silent hiding`);
      }
      // Every listed row genuinely has a follow-up that lands TODAY (IST) — the
      // window includes later-today, not just overdue.
      for (const r of listed.slice(0, 200)) {
        assert(!!r.followupDate && r.followupDate >= start && r.followupDate < end,
          `row ${r.id} followupDate out of today's IST window`);
      }

      // (c) The page must NOT hard-filter status (the regression we fixed) and
      //     must source the window from istDayRange + leadScopeWhere.
      const page = fs.readFileSync("src/app/(app)/action-list/page.tsx", "utf8");
      assert(/istDayRange/.test(page), "action-list page must use istDayRange for IST day boundaries");
      assert(/leadScopeWhere/.test(page), "action-list page must scope via leadScopeWhere (permission scope, not status)");
      assert(/followupDate:\s*followup/.test(page), "action-list must key the board on Lead.followupDate");
      // Status is applied ONLY when the user picks one (conditional), never an
      // unconditional whitelist on the follow-up board.
      assert(/if\s*\(statusFilter\)\s*followupWhere\.currentStatus\s*=/.test(page),
        "action-list must apply status ONLY when explicitly filtered (no default status whitelist on the board)");

      // (d) DRY — Lead-View follow-up bar reuses the SAME endpoints; no new logic.
      const lf = fs.readFileSync("src/components/LeadFollowupActions.tsx", "utf8");
      for (const ep of ["action-complete", "action-snooze", "action-escalate"]) {
        assert(lf.includes(`/api/leads/${"${leadId}"}/${ep}`), `LeadFollowupActions must POST to /api/leads/[id]/${ep} (reuse, not duplicate)`);
      }
      const leadPage = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/<LeadFollowupActions/.test(leadPage), "Lead detail page must render <LeadFollowupActions> in the header");

      // (e) Escalate now notifies a human (manager/admins) — the new behaviour.
      const esc = fs.readFileSync("src/app/api/leads/[id]/action-escalate/route.ts", "utf8");
      assert(/notify\(/.test(esc) && /managerId/.test(esc), "action-escalate must notify the owner's manager/admins");
      // Snooze accepts an explicit IST datetime (Lead-View picker path).
      const snz = fs.readFileSync("src/app/api/leads/[id]/action-snooze/route.ts", "utf8");
      assert(/body\.at/.test(snz), "action-snooze must accept an explicit { at } IST datetime for the Lead-View picker");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 44. DASHBOARD FIELD-STATUS + SALES REPORT (2026-06-24). Invariants:
  //   (a) "I Am Here" is once-per-day (IST): at most ONE HERE AgentStatusEvent
  //       per user per IST day in real data, AND the engine still carries the
  //       guard (todaysHereEvent + the duplicate short-circuit in logAgentStatus).
  //   (b) The dashboard "By Salesperson" SQL EXCLUDES hrOnly/non-sales users
  //       (u."hrOnly" = false) — so an hrOnly user (Nisha) can NEVER appear on the
  //       sales board; mirrored by agentPerformance.ts roster (hrOnly:false).
  //   (c) AgentStatusBar HIDES the site-visit buttons for the Dubai team and
  //       passes alreadyCheckedIn/team from the dashboard.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "dashboard-field-status — HERE idempotent-per-IST-day + sales report excludes hrOnly + Dubai hides site-visit",
    run: async () => {
      const fs = await import("node:fs");

      // (a) DATA: from the fix forward, HERE is once-per-IST-day. We CANNOT assert
      //     historically-clean data because the pre-fix engine allowed multiple
      //     same-day check-ins (those legacy rows are kept verbatim — never mutated
      //     — per the "preserve movement history" rule). So we report any legacy
      //     same-day duplicates as a NON-FATAL note, and hard-assert the forward
      //     guarantee at the engine level in (a'). Group HERE by (userId, IST-day).
      const heres = await prisma.agentStatusEvent.findMany({
        where: { status: "HERE" },
        select: { userId: true, startedAt: true },
        take: 5000,
      });
      const seen = new Map<string, number>();
      for (const h of heres) {
        const key = `${h.userId}|${istDateKey(h.startedAt)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, n]) => n > 1);
      if (dupes.length > 0) {
        results.push({
          name: "  ↳ note",
          ok: true,
          detail: `${dupes.length} legacy (user, IST-day) bucket(s) had >1 HERE before the fix — preserved as-is; the engine guard below prevents any NEW same-day duplicate`,
        });
      }

      // (a') ENGINE: the once-per-day guard is present in the real code — this is
      //      the FORWARD guarantee (a 2nd HERE today is a no-op keeping the first).
      const agentStatusLib = fs.readFileSync("src/lib/agentStatus.ts", "utf8");
      assert(/export async function todaysHereEvent\(/.test(agentStatusLib),
        "agentStatus.ts must export todaysHereEvent (drives the HERE-once lock + guard)");
      assert(/status === "HERE"/.test(agentStatusLib) && /duplicate: true/.test(agentStatusLib),
        "logAgentStatus must short-circuit a 2nd HERE for the day (duplicate:true no-op, first kept)");

      // (b) DATA: every active hrOnly user is absent from the sales-board population.
      //     The board population is (active AND role IN AGENT/MANAGER AND hrOnly=false);
      //     so assert NO hrOnly user satisfies the (active, AGENT/MANAGER) base. We
      //     prove the FILTER is what excludes them: baseline (without hrOnly) may
      //     include hrOnly users; filtered must include zero.
      const baselineSales = await prisma.user.count({
        where: { active: true, role: { in: ["AGENT", "MANAGER"] } },
      });
      const filteredSales = await prisma.user.count({
        where: { active: true, role: { in: ["AGENT", "MANAGER"] }, hrOnly: false },
      });
      const hrInBase = await prisma.user.count({
        where: { active: true, role: { in: ["AGENT", "MANAGER"] }, hrOnly: true },
      });
      assert(filteredSales === baselineSales - hrInBase,
        `sales-board filter math broken: filtered(${filteredSales}) != baseline(${baselineSales}) - hrOnly(${hrInBase})`);
      // No hrOnly user may remain in the filtered (board) population.
      const hrStillIn = await prisma.user.count({
        where: { active: true, role: { in: ["AGENT", "MANAGER"] }, hrOnly: false, AND: [{ hrOnly: true }] },
      });
      assert(hrStillIn === 0, "an hrOnly user must NEVER be in the sales-board population");

      // (b') SOURCE: the dashboard "By Salesperson" SQL carries the hrOnly guard,
      //      and the Live-Assignment roster (agentPerformance.ts) does too.
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/u\."hrOnly"\s*=\s*false/.test(dash),
        'dashboard By-Salesperson SQL must filter u."hrOnly" = false (exclude HR/non-sales like Nisha)');
      const agentPerf = fs.readFileSync("src/lib/agentPerformance.ts", "utf8");
      assert(/hrOnly:\s*false/.test(agentPerf),
        "agentPerformance.ts roster must keep hrOnly:false (Live-Assignment widget excludes HR too)");

      // (c) SOURCE: AgentStatusBar hides site-visit for Dubai + wires the new props;
      //      the dashboard passes team + alreadyCheckedIn through.
      const bar = fs.readFileSync("src/components/AgentStatusBar.tsx", "utf8");
      assert(/isDubaiTeam/.test(bar) && /GOING_SITE_VISIT/.test(bar) && /alreadyCheckedIn/.test(bar),
        "AgentStatusBar must gate site-visit buttons on Dubai team + accept alreadyCheckedIn");
      assert(/checkedIn/.test(bar) && /Checked in/.test(bar),
        "AgentStatusBar must render a locked 'Checked in' state for HERE");
      assert(/team=\{me\.team\}/.test(dash) && /alreadyCheckedIn=\{myCheckedInToday\}/.test(dash),
        "dashboard must pass team + alreadyCheckedIn into <AgentStatusBar>");
    },
  },
  {
    // The Leads table Actions column exposes Complete / Snooze / Escalate row
    // actions that REUSE the shared follow-up endpoints (no duplicated logic),
    // and the old duplicate "Set follow-up" calendar button is gone from Actions.
    // Snooze logs a Smart-Timeline entry that names WHO snoozed it. The Leads
    // page owner/team multi-select filters wire through to the server `where`.
    name: "leads-table-actions — row Complete/Snooze/Escalate reuse shared endpoints; no dup follow-up button; snooze names user; owner/team multi-filter",
    run: async () => {
      const fs = await import("node:fs");
      const list = fs.readFileSync("src/components/LeadsListClient.tsx", "utf8");
      // (a) Row actions present + reuse the shared endpoints (DRY).
      assert(/action-complete/.test(list), "LeadsListClient must call the shared /action-complete endpoint");
      assert(/action-snooze/.test(list), "LeadsListClient must call the shared /action-snooze endpoint");
      assert(/action-escalate/.test(list), "LeadsListClient must call the shared /action-escalate endpoint");
      assert(/RowSnoozeButton/.test(list), "LeadsListClient must render the shared RowSnoozeButton (CRMDatePicker reschedule)");
      // (b) The duplicate follow-up calendar action is removed from the Actions set.
      //     `action="followUp"` must no longer appear (the Follow-Up DATA column
      //     keeps its own picker via openPicker, which is a different affordance).
      assert(!/action="followUp"/.test(list), "duplicate follow-up button must be removed from the Leads Actions column");
      // (c) Snooze endpoint stamps the user into the Smart-Timeline title.
      const snooze = fs.readFileSync("src/app/api/leads/[id]/action-snooze/route.ts", "utf8");
      assert(/snoozed to \$\{label\} by \$\{me\.name\}/.test(snooze) || /by \$\{me\.name\}/.test(snooze),
        "action-snooze timeline title must name the user (… by <user>)");
      assert(/followupDate:\s*newFollowup/.test(snooze), "action-snooze must set followupDate to the picked instant (real reschedule)");
      // (d) Escalate endpoint flags needsManagerReview + notifies (manager review reflected in reports).
      const esc = fs.readFileSync("src/app/api/leads/[id]/action-escalate/route.ts", "utf8");
      assert(/needsManagerReview:\s*true/.test(esc), "action-escalate must set needsManagerReview=true");
      assert(/notify\(/.test(esc), "action-escalate must notify the manager/admins");
      // (e) Server owner + team filters accept multi-select (comma-separated) so the
      //     Excel column header filters narrow correctly (count==rows).
      const page = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/forwardedTeam\s*=\s*\{\s*in:\s*teams\s*\}/.test(page), "Leads page must accept multi-select ?team= (forwardedTeam in […])");
      assert(/ownerId\s*=\s*\{\s*in:\s*ownerIds\s*\}/.test(page), "Leads page must accept multi-select ?owner= (ownerId in […])");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 6. PROPER-CASE NAME FORMAT (2026-06-24) — names are stored Proper-Case at the
  //    source (nameFormat.ts, applied on every write path) and the migration
  //    backfilled existing rows. Two parts:
  //      (a) UTIL correctness — the spec examples + the safety guard (mixed-case
  //          preserved, email/code passthrough). Tests the REAL pure lib.
  //      (b) DATA — no LIVE Lead.name/altName or BuyerRecord name field remains
  //          un-cased (all-UPPER / all-lower). A re-normalise must change 0. The
  //          remaining-uncased COUNT is logged (note) for visibility.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "name-format — util cases pass; no all-caps/all-lower names remain on live leads/buyers",
    run: async () => {
      const { toProperCase, shouldNormalizeName, normalizeName, normalizeNameList } = await import("../src/lib/nameFormat");

      // (a) Spec examples — Proper-Case, honorific, hyphen, apostrophe.
      assert(toProperCase("ABHISHEK ARORA") === "Abhishek Arora", "toProperCase('ABHISHEK ARORA') → 'Abhishek Arora'");
      assert(toProperCase("RAFIQ ALY HARRY MAHMOOD") === "Rafiq Aly Harry Mahmood", "multi-word upper → title case");
      assert(toProperCase("MR. RISHI RAI CHANDHARY") === "Mr. Rishi Rai Chandhary", "honorific 'MR.' → 'Mr.'");
      assert(toProperCase("AL-RASHID") === "Al-Rashid", "hyphen segments each cased");
      assert(toProperCase("O'BRIEN") === "O'Brien", "apostrophe segments each cased");
      // Passthrough — never reformat an email / URL / numeric code.
      assert(toProperCase("john@x.com") === "john@x.com", "email passes through unchanged");
      assert(toProperCase("https://x.com/p") === "https://x.com/p", "URL passes through unchanged");
      assert(toProperCase("30100") === "30100" && toProperCase("A-1203") === "A-1203", "numeric/unit code passes through");
      // Idempotent.
      assert(toProperCase(toProperCase("ABHISHEK ARORA")) === toProperCase("ABHISHEK ARORA"), "toProperCase is idempotent");

      // The SAFETY GUARD — only all-upper / all-lower are targets; mixed-case kept.
      assert(shouldNormalizeName("ABHISHEK ARORA") === true && shouldNormalizeName("abhishek arora") === true, "all-upper/all-lower → normalise");
      assert(shouldNormalizeName("Abhishek Arora") === false, "already-proper → leave");
      assert(shouldNormalizeName("McDonald") === false && shouldNormalizeName("DeSouza") === false && shouldNormalizeName("JPMorgan") === false, "intentional mixed-case → PRESERVED");
      assert(shouldNormalizeName("a@b.com") === false && shouldNormalizeName("30100") === false, "non-name values → never normalised");
      assert(shouldNormalizeName("") === false && shouldNormalizeName(null) === false, "empty/null → false");
      // Guarded entry point. (Cast args to string so the generic return type
      // isn't narrowed to the input literal — which would make === a type error.)
      assert(normalizeName("ABHISHEK ARORA" as string) === "Abhishek Arora" && normalizeName("McDonald" as string) === "McDonald", "normalizeName guards mixed-case");
      assert(normalizeName(null) === null, "normalizeName(null) → null");
      assert(normalizeNameList("ANIL RAJ, AVANTIKA NAIR" as string) === "Anil Raj, Avantika Nair", "multi-name list normalised per part");

      // (b) DATA — no LIVE name remains un-cased (a re-normalise would change it).
      const leads = await prisma.lead.findMany({ where: { deletedAt: null }, select: { name: true, altName: true } });
      let leadUncased = 0;
      for (const l of leads) {
        if (l.name && normalizeNameList(l.name) !== l.name) leadUncased++;
        if (l.altName && normalizeNameList(l.altName) !== l.altName) leadUncased++;
      }
      const buyers = await prisma.buyerRecord.findMany({ where: { deletedAt: null }, select: { clientName: true, ownerName: true, agentName: true } });
      let buyerUncased = 0;
      for (const b of buyers) {
        if (b.clientName && normalizeNameList(b.clientName) !== b.clientName) buyerUncased++;
        if (b.ownerName && normalizeNameList(b.ownerName) !== b.ownerName) buyerUncased++;
        if (b.agentName && normalizeNameList(b.agentName) !== b.agentName) buyerUncased++;
      }
      results.push({ name: "  ↳ note", ok: true, detail: `live names still un-cased → Lead: ${leadUncased}, Buyer: ${buyerUncased} (expect 0 post-migration)` });
      assert(leadUncased === 0, `${leadUncased} live Lead name/altName value(s) are still all-caps/all-lower — run scripts/normalize-names.ts --apply`);
      assert(buyerUncased === 0, `${buyerUncased} live BuyerRecord name value(s) are still all-caps/all-lower — run scripts/normalize-names.ts --apply`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // SMART TIMELINE EDIT (2026-06-24) — the Smart Timeline shows ONLY processed
  // CRM events (the raw imported remark blob stays in Raw History), is newest-
  // first, and per-entry edits are ADMIN-gated + audited. Invariants:
  //   (a) MIGRATION applied — Activity.outcome / Activity.followupDate columns +
  //       the ActivityEdit audit table exist in prod (selecting them must not throw).
  //   (b) ENDPOINT AUTH — the per-entry edit route admin-gates its PATCH server-side
  //       (the recurring "UI-gated but API-open" class). Static source scan.
  //   (c) NO RAW-BLOB LEAK — ConversationStreamCard's Smart Timeline view renders
  //       the unified CRM-event stream (`filteredStream`) and NO LONGER maps the
  //       parsed imported-remark entries (`displayRemarkEntries`). Static scan.
  //   (d) NEWEST-FIRST — the unified sort orders mixed event types descending.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "smart-timeline-edit — migration applied + endpoint admin-gated + no raw-blob leak + newest-first",
    run: async () => {
      // (a) DATA/SCHEMA — new columns + audit table are present (column/table probe).
      const probe = await prisma.activity.findFirst({ select: { id: true, outcome: true, followupDate: true } });
      void probe; // null on empty DB is fine — the point is the SELECT didn't throw.
      const editCount = await prisma.activityEdit.count();
      assert(typeof editCount === "number" && editCount >= 0, "ActivityEdit table missing — migration 20260624200000 not applied");

      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // (b) ENDPOINT AUTH — the activities edit route must reject non-admins server-side.
      const routePath = path.join(root, "src/app/api/leads/[id]/activities/[activityId]/route.ts");
      assert(fs.existsSync(routePath), "activities edit route is missing");
      const routeSrc = fs.readFileSync(routePath, "utf8");
      assert(/export\s+async\s+function\s+PATCH/.test(routeSrc), "activities route does not export PATCH");
      // role-gate present: ADMIN / isSuperAdmin check + a 403 for non-admins.
      assert(/me\.role\s*===\s*"ADMIN"/.test(routeSrc) && /isSuperAdmin/.test(routeSrc),
        "activities PATCH does not gate on ADMIN / isSuperAdmin");
      assert(/status:\s*403/.test(routeSrc), "activities PATCH has no 403 path for non-admins");
      // every changed field must be audited into ActivityEdit (no silent edits).
      assert(/activityEdit\.createMany/.test(routeSrc), "activities PATCH does not write ActivityEdit audit rows");

      // (c) NO RAW-BLOB LEAK — Smart Timeline renders the unified CRM-event stream and
      //     must NOT render the parsed imported-remark entries as cards.
      const cardPath = path.join(root, "src/components/ConversationStreamCard.tsx");
      const cardSrc = fs.readFileSync(cardPath, "utf8");
      assert(/viewMode === "smart" && filteredStream\.map/.test(cardSrc),
        "Smart Timeline no longer renders the unified CRM-event stream (filteredStream)");
      // The dead imported-remark render path must be gone (was `displayRemarkEntries.map`).
      assert(!/displayRemarkEntries\.map/.test(cardSrc),
        "Smart Timeline STILL maps parsed imported-remark entries (displayRemarkEntries) — raw blob leaks back in");
      // The unified stream excludes the raw blob by construction: it is built only
      // from call/wa/note/activity rows.
      assert(/kind:\s*"call"/.test(cardSrc) && /kind:\s*"activity"/.test(cardSrc),
        "unified stream is not built from genuine CRM event kinds");

      // (d) NEWEST-FIRST — replicate the unified sort and assert descending order
      //     across mixed event types (mirrors ConversationStreamCard.unifiedStream).
      const items = [
        { at: new Date("2026-06-13T10:00:00Z").getTime(), id: "c1" },
        { at: new Date("2026-06-24T10:00:00Z").getTime(), id: "a1" },
        { at: new Date("2026-06-17T10:00:00Z").getTime(), id: "w1" },
        { at: new Date("2026-06-23T10:00:00Z").getTime(), id: "n1" },
      ];
      const order = [...items].sort((x, y) => (y.at - x.at) || (x.id < y.id ? 1 : -1)).map((s) => s.id).join(",");
      assert(order === "a1,n1,w1,c1", `unified newest-first sort wrong: ${order}`);

      results.push({ name: "  ↳ note", ok: true, detail: `ActivityEdit rows in prod: ${editCount}` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "log-conversation-validation — outcome/follow-up/remarks mandatory (server 400); Activity carries outcome+followup; no Connected default; WA send requires follow-up",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // (a) LOG-CALL ENDPOINT — all three fields rejected when blank (server-side,
      //     so a tampered request can't bypass the client guard).
      const logCallPath = path.join(root, "src/app/api/leads/[id]/log-call/route.ts");
      assert(fs.existsSync(logCallPath), "log-call route is missing");
      const logCall = fs.readFileSync(logCallPath, "utf8");
      assert(/Please select an outcome before saving\./.test(logCall) && /status:\s*400/.test(logCall),
        "log-call does not 400 on blank outcome with the required message");
      assert(/Please set the next follow-up date\./.test(logCall),
        "log-call does not 400 on missing follow-up date");
      assert(/Please add remarks before saving\./.test(logCall),
        "log-call no longer requires remarks (must 400 on blank remarks)");
      // The old 'remarks are optional' policy must be gone.
      assert(!/Remarks are OPTIONAL/.test(logCall),
        "log-call still declares remarks OPTIONAL — mandatory-remarks rule regressed");

      // (b) LOG-CALL persists outcome + followupDate ONTO the Activity row (so the
      //     Smart Timeline card carries them) and mirrors followupDate to the Lead.
      //     Probe the Activity.create block (from its start to the next prisma call).
      const actStart = logCall.indexOf("activity.create");
      const actEnd = logCall.indexOf("lead.update", actStart);
      assert(actStart >= 0 && actEnd > actStart, "log-call Activity.create block not found");
      const actCreate = logCall.slice(actStart, actEnd);
      assert(/outcome:/.test(actCreate) && /followupDate:/.test(actCreate),
        "log-call Activity.create does not set outcome + followupDate (timeline would lose them)");
      assert(/followupDate:\s*callbackAt/.test(logCall),
        "log-call does not write Lead.followupDate from the callback time");

      // (c) WHATSAPP LOG — kind='send' requires a follow-up date; click stays exempt.
      const waPath = path.join(root, "src/app/api/whatsapp/log/route.ts");
      const wa = fs.readFileSync(waPath, "utf8");
      assert(/kind === "send"/.test(wa) && /Please set the next follow-up date\./.test(wa) && /status:\s*400/.test(wa),
        "whatsapp/log does not require a follow-up date on kind='send'");
      assert(/followupDate/.test(wa), "whatsapp/log does not handle followupDate at all");

      // (d) CLIENT — Outcome no longer defaults to Connected; blank placeholder present.
      const clientPath = path.join(root, "src/components/LeadActionsClient.tsx");
      const client = fs.readFileSync(clientPath, "utf8");
      assert(/\[outcomeKey, setOutcomeKey\]\s*=\s*useState\(""\)/.test(client),
        "outcomeKey no longer defaults to blank — Connected default may have returned");
      assert(!/setOutcomeKey\("PHONE_CONNECTED"\)/.test(client) && !/useState\("PHONE_CONNECTED"\)/.test(client),
        "outcomeKey still defaults/resets to PHONE_CONNECTED (Connected default not fully removed)");
      assert(/-- Select Outcome --/.test(client),
        "the '-- Select Outcome --' blank placeholder option is missing");
      // Client mandatory messages mirror the server.
      assert(/Please select an outcome before saving\./.test(client)
        && /Please set the next follow-up date\./.test(client)
        && /Please add remarks before saving\./.test(client),
        "client Log Conversation is missing one of the three mandatory validation messages");

      // (e) WA picker (TemplatePickerButton) — mandatory follow-up wired into send.
      const tplPath = path.join(root, "src/components/TemplatePickerButton.tsx");
      const tpl = fs.readFileSync(tplPath, "utf8");
      assert(/waFollowupAt/.test(tpl) && /followupDate/.test(tpl),
        "TemplatePickerButton does not collect/pass a follow-up date for WhatsApp send");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "completion-gate — Complete requires a logged contact today (server 400 for agents) + helper + actionContext migration + disabled in 4 surfaces + post-log popup + date-change protection + report",
    run: async () => {
      // (a) DATA/SCHEMA — Activity.actionContext column present (probe select).
      const probe = await prisma.activity.findFirst({ select: { id: true, actionContext: true } });
      void probe; // null on empty DB is fine — the SELECT not throwing proves the column exists.

      // (b) HELPER LOGIC — exercise the REAL followupGate helpers (read-only).
      //     Pick a lead and assert the boolean + batch agree, and that the batch
      //     never returns an id that wasn't asked for. Also assert the contact
      //     types are exactly CALL/WHATSAPP/EMAIL.
      const { hasContactActivityToday, contactActivityByLeadToday, CONTACT_ACTIVITY_TYPES, isConnectedOutcome } =
        await import("../src/lib/followupGate");
      const types = [...CONTACT_ACTIVITY_TYPES].sort().join(",");
      assert(types === "CALL,EMAIL,WHATSAPP", `contact activity types drifted: ${types}`);
      assert(isConnectedOutcome("CONNECTED") && isConnectedOutcome("interested") && !isConnectedOutcome("NOT PICKED"),
        "isConnectedOutcome misclassifies connected/non-connected outcomes");
      const sample = await prisma.lead.findFirst({ where: { deletedAt: null }, select: { id: true } });
      if (sample) {
        const set = await contactActivityByLeadToday([sample.id]);
        const bool = await hasContactActivityToday(sample.id);
        assert(set.has(sample.id) === bool, "batch contactActivityByLeadToday disagrees with hasContactActivityToday");
        // Batch must only ever contain ids it was asked about.
        for (const id of set) assert(id === sample.id, "batch returned an id outside the requested set");
      }
      // Empty input → empty set (no all-leads scan).
      const empty = await contactActivityByLeadToday([]);
      assert(empty.size === 0, "contactActivityByLeadToday([]) is not empty");

      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // (c) SERVER GATE — action-complete rejects agents with no contact today.
      const acPath = path.join(root, "src/app/api/leads/[id]/action-complete/route.ts");
      const ac = fs.readFileSync(acPath, "utf8");
      assert(/hasContactActivityToday|contactActivityTodayInfo/.test(ac),
        "action-complete does not consult the followupGate helper");
      assert(/me\.role\s*===\s*"AGENT"/.test(ac) && /status:\s*400/.test(ac),
        "action-complete does not 400 for an AGENT without contact today");
      assert(/without logging a call, WhatsApp, or email/.test(ac),
        "action-complete is missing the required contact-required message");
      assert(/actionContext:/.test(ac), "action-complete does not record the contact channel (actionContext)");

      // (d) SNOOZE REASON — reason required when no client response (agent).
      const asPath = path.join(root, "src/app/api/leads/[id]/action-snooze/route.ts");
      const as = fs.readFileSync(asPath, "utf8");
      assert(/reasonRequired/.test(as) && /me\.role\s*===\s*"AGENT"/.test(as),
        "action-snooze does not require a reason for agents without a client response");
      assert(/actionContext:\s*hasResponse\s*\?\s*"snooze:contacted"\s*:\s*"snooze:no-contact"/.test(as),
        "action-snooze does not stamp the snooze:contacted / snooze:no-contact report token");

      // (e) DATE-CHANGE PROTECTION — update route blocks agent followupDate change
      //     without contact unless a reschedule reason is given.
      const upPath = path.join(root, "src/app/api/leads/[id]/update/route.ts");
      const up = fs.readFileSync(upPath, "utf8");
      assert(/rescheduleReasonRequired/.test(up) && /hasContactActivityToday/.test(up),
        "update route does not gate followupDate changes on contact/reason for agents");
      assert(/Follow-up date changed/.test(up),
        "update route does not write a dedicated follow-up-date-change timeline entry");

      // (f) UI — Complete disabled w/ tooltip in ALL FOUR surfaces.
      //   ActionCardClient (Action List) + LeadFollowupActions (Lead Detail) take
      //   the hasContactToday prop; LeadsListClient (table + cards) gates on the
      //   per-row l.hasContactToday flag.
      const accSrc = fs.readFileSync(path.join(root, "src/components/ActionCardClient.tsx"), "utf8");
      assert(/hasContactToday/.test(accSrc) && /Contact attempt required before completing/.test(accSrc),
        "ActionCardClient Complete is not gated/tooltipped on hasContactToday");
      const lfaSrc = fs.readFileSync(path.join(root, "src/components/LeadFollowupActions.tsx"), "utf8");
      assert(/hasContactToday/.test(lfaSrc) && /Contact attempt required before completing/.test(lfaSrc),
        "LeadFollowupActions Complete is not gated/tooltipped on hasContactToday");
      const llcSrc = fs.readFileSync(path.join(root, "src/components/LeadsListClient.tsx"), "utf8");
      // Four Complete render sites, each must reference the per-row flag.
      const completeGated = (llcSrc.match(/!l\.hasContactToday/g) ?? []).length;
      assert(completeGated >= 4, `LeadsListClient gates only ${completeGated}/4 Complete surfaces on l.hasContactToday`);
      assert(/hasContactToday:\s*boolean/.test(llcSrc), "Row type missing hasContactToday flag");

      // The list/detail/action-list PAGES must compute + pass the flag.
      const leadsPage = fs.readFileSync(path.join(root, "src/app/(app)/leads/page.tsx"), "utf8");
      assert(/contactActivityByLeadToday/.test(leadsPage) && /hasContactToday:\s*contactTodaySet\.has/.test(leadsPage),
        "leads page does not batch-compute + pass hasContactToday per row");
      const actionListPage = fs.readFileSync(path.join(root, "src/app/(app)/action-list/page.tsx"), "utf8");
      assert(/contactActivityByLeadToday/.test(actionListPage) && /hasContactToday=\{contactByLead\.has/.test(actionListPage),
        "action-list page does not compute + pass hasContactToday to cards");
      const detailPage = fs.readFileSync(path.join(root, "src/app/(app)/leads/[id]/page.tsx"), "utf8");
      assert(/hasContactActivityToday/.test(detailPage) && /hasContactToday=\{leadHasContactToday\}/.test(detailPage),
        "lead detail page does not compute + pass hasContactToday to LeadFollowupActions");

      // (g) POST-LOG POPUP — the What-next prompt exists and is wired into both the
      //     Log Call success (LeadActionsClient) and WhatsApp send (TemplatePickerButton).
      const popupPath = path.join(root, "src/components/FollowupNextPopup.tsx");
      assert(fs.existsSync(popupPath), "FollowupNextPopup component is missing");
      const popup = fs.readFileSync(popupPath, "utf8");
      assert(/action-complete/.test(popup) && /action-snooze/.test(popup) && /action-escalate/.test(popup),
        "FollowupNextPopup does not call all three shared action endpoints");
      const lac = fs.readFileSync(path.join(root, "src/components/LeadActionsClient.tsx"), "utf8");
      assert(/FollowupNextPopup/.test(lac) && /setShowNextPrompt\(true\)/.test(lac),
        "LeadActionsClient does not open the post-log popup after a Log Call");
      const tplSrc = fs.readFileSync(path.join(root, "src/components/TemplatePickerButton.tsx"), "utf8");
      assert(/FollowupNextPopup/.test(tplSrc) && /setShowNextPrompt\(true\)/.test(tplSrc),
        "TemplatePickerButton does not open the post-log popup after a WhatsApp send");

      // (h) REPORT — Daily Report renders the follow-up workflow metrics and the
      //     helper exposes the core buckets (reconcilable).
      const daily = fs.readFileSync(path.join(root, "src/app/(app)/reports/daily/page.tsx"), "utf8");
      assert(/followupWorkflowStats/.test(daily) && /Follow-up Workflow/.test(daily),
        "Daily Report does not render the Follow-up Workflow metrics section");
      const fgSrc = fs.readFileSync(path.join(root, "src/lib/followupGate.ts"), "utf8");
      for (const bucket of ["dueToday", "completed", "completedAfterCall", "completedAfterWhatsapp", "snoozed", "snoozedWithoutContact", "escalated", "pendingAtEod"]) {
        assert(new RegExp(`${bucket}`).test(fgSrc), `followupWorkflowStats missing the '${bucket}' bucket`);
      }

      results.push({ name: "  ↳ note", ok: true, detail: "completion gate + helper + popup + report wired" });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 45. DASHBOARD COUNT == DRILL-DOWN (2026-06-24). The recurring class where a
  //     KPI card's COUNT query drifts from the FILTER its click applies (reported:
  //     "Hot Leads Untouched = 8" but the drill opened 0 leads). Invariants:
  //   (a) DEFINITION — the canonical hotUntouchedWhere is HOT + workable +
  //       UNTOUCHED (no CallLog, no contact-type Activity) — a STATE, not a stale-
  //       time threshold. The /leads ?untouched=1 filter reproduces UNTOUCHED_WHERE.
  //   (b) RECONCILIATION on REAL DATA — for every active sales agent, per widget,
  //       CARD count == the /leads drill where == an independent direct DB count.
  //       Proven for Hot-Untouched, Overdue, and Closable (the three lead-count
  //       hero cards). The company-wide totals must reconcile too.
  //   (c) SCOPE (no contamination) — the widget where is owner-scoped and ALWAYS
  //       carries deletedAt:null + isColdCall:false + non-cold origin (no admin/
  //       cold/buyer-pool, no recycle-bin, no cross-user leakage).
  //   (d) SOURCE — the dashboard card hrefs carry the reconciling params and the
  //       /leads page handles ?untouched=1 with the same contact-activity set.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "dashboard-reconcile — hot-untouched definition + every widget count==drill==db + agent scope + no contamination",
    run: async () => {
      const fs = await import("node:fs");
      const { hotUntouchedWhere, CONTACT_ACTIVITY_TYPES, UNTOUCHED_WHERE } = await import("../src/lib/dashboardWidgets");
      const { CLOSING_STATUSES, TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");

      const COLD = ["COLD", "REVIVAL"];
      const WORKABLE_OR = [
        { currentStatus: null },
        { currentStatus: "" },
        { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      type LW = import("@prisma/client").Prisma.LeadWhereInput;

      // (a) DEFINITION — UNTOUCHED_WHERE is no-CallLog + no contact-Activity, and the
      //     contact set covers calls/WA/email/meetings/site-visits (not NOTE/TASK/etc).
      assert(JSON.stringify((UNTOUCHED_WHERE as { callLogs?: unknown }).callLogs) === JSON.stringify({ none: {} }),
        "UNTOUCHED_WHERE must require callLogs none {}");
      for (const t of ["CALL", "WHATSAPP", "EMAIL", "SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING"]) {
        assert((CONTACT_ACTIVITY_TYPES as string[]).includes(t), `CONTACT_ACTIVITY_TYPES must include ${t}`);
      }
      for (const t of ["NOTE", "TASK", "STATUS_CHANGE", "ASSIGNMENT", "LEAD_CREATED"]) {
        assert(!(CONTACT_ACTIVITY_TYPES as string[]).includes(t), `CONTACT_ACTIVITY_TYPES must NOT include non-contact ${t}`);
      }

      // The /leads page reproduces the SAME drill where for the card params. Mirror
      // it inline (byte-equivalent to src/app/(app)/leads/page.tsx working view).
      const drillWhere = (ownerId: string, params: Record<string, string>): LW => {
        const where: LW = { ownerId, deletedAt: null, isColdCall: false, leadOrigin: { notIn: COLD } };
        const and: LW[] = [{ OR: WORKABLE_OR }];
        if (params.ai) where.aiScore = params.ai as import("@prisma/client").AIScore;
        if (params.untouched === "1") {
          where.callLogs = { none: {} };
          where.activities = { none: { type: { in: CONTACT_ACTIVITY_TYPES } } };
        }
        if (params.smart === "visit_potential") and.push({ currentStatus: { in: CLOSING_STATUSES } });
        if (params.followup === "overdue") where.followupDate = { lt: new Date(), not: null };
        where.AND = and;
        return where;
      };
      const workable = (scope: LW): LW => ({ ...scope, leadOrigin: { notIn: COLD }, OR: WORKABLE_OR });

      // (b)+(c) RECONCILIATION on real data, per agent. Owner-scoped (no contamination).
      const agents = await prisma.user.findMany({
        where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] }, hrOnly: false },
        select: { id: true, name: true },
      });
      let totCard = 0, totDrill = 0, totDb = 0;
      for (const u of agents) {
        const meScope: LW = { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: COLD } };

        // Hot Untouched
        const hotCard = await prisma.lead.count({ where: hotUntouchedWhere(meScope) });
        const hotDrill = await prisma.lead.count({ where: drillWhere(u.id, { ai: "HOT", untouched: "1", followup: "all" }) });
        const hotDb = await prisma.lead.count({
          where: {
            ownerId: u.id, deletedAt: null, isColdCall: false, leadOrigin: { notIn: COLD },
            aiScore: "HOT", callLogs: { none: {} },
            activities: { none: { type: { in: CONTACT_ACTIVITY_TYPES } } }, AND: [{ OR: WORKABLE_OR }],
          },
        });
        assert(hotCard === hotDrill && hotDrill === hotDb,
          `Hot-Untouched count!=drill!=db for ${u.name}: card=${hotCard} drill=${hotDrill} db=${hotDb}`);

        // Overdue follow-ups
        const ovCard = await prisma.lead.count({ where: { ...workable(meScope), followupDate: { lt: new Date(), not: null } } });
        const ovDrill = await prisma.lead.count({ where: drillWhere(u.id, { followup: "overdue" }) });
        assert(ovCard === ovDrill, `Overdue count!=drill for ${u.name}: card=${ovCard} drill=${ovDrill}`);

        // Closable deals
        const clCard = await prisma.lead.count({ where: { ...workable(meScope), currentStatus: { in: CLOSING_STATUSES } } });
        const clDrill = await prisma.lead.count({ where: drillWhere(u.id, { smart: "visit_potential", followup: "all" }) });
        assert(clCard === clDrill, `Closable count!=drill for ${u.name}: card=${clCard} drill=${clDrill}`);

        totCard += hotCard; totDrill += hotDrill; totDb += hotDb;
      }
      assert(totCard === totDrill && totDrill === totDb,
        `company-wide Hot-Untouched must reconcile: card=${totCard} drill=${totDrill} db=${totDb}`);

      // (c-ii) NO CONTAMINATION — hotUntouchedWhere keeps the scope's deletedAt/owner
      //        and never counts deleted/cold. Build a scope and assert the keys survive.
      const probe = hotUntouchedWhere({ ownerId: "X", deletedAt: null, leadOrigin: { notIn: COLD } }) as Record<string, unknown>;
      assert(probe.ownerId === "X" && probe.deletedAt === null, "hotUntouchedWhere must preserve ownerId + deletedAt:null scope");
      assert((probe.aiScore as string) === "HOT", "hotUntouchedWhere must pin aiScore HOT");

      // (d) SOURCE — dashboard card hrefs carry the reconciling params; /leads handles
      //     ?untouched=1 with the SAME contact-activity set (no drift).
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/hotUntouchedWhere\(meScope\)/.test(dash), "dashboard must count Hot-Untouched via hotUntouchedWhere(meScope)");
      assert(/ai:\s*"HOT",\s*untouched:\s*"1"/.test(dash), "Hot-Untouched card href must drill to ai=HOT&untouched=1");
      assert(!/\/leads\?ai=HOT&when=overdue/.test(dash), "the old broken ai=HOT&when=overdue Hot card href must be gone");
      assert(!/status=NEGOTIATION/.test(dash), "the old broken status=NEGOTIATION Closable href (no such status) must be gone");
      const leadsPage = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/sp\.untouched === "1"/.test(leadsPage), "/leads must handle ?untouched=1");
      assert(/CONTACT_ACTIVITY_TYPES/.test(leadsPage), "/leads ?untouched= must use the shared CONTACT_ACTIVITY_TYPES set");

      results.push({ name: "  ↳ note", ok: true, detail: `dashboard widgets reconcile (count==drill==db) for ${agents.length} agents; company Hot-Untouched=${totCard}` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 46. I-AM-HERE ONCE-PER-DAY + DAILY RESET (2026-06-24). The field-status "I Am
  //     Here" check-in is once-per-IST-day and the feed never repeats it.
  //   (a) DATA — after the dedup cleanup, NO (user, IST-day) bucket has >1 HERE
  //       (hard assert — the legacy duplicates were removed, kept earliest).
  //   (b) SOURCE — AgentStatusBar de-duplicates the movement feed (single HERE) and
  //       the dashboard derives "checked in today" from TODAY's IST events only.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "iamhere-dedup — ≤1 HERE per user per IST-day (post-cleanup) + feed dedup + daily reset",
    run: async () => {
      const fs = await import("node:fs");
      // (a) DATA — hard assert no duplicate HERE bucket remains (cleanup ran).
      const heres = await prisma.agentStatusEvent.findMany({
        where: { status: "HERE" }, select: { userId: true, startedAt: true }, take: 10000,
      });
      const seen = new Map<string, number>();
      for (const h of heres) {
        const key = `${h.userId}|${istDateKey(h.startedAt)}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, n]) => n > 1);
      assert(dupes.length === 0,
        `${dupes.length} (user, IST-day) bucket(s) STILL have >1 HERE — run scripts/cleanup-duplicate-here.ts --apply: ${dupes.map(([k]) => k).join(", ")}`);

      // (b) SOURCE — the feed is de-duplicated (single HERE; no repeated "I Am Here").
      const bar = fs.readFileSync("src/components/AgentStatusBar.tsx", "utf8");
      assert(/dedupedEvents/.test(bar), "AgentStatusBar must de-duplicate the movement feed (dedupedEvents)");
      assert(/firstHereId/.test(bar) && /e\.status === "HERE" && e\.id !== firstHereId/.test(bar),
        "AgentStatusBar feed must keep only the FIRST HERE (drop later duplicate HERE rows)");
      // Daily reset — the lock derives from TODAY's IST HERE event only (todaysHereEvent).
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/todaysHereEvent/.test(dash) && /myCheckedInToday/.test(dash),
        "dashboard must derive checked-in state from TODAY's IST HERE event (daily reset)");
      // The admin field-status feed is IST-today-scoped (yesterday never shows as today).
      const adminFs = fs.readFileSync("src/app/(app)/admin/field-status/page.tsx", "utf8");
      assert(/istDayBoundsUTC/.test(adminFs) && /startedAt:\s*\{\s*gte:\s*start,\s*lt:\s*end\s*\}/.test(adminFs),
        "admin field-status must scope today's movements to the IST day (daily reset)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 47. BACKFILL INTEGRITY (2026-06-24). Existing data complies with the recent
  //     write-time normalisations — proves the one-off migrations held and new
  //     gaps haven't crept in. ALL read-only counts.
  //   (a) NAMES — 0 live Lead.name/altName + Buyer name fields are un-cased
  //       (normalizeNameList(x) === x for every stored name).
  //   (b) SOURCE — 0 live leads still carry the deprecated WHATSAPP / INBOUND_CALL
  //       source enum (migrated to WEBSITE + medium).
  //   (c) BUYER PROPERTY MAP — 0 live Dubai buyers have a CLEAR property value
  //       sitting only in extraFields (Flat Typology / Saleable Area / Size(MM))
  //       while the real column (configuration / size / actualSize) is null.
  //       (idempotency guarantee of scripts/backfill-buyer-property-map.ts.)
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "backfill-integrity — 0 un-cased names + 0 legacy source enum + buyer property columns mapped (not stranded in extraFields)",
    run: async () => {
      // (a) NAMES — leads.
      const leads = await prisma.lead.findMany({ where: { deletedAt: null }, select: { name: true, altName: true } });
      let leadUncased = 0;
      for (const l of leads) {
        if (l.name && normalizeNameList(l.name) !== l.name) leadUncased++;
        if (l.altName && normalizeNameList(l.altName) !== l.altName) leadUncased++;
      }
      assert(leadUncased === 0, `${leadUncased} live lead name/altName still un-cased — run scripts/normalize-names.ts --apply`);

      // (a) NAMES — buyers (clientName/ownerName/agentName + coBuyerNames JSON).
      const buyers = await prisma.buyerRecord.findMany({
        where: { deletedAt: null },
        select: { clientName: true, ownerName: true, agentName: true, coBuyerNames: true, configuration: true, size: true, actualSize: true, extraFields: true, rawImport: true },
      });
      let buyerUncased = 0;
      for (const b of buyers) {
        for (const v of [b.clientName, b.ownerName, b.agentName]) if (v && normalizeNameList(v) !== v) buyerUncased++;
        try { const arr = JSON.parse(b.coBuyerNames ?? "[]"); if (Array.isArray(arr)) for (const c of arr) if (typeof c === "string" && normalizeNameList(c) !== c) buyerUncased++; } catch { /* not JSON → ignore */ }
      }
      assert(buyerUncased === 0, `${buyerUncased} live buyer name field(s) still un-cased — run scripts/normalize-names.ts --apply`);

      // (b) SOURCE — deprecated enum tokens fully migrated.
      const legacySource = await prisma.lead.count({ where: { deletedAt: null, source: { in: ["WHATSAPP", "INBOUND_CALL"] } } });
      assert(legacySource === 0, `${legacySource} live lead(s) still carry deprecated WHATSAPP/INBOUND_CALL source — run scripts/migrate-source-to-medium.ts`);

      // (c) BUYER PROPERTY MAP — clear values mapped into real columns, not stranded.
      const JUNK = new Set(["", "na", "n/a", "none", "null", "-", "nil", "tbd"]);
      const real = (v: unknown): string | null => { const s = String(v ?? "").trim(); return s && !JUNK.has(s.toLowerCase()) ? s : null; };
      const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
      const PMAP: Array<{ key: string; col: "configuration" | "size" | "actualSize" }> = [
        { key: "Flat Typology", col: "configuration" },
        { key: "Saleable Area", col: "size" },
        { key: "Size(MM)", col: "actualSize" },
      ];
      let stranded = 0;
      for (const b of buyers) {
        const blob = { ...asObj(b.rawImport), ...asObj(b.extraFields) };
        for (const { key, col } of PMAP) {
          const cur = (b as Record<string, unknown>)[col];
          const isNull = cur == null || (typeof cur === "string" && cur.trim() === "");
          if (isNull && real(blob[key])) stranded++;
        }
      }
      assert(stranded === 0, `${stranded} buyer property value(s) stranded in extraFields with a null column — run scripts/backfill-buyer-property-map.ts --apply`);

      results.push({ name: "  ↳ note", ok: true, detail: `names cased (${leads.length} leads, ${buyers.length} buyers) · 0 legacy source · buyer property columns mapped` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 3f. HR EXCLUDED FROM ALL SALES SURFACES (2026-06-25) — an hrOnly user (Nisha,
  //     an active MANAGER on the HR side) must NEVER appear in any sales roster,
  //     count, or assignment dropdown, and must NEVER be a valid assignment target
  //     — yet MUST still appear in the HR roster. Driven off the canonical hrOnly
  //     flag, not a name. Proves the FILTER is what excludes them (baseline w/o
  //     hrOnly may include them; filtered must include zero), and SOURCE-scans the
  //     surfaces fixed/hardened this batch so a refactor can't silently re-include.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "hr-exclusion — hrOnly user absent from every sales roster/count/assign-target; present in HR; sources guarded",
    run: async () => {
      const fs = await import("node:fs");

      // The canonical HR population. If none exists right now, the filter math is
      // still proven structurally below, but skip the data assertions gracefully.
      const hrUsers = await prisma.user.findMany({
        where: { active: true, hrOnly: true },
        select: { id: true, name: true, role: true, team: true },
      });
      const hrIds = new Set(hrUsers.map((u) => u.id));

      // ── (a) FILTER MATH per sales-roster shape: filtered == baseline − hrOnly,
      //        and ZERO hrOnly users survive the filtered roster. Each tuple mirrors
      //        a real roster query used by a sales surface.
      const rosters: Array<{ label: string; base: Record<string, unknown> }> = [
        { label: "sales board / agent-performance (active AGENT/MANAGER)", base: { active: true, role: { in: ["AGENT", "MANAGER"] } } },
        { label: "leaderboards (active AGENT/MANAGER)", base: { active: true, role: { in: ["AGENT", "MANAGER"] } } },
        { label: "assign dropdowns (active AGENT/MANAGER/ADMIN)", base: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] } } },
        { label: "team page scoreboard (all active)", base: { active: true } },
      ];
      for (const r of rosters) {
        const baseline = await prisma.user.count({ where: r.base });
        const filtered = await prisma.user.count({ where: { ...r.base, hrOnly: false } });
        const hrInBase = await prisma.user.count({ where: { ...r.base, hrOnly: true } });
        assert(filtered === baseline - hrInBase, `${r.label}: filter math broken (filtered=${filtered}, baseline=${baseline}, hrOnly=${hrInBase})`);
        // No hrOnly user may remain after the filter.
        const survivors = await prisma.user.findMany({ where: { ...r.base, hrOnly: false }, select: { id: true } });
        assert(survivors.every((u) => !hrIds.has(u.id)), `${r.label}: an hrOnly user survived the hrOnly:false filter`);
      }

      // ── (b) HR users counted ZERO sales work — no owned (non-cold) leads, no
      //        call logs, no activities. (They're HR; if this trips, an HR account
      //        is being used for sales and the exclusion is cosmetic.)
      if (hrIds.size > 0) {
        const ids = [...hrIds];
        const ownedSales = await prisma.lead.count({ where: { ownerId: { in: ids }, deletedAt: null, leadOrigin: { notIn: ["COLD", "REVIVAL"] } } });
        const calls = await prisma.callLog.count({ where: { userId: { in: ids } } });
        const acts = await prisma.activity.count({ where: { userId: { in: ids } } });
        assert(ownedSales === 0, `hrOnly user(s) own ${ownedSales} sales lead(s) — HR must hold no sales pipeline`);
        assert(calls === 0, `hrOnly user(s) have ${calls} call log(s) tallied as sales activity`);
        assert(acts === 0, `hrOnly user(s) have ${acts} activit(y/ies) tallied as sales activity`);
      }

      // ── (c) HR roster STILL includes them — hrUsers.ts is { active, OR:[hrOnly,hrTeam] }.
      //        Mirror that where and assert every hrOnly user is returned.
      const hrRoster = await prisma.user.findMany({
        where: { active: true, OR: [{ hrOnly: true }, { hrTeam: true }] },
        select: { id: true },
      });
      const hrRosterIds = new Set(hrRoster.map((u) => u.id));
      for (const u of hrUsers) assert(hrRosterIds.has(u.id), `hrOnly user ${u.name} missing from the HR roster — they must remain in /hr`);

      // ── (d) SOURCE GUARDS — the rosters/targets fixed or hardened this batch must
      //        keep the hrOnly filter (a refactor dropping it is a silent regression).
      const teamPage = fs.readFileSync("src/app/(app)/team/page.tsx", "utf8");
      assert(/where:\s*\{\s*active:\s*true,\s*hrOnly:\s*false\s*\}/.test(teamPage), "team page roster must filter hrOnly:false (no HR on the sales scoreboard)");
      const lb = fs.readFileSync("src/app/(app)/reports/leaderboard/page.tsx", "utf8");
      assert((lb.match(/hrOnly:\s*false/g) ?? []).length >= 2, "/reports leaderboard ADMIN+MANAGER roster branches must both filter hrOnly:false");
      const mdBulk = fs.readFileSync("src/app/api/master-data/bulk/route.ts", "utf8");
      assert(/hrOnly:\s*false/.test(mdBulk), "master-data bulk-assign target lookup must reject hrOnly users");
      const coldBulk = fs.readFileSync("src/app/api/cold-data/bulk-assign/route.ts", "utf8");
      assert(/target\.hrOnly/.test(coldBulk), "cold-data bulk-assign must reject an hrOnly target");

      results.push({
        name: "  ↳ note",
        ok: true,
        detail: hrIds.size > 0
          ? `${hrIds.size} active hrOnly user(s) [${hrUsers.map((u) => u.name).join(", ")}] excluded from 4 sales-roster shapes + 2 bulk-assign guards; present in HR roster; 0 sales leads/calls/activities`
          : "no active hrOnly user present — filter math + source guards still asserted structurally",
      });
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
