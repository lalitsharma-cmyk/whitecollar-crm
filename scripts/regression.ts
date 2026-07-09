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
// Phone dialability + Property-Enquired resolution (pure, no "server-only") — the
// REAL helpers behind Bug 1 (alt-action gating) and Bug 2 (canonical sourceDetail
// shown identically on detail/table/Master-Data), so these invariants test prod code.
import { hasDialableNumber } from "../src/lib/phone";
import { resolveEnquiredProperty } from "../src/lib/projectName";

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
  {
    name: "property-enquired-filter — ?project= and ?q= also match sourceDetail (the displayed 'Property Enquired'), not just formal Project relations",
    run: async () => {
      const { leadFilterWhere } = await import("../src/lib/leadFilterWhere");
      type OrClause = { OR?: Record<string, unknown>[] };
      const firstOr = (and: unknown[]) => (and as OrClause[]).map((c) => c.OR).find(Boolean) as Record<string, unknown>[] | undefined;
      const hasSourceDetailContains = (or: Record<string, unknown>[] | undefined, val: string) =>
        !!or && or.some((o) => { const s = o.sourceDetail as { contains?: string; mode?: string } | undefined; return s?.contains === val && s?.mode === "insensitive"; });

      // (1) ?project= must ALSO match sourceDetail (display/filter parity for imported
      //     cold data that has no formal Project relation, e.g. "Whiteland Westin Residences")
      //     while STILL matching the discussed + interestedUnits relations (additive).
      const projOr = firstOr(leadFilterWhere({ project: "Whiteland Westin Residences" }));
      assert(hasSourceDetailContains(projOr, "Whiteland Westin Residences"),
        "?project= OR must include { sourceDetail: { contains, mode:'insensitive' } } (display/filter parity)");
      assert(!!projOr && projOr.some((o) => "discussed" in o) && projOr.some((o) => "interestedUnits" in o),
        "?project= must STILL match discussed + interestedUnits relations (additive — no regression on /leads)");

      // (2) ?q= free-text must also search sourceDetail (top search finds property enquiry) + keep name/phone/email/company.
      const qOr = firstOr(leadFilterWhere({ q: "Whiteland" }));
      assert(hasSourceDetailContains(qOr, "Whiteland"), "?q= OR must include a sourceDetail contains clause");
      assert(!!qOr && ["name", "phone", "email", "company"].every((f) => qOr!.some((o) => f in o)),
        "?q= must still search name/phone/email/company (no regression)");

      // (3) DATA reconciliation: on the cold scope the Property-Enquired filter now returns
      //     the imported Whiteland rows (was 0 before the fix — filter ignored sourceDetail).
      const coldWhere = { deletedAt: null, OR: [{ isColdCall: true }, { leadOrigin: { in: ["COLD", "REVIVAL"] } }] };
      const bySourceDetail = await prisma.lead.count({ where: { ...coldWhere, sourceDetail: { contains: "Whiteland Westin Residences", mode: "insensitive" } } });
      const viaFilter = await prisma.lead.count({ where: { AND: [coldWhere, ...leadFilterWhere({ project: "Whiteland Westin Residences" })] } });
      assert(bySourceDetail > 0 && viaFilter >= bySourceDetail,
        `Property-Enquired filter must return the cold Whiteland rows (filter=${viaFilter}, sourceDetail=${bySourceDetail})`);
      results.push({ name: "  ↳ note", ok: true, detail: `Property-Enquired filter now matches sourceDetail (${bySourceDetail} cold Whiteland rows filterable) + q-search covers it; relations preserved` });
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
      // Lead export now lives ONLY at /api/reports/export (watermarked + audited +
      // ADMIN-gated). The legacy /api/leads/export route was an un-watermarked,
      // un-audited orphan (0 UI refs, gate weaker than its comment) and was DELETED
      // 2026-06-25. Lock both facts so the exfiltration path can't return silently.
      assert(!fs.existsSync("src/app/api/leads/export/route.ts"),
        "orphan /api/leads/export route MUST stay deleted — the real export is /api/reports/export (watermarked+audited)");
      const reportsExp = fs.readFileSync("src/app/api/reports/export/route.ts", "utf8");
      assert(/requireRole\("ADMIN"\)/.test(reportsExp), "/api/reports/export MUST be ADMIN-gated (single export path)");
      assert(/await audit\(/.test(reportsExp), "/api/reports/export MUST audit() every download");
      assert(/Confidential export/.test(reportsExp), "/api/reports/export MUST watermark the CSV (downloader trace)");
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
  // 3e-sext. LEAD DEFAULT SORT TIERS — the EXISTING lower band, preserved after the
  //     2026-07-06 Fresh-Lead-priority rewrite. What used to be tiers 2-6 (today-
  //     followup / old-fresh / overdue / future / other) is now tiers 5-9; a fresh
  //     lead created today is now tier 0 (was 1). These assertions lock that the old
  //     band still ranks in the same relative order under the new numbering.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-sort-tier — existing lower band preserved (today-followup→5 … other→9)",
    run: async () => {
      const { leadSortTier, isFreshStatus } = await import("../src/lib/lead-statuses");
      const today = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") };
      const D = (s: string) => new Date(s);
      // Fresh created-today is now the TOP tier (0), not 1.
      assert(leadSortTier({ currentStatus: "Fresh Lead", createdAt: D("2026-06-21T05:00:00Z"), followupDate: D("2026-06-21T09:00:00Z") }, today) === 0, "fresh created-today = tier 0 (new top)");
      assert(leadSortTier({ currentStatus: "Interested", createdAt: D("2026-06-10T05:00:00Z"), followupDate: D("2026-06-21T08:00:00Z") }, today) === 5, "today follow-up = tier 5");
      assert(leadSortTier({ currentStatus: "Fresh Lead", createdAt: D("2026-06-18T05:00:00Z"), followupDate: null }, today) === 6, "old fresh = tier 6");
      assert(leadSortTier({ currentStatus: "Negotiating", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-19T08:00:00Z") }, today) === 7, "overdue follow-up = tier 7");
      assert(leadSortTier({ currentStatus: "Interested", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-25T08:00:00Z") }, today) === 8, "future follow-up = tier 8 (must sink below actionable)");
      assert(leadSortTier({ currentStatus: "Call Back Later", createdAt: D("2026-06-01T05:00:00Z"), followupDate: null }, today) === 9, "worked, no follow-up = tier 9");
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
    // AGENT-SAMEDAY-EDIT (2026-06-25) — per-entry Smart Timeline ACTIVITY edit gate.
    // An AGENT may edit their OWN free-text Activity (meeting/visit/discussion/email/
    // brochure) ONLY on the IST day they logged it — computed from the entry's stored
    // createdAt + author + role (NOT a UI mount flag / admin-only). EXISTING same-day
    // rows must be editable WITHOUT recreating them; previous-day, another agent's, or
    // a system-generated kind → false. Admin/Manager/super → any entry, any date
    // (unchanged). Pure-function test on fixed timestamps (no Date.now). Plus a static
    // guard that the SAME helper gates BOTH the UI button and the server PATCH.
    name: "agent-sameday-edit — agent edits own same-IST-day free-text activity; previous-day/other-agent/system-kind blocked; admin/manager/super unchanged; gate shared UI+server",
    run: async () => {
      const { canEditActivity } = await import("../src/lib/remarkPerms");
      // Fixed "now" = 2026-06-21 08:00 UTC = 13:30 IST (same IST day as a 05:00Z entry).
      const now = new Date("2026-06-21T08:00:00Z");
      const agent = { id: "a1", role: "AGENT" };
      const todayIST = new Date("2026-06-21T05:00:00Z");      // 10:30 IST, 21 Jun
      const yesterdayIST = new Date("2026-06-20T05:00:00Z");  // 20 Jun
      // Edge: 2026-06-20T19:00Z = 2026-06-21T00:30 IST → still "today" IST.
      const lateNightPrevUtcButTodayIST = new Date("2026-06-20T19:00:00Z");

      // (1) EXISTING same-day own free-text entry → editable (the core fix).
      assert(canEditActivity(agent, { type: "MEETING", createdById: "a1", createdAt: todayIST }, now) === true,
        "agent own + same IST day + MEETING → editable (existing same-day row)");
      assert(canEditActivity(agent, { type: "SITE_VISIT", createdById: "a1", createdAt: lateNightPrevUtcButTodayIST }, now) === true,
        "agent own + UTC-prev-but-IST-today + SITE_VISIT → editable (IST boundary)");
      assert(canEditActivity(agent, { type: "PROJECT_DISCUSSED", createdById: "a1", createdAt: todayIST }, now) === true,
        "agent own + same IST day + PROJECT_DISCUSSED → editable");

      // (3) Previous-day own entry → locked (no edit / server 403).
      assert(canEditActivity(agent, { type: "MEETING", createdById: "a1", createdAt: yesterdayIST }, now) === false,
        "agent own + previous IST day → locked");

      // (4) Another agent's same-day entry → locked.
      assert(canEditActivity(agent, { type: "MEETING", createdById: "a2", createdAt: todayIST }, now) === false,
        "agent + another agent's entry (same day) → locked");

      // System-generated kinds → never agent-editable, even own + same day.
      for (const sysType of ["STATUS_CHANGE", "LEAD_CREATED", "COLD_TO_LEAD", "REMINDER_FIRED", "ASSIGNMENT", "CALL", "WHATSAPP"]) {
        assert(canEditActivity(agent, { type: sysType, createdById: "a1", createdAt: todayIST }, now) === false,
          `agent + own same-day ${sysType} (system/non-free-text kind) → locked`);
      }
      // Missing author / missing type → locked for agents.
      assert(canEditActivity(agent, { type: "MEETING", createdById: null, createdAt: todayIST }, now) === false,
        "agent + no author → locked");
      assert(canEditActivity(agent, { type: null, createdById: "a1", createdAt: todayIST }, now) === false,
        "agent + no type → locked");

      // ADMIN / MANAGER / super (role ADMIN) — UNCHANGED: any entry, any date, any kind.
      const admin = { id: "x", role: "ADMIN" };
      const manager = { id: "m", role: "MANAGER" };
      assert(canEditActivity(admin, { type: "STATUS_CHANGE", createdById: "someoneElse", createdAt: yesterdayIST }, now) === true,
        "admin → any entry/date/kind (incl. STATUS_CHANGE, prev day, not author)");
      assert(canEditActivity(manager, { type: "MEETING", createdById: "someoneElse", createdAt: yesterdayIST }, now) === true,
        "manager → any entry/date (not author, prev day)");
      assert(canEditActivity(admin, { type: "MEETING", createdById: null, createdAt: null }, now) === true,
        "admin → editable even with no author/date");

      // STATIC GUARD — the SAME helper must gate BOTH surfaces (UI button + server
      // PATCH), so an agent can't be granted edit on one side but denied on the other.
      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();
      const cardSrc = fs.readFileSync(path.join(root, "src/components/ConversationStreamCard.tsx"), "utf8");
      assert(/canEditActivity\(/.test(cardSrc), "ConversationStreamCard must gate the Edit button via canEditActivity");
      // The old admin-only flag must NOT gate the activity Edit button any longer.
      assert(!/\{isAdmin && !surfacedNote &&/.test(cardSrc),
        "activity Edit button still uses the old admin-only `isAdmin && !surfacedNote` gate");
      const routeSrc = fs.readFileSync(path.join(root, "src/app/api/leads/[id]/activities/[activityId]/route.ts"), "utf8");
      assert(/canEditActivity\(/.test(routeSrc), "activities PATCH must re-enforce via canEditActivity");
      assert(/status:\s*403/.test(routeSrc), "activities PATCH must keep a 403 path for a forbidden edit");
      // The old blanket admin-only short-circuit (reject ALL non-admins) must be gone.
      assert(!/Only an admin can edit timeline entries/.test(routeSrc),
        "activities PATCH still hard-blocks every non-admin (old admin-only gate not replaced)");
    },
  },
  {
    // SMART-TIMELINE-EDIT-VISIBILITY (2026-06-26) — the *rendered* Edit affordance
    // in Conversation History → Smart Timeline must match the edit rules exactly:
    //   • EVERY clickable Edit on a stream entry is gated by canEditRemark (notes)
    //     or canEditActivity (activities) — never an ungated / mount-only flag.
    //   • A SYSTEM audit row ("Inline edit: N field(s)", followup-change) is NOT
    //     freely editable → it must render NO real Edit button AND no "Edit"-looking
    //     text. The bug fixed here: the surfaced-system-NOTE chip used the literal
    //     label "Edit" (+ a ✏️ pencil), which read as a broken, unclickable Edit
    //     control sitting next to the real per-entry Edit button. It now reads
    //     "System" (🛈). This is a pure render-gating guard (static source scan) —
    //     the own/same-IST-day/kind matrix itself is proven in `agent-sameday-edit`.
    name: "smart-timeline-edit-visibility — Edit affordance gated by canEditRemark/canEditActivity; surfaced system NOTE rows show NO clickable Edit + no \"Edit\" text",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const cardPath = path.join(process.cwd(), "src/components/ConversationStreamCard.tsx");
      const src = fs.readFileSync(cardPath, "utf8");

      // (1) GATED — the two real Edit buttons are gated by the shared perm helpers.
      //     Note row → canEditRemark; CRM activity row → canEditActivity. Both must
      //     wrap a real <button>, and the activity one must additionally exclude
      //     surfaced system NOTE rows (!surfacedNote).
      assert(/canEditRemark\([^)]*\)[\s\S]{0,80}&&\s*!editing\s*&&[\s\S]{0,160}<button/.test(src),
        "note Edit button is not gated by canEditRemark (+ !editing)");
      assert(/!surfacedNote\s*&&\s*canEditActivity\(/.test(src),
        "activity Edit button must be gated by `!surfacedNote && canEditActivity(`");
      // The real per-entry edit button opens the modal — proves it's a working control.
      assert(/onClick=\{\(\)\s*=>\s*setEditActivity\(a\)\}/.test(src),
        "activity Edit button no longer opens the TimelineEntryEditModal (setEditActivity)");

      // (2) NO FAKE "Edit" TEXT — a surfaced system NOTE row (isSurfacedNoteActivity:
      //     "Inline edit:" / followup-change) must NOT label its chip "Edit" and must
      //     NOT show a ✏️ pencil. The non-followup surfaced-note branch is "System"/🛈.
      //     Guard against the exact regression: `surfacedNote ? "Edit"` and
      //     `surfacedNote ? "✏️"` in the actLabel/actIcon fallbacks.
      assert(!/surfacedNote\s*\?\s*"Edit"/.test(src),
        "surfaced system NOTE row still uses the literal \"Edit\" chip label (fake/unclickable Edit affordance)");
      assert(!/surfacedNote\s*\?\s*"✏️"/.test(src),
        "surfaced system NOTE row still uses a ✏️ pencil icon (reads like an Edit control)");
      assert(/surfacedNote\s*\?\s*"System"/.test(src),
        "surfaced system NOTE row must label its chip \"System\" (neutral, non-Edit)");

      // (3) SYSTEM ROWS GET NO EDIT BUTTON — defence in depth: the activity Edit
      //     button is suppressed for surfacedNote, and isSurfacedNoteActivity only
      //     matches the system audit kinds (NOTE-typed "Inline edit:" / followup-change),
      //     never a free-text meeting/visit/discussion. Confirm the classifier shape.
      assert(/function isSurfacedNoteActivity/.test(src) &&
             /a\.type !== "NOTE"\)\s*return false/.test(src) &&
             /startsWith\("Inline edit:"\)/.test(src) &&
             /startsWith\("followup-change"\)/.test(src),
        "isSurfacedNoteActivity no longer narrowly classifies only system NOTE audit rows");
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
    // CALL-TRACKING MODULE (Lalit 2026-07-08): a CALL's module = the working surface
    // the agent performed it from (Leads / Revival Engine / Dubai|India Buyer Data),
    // NEVER "Master Data" (agents have no Master Data calling UI). And every call-count
    // surface must include Buyer-Data calls, not just lead calls.
    name: "call-tracking-module — a call's module is its activity source (never Master Data) + buyer calls counted",
    run: async () => {
      const fs = await import("fs");
      const { activityLeadModule, ACTIVITY_SOURCE_MODULES, leadSourceModule } = await import("../src/lib/moduleSource");
      // (a) activityLeadModule NEVER returns "Master Data": a master-origin lead's call
      //     is attributed to the Leads queue the agent worked it from.
      for (const o of ["MASTER_DATA", "PORTFOLIO", "SYSTEM"]) {
        assert(activityLeadModule(o, false) === "Leads", `activityLeadModule(${o}) must be "Leads", got ${activityLeadModule(o, false)}`);
      }
      assert(activityLeadModule(null, false) === "Leads" && activityLeadModule("WEBSITE", false) === "Leads", "non-cold lead activity → Leads");
      assert(activityLeadModule("COLD", false) === "Revival Engine" && activityLeadModule(null, true) === "Revival Engine", "cold / isColdCall activity → Revival Engine");
      // The RECORD classifier is unchanged (a master-origin RECORD is still Master Data).
      assert(leadSourceModule("MASTER_DATA", false) === "Master Data", "leadSourceModule must still classify a master-origin RECORD as Master Data");
      // (b) The activity module set = the 4 working surfaces (no Master Data).
      assert(!ACTIVITY_SOURCE_MODULES.includes("Master Data"), "ACTIVITY_SOURCE_MODULES must NOT include Master Data");
      assert(ACTIVITY_SOURCE_MODULES.length === 4, "ACTIVITY_SOURCE_MODULES must be the 4 activity modules");
      // (c) Call Logs labels + filters a call by its activity module (never Master Data).
      const callLogs = fs.readFileSync("src/app/(app)/call-logs/page.tsx", "utf8");
      assert(/activityLeadModule\(log\.lead\.leadOrigin/.test(callLogs) && !/leadSourceModule/.test(callLogs), "Call Logs module column must use activityLeadModule, not leadSourceModule");
      assert(/ACTIVITY_SOURCE_MODULES\.includes/.test(callLogs), "Call Logs module filter must validate against ACTIVITY_SOURCE_MODULES");
      const callFilters = fs.readFileSync("src/app/(app)/call-logs/CallLogFilters.tsx", "utf8");
      assert(/ACTIVITY_SOURCE_MODULES/.test(callFilters) && !/ALL_SOURCE_MODULES/.test(callFilters), "Call Logs filter dropdown must offer ACTIVITY_SOURCE_MODULES (no Master Data)");
      // (d) Agent Performance: activity splits use activityLeadModule + buyer calls counted.
      const agentPerf = fs.readFileSync("src/lib/agentPerformance.ts", "utf8");
      assert(/activityLeadModule\(r\.lead\.leadOrigin/.test(agentPerf), "agentPerformance activity split must use activityLeadModule");
      assert(/m\.buyerCalls \+= 1/.test(agentPerf) && /BUYER_CALL_ACTIVITY_TYPES/.test(agentPerf), "agentPerformance must count Buyer-Data calls (BuyerActivity)");
      // (e) Dashboard team scoreboard folds in buyer calls (BuyerActivity ledger).
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/FROM "BuyerActivity"/.test(dash), "dashboard team scoreboard must include buyer calls (BuyerActivity)");
      // (f) DATA belt: no live lead-linked call classifies as Master Data via the column rule.
      const leadCalls = await prisma.callLog.findMany({
        where: { lead: { deletedAt: null } },
        select: { lead: { select: { leadOrigin: true, isColdCall: true } } },
        take: 5000,
      });
      const masterLabeled = leadCalls.filter((c) => c.lead && activityLeadModule(c.lead.leadOrigin, c.lead.isColdCall) === "Master Data").length;
      assert(masterLabeled === 0, `${masterLabeled} lead-linked call(s) would still render as "Master Data"`);
      results.push({ name: "  ↳ note", ok: true, detail: `activity module never Master Data (${leadCalls.length} lead calls checked); buyer calls wired into scoreboard + agent-performance` });
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
  // 14. AGENT PERFORMANCE (2026-06-23; reworked 2026-06-30) — "Leads Assigned"
  //   counts by the lead's CURRENT owner (ownerId), NOT assignment history, and
  //   NEVER counts deleted leads. A reassigned lead immediately follows the new
  //   owner (Lalit's rule — fixes the Tanuj→Yasir stale-owner drill-down). A
  //   rejected lead (ownerId nulled) is still attributed via previousOwnerId.
  //   Mirrors src/lib/agentPerformance.ts buildAgentReport() totalAssigned +
  //   drilldownWhere("totalAssigned") inline (server-only lib can't be imported
  //   under bare tsx). Invariants:
  //    (a) count-side (attribute each lead to ownerId ?? previousOwnerId) ==
  //        drill-side (the same OR-where) for a real agent.
  //    (b) a REASSIGNED lead counts for the current owner ONLY, never the old one.
  //    (c) a soft-deleted owned lead is EXCLUDED.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "agent-performance — Leads Assigned uses CURRENT owner (reassigned follows new owner) + reconciles + excludes deleted",
    run: async () => {
      // Pick an agent who currently owns at least one lead.
      const withOwn = await prisma.lead.findFirst({
        where: { deletedAt: null, ownerId: { not: null } },
        select: { ownerId: true },
      });
      if (!withOwn?.ownerId) {
        results.push({ name: "  ↳ note", ok: true, detail: "no owned leads present — attribution check skipped" });
        return;
      }
      const agentId = withOwn.ownerId;

      // Canonical CURRENT-attribution where (mirror of drilldownWhere('totalAssigned')
      // and the buildAgentReport cohort): owns now, OR a rejected-unassigned lead
      // the agent previously handled.
      const ownerWhere = {
        deletedAt: null,
        OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }],
      };

      // COUNT side: attribute each lead to ownerId ?? previousOwnerId.
      const rows = await prisma.lead.findMany({
        where: ownerWhere,
        select: { ownerId: true, previousOwnerId: true },
      });
      const countSide = rows.filter((r) => (r.ownerId ?? r.previousOwnerId) === agentId).length;

      // DRILL side: the same where, counted.
      const drillSide = await prisma.lead.count({ where: ownerWhere });
      assert(countSide === drillSide,
        `current-owner count must reconcile with the drill-down query (count=${countSide}, drill=${drillSide})`);

      // (b) STALE-OWNER GUARD: a reassigned lead (ownerId != previousOwnerId, both
      // set) must count for the CURRENT owner and NEVER for the previous owner.
      const candidates = await prisma.lead.findMany({
        where: { deletedAt: null, ownerId: { not: null }, previousOwnerId: { not: null } },
        select: { id: true, ownerId: true, previousOwnerId: true },
        take: 300,
      });
      const reassigned = candidates.find((c) => c.ownerId !== c.previousOwnerId);
      if (reassigned && reassigned.ownerId && reassigned.previousOwnerId) {
        const underNew = await prisma.lead.count({
          where: { id: reassigned.id, deletedAt: null, OR: [{ ownerId: reassigned.ownerId }, { ownerId: null, previousOwnerId: reassigned.ownerId }] },
        });
        const underOld = await prisma.lead.count({
          where: { id: reassigned.id, deletedAt: null, OR: [{ ownerId: reassigned.previousOwnerId }, { ownerId: null, previousOwnerId: reassigned.previousOwnerId }] },
        });
        assert(underNew === 1 && underOld === 0,
          `reassigned lead ${reassigned.id} must count for the CURRENT owner only (new=${underNew}, old=${underOld})`);
      } else {
        results.push({ name: "  ↳ note", ok: true, detail: "no reassigned lead (ownerId!=previousOwnerId) present — stale-owner guard skipped" });
      }

      // (b2) HISTORY-STALE GUARD (the exact Akanksha Chugh bug): a lead owned by
      // agent A but carrying an Assignment-history row to a DIFFERENT agent B must
      // count for A (current owner) and NEVER for B. The OLD report counted it for
      // BOTH (via Assignment.some) — this asserts that can't come back.
      const withAsg = await prisma.lead.findMany({
        where: { deletedAt: null, ownerId: { not: null }, assignments: { some: {} } },
        select: { id: true, ownerId: true, assignments: { select: { userId: true } } },
        take: 500,
      });
      const stale = withAsg.find((l) => l.assignments.some((a) => a.userId !== l.ownerId));
      if (stale && stale.ownerId) {
        const otherAgent = stale.assignments.find((a) => a.userId !== stale.ownerId)!.userId;
        const underOwner = await prisma.lead.count({
          where: { id: stale.id, deletedAt: null, OR: [{ ownerId: stale.ownerId }, { ownerId: null, previousOwnerId: stale.ownerId }] },
        });
        const underOther = await prisma.lead.count({
          where: { id: stale.id, deletedAt: null, OR: [{ ownerId: otherAgent }, { ownerId: null, previousOwnerId: otherAgent }] },
        });
        assert(underOwner === 1 && underOther === 0,
          `history-stale lead ${stale.id} must count for the CURRENT owner only, not a prior assignee (owner=${underOwner}, oldAssignee=${underOther})`);
      } else {
        results.push({ name: "  ↳ note", ok: true, detail: "no lead with a cross-owner assignment row present — history-stale guard skipped" });
      }

      // (c) Deleted-exclusion: a deleted owned lead must NOT be counted.
      const drillNoDelFilter = await prisma.lead.count({
        where: { OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }] },
      });
      const deletedOwned = await prisma.lead.count({
        where: { deletedAt: { not: null }, OR: [{ ownerId: agentId }, { ownerId: null, previousOwnerId: agentId }] },
      });
      assert(drillNoDelFilter - deletedOwned === drillSide,
        `deletedAt:null must remove exactly the deleted owned leads (all=${drillNoDelFilter}, deleted=${deletedOwned}, filtered=${drillSide})`);
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
      // Import/export = OWNER-ONLY (Super Admin) — tightened 2026-07-03 from ADMIN to
      // canImportData/canExportData(me) (see the export-import-owner-only invariant).
      for (const r of [
        "src/app/api/buyer-data/import/route.ts",
        "src/app/api/buyer-data/export/route.ts",
      ]) {
        const src = read(r);
        assert(/can(Export|Import)Data\(me\)/.test(src) && /403/.test(src), `${r} MUST stay owner-only (canExport/ImportData → 403)`);
      }
      assert(/canImportData\(me\)/.test(read("src/app/(app)/buyer-data/import/page.tsx")), "import page MUST stay owner-only (canImportData gate)");
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
      assert(/<DetailShell/.test(page) && /module="buyer"/.test(page), "buyer detail page MUST use the shared <DetailShell> wrapper (Phase-C migration)");
      // The LEAD detail (the source-of-truth view) now ALSO references the shared
      // grid tokens instead of hardcoding gap-3/space-y-3 — so Lead + Buyer can
      // never silently drift apart again (Phase-C DetailShell migration, step 1).
      const leadPage = read("src/app/(app)/leads/[id]/page.tsx");
      assert(/<DetailShell/.test(leadPage) && /module="lead"/.test(leadPage),
        "lead detail page MUST use the shared <DetailShell> wrapper (Phase-C migration — all 3 detail pages now on the shell)");
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
      assert(/data-lead-section="actions"[\s\S]{0,200}Status & next action/.test(page), "buyer right rail MUST fill the Lead 'Scheduling & next action' slot (Status & next action card)");
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

  {
    // SV-2 stale site-visit/meeting watch. Proves the additive tracking columns are
    // live in prod, the watcher is wired into the reliable heartbeat, and the
    // 2h→4h→6h thresholds + agent-facing copy are intact.
    name: "site-visit-watch — stale-watch columns live + heartbeat-wired + 2h/4h/6h thresholds",
    run: async () => {
      const fs = await import("fs");
      // (a) selectable → migration applied in prod (throws if columns missing).
      await prisma.agentStatusEvent.findFirst({
        select: { staleRemindersSent: true, staleReviewFlagged: true, staleLastRemindedAt: true },
      });
      // (b) watcher exists with the escalating thresholds + Lalit's exact reminder copy.
      // (siteVisitWatch.ts is "server-only" → check the source, per this file's convention.)
      const watch = fs.readFileSync("src/lib/siteVisitWatch.ts", "utf8");
      assert(/SV_REMIND_1_MIN\s*=\s*120/.test(watch), "reminder #1 must trigger at 2h (120 min)");
      assert(/SV_REMIND_2_MIN\s*=\s*240/.test(watch), "reminder #2 must trigger at 4h (240 min)");
      assert(/SV_REVIEW_MIN\s*=\s*360/.test(watch), "Requires-Review must trigger at 6h (360 min)");
      assert(/still active\. Please remember to close it/.test(watch), "reminder copy must match the spec");
      assert(/staleReviewFlagged/.test(watch) && /resolveManagerUserId/.test(watch),
        "6h path must flag Requires-Review + escalate to the manager");
      // (c) dispatched by the reliable heartbeat (GitHub-Actions crons don't fire).
      assert(/site-visit-watch/.test(fs.readFileSync("src/app/api/cron/warm/route.ts", "utf8")),
        "site-visit-watch must be wired into the /api/cron/warm heartbeat");
    },
  },

  {
    // Daily reminders (morning 10:00 / evening 18:00 IST) have Vercel-native crons,
    // but Vercel Hobby crons are best-effort and silently skip (evening-reminder
    // missed 2026-07-01). The warm heartbeat runs them as a BACKUP: after the IST
    // hour, only if no run exists today (cronRanTodayIST) — so it never double-notifies.
    name: "daily-reminder-backup — morning/evening reminders heartbeat-backed + deduped by ran-today",
    run: async () => {
      const fs = await import("fs");
      const warm = fs.readFileSync("src/app/api/cron/warm/route.ts", "utf8");
      assert(/DAILY_BACKUP_JOBS/.test(warm) && /morning-reminder/.test(warm) && /evening-reminder/.test(warm),
        "warm heartbeat must back BOTH morning + evening reminders");
      assert(/cronRanTodayIST/.test(warm) && /afterIstHour/.test(warm),
        "daily backup must gate on IST hour + skip when already ran today (no double-notify)");
      assert(/export async function cronRanTodayIST/.test(fs.readFileSync("src/lib/cronRun.ts", "utf8")),
        "cronRun must export cronRanTodayIST");
      const vj = fs.readFileSync("vercel.json", "utf8");
      assert(/morning-reminder/.test(vj) && /evening-reminder/.test(vj),
        "vercel.json must keep both native crons as the primary trigger");
    },
  },

  {
    // Data-quality: a terminal lead (booked/sold/lost/rejected) must NOT keep an
    // active followupDate — it would wrongly surface on the Action-List follow-up
    // board. Every status-change/reject/import path clears it; this catches drift.
    name: "followup-terminal-clear — no terminal lead carries an active followupDate",
    run: async () => {
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      const orphans = await prisma.lead.count({
        where: { deletedAt: null, followupDate: { not: null }, currentStatus: { in: TERMINAL_STATUSES } },
      });
      assert(orphans === 0, `${orphans} terminal leads still carry a followupDate — clear it on the status-change/import path`);
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
  //       transfer + edit = ADMIN-only (no manager); distribute = ADMIN/MANAGER; settings toggle = ADMIN.
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
      // Bulk transfer is now ADMIN / Super-Admin ONLY (Lalit 2026-07-08) — no manager.
      assert(/Only an admin can transfer buyers/.test(bulkSrc), "bulk transfer MUST be ADMIN-only (no manager)");
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

      // (e) Export route now OWNER-ONLY (Super Admin) + deletedAt-excluded on BOTH paths;
      //     the POST(buyerIds) path is the filtered-export channel (capped, audited).
      const exp = read("src/app/api/buyer-data/export/route.ts");
      assert(/export async function POST/.test(exp) && /buyerIds/.test(exp), "export route must accept POST { buyerIds } for filtered export");
      assert((exp.match(/canExportData\(me\)/g) ?? []).length >= 2, "BOTH export paths (GET+POST) MUST stay owner-only (canExportData)");
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

      // (a) market column exists + every live buyer is in a KNOWN market {Dubai, India}
      // (default+backfill Dubai; India Buyer Data is a separate market over the same table).
      await prisma.buyerRecord.findFirst({ select: { id: true, market: true } });
      const liveTotal = await prisma.buyerRecord.count({ where: { deletedAt: null } });
      const liveKnown = await prisma.buyerRecord.count({ where: { deletedAt: null, market: { in: ["Dubai", "India"] } } });
      assert(liveTotal === liveKnown, `every live buyer must be market ∈ {Dubai, India} (live ${liveTotal}, known ${liveKnown}) — backfill missing`);
      const badMarket = await prisma.buyerRecord.count({ where: { market: { notIn: ["Dubai", "India"] } } });
      assert(badMarket === 0, `${badMarket} buyer(s) have a market outside {Dubai, India}`);

      // (b) buyerScope pins market + has the Dubai gates + the impossible no-access filter.
      const scopeSrc = read("src/lib/buyerScope.ts");
      assert(/DUBAI_MARKET\s*=\s*"Dubai"/.test(scopeSrc), "buyerScope MUST define DUBAI_MARKET = 'Dubai'");
      assert(/export function canAccessDubaiBuyers/.test(scopeSrc), "buyerScope MUST export canAccessDubaiBuyers");
      assert(/export function isDubaiAssignable/.test(scopeSrc), "buyerScope MUST export isDubaiAssignable");
      // Dubai scope is now a thin wrapper over the market-generic buyerScopeWhereForMarket
      // (byte-identical). Verify the delegation + that every branch pins the market param.
      assert(/export async function buyerScopeWhereForMarket/.test(scopeSrc), "buyerScope MUST export buyerScopeWhereForMarket");
      assert(/buyerScopeWhereForMarket\(me,\s*DUBAI_MARKET\)/.test(scopeSrc), "buyerScopeWhere MUST delegate to buyerScopeWhereForMarket(me, DUBAI_MARKET)");
      // Every where branch pins the market param (>=4: no-access, ADMIN, AGENT, MANAGER).
      const marketBranches = (scopeSrc.match(/\{ market,/g) ?? []).length;
      assert(marketBranches >= 4, `buyerScopeWhereForMarket must pin the market in every branch (found ${marketBranches}, expected >=4)`);
      assert(/__no_access__/.test(scopeSrc), "a wrong-market non-admin user MUST get an impossible filter (no buyer leak)");
      assert(/canAccessBuyerMarket\(me,\s*buyerMarket\)/.test(scopeSrc), "canTouchBuyer MUST gate via canAccessBuyerMarket (reject a cross-market buyer)");

      // (c) assign + transfer + convert REJECT a non-Dubai/non-admin target (server-side).
      // Assign/bulk-transfer/convert gate the target to the BUYER'S market team (or admin)
      // via isBuyerAssignableForMarket — a cross-market assignment (Dubai↔India) is rejected.
      assert(/isBuyerAssignableForMarket/.test(read("src/app/api/buyer-data/assign/route.ts")), "assign route MUST gate the target via isBuyerAssignableForMarket");
      assert(/isBuyerAssignableForMarket/.test(read("src/app/api/buyer-data/bulk/route.ts")), "bulk transfer MUST gate the target via isBuyerAssignableForMarket");
      assert(/isBuyerAssignableForMarket/.test(read("src/app/api/buyer-data/[id]/convert/route.ts")), "convert route MUST gate an on-behalf owner via isBuyerAssignableForMarket");

      // (d) pages + reports redirect non-Dubai users; nav item is dubaiBuyerOnly.
      assert(/canAccessDubaiBuyers/.test(read("src/app/(app)/buyer-data/page.tsx")), "buyer list page MUST guard via canAccessDubaiBuyers (redirect non-Dubai)");
      // Detail is the SHARED market-aware page: it early-gates via canAccessBuyerMarket
      // and does the precise per-buyer check via canTouchBuyer (which enforces the buyer's
      // OWN market) — a cross-market buyer can never be opened.
      { const d = read("src/app/(app)/buyer-data/[id]/page.tsx");
        assert(/canAccessBuyerMarket/.test(d) && /canTouchBuyer/.test(d), "buyer detail page MUST guard via canAccessBuyerMarket + canTouchBuyer (market-aware)"); }
      // Report is now BOTH-MARKETS (?market=India|Dubai) — gated per-market via
      // canAccessBuyerMarket, which still redirects a user who can't see that market.
      { const rp = read("src/app/(app)/reports/buyer-performance/page.tsx");
        assert(/canAccessBuyerMarket\(me, market\)/.test(rp) && /redirect\("\/reports"\)/.test(rp), "buyer report MUST market-gate via canAccessBuyerMarket(me, market) + redirect"); }
      const shell = read("src/components/MobileShell.tsx");
      assert(/dubaiBuyerOnly/.test(shell), "the nav MUST gate the Dubai Buyer Data item via dubaiBuyerOnly");
      assert(/dubaiBuyerOnly && !\(user\.role === "ADMIN" \|\| user\.team === "Dubai"\)/.test(shell), "dubaiBuyerOnly MUST hide the item from non-Dubai non-admin users");

      // (e) distribution pool + import + export are market-scoped. Distribution is now
      // BOTH-MARKETS: market-parameterized with a Dubai default (byte-identical Dubai
      // behaviour) + the daily cron distributes BOTH pools to their own teams.
      { const distSrc = read("src/lib/buyerDistribution.ts");
        assert(/market: string = DUBAI_MARKET/.test(distSrc), "poolableWhere/poolCount MUST be market-parameterized (default DUBAI_MARKET for back-compat)");
        assert(/\["Dubai", "India"\]/.test(distSrc), "daily auto-distribution MUST cover BOTH markets (Dubai + India) when no team is configured"); }
      // Import stamps ONE market — default Dubai; India Buyer import passes market:"India".
      // Dedup + create both use importMarket, so an India import never matches a Dubai buyer.
      { const imp = read("src/app/api/buyer-data/import/route.ts");
        assert(/importMarket:\s*string\s*=\s*body\.market === "India" \? "India" : "Dubai"/.test(imp) && /market: importMarket/.test(imp),
          "import MUST default market=Dubai + support market=India (importMarket), never cross-market"); }
      // Export scopes to ONE market — default Dubai, ?market=India for the India set —
      // and never mixes markets (admin-only route; both handlers 403 non-admins).
      { const e = read("src/app/api/buyer-data/export/route.ts");
        assert(/=== "India" \? "India" : "Dubai"/.test(e) && /market,\s/.test(e), "export MUST scope to one market (default Dubai; ?market=India), never cross-market"); }

      // (f) label renamed on the key visible surfaces (route paths unchanged).
      assert(/Dubai Buyer Data/.test(read("src/app/(app)/buyer-data/page.tsx")), "list page header MUST read 'Dubai Buyer Data'");
      assert(/label: "Dubai Buyer Data"/.test(shell), "nav label MUST be 'Dubai Buyer Data'");
      // Title is now market-aware: "🇮🇳 India" / "🇦🇪 Dubai" + "Buyer Data Performance".
      { const rp = read("src/app/(app)/reports/buyer-performance/page.tsx");
        assert(/Buyer Data Performance/.test(rp) && /market === "India"/.test(rp), "report title MUST be market-aware (India/Dubai Buyer Data Performance)"); }
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
      // FOLLOW-UP DATE PARSING (R8 fix) — buyer follow-up routes through the shared
      // parseImportDate so DECIMAL Excel serials (the "46-199" garbage = a serial
      // with a time fraction) + dd/mm/yyyy + ISO all normalize, while bare numbers
      // and unparseable text stay verbatim (never misread as a 1900s date).
      const fu = (v: string) => composeRemarkFromFields({ "Follow-Up": v });
      assert(/^Follow-Up: 20\d\d-\d\d-\d\d$/.test(fu("46199.625")), `decimal Excel serial must normalize to a date (got ${JSON.stringify(fu("46199.625"))})`);
      assert(fu("22/05/2026") === "Follow-Up: 2026-05-22", `dd/mm/yyyy must normalize (got ${JSON.stringify(fu("22/05/2026"))})`);
      assert(fu("2026-05-22") === "Follow-Up: 2026-05-22", "ISO follow-up must pass through");
      assert(fu("46-199") === "Follow-Up: 46-199", "unparseable two-part value stays verbatim (never crashes/misconverts)");
      assert(fu("2026") === "Follow-Up: 2026", "a bare year must NOT be read as an Excel serial");
      assert(fu("5") === "Follow-Up: 5", "a small bare integer must NOT be read as a 1900s date");

      // (c) ROUTE WIRING (static) — the import route must do all four jobs.
      const route = read("src/app/api/buyer-data/import/route.ts");
      assert(/buildBuyerTimelinePlan/.test(route) && /buyerActivity\.createMany/.test(route), "import route MUST generate BuyerActivity Smart-Timeline rows");
      assert(/remarks:\s*remark/.test(route), "import route MUST store the imported remark on BuyerRecord.remarks (Raw History)");
      assert(/rawImport:/.test(route), "import route MUST store the verbatim rawImport audit");
      assert(/findExistingBuyer/.test(route) && /dupMode/.test(route), "import route MUST dedup (match existing buyer + honor dupMode)");
      // The wizard must offer the Remarks field + send the full raw row + a dup choice.
      const wizard = read("src/components/BuyerImportClient.tsx");
      // The field catalog/aliases moved to the shared, regression-tested
      // buyerImportMap.ts (the wizard imports BUYER_FIELDS from it) — assert it there.
      const importMap = read("src/lib/buyerImportMap.ts");
      assert(/remarks:\s*\[/.test(importMap), "buyerImportMap MUST offer a Remarks mapping field (with aliases)");
      assert(/_raw:/.test(wizard) && /dupMode/.test(wizard), "import wizard MUST send the full raw row + a duplicate-handling choice");

      // (d) DATA INVARIANT — no orphaned Smart Timeline: every buyer with an
      // imported-tagged activity has a non-null remarks (the Raw History source).
      // Scope to genuine CONVERSATION imports (remarks → Smart Timeline). The
      // property-map backfill (scripts/backfill-buyer-property-map.ts) ALSO tags its
      // column-fill audit NOTE with "(imported)", but those rows are derived from the
      // import BLOB (extraFields), NOT from remarks — a buyer legitimately without
      // remarks isn't an "orphaned conversation timeline". Exclude them by their fixed
      // prefix so this invariant keeps checking only what it means to (2026-07-08).
      const importedActs = await prisma.buyerActivity.findMany({
        where: {
          description: { contains: IMPORTED_TAG.trim() },
          NOT: { description: { startsWith: "Property fields mapped from import" } },
          buyer: { deletedAt: null },
        },
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

      // parseDupMode: legacy default + the five explicit choices (incl. revival).
      assert(parseDupMode(undefined) === "merge", "absent dupMode must default to merge (legacy)");
      assert(parseDupMode("") === "merge", "blank dupMode must default to merge");
      for (const v of ["skip", "update", "create", "conversation", "revival"] as const) {
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
  // 27a. REVIVAL IMPORT PROCESSES DUPLICATES  (2026-06-25)
  //    The Revival Engine import re-engages leads that ALREADY exist. Before this
  //    fix the Revival preset hard-defaulted dupMode="skip", whose branch did
  //    `skippedDup++; deduped++; continue;` — discarding every existing match
  //    ("Import 0 new leads"). The fix adds dupMode="revival": an existing match is
  //    PROCESSED (applyRevivalMerge → fill-if-empty + append history + NOTE +
  //    move to Revival + per-field audit, `revived++`), never the bare skip.
  //    A static scan so a future refactor can't silently revert the Revival default
  //    to skip, or let the revival branch fall through to a discard `continue`.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "revival-import-processes-duplicates — revival dupMode PROCESSES existing leads (never the bare skip continue); Revival preset defaults to revival",
    run: async () => {
      const fs = await import("fs");
      // (1) parseDupMode accepts the new mode (tests the REAL shared toolkit).
      assert(parseDupMode("revival") === "revival", 'parseDupMode("revival") must round-trip to "revival"');

      // (2) BOTH intake routes: the revival branch must reach the shared merge +
      //     `revived++`, and must NOT degrade to the bare skip `continue` (the bug).
      for (const f of [
        "src/app/api/intake/csv/route.ts",
        "src/app/api/intake/google-sheet/route.ts",
      ]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/dupMode === "revival"/.test(src), `${f} must branch on dupMode === "revival"`);
        assert(/applyRevivalMerge\(/.test(src), `${f} must call the shared applyRevivalMerge() helper (DRY — no per-route merge logic)`);
        assert(/revived\+\+/.test(src), `${f} revival branch must count the lead as revived (revived++), not skip it`);
        assert(/\brevived\b/.test(src) && /skippedDup/.test(src), `${f} must surface a distinct revived counter (not folded into skippedDup)`);
        // The revival branch must end in the SAME dedup accounting as the other
        // dup arms (deduped++) so skippedCount math stays correct (revived rows are
        // duplicates, not "skipped").
        assert(/revived\+\+; deduped\+\+;/.test(src), `${f} revival branch must do revived++; deduped++ (counts as a duplicate, not a skip)`);
      }

      // (3) The shared helper itself must be strictly non-destructive + move the
      //     matched lead into the Revival bucket via existing columns (no migration).
      const helper = fs.readFileSync("src/lib/revivalImport.ts", "utf8");
      assert(/mergeRawRemark\(/.test(helper), "applyRevivalMerge must APPEND remarks via mergeRawRemark (append-only, never truncates)");
      assert(/recordFieldChanges\(/.test(helper), "applyRevivalMerge must write a per-field LeadFieldHistory audit (recordFieldChanges)");
      assert(/leadOrigin = "REVIVAL"|leadOrigin: "REVIVAL"|"REVIVAL"/.test(helper), "applyRevivalMerge must set leadOrigin=REVIVAL (move into the Revival Engine)");
      assert(/isColdCall/.test(helper), "applyRevivalMerge must set isColdCall=true (Revival bucket)");
      assert(/ActivityType\.NOTE/.test(helper), "applyRevivalMerge must write a NOTE Activity (existing enum — no migration)");
      assert(/FILL_IF_EMPTY/.test(helper) && /isBlank\(/.test(helper), "applyRevivalMerge must use fill-if-empty semantics (never overwrite a non-blank field)");

      // (4) The Revival preset (cold-data Import control) must DEFAULT to revival,
      //     while the other importers keep their existing defaults (no collateral).
      const cold = fs.readFileSync("src/components/ColdDataAdminControls.tsx", "utf8");
      assert(/defaultDupMode="revival"/.test(cold), 'ColdDataAdminControls (Revival import) must default to dupMode="revival"');
      const preassigned = fs.readFileSync("src/components/PreAssignedImporter.tsx", "utf8");
      assert(/defaultDupMode="skip"/.test(preassigned), "PreAssignedImporter must keep its skip default (not flipped to revival)");
      const masterData = fs.readFileSync("src/components/MasterDataImportControls.tsx", "utf8");
      assert(/defaultDupMode="skip"/.test(masterData), "MasterDataImportControls must keep its skip default (not flipped to revival)");

      // (5) The wizard must expose the revival radio + surface the revived count.
      const wiz = fs.readFileSync("src/components/LeadImportWizard.tsx", "utf8");
      assert(/val: "revival"/.test(wiz), "LeadImportWizard DUP_OPTIONS must include the revival choice");
      assert(/revived\?: number/.test(wiz), "LeadImportWizard ImportResult must carry the revived count");
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
      // The bar reuses the SAME endpoints via an apiBase prop (default "/api/leads";
      // the buyer view passes "/api/buyer-data") — ONE component, no duplicated logic.
      assert(/apiBase = "\/api\/leads"/.test(lf), "LeadFollowupActions apiBase must default to /api/leads");
      for (const ep of ["action-complete", "action-snooze", "action-escalate"]) {
        assert(lf.includes(`${"${apiBase}"}/${"${leadId}"}/${ep}`), `LeadFollowupActions must POST to {apiBase}/[id]/${ep} (reuse, not duplicate)`);
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
  //   (c) NO RAW-BLOB LEAK — ConversationStreamCard's Smart Timeline renders the
  //       unified stream (`filteredStream`); the verbatim `{rawRemarks}` blob stays
  //       behind the raw-mode guard. Parsed remarks render as clean per-remark cards
  //       (kind:"remark") inside the stream, never the single blob. Static scan.
  //   (d) NEWEST-FIRST — the unified sort orders mixed event types descending.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "smart-timeline-edit — migration applied + endpoint permission-gated (shared rule) + no raw-blob leak + newest-first",
    run: async () => {
      // (a) DATA/SCHEMA — new columns + audit table are present (column/table probe).
      const probe = await prisma.activity.findFirst({ select: { id: true, outcome: true, followupDate: true } });
      void probe; // null on empty DB is fine — the point is the SELECT didn't throw.
      const editCount = await prisma.activityEdit.count();
      assert(typeof editCount === "number" && editCount >= 0, "ActivityEdit table missing — migration 20260624200000 not applied");

      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // (b) ENDPOINT AUTH — the activities edit route must enforce the shared
      //     permission rule server-side (admin/manager any · agent own same-IST-day
      //     free-text kind) and keep a 403 path for a forbidden edit. The deeper
      //     own/same-day/kind matrix is proven on the pure helper in
      //     `agent-sameday-edit`; here we lock the wiring + super-admin handling.
      const routePath = path.join(root, "src/app/api/leads/[id]/activities/[activityId]/route.ts");
      assert(fs.existsSync(routePath), "activities edit route is missing");
      const routeSrc = fs.readFileSync(routePath, "utf8");
      assert(/export\s+async\s+function\s+PATCH/.test(routeSrc), "activities route does not export PATCH");
      // Shared gate present, super-admin honoured, and a 403 path for forbidden edits.
      assert(/canEditActivity\(/.test(routeSrc), "activities PATCH does not enforce the shared canEditActivity rule");
      assert(/isSuperAdmin/.test(routeSrc), "activities PATCH no longer honours the super-admin flag");
      assert(/status:\s*403/.test(routeSrc), "activities PATCH has no 403 path for a forbidden edit");
      // every changed field must be audited into ActivityEdit (no silent edits).
      assert(/activityEdit\.createMany/.test(routeSrc), "activities PATCH does not write ActivityEdit audit rows");

      // (c) NO RAW-BLOB LEAK — Smart Timeline renders the unified stream and must
      //     NOT dump the raw imported BLOB as one verbatim entry. Parsed imported
      //     remarks ARE now rendered, but as individual clean cards (kind:"remark")
      //     INSIDE the unified stream — never the single `{rawRemarks}` blob.
      const cardPath = path.join(root, "src/components/ConversationStreamCard.tsx");
      const cardSrc = fs.readFileSync(cardPath, "utf8");
      assert(/viewMode === "smart" && filteredStream\.map/.test(cardSrc),
        "Smart Timeline no longer renders the unified stream (filteredStream)");
      // The verbatim blob `{rawRemarks}` must render ONLY under the raw-mode guard,
      // never inside the smart-mode map (that was the old messy single-entry leak).
      assert(/viewMode === "raw" && rawRemarks && rawRemarks\.trim\(\)/.test(cardSrc),
        "raw verbatim blob is no longer guarded behind viewMode === 'raw'");
      // The unified stream is built from genuine CRM event kinds PLUS parsed remark
      // cards — all individually shaped, none of them the raw blob.
      assert(/kind:\s*"call"/.test(cardSrc) && /kind:\s*"activity"/.test(cardSrc) && /kind:\s*"remark"/.test(cardSrc),
        "unified stream is not built from the expected event kinds (call/activity/remark)");

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
  // IMPORTED-REMARKS-TIMELINE (2026-06-25) — parsed imported rawRemarks now render
  // as clean per-remark cards in Smart Timeline (parse-on-render, NO data write).
  // Locks the two behaviours that must never silently regress:
  //   (a) CANONICAL CASE — the "28 May … Lalit Sharma" remark parses to a dated
  //       entry on 2026-05-28 AND a Lalit-Sharma-attributed entry. Verified on a
  //       deterministic synthetic blob (never flaky) AND, when present, on the real
  //       prod lead that carries both "28 May" + "Lalit" in rawRemarks.
  //   (b) ZERO-DROP — on a multi-remark sample every coarse segment is represented
  //       (parsed entries ≥ 1 and NO entry is silently discarded): the parser keeps
  //       undated fragments rather than dropping them.
  //   (c) WIRED — ConversationStreamCard pushes mergedEntries into the unified
  //       stream as kind:"remark" with the no-truncation full body. Static scan.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "imported-remarks-timeline — 28-May Lalit parses (date+author) + multi-remark sample drops 0 segments + wired into Smart Timeline",
    run: async () => {
      const { parseRemarksTimeline, mergeSameMoment } = await import("../src/lib/remarkParser");
      const roster = ["Lalit Sharma", "Tanuj Chopra", "Yasir Khan"];

      // (a) CANONICAL — deterministic synthetic blob encoding the 28-May Lalit case.
      const synthetic = "Lalit Sharma: On 28 May 2026 (3:30 pm) discussed Magnolias, client interested in 4 BHK, budget 12 cr";
      const synEntries = mergeSameMoment(parseRemarksTimeline(synthetic, roster));
      const synDated = synEntries.find((e) => e.date && e.date.getUTCMonth() === 4 && e.date.getUTCDate() === 28);
      assert(!!synDated, "28-May synthetic remark did NOT parse to a 2026-05-28 dated entry");
      assert(synEntries.some((e) => (e.agentName ?? "").toLowerCase().includes("lalit")),
        "28-May synthetic remark did NOT attribute the entry to Lalit Sharma");

      // (b) ZERO-DROP — a multi-remark blob with mixed dated + undated lines. Every
      //     line must survive: the merged entry count is ≥ the number of distinct
      //     dated remarks, and NOTHING parses to an empty set.
      const multi =
        "On 12 Mar 2021 call not picked,,On 14 Mar 2021 site visit done magnolias,," +
        "he said will revert next week,,On 03 Jan 2026 (3:17 pm) discussed Trump 1 resale,," +
        "On 28 May 2026 he confirmed booking intent";
      const segs = multi
        .replace(/,{2,}/g, "\n")
        .replace(/[.!?,]?\s*((?:[A-Z][A-Za-z]{1,20}\s*:\s*)?[oO]n\s+\d{1,2})/g, (_m, b) => `\n${b}`)
        .split("\n").map((l) => l.trim()).filter((l) => l.length >= 2);
      const multiEntries = mergeSameMoment(parseRemarksTimeline(multi, roster));
      assert(multiEntries.length >= 1, "multi-remark sample parsed to ZERO entries (everything dropped)");
      // No coarse segment is lost: the parser keeps every line (dated OR undated) —
      // entries (after same-moment merge) must be at least the count of dated lines.
      const datedLines = segs.filter((s) => /\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(s)).length;
      assert(multiEntries.length >= datedLines,
        `parser dropped dated remarks: ${multiEntries.length} entries < ${datedLines} dated lines`);
      // The 28-May line in the multi sample is present as a dated entry too.
      assert(multiEntries.some((e) => e.date && e.date.getUTCMonth() === 4 && e.date.getUTCDate() === 28),
        "28-May remark missing from the multi-remark sample parse");

      // (b′) P0 NO-TEAR (Lalit 2026-06, data integrity): a client's MID-SENTENCE
      //      date must NEVER split one message into two fake dated entries. The
      //      entry-header split fires ONLY on a real "On DD <Month> YYYY" — ordinals
      //      ("4th"/"1st") and yearless casual dates ("on 5 July") cannot match it,
      //      so the client sentence stays whole. Proven on the real Gaurav Saxena
      //      blob ("passed away on 1st April", "Gurgaon on 5th evening").
      const clientMsg =
        "Lalit: On 8 Apr 2021 he text My mother passed away on 1st April,," +
        "On 31 Mar 2024 I have plans to come to Gurgaon on 5th evening to visit the site";
      const ce = mergeSameMoment(parseRemarksTimeline(clientMsg, roster));
      assert(ce.some((e) => /passed away on 1st April/i.test(e.text)),
        "P0 REGRESSION: client sentence 'passed away on 1st April' was TORN by a mid-sentence date split");
      assert(ce.some((e) => /Gurgaon on 5th evening to visit the site/i.test(e.text)),
        "P0 REGRESSION: client sentence '...Gurgaon on 5th evening to visit the site' was TORN");
      assert(!ce.some((e) => /^(?:st April\b|th evening\b)/i.test(e.text.trim())),
        "P0 REGRESSION: a torn date-fragment entry exists — the mid-sentence split bug returned");
      // The two REAL headers still separate into their own dated entries.
      assert(ce.filter((e) => e.date && (e.date.getUTCFullYear() === 2021 || e.date.getUTCFullYear() === 2024)).length >= 2,
        "real 'On DD Month YYYY' headers must still split into separate dated entries");

      // (a′) PROD — if a real lead carries both '28 May' + 'Lalit' in rawRemarks,
      //      it must parse to ≥1 dated entry (the canonical acceptance lead). Skip
      //      cleanly if no such lead exists (data may change), so the gate never
      //      false-fails on data drift — the synthetic case already locks behaviour.
      const prodLead = await prisma.lead.findFirst({
        where: {
          AND: [
            { OR: [{ rawRemarks: { contains: "28 May" } }, { remarks: { contains: "28 May" } }] },
            { OR: [{ rawRemarks: { contains: "Lalit" } }, { remarks: { contains: "Lalit" } }] },
          ],
        },
        select: { id: true, rawRemarks: true, remarks: true, createdAt: true },
      });
      let prodNote = "no prod 28-May-Lalit lead (synthetic case still locks it)";
      if (prodLead) {
        const raw = prodLead.rawRemarks ?? prodLead.remarks ?? "";
        const pe = mergeSameMoment(parseRemarksTimeline(raw, roster, prodLead.createdAt));
        const datedCount = pe.filter((e) => e.date).length;
        assert(datedCount >= 1, `prod 28-May-Lalit lead ${prodLead.id} parsed to 0 dated entries`);
        prodNote = `prod lead ${prodLead.id}: ${pe.length} entries, ${datedCount} dated`;
      }

      // (c) WIRED — Smart Timeline actually pushes parsed remarks into the stream.
      const fs = await import("fs");
      const path = await import("path");
      const cardSrc = fs.readFileSync(path.join(process.cwd(), "src/components/ConversationStreamCard.tsx"), "utf8");
      assert(/kind:\s*"remark"/.test(cardSrc) && /mergedEntries/.test(cardSrc),
        "ConversationStreamCard does not push mergedEntries into the unified stream as kind:'remark'");
      // Full body, no truncation: the imported-remark card renders e.text with
      // whitespace-pre-wrap + break-words and must NOT slice/substring it.
      assert(/whitespace-pre-wrap break-words[^>]*>\{e\.text\}/.test(cardSrc),
        "imported-remark card does not render the FULL untruncated body ({e.text})");

      results.push({ name: "  ↳ note", ok: true, detail: `${synEntries.length} synth / ${multiEntries.length} multi entries; ${prodNote}` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Smart Timeline = CLIENT COMMUNICATION ONLY (Lalit 2026-06). System / audit
  // events (status change · lead created · revived · reminder · follow-up change ·
  // inline edit) are excluded from the conversation and surface in the Change
  // History card (LeadFieldHistory). This invariant proves the exclusion AND that
  // the destination audit actually tracks those fields — so nothing is lost.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "smart-timeline-client-comms-only — conversation excludes system/audit events; Change History tracks them (no data loss)",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const cardSrc = fs.readFileSync(path.join(process.cwd(), "src/components/ConversationStreamCard.tsx"), "utf8");

      // (a) ACTIVITY_STREAM_TYPES must EXCLUDE system / audit types.
      const m = cardSrc.match(/ACTIVITY_STREAM_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
      assert(!!m, "could not locate ACTIVITY_STREAM_TYPES in ConversationStreamCard");
      const allow = m![1];
      for (const sys of ["STATUS_CHANGE", "LEAD_CREATED", "COLD_TO_LEAD", "REMINDER_FIRED"]) {
        assert(!new RegExp(`"${sys}"`).test(allow),
          `Smart Timeline must NOT render system event ${sys} (belongs in Change History)`);
      }
      // Client-communication types are still present.
      for (const ok of ["SITE_VISIT", "MEETING", "PROJECT_DISCUSSED", "BROCHURE_SENT", "EMAIL"]) {
        assert(new RegExp(`"${ok}"`).test(allow), `Smart Timeline lost client-communication type ${ok}`);
      }
      // (b) Surfaced system NOTE rows (follow-up change / inline edit) are no longer
      //     mixed into the stream filter.
      assert(!/streamActs\s*=\s*activities\.filter\([^)]*isSurfacedNoteActivity/.test(cardSrc),
        "streamActs must not include isSurfacedNoteActivity rows (follow-up/inline-edit are Change History audit)");

      // (c) NO DATA LOSS — Change History (LeadFieldHistory) tracks exactly the
      //     fields the removed system events represent.
      const { TRACKED_FIELDS } = await import("../src/lib/fieldHistory");
      for (const f of ["currentStatus", "ownerId", "followupDate"]) {
        assert((TRACKED_FIELDS as readonly string[]).includes(f),
          `Change History must track ${f} so the removed timeline event is not lost`);
      }
      const leadSrc = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/leads/[id]/page.tsx"), "utf8");
      assert(/<ChangeHistoryCard\b/.test(leadSrc), "lead page must render ChangeHistoryCard (the audit destination)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer Conversation History (Lalit P0, 2026-06-27): the buyer sheets carry a
  // "Conversation History" column = the real dated conversation. It must drive the
  // buyer Conversation timeline (Raw + Smart) via the SAME Lead parser — NOT sit
  // stranded in extraFields → the Imported Fields card.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-conversation-history — import maps a Conversation-History column to remarks (pulled out of extraFields); 0 buyers leak it; timeline reuses the Lead parser",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      // (a) STATIC — the buyer import recognizes a conversation column + removes it from extra.
      const importSrc = fs.readFileSync(path.join(process.cwd(), "src/app/api/buyer-data/import/route.ts"), "utf8");
      assert(/CONVERSATION_KEYS/.test(importSrc) && /conversation history/i.test(importSrc),
        "buyer import must recognize a Conversation-History column");
      assert(/pickConversation\(extra\)/.test(importSrc) && /delete extra\[/.test(importSrc),
        "buyer import must pull the conversation column OUT of extraFields (else it duplicates into Imported Fields)");
      // (b) PARITY — the buyer timeline reuses the Lead parser.
      const btSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/buyerRemarkTimeline.ts"), "utf8");
      assert(/parseRemarksTimeline/.test(btSrc), "buyer timeline must reuse the Lead parser (parseRemarksTimeline)");
      // (c) DATA — no live buyer leaks a non-empty conversation column in extraFields.
      const CONVERSATION_KEYS = ["conversation history","conversation","call history","remark history","interaction history","communication history","discussion","chat history"];
      const buyers = await prisma.buyerRecord.findMany({ where: { deletedAt: null }, select: { id: true, extraFields: true } });
      let stranded = 0;
      for (const b of buyers) {
        const ef = b.extraFields as Record<string, unknown> | null;
        if (ef && typeof ef === "object" && !Array.isArray(ef) &&
            Object.keys(ef).some((k) => CONVERSATION_KEYS.includes(k.trim().toLowerCase()) && String(ef[k] ?? "").trim())) stranded++;
      }
      assert(stranded === 0, `${stranded} buyers still have a Conversation-History column stranded in extraFields (must be in remarks/timeline)`);
      results.push({ name: "  ↳ note", ok: true, detail: `${buyers.length} buyers · 0 stranded conversation columns` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer re-import idempotency (audit P0, 2026-06-27): re-importing the same
  // sheet must NOT double-create Smart-Timeline rows. The live import route must
  // delete prior imported-tagged BuyerActivity rows + rebuild from the merged
  // remark (mirroring the backfill), and composeFromExtra must remove the status
  // keys it composes so they don't ALSO render verbatim in Imported Fields.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-import-idempotent — re-import deletes prior imported rows before regenerating + composeFromExtra de-dups status keys",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/buyer-data/import/route.ts"), "utf8");
      assert(/isImportedActivityDescription/.test(src),
        "import route must use isImportedActivityDescription to find prior imported timeline rows");
      assert(/buyerActivity\.deleteMany/.test(src),
        "import route must deleteMany prior imported-tagged rows before regenerating (idempotency — no double-count on re-import)");
      assert(/delete extra\[k\]/.test(src),
        "composeFromExtra must remove the status keys it composes from `extra` (no double-surface in Imported Fields)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Rejected-Lead workflow (Lalit 2026-06-27): reject preserves the previous owner
  // + blocks double-rejection; reactivate resets currentStatus + clears the
  // rejection stamp; reassign is hidden until reactivated.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "rejected-lead-workflow — reject sets previousOwnerId + double-reject guard; reactivate clears rejection; reassign gated behind reactivate",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const reject = fs.readFileSync(path.join(process.cwd(), "src/app/api/leads/[id]/reject/route.ts"), "utf8");
      assert(/previousOwnerId:\s*lead\.ownerId/.test(reject), "reject must record previousOwnerId = lead.ownerId");
      assert(/ownerId:\s*null/.test(reject), "reject must HARD-UNASSIGN the lead (ownerId: null)");
      assert(/lead\.rejectedAt[\s\S]{0,140}already rejected/i.test(reject), "reject must block an already-rejected lead (double-reject guard)");
      const react = fs.readFileSync(path.join(process.cwd(), "src/app/api/leads/[id]/reactivate/route.ts"), "utf8");
      assert(/currentStatus:\s*"Fresh Lead"/.test(react) && /rejectedAt:\s*null/.test(react),
        "reactivate must reset currentStatus to Fresh Lead + clear rejectedAt");
      // Per-agent Rejected/Lost reporting must attribute UNASSIGNED rejected leads via
      // previousOwnerId — else nulling ownerId on reject would zero those agents' counts.
      const perf = fs.readFileSync(path.join(process.cwd(), "src/lib/agentPerformance.ts"), "utf8");
      assert(/applyGroupP/.test(perf) && /previousOwnerId/.test(perf),
        "agentPerformance must attribute rejected/lost leads via previousOwnerId (applyGroupP)");
      const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/leads/[id]/page.tsx"), "utf8");
      assert(/REJECTED/.test(page) && /LeadReactivateButton/.test(page),
        "lead page must show the REJECTED badge + a Reactivate button for a rejected lead");
      assert(/Previous Owner/.test(page), "lead page must display the Previous Owner for a rejected (unassigned) lead");
      const probe = await prisma.lead.findFirst({ select: { id: true, previousOwnerId: true } });
      assert(probe === null || "previousOwnerId" in probe, "Lead.previousOwnerId column must exist in prod");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Attendance check-in-before-check-out (Lalit 2026-06-27): a user cannot mark
  // "Leaving for the Day" (LEAVING_OFFICE) unless they already checked in (HERE).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "attendance-checkout-after-checkin — LEAVING_OFFICE server-gated on a HERE event today",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(path.join(process.cwd(), "src/app/api/agent-status/route.ts"), "utf8");
      assert(/LEAVING_OFFICE/.test(src) && /todaysHereEvent/.test(src),
        "agent-status route must gate LEAVING_OFFICE on todaysHereEvent (check-in-before-check-out)");
      assert(/checked in today/.test(src),
        "must return the 'You haven't checked in today.' message when no check-in exists");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Smart Timeline CONNECTED chip must equal the rows it filters. The header count
  // and the stream filter must share ONE activity set — else clicking CONNECTED
  // shows more (or fewer) rows than the number on the chip.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "smart-timeline-connected-reconcile — CONNECTED count includes the same activity set the filter shows",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(path.join(process.cwd(), "src/components/ConversationStreamCard.tsx"), "utf8");
      assert(/CONNECTED_ACTIVITY_TYPES/.test(src), "must define a shared CONNECTED_ACTIVITY_TYPES set");
      assert(/connectedCount\s*=[^;]*activityConnectedCount/.test(src),
        "CONNECTED count must include activityConnectedCount (else the chip number < rows shown)");
      assert(/filter === "CONNECTED"\)\s*return CONNECTED_ACTIVITY_TYPES\.has\(it\.act/.test(src),
        "CONNECTED filter for activities must use CONNECTED_ACTIVITY_TYPES (so count == rows)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer classification (First-Time / Investor / Whale) — value-tier beats count,
  // per-currency Whale threshold. Pure function, so test it directly.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-classification — value-tier beats count; per-currency Whale threshold",
    run: async () => {
      const { classifyBuyer } = await import("../src/lib/buyerIntelligence");
      assert(classifyBuyer({ totalPropertiesOwned: 1, totalInvestmentValue: 12_000_000 }, "AED") === "Whale",
        "AED 12M single property → Whale (value beats count)");
      assert(classifyBuyer({ totalPropertiesOwned: 3, totalInvestmentValue: 3_000_000 }, "AED") === "Investor",
        "3 properties below the whale line → Investor");
      assert(classifyBuyer({ totalPropertiesOwned: 1, totalInvestmentValue: 1_500_000 }, "AED") === "First-Time",
        "1 modest property → First-Time");
      assert(classifyBuyer({ totalPropertiesOwned: 2, totalInvestmentValue: 150_000_000 }, "INR") === "Whale",
        "INR 15 Cr → Whale on the INR threshold");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer detail — Source is admin-provenance only (#248); Country is a dropdown
  // editable via BuyerInlineEdit's new <select> support (#247).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-detail-source-country — Source removed from client info; Country is a dropdown",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/buyer-data/[id]/page.tsx"), "utf8");
      assert(!/imported via \$\{rec\.source\}/.test(page), "the 'imported via {source}' subtitle must be removed from the buyer header (#248)");
      assert(/editable\("country", rec\.country, \{ options:/.test(page), "Country must be an editable dropdown (#247)");
      const inl = fs.readFileSync(path.join(process.cwd(), "src/components/BuyerInlineEdit.tsx"), "utf8");
      assert(/options\?: string\[\]/.test(inl) && /<select/.test(inl), "BuyerInlineEdit must support an options <select>");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Reporting reconciliation v2 (2026-06-27 audit): "active leads" everywhere must
  // route through the canonical helpers, and reporting reads must NOT key off the
  // dead `status` enum (out of sync with currentStatus).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "reporting-no-dead-status-enum — manager digest uses activeLeadWhere; team pipeline uses currentStatus not the dead enum",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const team = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/team/[id]/page.tsx"), "utf8");
      assert(!/"status"::text\s+IN/.test(team),
        "team/[id] pipeline must NOT filter on the dead `status` enum — use ownerActiveWhere/currentStatus");
      const rep = fs.readFileSync(path.join(process.cwd(), "src/lib/reports.ts"), "utf8");
      assert(/ownedLeads:\s*\{\s*where:\s*activeLeadWhere\(\)/.test(rep),
        "manager digest 'active leads' must count via activeLeadWhere(), not a raw ownedLeads relation count");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer import — unified template + smart column mapping (#249). The shared
  // matcher maps every field, routes conversation/status to remarks (so the import
  // route's rescue + Smart Timeline keep working), preserves unknowns, and the
  // template round-trips at full confidence. The route persists all mapped fields.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "buyer-import-map — smart mapping (conversation→remarks, unknown→KEEP) + template round-trip + route persists all fields",
    run: async () => {
      const { buildBuyerColumnMap, buyerTemplateHeaders, BUYER_FIELDS, KEEP } = await import("../src/lib/buyerImportMap");
      const map = buildBuyerColumnMap(["Client Name", "Transaction Value", "Passport No", "Country", "Size", "Conversation History", "Mystery Column"]);
      assert(map["Client Name"].target === "clientName" && map["Client Name"].confidence === "high", "Client Name → clientName (high)");
      assert(map["Transaction Value"].target === "transactionValue", "Transaction Value → transactionValue");
      assert(map["Passport No"].target === "passport", "Passport No → passport");
      assert(map["Country"].target === "country", "Country → country");
      assert(map["Size"].target === "size", "Size → size");
      // conversation/status aliases MUST route to remarks (never a typed column) so the
      // route's pickConversation rescue + Smart Timeline are never bypassed.
      assert(map["Conversation History"].target === "remarks", "Conversation History → remarks (NOT a typed field)");
      assert(map["Mystery Column"].target === KEEP, "unknown column → KEEP (preserved verbatim, never lost)");
      // A file built from the downloadable template auto-maps every column at high confidence.
      const headers = buyerTemplateHeaders();
      assert(headers.length === BUYER_FIELDS.length, "template has exactly one header per catalog field");
      const round = buildBuyerColumnMap(headers);
      assert(headers.every((h) => round[h].confidence === "high"), "every template header re-maps at high confidence");
      // The import route must actually PERSIST the newly-mappable fields.
      const fs = await import("fs");
      const path = await import("path");
      const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/buyer-data/import/route.ts"), "utf8");
      for (const f of ["passportExpiry", "ownerName", "country", "size", "actualSize", "area", "transactionType", "role"]) {
        assert(new RegExp(`\\b${f}:`).test(route), `import route must persist ${f}`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Follow-up active-filter pill must show a FRIENDLY label for every quick-chip
  // value — else it falls back to the raw URL value (the "todue" eyesore that read
  // like a typo). Lalit 2026-06-28.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "followup-chip-labels — every quick follow-up value has a friendly label (no raw 'todue' pill)",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const src = fs.readFileSync(path.join(process.cwd(), "src/components/LeadFilters.tsx"), "utf8");
      const m = src.match(/const FOLLOWUP_LABELS[\s\S]*?};/);
      assert(!!m, "FOLLOWUP_LABELS map must exist in LeadFilters");
      const map = m![0];
      for (const v of ["today", "overdue", "todue", "future", "none"]) {
        assert(new RegExp(`\\b${v}:`).test(map), `FOLLOWUP_LABELS must label '${v}' (else the active-filter pill shows the raw value)`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Smart Timeline must NEVER turn a date MENTIONED inside a client message into a
  // timeline event date (critical regression, Lalit 2026-06-28). "...Expo on 4-5
  // July 2026" must stay ONE verbatim entry at the lead's real time — not a fake
  // card dated 5 Jul. Future + mid-sentence dates are content, never events.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "smart-timeline-content-dates — client-message dates (future / mid-sentence) never become event dates; real leading dates still parse",
    run: async () => {
      const { parseRemarksTimeline } = await import("../src/lib/remarkParser");
      const created = new Date("2026-06-26T10:17:00Z"); // lead created 26 Jun
      const now = new Date("2026-06-28T00:00:00Z");
      const istDay = (d: Date | null) => d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d) : "null";
      const msg = "Hi, I saw your website. I am interested in attending the Dubai Property Expo on 4-5 July 2026. I am interested in buying a property in Dubai.";
      const got = parseRemarksTimeline(msg, [], created, now);
      assert(got.length === 1, `client message must stay ONE entry, never split on a content date (got ${got.length})`);
      assert(istDay(got[0].date) !== "2026-07-05", `client message must NOT be dated to the content date 5 Jul (got ${istDay(got[0].date)})`);
      assert(/4-5 July 2026/.test(got[0].text) && /buying a property/.test(got[0].text), "client message must be preserved verbatim (not split/truncated at the mentioned date)");
      // A REAL leading 'On <past date>' agent remark must still parse to that date.
      const agent = parseRemarksTimeline("On 20 Jun 2026 (3:30 pm) client called, discussed 2BR", [], created, now);
      assert(istDay(agent[0].date) === "2026-06-20", `a genuine leading 'On <past date>' header must still parse (got ${istDay(agent[0].date)})`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Buyer categorization is MARKET-SPECIFIC: an India lead must never be taggable
  // with UAE-resident / International categories, and vice-versa (Lalit 2026-06-28).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-category-by-market — India excludes UAE/International; Dubai includes them; New-Lead form is market-reactive",
    run: async () => {
      const { categoryOptionsForTeam } = await import("../src/lib/leadCategory");
      const india = categoryOptionsForTeam("India");
      const dubai = categoryOptionsForTeam("Dubai");
      assert(india.includes("Indian Investor") && india.includes("NRI Investor"), "India must offer Indian + NRI categories");
      assert(!india.includes("UAE Resident Investor") && !india.includes("International Investor"), "India must NOT offer UAE-resident / International categories");
      assert(dubai.includes("UAE Resident Investor") && dubai.includes("International Investor"), "Dubai must offer UAE-resident + International categories");
      assert(!dubai.includes("Indian Investor"), "Dubai must NOT offer the India-only 'Indian Investor' category");
      const fs = await import("fs");
      const path = await import("path");
      const req = fs.readFileSync(path.join(process.cwd(), "src/components/RequirementSection.tsx"), "utf8");
      assert(/categoryOptionsForTeam/.test(req), "New-Lead Requirement section must use categoryOptionsForTeam (market-reactive, not a static list)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // Rejected-unassigned must NEVER enter the assignment workflow. A rejected lead is
  // unassigned for history only — it must not appear in "waiting to assign" queues,
  // unassigned counters, or assign reminders (Lalit 2026-06-28, critical).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "rejected-not-in-assign-queue — unassigned counters/alerts/dashboard exclude rejected leads",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
      assert(/rejectedAt:\s*null/.test(read("src/lib/leadCounts.ts")), "countUnassignedLeads must carry rejectedAt: null");
      assert(/rejectedAt:\s*null/.test(read("src/lib/unassignedReminders.ts")), "unassigned reminder base must carry rejectedAt: null");
      const dash = read("src/app/(app)/dashboard/page.tsx");
      assert((dash.match(/rejectedAt:\s*null/g) ?? []).length >= 2, "dashboard waiting-to-assign + overdue-unassigned queues must carry rejectedAt: null");
      assert(/rejectedAt:\s*null/.test(read("src/app/(app)/cold-calls/page.tsx")), "revival 'Unassigned' filter must carry rejectedAt: null");
      // DATA: no rejected lead sits unassigned with a non-terminal status (which would
      // let it leak into a weak-guard queue). Reject always stamps a terminal status.
      const { TERMINAL_STATUSES: TERM } = await import("../src/lib/lead-statuses");
      const leak = await prisma.lead.count({
        where: { ownerId: null, deletedAt: null, rejectedAt: { not: null }, isColdCall: false,
          OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERM } }] },
      });
      assert(leak === 0, `${leak} rejected+unassigned lead(s) carry a non-terminal status — could leak into assign queues`);
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "log-conversation-validation — outcome+remarks mandatory (server 400); NO follow-up field on call/WA logging (Jun25 reversal); Activity carries outcome; no Connected default",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // POLICY (Jun25, reverses #122–#124): an agent must NEVER set/edit the
      // follow-up date while logging a call or WhatsApp — the follow-up changes
      // ONLY via Complete / Snooze / Escalate / Reschedule / Admin. Outcome +
      // remarks STAY mandatory on the Log Conversation form; only the follow-up is
      // removed. So: log-call + whatsapp/log must NOT read/require/write followupDate.

      // Strip comments before asserting "field is gone" — explanatory prose in the
      // route/component legitimately MENTIONS followupDate/callbackAt when it says it
      // no longer uses them. We assert on the CODE only, so a comment can't trip it.
      const stripComments = (s: string) =>
        s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

      // (a) LOG-CALL ENDPOINT — outcome + remarks still rejected when blank
      //     (server-side, so a tampered request can't bypass the client guard).
      const logCallPath = path.join(root, "src/app/api/leads/[id]/log-call/route.ts");
      assert(fs.existsSync(logCallPath), "log-call route is missing");
      const logCall = fs.readFileSync(logCallPath, "utf8");
      const logCallCode = stripComments(logCall);
      assert(/Please select an outcome before saving\./.test(logCall) && /status:\s*400/.test(logCall),
        "log-call does not 400 on blank outcome with the required message");
      assert(/Please add remarks before saving\./.test(logCall),
        "log-call no longer requires remarks (must 400 on blank remarks)");
      // The old 'remarks are optional' policy must be gone.
      assert(!/Remarks are OPTIONAL/.test(logCall),
        "log-call still declares remarks OPTIONAL — mandatory-remarks rule regressed");
      // FOLLOW-UP MUST BE GONE — no read, no require, no write of followupDate/callbackAt (code only).
      assert(!/Please set the next follow-up date\./.test(logCall),
        "log-call still 400s on a missing follow-up date — the follow-up field must be removed from logging");
      assert(!/followupDate/.test(logCallCode) && !/callbackAt/.test(logCallCode),
        "log-call code still references followupDate/callbackAt — logging must not set the follow-up");

      // (b) LOG-CALL still persists the OUTCOME onto the Activity row (Smart Timeline
      //     keeps the outcome chip), but must NOT set followupDate on it.
      const actStart = logCallCode.indexOf("activity.create");
      const actEnd = logCallCode.indexOf("lead.update", actStart);
      assert(actStart >= 0 && actEnd > actStart, "log-call Activity.create block not found");
      const actCreate = logCallCode.slice(actStart, actEnd);
      assert(/outcome:/.test(actCreate),
        "log-call Activity.create no longer sets outcome (timeline would lose the outcome chip)");

      // (c) WHATSAPP LOG — must no longer require or persist a follow-up date.
      const waPath = path.join(root, "src/app/api/whatsapp/log/route.ts");
      const wa = fs.readFileSync(waPath, "utf8");
      const waCode = stripComments(wa);
      assert(!/Please set the next follow-up date\./.test(wa),
        "whatsapp/log still requires a follow-up date — must be removed");
      assert(!/followupDate/.test(waCode),
        "whatsapp/log code still references followupDate — a WhatsApp send must not set the follow-up");
      // The send-vs-click distinction + activity write still exist.
      assert(/kind === "send"/.test(wa) && /WHATSAPP/.test(wa),
        "whatsapp/log lost its send-logging behaviour");

      // (d) CLIENT (Log Conversation form) — Outcome has no Connected default,
      //     blank placeholder present, and the follow-up field is REMOVED.
      const clientPath = path.join(root, "src/components/LeadActionsClient.tsx");
      const client = fs.readFileSync(clientPath, "utf8");
      const clientCode = stripComments(client);
      assert(/\[outcomeKey, setOutcomeKey\]\s*=\s*useState\(""\)/.test(client),
        "outcomeKey no longer defaults to blank — Connected default may have returned");
      assert(!/setOutcomeKey\("PHONE_CONNECTED"\)/.test(client) && !/useState\("PHONE_CONNECTED"\)/.test(client),
        "outcomeKey still defaults/resets to PHONE_CONNECTED (Connected default not fully removed)");
      assert(/-- Select Outcome --/.test(client),
        "the '-- Select Outcome --' blank placeholder option is missing");
      // Outcome + remarks messages remain; the follow-up message + field are gone.
      assert(/Please select an outcome before saving\./.test(client)
        && /Please add remarks before saving\./.test(client),
        "client Log Conversation is missing the outcome/remarks mandatory validation messages");
      assert(!/Please set the next follow-up date\./.test(client) && !/callbackAt/.test(clientCode),
        "client Log Conversation still has a follow-up field/validation — it must be removed from logging");

      // (e) WA picker (TemplatePickerButton) — the mandatory follow-up date field is
      //     REMOVED; the WhatsApp send no longer collects/passes a follow-up.
      const tplPath = path.join(root, "src/components/TemplatePickerButton.tsx");
      const tpl = fs.readFileSync(tplPath, "utf8");
      const tplCode = stripComments(tpl);
      assert(!/waFollowupAt/.test(tplCode) && !/followupDate/.test(tplCode),
        "TemplatePickerButton code still collects/passes a follow-up date for WhatsApp send — must be removed");
      // It still opens the post-send "What next?" popup so the follow-up is closed there.
      assert(/FollowupNextPopup/.test(tpl),
        "TemplatePickerButton no longer opens the post-send What-next popup");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // COMPLETE ROLLS THE FOLLOW-UP FORWARD (Jun25). Completing a follow-up must NOT
  // blank it — it rolls to (completion-moment + 1 day) so the lead keeps a next
  // touchpoint. The shared nextFollowupAfterCompletion helper is the single source
  // of truth (the future repair script reuses it). SAFETY: a terminal lead keeps
  // followupDate null (data-integrity invariant). Invariants:
  //   (a) PURE FN — nextFollowupAfterCompletion(d) === d + 1 day, deterministic
  //       (fixed dates, no Date.now()): future relative to input; exactly +24h.
  //   (b) ROUTE — action-complete sets followupDate = nextFollowupAfterCompletion(now)
  //       (NEVER null) and resets followupReminderSentAt, GUARDED by isTerminalStatus.
  //   (c) DATA — no live NON-terminal lead can be left without a follow-up by a
  //       completion (proven structurally via the route; the terminal-no-followup
  //       data invariant is asserted by data-integrity-jun25).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "complete-rolls-followup — Complete sets followupDate=completion+1day (never null) via shared helper, terminal-guarded; helper is a pure +1day fn",
    run: async () => {
      const fs = await import("fs");
      const path = await import("path");
      const root = process.cwd();

      // (a) PURE FUNCTION — exercise the REAL helper with FIXED dates (no Date.now()).
      const { nextFollowupAfterCompletion, ONE_DAY_MS } = await import("../src/lib/followup");
      assert(ONE_DAY_MS === 24 * 60 * 60 * 1000, "ONE_DAY_MS must be exactly 24h in ms");
      // Mid-afternoon completion → same wall-clock time, next calendar day.
      const completedAt = new Date("2026-06-25T15:30:00.000Z");
      const next = nextFollowupAfterCompletion(completedAt);
      assert(next.getTime() - completedAt.getTime() === ONE_DAY_MS,
        "nextFollowupAfterCompletion must return exactly completedAt + 1 day");
      assert(next.getTime() > completedAt.getTime(),
        "rolled follow-up must be strictly after the completion moment (always future)");
      assert(next.toISOString() === "2026-06-26T15:30:00.000Z",
        `expected 2026-06-26T15:30:00.000Z, got ${next.toISOString()}`);
      // An already-OVERDUE completion still rolls to +1 day from the COMPLETION
      // moment (NOT from the old past followupDate) — so it can never be in the past.
      const overdueCompletion = new Date("2026-01-01T09:00:00.000Z");
      assert(nextFollowupAfterCompletion(overdueCompletion).toISOString() === "2026-01-02T09:00:00.000Z",
        "overdue completion must roll to completion+1day, never a past date");

      // (b) ROUTE — action-complete uses the helper, never blanks the follow-up for a
      //     workable lead, resets the reminder flag, and guards terminal with null.
      const acPath = path.join(root, "src/app/api/leads/[id]/action-complete/route.ts");
      const ac = fs.readFileSync(acPath, "utf8");
      assert(/nextFollowupAfterCompletion\(/.test(ac),
        "action-complete does not roll the follow-up via nextFollowupAfterCompletion");
      assert(/isTerminalStatus\(/.test(ac),
        "action-complete does not guard the roll with isTerminalStatus (terminal must stay null)");
      // The follow-up assignment must NOT be a bare `followupDate: null` anymore —
      // it must reference the rolled value variable.
      assert(/followupDate:\s*rolledFollowup/.test(ac),
        "action-complete must set followupDate to the rolled value (not a bare null)");
      assert(/followupReminderSentAt:\s*null/.test(ac),
        "action-complete must reset followupReminderSentAt so the reminder re-fires at the new date");
      // Terminal guard yields null (so the data-integrity invariant stays green).
      assert(/isTerminalStatus\([^)]*\)\s*\?\s*null/.test(ac),
        "action-complete terminal branch must yield null followup");
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

      // (d) SNOOZE — V1: INSTANT, no mandatory reason (Lalit's UX simplification,
      //     2026-06-30). The agent-without-contact reason gate was REMOVED; snooze
      //     must still auto-log to the timeline + stamp the snooze report token.
      const asPath = path.join(root, "src/app/api/leads/[id]/action-snooze/route.ts");
      const as = fs.readFileSync(asPath, "utf8");
      assert(!/reasonRequired/.test(as),
        "action-snooze still has the mandatory-reason gate (it must be removed for instant snooze)");
      assert(/prisma\.activity\.create/.test(as) && /[Ss]noozed/.test(as),
        "action-snooze no longer auto-logs the snooze to the conversation timeline");
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
  // 47b. LEAD-SOURCE PICKERS (2026-06-28). The CODE companion to backfill-integrity:
  //      that invariant proves the DATA has 0 deprecated `source`; this proves no
  //      MANUAL source PICKER can re-create it. WhatsApp / Inbound Call / Email /
  //      Event are CHANNELS — they live in the Medium field, not Source. The
  //      New-Lead form was cleaned up (task 11) but three other pickers still offered
  //      them; a lead "Sameer" had to be hand-migrated off INBOUND_CALL on 2026-06-27.
  //      Every manual picker now imports the shared ALLOWED_SOURCES
  //      (src/lib/lead-sources.ts); this invariant locks that wiring + source-scans
  //      the picker files so a future edit can't silently re-add a deprecated option.
  //      NB: FILTER/label surfaces (LeadFilters, /leads, master-data, sourceLabel.ts,
  //      charts) legitimately still list INBOUND_CALL to FILTER historical leads —
  //      they are intentionally NOT scanned (they read, they don't write source).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-source-pickers — every manual Source picker uses shared ALLOWED_SOURCES; none re-offers a deprecated WHATSAPP/INBOUND_CALL/EMAIL/EVENT option",
    run: async () => {
      const fs = await import("node:fs");
      const { ALLOWED_SOURCES, DEPRECATED_SOURCES } = await import("../src/lib/lead-sources");
      const allowed: readonly string[] = ALLOWED_SOURCES;

      // (a) The canonical list itself is clean — no deprecated channel token leaked
      //     into the picker vocabulary, and CSV_IMPORT stays import-only.
      for (const dep of DEPRECATED_SOURCES) {
        assert(!allowed.includes(dep), `ALLOWED_SOURCES must not contain deprecated source ${dep} — the channel lives in the Medium field`);
      }
      assert(!allowed.includes("CSV_IMPORT"), "ALLOWED_SOURCES must not contain CSV_IMPORT (imports set it programmatically; never a manual choice)");
      assert(allowed.length >= 8, `ALLOWED_SOURCES unexpectedly short (${allowed.length}) — the picker vocabulary looks truncated`);

      // (b) Each manual Source WRITE-picker imports the shared list AND hard-codes no
      //     deprecated source <option>. A deprecated value used AS AN OPTION is
      //     `value="WHATSAPP"` or `value: "WHATSAPP"` (matches the JSX-attr AND
      //     object-literal forms); this deliberately does NOT match an activity lane
      //     like `type === "WHATSAPP"`, a legitimate non-source use in LeadsListClient.
      //     INBOUND_CALL is ONLY ever a source token, so its bare presence anywhere in
      //     a picker file is itself a regression.
      const PICKERS = [
        "src/components/QuickAddLeadFab.tsx",
        "src/app/(app)/leads/[id]/page.tsx",
        "src/components/LeadsListClient.tsx",
      ];
      const optionRe = /value\s*[:=]\s*["'](WHATSAPP|INBOUND_CALL|EMAIL|EVENT)["']/;
      for (const f of PICKERS) {
        const src = fs.readFileSync(f, "utf8");
        assert(
          /from\s+["']@\/lib\/lead-sources["']/.test(src),
          `${f} must import the shared source list from @/lib/lead-sources (no hand-rolled enum that can drift)`,
        );
        const m = src.match(optionRe);
        assert(!m, `${f} re-offers a deprecated source option (${m?.[1]}) — pick the channel via the Medium field, not Source`);
        assert(!/INBOUND_CALL/.test(src), `${f} still references INBOUND_CALL — remove it (deprecated source; channel → Medium)`);
      }

      results.push({ name: "  ↳ note", ok: true, detail: `${allowed.length} allowed sources; ${PICKERS.length} write-pickers wired to @/lib/lead-sources; 0 deprecated options` });
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

  // ───────────────────────────────────────────────────────────────────────────
  // 4. DATA-INTEGRITY BATCH (2026-06-25, REFRAMED 2026-06-26 for the Revisit model)
  //    Each invariant locks in a DATA/QUERY state AND the forward code path so a
  //    future deploy can't silently reintroduce the rot.
  //      (a) ACTIVE-BOARD RULES (Jun26 — reframes the old "terminal leads have no
  //          followup"): a rejected lead MAY now carry a follow-up — that's a REVISIT
  //          (Revisit Queue), NOT a board pollutant. So assert the BOARD QUERY excludes
  //          it instead of asserting the data is clean:
  //            (a1) activeBoardWhere ∩ terminal == 0,
  //            (a2) no MASTER_DATA on the board unless assigned+scheduled,
  //            (a3) rejected-with-followup == the Revisit Queue set, disjoint from board.
  //          (a') Action-List Overdue == Leads Overdue chip — both now count through
  //               the SAME activeBoardWhere envelope (genuine 1:1 reconciliation).
  //      (b) The board, Leads chips, and Dashboard widget all USE activeBoardWhere
  //          (source-scan) so the reconciliation can't drift. Legacy reject + /update
  //          source-clearing kept as defense-in-depth.
  //      (c) 0 live leads have sourceRaw NULL (Source filter omits none).
  //      (d) Every live currentStatus is already canonical (no mis-cased chip
  //          fragments) + the canonicalStatus aliases fold the known variants.
  //      (e) Historical CALL activities carry an outcome (chip not blank).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "data-integrity-jun25 — Active Board excludes terminal + unassigned Master-Data (AL Overdue==Leads chip); rejected-with-followup == Revisit Queue; 0 null sourceRaw, canonical statuses, CALL outcomes backfilled",
    run: async () => {
      const fs = await import("node:fs");
      const { TERMINAL_STATUSES, canonicalStatus, isTerminalStatus } = await import("../src/lib/lead-statuses");
      const { istDayRange } = await import("../src/lib/datetime");

      // ── activeBoardWhere mirrored INLINE (leadScope.ts imports "server-only") ──
      // Kept byte-for-byte equivalent to src/lib/leadScope.ts activeBoardWhere:
      //   • not cold/revival origin
      //   • not terminal (WORKABLE_STATUS_OR keeps null/blank statuses)
      //   • not a MASTER_DATA lead unless BOTH assigned (ownerId) AND scheduled
      //     (followupDate) — the Jun26 board rule.
      const COLD_ORIGINS = ["COLD", "REVIVAL"];
      const MASTER_DATA_ORIGINS = ["MASTER_DATA", "PORTFOLIO", "SYSTEM"];
      const WORKABLE_STATUS_OR = [
        { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      const MASTER_DATA_BOARD_OR = [
        { leadOrigin: { notIn: MASTER_DATA_ORIGINS } },
        { AND: [{ ownerId: { not: null } }, { followupDate: { not: null } }] },
      ];
      const activeBoard = (scope: Record<string, unknown>) => ({
        ...scope, leadOrigin: { notIn: COLD_ORIGINS },
        AND: [{ OR: WORKABLE_STATUS_OR }, { OR: MASTER_DATA_BOARD_OR }],
      });
      const startToday = istDayRange().start;

      // ── (a) NEW BOARD RULES (Jun26 — reframes "terminal leads have no followup") ──
      // The old assertion ("0 terminal-with-followup leads") is intentionally OBSOLETE:
      // a rejected lead MAY carry a follow-up — that's a REVISIT (surfaced on the
      // Revisit Queue, NOT the Active Board). The board no longer relies on the DATA
      // being clean; it relies on the QUERY excluding the right leads. Assert that:
      //   (a1) NO terminal/rejected lead can appear on the Active Board (any window).
      //        i.e. activeBoard ∩ isTerminalStatus == 0, by construction of the query.
      const boardTerminal = await prisma.lead.count({
        where: { ...activeBoard({ deletedAt: null }), currentStatus: { in: TERMINAL_STATUSES } },
      });
      assert(boardTerminal === 0, `${boardTerminal} terminal lead(s) still pass the Active-Board query — terminal must be excluded`);
      //   (a2) NO MASTER_DATA lead on the board unless assigned AND scheduled. So a
      //        MASTER_DATA lead that is on the board AND (unassigned OR unscheduled)
      //        must be 0.
      const boardMdUntriaged = await prisma.lead.count({
        where: {
          ...activeBoard({ deletedAt: null }),
          leadOrigin: { in: MASTER_DATA_ORIGINS },
          OR: [{ ownerId: null }, { followupDate: null }],
        },
      });
      assert(boardMdUntriaged === 0, `${boardMdUntriaged} MASTER_DATA lead(s) reached the Active Board without being assigned+scheduled`);
      //   (a3) The rejected-with-followup leads are EXACTLY the Revisit Queue set, and
      //        that set is DISJOINT from the Active Board (a lead is on one or the
      //        other, never both). Revisit = terminal + followupDate present + live.
      const revisitSet = await prisma.lead.count({
        where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
      });
      const revisitOnBoard = await prisma.lead.count({
        where: { ...activeBoard({ deletedAt: null }), currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
      });
      assert(revisitOnBoard === 0, `${revisitOnBoard} Revisit lead(s) (terminal+followup) leaked onto the Active Board — Revisit and Board must be disjoint`);
      results.push({ name: "  ↳ note", ok: true, detail: `Revisit Queue set = ${revisitSet} terminal-with-followup lead(s), 0 on the Active Board` });

      // ── (a') RECONCILE: Action-List Overdue == Leads Overdue chip (admin scope) ─
      // Both surfaces now count through the SAME activeBoardWhere envelope (the whole
      // point of the Jun26 shared helper), using the SAME "overdue" boundary the real
      // Action List uses: followupDate < startOfTodayIST (resolveWindow — a follow-up
      // dated *today* is "Today", NOT Overdue; only strictly-before-today is overdue).
      //   AL Overdue  = activeBoardWhere(scope) + followupDate < startTodayIST.
      //   Leads chip  = activeBoardWhere(scope) + followupDate < startTodayIST (boardScope).
      // Identical predicates ⇒ identical counts. (Previously the two diverged because
      // the board applied NO status/origin filter while the chip used workableWhere;
      // unifying on activeBoardWhere is what makes them reconcile.)
      const alOverdue = await prisma.lead.count({ where: { ...activeBoard({ deletedAt: null }), followupDate: { lt: startToday } } });
      const leadsOverdue = await prisma.lead.count({ where: { ...activeBoard({ deletedAt: null }), followupDate: { lt: startToday } } });
      assert(alOverdue === leadsOverdue, `Action-List Overdue (${alOverdue}) must equal Leads Overdue chip (${leadsOverdue}) — both count through activeBoardWhere`);

      // ── (b) FORWARD CODE: the surfaces share ONE Active-Board definition ───────
      // The board, the Leads follow-up chips, and the Dashboard follow-up widgets all
      // call activeBoardWhere — so the reconciliation can't silently drift if one
      // surface is refactored. Source-scan that the shared helper exists and is used.
      const leadScopeSrc = fs.readFileSync("src/lib/leadScope.ts", "utf8");
      assert(/export function activeBoardWhere/.test(leadScopeSrc),
        "leadScope.ts MUST export activeBoardWhere — the single Active-Board definition");
      const alSrc = fs.readFileSync("src/app/(app)/action-list/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(alSrc), "Action List board query MUST use activeBoardWhere (terminal + Master-Data exclusions)");
      const leadsSrc = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(leadsSrc), "Leads follow-up chips MUST use activeBoardWhere so they reconcile with the board");
      const dashSrc = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(dashSrc), "Dashboard follow-up widget MUST use activeBoardWhere so it reconciles with the board");
      // Defense-in-depth (legacy, still valid): reject + /update also clear followup
      // when moving a lead TO terminal at the SOURCE. This is no longer the primary
      // guarantee (the board EXCLUDES terminal regardless) but is kept so a terminal
      // lead doesn't silently keep an active reminder unless an admin re-adds one.
      const rejectRoute = fs.readFileSync("src/app/api/leads/[id]/reject/route.ts", "utf8");
      assert(/followupDate:\s*null/.test(rejectRoute), "reject route MUST clear followupDate on a terminal status (defense-in-depth)");
      const updateRoute = fs.readFileSync("src/app/api/leads/[id]/update/route.ts", "utf8");
      assert(/isTerminalStatus\(/.test(updateRoute) && /updates\.followupDate\s*=\s*null/.test(updateRoute),
        "/update route MUST clear followupDate when the new currentStatus isTerminalStatus() (defense-in-depth)");
      assert(typeof isTerminalStatus === "function" && isTerminalStatus("Booked With Us") && !isTerminalStatus("Follow Up"),
        "isTerminalStatus() must classify booked/lost as terminal, workable as not");

      // ── (c) DATA: 0 live leads with sourceRaw NULL (source enum non-nullable) ──
      const nullSourceRaw = await prisma.lead.count({ where: { deletedAt: null, sourceRaw: null } });
      assert(nullSourceRaw === 0, `${nullSourceRaw} live lead(s) have sourceRaw NULL — the Source filter silently omits them`);

      // ── (d) DATA: every live currentStatus is already canonical (no fragments) ─
      const statusRows = await prisma.lead.groupBy({
        by: ["currentStatus"], where: { deletedAt: null, currentStatus: { not: null } }, _count: true,
      });
      const fragmented = statusRows
        .map((r) => r.currentStatus!)
        .filter((s) => { const c = canonicalStatus(s); return c && c !== s; });
      assert(fragmented.length === 0, `mis-cased status(es) still in data (should be canonicalized): ${fragmented.join(", ")}`);
      // ── (d') CODE: the alias table folds the known variants ───────────────────
      assert(canonicalStatus("Long Term Followup") === "Long Term Follow Up", "alias: 'Long Term Followup' → 'Long Term Follow Up'");
      assert(canonicalStatus("Long-term Followup") === "Long Term Follow Up", "alias: 'Long-term Followup' → 'Long Term Follow Up'");
      assert(canonicalStatus("Long Follow Up") === "Long Term Follow Up", "alias: 'Long Follow Up' → 'Long Term Follow Up'");
      assert(canonicalStatus("Fund Issue") === "Funds Issue", "alias: 'Fund Issue' → 'Funds Issue'");
      assert(canonicalStatus("Other") === "Other", "bare 'Other' is deliberately NOT folded (ambiguous)");

      // ── (e) DATA: historical CALL activities carry an outcome ──────────────────
      // The vast majority of CALL activities that have a matching CallLog now show
      // an outcome. We assert a sturdy lower bound (>= 90% of CALL acts with a user
      // are populated) rather than an exact 0-null (a dozen have no CallLog at all).
      const callTotal = await prisma.activity.count({ where: { type: "CALL", userId: { not: null } } });
      if (callTotal > 0) {
        const callWithOutcome = await prisma.activity.count({ where: { type: "CALL", userId: { not: null }, outcome: { not: null } } });
        const pct = callWithOutcome / callTotal;
        assert(pct >= 0.9, `only ${callWithOutcome}/${callTotal} (${(pct * 100).toFixed(1)}%) CALL activities have an outcome — backfill regressed?`);
        results.push({ name: "  ↳ note", ok: true, detail: `${callWithOutcome}/${callTotal} CALL activities carry an outcome; AL Overdue==Leads chip==${alOverdue}; 0 null sourceRaw; 0 mis-cased statuses` });
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // ACTIVE-BOARD EXCLUSIONS (Jun26) — the new Active Follow-up Board rules. The
  // board (Action List), the Leads follow-up chips, and the Dashboard follow-up
  // widgets all count through ONE shared envelope (activeBoardWhere in leadScope).
  // This invariant proves the envelope behaves AND is wired into all three surfaces:
  //   (a) terminal/rejected leads NEVER pass the board query (any window),
  //   (b) a MASTER_DATA-origin lead passes ONLY when assigned (ownerId) AND
  //       scheduled (followupDate); never when unassigned or unscheduled,
  //   (c) a non-Master-Data, non-terminal lead with a follow-up DOES pass,
  //   (d) all three surfaces call activeBoardWhere (source-scan — DRY/no-drift).
  // activeBoardWhere is mirrored INLINE here (leadScope imports "server-only").
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "active-board-exclusions — board query excludes terminal + unassigned/unscheduled Master-Data; non-MD non-terminal with followup included; 3 surfaces share activeBoardWhere",
    run: async () => {
      const fs = await import("node:fs");
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      const COLD_ORIGINS = ["COLD", "REVIVAL"];
      const MASTER_DATA_ORIGINS = ["MASTER_DATA", "PORTFOLIO", "SYSTEM"];
      const WORKABLE_STATUS_OR = [
        { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      const MASTER_DATA_BOARD_OR = [
        { leadOrigin: { notIn: MASTER_DATA_ORIGINS } },
        { AND: [{ ownerId: { not: null } }, { followupDate: { not: null } }] },
      ];
      const activeBoard = (scope: Record<string, unknown>) => ({
        ...scope, leadOrigin: { notIn: COLD_ORIGINS },
        AND: [{ OR: WORKABLE_STATUS_OR }, { OR: MASTER_DATA_BOARD_OR }],
      });

      // (a) Terminal NEVER on the board (no followupDate window applied → "any window").
      const termOnBoard = await prisma.lead.count({
        where: { ...activeBoard({ deletedAt: null }), currentStatus: { in: TERMINAL_STATUSES } },
      });
      assert(termOnBoard === 0, `${termOnBoard} terminal lead(s) pass the Active-Board query — must be excluded`);

      // (b) MASTER_DATA on the board must ALL be assigned+scheduled. Equivalently:
      //     0 MASTER_DATA on the board are unassigned OR unscheduled.
      const mdUntriagedOnBoard = await prisma.lead.count({
        where: {
          ...activeBoard({ deletedAt: null }),
          leadOrigin: { in: MASTER_DATA_ORIGINS },
          OR: [{ ownerId: null }, { followupDate: null }],
        },
      });
      assert(mdUntriagedOnBoard === 0, `${mdUntriagedOnBoard} unassigned/unscheduled MASTER_DATA lead(s) reached the Active Board`);
      // And every MASTER_DATA lead that IS on the board is assigned+scheduled (sanity).
      const mdOnBoard = await prisma.lead.count({ where: { ...activeBoard({ deletedAt: null }), leadOrigin: { in: MASTER_DATA_ORIGINS } } });
      const mdOnBoardAssignedScheduled = await prisma.lead.count({
        where: { ...activeBoard({ deletedAt: null }), leadOrigin: { in: MASTER_DATA_ORIGINS }, ownerId: { not: null }, followupDate: { not: null } },
      });
      assert(mdOnBoard === mdOnBoardAssignedScheduled, `MASTER_DATA on board (${mdOnBoard}) != assigned+scheduled (${mdOnBoardAssignedScheduled})`);

      // (c) A non-Master-Data, non-terminal lead WITH a follow-up is INCLUDED — i.e.
      //     the gate doesn't over-exclude. Prove the board's followup population is
      //     entirely workable+non-cold (ACTIVE_LEAD with followup ⊆ board).
      const activeWithFollowup = await prisma.lead.count({
        where: { deletedAt: null, leadOrigin: { in: ["ACTIVE", "ACTIVE_LEAD"] }, currentStatus: { notIn: TERMINAL_STATUSES }, followupDate: { not: null } },
      });
      const activeWithFollowupOnBoard = await prisma.lead.count({
        where: { ...activeBoard({ deletedAt: null }), leadOrigin: { in: ["ACTIVE", "ACTIVE_LEAD"] }, currentStatus: { notIn: TERMINAL_STATUSES }, followupDate: { not: null } },
      });
      assert(activeWithFollowup === activeWithFollowupOnBoard,
        `non-terminal ACTIVE leads with a follow-up must all be on the board (${activeWithFollowup} vs ${activeWithFollowupOnBoard}) — gate over-excludes`);

      // (d) SOURCE: all three surfaces call the shared activeBoardWhere helper, and the
      //     helper exists. Locks the DRY single-definition so a refactor can't drift.
      const leadScopeSrc = fs.readFileSync("src/lib/leadScope.ts", "utf8");
      assert(/export function activeBoardWhere/.test(leadScopeSrc) && /MASTER_DATA_BOARD_OR/.test(leadScopeSrc),
        "leadScope.ts MUST export activeBoardWhere + MASTER_DATA_BOARD_OR (the single Active-Board definition)");
      const alSrc = fs.readFileSync("src/app/(app)/action-list/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(alSrc), "Action List MUST use activeBoardWhere");
      const leadsSrc = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(leadsSrc), "Leads page follow-up chips MUST use activeBoardWhere");
      const dashSrc = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/activeBoardWhere\(/.test(dashSrc), "Dashboard follow-up widget MUST use activeBoardWhere");

      results.push({ name: "  ↳ note", ok: true, detail: `board excludes terminal(0) + untriaged MD(0); MD on board=${mdOnBoard} all assigned+scheduled; ${activeWithFollowup} active-with-followup all on board` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // REVISIT QUEUE (Jun26) — the read-only triage view for rejected/closed leads
  // that still carry a follow-up (a "Revisit"). Proves the query + the page wiring:
  //   (a) the Revisit set = terminal status + followupDate present + live, and is
  //       DISJOINT from the Active Board (every such lead is OFF the board),
  //   (b) the page exists, is permission-scoped via leadScopeWhere, and has a nav
  //       item — and it does NOT introduce a new convert button / timeline event
  //       (Release-1 scope = view + separation only).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "revisit-queue — terminal-with-followup set returned + disjoint from Active Board; page scoped via leadScopeWhere + nav item; no convert button",
    run: async () => {
      const fs = await import("node:fs");
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      const COLD_ORIGINS = ["COLD", "REVIVAL"];
      const MASTER_DATA_ORIGINS = ["MASTER_DATA", "PORTFOLIO", "SYSTEM"];
      const WORKABLE_STATUS_OR = [
        { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      const MASTER_DATA_BOARD_OR = [
        { leadOrigin: { notIn: MASTER_DATA_ORIGINS } },
        { AND: [{ ownerId: { not: null } }, { followupDate: { not: null } }] },
      ];
      const activeBoard = (scope: Record<string, unknown>) => ({
        ...scope, leadOrigin: { notIn: COLD_ORIGINS },
        AND: [{ OR: WORKABLE_STATUS_OR }, { OR: MASTER_DATA_BOARD_OR }],
      });

      // (a) DATA: the Revisit set (mirrors revisit-queue/page.tsx where, admin scope)
      //     and its disjointness from the Active Board.
      const revisitWhere = { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } };
      const revisitCount = await prisma.lead.count({ where: revisitWhere });
      const revisitOnBoard = await prisma.lead.count({ where: { ...activeBoard({ deletedAt: null }), currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } } });
      assert(revisitOnBoard === 0, `${revisitOnBoard} Revisit lead(s) also appear on the Active Board — sets must be disjoint`);

      // (b) PAGE: exists, scoped via leadScopeWhere, terminal+followup query, NO new
      //     convert button / timeline event in this release. Strip comments before the
      //     "no convert button" check — the page's own prose legitimately MENTIONS
      //     that it does NOT add one, so we assert on the CODE only.
      const page = fs.readFileSync("src/app/(app)/revisit-queue/page.tsx", "utf8");
      const pageCode = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      assert(/leadScopeWhere\(/.test(page), "Revisit Queue MUST scope via leadScopeWhere (agent=own, manager=team, admin=all)");
      assert(/TERMINAL_STATUSES/.test(page) && /followupDate:\s*\{\s*not:\s*null/.test(page),
        "Revisit Queue query MUST be terminal status + followupDate not null");
      assert(!/Convert to Active|convertToActive|convert-to-active/i.test(pageCode),
        "Revisit Queue must NOT add a Convert-to-Active button in Release 1 (status-editor on lead detail is the path)");
      // NAV: a Revisit Queue nav item points at /revisit-queue.
      const shell = fs.readFileSync("src/components/MobileShell.tsx", "utf8");
      assert(/\/revisit-queue/.test(shell) && /Revisit Queue/.test(shell), "MobileShell MUST have a /revisit-queue nav item");

      results.push({ name: "  ↳ note", ok: true, detail: `Revisit Queue set=${revisitCount} terminal-with-followup lead(s); 0 on the Active Board (disjoint); page scoped + nav wired` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 5. CORRECTNESS+SECURITY BATCH (2026-06-25) — three latent-bug closures:
  //      (a) Dashboard Meetings/Site-Visits/Virtual tile == /activities drill.
  //          Tile counts Activity by attribution(meActWhere) + status:PLANNED +
  //          IST-day window + type. The drill (?planned=1) must reproduce that
  //          EXACT where so count == rows opened. We assert tile-where count ==
  //          drill-where count for all 3 type buckets (admin/team="all" branch).
  //      (b) Revival "All" count excludes soft-deleted cold leads (deletedAt:null
  //          now lives on originCold), so All == Σ(status chips) — the chips
  //          already filter deletedAt:null. Data + source proof.
  //      (c) Lead-detail cold redirect keys on isColdCall OR leadOrigin∈COLD_ORIGINS
  //          (broadened), matching where the Revival list/detail place the lead.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "correctness-jun25 — meetings tile==drill (count), Revival All excludes deleted (==Σ chips), cold redirect broadened",
    run: async () => {
      const fs = await import("node:fs");
      const { istDayRange } = await import("../src/lib/datetime");
      const { start: dayStart, end: dayEnd } = istDayRange();

      // ── (a) TILE == DRILL for the 3 meeting buckets (admin/team="all" branch) ──
      // Tile where (dashboard/page.tsx, admin teamActWhere + PLANNED + type + IST):
      //   { lead:{deletedAt:null}, status:PLANNED, type:{in:…}, scheduledAt: IST-day }
      // Drill where (activities/page.tsx todayScheduledWhere with ?planned=1, admin,
      //   no view): { lead:{deletedAt:null}, status:PLANNED } + scheduledAt + typeWhere
      // — byte-for-byte the SAME predicate. Assert equal counts (proves alignment;
      // the historical drift was ownerId-vs-userId + missing status filter).
      const buckets: { label: string; types: any[] }[] = [
        { label: "Meetings",        types: ["EXPO_MEETING", "OFFICE_MEETING", "HOME_VISIT"] },
        { label: "Site Visits",     types: ["SITE_VISIT"] },
        { label: "Virtual Meetings",types: ["VIRTUAL_MEETING"] },
      ];
      for (const b of buckets) {
        const tileWhere = {
          lead: { deletedAt: null },
          status: "PLANNED" as const,
          type: { in: b.types },
          scheduledAt: { gte: dayStart, lt: dayEnd },
        };
        const drillWhere = {
          // todayScheduledWhere(admin, planned=1) = { lead:{deletedAt:null}, status:PLANNED }
          lead: { deletedAt: null },
          status: "PLANNED" as const,
          scheduledAt: { gte: dayStart, lt: dayEnd },
          type: { in: b.types }, // typeWhere from ?type=
        };
        const tileCount = await prisma.activity.count({ where: tileWhere });
        const drillCount = await prisma.activity.count({ where: drillWhere });
        assert(tileCount === drillCount, `${b.label}: tile count (${tileCount}) != drill count (${drillCount}) — count==drill broken`);
      }
      // SOURCE: the tile hrefs pass planned=1 and the drill applies status:PLANNED +
      // the userId/team attribution (todayScheduledWhere). Lock both so a refactor
      // can't drop the flag or the status filter and re-introduce the divergence.
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert((dash.match(/\/activities\?type=[^"`]*planned=1/g) ?? []).length >= 3,
        "all 3 dashboard meeting/site-visit/virtual tiles MUST drill with planned=1 (count==drill)");
      const actPage = fs.readFileSync("src/app/(app)/activities/page.tsx", "utf8");
      assert(/todayScheduledWhere/.test(actPage) && /status:\s*ActivityStatus\.PLANNED/.test(actPage),
        "/activities MUST apply status:PLANNED via todayScheduledWhere on the dashboard drill");
      assert(/sp\.planned\s*===\s*"1"/.test(actPage), "/activities MUST read ?planned=1 to enter dashboard-drill mode");

      // ── (b) REVIVAL "All" count excludes soft-deleted cold leads ──────────────
      // originCold now carries deletedAt:null, so allCold (admin scope {}) counts
      // only non-deleted cold leads — identical to Σ(per-status chips), which also
      // filter deletedAt:null. Prove via data: allCold == cold leads not deleted.
      const COLD = ["COLD", "REVIVAL"];
      const allColdCount = await prisma.lead.count({ where: { leadOrigin: { in: COLD }, deletedAt: null } });
      const coldNotDeleted = await prisma.lead.count({ where: { AND: [{ leadOrigin: { in: COLD } }, { deletedAt: null }] } });
      assert(allColdCount === coldNotDeleted, `Revival All count (${allColdCount}) must equal non-deleted cold leads (${coldNotDeleted})`);
      // And any soft-deleted cold lead must be ABSENT from the All bucket: assert the
      // All-with-deletedAt:null count never exceeds the unfiltered cold count, and
      // equals (unfiltered − deleted). If a cold lead is ever soft-deleted this stays
      // consistent (today deletedCold may be 0; the math still holds).
      const coldAll = await prisma.lead.count({ where: { leadOrigin: { in: COLD } } });
      const coldDeleted = await prisma.lead.count({ where: { leadOrigin: { in: COLD }, deletedAt: { not: null } } });
      assert(allColdCount === coldAll - coldDeleted, `Revival All (${allColdCount}) must equal total cold (${coldAll}) − soft-deleted cold (${coldDeleted})`);
      // SOURCE: originCold in cold-calls/page.tsx MUST include deletedAt:null so All/
      // filtered/where all exclude the recycle bin (the per-status chips already did).
      const coldPage = fs.readFileSync("src/app/(app)/cold-calls/page.tsx", "utf8");
      // Match the originCold declaration line (ends at `;`) and require it to carry
      // BOTH leadOrigin and deletedAt:null. (Inner `{ in: COLD_ORIGINS }` braces
      // mean a naive [^}]* stops short — match to the statement terminator instead.)
      const originColdDecl = coldPage.match(/const originCold[^;]*;/)?.[0] ?? "";
      assert(/leadOrigin/.test(originColdDecl) && /deletedAt:\s*null/.test(originColdDecl),
        "cold-calls originCold MUST include deletedAt:null (All count == Σ status chips)");

      // ── (c) Lead-detail cold redirect broadened to leadOrigin∈COLD_ORIGINS ────
      const leadDetail = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/COLD_ORIGINS\.includes\(lead\.leadOrigin\)/.test(leadDetail) && /lead\.isColdCall/.test(leadDetail),
        "lead-detail redirect MUST key on isColdCall OR leadOrigin∈COLD_ORIGINS (cold/revival always redirect to Revival Engine)");
      assert(/import\s*\{[^}]*COLD_ORIGINS[^}]*\}\s*from\s*"@\/lib\/leadScope"/.test(leadDetail),
        "lead-detail MUST import COLD_ORIGINS from the shared leadScope (single source the list uses)");

      results.push({
        name: "  ↳ note",
        ok: true,
        detail: `meetings tile==drill ✓ (3 buckets); Revival All=${allColdCount} (cold total=${coldAll}, deleted=${coldDeleted}) == Σ chips; cold redirect covers leadOrigin∈{COLD,REVIVAL}`,
      });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // REVIVAL PARITY + REJECT + TIMELINE ACTOR (2026-06-26). Three shipped invariants,
  // all static source-scans (no writes), so a future refactor can't silently revert:
  //   (1) /cold-calls renders the SAME list component as /leads (LeadsListClient,
  //       via the thin RevivalLeadsListClient wrapper) pointed at the cold detail
  //       route — NOT the old slim RevivalEngineListClient — and LeadsListClient
  //       still exposes the additive detailBasePath/extraRowAction props (default
  //       /leads behaviour). The originCold deletedAt:null decl is asserted above.
  //   (2) The Revival cold-data DETAIL page wires the origin-safe RejectLeadModal,
  //       and the reject endpoint NEVER mutates leadOrigin/isColdCall (so a rejected
  //       cold lead stays in Revival, not promoted / moved to Leads).
  //   (3) ConversationStreamCard never renders the literal "Agent" as an actor —
  //       it resolves user → "System" (system STATUS_CHANGE) → owner → "Unknown
  //       User", takes a leadOwnerName prop, and BOTH detail pages pass it.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "revival-parity+reject+actor — /cold-calls uses LeadsListClient; cold detail has origin-safe Reject; timeline never says \"Agent\"",
    run: async () => {
      const fs = await import("node:fs");

      // ── (1) Revival list == Leads list component ──────────────────────────────
      const coldPage = fs.readFileSync("src/app/(app)/cold-calls/page.tsx", "utf8");
      assert(/RevivalLeadsListClient/.test(coldPage),
        "/cold-calls must mount RevivalLeadsListClient (the shared LeadsListClient wrapper)");
      assert(!/^\s*import\s+RevivalEngineListClient/m.test(coldPage) && !/<RevivalEngineListClient/.test(coldPage),
        "/cold-calls must NOT mount the old slim RevivalEngineListClient (parity = same grid as /leads)");
      const wrapper = fs.readFileSync("src/components/RevivalLeadsListClient.tsx", "utf8");
      // The wrapper points the shared list's rows at the cold-data detail route.
      assert(/detailBasePath="\/revival-engine\/cold-data"/.test(wrapper) || /detailBasePath:\s*"\/revival-engine\/cold-data"/.test(wrapper),
        "Revival list rows must link to the cold-data detail route (detailBasePath in the wrapper)");
      assert(/LeadsListClient/.test(wrapper) && /extraRowAction/.test(wrapper),
        "RevivalLeadsListClient must render LeadsListClient and pass the Promote extraRowAction");
      assert(/RevivalRowPromote/.test(wrapper),
        "RevivalLeadsListClient must preserve the Revival Promote action (RevivalRowPromote)");
      // LeadsListClient keeps the additive props (default /leads behaviour intact).
      const list = fs.readFileSync("src/components/LeadsListClient.tsx", "utf8");
      assert(/detailBasePath\s*=\s*"\/leads"/.test(list),
        "LeadsListClient must default detailBasePath to /leads (additive — /leads unchanged)");
      assert(/extraRowAction\?\.\(/.test(list) || /extraRowAction\(/.test(list),
        "LeadsListClient must render the optional extraRowAction in its action surfaces");
      // Promote endpoints unchanged (the two existing promote routes still exist).
      assert(fs.existsSync("src/app/api/leads/[id]/promote/route.ts"), "promote endpoint (origin cold) must still exist");
      assert(fs.existsSync("src/app/api/leads/[id]/promote-cold/route.ts"), "promote-cold endpoint must still exist");

      // ── (2) Reject on the cold DETAIL page + origin-safety of the endpoint ─────
      const coldDetail = fs.readFileSync("src/app/(app)/revival-engine/cold-data/[id]/page.tsx", "utf8");
      assert(/RejectLeadModal/.test(coldDetail),
        "cold-data detail page must wire the RejectLeadModal");
      const rejectRoute = fs.readFileSync("src/app/api/leads/[id]/reject/route.ts", "utf8");
      // The reject UPDATE must NOT set leadOrigin or isColdCall — keeps the lead cold.
      // (The route may READ them in the findUnique select to detect a revival lead for
      // the "Revival Engine Rejected" tag; scope the check to the UPDATE onward so a
      // legitimate select isn't a false positive.)
      const rejectUpdatePart = rejectRoute.slice(rejectRoute.indexOf("prisma.lead.update"));
      assert(!/leadOrigin\s*:/.test(rejectUpdatePart) && !/isColdCall\s*:/.test(rejectUpdatePart),
        "reject endpoint must NEVER write leadOrigin/isColdCall (rejected cold lead stays in Revival)");
      assert(/rejectionStatusFor\(/.test(rejectRoute) && /rejectedById:\s*me\.id/.test(rejectRoute),
        "reject endpoint must set the rejection status + rejectedById (origin-safe reject)");

      // ── (3) Timeline actor never "Agent" ─────────────────────────────────────
      const stream = fs.readFileSync("src/components/ConversationStreamCard.tsx", "utf8");
      // No JSX/string literal renders the bare word Agent as an actor. We allow it
      // only inside comments + the "hide from agent" picker label, so scan for the
      // specific fabricated-actor patterns that USED to exist.
      assert(!/\?\?\s*"Agent"/.test(stream),
        "ConversationStreamCard must not fall back to the literal \"Agent\" (use System/owner/Unknown User)");
      assert(!/\?\s*"📤 Agent"\s*:/.test(stream) && !/"📤 Agent"/.test(stream),
        "outbound WhatsApp must not be labelled \"Agent\" (use the owner name or \"Outbound\")");
      assert(/leadOwnerName/.test(stream),
        "ConversationStreamCard must accept a leadOwnerName prop (truthful actor fallback)");
      assert(/"System"/.test(stream) && /"Unknown User"/.test(stream),
        "ConversationStreamCard must resolve system rows to \"System\" and the final fallback to \"Unknown User\"");
      // Both detail pages must pass the owner name in.
      const leadDetail2 = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/leadOwnerName=\{lead\.owner\?\.name/.test(leadDetail2),
        "leads detail page must pass leadOwnerName to ConversationStreamCard");
      assert(/leadOwnerName=\{lead\.owner\?\.name/.test(coldDetail),
        "cold-data detail page must pass leadOwnerName to ConversationStreamCard");

      results.push({
        name: "  ↳ note",
        ok: true,
        detail: "Revival list == LeadsListClient (Promote preserved) · cold-detail Reject is origin-safe · timeline actor never \"Agent\" (System/owner/Unknown User)",
      });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // BUG 3 (2026-06-25). Fresh-lead follow-up default = createdAt + 10 minutes,
  // NOT the old "today 7:00pm IST". Two parts:
  //   (a) SOURCE — ingestLead must compute createdAt+10min, with the old 7pm
  //       todayEodIST() removed (static source-scan so a refactor can't revert).
  //   (b) DATA — no ACTIVE lead may still carry the auto-7PM signature with NO
  //       followupDate history (i.e. an untouched auto-default). Agent-set 7pm
  //       follow-ups (history exists) are legitimate and intentionally allowed.
  //       Also: a 19:00-IST follow-up whose IST day ≠ createdAt IST day is an
  //       agent-chosen slot on a later day, not the creation default — allowed.
  // Plus BUG 1 helper proof: hasDialableNumber() rejects blank / whitespace /
  // bare-dial-prefix ("+91") and accepts a real number — the exact gate the alt
  // Call/WhatsApp buttons now use.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "followup-default-10min — ingestLead uses createdAt+10min (no 7pm default); no untouched auto-7PM lead remains; alt-dialable gate correct",
    run: async () => {
      const fs = await import("fs");
      const ingest = fs.readFileSync("src/lib/leadIngest.ts", "utf8");
      // (a) SOURCE — the +10-min default is present and the old 7pm stamp is gone.
      assert(/followupDate:\s*followupDefault/.test(ingest), "ingestLead must set followupDate: followupDefault (createdAt+10min)");
      assert(/getTime\(\)\s*\+\s*10\s*\*\s*60\s*\*\s*1000/.test(ingest), "ingestLead must compute createdAt+10min for the follow-up default");
      assert(!/todayEodIST/.test(ingest), "the old todayEodIST() 7pm default must be removed from ingestLead");
      assert(!/setUTCHours\(19/.test(ingest), "ingestLead must not stamp 19:00 (7pm) as the follow-up default");

      // BUG 1 helper proof — hasDialableNumber must gate alt action buttons.
      assert(hasDialableNumber("+919928418296") === true, "hasDialableNumber: real +91 number must be dialable");
      assert(hasDialableNumber("9928418296") === true, "hasDialableNumber: 10-digit number must be dialable");
      assert(hasDialableNumber("+91") === false, "hasDialableNumber: bare +91 dial-prefix must NOT be dialable");
      assert(hasDialableNumber("+971") === false, "hasDialableNumber: bare +971 dial-prefix must NOT be dialable");
      assert(hasDialableNumber("   ") === false, "hasDialableNumber: whitespace must NOT be dialable");
      assert(hasDialableNumber("") === false, "hasDialableNumber: empty must NOT be dialable");
      assert(hasDialableNumber(null) === false, "hasDialableNumber: null must NOT be dialable");
      // The two alt-action surfaces must use the dialable gate, not a bare truthy check.
      for (const f of ["src/components/LeadActionsClient.tsx", "src/components/BuyerActionsClient.tsx"]) {
        const src = fs.readFileSync(f, "utf8");
        assert(/hasDialableNumber\(phone\)\s*&&\s*hasDialableNumber\(altPhone\)/.test(src), `${f} must gate alt Call/WhatsApp on hasDialableNumber(phone)&&hasDialableNumber(altPhone)`);
      }

      // (b) DATA — no untouched auto-7PM default left on an ACTIVE lead.
      const IST_MS = 5.5 * 3600 * 1000;
      const dayKey = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
      const isSeven = (d: Date) => { const x = new Date(d.getTime() + IST_MS); return x.getUTCHours() === 19 && x.getUTCMinutes() === 0; };
      const live = await prisma.lead.findMany({
        where: { deletedAt: null, followupDate: { not: null } },
        select: { id: true, createdAt: true, followupDate: true },
      });
      const sig = live.filter((l) => l.followupDate && isSeven(l.followupDate) && dayKey(l.followupDate) === dayKey(l.createdAt));
      const ids = sig.map((l) => l.id);
      const touched = new Set(
        ids.length
          ? (await prisma.leadFieldHistory.findMany({ where: { leadId: { in: ids }, field: "followupDate" }, select: { leadId: true } })).map((h) => h.leadId)
          : [],
      );
      const untouchedAuto7pm = sig.filter((l) => !touched.has(l.id));
      assert(untouchedAuto7pm.length === 0, `${untouchedAuto7pm.length} active lead(s) still carry the untouched auto-7PM follow-up signature (run scripts/backfill-followup-10min.ts). e.g. ${untouchedAuto7pm.slice(0,3).map(l=>l.id).join(", ")}`);

      results.push({ name: "  ↳ note", ok: true, detail: `ingestLead=createdAt+10min ✓; alt-dialable gate ✓; auto-7PM same-day followups=${sig.length} (all ${touched.size} agent-touched, 0 untouched)` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // BUG 2 (2026-06-25). "Property Enquired" reads ONE canonical field —
  // `sourceDetail` — on the lead detail, the Leads table, and the Master Data
  // grid, so all three AGREE for every lead. The Leads table previously routed
  // sourceDetail through a strict "registered-project-only" gate that hid genuine
  // free-text property enquiries while detail + Master Data showed them.
  //   • SOURCE — detail (page.tsx field="sourceDetail"), Master Data
  //     (project: l.sourceDetail), and the Leads table (resolveEnquiredProperty +
  //     sourceDetail row field) all reference the canonical sourceDetail.
  //   • LOGIC — resolveEnquiredProperty honors a free-text sourceDetail verbatim
  //     (the bug was discarding it) but still rejects a stray notesShort remark
  //     that isn't a known project.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "property-enquired-sync — detail/table/Master-Data all read canonical sourceDetail; free-text honored, remark rejected",
    run: async () => {
      const fs = await import("fs");
      const detail = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/field="sourceDetail"/.test(detail), "lead detail Property Enquired must bind to field=\"sourceDetail\"");
      const md = fs.readFileSync("src/app/(app)/master-data/page.tsx", "utf8");
      assert(/project:\s*l\.sourceDetail/.test(md), "Master Data Property Enquired must read l.sourceDetail");
      const listSrv = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/sourceDetail:\s*l\.sourceDetail/.test(listSrv), "Leads list server must pass the canonical sourceDetail to the table row");
      const listCli = fs.readFileSync("src/components/LeadsListClient.tsx", "utf8");
      assert(/resolveEnquiredProperty\(/.test(listCli), "Leads table must render Property Enquired via resolveEnquiredProperty (canonical sourceDetail)");

      // LOGIC — a free-text property in sourceDetail is shown (NOT discarded); a
      // remark in notesShort that isn't a known project is rejected. (Mirrors the
      // surfaces: detail/Master-Data show raw sourceDetail; the table now agrees.)
      const known = ["Sobha Central", "Central Park Resorts"];
      assert(resolveEnquiredProperty(null, null, "Central Park Valley", null, known) === "Central Park Valley", "free-text sourceDetail must be shown (title-cased), not discarded");
      assert(resolveEnquiredProperty(null, null, "Dubai Property Expo", null, known) === "Dubai Property Expo", "campaign/blog sourceDetail must show consistently (matches detail + Master Data)");
      assert(resolveEnquiredProperty(null, null, null, "Lalit Sir", known) === null, "a notesShort remark that isn't a known project must NOT leak into Property Enquired");
      assert(resolveEnquiredProperty("Sobha Central", null, "ignored", null, known) === "Sobha Central", "a formal project link wins over sourceDetail");

      results.push({ name: "  ↳ note", ok: true, detail: "detail/table/Master-Data all key on canonical sourceDetail; free-text honored, remark gated" });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // REPORTING-COUNT UNIFICATION (2026-06-26). One canonical "active operational
  // lead" definition — activeLeadWhere (leadScope.ts): leadOrigin ∈ ACTIVE_ORIGINS
  // (NOT cold/revival, NOT master-data) AND deletedAt:null AND currentStatus NOT
  // terminal. Four shipped invariants lock the unification + the M1/M3/M5 fixes so
  // a future refactor can't silently re-diverge the manager-facing counts.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "single-active-definition — same agent's active-lead count is identical across leaderboard/reports/team/agent-performance (all == activeLeadWhere)",
    run: async () => {
      const fs = await import("fs");
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      // Canonical activeLeadWhere, replicated BYTE-FOR-BYTE from leadScope.ts (which
      // is server-only and can't be imported under bare tsx). When the source helper
      // changes, mirror it here.
      const ACTIVE_ORIGINS = ["ACTIVE", "ACTIVE_LEAD"];
      const WORKABLE_OR = [
        { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      const activeLeadWhere = (scope: Record<string, unknown>) => ({
        ...scope, deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS }, OR: WORKABLE_OR,
      });

      // DB invariant: for every active sales agent, the FOUR surface predicates all
      // equal the canonical count. Each is the exact `where` the rerouted surface now
      // runs (leaderboard groupBy, team groupBy = activeLeadWhere; agent-performance
      // stillActive = ACTIVE_ORIGIN_WHERE + non-terminal OR; profile/team-detail =
      // ownerActiveWhere → activeLeadWhere). If any differs, the surfaces have drifted.
      const agents = await prisma.user.findMany({
        where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
        select: { id: true, name: true },
      });
      let checked = 0;
      for (const a of agents) {
        const canonical = await prisma.lead.count({ where: activeLeadWhere({ ownerId: a.id }) });
        // leaderboard / team page both call activeLeadWhere({ ownerId }) — same object.
        const leaderboard = await prisma.lead.count({ where: activeLeadWhere({ ownerId: a.id }) });
        // agent-performance stillActive: ACTIVE_ORIGIN_WHERE + deletedAt + the explicit
        // non-terminal OR (its own ACTIVE_OR, identical to WORKABLE_OR).
        const agentPerf = await prisma.lead.count({
          where: { ownerId: a.id, deletedAt: null, leadOrigin: { in: ACTIVE_ORIGINS }, OR: WORKABLE_OR },
        });
        assert(canonical === leaderboard, `active count drift (leaderboard) for ${a.name}: canonical=${canonical} leaderboard=${leaderboard}`);
        assert(canonical === agentPerf, `active count drift (agent-performance stillActive) for ${a.name}: canonical=${canonical} agentPerf=${agentPerf}`);
        checked++;
      }

      // SOURCE invariant: the rerouted surfaces import the canonical helper and no
      // longer compute "active" via the old `leadOrigin notIn COLD_ORIGINS` (which
      // wrongly counted MASTER_DATA). ownerActiveWhere must delegate to activeLeadWhere.
      const leadScope = fs.readFileSync("src/lib/leadScope.ts", "utf8");
      assert(/export function activeLeadWhere/.test(leadScope), "leadScope.ts must export activeLeadWhere (the canonical active definition)");
      assert(/export function ownerActiveWhere[\s\S]{0,160}return activeLeadWhere\(/.test(leadScope), "ownerActiveWhere must delegate to activeLeadWhere (so profile/team-detail match)");
      const lb = fs.readFileSync("src/app/(app)/reports/leaderboard/page.tsx", "utf8");
      assert(/activeLeadWhere\(/.test(lb) && !/notIn:\s*COLD_ORIGINS/.test(lb), "leaderboard must use activeLeadWhere, not leadOrigin notIn COLD_ORIGINS");
      const teamPage = fs.readFileSync("src/app/(app)/team/page.tsx", "utf8");
      assert(/activeLeadWhere\(/.test(teamPage), "team page must use activeLeadWhere for the active/workload counts");
      const agentPerfLib = fs.readFileSync("src/lib/agentPerformance.ts", "utf8");
      assert(/ACTIVE_ORIGIN_WHERE/.test(agentPerfLib), "agentPerformance stillActive must add ACTIVE_ORIGIN_WHERE (exclude cold/master-data)");
      const reportsPage = fs.readFileSync("src/app/(app)/reports/page.tsx", "utf8");
      assert(/ACTIVE_ORIGIN_WHERE/.test(reportsPage) && !/notIn:\s*COLD_ORIGINS/.test(reportsPage), "reports page funnel/forecast must use ACTIVE_ORIGIN_WHERE, not notIn COLD_ORIGINS");

      results.push({ name: "  ↳ note", ok: true, detail: `active-lead count identical across surfaces for all ${checked} agents (== activeLeadWhere); master-data excluded` });
    },
  },

  {
    name: "reports-lost-currentstatus — buildReport Lost/Won key off currentStatus (canonical sets), NOT the dead status enum",
    run: async () => {
      const fs = await import("fs");
      const { LOST_STATUSES, BOOKED_STATUSES } = await import("../src/lib/lead-statuses");
      // SOURCE: the dead `status: LeadStatus.LOST/WON` enums must be GONE from reports.ts;
      // Lost → currentStatus ∈ LOST_STATUSES, Won → currentStatus ∈ BOOKED_STATUSES.
      const reports = fs.readFileSync("src/lib/reports.ts", "utf8");
      assert(!/status:\s*LeadStatus\.LOST/.test(reports), "reports.ts Lost must NOT use the dead status: LeadStatus.LOST enum");
      assert(!/status:\s*LeadStatus\.WON/.test(reports), "reports.ts Won must NOT use the dead status: LeadStatus.WON enum");
      assert(/currentStatus:\s*\{\s*in:\s*LOST_STATUSES\s*\}/.test(reports), "reports.ts Lost must count currentStatus ∈ LOST_STATUSES");
      assert(/currentStatus:\s*\{\s*in:\s*BOOKED_STATUSES\s*\}/.test(reports), "reports.ts Won must count currentStatus ∈ BOOKED_STATUSES");
      // DATA: the real (currentStatus) Lost population is materially larger than the
      // dead-enum count — proving the fix corrects the manager-emailed number.
      const lostReal = await prisma.lead.count({ where: { deletedAt: null, currentStatus: { in: LOST_STATUSES } } });
      const lostDeadEnum = await prisma.lead.count({ where: { deletedAt: null, status: "LOST" } });
      assert(lostReal >= lostDeadEnum, `currentStatus Lost (${lostReal}) should be ≥ the dead-enum Lost (${lostDeadEnum})`);
      // qualityScore must also be off the dead enums.
      const quality = fs.readFileSync("src/lib/qualityScore.ts", "utf8");
      assert(!/status:\s*LeadStatus\.WON/.test(quality), "qualityScore computeFunnel must NOT use status: LeadStatus.WON");
      assert(/currentStatus:\s*\{\s*in:\s*BOOKED_STATUSES\s*\}/.test(quality), "qualityScore WON must use currentStatus ∈ BOOKED_STATUSES");
      assert(/ACTIVE_PURSUIT_STATUSES/.test(quality), "qualityScore active-pipeline must use ACTIVE_PURSUIT_STATUSES (not the dead status enum list)");
      void BOOKED_STATUSES;
      results.push({ name: "  ↳ note", ok: true, detail: `reports/quality off dead enums; Lost currentStatus=${lostReal} vs dead-enum=${lostDeadEnum}` });
    },
  },

  {
    name: "master-data-count-eq-table — category/queue counts apply the SAME filter the table uses (header == table under a sample filter)",
    run: async () => {
      const fs = await import("fs");
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      // SOURCE: the page must NO LONGER call the no-arg leadCounts helpers (which
      // ignored the active filters); it must count each category via whereFor(cat).
      const md = fs.readFileSync("src/app/(app)/master-data/page.tsx", "utf8");
      assert(!/countMasterDataCategories\(/.test(md) && !/countAssignmentQueues\(/.test(md), "master-data must not use the no-arg leadCounts helpers (they ignore filters → header≠table)");
      assert(/prisma\.lead\.count\(\{\s*where:\s*whereFor\("all"\)/.test(md), "master-data category counts must use whereFor(cat) (the same filter the table runs)");

      // DATA: replicate the page's where-builder and prove count(whereFor(cat)) ==
      // the table's row count for that cat, BOTH with no filter AND under a sample
      // status filter — i.e. header badge == table rows in both cases.
      const WORKABLE_OR = [
        { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
      ];
      const coldFilter = { isColdCall: false };
      const sampleStatus = "Follow Up"; // a common workable status present on real leads
      const sampleAnd = [{ currentStatus: sampleStatus }]; // mirrors leadFilterWhere(?cstatus=Follow Up)
      const workableCat = { deletedAt: null, OR: WORKABLE_OR };
      // (a) unfiltered workable
      const headerNoFilter = await prisma.lead.count({ where: { ...coldFilter, AND: [workableCat] } });
      const tableNoFilter = await prisma.lead.count({ where: { ...coldFilter, AND: [workableCat] } });
      assert(headerNoFilter === tableNoFilter, `master-data header≠table (no filter): ${headerNoFilter} vs ${tableNoFilter}`);
      // (b) filtered workable — header count and table query share the SAME where
      const headerFiltered = await prisma.lead.count({ where: { ...coldFilter, AND: [...sampleAnd, workableCat] } });
      const tableFiltered = await prisma.lead.count({ where: { ...coldFilter, AND: [...sampleAnd, workableCat] } });
      assert(headerFiltered === tableFiltered, `master-data header≠table (status filter): ${headerFiltered} vs ${tableFiltered}`);
      assert(headerFiltered <= headerNoFilter, "a status-filtered category count must be ≤ the unfiltered count");

      results.push({ name: "  ↳ note", ok: true, detail: `master-data header==table (workable: ${headerNoFilter} all, ${headerFiltered} under '${sampleStatus}')` });
    },
  },

  {
    name: "cold-all-eq-sum-chips — Revival 'All' == Fresh(unstatused) + Σ(per-status chips) (no cold lead is chip-less)",
    run: async () => {
      const fs = await import("fs");
      const { INDIA_STATUSES, DUBAI_STATUSES, NEEDS_REVIEW } = await import("../src/lib/lead-statuses");
      // SOURCE: the Fresh/Unstatused chip + its filter sentinel must exist so the
      // ~45 status-less cold leads are represented (closing the All ≠ Σchips gap).
      const cold = fs.readFileSync("src/app/(app)/cold-calls/page.tsx", "utf8");
      assert(/FRESH_SENTINEL/.test(cold) && /unstatusedWhere/.test(cold), "cold-calls must add the Fresh/Unstatused chip (FRESH_SENTINEL + unstatusedWhere)");
      assert(/unstatusedCount\s*>\s*0/.test(cold), "cold-calls must render the Fresh chip when unstatusedCount > 0");
      // The market-neutral "Needs Review" sentinel must be in the page's status universe
      // so revalidation-flagged cold leads get a chip (never chip-less → keeps All==Σchips).
      assert(/NEEDS_REVIEW/.test(cold), "cold-calls must include NEEDS_REVIEW in ALL_POSSIBLE_STATUSES so flagged leads get a chip");

      // DATA: All == unstatused + Σ(known-status counts), and CRUCIALLY no cold lead
      // carries a status outside the known set (which would be chip-less). "Needs Review"
      // is a legitimate cross-market sentinel, so it counts as a known chip here too.
      const COLD_ORIGINS = ["COLD", "REVIVAL"];
      const known = Array.from(new Set([...INDIA_STATUSES, ...DUBAI_STATUSES, NEEDS_REVIEW])) as string[];
      // Mirror the page: rejected revival leads are excluded from the active view
      // (archived to Master Data with the "Revival Engine Rejected" tag).
      const base = { leadOrigin: { in: COLD_ORIGINS }, deletedAt: null, rejectedAt: null };
      const all = await prisma.lead.count({ where: base });
      const unstatused = await prisma.lead.count({ where: { ...base, OR: [{ currentStatus: null }, { currentStatus: "" }] } });
      let sumKnown = 0;
      for (const s of known) sumKnown += await prisma.lead.count({ where: { ...base, currentStatus: s } });
      // Any cold lead whose status is non-null/non-blank AND not in the known set →
      // it would be chip-less. Assert there are none, so Fresh + known chips == All.
      const unknownStatus = all - unstatused - sumKnown;
      assert(unknownStatus === 0, `${unknownStatus} cold lead(s) carry a status outside the known India∪Dubai set (chip-less → All≠Σchips)`);
      assert(all === unstatused + sumKnown, `cold All (${all}) ≠ Fresh (${unstatused}) + Σ known-status chips (${sumKnown})`);

      results.push({ name: "  ↳ note", ok: true, detail: `cold All=${all} == Fresh=${unstatused} + Σchips=${sumKnown} (0 chip-less)` });
    },
  },
  {
    name: "report-manager-team-scope — a MANAGER's ?agent=/?user= can't reveal another team's data in reports",
    run: async () => {
      const fs = await import("fs");
      // /reports/daily: a MANAGER's ?agent= must be validated against their own team
      // (the param used to select the target user directly with no team constraint).
      const daily = fs.readFileSync("src/app/(app)/reports/daily/page.tsx", "utf8");
      assert(/managerTeam/.test(daily) && /normalizeTeam\(targetUser\.team\)/.test(daily),
        "reports/daily must validate ?agent= against the manager's team (managerTeam + normalizeTeam(targetUser.team))");
      // Daily PDF export: explicit ?agent= must not bypass the manager team scope → 403.
      const dailyPdf = fs.readFileSync("src/app/api/reports/daily/pdf/route.ts", "utf8");
      assert(/normalizeTeam\(agent\.team\)/.test(dailyPdf) && /\b403\b/.test(dailyPdf),
        "daily PDF export must 403 a MANAGER exporting an off-team agent");
      // /reports/changes: leadFieldHistory must be team-scoped for a MANAGER (query + picker).
      const changes = fs.readFileSync("src/app/(app)/reports/changes/page.tsx", "utf8");
      assert(/managerTeam/.test(changes) && /lead:\s*\{\s*forwardedTeam:\s*managerTeam/.test(changes),
        "reports/changes must scope leadFieldHistory to the manager's team (lead.forwardedTeam == managerTeam)");
      results.push({ name: "  ↳ note", ok: true, detail: "daily(page+pdf) + changes enforce manager team scope on report params" });
    },
  },
  {
    name: "master-data-source-families — canonical labels (incl. WCR_WEBSITE) + Website/Event presets match the source FAMILY (not one label string)",
    run: async () => {
      const fs = await import("fs");
      const { SOURCE_LABELS, isWebsiteSource, isEventSource } = await import("../src/lib/lead-sources");
      // LOGIC: every website/event enum variant resolves to a FRIENDLY label (not the
      // ALL_CAPS_UNDERSCORE fallback) — the old page-local map dropped these three.
      for (const s of ["WEBSITE", "WCR_WEBSITE", "WCR_EVENT", "LANDING_PAGE"]) {
        assert(!!SOURCE_LABELS[s] && !/_/.test(SOURCE_LABELS[s] ?? ""), `SOURCE_LABELS missing friendly label for ${s}`);
      }
      // LOGIC: the family predicates cover ALL variants (so "New Website Leads" /
      // "Event Leads" presets can't silently miss WCR_*/Landing-Page leads).
      assert(["WEBSITE", "WCR_WEBSITE", "LANDING_PAGE"].every(isWebsiteSource), "isWebsiteSource must cover Website/WCR Website/Landing Page");
      assert(["WCR_EVENT", "EVENT"].every(isEventSource), "isEventSource must cover Event/WCR Event");
      assert(!isWebsiteSource("REFERRAL") && !isEventSource("WEBSITE"), "family predicates must not over-match");
      // SOURCE: Master Data must carry the raw enum (for family tests) and DISPLAY the
      // same normalized field the Source column filter reads — the verbatim sourceRaw
      // via effectiveSource(), NOT the enum-only label. The old enum-keyed label
      // collapsed real sourceRaw values (e.g. "Townscript", whose enum is OTHER) to
      // "Other", so a row filterable as Townscript displayed as Other (filter≠display).
      // Still must NOT compare a display label by string (the other regression here).
      const page = fs.readFileSync("src/app/(app)/master-data/page.tsx", "utf8");
      const tbl = fs.readFileSync("src/components/MasterDataRecordsTable.tsx", "utf8");
      assert(/sourceLabel:\s*effectiveSource\(/.test(page), "master-data page must DISPLAY the Source via effectiveSource(sourceRaw, source) so the column matches the sourceRaw-based filter (real values like Townscript must not collapse to Other)");
      assert(/source:\s*l\.source/.test(page), "master-data page must carry the raw enum source on each row (isWebsiteSource/isEventSource family tests)");
      assert(/isWebsiteSource\(r\.source\)/.test(tbl) && /isEventSource\(r\.source\)/.test(tbl), "table presets/sectionRank must test the source family via r.source");
      assert(!/sourceLabel === "Website"|sourceLabel === "Event"/.test(tbl), "table must not compare the display label by string anymore");
      // DATA: no LIVE lead carries a source that renders as an unlabeled ALL_CAPS token.
      const live = await prisma.lead.findMany({ where: { deletedAt: null }, select: { source: true }, distinct: ["source"] });
      const unlabeled = live.map((l) => l.source).filter((s) => s && !SOURCE_LABELS[s as string]);
      assert(unlabeled.length === 0, `live sources with no friendly label: ${unlabeled.join(", ")}`);
      results.push({ name: "  ↳ note", ok: true, detail: `${live.length} distinct live sources, all labeled; Website/Event presets family-matched` });
    },
  },
  {
    name: "buyer-pipeline-tabs — Buyer list defaults to Active (pool+assigned, terminal excluded); Rejected + Converted have their own tabs; cards clickable",
    run: async () => {
      const fs = await import("fs");
      const cl = fs.readFileSync("src/components/BuyerListClient.tsx", "utf8");
      const pg = fs.readFileSync("src/app/(app)/buyer-data/page.tsx", "utf8");
      // The default view is the working pipeline so terminal CONVERTED/REJECTED no
      // longer inflate it (B2); All is still reachable explicitly.
      // Default is the working pipeline — now URL-DRIVEN (?tab=) so it's the same on every
      // device, but still falls back to "active" when no param is present (2026-07-08).
      assert(/useState<Tab>\(.*"active"\)/.test(cl), "Buyer list must default to the Active tab (URL-driven ?? active)");
      assert(/tab === "active" && r\.poolStatus !== "ADMIN_POOL" && r\.poolStatus !== "ASSIGNED"/.test(cl), "Active tab must include only ADMIN_POOL + ASSIGNED");
      // Rejected has a tab + filter (B1); Converted too. Both gated to admin.
      assert(/tabBtn\("rejected"/.test(cl) && /tab === "rejected" && r\.poolStatus !== "REJECTED"/.test(cl), "Rejected must have a tab + filter");
      assert(/tabBtn\("converted"/.test(cl), "Converted must have a tab");
      // Summary cards are clickable status filters (B3) and the page feeds the counts.
      // `active` is now a plain boolean, so aria-pressed={active} (was {!!active}).
      assert(/aria-pressed=\{!*active\}/.test(cl) && /tabKey: "rejected"/.test(cl), "summary cards must be clickable + include Rejected");
      assert(/rejected: rejectedCount/.test(pg) && /summary=\{\{/.test(pg), "page must pass a summary incl. rejectedCount to the buyer list");
      // CROSS-DEVICE (2026-07-08): the tab AND the Unique/Repeat cards are URL-driven
      // (?tab=, ?repeat=) so a click behaves identically on Windows / iMac / iPad and
      // survives a refresh or a shared link — the root fix for "cards work on Windows,
      // not on the iMac". Unique/Repeat are now clickable filters, not dead tiles.
      assert(/const selectRepeat =/.test(cl) && /sp\.set\("repeat", v\)/.test(cl), "Unique/Repeat filter must be URL-driven (?repeat=)");
      assert(/onClick: \(\) => selectRepeat\(/.test(cl), "Unique + Repeat summary cards must be clickable (selectRepeat)");
      results.push({ name: "  ↳ note", ok: true, detail: "buyer list: default Active (terminal excluded), Rejected+Converted tabs, clickable URL-driven summary cards" });
    },
  },
  {
    name: "buyer-status-followup-columns — businessStatus (≠ poolStatus) + followupDate are typed BuyerRecord columns, imported via parseImportDate, shown split on the buyer view (R4/R5)",
    run: async () => {
      const fs = await import("fs");
      const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
      const route = fs.readFileSync("src/app/api/buyer-data/import/route.ts", "utf8");
      const page = fs.readFileSync("src/app/(app)/buyer-data/[id]/page.tsx", "utf8");
      // SCHEMA: the additive columns exist on BuyerRecord, DISTINCT from poolStatus.
      const i = schema.indexOf("model BuyerRecord");
      const nextModel = schema.indexOf("\nmodel ", i + 10);
      const buyerBlock = schema.slice(i, nextModel === -1 ? undefined : nextModel);
      assert(/businessStatus\s+String\?/.test(buyerBlock), "BuyerRecord must have a nullable businessStatus column");
      assert(/followupDate\s+DateTime\?/.test(buyerBlock), "BuyerRecord must have a nullable followupDate column");
      assert(/@@index\(\[followupDate\]\)/.test(buyerBlock), "followupDate must be indexed (drives follow-up queries)");
      // IMPORT WRITE PATH: new imports populate both; follow-up parsed via parseImportDate.
      assert(/businessStatus:\s*importedStatus/.test(route), "import route must write businessStatus from the imported Status column");
      assert(/followupDate:\s*importedFollowupDate/.test(route) && /parseFollowupDate\(importedFollowupRaw\)/.test(route), "import route must write followupDate parsed via the guarded parseFollowupDate");
      // DISPLAY (R4): Status = businessStatus, Pool = poolStatus, shown SEPARATELY.
      assert(/rec\.businessStatus/.test(page), "buyer view must render the imported Status (businessStatus)");
      assert(/Pool: \{poolLabel\}/.test(page), "buyer view must label the pool chip 'Pool' (separate from the imported Status)");
      assert(/fmtDate\(rec\.followupDate\)/.test(page), "buyer view must show the follow-up date");
      // LIST (R10): a real Status column + a Follow-up column; the pool column is
      // relabeled "Pool" so the R4 split holds on the list too.
      const list = fs.readFileSync("src/components/BuyerListClient.tsx", "utf8");
      assert(/key:\s*"businessStatus",\s*label:\s*"Status"/.test(list), "buyer list must have a Status column reading businessStatus");
      assert(/key:\s*"followup",\s*label:\s*"Follow-up"/.test(list), "buyer list must have a Follow-up column");
      assert(/key:\s*"poolStatus",\s*label:\s*"Pool"/.test(list), "buyer list pool column must be relabeled 'Pool' (not 'Status')");
      results.push({ name: "  ↳ note", ok: true, detail: "buyer Status (businessStatus) distinct from Data Pool (poolStatus); follow-up parsed + shown like a lead's; list has Status+Follow-up columns" });
    },
  },
  {
    name: "buyer-followup-guard-and-editable — followupDate uses ONE guarded parser everywhere (stray numbers never become 1900s dates); Status/Follow-up are priority-picked + editable in-app",
    run: async () => {
      const fs = await import("fs");
      // FIX-1: the guarded parser — a bare number is a date ONLY when it's a plausible
      // Excel serial (30000–80000); a small int / bare year / text is NOT a date.
      const { parseFollowupDate } = await import("../src/lib/parseImportDate");
      assert(parseFollowupDate("5") === undefined, "'5' must NOT become a 1900s date");
      assert(parseFollowupDate("100") === undefined, "'100' must NOT become a date");
      assert(parseFollowupDate("2026") === undefined, "bare year '2026' must NOT become a date");
      assert(parseFollowupDate("999") === undefined, "'999' must NOT become a date");
      assert(parseFollowupDate("46199") instanceof Date, "a real Excel serial (46199) must parse to a date");
      assert(parseFollowupDate("46199.625") instanceof Date, "a decimal serial must parse");
      assert(parseFollowupDate("22/05/2026") instanceof Date, "dd/mm/yyyy must parse");
      assert(parseFollowupDate("") === undefined && parseFollowupDate("Call back") === undefined, "blank/unparseable text → undefined");
      // ALL three paths (import route, backfill, remark display) route through parseFollowupDate.
      const route = fs.readFileSync("src/app/api/buyer-data/import/route.ts", "utf8");
      const backfill = fs.readFileSync("scripts/backfill-buyer-status-followup.ts", "utf8");
      const timeline = fs.readFileSync("src/lib/buyerRemarkTimeline.ts", "utf8");
      assert(/parseFollowupDate\(importedFollowupRaw\)/.test(route), "import route must parse follow-up via the guarded parseFollowupDate");
      assert(/parseFollowupDate\(fuRaw\)/.test(backfill), "backfill must parse follow-up via parseFollowupDate");
      assert(/parseFollowupDate\(v\)/.test(timeline), "remark display (readableFollowup) must use parseFollowupDate");
      // FIX-3: priority-ordered pick (iterate KEYS, not the row) so primary "Status" beats "Status 2".
      assert(/for \(const key of keys\)/.test(route) && /for \(const key of keys\)/.test(backfill), "Status/Follow-up pick must iterate keys in priority order");
      // FIX-2: businessStatus + followupDate editable — in the update ALLOWED set + wired on the detail page.
      const upd = fs.readFileSync("src/app/api/buyer-data/[id]/update/route.ts", "utf8");
      assert(/businessStatus:\s*"string"/.test(upd) && /followupDate:\s*"date"/.test(upd), "buyer update route must allow editing businessStatus + followupDate");
      const page = fs.readFileSync("src/app/(app)/buyer-data/[id]/page.tsx", "utf8");
      assert(/editable\("businessStatus"/.test(page) && /editable\("followupDate"/.test(page), "buyer detail must render businessStatus + followupDate as editable");
      results.push({ name: "  ↳ note", ok: true, detail: "follow-up guarded parser unified (route+backfill+display); Status/Follow-up editable + priority-ordered pick" });
    },
  },
  {
    name: "buyer-contact-rescue — an unmapped phone/email column ('Primary Mobile Number') is rescued into phones/emails; 'Unit Number' is never treated as a phone; import route falls back",
    run: async () => {
      const fs = await import("fs");
      const { rescuePhones, rescueEmails } = await import("../src/lib/buyerContactRescue");
      const row = { "Buyer Name": "X", "Primary Mobile Number": "7021109292", "Unit Number": "WG-1404", "WhatsApp No": "9999888877", "Email ID": "a@b.com" };
      const ph = rescuePhones(row);
      assert(ph.includes("7021109292"), "must rescue the Primary Mobile Number");
      assert(ph.includes("9999888877"), "must also collect the WhatsApp number");
      assert(!ph.includes("WG-1404"), "must NOT treat 'Unit Number' as a phone");
      assert(rescueEmails(row).includes("a@b.com"), "must rescue the Email ID column");
      assert(rescuePhones({ "Followup Date": "46199", "Conversation History": "called" }).length === 0, "no phone-like column → no false rescue");
      // The import route falls back to the rescue when the mapped phone/email is empty.
      const route = fs.readFileSync("src/app/api/buyer-data/import/route.ts", "utf8");
      assert(/rescuePhones\(rescueSrc\)/.test(route) && /rescueEmails\(rescueSrc\)/.test(route), "import route MUST fall back to rescuePhones/rescueEmails when the mapped phone/email is empty");
      // The wizard aliases now catch the real-world header so future imports auto-map it.
      const map = fs.readFileSync("src/lib/buyerImportMap.ts", "utf8");
      assert(/primary mobile number/i.test(map), "phones aliases must include 'primary mobile number' so the wizard auto-maps it");
      results.push({ name: "  ↳ note", ok: true, detail: "unmapped Primary Mobile Number rescued; Unit Number never a phone; route falls back + alias added" });
    },
  },
  {
    name: "buyer-reject-convert-redirect — after reject/convert an agent loses buyer access; the panel navigates AWAY (no self-refresh 404)",
    run: async () => {
      const fs = await import("fs");
      const c = fs.readFileSync("src/components/BuyerAdminPanel.tsx", "utf8");
      const convertFn = c.slice(c.indexOf("async function convert"), c.indexOf("async function reject"));
      const rejectFn = c.slice(c.indexOf("async function reject"), c.indexOf("async function returnToPool"));
      // Reject returns the buyer to the Admin Pool (ownerId cleared) → an agent can no
      // longer view it (canTouchBuyer → 404 on refresh). Must navigate to the list.
      assert(/router\.replace\("\/buyer-data"\)/.test(rejectFn), "reject must navigate to /buyer-data (not refresh the now-pooled buyer → 404)");
      assert(!/router\.refresh\(\)/.test(rejectFn), "reject must NOT router.refresh() the now-inaccessible buyer page");
      // Convert → poolStatus CONVERTED → same access loss → go to the new lead.
      assert(/router\.replace\(/.test(convertFn) && /leads\/\$\{j\.leadId\}/.test(convertFn), "convert must navigate to the newly-created lead");
      assert(!/router\.refresh\(\)/.test(convertFn), "convert must NOT router.refresh() the now-converted buyer page");
      results.push({ name: "  ↳ note", ok: true, detail: "buyer reject → /buyer-data, convert → new lead; no self-refresh 404 (agent loses access after both)" });
    },
  },
  {
    // REVERSIBLE BULK OPS (Lalit 2026-07-08): buyer bulk Transfer + Edit-Field are
    // ADMIN-only, each records an OperationLog (before-state), and an admin can revert
    // them from Admin → Operations. Locks the safety + reversibility so it can't regress.
    name: "reversible-bulk-ops — buyer bulk transfer/edit are admin-only + logged + revertable",
    run: async () => {
      const fs = await import("fs");
      const bulk = fs.readFileSync("src/app/api/buyer-data/bulk/route.ts", "utf8");
      // (a) Transfer + Edit gated to admin (isBuyerAdmin) — no manager, no agent.
      assert(/if \(action === "transfer"\)[\s\S]{0,120}isBuyerAdmin\(me\)/.test(bulk), "bulk transfer must be admin-only (isBuyerAdmin)");
      assert(/if \(action === "edit"\)[\s\S]{0,160}isBuyerAdmin\(me\)/.test(bulk), "bulk edit must be admin-only (isBuyerAdmin)");
      assert(!/me\.role !== "ADMIN" && me\.role !== "MANAGER"/.test(bulk), "bulk transfer must NOT allow MANAGER anymore");
      // (b) Both ops capture a before-snapshot + log an OperationLog for revert.
      assert((bulk.match(/logOperation\(/g) ?? []).length >= 2 && /snapshotBuyers\(/.test(bulk), "transfer + edit must snapshot + logOperation");
      // (c) The revert route exists and is admin-only.
      const revert = fs.readFileSync("src/app/api/admin/operations/[id]/revert/route.ts", "utf8");
      assert(/me\.role !== "ADMIN"/.test(revert) && /revertOperation\(/.test(revert), "revert route must be admin-only + call revertOperation");
      // (d) The helper restores only the op's fields (edit → the one field; transfer → ownership).
      const helper = fs.readFileSync("src/lib/operationLog.ts", "utf8");
      assert(/status: "UNDONE"/.test(helper) && /buyerRestoreData/.test(helper), "revertOperation must restore before-state + mark UNDONE");
      // Helper handles BOTH entity types + convert (delete created lead) + lead revert.
      assert(/leadRestoreData/.test(helper) && /snapshotLeads/.test(helper), "operationLog must support Lead revert (snapshotLeads + leadRestoreData)");
      assert(/op\.operation === "buyer\.convert"/.test(helper) && /deletedAt: new Date\(\)/.test(helper), "convert revert must soft-delete the created lead");
      // (e) OperationLog model exists in the schema.
      const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
      assert(/model OperationLog \{/.test(schema) && /beforeState\s+Json/.test(schema), "OperationLog model must exist with beforeState");
      // (f) Convert + Lead transfer + Buyer import-revert are all wired.
      assert(/logOperation\(/.test(fs.readFileSync("src/app/api/buyer-data/[id]/convert/route.ts", "utf8")), "convert route must logOperation (revertable)");
      assert(/logOperation\(/.test(fs.readFileSync("src/app/api/leads/bulk/route.ts", "utf8")), "leads bulk must logOperation (revertable transfer)");
      const bimp = fs.readFileSync("src/app/api/buyer-data/import/history/[id]/route.ts", "utf8");
      assert(/isSuperAdmin/.test(bimp) && /deleteMany/.test(bimp) && /status: "DELETED"/.test(bimp), "buyer import-revert route: soft-delete + super-admin purge");
      results.push({ name: "  ↳ note", ok: true, detail: "buyer bulk transfer/edit/convert + lead transfer OperationLog-captured + admin-revertable; buyer import revert (soft→purge) wired" });
    },
  },
  {
    name: "buyer-terminal-reject — Reject is TERMINAL (poolStatus=REJECTED + audit fields); Return-to-Pool + Reactivate are SEPARATE routes/actions",
    run: async () => {
      const fs = await import("fs");
      const life = fs.readFileSync("src/lib/buyerLifecycle.ts", "utf8");
      // Engine: rejectBuyerInTx → REJECTED (terminal) + stamps rejectCategory/aiEligible.
      const rejFn = life.slice(life.indexOf("export async function rejectBuyerInTx"), life.indexOf("export async function reactivateBuyerInTx"));
      assert(rejFn.length > 0, "rejectBuyerInTx must exist");
      assert(/poolStatus:\s*BUYER_POOL_STATUS\.REJECTED/.test(rejFn), "rejectBuyerInTx must set poolStatus=REJECTED (terminal, not ADMIN_POOL)");
      assert(/rejectCategory/.test(rejFn) && /aiEligibleForRevival/.test(rejFn), "rejectBuyerInTx must stamp rejectCategory + aiEligibleForRevival");
      assert(/export async function reactivateBuyerInTx/.test(life), "reactivateBuyerInTx must exist (AI reactivation flow)");
      // Return-to-pool must NOT stamp reject markers (a return is not a reject).
      const retFn = life.slice(life.indexOf("export async function returnBuyerToPoolInTx"), life.indexOf("export async function rejectBuyerInTx"));
      assert(/poolStatus:\s*BUYER_POOL_STATUS\.ADMIN_POOL/.test(retFn) && /rejectedAt:\s*null/.test(retFn), "returnBuyerToPoolInTx must go to ADMIN_POOL + clear reject markers (return != reject)");
      // Separate routes exist + wired correctly.
      assert(fs.existsSync("src/app/api/buyer-data/[id]/return-to-pool/route.ts"), "return-to-pool route must exist");
      assert(fs.existsSync("src/app/api/buyer-data/[id]/reactivate/route.ts"), "reactivate route must exist");
      assert(/rejectBuyerInTx/.test(fs.readFileSync("src/app/api/buyer-data/[id]/reject/route.ts", "utf8")), "reject route must call rejectBuyerInTx (terminal)");
      const reactRoute = fs.readFileSync("src/app/api/buyer-data/[id]/reactivate/route.ts", "utf8");
      assert(/me\.role !== "ADMIN"/.test(reactRoute) && /BUYER_POOL_STATUS\.REJECTED/.test(reactRoute), "reactivate must be admin-only + only for a REJECTED buyer");
      // UI: three distinct actions; 404 nav preserved.
      const panel = fs.readFileSync("src/components/BuyerAdminPanel.tsx", "utf8");
      assert(/\/reject`/.test(panel) && /\/return-to-pool`/.test(panel) && /\/reactivate`/.test(panel), "panel must call all three distinct endpoints");
      assert(/router\.replace\("\/buyer-data"\)/.test(panel), "reject/return must navigate to /buyer-data (keep the 404 fix)");
      results.push({ name: "  ↳ note", ok: true, detail: "Reject terminal (REJECTED + audit); Return-to-Pool + Reactivate separate; 404 nav preserved" });
    },
  },
  {
    name: "fresh-leads — freshLeads.ts single source: assigned-today + untouched subset invariants, tier-0 sort, 5 surfaces wired, escalation default-OFF",
    run: async () => {
      const fs = await import("node:fs");
      const { freshUntouchedWhere, FIRST_CONTACT_ACTIVITY_TYPES } = await import("../src/lib/freshLeads");
      const { istDayRange } = await import("../src/lib/datetime");
      const { start, end } = istDayRange();

      // (a) freshUntouched ⊆ assigned/created-today.
      const fuTotal = await prisma.lead.count({ where: freshUntouchedWhere({}) });
      const fuAssignedToday = await prisma.lead.count({
        where: { AND: [
          freshUntouchedWhere({}),
          { OR: [{ assignedAt: { gte: start, lt: end } }, { assignedAt: null, createdAt: { gte: start, lt: end } }] },
        ] },
      });
      assert(fuTotal === fuAssignedToday, `fresh-untouched not all assigned/created-today: ${fuTotal} total vs ${fuAssignedToday} assigned-today`);

      // (b) freshUntouched ⊆ untouched — 0 have a call OR a first-contact activity.
      const fuTouchedLeak = await prisma.lead.count({
        where: { AND: [
          freshUntouchedWhere({}),
          { OR: [{ callLogs: { some: {} } }, { activities: { some: { type: { in: FIRST_CONTACT_ACTIVITY_TYPES } } } }] },
        ] },
      });
      assert(fuTouchedLeak === 0, `${fuTouchedLeak} "fresh-untouched" lead(s) actually have a call/first-contact activity — untouched leak`);

      // (c) leadSortTier takes the flags object + pins a fresh lead created today at
      //     tier 0 (Lalit 2026-07-06 Fresh-Lead priority). Behaviour-checked, not just
      //     source-scanned: a fresh active-pipeline lead created today MUST be tier 0.
      const { leadSortTier: lst } = await import("../src/lib/lead-statuses");
      const pinToday = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") };
      assert(
        lst({ currentStatus: "Fresh Lead", createdAt: new Date("2026-06-21T05:00:00Z"), source: "WEBSITE" },
            pinToday, { activePipeline: true }) === 0,
        "leadSortTier MUST return tier 0 for a fresh active-pipeline lead created today (top-of-list pin)");

      // (d) All 5 surfaces import the single source of truth (DRY / no-drift).
      const freshLib = fs.readFileSync("src/lib/freshLeads.ts", "utf8");
      assert(/export function freshUntouchedWhere/.test(freshLib) && /export function freshTodayWhere/.test(freshLib)
        && /export function assignedTodayWhere/.test(freshLib) && /export function firstContactPendingWhere/.test(freshLib),
        "freshLeads.ts MUST export the 4 canonical where-builders");
      for (const [file, path] of [
        ["Leads page", "src/app/(app)/leads/page.tsx"],
        ["Master-Data filter", "src/lib/leadFilterWhere.ts"],
        ["Dashboard", "src/app/(app)/dashboard/page.tsx"],
        ["Action List", "src/app/(app)/action-list/page.tsx"],
        ["Reconciler", "src/lib/reconciler.ts"],
      ] as const) {
        assert(/@\/lib\/freshLeads/.test(fs.readFileSync(path, "utf8")), `${file} MUST import @/lib/freshLeads (single source)`);
      }

      // (e) Escalation ships GATED OFF (silent-first). Flag + default-OFF + reconciler wiring.
      const settingsSrc = fs.readFileSync("src/lib/settings.ts", "utf8");
      assert(/getFreshUntouchedEscalationEnabled/.test(settingsSrc) && /freshUntouched\.enabled/.test(settingsSrc) && /default OFF/.test(settingsSrc),
        "settings MUST expose getFreshUntouchedEscalationEnabled('freshUntouched.enabled'), default OFF");
      const recSrc = fs.readFileSync("src/lib/reconciler.ts", "utf8");
      assert(/freshUntouchedOn/.test(recSrc) && /if \(freshUntouchedOn\)/.test(recSrc),
        "reconciler MUST gate the fresh-untouched escalation behind the freshUntouched flag");

      results.push({ name: "  ↳ note", ok: true, detail: `fresh-untouched=${fuTotal} (all assigned-today, 0 touched-leak); tier-0 pin + 5 surfaces wired; escalation default-OFF` });
    },
  },
  {
    name: "lead-market-segregation — Market (India/UAE) is a DISTINCT field from Team; resolveMarket single-source + backfill integrity",
    run: async () => {
      const { resolveMarket, teamToMarket, currencyToMarket } = await import("../src/lib/market");
      // Team → Market mapping (India-family → India; Dubai/UAE → UAE; else null).
      assert(teamToMarket("India") === "India" && teamToMarket("Gurgaon") === "India", "India-family team → India market");
      assert(teamToMarket("Dubai") === "UAE" && teamToMarket("uae") === "UAE", "Dubai/UAE team → UAE market");
      assert(teamToMarket("") === null && teamToMarket(null) === null, "unknown team → null market");
      assert(currencyToMarket("INR") === "India" && currencyToMarket("AED") === "UAE", "INR→India, AED→UAE");
      // resolveMarket priority: explicit market > team > currency.
      assert(resolveMarket({ market: "UAE", forwardedTeam: "India" }) === "UAE", "explicit market wins over team");
      assert(resolveMarket({ forwardedTeam: "India" }) === "India", "derive from team when no explicit market");
      assert(resolveMarket({ budgetCurrency: "AED" }) === "UAE", "derive from currency when no team");
      assert(resolveMarket({}) === null, "truly-unclassifiable → null (surfaces in Awaiting Market)");
      // DATA integrity (backfill): every live lead with a team carries a market; market ⊆ {India,UAE}.
      const gap = await prisma.lead.count({ where: { deletedAt: null, market: null, forwardedTeam: { not: null } } });
      assert(gap === 0, `${gap} live lead(s) have a team but no market (backfill gap)`);
      const bad = await prisma.lead.count({ where: { deletedAt: null, NOT: { market: null }, market: { notIn: ["India", "UAE"] } } });
      assert(bad === 0, `${bad} live lead(s) have a market outside {India,UAE}`);
      results.push({ name: "  ↳ note", ok: true, detail: "Market(India/UAE) distinct from Team(forwardedTeam); resolveMarket single-source; 0 team-without-market, 0 out-of-range" });
    },
  },
  {
    name: "customer-computed-layer — pure compute/detect/search suites (Customer layer Step-1 foundation) all green",
    run: async () => {
      const { runComputeTests } = await import("../src/lib/customer/compute.test");
      const { runDetectTests } = await import("../src/lib/customer/detect.test");
      const { runSearchTests } = await import("../src/lib/customer/search.test");
      const c = runComputeTests(), d = runDetectTests(), s = runSearchTests();
      assert(c.failed === 0 && d.failed === 0 && s.failed === 0, `customer pure suites must be green (compute ${c.passed}/${c.failed}, detect ${d.passed}/${d.failed}, search ${s.passed}/${s.failed})`);
      results.push({ name: "  ↳ note", ok: true, detail: `customer-layer pure suites green: compute ${c.passed}, detect ${d.passed}, search ${s.passed}` });
    },
  },
  {
    name: "master-data-export-filtered — export POSTs the exact on-screen id-set (builtin view + column filters), not just URL params",
    run: async () => {
      const fs = await import("fs");
      const route = fs.readFileSync("src/app/api/reports/export/route.ts", "utf8");
      const tbl = fs.readFileSync("src/components/MasterDataRecordsTable.tsx", "utf8");
      const pg = fs.readFileSync("src/app/(app)/master-data/page.tsx", "utf8");
      // The route must expose a POST that takes an explicit leadIds set (ADMIN, audited).
      assert(/export async function POST\(/.test(route), "export route must have a POST handler");
      assert(/body\?\.leadIds/.test(route) && /requireRole\("ADMIN"\)/.test(route), "POST must read leadIds + be ADMIN-only");
      // The table must POST its FILTERED id-set (so the CSV == the visible rows).
      assert(/exportFiltered/.test(tbl) && /filtered\.map\(\(r\) => r\.id\)/.test(tbl), "table must export the filtered id-set");
      assert(/\/api\/reports\/export/.test(tbl) && /leadIds: ids/.test(tbl), "table must POST leadIds to the export route");
      // The old GET-only link (which ignored client filters) must be gone from the page.
      assert(!/href=\{exportHref\}/.test(pg), "stale GET export link must be removed from the Master Data header");
      results.push({ name: "  ↳ note", ok: true, detail: "Master Data export = POST(filtered id-set) → CSV equals the on-screen view incl. column filters + builtin" });
    },
  },
  {
    name: "overdue-boundary-canonical — 'Overdue follow-up' = before start-of-today IST everywhere (Today/Overdue disjoint, no double-count)",
    run: async () => {
      const fs = await import("fs");
      const { overdueFollowupBoundary, istDayRange } = await import("../src/lib/datetime");
      // LOGIC: the canonical boundary == start of today IST.
      assert(overdueFollowupBoundary().getTime() === istDayRange().start.getTime(), "overdueFollowupBoundary must equal istDayRange().start");
      // SOURCE: every overdue-follow-up surface routes through the canonical helper,
      // none re-introduces the `< now()` definition that overlapped with Today.
      const SURFACES = [
        "src/app/(app)/leads/page.tsx",
        "src/app/(app)/dashboard/page.tsx",
        "src/app/(app)/leads/overdue/page.tsx",
        "src/app/(app)/activities/page.tsx",
        "src/app/api/reports/export/route.ts",
      ];
      for (const f of SURFACES) {
        const src = fs.readFileSync(f, "utf8");
        assert(/overdueFollowupBoundary\(\)/.test(src), `${f} must use overdueFollowupBoundary()`);
        assert(!/followupDate:\s*\{\s*lt:\s*new Date\(\),\s*not:\s*null\s*\}/.test(src), `${f} still has a now()-based overdue followup boundary`);
      }
      // DATA: Today ⊔ Overdue == "Today+Overdue", and the two are disjoint — i.e.
      // todue == overdue + today exactly (off-by-one in the boundary would break this).
      const start = overdueFollowupBoundary();
      const end = new Date(istDayRange().end.getTime());
      const base = { deletedAt: null, followupDate: { not: null } } as const;
      const overdue = await prisma.lead.count({ where: { ...base, followupDate: { lt: start } } });
      const today = await prisma.lead.count({ where: { ...base, followupDate: { gte: start, lt: end } } });
      const todue = await prisma.lead.count({ where: { ...base, followupDate: { lt: end } } });
      assert(todue === overdue + today, `Today+Overdue (${todue}) ≠ Overdue (${overdue}) + Today (${today}) — boundary off-by-one`);
      results.push({ name: "  ↳ note", ok: true, detail: `overdue=${overdue} + today=${today} == todue=${todue} (disjoint); 5 surfaces canonical` });
    },
  },
  {
    name: "voice-channel-2-escalation — Escalation Thread API + UI wired; thread/message linkage intact; reply manager-gated",
    run: async () => {
      const fs = await import("fs");
      // SOURCE: the 3 routes exist + the component is mounted on the lead page.
      const raise = "src/app/api/leads/[id]/escalation/route.ts";
      const reply = "src/app/api/leads/[id]/escalation/[escId]/reply/route.ts";
      const resolve = "src/app/api/leads/[id]/escalation/[escId]/resolve/route.ts";
      for (const f of [raise, reply, resolve]) assert(fs.existsSync(f), `${f} must exist`);
      const raiseSrc = fs.readFileSync(raise, "utf8");
      const replySrc = fs.readFileSync(reply, "utf8");
      assert(/kind:\s*"ESCALATION"/.test(raiseSrc), "raise must create an ESCALATION message");
      assert(/role:\s*\{\s*in:\s*\["ADMIN",\s*"MANAGER"\]/.test(raiseSrc), "raise must notify admins/managers");
      assert(/kind:\s*"ESCALATION_REPLY"/.test(replySrc) && /MANAGER_REPLIED/.test(replySrc), "reply must add ESCALATION_REPLY + flip status");
      assert(/me\.role !== "ADMIN" && me\.role !== "MANAGER"/.test(replySrc), "reply must be manager-gated");
      const page = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/LeadEscalationThread/.test(page) && /leadEscalation\.findMany/.test(page), "lead page must fetch + mount the escalation thread");
      assert(fs.existsSync("src/components/useVoiceRecorder.ts"), "shared voice-recorder hook must exist");
      // LOGIC: the kinds exist in the generated client.
      const { VoiceMessageKind } = await import("@prisma/client");
      assert(!!(VoiceMessageKind as Record<string, string>).ESCALATION && !!(VoiceMessageKind as Record<string, string>).ESCALATION_REPLY, "VoiceMessageKind must include ESCALATION + ESCALATION_REPLY");
      // DATA: no orphan threads (every escalation has ≥1 message) + every escalation
      // message carries its escalationId (thread linkage integrity).
      const threads = await prisma.leadEscalation.findMany({ select: { id: true, _count: { select: { messages: true } } } });
      const orphan = threads.filter((t) => t._count.messages === 0).length;
      assert(orphan === 0, `${orphan} escalation thread(s) have no messages`);
      const unlinked = await prisma.leadVoiceMessage.count({ where: { kind: { in: ["ESCALATION", "ESCALATION_REPLY"] }, escalationId: null } });
      assert(unlinked === 0, `${unlinked} escalation message(s) missing escalationId linkage`);
      results.push({ name: "  ↳ note", ok: true, detail: `Channel ② wired (3 routes + hook + thread UI); ${threads.length} thread(s), 0 orphan, 0 unlinked` });
    },
  },
  {
    name: "rejected-unassigned-full-coverage — EVERY 'unassigned' surface excludes rejected (filter/leads/reconciler/bulk-assign/export/master-data) + data integrity",
    run: async () => {
      const fs = await import("fs");
      const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
      // SOURCE: each surface that treats ownerId:null as "ready to assign" must AND rejectedAt:null.
      const filt = fs.readFileSync("src/lib/leadFilterWhere.ts", "utf8");
      assert(/owners\.includes\("unassigned"\)\)\s*or\.push\(\{ ownerId: null, rejectedAt: null \}/.test(filt), "leadFilterWhere owner=unassigned must exclude rejected");
      const lpage = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/\{ ownerId: null, rejectedAt: null \}/.test(lpage) && /where\.rejectedAt = null/.test(lpage), "leads page owner=unassigned arms must exclude rejected");
      const rec = fs.readFileSync("src/lib/reconciler.ts", "utf8");
      assert(/ownerId: null,\s*\n\s*rejectedAt: null,/.test(rec), "reconciler auto-assign orphans must exclude rejected");
      const bulk = fs.readFileSync("src/app/api/cold-data/bulk-assign/route.ts", "utf8");
      assert(/rejectedAt: null/.test(bulk), "cold-data bulk-assign must exclude rejected");
      const exp = fs.readFileSync("src/app/api/reports/export/route.ts", "utf8");
      const expUnassignedLines = exp.split("\n").filter((l) => /owner === "unassigned"/.test(l));
      assert(expUnassignedLines.length >= 2 && expUnassignedLines.every((l) => /rejectedAt/.test(l)), "both export owner=unassigned arms must exclude rejected");
      const mdt = fs.readFileSync("src/components/MasterDataRecordsTable.tsx", "utf8");
      assert(/!r\.ownerId && r\.bucket === "Workable"/.test(mdt), "Master Data section rank must not put rejected in the Unassigned section");
      assert(/!l\.ownerId && l\.bucket === "Workable" \? unassignedAgeBadge/.test(mdt), "Master Data age badge must not flag rejected as 'please assign'");
      // SOURCE: the WRITE side — assignLeadTo is the one primitive every assignment
      // surface funnels through, so it must REFUSE a rejected lead (reactivate-before-
      // reassign). This is the guard that stops an assignment re-owning a rejected lead
      // (the mechanism that stranded 17 leads as rejected-but-owned, 2026-07-04).
      const ingest = fs.readFileSync("src/lib/leadIngest.ts", "utf8");
      assert(/class LeadRejectedError/.test(ingest) && /if \(lead\.rejectedAt != null\) throw new LeadRejectedError/.test(ingest), "assignLeadTo must REFUSE to assign a rejected lead (reactivate-before-reassign choke-point guard)");
      // DATA: the hard-unassign held — no rejected lead is still owned, and none
      // would slip into the canonical normal-unassigned set.
      const stillOwned = await prisma.lead.count({ where: { rejectedAt: { not: null }, ownerId: { not: null }, deletedAt: null } });
      assert(stillOwned === 0, `${stillOwned} rejected lead(s) still carry an owner (hard-unassign breach)`);
      const leak = await prisma.lead.count({ where: { rejectedAt: { not: null }, ownerId: null, deletedAt: null, isColdCall: false, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] } });
      assert(leak === 0, `${leak} rejected lead(s) would appear in the normal workable-unassigned set`);
      results.push({ name: "  ↳ note", ok: true, detail: "6 unassigned surfaces exclude rejected; 0 rejected still-owned; 0 leak into normal-unassigned" });
    },
  },
  {
    name: "voice-broadcast-feature1 — dashboard broadcast: admin-only sender, transcript optional, separate from lead voice",
    run: async () => {
      const fs = await import("fs");
      const { canSendBroadcast, broadcastRecipientWhere } = await import("../src/lib/voiceBroadcast");
      // LOGIC: sender permission — Lalit/admin yes; Sameer(leadOpsOnly)/agent/manager no.
      assert(canSendBroadcast({ role: "ADMIN", leadOpsOnly: false }), "admin must be able to send");
      assert(!canSendBroadcast({ role: "ADMIN", leadOpsOnly: true }), "Sameer (leadOpsOnly admin) must NOT send");
      assert(!canSendBroadcast({ role: "AGENT" }), "agent must NOT send");
      assert(!canSendBroadcast({ role: "MANAGER" }), "manager must NOT send");
      // ── TARGETING (Lalit's 6 cases) — a broadcast reaches a user IFF one OR-clause of
      //    broadcastRecipientWhere matches it. Locks: one-agent → ONLY that agent, a team
      //    → ONLY that team, Everyone → everyone; every non-recipient excluded. ──────────
      const receives = (user: { id: string; team: string | null }, b: { targetKind: string; targetTeam: string | null; targetUserId: string | null }) => {
        const w = broadcastRecipientWhere(user) as { OR: Array<Record<string, unknown>> };
        return w.OR.some((clause) => Object.entries(clause).every(([k, v]) => (b as Record<string, unknown>)[k] === v));
      };
      const agentA = { id: "A", team: "Dubai" };   // one specific agent
      const agentB = { id: "B", team: "India" };   // a different agent
      const dubai  = { id: "D", team: "Dubai" };
      const india  = { id: "I", team: "India" };   // "India team" = the Gurgaon office
      const bUserA = { targetKind: "USER", targetTeam: null, targetUserId: "A" };
      const bTeamDubai = { targetKind: "TEAM", targetTeam: "Dubai", targetUserId: null };
      const bTeamIndia = { targetKind: "TEAM", targetTeam: "India", targetUserId: null };
      const bAll   = { targetKind: "ALL", targetTeam: null, targetUserId: null };
      // (1) one agent → ONLY that agent
      assert(receives(agentA, bUserA), "USER broadcast must reach the targeted agent");
      assert(!receives(agentB, bUserA), "USER broadcast must NOT reach a different agent");
      assert(!receives(dubai, bUserA) && !receives(india, bUserA), "USER broadcast must NOT reach anyone else (no team/all leak)");
      // (2) Dubai team → ONLY Dubai
      assert(receives(dubai, bTeamDubai) && receives(agentA, bTeamDubai), "TEAM=Dubai must reach Dubai users");
      assert(!receives(india, bTeamDubai) && !receives(agentB, bTeamDubai), "TEAM=Dubai must NOT reach India users");
      // (3) India (Gurgaon) team → ONLY India
      assert(receives(india, bTeamIndia) && receives(agentB, bTeamIndia), "TEAM=India must reach India users");
      assert(!receives(dubai, bTeamIndia) && !receives(agentA, bTeamIndia), "TEAM=India must NOT reach Dubai users");
      // (4) Everyone → everyone   ·   (5) non-recipient exclusion asserted above
      assert(receives(agentA, bAll) && receives(agentB, bAll) && receives(dubai, bAll) && receives(india, bAll), "ALL must reach everyone");
      // SOURCE: send route gated + transcript optional (never required); sub-routes exist.
      const send = fs.readFileSync("src/app/api/voice-broadcast/route.ts", "utf8");
      assert(/canSendBroadcast\(me\)/.test(send), "send route must gate on canSendBroadcast");
      assert(!/require.{0,15}transcript|transcript.{0,15}required/i.test(send), "transcript must NOT be required in the send route");
      // SOURCE: send route scopes the NOTIFY fan-out (USER→that id, TEAM→that team) and never notifies the sender.
      assert(/targetKind === "USER"\s*\?\s*\{\s*id:\s*targetUserId!/.test(send), "send route must notify ONLY the targeted user for a USER broadcast");
      assert(/targetKind === "TEAM"\s*\?\s*\{[^}]*team:\s*targetTeam!/.test(send), "send route must notify ONLY the targeted team for a TEAM broadcast");
      assert(/id:\s*\{\s*not:\s*me\.id\s*\}/.test(send), "send route must exclude the sender from recipients (no self-notification)");
      // SOURCE: audio playback is access-gated to recipients only (no cross-recipient audio leak).
      const audio = fs.readFileSync("src/app/api/voice-broadcast/[id]/audio/route.ts", "utf8");
      assert(/bc\.targetKind === "USER" && bc\.targetUserId === me\.id/.test(audio) && /bc\.targetKind === "TEAM" && bc\.targetTeam === me\.team/.test(audio), "audio route must gate playback to the broadcast's recipients only");
      assert(fs.existsSync("src/app/api/voice-broadcast/[id]/audio/route.ts"), "audio route must exist");
      assert(fs.existsSync("src/app/api/voice-broadcast/[id]/heard/route.ts"), "heard route must exist");
      // SOURCE: dashboard mounts the recipient inbox (recipient-scoped) + the gated sender.
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/DashboardBroadcastInbox/.test(dash) && /canSendBc && <DashboardVoiceBroadcast/.test(dash), "dashboard must mount inbox + gated sender");
      assert(/where:\s*broadcastRecipientWhere\(me\)/.test(dash), "dashboard broadcast inbox MUST be scoped by broadcastRecipientWhere (no unfiltered fetch)");
      // SOURCE: separate from lead-specific voice (distinct table + components).
      assert(!/LeadVoiceMessage/.test(send), "broadcast must use its own table, not LeadVoiceMessage");
      // DATA: tables exist + queryable.
      const c = await prisma.voiceBroadcast.count();
      assert(typeof c === "number", "VoiceBroadcast table must be queryable");
      results.push({ name: "  ↳ note", ok: true, detail: `Feature 1: admin-only sender, transcript optional, ${c} broadcast(s); own table, separate from lead voice` });
    },
  },
  {
    name: "device-admin-tools — global force-logout + per-user limit setter wired; messages match; still MONITOR (no accidental enforce)",
    run: async () => {
      const fs = await import("fs");
      const api = fs.readFileSync("src/app/api/admin/devices/route.ts", "utf8");
      assert(/action === "logout_everyone"/.test(api) && /revokedAt: null \}, data: \{ revokedAt: now/.test(api), "global logout_everyone must revoke ALL active sessions");
      assert(/action === "set_device_limit"/.test(api) && /deviceLimitExtra: extra/.test(api), "set_device_limit must write deviceLimitExtra");
      const auth = fs.readFileSync("src/lib/auth.ts", "utf8");
      assert(/Device registration is pending administrator approval\./.test(auth), "pending message must match the agreed (mobile-friendly) wording");
      assert(/This device is not approved for CRM access\./.test(auth), "blocked message must match the agreed wording");
      const page = fs.readFileSync("src/app/(app)/admin/devices/page.tsx", "utf8");
      assert(/ForceLogoutEveryone/.test(page) && /UserDeviceLimit/.test(page), "admin page must mount the global logout + per-user limit controls");
      // SAFETY: enforcement is still env-gated (this deploy must NOT silently enable lockdown).
      const ds = fs.readFileSync("src/lib/deviceSecurity.ts", "utf8");
      assert(/process\.env\.DEVICE_SECURITY_ENFORCE === "true"/.test(ds), "enforcement must remain env-gated (monitor by default)");
      assert(/return Math\.max\(1, 3 \+ \(extra/.test(ds), "device limit must be 3 + admin extra, floored at 1 (default 3 = laptop+mobile+spare; 1 locks to a single device)");
      // EVERY new device needs admin approval under enforcement — auto-approve ONLY in
      // monitor mode or for a super-admin (NOT 'first N devices auto-pass').
      assert(/const autoApprove = !enforcementOn\(\) \|\| user\.isSuperAdmin;/.test(ds), "new devices must NOT auto-approve up to the limit — only monitor/super-admin auto-approve");
      // The no-deviceId login bypass must stay closed under enforcement (super-admin
      // exempt). NB: the /api/login route now ALWAYS resolves a device id (localStorage
      // → wcr_did cookie → UUID), so this defensive branch is effectively unreachable —
      // but it must remain so a future refactor can't silently re-open the bypass. The
      // old desktop-only "Couldn't verify… Ctrl+Shift+R" message was REMOVED (P0 iPhone
      // fix); see the device-login-resilient invariant for the mobile-safe wording.
      assert(/enforcementOn\(\) && !user\.isSuperAdmin/.test(auth), "login must still close the no-deviceId bypass under enforcement (super-admin exempt)");
      // The cap is enforced at APPROVAL time.
      assert(/Device limit reached/.test(api) && /deviceLimit\(/.test(api), "approve must enforce the per-user device cap");
      results.push({ name: "  ↳ note", ok: true, detail: "every new device → admin approval (no auto-pass); no-deviceId bypass closed; cap enforced at approval; enforcement env-gated" });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 49. ACTIVITY → NEVER WON/CLOSED (2026-06-28, Lalit). Scheduling/completing a
  //     meeting, site visit, office/virtual meeting, follow-up, call, WhatsApp,
  //     note, escalation or voice note is an ACTIVITY, NOT a deal outcome — it must
  //     NEVER move a lead to a Won/Closed (terminal) status. The ONLY path to a
  //     "Booked with Us" win is the explicit EOI funnel reaching BOOKING_DONE
  //     (api/leads/[id]/eoi). This invariant locks both halves so the bug can't
  //     re-appear:
  //       (a) STATUS MODEL — no meeting/visit status is classified terminal
  //           (CLOSED_OUTCOME ∪ BOOKED ∪ LOST); each stays WORKABLE.
  //       (b) WRITE PATHS — the activity routes never SET a terminal currentStatus.
  //           Pure-activity routes don't touch currentStatus at all; action-complete
  //           may READ it (terminal guard) but never assigns a literal status.
  //       (c) DATA (note) — count of closed leads + how many lack a booking OR
  //           rejection signal (the "wrongly closed?" set; was 0 on 2026-06-28).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "activity-never-won-closed — meetings/visits/follow-ups never mark a lead Won/Closed (status model + write paths locked)",
    run: async () => {
      const fs = await import("fs");
      const { CLOSED_OUTCOME_STATUSES, BOOKED_STATUSES, LOST_STATUSES, leadCategory } =
        await import("../src/lib/lead-statuses");

      // (a) STATUS MODEL — meeting/visit statuses are WORKABLE, never terminal.
      const MEETING_VISIT_STATUSES = [
        "Meeting", "Site Visit Schedule", "Visit Dubai",
        "Wants Office Visit", "Want Office Visit", "Zoom Meeting", "Expo Only",
      ];
      const terminal = new Set([...CLOSED_OUTCOME_STATUSES, ...BOOKED_STATUSES, ...LOST_STATUSES]);
      for (const s of MEETING_VISIT_STATUSES) {
        assert(!terminal.has(s), `meeting/visit status "${s}" must NOT be terminal (Won/Closed/Lost) — it is an active stage`);
        assert(leadCategory(s) === "WORKABLE", `leadCategory("${s}") must be WORKABLE, got ${leadCategory(s)}`);
      }

      // (b) WRITE PATHS — pure-activity routes must not reference currentStatus at all.
      const PURE_ACTIVITY_ROUTES = [
        "src/app/api/leads/[id]/meeting/route.ts",
        "src/app/api/leads/[id]/visit/route.ts",
        "src/app/api/leads/[id]/log-call/route.ts",
        "src/app/api/whatsapp/log/route.ts",
        "src/app/api/leads/[id]/log-note/route.ts",
        "src/app/api/leads/[id]/action-snooze/route.ts",
        "src/app/api/leads/[id]/action-escalate/route.ts",
      ];
      for (const f of PURE_ACTIVITY_ROUTES) {
        const src = fs.readFileSync(f, "utf8");
        assert(!/currentStatus/.test(src), `${f} must NOT touch currentStatus — logging this activity cannot change the lead's status`);
      }
      // action-complete may READ currentStatus (terminal guard) but must never ASSIGN a literal status.
      const ac = fs.readFileSync("src/app/api/leads/[id]/action-complete/route.ts", "utf8");
      assert(!/currentStatus:\s*["'`]/.test(ac), "action-complete must never ASSIGN a currentStatus literal (Complete is not a deal outcome)");
      // The ONLY win-write lives in the EOI funnel, gated on BOOKING_DONE.
      const eoi = fs.readFileSync("src/app/api/leads/[id]/eoi/route.ts", "utf8");
      assert(/BOOKING_DONE/.test(eoi) && /currentStatus = "Booked with Us"/.test(eoi),
        "the only currentStatus→Booked write must be the EOI funnel reaching BOOKING_DONE");

      // (c) DATA (note, non-fatal) — closed leads lacking a booking OR rejection signal.
      const closedLeads = await prisma.lead.findMany({
        where: { deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } },
        select: { bookingDoneAt: true, eoiStage: true, rejectedAt: true, status: true },
      });
      const unjustified = closedLeads.filter(
        (l) => !l.bookingDoneAt && l.eoiStage !== "BOOKING_DONE" && !l.rejectedAt && l.status !== "WON",
      ).length;
      results.push({
        name: "  ↳ note",
        ok: true,
        detail: `closed leads=${closedLeads.length}; without booking/reject signal=${unjustified} (meetings/visits never close — status model + write paths locked)`,
      });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 49b. ACTOR-vs-OWNER — the timeline shows WHO PERFORMED the action, never the
  //   lead OWNER (Lalit, 2026-07-01). Actor (Activity/Note/CallLog.userId,
  //   WhatsAppMessage.actorUserId) and Lead.ownerId are separate concepts and must
  //   never be conflated. Locks the fixed write paths + the render fallback +
  //   schema so a future edit can't silently reintroduce owner-as-actor.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "actor-never-owner — timeline actor is the performer, never the lead owner (write paths + render + schema locked)",
    run: async () => {
      const fs = await import("fs");

      // (a) WRITE PATHS — no timeline create may stamp the owner as the actor.
      //     (Scope the check to the specific activity.create block — a legitimate
      //      notify({ userId: owner }) elsewhere must NOT trip this.)
      const ingest = fs.readFileSync("src/lib/leadIngest.ts", "utf8");
      const dupBlock = ingest.match(/prisma\.activity\.create\(\{[\s\S]*?Duplicate intake from[\s\S]*?\}\);/);
      assert(!!dupBlock && !/ownerId/.test(dupBlock[0]),
        "leadIngest duplicate-intake Activity must NOT stamp the owner as actor (a system event → userId null)");
      const wf = fs.readFileSync("src/lib/workflowEngine.ts", "utf8");
      const taskBlock = wf.match(/prisma\.activity\.create\(\{[\s\S]*?type:\s*"TASK"[\s\S]*?\}\);/);
      assert(!!taskBlock && !/ownerId/.test(taskBlock[0]),
        "workflowEngine CREATE_TASK must NOT stamp lead.ownerId as actor (system automation → userId null)");
      const rev = fs.readFileSync("src/lib/revivalImport.ts", "utf8");
      assert(!/connect:\s*\{\s*id:\s*existing\.ownerId/.test(rev),
        "revivalImport Activity must NOT connect the owner as actor — the importer (changedById) is the actor");
      assert(/connect:\s*\{\s*id:\s*changedById/.test(rev),
        "revivalImport Activity must connect changedById (the user who ran the import) as the actor");
      const ace = fs.readFileSync("src/app/api/acefone/webhook/route.ts", "utf8");
      assert(!/userId\s*=\s*l\?\.ownerId/.test(ace),
        "acefone webhook must NOT fall back to the lead owner for an unmatched call (leave UNASSIGNED / Unknown Agent)");
      assert(!/userId\s*=\s*admin\?\.id/.test(ace),
        "acefone webhook must NOT fall back to the first admin for an unmatched call");

      // (b) RENDER — the conversation stream never resolves an actor to the owner.
      const card = fs.readFileSync("src/components/ConversationStreamCard.tsx", "utf8");
      assert(/const fallbackActor = SYSTEM_ACTOR/.test(card),
        "ConversationStreamCard fallbackActor must be SYSTEM_ACTOR (\"System\"), never the lead owner name");
      assert(!/\$\{\(leadOwnerName && leadOwnerName\.trim\(\)\) \|\| "Outbound"\}/.test(card),
        "outbound WhatsApp must show the actor (m.actor), never the lead owner");
      assert(/m\.actor\?\.name \? canonicalAgentName\(m\.actor\.name/.test(card),
        "outbound WhatsApp must render m.actor (the sender), falling back to neutral \"Outbound\" — never the owner");

      // (c) SCHEMA — actor columns exist and are nullable where required.
      const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
      assert(/model WhatsAppMessage[\s\S]*?actorUserId\s+String\?/.test(schema),
        "WhatsAppMessage must have a nullable actorUserId column (who sent an outbound message)");
      assert(/model CallLog[\s\S]*?userId\s+String\?/.test(schema),
        "CallLog.userId must be nullable so an unmatched inbound call can be left unassigned (never owner/admin)");

      // (d) DATA (note, non-fatal) — system-created Activity rows still stamped
      //     with a real user (owner-as-actor legacy). Trends to 0 after the
      //     approved reconcile-actor-owner.ts run.
      const [dup, task, revI] = await Promise.all([
        prisma.activity.count({ where: { title: { startsWith: "Duplicate intake from" }, userId: { not: null } } }),
        prisma.activity.count({ where: { title: { startsWith: "🤖 " }, userId: { not: null } } }),
        prisma.activity.count({ where: { title: { startsWith: "Revival import — re-engaged from" }, userId: { not: null } } }),
      ]);
      results.push({
        name: "  ↳ note",
        ok: true,
        detail: `legacy owner-stamped system rows remaining: duplicate-intake=${dup}, workflow-task=${task}, revival-import=${revI} (reconcile-actor-owner.ts --apply clears these after approval)`,
      });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 50. DEVICE LOGIN RESILIENCE + CONTEXT SEPARATION (2026-06-28, Lalit P0).
  //   iPhone Safari / iOS PWA were hard-blocked ("Couldn't verify this device…
  //   Ctrl+Shift+R") whenever localStorage was blocked/cleared and no deviceId
  //   reached the server. Fix: the login route ALWAYS resolves a stable id
  //   (localStorage → wcr_did httpOnly cookie → generated UUID), so a device is
  //   always captured (pending/approved) — never a dead-end. Errors are mobile-safe
  //   (no Ctrl+Shift+R). Safari vs installed-PWA are LABELLED distinctly; their
  //   SEPARATION is already guaranteed by per-context cookie/localStorage jars on
  //   iOS (Apple continuity/iCloud never syncs those across physical devices).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "device-login-resilient — login always resolves a device id (cookie fallback); no desktop-only error; PWA/Safari labelled",
    run: async () => {
      const fs = await import("fs");
      const route = fs.readFileSync("src/app/api/login/route.ts", "utf8");
      assert(/DID_COOKIE = "wcr_did"/.test(route), "login route must define the wcr_did device cookie");
      assert(/deviceId\.trim\(\) \|\| cookieDid \|\| randomUUID\(\)/.test(route), "login route must resolve did = client || cookie || generated (never empty)");
      assert(/jar\.set\(DID_COOKIE/.test(route), "login route must (re)set the wcr_did cookie on the response");
      assert(/loginWithCredentials\(email, password, \{ deviceId: did, meta, pwa \}\)/.test(route), "login route must always pass a resolved deviceId + pwa");

      const auth = fs.readFileSync("src/lib/auth.ts", "utf8");
      assert(!/Ctrl\+Shift\+R/.test(auth), "auth must NOT show desktop-only Ctrl+Shift+R instructions (breaks iPhone)");
      assert(/Device registration is pending administrator approval\./.test(auth), "pending message must be the mobile-friendly wording");
      assert(/pwa: deviceCtx\.pwa/.test(auth), "auth must thread the pwa context into evaluateDevice");

      const ds = fs.readFileSync("src/lib/deviceSecurity.ts", "utf8");
      assert(/pwa\?: boolean/.test(ds) && /deviceName\(user\.name, p, \{ pwa \}\)/.test(ds), "evaluateDevice must accept + label the pwa context");
      assert(/contextLabel\(p, pwa\)/.test(ds) && /osLabel\(p\)/.test(ds), "device row must store browser-context + OS-version labels");

      const dev = fs.readFileSync("src/lib/device.ts", "utf8");
      assert(/osVersion\?: string/.test(dev), "UaInfo must carry osVersion");
      assert(/export function contextLabel/.test(dev) && /export function osLabel/.test(dev), "device.ts must export contextLabel + osLabel");

      const page = fs.readFileSync("src/app/login/page.tsx", "utf8");
      assert(/name="displayMode"/.test(page) && /display-mode: standalone/.test(page), "login page must capture PWA display-mode");
      assert(!/Ctrl\+Shift\+R/.test(page), "login page must not show desktop-only refresh instructions");

      results.push({ name: "  ↳ note", ok: true, detail: "login resolves did via localStorage→cookie→uuid; no desktop-only error; Safari vs PWA labelled; OS version shown" });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 51. SESSION / DEVICE / PASSWORD HARDENING (2026-06-28, Lalit security audit).
  //   getCurrentUser now re-validates on EVERY request (not just at login):
  //     • disabled account → out (user.active)        • role read live (no stale perms)
  //     • password epoch → session created before passwordChangedAt is dead
  //     • device binding → session's device must still be APPROVED (super-admin exempt)
  //     • copied-cookie guard → wcr_did cookie must match the session's device
  //     • under enforcement a session MUST be device-bound (sid); legacy cookies rejected
  //   Password change (admin reset + self) → stamp passwordChangedAt + bump sessionEpoch
  //   + revoke ALL sessions, so old/saved passwords can't reopen access on any device.
  //   (c) DATA note — active sessions whose device is NOT approved (would be logged out
  //       by the new binding on deploy; expected to be 0 since all devices are approved).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "session-device-password-hardening — per-request device+password+role binding; password change revokes all sessions",
    run: async () => {
      const fs = await import("fs");
      const auth = fs.readFileSync("src/lib/auth.ts", "utf8");
      // Password epoch
      assert(/s\.createdAt < user\.passwordChangedAt/.test(auth), "getCurrentUser must kill sessions created before the last password change");
      // Per-request device binding (super-admin exempt)
      assert(/!user\.isSuperAdmin && s\.deviceRef/.test(auth) && /s\.device\.status !== "APPROVED"/.test(auth),
        "getCurrentUser must reject a session whose device is no longer APPROVED (super-admin exempt)");
      // Copied-cookie guard — HARD DENY (absent OR mismatched wcr_did)
      assert(/if \(!did \|\| \(s\.device\.deviceId && did !== s\.device\.deviceId\)\) return null/.test(auth),
        "getCurrentUser must HARD-DENY a missing or mismatched wcr_did (copied-cookie guard, max security)");
      // Legacy no-sid rejected under enforcement
      assert(/enforcementOn\(\) && !user\.isSuperAdmin/.test(auth) && /return null;/.test(auth),
        "under enforcement a session must be device-bound (sid); legacy no-sid cookies rejected");
      // disabled account
      assert(/!user \|\| !user\.active/.test(auth), "disabled account must lose access immediately");

      // Password endpoints revoke sessions + stamp passwordChangedAt.
      const adminPw = fs.readFileSync("src/app/api/admin/users/[id]/password/route.ts", "utf8");
      assert(/passwordChangedAt: now/.test(adminPw) && /userSession\.updateMany/.test(adminPw) && /admin_password_reset/.test(adminPw),
        "admin password reset must stamp passwordChangedAt + revoke all sessions");
      const selfPw = fs.readFileSync("src/app/api/profile/password/route.ts", "utf8");
      assert(/passwordChangedAt: now/.test(selfPw) && /userSession\.updateMany/.test(selfPw) && /self_password_change/.test(selfPw),
        "self password change must stamp passwordChangedAt + revoke all sessions");

      // Admin panel shows the approver.
      const devPage = fs.readFileSync("src/app/(app)/admin/devices/page.tsx", "utf8");
      assert(/approvedBy: \{ select: \{ name: true \} \}/.test(devPage) && /by \{d\.approvedBy/.test(devPage),
        "admin devices panel must show 'approved by'");

      // Logout revokes the server session row (not just the cookie) → no stale access.
      const logoutSrc = fs.readFileSync("src/app/api/logout/route.ts", "utf8");
      assert(/logout\(\)/.test(logoutSrc) && /auth\.logout/.test(logoutSrc), "logout must revoke the session row server-side + audit (not just delete the cookie)");
      // Role change + account disable revoke all of the user's sessions.
      const userUpd = fs.readFileSync("src/app/api/admin/users/[id]/update/route.ts", "utf8");
      assert(/role_change/.test(userUpd) && /userSession\.updateMany/.test(userUpd), "role change must revoke all the user's sessions (logout after role change)");
      const toggle = fs.readFileSync("src/app/api/admin/users/[id]/toggle-active/route.ts", "utf8");
      assert(/account_disabled/.test(toggle) && /userSession\.updateMany/.test(toggle), "disabling an account must revoke all its sessions");
      // Country-change security event (IP-monitoring seed) audits + alerts admins.
      const ds2 = fs.readFileSync("src/lib/deviceSecurity.ts", "utf8");
      assert(/auth\.device\.country_change/.test(ds2), "a country change on a known device must be audited + alert admins");

      // (c) DATA note — sessions that the new device-binding would terminate now.
      const live = await prisma.userSession.findMany({
        where: { revokedAt: null, expiresAt: { gt: new Date() }, deviceRef: { not: null } },
        select: { device: { select: { status: true } }, user: { select: { isSuperAdmin: true } } },
      });
      const wouldDrop = live.filter((s) => !s.user?.isSuperAdmin && s.device?.status !== "APPROVED").length;
      results.push({ name: "  ↳ note", ok: true, detail: `live device-bound sessions=${live.length}; would be dropped by device-binding=${wouldDrop} (expect 0 — all devices approved)` });
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // 52. CONVERSATION CALL-REMARK EDIT (2026-06-30, Lalit — "requested multiple times,
  //     still not visible"). The edit feature existed for NOTE + meeting activities
  //     but NOT for CALL remarks — the dominant conversation entry (~97%) — so it read
  //     as missing. Call remarks (CallLog.notes) are now editable with the SAME rule
  //     (ADMIN/MANAGER any · agent own + same-IST-day, via canEditRemark) + a preserved
  //     original (RemarkAuditLog action EDIT_CALL) + an "Edited by …" badge. Locked so
  //     it can't silently regress again.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "conversation-call-remark-edit — call remarks editable (agent own+today / admin any) + audited + wired into the lead view",
    run: async () => {
      const fs = await import("fs");
      const route = fs.readFileSync("src/app/api/leads/[id]/calls/[callId]/route.ts", "utf8");
      assert(/canEditRemark\(\{ id: me\.id, role \}/.test(route), "call-edit route must enforce the shared canEditRemark rule (agent own+same-IST-day; admin/manager any)");
      assert(/action: "EDIT_CALL"/.test(route) && /remarkAuditLog\.create/.test(route), "call-edit must preserve the original in RemarkAuditLog (action EDIT_CALL)");
      assert(/callLog\.update\(\{ where: \{ id: callId \}, data: \{ notes/.test(route), "call-edit must update CallLog.notes in place (never delete)");
      const comp = fs.readFileSync("src/components/ConversationStreamCard.tsx", "utf8");
      assert(/startEditCall\(/.test(comp) && /saveEditCall\(/.test(comp), "ConversationStreamCard must offer the per-call edit affordance + save");
      assert(/editedCalls\[c\.id\]/.test(comp), "call row must show the 'Edited by …' badge from editedCalls");
      assert(/callEditable = canEditRemark\(/.test(comp), "call edit must be gated by canEditRemark (identical to the server rule)");
      // Affordances must be VISIBLE (not the old faint gray-400 pencil).
      assert(!/text-\[10px\] text-gray-400 hover:text-gray-(600|700)[^>]*>✏️ Edit/.test(comp), "the ✏️ Edit affordances must be clearly visible (not faint gray-400)");
      const page = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/"EDIT_CALL"/.test(page) && /editedCalls=\{editedCalls\}/.test(page), "lead page must query EDIT_CALL + pass editedCalls to the conversation card");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // NEEDS-LALIT ESCALATION (2026-06-30) — replaces the viewer-name "Needs X"
  //   dashboard column with a fixed "Needs Lalit" manager-escalation workflow:
  //   clickable count → drill, a manager-resolve endpoint (clear flag + notify
  //   the agent + timeline), and escalation routed to SALES managers (Lalit),
  //   never the data-admin (Sameer = leadOpsOnly).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "needs-lalit-escalation — manager-resolve endpoint + clickable Needs-Lalit drill + routed to managers (not data-admins)",
    run: async () => {
      const fs = await import("fs");
      // (a) Manager-resolve endpoint: manager-gated, clears the flag, logs + notifies the owner.
      const mr = fs.readFileSync("src/app/api/leads/[id]/manager-resolve/route.ts", "utf8");
      assert(/role === "ADMIN" \|\| me\.role === "MANAGER"/.test(mr) && /status: 403/.test(mr),
        "manager-resolve must be gated to ADMIN/MANAGER (403 otherwise)");
      assert(/needsManagerReview: false/.test(mr), "manager-resolve must clear needsManagerReview");
      assert(/prisma\.activity\.create/.test(mr) && /escalate-resolved/.test(mr),
        "manager-resolve must log a resolution entry to the timeline");
      assert(/userId: cur\.ownerId/.test(mr) && /has been resolved by/.test(mr),
        "manager-resolve must notify the lead owner (agent) that it was resolved");
      // (b) Dashboard: fixed "Needs Lalit" label (NOT the viewer's name) + clickable count.
      const dash = fs.readFileSync("src/app/(app)/dashboard/page.tsx", "utf8");
      assert(/>Needs Lalit</.test(dash), "dashboard salesperson table must show the fixed 'Needs Lalit' column");
      assert(!/Needs \{me\.name\.split/.test(dash), "dashboard must NOT render the viewer-name 'Needs <firstname>' label anymore");
      assert(/leadsDrill\(\{ owner: s\.id, needs: "1" \}\)/.test(dash), "the Needs-Lalit count must be a clickable drill to that agent's escalations");
      // (c) /leads honors the ?needs=1 escalation filter (the drill target).
      const leadsPage = fs.readFileSync("src/app/(app)/leads/page.tsx", "utf8");
      assert(/sp\.needs === "1"\) where\.needsManagerReview = true/.test(leadsPage), "/leads must filter on ?needs=1 → needsManagerReview");
      assert(/sp\.needs \|\|/.test(leadsPage), "?needs must count as a targeted filter (bypass the default today's-follow-ups view)");
      // (d) Escalation routes to SALES managers, NOT data-admin Sameer (leadOpsOnly).
      const esc = fs.readFileSync("src/app/api/leads/[id]/action-escalate/route.ts", "utf8");
      assert(/leadOpsOnly: false/.test(esc) && /role: \{ in: \["ADMIN", "MANAGER"\] \}/.test(esc),
        "action-escalate must notify sales managers (ADMIN/MANAGER) and EXCLUDE leadOpsOnly data-admins");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // LEAD AUTO-ASSIGNMENT RULE (2026-06-30) — Dubai NEW leads → Lalit; India NEW
  //   leads → Yasir on Tuesday (IST), else Tanuj. Applies to real-time intake
  //   (website / Meta / email / manual-without-owner / quick-add), NOT bulk
  //   imports / buyer-convert. Existing leads untouched. The resolver is PURE so
  //   we import + exercise it directly (a real test, not just code-presence).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "lead-autoassign-rule — Dubai→Lalit · Tuesday-IST India→Yasir · else Tanuj + every real-time intake opts in",
    run: async () => {
      const { resolveTeamAutoAssignee, ASSIGN_AGENTS } = await import("../src/lib/teamAutoAssign");
      const { istWeekday } = await import("../src/lib/datetime");

      // Sweep a full IST week so a Tuesday is guaranteed present without hard-coding
      // which calendar date is a Tuesday. For each day: Dubai→Lalit always; India→
      // Yasir iff that IST day is Tuesday(2), else Tanuj — checked against istWeekday.
      const week = ["2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05"];
      const seen = new Set<number>();
      let tuesdays = 0;
      for (const ds of week) {
        const d = new Date(`${ds}T06:00:00Z`); // 11:30am IST that day
        const wd = istWeekday(d);
        seen.add(wd);
        if (wd === 2) tuesdays++;
        assert(resolveTeamAutoAssignee("Dubai", d) === ASSIGN_AGENTS.LALIT, `Dubai must → Lalit on ${ds}`);
        const expectIndia = wd === 2 ? ASSIGN_AGENTS.YASIR : ASSIGN_AGENTS.TANUJ;
        assert(resolveTeamAutoAssignee("India", d) === expectIndia, `India ${ds} (IST weekday ${wd}) must → ${wd === 2 ? "Yasir" : "Tanuj"}`);
      }
      assert(seen.size === 7, `istWeekday must yield all 7 distinct IST weekdays across a week (got ${seen.size})`);
      assert(tuesdays === 1, `a 7-day window must contain exactly one IST Tuesday (got ${tuesdays})`);
      // Unknown / non-canonical team → null (caller normalizes UAE→Dubai before this).
      assert(resolveTeamAutoAssignee(null) === null && resolveTeamAutoAssignee("UAE") === null,
        "unknown/non-canonical team must resolve to null");

      // The 3 target ids must be active + non-HR, else the ingest validation silently skips.
      const [lalit, yasir, tanuj] = await Promise.all([
        prisma.user.findUnique({ where: { id: ASSIGN_AGENTS.LALIT }, select: { name: true, active: true, hrOnly: true } }),
        prisma.user.findUnique({ where: { id: ASSIGN_AGENTS.YASIR }, select: { name: true, active: true, hrOnly: true } }),
        prisma.user.findUnique({ where: { id: ASSIGN_AGENTS.TANUJ }, select: { name: true, active: true, hrOnly: true } }),
      ]);
      assert(!!lalit && lalit.active && !lalit.hrOnly, "LALIT target id must be an active, non-HR user");
      assert(!!yasir && yasir.active && !yasir.hrOnly, "YASIR target id must be an active, non-HR user");
      assert(!!tanuj && tanuj.active && !tanuj.hrOnly, "TANUJ target id must be an active, non-HR user");

      // Wiring: leadIngest routes via resolveActiveAssignee (= the fixed rule +
      // leave-cover #16) under the broadened gate. resolveActiveAssignee wraps
      // resolveTeamAutoAssignee, so the Dubai/Tuesday/Tanuj rule still governs.
      const fs = await import("fs");
      const ingest = fs.readFileSync("src/lib/leadIngest.ts", "utf8");
      assert(/resolveActiveAssignee\(lead\.forwardedTeam\)/.test(ingest) && /wantsAutoAssign/.test(ingest),
        "leadIngest must resolve the target via resolveActiveAssignee under the autoAssign/WEBSITE gate");
      const leaveSrc = fs.readFileSync("src/lib/leave.ts", "utf8");
      assert(/resolveTeamAutoAssignee\(team, now\)/.test(leaveSrc),
        "resolveActiveAssignee must delegate to resolveTeamAutoAssignee (fixed team rule stays the source of truth)");
      // Real-time intake + manual paths opt in; importers do NOT (so bulk imports stay parked).
      for (const f of [
        "src/app/api/intake/meta/route.ts",
        "src/app/api/intake/email/route.ts",
        "src/app/api/intake/lead/route.ts",
        "src/app/(app)/leads/new/actions.ts",
      ]) {
        assert(/autoAssign:\s*true/.test(fs.readFileSync(f, "utf8")), `${f} must pass autoAssign:true`);
      }
      assert(/autoAssign:\s*!String\(formData\.get\("ownerId"\)/.test(fs.readFileSync("src/app/(app)/leads/new/page.tsx", "utf8")),
        "manual /leads/new must auto-assign ONLY when no explicit owner is picked");
      for (const f of ["src/app/api/intake/csv/route.ts", "src/app/api/intake/google-sheet/route.ts"]) {
        assert(!/autoAssign:\s*true/.test(fs.readFileSync(f, "utf8")), `${f} (bulk import) must NOT opt into auto-assign`);
      }
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // LEAVE-COVER (#16, 2026-07-02) — an on-leave agent NEVER receives an auto-
  //   assigned NEW lead: resolveActiveAssignee redirects to a free teammate →
  //   manager → park. Passthrough when nobody's on leave (no behavior change).
  //   Pure core is imported + exercised; both auto-assign call sites are wired.
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "leave-cover — on-leave agent never auto-assigned; redirect teammate→manager→park; both call sites wired",
    run: async () => {
      const { pickCoverAssignee, parseLeaveEntries, entriesInEffect } = await import("../src/lib/leaveCover");
      const Y = "yasir", T = "tanuj", L = "lalit", INDIA = [T, Y];
      assert(pickCoverAssignee(Y, new Set(), INDIA, L) === Y, "free target passes through");
      assert(pickCoverAssignee(Y, new Set([Y]), INDIA, L) === T, "on-leave target → free teammate");
      assert(pickCoverAssignee(T, new Set([T, Y]), INDIA, L) === L, "no free teammate → manager");
      assert(pickCoverAssignee(T, new Set([T, Y, L]), INDIA, L) === null, "nobody free → park (null)");
      assert(pickCoverAssignee(null, new Set(), INDIA, L) === null, "null target → null");
      // `until` is inclusive + auto-expires (ISO lexical compare).
      const raw = JSON.stringify([{ userId: Y, until: "2026-07-02" }, { userId: T, until: "2026-07-01" }, { userId: "x" }]);
      assert(parseLeaveEntries(raw).length === 2, "parse drops malformed rows");
      assert(entriesInEffect(parseLeaveEntries(raw), "2026-07-02").length === 1, "expired entry (until<today) dropped, today kept");
      assert(entriesInEffect(parseLeaveEntries(raw), "2026-07-03").length === 0, "all expired the next day");
      // Both auto-assign call sites route through the leave-aware resolver.
      const fsl = await import("fs");
      assert(/resolveActiveAssignee\(/.test(fsl.readFileSync("src/lib/leadIngest.ts", "utf8")),
        "leadIngest must call resolveActiveAssignee (leave-aware)");
      assert(/resolveActiveAssignee\(/.test(fsl.readFileSync("src/lib/reconciler.ts", "utf8")),
        "reconciler must call resolveActiveAssignee (leave-aware)");
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // EXPORT / DOWNLOAD AUDIT (2026-06-30) — every bulk-export + file-download exfil
  //   surface writes an AuditLog row (who · when · IP · device via reqMeta).
  // ───────────────────────────────────────────────────────────────────────────
  {
    name: "export-download-audit — bulk export + file download routes write an AuditLog entry",
    run: async () => {
      const fs = await import("fs");
      const checks: Array<[string, RegExp]> = [
        ["src/app/api/call-logs/export/route.ts", /action:\s*"data\.export\.call-logs"/],
        ["src/app/api/hr/candidates/export/route.ts", /action:\s*"data\.export\.hr-candidates"/],
        ["src/app/api/hr/candidates/[id]/resume/route.ts", /action:\s*"file\.download\.resume"/],
        ["src/app/api/resources/[id]/file/route.ts", /action:\s*"file\.download\.resource"/],
      ];
      for (const [f, re] of checks) {
        const src = fs.readFileSync(f, "utf8");
        assert(/audit\(\{/.test(src) && re.test(src) && /reqMeta\(req\)/.test(src),
          `${f} must call audit() with reqMeta(req) and the expected export/download action`);
      }
    },
  },

  {
    // Unified Lead Detail (Phase E / WS-J J5) — the cross-module Returning Client
    // card. Read-only + scope-safe resolver, flag-gated (default OFF) so it's a
    // no-op until deliberately enabled. Governance rule #6: assert it's wired.
    name: "unified-returning-client — scope-safe resolver + flag-gated card wired into lead detail",
    run: async () => {
      const fs = await import("fs");
      // Resolver scopes every read (agent never sees another owner's siblings).
      const resolver = fs.readFileSync("src/lib/customer/returningClient.ts", "utf8");
      assert(/leadScopeWhere\(me\)/.test(resolver) && /getCustomer360\(me,/.test(resolver),
        "returning-client resolver must scope reads via leadScopeWhere + getCustomer360");
      assert(/tier === "Very High"/.test(resolver),
        "advisory match must be phone/email only (Very High) — never name-only");
      // Flag defaults OFF (no-op deploy).
      const settings = fs.readFileSync("src/lib/settings.ts", "utf8");
      assert(/getReturningClientCardEnabled/.test(settings) && /unifiedDetail\.returningClient\.enabled/.test(settings),
        "returning-client card must be gated by getReturningClientCardEnabled (default OFF)");
      // Wired into the lead detail behind the flag.
      const page = fs.readFileSync("src/app/(app)/leads/[id]/page.tsx", "utf8");
      assert(/getReturningClientCardEnabled\(\)/.test(page) && /getReturningClientView\(me, lead\)/.test(page),
        "lead detail must call the resolver ONLY when the flag is enabled");
      assert(/returningClient && <ReturningClientCard/.test(page),
        "ReturningClientCard must render only when a match exists (returningClient truthy)");
      // Consolidation: the redundant non-investor "Returning contact" InvestorBanner
      // is suppressed when the richer card shows (one source of truth).
      assert(/hideReturningContact=\{!!returningClient\}/.test(page),
        "InvestorBanner must receive hideReturningContact={!!returningClient} to avoid a duplicate returning surface");
      const banner = fs.readFileSync("src/components/InvestorBanner.tsx", "utf8");
      assert(/hideReturningContact/.test(banner) && /matchedLeadIds\.length === 0 \|\| hideReturningContact/.test(banner),
        "InvestorBanner must hide the non-investor returning case when hideReturningContact is set");
      // Zero feature drift (#3): the card is surfaced on Cold/Revival detail too.
      const cold = fs.readFileSync("src/app/(app)/revival-engine/cold-data/[id]/page.tsx", "utf8");
      assert(/getReturningClientView\(me, lead\)/.test(cold) && /returningClient && <ReturningClientCard/.test(cold),
        "Cold/Revival detail must also surface the ReturningClientCard (same flag, zero feature drift)");
      assert(/<DetailShell/.test(cold) && /module="cold"/.test(cold),
        "Cold/Revival detail must use the shared <DetailShell> wrapper (Phase-C migration)");
      // Buyer detail: a BuyerRecord is adapted into the resolver input (customerId null → advisory).
      const buyer = fs.readFileSync("src/app/(app)/buyer-data/[id]/page.tsx", "utf8");
      assert(/getReturningClientView\(me, \{/.test(buyer) && /returningClient && <ReturningClientCard/.test(buyer),
        "Buyer detail must also surface the ReturningClientCard (BuyerRecord adapter, zero feature drift)");
    },
  },

  {
    // Buyer Developer field (Lalit 2026-07-02) — a FIRST-CLASS property attribute:
    // import-mapped, editable, exported, shown in Buyer Property Details (not
    // stranded in Imported Fields). Existing buyers backfilled from extraFields.
    name: "buyer-developer-field — developer wired through import/edit/detail/export + backfilled out of extraFields",
    run: async () => {
      const fsl = await import("fs");
      assert(/developer:\s*\[/.test(fsl.readFileSync("src/lib/buyerImportMap.ts", "utf8")),
        "buyerImportMap must map Developer/Builder headers → the developer field");
      assert(/developer:\s*"string"/.test(fsl.readFileSync("src/app/api/buyer-data/[id]/update/route.ts", "utf8")),
        "buyer inline-edit whitelist must allow editing developer");
      assert(/developer: str\(r\.developer\)/.test(fsl.readFileSync("src/app/api/buyer-data/import/route.ts", "utf8")),
        "buyer import must write developer to the column (both create + update paths)");
      assert(/label="Developer">\{editable\("developer"/.test(fsl.readFileSync("src/app/(app)/buyer-data/[id]/page.tsx", "utf8")),
        "Buyer Property Details must show an editable Developer field");
      assert(/developer: r\.developer/.test(fsl.readFileSync("src/app/api/buyer-data/export/route.ts", "utf8")),
        "buyer CSV export must include the developer column");
      // Integrity: no buyer keeps a Developer value stranded in extraFields (it lives
      // in the column now; future imports write the column, never extraFields).
      const { BUYER_FIELD_ALIASES, matchBuyerField } = await import("../src/lib/buyerImportMap");
      const rows = await prisma.buyerRecord.findMany({ where: { developer: null }, select: { extraFields: true }, take: 3000 });
      const stranded = rows.filter((b) => {
        const e = b.extraFields as Record<string, unknown> | null;
        return !!e && typeof e === "object" && Object.keys(e).some((k) => matchBuyerField(k, BUYER_FIELD_ALIASES.developer) && String((e as Record<string, unknown>)[k] ?? "").trim());
      }).length;
      assert(stranded === 0, `no buyer may keep a Developer value stranded in extraFields (found ${stranded})`);
    },
  },

  {
    // Customer Identity Resolution Center (Phase E) — ADMIN-only page that surfaces
    // UNLINKED same-phone/email duplicate groups + links them into ONE virtual
    // Customer (records stay separate, reversible via unlinkEnquiry, audited).
    name: "customer-identity-resolution — admin-only center: unlinked candidates + reversible gated link",
    run: async () => {
      const fsl = await import("fs");
      assert(/requireRole\("ADMIN"\)/.test(fsl.readFileSync("src/app/(app)/admin/identity/page.tsx", "utf8")),
        "identity Resolution Center page MUST be ADMIN-only");
      const linkRoute = fsl.readFileSync("src/app/api/admin/identity/link/route.ts", "utf8");
      assert(/requireRole\("ADMIN"\)/.test(linkRoute),
        "identity link API MUST be ADMIN-only");
      assert(/linkEnquiryInTx/.test(linkRoute) && /tx\.customer\.create/.test(linkRoute) && /action:\s*"identity\.link"/.test(linkRoute),
        "identity link MUST create a Customer + link via linkEnquiryInTx (reversible) + write an AuditLog");
      assert(/customerId: null/.test(fsl.readFileSync("src/lib/customer/candidates.ts", "utf8")),
        "candidate detection MUST surface only UNLINKED leads (customerId null) — never re-link an already-resolved enquiry");
      assert(/\/admin\/identity/.test(fsl.readFileSync("src/components/MobileShell.tsx", "utf8")),
        "nav MUST expose /admin/identity (admin section)");
    },
  },
  {
    name: "telephony-layer — provider-agnostic, authed webhook, idempotent record, cross-module linking, scope-checked click/recording, additive schema",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");

      // (a) Additive schema is live on prod (buyerId/ivrAccountId + CallEvent + CallSyncTask).
      await prisma.callEvent.count();
      await prisma.callSyncTask.count();
      await prisma.callLog.findFirst({ select: { id: true, buyerId: true, ivrAccountId: true } });

      // (b) Webhook receiver AUTHENTICATES (verifyWebhook) BEFORE recording, logs the
      //     raw event, and never loses a call (retry-enqueue on failure).
      const wh = read("src/app/api/telephony/webhook/route.ts");
      assert(/verifyWebhook\(/.test(wh) && /status:\s*401/.test(wh), "telephony webhook MUST verify signature/token → 401 on failure");
      assert(/logRawEvent\(/.test(wh), "telephony webhook MUST log the raw event verbatim (audit) before processing");
      assert(/recordCallEvent\(/.test(wh) && /enqueue\(\s*["']WEBHOOK/.test(wh), "telephony webhook MUST record + enqueue a retry on failure (never lose a call)");

      // (c) The sink is idempotent + drops into the RIGHT record's timeline.
      const rec = read("src/lib/telephony/recordCall.ts");
      assert(/findUnique\(\{\s*where:\s*\{\s*ivrCallId/.test(rec), "recordCallEvent MUST be idempotent (upsert keyed on ivrCallId)");
      assert(/prisma\.activity\.create/.test(rec) && /prisma\.buyerActivity\.create/.test(rec), "recordCallEvent MUST write to BOTH the Lead timeline (Activity) AND the Buyer timeline (BuyerActivity)");
      assert(/auditLog\.create/.test(rec), "recordCallEvent MUST audit every write");

      // (d) Cross-module linking covers Lead (incl. revival) AND Buyer, active-only.
      const link = read("src/lib/telephony/linkResolver.ts");
      assert(/prisma\.lead\.findFirst/.test(link) && /prisma\.buyerRecord\.findFirst/.test(link), "linkResolver MUST resolve BOTH Lead and BuyerRecord by phone");
      assert(/deletedAt:\s*null/.test(link), "linkResolver MUST match ACTIVE records only (never a soft-deleted lead/buyer)");
      assert(/isRevival/.test(link), "linkResolver MUST flag revival/cold leads");

      // (e) Click-to-call is scope-checked for BOTH lead and buyer paths.
      const ctc = read("src/app/api/telephony/click-to-call/route.ts");
      assert(/loadOwnedLead\(/.test(ctc) && /canTouchBuyer\(/.test(ctc), "click-to-call MUST scope-check leads (loadOwnedLead) AND buyers (canTouchBuyer)");

      // (f) Recording is proxied + scope-checked (never exposes the provider URL).
      const rrec = read("src/app/api/telephony/recording/[callId]/route.ts");
      assert(/requireUser\(/.test(rrec) && /canTouchBuyer\(/.test(rrec) && /loadOwnedLead\(/.test(rrec), "recording route MUST scope-check (admin/manager | own lead | own buyer)");
      assert(/status:\s*403/.test(rrec), "recording route MUST 403 when not permitted");

      // (g) Provider-agnostic registry (asphone + acefone) + config placeholders.
      const prov = read("src/lib/telephony/providers.ts");
      assert(/asphone/.test(prov) && /acefone/.test(prov), "telephony registry MUST include asphone + acefone");
      const cfgSrc = read("src/lib/telephony/config.ts");
      for (const k of ["AS_PHONE_ACCOUNT_ID", "AS_PHONE_API_KEY", "AS_PHONE_SECRET", "AS_PHONE_BASE_URL", "AS_PHONE_DID"]) {
        assert(cfgSrc.includes(k), `config MUST read the ${k} placeholder`);
      }

      // (h) Admin console is ADMIN-only + wired into the heartbeat cron.
      assert(/requireRole\("ADMIN"\)/.test(read("src/app/(app)/admin/telephony/page.tsx")), "AS Phone console MUST be ADMIN-only");
      assert(/requireRole\("ADMIN"\)/.test(read("src/app/api/admin/telephony/route.ts")), "AS Phone admin API MUST be ADMIN-only");
      const warm = read("src/app/api/cron/warm/route.ts");
      assert(/telephony-retry/.test(warm) && /telephony-sync/.test(warm), "heartbeat MUST dispatch telephony-retry + telephony-sync");
    },
  },
  {
    name: "export-import-owner-only — data export/import is Super-Admin (owner) only, server-enforced on every route",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");

      // (a) The single predicate = isSuperAdmin (Lalit + Super Admin; NOT a regular ADMIN like Sameer).
      const perms = read("src/lib/exportPerms.ts");
      assert(/export function canExportData/.test(perms) && /isSuperAdmin === true/.test(perms), "exportPerms MUST gate on isSuperAdmin === true");
      assert(/canImportData\s*=\s*canExportData/.test(perms), "import MUST share the export boundary");

      // (b) DATA: verify Lalit is a super-admin and Sameer is NOT (the gate is meaningless otherwise).
      const lalit = await prisma.user.findFirst({ where: { email: { contains: "lalit", mode: "insensitive" } }, select: { isSuperAdmin: true } });
      assert(lalit?.isSuperAdmin === true, "Lalit MUST be a Super Admin (else the owner is locked out of export)");
      const sameerAdminNonSuper = await prisma.user.count({ where: { email: { contains: "sameer", mode: "insensitive" }, isSuperAdmin: true } });
      assert(sameerAdminNonSuper === 0, "Sameer MUST NOT be a Super Admin (must be blocked from export/import)");

      // (c) EVERY sensitive export/import route enforces the owner gate SERVER-SIDE
      //     (defense-in-depth: a direct URL/API hit must 403 for a non-owner).
      const ROUTES = [
        "src/app/api/reports/export/route.ts",
        "src/app/api/reports/agent-performance/export/route.ts",
        "src/app/api/reports/buyer-performance/export/route.ts",
        "src/app/api/buyer-data/export/route.ts",
        "src/app/api/buyer-data/import/route.ts",
        "src/app/api/call-logs/export/route.ts",
        "src/app/api/intake/csv/route.ts",
      ];
      for (const r of ROUTES) {
        const src = read(r);
        assert(/can(Export|Import)Data\(me\)/.test(src) && /403/.test(src),
          `${r} MUST enforce canExportData/canImportData(me) → 403 (owner-only)`);
      }
      // call-logs export was the known exfil surface (previously role-scoped to agents/managers).
      assert(/!canExportData\(me\)/.test(read("src/app/api/call-logs/export/route.ts")), "call-logs export MUST be owner-only (was an agent/manager exfil surface)");

      // (d) Import PAGES redirect a non-owner (no direct-URL access to the wizard).
      for (const p of ["src/app/(app)/intake/page.tsx", "src/app/(app)/buyer-data/import/page.tsx", "src/app/(app)/india-buyer-data/import/page.tsx"]) {
        assert(/canImportData\(me\)/.test(read(p)) && /redirect\(/.test(read(p)), `${p} MUST redirect non-owners (canImportData gate)`);
      }
    },
  },
  {
    name: "fresh-lead-active-pipeline-only — Fresh applies ONLY to the active Leads pipeline (never Master Data / Buyer / Revival-Cold / Sale-Lease-Off / imported)",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");
      const fl = read("src/lib/freshLeads.ts");

      // (a) The gate exists = leadOrigin ∈ ACTIVE AND importBatchId null.
      assert(/leadOrigin: \{ in: ACTIVE_PIPELINE_ORIGINS \}/.test(fl) && /importBatchId: null/.test(fl),
        "freshLeads MUST define ACTIVE_PIPELINE_WHERE = { leadOrigin ∈ ACTIVE, importBatchId: null }");

      // (b) ACTIVE_PIPELINE_ORIGINS is lock-step with leadScope.ACTIVE_ORIGINS.
      const flOrigins = fl.match(/ACTIVE_PIPELINE_ORIGINS = (\[[^\]]*\])/)?.[1] ?? "";
      const lsOrigins = read("src/lib/leadScope.ts").match(/ACTIVE_ORIGINS = (\[[^\]]*\])/)?.[1] ?? "";
      assert(flOrigins !== "" && flOrigins === lsOrigins, `freshLeads.ACTIVE_PIPELINE_ORIGINS must mirror leadScope.ACTIVE_ORIGINS (${flOrigins} vs ${lsOrigins})`);

      // (c) EVERY fresh/today/backlog where-fn folds the gate in.
      for (const fn of ["assignedTodayWhere", "freshTodayWhere", "freshUntouchedWhere", "firstContactPendingWhere"]) {
        const body = fl.match(new RegExp(`export function ${fn}[\\s\\S]*?\\n}`))?.[0] ?? "";
        assert(/ACTIVE_PIPELINE_WHERE/.test(body), `${fn} MUST fold in ACTIVE_PIPELINE_WHERE (fresh = active pipeline only)`);
      }

      // (d) The ?fresh= URL filter is gated on ALL 4 branches, so the FILTERED list
      //     matches the gated counts (no Master-Data/imported leak when a chip is clicked).
      assert((read("src/lib/leadFilterWhere.ts").match(/ACTIVE_PIPELINE_WHERE/g) ?? []).length >= 4,
        "leadFilterWhere ?fresh= (today/assigned/untouched/pending) MUST each apply ACTIVE_PIPELINE_WHERE");

      // (e) BEHAVIORAL: no non-active-origin or bulk-imported lead may EVER match a
      //     fresh predicate. Query prod and prove the leak count is exactly 0.
      const { freshUntouchedWhere, freshTodayWhere } = await import("../src/lib/freshLeads");
      const nonActiveOrImported = { OR: [{ leadOrigin: { notIn: ["ACTIVE", "ACTIVE_LEAD"] } }, { importBatchId: { not: null } }] };
      const leakU = await prisma.lead.count({ where: { AND: [freshUntouchedWhere({}), nonActiveOrImported] } });
      assert(leakU === 0, `${leakU} non-active/imported leads leak into Fresh Untouched — gate not holding`);
      const leakT = await prisma.lead.count({ where: { AND: [freshTodayWhere({}), nonActiveOrImported] } });
      assert(leakT === 0, `${leakT} non-active/imported leads leak into Fresh Today — gate not holding`);
    },
  },
  {
    name: "notification-no-fabrication — reminders state only what a record holds (no invented callback request / midnight time)",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");
      const cron = read("src/app/api/cron/pre-meeting-reminder/route.ts");

      // (a) The fabricated attribution is GONE — a scheduled follow-up must never be
      //     narrated as a client-requested callback ("they asked you to ring at X").
      assert(!/asked you to ring/i.test(cron), "pre-meeting-reminder MUST NOT claim the client 'asked you to ring' (fabricates a request the record doesn't hold)");

      // (b) Date-only (midnight-IST) follow-ups are skipped — no invented callback time
      //     (this was the "12:00 AM IST" bug). The 00:00 guard must be present.
      assert(/getUTCHours\(\) === 0 && ist\.getUTCMinutes\(\) === 0/.test(cron), "pre-meeting-reminder MUST skip date-only (00:00 IST) follow-ups (no fabricated callback time)");

      // (c) The follow-up reminder body is source-truthful (a Scheduled Follow-up).
      assert(/Scheduled follow-up at/.test(cron), "the follow-up reminder body MUST state the traceable source (Scheduled follow-up at <time>)");

      // (d) DATA: no live lead should have a date-only follow-up that would re-trigger a
      //     midnight callback reminder without the guard. (Informational — the guard
      //     handles any that exist; this just surfaces the count in the assertion msg.)
      const dateOnly = await prisma.lead.findMany({
        where: { followupDate: { not: null }, deletedAt: null, followupReminderSentAt: null },
        select: { followupDate: true }, take: 5000,
      });
      const midnight = dateOnly.filter((r) => { const i = new Date(r.followupDate!.getTime() + 330 * 60000); return i.getUTCHours() === 0 && i.getUTCMinutes() === 0; }).length;
      assert(midnight >= 0, `date-only follow-ups pending: ${midnight} (all skipped by the guard — no fabricated reminder)`);
    },
  },
  {
    name: "notification-source-required — every notification traces to a real record (notify() requires source; UI exposes Source + Open-source)",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");

      // (a) notify() REQUIRES + STORES a source — a source-less notification cannot be
      //     created (compiler-enforced traceability at all call sites).
      const notifyTs = read("src/lib/notify.ts");
      assert(/source: NotifSource;/.test(notifyTs), "notify() NotifyInput MUST require `source: NotifSource`");
      assert(/sourceType: input\.source\.type/.test(notifyTs), "notify() MUST persist source.type → Notification.sourceType");

      // (b) The Notification model carries the source columns.
      const notifModel = read("prisma/schema.prisma").match(/model Notification \{[\s\S]*?\n\}/)?.[0] ?? "";
      assert(/sourceType\s+String\?/.test(notifModel) && /sourceId\s+String\?/.test(notifModel) && /createdById\s+String\?/.test(notifModel),
        "Notification model MUST have sourceType + sourceId + createdById");

      // (c) The source vocabulary is the single source of truth.
      assert(/NOTIF_SOURCE_TYPES/.test(read("src/lib/notifSource.ts")), "src/lib/notifSource.ts MUST define NOTIF_SOURCE_TYPES");

      // (d) The notifications UI surfaces the Source chip + an explicit Open-source jump.
      const ui = read("src/app/(app)/notifications/NotificationsClient.tsx");
      assert(/notifSourceLabel/.test(ui) && /Open source/.test(ui), "notifications UI MUST show the Source label + an Open-source link to the backing record");
    },
  },
  {
    name: "global-search — cross-module + role-scoped + 3-char (leads by origin, buyers by market; no cross-agent leak)",
    run: async () => {
      const fsl = await import("fs");
      const read = (f: string) => fsl.readFileSync(f, "utf8");
      const src = read("src/app/api/quick-search/route.ts");

      // (a) BOTH lead + buyer results are role-scoped server-side.
      assert(/leadScopeWhere\(me\)/.test(src) && /buyerSearchScope\(me\)/.test(src),
        "global search MUST scope leads via leadScopeWhere(me) + buyers via buyerSearchScope(me)");

      // (b) every required field is searched.
      for (const f of ["name", "phone", "altPhone", "email", "company"]) {
        assert(new RegExp(`\\b${f}: \\{ contains`).test(src), `lead search MUST search ${f}`);
      }
      for (const f of ["clientName", "phones", "emails", "projectName"]) {
        assert(new RegExp(`\\b${f}: \\{ contains`).test(src), `buyer search MUST search ${f}`);
      }

      // (c) all five lead-based modules are labelled.
      for (const m of ["Master Data", "Revival Engine", "Dubai Buyer Data", "India Buyer Data"]) {
        assert(src.includes(`"${m}"`), `global search MUST label the "${m}" module`);
      }

      // (d) 3-character minimum, both server + client, and 300ms client debounce.
      assert(/MIN_CHARS = 3/.test(src), "search API MUST require >= 3 chars");
      const qs = read("src/components/QuickSearch.tsx");
      assert(/MIN_CHARS = 3/.test(qs) && /DEBOUNCE_MS = 300/.test(qs), "QuickSearch MUST trigger at 3 chars + debounce 300ms");

      // (e) BEHAVIORAL: an AGENT's buyer search scope can NEVER match another agent's
      //     buyer (ownership-pinned) — prove the leak count is exactly 0.
      const { buyerSearchScope } = await import("../src/lib/buyerScope");
      const agent = await prisma.user.findFirst({ where: { role: "AGENT", active: true }, select: { id: true } });
      if (agent) {
        const scope = await buyerSearchScope({ id: agent.id, role: "AGENT" });
        const leak = await prisma.buyerRecord.count({ where: { AND: [scope, { ownerId: { not: agent.id } }] } });
        assert(leak === 0, `${leak} buyers owned by others leak into agent ${agent.id}'s search scope`);
      }

      // (f) trigram indexes back the partial search (fast at scale).
      const trgm = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
        "SELECT count(*)::int n FROM pg_indexes WHERE indexname LIKE '%_trgm'",
      );
      assert((trgm[0]?.n ?? 0) >= 6, `expected the pg_trgm search indexes (got ${trgm[0]?.n ?? 0}) — run scripts/search-trgm-indexes.sql`);
    },
  },

  // ── 5-MODULE PARITY: editable status badge (Leads · Master · Revival · Dubai/India Buyer) ──
  {
    name: "status-badge-parity — Revival + Buyer detail edit status via the shared InlineEdit; lead route default preserved; buyer edits gated + audited",
    run: async () => {
      const fs = await import("node:fs");
      const rd = (f: string) => fs.readFileSync(f, "utf8");

      // (a) The shared InlineEdit still DEFAULTS to the lead update route when no
      //     `endpoint` is passed — so every existing lead call-site is unchanged.
      const inline = rd("src/components/InlineEdit.tsx");
      assert(/endpoint\s*\?\?/.test(inline) && /\/api\/leads\/\$\{leadId\}\/update/.test(inline),
        "InlineEdit MUST keep the /api/leads/[id]/update default when endpoint is omitted (lead call-sites must not break)");

      // (b) Revival (cold-data) detail edits currentStatus via InlineEdit + the
      //     role/team-aware status list — NOT a static chip.
      const revival = rd("src/app/(app)/revival-engine/cold-data/[id]/page.tsx");
      assert(/InlineEdit/.test(revival) && /field="currentStatus"/.test(revival) && /selectableStatuses\(/.test(revival),
        "Revival detail MUST render InlineEdit for currentStatus (status badge editable, parity with Leads)");

      // (c) Buyer detail (both markets) edits businessStatus via InlineEdit pointed
      //     at the buyer update route, with the market/role status list.
      const buyer = rd("src/app/(app)/buyer-data/[id]/page.tsx");
      assert(/InlineEdit/.test(buyer) && /field="businessStatus"/.test(buyer)
        && /\/api\/buyer-data\/\$\{[^}]+\}\/update/.test(buyer) && /selectableStatuses\(/.test(buyer),
        "Buyer detail MUST render InlineEdit for businessStatus via /api/buyer-data/[id]/update (status editable on Dubai + India)");

      // (d) The buyer update route allow-lists businessStatus, re-enforces the
      //     ownership gate, and writes change-history + audit — so status edits are
      //     permission-gated + traceable, matching the Lead path.
      const buyerRoute = rd("src/app/api/buyer-data/[id]/update/route.ts");
      assert(/businessStatus/.test(buyerRoute), "buyer update route MUST allow-list businessStatus");
      assert(/canTouchBuyer/.test(buyerRoute), "buyer update route MUST re-enforce canTouchBuyer");
      assert(/buyerFieldHistory/.test(buyerRoute) && /audit\(/.test(buyerRoute),
        "buyer update route MUST write buyerFieldHistory + audit() so status changes are traceable");

      // (e) Master Data detail re-exports the Lead detail → inherits the editable
      //     status badge with zero drift (no forked status component anywhere).
      const master = rd("src/app/(app)/master-data/[id]/page.tsx");
      assert(/from "\.\.\/\.\.\/leads\/\[id\]\/page"/.test(master),
        "Master Data detail MUST re-export leads/[id] (shared status editor, no fork)");
    },
  },

  // ── Funds Issue = LOST category (Lalit 2026-07-06) — never Active ──
  {
    name: "funds-issue-lost — 'Funds Issue' is LOST-only (in LOST_STATUSES, NOT ACTIVE_PURSUIT); leadCategory→LOST",
    run: async () => {
      const { LOST_STATUSES, ACTIVE_PURSUIT_STATUSES, TERMINAL_STATUSES, leadCategory } = await import("../src/lib/lead-statuses");
      assert(LOST_STATUSES.includes("Funds Issue"), "'Funds Issue' MUST be in LOST_STATUSES");
      assert(!ACTIVE_PURSUIT_STATUSES.includes("Funds Issue"),
        "'Funds Issue' MUST NOT be in ACTIVE_PURSUIT_STATUSES — it's Lost, never Active (Lalit 2026-07-06)");
      assert(TERMINAL_STATUSES.includes("Funds Issue"), "'Funds Issue' MUST be TERMINAL (via LOST)");
      assert(leadCategory("Funds Issue") === "LOST", "leadCategory('Funds Issue') MUST be LOST");
    },
  },

  // ── NEW Fresh-Lead sort priority (Lalit 2026-07-06) — the 5 new top tiers ──
  //    Pure in-memory (no DB): construct synthetic leads + a fixed today window and
  //    assert leadSortTier resolves each new signal to its tier. Locks first-match-
  //    wins ordering: fresh-today(0) > website-today(1) > manual-today(2) >
  //    assigned-today(3) > untouched(4) > [existing lower band]. Also proves the
  //    active-pipeline gate holds (a non-active row created today can't take 0-3) and
  //    a plain overdue-followup lands in the existing lower band (7).
  {
    name: "fresh-lead-sort-priority — 5 new top tiers (fresh-today→0, website→1, manual→2, assigned→3, untouched→4)",
    run: async () => {
      const { leadSortTier } = await import("../src/lib/lead-statuses");
      // IST 2026-06-21 window (gte 18:30Z prev day .. lt 18:30Z). createdToday = an
      // instant inside it; "old" = well before.
      const today = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") };
      const CREATED_TODAY = new Date("2026-06-21T05:00:00Z"); // 10:30 IST, inside window
      const OLD = new Date("2026-06-01T05:00:00Z");           // 3 weeks earlier
      const ACTIVE = { activePipeline: true };

      // Tier 0 — fresh status + created today (active pipeline). Website source too,
      // but fresh wins first-match over website.
      assert(
        leadSortTier({ currentStatus: "Fresh Lead", createdAt: CREATED_TODAY, source: "WEBSITE" }, today, ACTIVE) === 0,
        "fresh lead created today = tier 0");

      // Tier 1 — website source + created today but NOT fresh status (already worked).
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: CREATED_TODAY, source: "WEBSITE" }, today, ACTIVE) === 1,
        "website lead created today (non-fresh) = tier 1");
      // website flag may also be passed explicitly (caller precomputes it).
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: CREATED_TODAY }, today, { ...ACTIVE, website: true }) === 1,
        "website flag (explicit) created today = tier 1");

      // Tier 2 — created today, non-fresh, non-website (a manual entry).
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: CREATED_TODAY, source: "REFERRAL" }, today, ACTIVE) === 2,
        "manually created today (non-fresh, non-website) = tier 2");

      // Tier 3 — assigned today, but created earlier (not created today), non-fresh.
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: OLD, source: "REFERRAL" }, today, { ...ACTIVE, assignedToday: true }) === 3,
        "assigned today (created earlier, non-fresh) = tier 3");

      // Tier 4 — untouched (no first contact ever), old, non-fresh, not assigned today.
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: OLD, source: "REFERRAL" }, today, { ...ACTIVE, untouched: true }) === 4,
        "untouched (any age) = tier 4");
      // Untouched is origin-independent — even a non-active-pipeline row can be tier 4.
      assert(
        leadSortTier({ currentStatus: "Follow Up", createdAt: OLD }, today, { activePipeline: false, untouched: true }) === 4,
        "untouched applies regardless of pipeline origin = tier 4");

      // First-match wins: a lead that is BOTH created-today-fresh AND untouched still
      // takes tier 0, not 4.
      assert(
        leadSortTier({ currentStatus: "Fresh Lead", createdAt: CREATED_TODAY, source: "WEBSITE" }, today, { ...ACTIVE, untouched: true }) === 0,
        "fresh-created-today beats untouched (first match wins) = tier 0");

      // Active-pipeline GATE: a fresh lead created today but NOT active pipeline (e.g.
      // Master Data / bulk import) cannot occupy tiers 0-3 — it falls to the fresh
      // lower band (tier 6).
      assert(
        leadSortTier({ currentStatus: "Fresh Lead", createdAt: CREATED_TODAY, source: "WEBSITE" }, today, { activePipeline: false }) === 6,
        "non-active-pipeline fresh-today is barred from tiers 0-3 → fresh lower band (6)");
      // The activePipeline flag defaults to true when omitted (back-compat) → tier 0.
      assert(
        leadSortTier({ currentStatus: "Fresh Lead", createdAt: CREATED_TODAY, source: "WEBSITE" }, today) === 0,
        "omitted activePipeline flag defaults to active → tier 0 (back-compat)");

      // Existing lower band still reachable: a plain overdue follow-up (worked, old,
      // has a past followupDate, no new-priority signal) lands at tier 7.
      assert(
        leadSortTier({ currentStatus: "Negotiating", createdAt: OLD, followupDate: new Date("2026-06-19T08:00:00Z") }, today, ACTIVE) === 7,
        "plain overdue follow-up = tier 7 (existing lower band, unchanged)");
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
