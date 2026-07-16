import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { ingestLead, terminalIntakeFields, assignLeadTo } from "@/lib/leadIngest";
import { applyRouting } from "@/lib/leadRouting";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { canImportData, EXPORT_DENIED } from "@/lib/exportPerms";
import { prisma } from "@/lib/prisma";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";
import { teamToMarket } from "@/lib/market";
import { interpretBudget, resolveBudgetCurrency } from "@/lib/budgetCurrency";
import { inferCountryFromCity } from "@/lib/cityCountry";
import { canonicalStatus, isStatusValidForTeam, isTerminalStatus, NEEDS_REVIEW } from "@/lib/lead-statuses";
import { mergeRawRemark } from "@/lib/rawRemarks";
import { applyRevivalMerge } from "@/lib/revivalImport";
import { detectConversationKeyFromRows } from "@/lib/conversationColumn";
import { validEmail, validBudgetRaw, looksLikeStatus, validPhone, looksLikeDate } from "@/lib/importValidate";
import { parseImportDate, detectDateColumn, detectTimeColumn, applyTimeToDate } from "@/lib/parseImportDate";

// Keep date-formatted values OUT of non-date fields (name/company/city/address/
// configuration) — they belong only in date columns. Returns undefined for a date.
const notDate = (v?: string): string | undefined => (v && looksLikeDate(v) ? undefined : v);
import { normalizePhone } from "@/lib/phone";
// runIntelligenceCheck is called inside ingestLead() for every new (non-deduped)
// lead. No explicit call needed here — the check fires sequentially before any
// assignment or automation runs, satisfying the bulk-import constraint.

// Accepts any Google Sheets URL the user pastes (edit URL, share URL, view URL).
// Extracts the sheet ID and (optional) gid (per-tab), then fetches the public
// CSV export. No OAuth needed — the sheet must be shared as "Anyone with the link".

// Mapping toolkit (FIELD_CANDIDATES / fuzzy pick / explicit-mapping accessor /
// preview builder / dup-mode) is shared with the CSV route via the lib, so this
// importer now offers the SAME Import-Mapping-Approval wizard + dup choices.
import {
  type Row,
  IGNORE,
  norm,
  PROJECT_PICK,
  crmFieldOptions,
  buildMapping,
  parseClientMapping,
  parseDupMode,
  type DupMode,
  pick as pickShared,
  makeMappedPick as makeMappedPickShared,
} from "@/lib/importMapping";
import { leadDedupOR } from "@/lib/assignment";

// Tracks which sheet headers were mapped to a known CRM field for the current
// row, so every OTHER column is preserved verbatim in customFields. Reset per row.
let _consumedKeys = new Set<string>();
// Thin wrappers binding the module-global consumed-set (call sites unchanged).
function pick(row: Row, ...candidates: string[]): string | undefined {
  return pickShared(row, _consumedKeys, ...candidates);
}
function makeMappedPick(row: Row, mapping: Record<string, string>) {
  return makeMappedPickShared(row, mapping, _consumedKeys);
}

// Budget parsing uses the shared currency-aware interpretBudget() — the old
// local parser silently 10×–100× corrupted Cr/Lakh values and has been removed.
// Parse source column and return both source and medium
// Call/WhatsApp/Email are now mapped to WEBSITE + medium instead of their own source values
function parseSourceAndMedium(s?: string): { source: LeadSource; medium?: string } {
  if (!s) return { source: LeadSource.CSV_IMPORT };
  const n = norm(s);
  // Call → WEBSITE + Call medium
  if (n.includes("call")) return { source: LeadSource.WEBSITE, medium: "Call" };
  // WhatsApp → WEBSITE + WhatsApp medium
  if (n.includes("whatsapp") || n.includes("wa")) return { source: LeadSource.WEBSITE, medium: "WhatsApp" };
  // Email → WEBSITE + Email medium
  if (n.includes("email")) return { source: LeadSource.WEBSITE, medium: "Email" };
  // Other sources
  if (n.includes("website") || n.includes("web")) return { source: LeadSource.WEBSITE };
  if (n.includes("event") || n.includes("expo")) return { source: LeadSource.EVENT };
  if (n.includes("referral")) return { source: LeadSource.REFERRAL };
  if (n.includes("facebook") || n.includes("fb") || n.includes("meta")) return { source: LeadSource.FACEBOOK_ADS };
  if (n.includes("google")) return { source: LeadSource.GOOGLE_ADS };
  // Unrecognized but PRESENT source (e.g. "Townscript", "Eventbrite") → OTHER as
  // a coarse legacy bucket only. The verbatim value is preserved in sourceRaw and
  // is what the CRM displays/filters on — we NEVER silently relabel it "CSV".
  return { source: LeadSource.OTHER };
}
function parseStage(s?: string) {
  if (!s) return;
  const n = norm(s);
  if (n.includes("contact")) return "CONTACTED";
  if (n.includes("qualif")) return "QUALIFIED";
  if (n.includes("visit")) return "SITE_VISIT";
  if (n.includes("negotiat")) return "NEGOTIATION";
  if (n.includes("book")) return "BOOKING_DONE";
  if (n.includes("won")) return "WON";
  if (n.includes("lost")) return "LOST";
  return "NEW";
}
function parsePotential(s?: string): Potential | undefined {
  if (!s) return; const n = norm(s);
  if (n.startsWith("h")) return Potential.HIGH;
  if (n.startsWith("m")) return Potential.MEDIUM;
  if (n.startsWith("l")) return Potential.LOW;
}
function parseFund(s?: string): FundReadiness | undefined {
  if (!s) return; const n = norm(s);
  if (n.includes("cash")) return FundReadiness.CASH_READY;
  if (n.includes("approved") || n.includes("bank")) return FundReadiness.BANK_APPROVED;
  if (n.includes("financ") || n.includes("loan")) return FundReadiness.FINANCING_NEEDED;
  return FundReadiness.NOT_DISCUSSED;
}
function parseMood(s?: string): MoodStatus | undefined {
  if (!s) return; const n = norm(s);
  if (n.includes("excit")) return MoodStatus.EXCITED;
  if (n.includes("interest")) return MoodStatus.INTERESTED;
  if (n.includes("neutral")) return MoodStatus.NEUTRAL;
  if (n.includes("hesit")) return MoodStatus.HESITANT;
  if (n.includes("cold")) return MoodStatus.COLD;
  if (n.includes("confus")) return MoodStatus.CONFUSED;
  if (n.includes("angry")) return MoodStatus.ANGRY;
}
function parseTimeline(s?: string): InvestTimeline | undefined {
  if (!s) return; const n = norm(s);
  if (n.includes("immed") || n.includes("week") || n.includes("now")) return InvestTimeline.IMMEDIATE;
  if (n.includes("30day") || n.includes("month")) return InvestTimeline.THIRTY_DAYS;
  if (n.includes("3month") || n.includes("quarter")) return InvestTimeline.THREE_MONTHS;
  if (n.includes("6") || n.includes("year")) return InvestTimeline.SIX_PLUS_MONTHS;
  if (n.includes("brows") || n.includes("explor")) return InvestTimeline.WINDOW_SHOPPING;
}

function buildCsvUrl(rawUrl: string): { csvUrl: string; sheetId: string; gid?: string } | { error: string } {
  // Patterns:
  //   https://docs.google.com/spreadsheets/d/<ID>/edit#gid=<GID>
  //   https://docs.google.com/spreadsheets/d/<ID>/edit?gid=<GID>
  //   https://docs.google.com/spreadsheets/d/<ID>/view
  //   https://docs.google.com/spreadsheets/d/e/<PUB_ID>/...  (published)
  const idMatch = rawUrl.match(/\/spreadsheets\/d\/(?:e\/)?([a-zA-Z0-9_-]{20,})/);
  if (!idMatch) return { error: "Not a Google Sheets URL" };
  const sheetId = idMatch[1];
  const gidMatch = rawUrl.match(/[#?&]gid=(\d+)/);
  const gid = gidMatch?.[1];
  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gid ? `&gid=${gid}` : ""}`;
  return { csvUrl, sheetId, gid };
}

export async function POST(req: NextRequest) {
  // SECURITY: Google-Sheet import mutates/overwrites leads — Admin/Super-Admin
  // only, matching the CSV importer and the ADMIN-only import UI. (Was
  // requireUser() — any agent could POST directly.)
  const meUser = await requireRole("ADMIN");
  // Owner-only (Super Admin) — parity with the CSV importer (W5 audit found this
  // route stopped at requireRole and skipped canImportData, so a regular ADMIN
  // like Sameer could bulk-import via Sheet, bypassing Lalit's owner-only rule).
  if (!canImportData(meUser)) return NextResponse.json({ error: EXPORT_DENIED }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const campaign = body.campaign ? String(body.campaign).trim() : undefined;
  // preview=true → dry-run: fetch + parse + check dups + propose mapping, but
  // write NOTHING. Mirrors /api/intake/csv?preview=1. Additive: legacy callers
  // that omit `preview`/`mapping`/`dupMode` behave byte-for-byte as before.
  const isDryRun = body.preview === true || body.preview === "1";
  // OPTIONAL admin-confirmed column→CRM-field mapping (same shape + sentinel as
  // the CSV route). When present the importer reads every field THROUGH it.
  const explicitMapping = parseClientMapping(
    typeof body.mapping === "string" ? body.mapping : (body.mapping ? JSON.stringify(body.mapping) : undefined),
  );
  // OPTIONAL duplicate-handling mode (merge|skip|update|create|conversation).
  const dupMode: DupMode = parseDupMode(body.dupMode);
  if (!url) return NextResponse.json({ error: "Missing sheet URL" }, { status: 400 });

  const built = buildCsvUrl(url);
  if ("error" in built) return NextResponse.json({ error: built.error, hint: "URL must look like https://docs.google.com/spreadsheets/d/<ID>/edit..." }, { status: 400 });

  // Fetch the CSV (sheet must be shared "Anyone with the link → Viewer")
  const res = await fetch(built.csvUrl, { headers: { "User-Agent": "WhiteCollarCRM/1.0" } });
  if (!res.ok) {
    if (res.status === 404 || res.status === 401 || res.status === 403) {
      return NextResponse.json({
        error: `Google Sheets returned ${res.status}. Make the sheet readable by 'Anyone with the link'.`,
        hint: "Open the sheet → Share → 'General access' → 'Anyone with the link → Viewer'.",
      }, { status: res.status });
    }
    return NextResponse.json({ error: `Google Sheets returned ${res.status}` }, { status: 502 });
  }
  const text = await res.text();
  if (text.toLowerCase().includes("<!doctype html") || text.toLowerCase().includes("sign in")) {
    return NextResponse.json({
      error: "Google returned a login page — the sheet isn't publicly readable.",
      hint: "Open the sheet → Share → 'Anyone with the link → Viewer'.",
    }, { status: 401 });
  }

  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 5) return NextResponse.json({ error: "CSV parse errors", details: parsed.errors.slice(0,5) }, { status: 422 });

  // Some MIS sheets keep call-by-call history in a column with a BLANK header
  // (Papa maps it to the key ""). Rescue ONLY a genuine conversation column and
  // copy it to a real "Remarks" key, so it flows to rawRemarks via pick("remarks")
  // — never to a structured field. No-op when a labeled Remarks column exists.
  // NOTE: a blank header maps to the key "" (empty string) — which is FALSY, so
  // this MUST be `!== null`, never a truthiness check, or the rescue would skip
  // the exact case it exists for.
  const convKey = detectConversationKeyFromRows(parsed.data as Array<Record<string, unknown>>);
  if (convKey !== null) {
    for (const row of parsed.data as Row[]) {
      const v = String((row as Record<string, unknown>)[convKey] ?? "").trim();
      row["Remarks"] = v || String(row["Remarks"] ?? "");   // unlabeled conversation → Remarks
    }
  }

  let created = 0, deduped = 0, enriched = 0;
  let skippedDup = 0, conversationAppended = 0;
  let revived = 0;               // dupMode="revival": existing lead re-engaged (non-destructive)
  const errors: string[] = [];
  const detectedColumns = Object.keys(parsed.data[0] ?? {});
  const futureDateRows: { name: string; rawDate: string }[] = [];

  // Detect date and time columns for this sheet (fixed once, used for every row).
  // These are the AUTO-DETECT fallback — used only when the admin did NOT confirm
  // an explicit Date mapping in the wizard.
  const dateColumn = detectDateColumn(detectedColumns);
  const timeColumn = detectTimeColumn(detectedColumns);
  // Did the admin confirm a column → "date" mapping in the approval gate? When so,
  // the importer reads the lead date from THAT exact column (via the field()
  // accessor below) instead of guessing — parity with the CSV route, which always
  // honours field("date", …). Auto-detect remains the fallback.
  const dateMappingConfirmed = !!explicitMapping && Object.values(explicitMapping).includes("date");
  // Item #3: did the admin confirm a column → "time" mapping? When so, the Created
  // Time is read from THAT exact column (field("time", …)); else the auto-detected
  // Time column. Absent either → createdTimeKnown stays false → Created Time blank.
  const timeMappingConfirmed = !!explicitMapping && Object.values(explicitMapping).includes("time");

  // ── PREVIEW / DRY-RUN ───────────────────────────────────────────────────
  // preview=true: scan rows for dup/missing counts + propose a column mapping,
  // write NOTHING. Same response shape as /api/intake/csv?preview=1 so the
  // shared LeadImportWizard renders identically for the sheet importer.
  if (isDryRun) {
    let pNew = 0, pDup = 0, pMissingName = 0, pMissingPhone = 0, pMissingProject = 0;
    const dupSamples: { name: string; phone: string; existingStatus: string }[] = [];
    const unknownStatuses = new Set<string>();
    for (const row of parsed.data as Row[]) {
      _consumedKeys = new Set();
      const nm = pick(row, "customer", "name", "fullname", "leadname");
      const ph = pick(row, "mobile", "phone", "contact", "whatsapp");
      const em = pick(row, "email", "emailid");
      if (!nm && !ph && !em) continue;
      if (!nm) pMissingName++;
      if (!ph) pMissingPhone++;
      if (!pick(row, ...PROJECT_PICK)) pMissingProject++;
      const cs = pick(row, "status", "callstatus");
      if (cs) unknownStatuses.add(cs);
      // D2 fix: preview dedup by canonical-phone-tail OR email (independent signals),
      // the SAME rule the real ingest uses — replaces the old fingerprint startsWith
      // check, which missed an email-only (or phone-only) re-import.
      const dupOR = leadDedupOR(ph, em);
      const existing = dupOR.length > 0
        ? await prisma.lead.findFirst({ where: { deletedAt: null, OR: dupOR }, select: { name: true, phone: true, currentStatus: true } })
        : null;
      if (existing) {
        pDup++;
        if (dupSamples.length < 8) dupSamples.push({ name: nm ?? "—", phone: ph ?? "", existingStatus: existing.currentStatus ?? existing.name });
      } else { pNew++; }
    }
    const sampleRows = (parsed.data as Row[]).slice(0, 10).map((row) => {
      const cells: Record<string, string> = {};
      for (const k of detectedColumns) { const v = row[k]?.toString() ?? ""; if (v !== "") cells[k] = v; }
      return cells;
    });
    return NextResponse.json({
      preview: true,
      totalRows: parsed.data.length,
      newRows: pNew, dupRows: pDup,
      missingName: pMissingName, missingPhone: pMissingPhone, missingProject: pMissingProject,
      dupSamples,
      uniqueStatuses: [...unknownStatuses].slice(0, 20),
      detectedColumns,
      mapping: buildMapping(detectedColumns),
      crmFields: crmFieldOptions(),
      ignoreValue: IGNORE,
      sampleRows,
      fileType: "Google Sheet",
      sheetName: built.gid ? `gid:${built.gid}` : built.sheetId,
      dateColumnDetected: !!dateColumn,
      timeColumnDetected: !!timeColumn,
      automationNote: "All automation is OFF during import (Import Safe Mode). No WhatsApp, emails, round-robin, or SLA alerts will fire.",
    });
  }

  // Import History batch — stamp every NEW lead so the whole sheet import can
  // be rolled back later from the admin Import History screen.
  const importBatch = await prisma.importBatch.create({
    data: {
      fileName: `Google Sheet ${built.sheetId}`,
      sheetName: built.gid ? `gid:${built.gid}` : null,
      importType: "ACTIVE",
      totalRows: parsed.data.length,
      importedById: meUser.id,
    },
  });

  for (const [i, row] of parsed.data.entries()) {
    _consumedKeys = new Set();   // reset per-row: tracks headers mapped to CRM fields
    // Field accessor honouring an admin-confirmed mapping (reads the EXACT chosen
    // column) — else the fuzzy pick() fallback. Identical pattern to the CSV route.
    const mappedPick = explicitMapping ? makeMappedPick(row, explicitMapping) : null;
    const field = (crmField: string, ...fallback: string[]): string | undefined =>
      mappedPick ? mappedPick(crmField) : pick(row, ...fallback);
    const name = notDate(field("name", "customer", "name", "fullname", "leadname"));
    // VALIDATE (same rules as CSV import): normalize to E.164 then reject
    // malformed (country-code-only "+91", merged/over-long) → store blank rather
    // than corrupt phone data.
    const phoneRaw = field("phone", "mobile", "phone", "contact", "whatsapp");
    const phone = phoneRaw ? (validPhone(normalizePhone(phoneRaw, "IN")) ?? undefined) : undefined;
    // VALIDATE: only store an email that is actually an email — never a name or
    // boolean leaked from an adjacent column ("tanuj", "false").
    const email = validEmail(field("email", "email", "emailid"));
    if (!name && !phone && !email) continue;

    // VALIDATE: a budget must contain a number. A digit-less value ("Lalit Sir")
    // is NOT a budget — drop it rather than store a name in the budget field.
    const budgetCol = validBudgetRaw(field("budget", "budgetaed", "budgetinr", "budget", "budgetmin"));
    const budgetInfo = budgetCol
      ? interpretBudget(budgetCol, validBudgetRaw(field("budgetMax", "budgetmax")))
      : { min: null, max: null, raw: null };
    try {
      // ── Duplicate-handling mode (wizard choice) ──────────────────────────
      if (dupMode !== "merge" && dupMode !== "update") {
        // D2 fix: match by canonical-phone-tail OR email (independent signals), the
        // SAME rule ingestLead uses — not the old combined "phone|email" fingerprint.
        const dupOR = leadDedupOR(phone, email);
        const existingDup = dupOR.length > 0
          ? await prisma.lead.findFirst({ where: { deletedAt: null, OR: dupOR }, select: { id: true, rawRemarks: true } })
          : null;
        if (existingDup) {
          if (dupMode === "skip") { skippedDup++; deduped++; continue; }
          if (dupMode === "conversation") {
            const remarkText = field("remarks", "remarks", "remark") ?? field("message", "message", "requirement");
            if (remarkText) {
              const merged = mergeRawRemark(existingDup.rawRemarks, remarkText, importBatch.fileName);
              await prisma.lead.update({ where: { id: existingDup.id }, data: { rawRemarks: merged, remarks: merged } });
              conversationAppended++;
            }
            deduped++;
            continue;
          }
          if (dupMode === "revival") {
            // ── REVIVAL: re-engage the existing lead, strictly NON-DESTRUCTIVELY.
            // IDENTICAL behaviour to the CSV route via the shared applyRevivalMerge
            // helper (lib-query parity): fill-if-empty merge + append remarks + NOTE
            // timeline entry + move into the Revival Engine + per-field audit.
            const teamRaw = field("team", "forwardedteam", "team") ?? null;
            const teamRes = resolveTeam({
              forceTeam: teamRaw,
              forceMethod: "import",
              sourceDetail: campaign ?? field("project", ...PROJECT_PICK) ?? undefined,
              projectSlug: field("project", ...PROJECT_PICK),
              text: field("message", "remarks", "message", "requirement"),
            });
            const csRev = field("status", "status");
            const incoming: Record<string, unknown> = {
              company: notDate(field("company", "company")),
              address: notDate(field("address", "address")),
              configuration: notDate(field("configuration", "configuration", "config", "bhk", "type")),
              city: notDate(field("city", "city", "location")),
              country: field("country", "country"),
              budgetMin: budgetInfo.min ?? undefined,
              budgetMax: budgetInfo.max ?? undefined,
              budgetRaw: budgetInfo.raw ?? undefined,
              potential: parsePotential(field("potential", "potential")),
              fundReadiness: parseFund(field("fundReadiness", "fundreadiness", "fund")),
              moodStatus: parseMood(field("moodStatus", "moodstatus", "mood")),
              whenCanInvest: parseTimeline(field("whenCanInvest", "whencaninvest", "timeline")),
              currentStatus: csRev && looksLikeStatus(csRev) ? canonicalStatus(csRev) : undefined,
              categorization: field("categorization", "categorization", "category"),
              sourceRaw: field("source", "source"),
              whoIsClient: field("whoIsClient", "whoisclient", "client", "clientinfo"),
              detailShared: field("detailShared", "detailshared"),
              todoNext: field("todoNext", "todo", "todonext", "nextaction"),
              followupDate: parseImportDate(field("followupDate", "followupdate", "followup")) ?? undefined,
              meetingDate: parseImportDate(field("meeting", "meeting", "meetingdate")) ?? undefined,
              siteVisitDate: parseImportDate(field("siteVisit", "sitevisit")) ?? undefined,
              forwardedTeam: teamRes.team ?? undefined,
              routingMethod: teamRes.team ? routingFieldsFor(teamRes).routingMethod : undefined,
              routingSource: teamRes.team ? routingFieldsFor(teamRes).routingSource : undefined,
              routingReason: teamRes.team ? routingFieldsFor(teamRes).routingReason : undefined,
            };
            await applyRevivalMerge({
              db: prisma,
              existingId: existingDup.id,
              incoming,
              remark: field("remarks", "remarks", "remark") ?? field("message", "message", "requirement"),
              project: field("project", ...PROJECT_PICK),
              tags: field("tags", "tags"),
              revivalSource: field("source", "source") ?? campaign ?? importBatch.fileName,
              fileName: importBatch.fileName,
              changedById: meUser.id,
            });
            revived++; deduped++;
            continue;
          }
          // dupMode === "create" → fall through with skipDedup below.
        }
      }
      // Parse the lead (historic) date. When the admin CONFIRMED a Date mapping in
      // the wizard, read the date from that exact column via field("date", …) —
      // honouring the chosen mapping exactly like the CSV route, never re-guessing.
      // Otherwise fall back to the auto-detected date column. Either way apply the
      // (auto-detected) time column if one exists.
      let leadDate: Date | undefined;
      let rawDateForReport = "";
      if (dateMappingConfirmed) {
        const dateRaw = field("date", "date", "leaddate", "createdon", "createddate", "entrydate");
        rawDateForReport = dateRaw ?? "";
        leadDate = parseImportDate(dateRaw);
      } else if (dateColumn) {
        const dateRaw = row[dateColumn];
        rawDateForReport = dateRaw ?? "";
        leadDate = parseImportDate(dateRaw);
      }
      // Created TIME: admin-confirmed "time" mapping first, else the auto-detected
      // Time column. Combine into the lead date only when it parses; track whether a
      // real time was applied so Created Time can render blank when the sheet had none.
      let createdTimeKnown = false;
      if (leadDate) {
        const timeRaw = timeMappingConfirmed
          ? field("time", "time", "createdtime", "leadtime", "calltime", "entrytime", "inquirytime", "enteredtime")
          : (timeColumn ? row[timeColumn] : undefined);
        if (timeRaw && /\d{1,2}[:.]\d{2}/.test(String(timeRaw))) {
          leadDate = applyTimeToDate(leadDate, String(timeRaw));
          createdTimeKnown = true;
        }
      }

      // Guard: reject future-dated leads (data-entry typos, follow-up dates misplaced)
      // 24h tolerance for timezone differences
      const dateIsFuture = !!leadDate && leadDate.getTime() > Date.now() + 24 * 3600 * 1000;
      if (dateIsFuture) {
        futureDateRows.push({ name: name ?? phone ?? email ?? "—", rawDate: rawDateForReport });
        leadDate = undefined; // fallback to import time
        createdTimeKnown = false; // no trusted time when we discard the future date
      }

      const sourceAndMedium = parseSourceAndMedium(field("source", "source"));
      // Detect an incoming TERMINAL status (Lost/Rejected or Won/Closed) up-front — the
      // SAME parse the post-create update uses below — so ingestLead SKIPS auto-assign
      // for it (a terminal import must never be round-robined to an agent, nor notify
      // one). Only a terminal status is passed through; a workable status is still
      // stamped post-create as before, so the normal import flow is unchanged.
      const csForIngest = field("status", "status");
      const incomingStatus = csForIngest && looksLikeStatus(csForIngest) ? (canonicalStatus(csForIngest) ?? undefined) : undefined;
      const incomingIsTerminal = isTerminalStatus(incomingStatus);
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: notDate(field("city", "city", "location")),
        configuration: notDate(field("configuration", "configuration", "config", "bhk", "type")),
        budgetMin: budgetInfo.min ?? undefined,
        budgetMax: budgetInfo.max ?? undefined,
        notesShort: field("message", "remarks", "message", "requirement"),
        tags: field("tags", "tags"),
        source: sourceAndMedium.source,
        sourceDetail: campaign,
        createdAt: leadDate,
        // Import-fidelity: a Created Time is known only when a Time column parsed;
        // else false → Created Time renders blank (imports never fabricate a time).
        createdTimeKnown: leadDate ? createdTimeKnown : false,
        // Terminal-on-arrival: hand ingestLead the terminal status so it skips
        // auto-assign + nulls the default follow-up at creation. Workable → undefined.
        currentStatus: incomingIsTerminal ? incomingStatus : undefined,
        // "Create new anyway" bypasses the duplicate merge for this row.
        skipDedup: dupMode === "create",
      });
      if (r.deduped) deduped++; else created++;

      const update: Record<string, unknown> = {};
      // Stamp the batch on NEW rows so a rollback can find + soft-delete them.
      if (!r.deduped) update.importBatchId = importBatch.id;
      // Phase D: bulk imports land in MASTER_DATA (untriaged); admin moves them.
      if (!r.deduped) update.leadOrigin = "MASTER_DATA";
      // Add medium from parsed source
      if (sourceAndMedium.medium) update.medium = sourceAndMedium.medium;
      const co = notDate(field("company", "company")); if (co) update.company = co;
      const ad = notDate(field("address", "address")); if (ad) update.address = ad;
      const wc = field("whoIsClient", "whoisclient", "client", "clientinfo"); if (wc) update.whoIsClient = wc;
      const cat = field("categorization", "categorization", "category"); if (cat) update.categorization = cat;
      // Property Enquired (→ sourceDetail). The Sheet importer previously dropped
      // the project/property column (it only used it for routing/currency) — now it
      // maps into Property Enquired like the CSV importer. campaign (passed as
      // sourceDetail to ingestLead) wins; a manually-set value is never overwritten.
      const sheetProject = field("project", ...PROJECT_PICK);
      if (sheetProject) update.sourceDetail = update.sourceDetail ?? sheetProject;
      // RAW-FIRST remarks (bugfix): the Sheet importer previously routed the
      // Remarks column ONLY into notesShort, so imported history never reached
      // Lead.remarks / Conversation History. Now the exact remark is stored
      // verbatim in the immutable rawRemarks audit field (and mirrored to the
      // display copy), growing — never overwriting — on re-import.
      const sheetRemark = field("remarks", "remarks", "remark");
      if (sheetRemark) {
        if (r.deduped) {
          const prevR = await prisma.lead.findUnique({ where: { id: r.lead.id }, select: { rawRemarks: true } });
          const merged = mergeRawRemark(prevR?.rawRemarks, sheetRemark, importBatch.fileName);
          update.rawRemarks = merged;
          update.remarks = merged;
        } else {
          update.rawRemarks = sheetRemark;
          update.remarks = sheetRemark;
        }
      }
      const st = parseStage(field("stage", "stage")); if (st) update.status = st as any;
      // VALIDATE: only accept a real status label — never a TRUE/FALSE/numeric
      // token leaked from a Meeting/Site-Visit column.
      const cs = field("status", "status"); if (cs && looksLikeStatus(cs)) update.currentStatus = canonicalStatus(cs);
      // SOURCE FIDELITY: store the verbatim Source column exactly as written
      // ("Townscript", "Eventbrite", "WhatsApp Campaign June"). Display + filters
      // read this; it is NEVER mapped, normalized, or defaulted.
      const srcRaw = field("source", "source"); if (srcRaw) update.sourceRaw = srcRaw;
      const fu = parseImportDate(field("followupDate", "followupdate", "followup")); if (fu) update.followupDate = fu;
      const me = parseImportDate(field("meeting", "meeting", "meetingdate")); if (me) update.meetingDate = me;
      const sv = parseImportDate(field("siteVisit", "sitevisit")); if (sv) update.siteVisitDate = sv;
      const td = field("todoNext", "todo", "todonext", "nextaction"); if (td) update.todoNext = td;
      const ds = field("detailShared", "detailshared"); if (ds) update.detailShared = ds;
      const po = parsePotential(field("potential", "potential")); if (po) update.potential = po;
      const fd = parseFund(field("fundReadiness", "fundreadiness", "fund")); if (fd) update.fundReadiness = fd;
      const md = parseMood(field("moodStatus", "moodstatus", "mood")); if (md) update.moodStatus = md;
      const tl = parseTimeline(field("whenCanInvest", "whencaninvest", "timeline")); if (tl) update.whenCanInvest = tl;
      {
        const rowTeamRaw = field("team", "forwardedteam", "team") ?? null;
        const teamResult = resolveTeam({
          forceTeam: rowTeamRaw,
          forceMethod: "import",
          sourceDetail: campaign,
          projectSlug: field("project", ...PROJECT_PICK),
          text: field("message", "remarks", "message", "requirement"),
        });
        if (teamResult.team) {
          update.forwardedTeam = teamResult.team;
          // Market tracks team — set the derived India/UAE market so imported
          // team-tagged rows never leave a lead-market-segregation gap.
          update.market = teamToMarket(teamResult.team);
          const rf = routingFieldsFor(teamResult);
          update.routingMethod = rf.routingMethod;
          update.routingSource = rf.routingSource;
          update.routingReason = rf.routingReason;
        }
        // Import status validation (Issue 2, rule 5): a status that doesn't belong
        // to THIS lead's team master is flagged "Needs Review", never mixed in.
        if (typeof update.currentStatus === "string" && update.currentStatus) {
          const teamForStatus = (update.forwardedTeam as string | undefined) ?? null;
          if (!isStatusValidForTeam(update.currentStatus, teamForStatus)) {
            update.originalSheetStatus = (update.originalSheetStatus as string | undefined) ?? update.currentStatus;
            update.currentStatus = NEEDS_REVIEW;
          }
        }
      }
      // Budget: verbatim raw + market-resolved currency (priority order; UNKNOWN
      // when not confident). Only a row that actually carries a budget updates
      // these — a blank never wipes an existing value on dedupe.
      if (budgetInfo.raw) {
        const budgetHeader = Object.keys(row).find(k => /budget/i.test(k)) ?? "";
        const headerHint = /aed|dhs/i.test(budgetHeader) ? "AED"
          : /inr|₹|rs/i.test(budgetHeader) ? "INR" : null;
        // Use ONLY "currency" — "budgetcurrency" fuzzy-matches the plain "Budget"
        // column and would read the amount. Also accept a currency token embedded
        // in the budget text ("AED 800K", "₹4 Cr").
        const rawCcyHint = budgetInfo.raw && /(?:aed|dhs|inr|rupee|rs\b|₹)/i.test(budgetInfo.raw) ? budgetInfo.raw : undefined;
        const ccy = resolveBudgetCurrency({
          explicit: field("currency", "currency") ?? rawCcyHint ?? headerHint,
          country: field("country", "country") ?? inferCountryFromCity(field("city", "city", "location")),
          projectName: field("project", ...PROJECT_PICK) ?? (update.sourceDetail as string | undefined),
          sheetName: importBatch.fileName,
          team: (update.forwardedTeam as string | undefined) ?? field("team", "forwardedteam", "team"),
        });
        update.budgetRaw = budgetInfo.raw;
        if (budgetInfo.min != null) update.budgetMin = budgetInfo.min;
        if (budgetInfo.max != null) update.budgetMax = budgetInfo.max;
        update.budgetCurrency = ccy;
      }
      // Preserve EVERY unmapped sheet column verbatim (header→value) in customFields
      // so no sheet data is silently dropped. Merge with any prior import on dedupe.
      const cf: Record<string, string> = {};
      for (const k of Object.keys(row)) {
        if (_consumedKeys.has(k)) continue;
        if (!norm(k)) continue;   // blank/symbol-only header → noise, not a real "extra column" (stays in rawImport)
        const v = row[k]?.toString().trim();
        if (v) cf[k] = v;
      }
      if (Object.keys(cf).length > 0) {
        if (r.deduped) {
          const prev = await prisma.lead.findUnique({ where: { id: r.lead.id }, select: { customFields: true } });
          update.customFields = { ...((prev?.customFields as Record<string, unknown>) ?? {}), ...cf };
        } else {
          update.customFields = cf;
        }
      }
      // RAW IMPORT (immutable audit): the ENTIRE original row verbatim — every
      // column, incl. mapped ones — so every imported value is recoverable
      // exactly as written. Blanks never overwrite a prior original on re-import.
      const rawRow: Record<string, string> = {};
      for (const k of Object.keys(row)) { const v = row[k]?.toString(); if (v != null && v !== "") rawRow[k] = v; }
      if (Object.keys(rawRow).length > 0) {
        if (r.deduped) {
          const prevRI = await prisma.lead.findUnique({ where: { id: r.lead.id }, select: { rawImport: true } });
          update.rawImport = { ...((prevRI?.rawImport as Record<string, unknown>) ?? {}), ...rawRow };
        } else {
          update.rawImport = rawRow;
        }
      }
      // ── TERMINAL-STATUS INTAKE RULE (Lalit 2026-07-10) ─────────────────────────────
      // If this row's resolved status is terminal, the lead must not sit in an agent's
      // active queue. Apply the ONE shared side-effect helper, keyed off the owner this
      // import WOULD otherwise land the lead with — the auto-assigned owner, or (on a
      // dedupe) the existing owner — read BEFORE the write:
      //   • LOST/Rejected → unassign (ownerId+assignedAt null) + stash previousOwnerId
      //     (current owner wins, stored value is the idempotent fallback) + clear follow-up.
      //   • Won/Closed    → KEEP the owner (booking attribution) + clear follow-up only.
      // Spread LAST so it overrides any ownerId / followupDate set in `update` above. It
      // is inert ({}) for a workable status, so non-terminal imports are unchanged. Covers
      // both NEW rows and dedupe UPDATES that carry a terminal status.
      if (typeof update.currentStatus === "string" && update.currentStatus) {
        const intendedOwnerId = ("ownerId" in update ? (update.ownerId as string | null) : r.lead.ownerId) ?? null;
        Object.assign(update, terminalIntakeFields(update.currentStatus, {
          ownerId: intendedOwnerId,
          previousOwnerId: r.lead.previousOwnerId ?? null,
        }));
      }
      if (Object.keys(update).length) {
        await prisma.lead.update({ where: { id: r.lead.id }, data: update });
        enriched++;
      }

      // Routing Scheduler (module "import"): an explicit Imports-scoped admin rule
      // may auto-assign brand-new imported rows. No rule / paused / terminal /
      // already owned (Assigned-User column etc. = manual, wins) → parked exactly
      // as today. Dedupe-updates never re-route an existing lead.
      if (!r.deduped) {
        const finalOwner = ("ownerId" in update ? (update.ownerId as string | null) : r.lead.ownerId) ?? null;
        const finalStatus = typeof update.currentStatus === "string" ? update.currentStatus : r.lead.currentStatus;
        if (!finalOwner && !isTerminalStatus(finalStatus)) {
          const d = await applyRouting({
            module: "import",
            team: (update.forwardedTeam as string | undefined) ?? r.lead.forwardedTeam,
            market: (update.market as string | undefined) ?? r.lead.market,
            source: sourceAndMedium.source,
            project: (update.sourceDetail as string | undefined) ?? r.lead.sourceDetail,
            country: r.lead.country,
          });
          if (d && !d.paused) {
            try {
              await assignLeadTo(r.lead.id, d.ownerId, d.reason);
              await prisma.lead.update({
                where: { id: r.lead.id },
                data: { routingMethod: "rule", routingSource: `routing_rule:${d.ruleId}`, routingReason: d.reason },
              });
            } catch (e) { console.error("[sheet-import] routing-rule assign failed", r.lead.id, e); }
          }
        }
      }
    } catch (e) {
      errors.push(`Row ${i+2}: ${String(e)}`);
    }
  }

  const skippedCount = Math.max(0, parsed.data.length - created - deduped - errors.length);
  await prisma.importBatch.update({
    where: { id: importBatch.id },
    data: {
      createdCount: created,
      updatedCount: deduped,
      skippedCount,
      errorCount: errors.length,
      errors: errors.length ? JSON.stringify(errors.slice(0, 20)) : null,
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true, sheetId: built.sheetId, gid: built.gid,
    fileType: "Google Sheet",
    rowsProcessed: parsed.data.length,
    created, deduped, enriched,
    // `revived` (dupMode="revival") = existing leads re-engaged non-destructively;
    // surfaced in the response + report only (reuses updatedCount — no migration).
    dupMode, skippedDup, conversationAppended, revived,
    mappingConfirmed: !!explicitMapping,
    customFieldsCreated: explicitMapping
      ? detectedColumns.filter((c) => { const v = explicitMapping[c]; return !v || v === IGNORE; }).length
      : 0,
    importBatchId: importBatch.id,
    detectedColumns,
    // A lead date was sourced either from the admin-confirmed Date mapping OR from
    // the auto-detected Date column. dateMappingConfirmed says which one was used.
    dateColumnDetected: dateMappingConfirmed || !!dateColumn,
    dateMappingConfirmed,
    timeColumnDetected: !!timeColumn,
    futureDateRows: futureDateRows.slice(0, 20),
    futureDateCount: futureDateRows.length,
    errors: errors.slice(0,10),
  });
}
