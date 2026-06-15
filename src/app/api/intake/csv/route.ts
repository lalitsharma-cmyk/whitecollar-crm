import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, LeadStatus, AIScore } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractFromRemarks, mergeSuggestions } from "@/lib/remarkAutofill";
import { splitPhones, normalizePhone } from "@/lib/phone";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";
import { interpretBudget, resolveBudgetCurrency } from "@/lib/budgetCurrency";
import { inferCountryFromCity } from "@/lib/cityCountry";
import { canonicalStatus } from "@/lib/lead-statuses";
import { audit, reqMeta } from "@/lib/audit";
// runIntelligenceCheck is called inside ingestLead() for every new (non-deduped)
// lead. No explicit call needed here — the check fires sequentially, one per row,
// before any assignment or automation runs, satisfying the bulk-import constraint.

// Map the MIS "Categorization" / "Status" column to the CRM's AIScore bucket.
// Lalit's policy: when the agent has already written something like "Highly
// Responsive – picks calls/messages regularly" in the sheet, that's the truth.
// Don't let the AI override it.
function aiScoreFromCategorization(s?: string): { score: AIScore; value: number } | null {
  if (!s) return null;
  const n = s.toLowerCase();
  // HOT signals
  if (/highly responsive|hot|excited|ready to (book|buy|close)|booked|signed|paid|interested in booking/i.test(n))
    return { score: AIScore.HOT, value: 85 };
  // WARM signals
  if (/responsive|warm|interested|positive|considering|will visit|meeting scheduled/i.test(n))
    return { score: AIScore.WARM, value: 60 };
  // COLD signals
  if (/cold|not responsive|not picking|switched off|low interest|just browsing|window shopping|future plan/i.test(n))
    return { score: AIScore.COLD, value: 25 };
  // Explicit "not interested" / "dropped"
  if (/not interested|drop my query|cancel|wrong number|do not call|stale/i.test(n))
    return { score: AIScore.COLD, value: 10 };
  return null;
}

type Row = Record<string, string>;

// Headers consumed by pick() for the row being processed — lets the importer
// preserve every UNMAPPED Excel column verbatim in Lead.customFields. Reset per row.
let _consumedKeys = new Set<string>();

function norm(s: string): string { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function pick(row: Row, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        // Count as "mapped" (hidden from customFields) ONLY on an exact match or
        // when the header is a PREFIX of the candidate ("mob"→"mobile"). When the
        // header EXTENDS a candidate ("sourcecampaign" ⊃ "source", "investmenttype"
        // ⊃ "invest", "clientcategory" ⊃ "client") it's almost always a DIFFERENT
        // column that only prefix-collides — keep it as a preserved custom field so
        // no sheet data (and no original value) is ever lost.
        if (nk === t || t.startsWith(nk)) _consumedKeys.add(k);
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}
// NOTE: budget parsing now uses the shared, currency-aware parser via
// interpretBudget() from "@/lib/budgetCurrency" (handles Cr/Lakh/M/K correctly,
// splits ranges, and preserves the verbatim text). The old local parser silently
// 10×–100× corrupted Cr/Lakh values and has been removed.
function parseSource(s?: string): LeadSource {
  if (!s) return LeadSource.CSV_IMPORT;
  const n = norm(s);
  if (n.includes("whatsapp")) return LeadSource.WHATSAPP;
  if (n.includes("website") || n.includes("web")) return LeadSource.WEBSITE;
  if (n.includes("event") || n.includes("expo")) return LeadSource.EVENT;
  if (n.includes("referral")) return LeadSource.REFERRAL;
  if (n.includes("call")) return LeadSource.INBOUND_CALL;
  if (n.includes("facebook") || n.includes("fb") || n.includes("meta")) return LeadSource.FACEBOOK_ADS;
  if (n.includes("google")) return LeadSource.GOOGLE_ADS;
  if (n.includes("99acres")) return LeadSource.PORTAL_99ACRES;
  if (n.includes("magicbricks")) return LeadSource.PORTAL_MAGICBRICKS;
  if (n.includes("housing")) return LeadSource.PORTAL_HOUSING;
  return LeadSource.CSV_IMPORT;
}
function mapSheetStatus(s?: string): LeadStatus {
  if (!s) return LeadStatus.NEW;
  const n = norm(s);
  // WON
  if (n === "won" || n.includes("converted") || n.includes("closed")) return LeadStatus.WON;
  // BOOKING_DONE — token/booking signals
  if (n.includes("bookingdone") || n.includes("booked") || n.includes("tokenpaid") ||
      n.includes("dealclosed") || n.includes("dealdone") || n.includes("booking"))
    return LeadStatus.BOOKING_DONE;
  // EOI / Letter of Intent
  if (n === "eoi" || n.includes("letterofintent") || n === "loi" || n.includes("eoisubmit"))
    return LeadStatus.EOI;
  // NEGOTIATION
  if (n.includes("negotiat") || n.includes("offerstage") || n.includes("indiscussion"))
    return LeadStatus.NEGOTIATION;
  // SITE_VISIT — any visit variant
  if (n.includes("sitevisit") || n.includes("visitschedul") || n.includes("visitdone") ||
      n.includes("visited") || n.includes("postvisit") || n.includes("propertytour") ||
      n.includes("onspotmeeting") || n.includes("onspot"))
    return LeadStatus.SITE_VISIT;
  // QUALIFIED — confirmed interest
  if (n.includes("qualif") || n.includes("interested") || n.includes("meetingdone") ||
      n.includes("presentationdone") || n.includes("proposalsent"))
    return LeadStatus.QUALIFIED;
  // LOST — junk / dead / reject
  if (n === "junk" || n === "spam" || n === "fake" || n === "test" || n === "duplicate" ||
      n.includes("notinterest") || n.includes("wrongnumber") || n.includes("wrongno") ||
      n.includes("invalidnumber") || n.includes("donotcall") || n === "dnc" ||
      n.includes("blacklist") || n === "lost" || n.includes("dropped") ||
      n.includes("reject") || n.includes("cancel") || n.includes("stale") ||
      n === "dead" || n.includes("languagebarrier"))
    return LeadStatus.LOST;
  // CONTACTED — reached / follow-up
  if (n.includes("contact") || n.includes("followup") || n.includes("followed") ||
      n.includes("reached") || n.includes("callback") || n.includes("callbac"))
    return LeadStatus.CONTACTED;
  // NEW — uncontacted / fresh
  if (n === "new" || n.includes("freshlead") || n.includes("notcontact") ||
      n === "pending" || n === "fresh" || n === "uncontact")
    return LeadStatus.NEW;
  return LeadStatus.NEW;
}
function parsePotential(s?: string): Potential | undefined {
  if (!s) return;
  const n = s.trim().toLowerCase();
  if (n === "hot")  return Potential.HIGH;
  if (n === "warm") return Potential.MEDIUM;
  if (n === "cold") return Potential.LOW;
  // Legacy / non-standard sheet values
  if (n.startsWith("h") || n.includes("hot") || n.includes("high")) return Potential.HIGH;
  if (n.startsWith("m") || n.includes("warm") || n.includes("medium")) return Potential.MEDIUM;
  if (n.startsWith("l") || n.includes("cold") || n.includes("low") || n.includes("future")) return Potential.LOW;
  return Potential.UNKNOWN;
}
function parseFund(s?: string): FundReadiness | undefined {
  if (!s) return;
  const n = s.trim().toLowerCase().replace(/[-\s]+/g, "");
  // Direct MIS label matches (priority — exact sheet values)
  if (n === "immediatebuyer" || n.includes("immediatebuyer")) return FundReadiness.IMMEDIATE_BUYER;
  if (n === "shorttermbuyer" || n.includes("shortterm"))       return FundReadiness.SHORT_TERM_BUYER;
  if (n === "conditionalbuyer" || n.includes("conditional"))   return FundReadiness.CONDITIONAL_BUYER;
  if (n === "financedbuyer" || n.includes("financed"))         return FundReadiness.FINANCED_BUYER;
  if (n === "futurebuyer" || n.includes("futurebuyer") || n === "future") return FundReadiness.FUTURE_BUYER;
  // Legacy values — keep backward compat
  if (n.includes("cash"))       return FundReadiness.CASH_READY;
  if (n.includes("approved") || n.includes("bank")) return FundReadiness.BANK_APPROVED;
  if (n.includes("financ") || n.includes("loan") || n.includes("mortgage")) return FundReadiness.FINANCING_NEEDED;
  return FundReadiness.NOT_DISCUSSED;
}
function parseMood(s?: string): MoodStatus | undefined {
  if (!s) return; const n = norm(s);
  if (n.includes("excit")) return MoodStatus.EXCITED;
  if (n.includes("interest") || n.includes("highly responsive")) return MoodStatus.INTERESTED;
  if (n.includes("neutral")) return MoodStatus.NEUTRAL;
  if (n.includes("hesit") || n.includes("irregular")) return MoodStatus.HESITANT;
  if (n.includes("cold") || n.includes("no response")) return MoodStatus.COLD;
  if (n.includes("confus")) return MoodStatus.CONFUSED;
  if (n.includes("angry") || n.includes("upset")) return MoodStatus.ANGRY;
}
function parseInvestTimeline(s?: string): InvestTimeline | undefined {
  if (!s) return;
  const n = s.trim().toLowerCase().replace(/[-\s]+/g, "");
  // Exact Dubai MIS values (priority)
  if (n === "onspotmeeting" || n.includes("onspot"))            return InvestTimeline.IMMEDIATE;
  if (n === "withinamonth" || n === "withinmonth" || n.includes("withinmonth")) return InvestTimeline.THIRTY_DAYS;
  if (n === "willgodubaifirst" || n.includes("willgodubai") || n.includes("godubaifirst")) return InvestTimeline.THREE_MONTHS;
  if (n === "notin6month" || n.includes("notin6") || n.includes("not6month"))    return InvestTimeline.SIX_PLUS_MONTHS;
  if (n === "notsure" || n.includes("notsure"))                 return InvestTimeline.UNKNOWN;
  // Generic patterns
  if (n.includes("immed") || n.includes("week") || n.includes("now")) return InvestTimeline.IMMEDIATE;
  if (n.includes("3month") || n.includes("quarter") || n.includes("notsure")) return InvestTimeline.THREE_MONTHS;
  if (n.includes("6") || n.includes("year") || n.includes("longterm")) return InvestTimeline.SIX_PLUS_MONTHS;
  if (n.includes("30") || n.includes("month")) return InvestTimeline.THIRTY_DAYS;
  if (n.includes("brows") || n.includes("explor") || n.includes("shop")) return InvestTimeline.WINDOW_SHOPPING;
  return InvestTimeline.UNKNOWN;
}
function parseDate(s?: string): Date | undefined {
  if (!s) return;
  // Excel serial numbers (e.g. 45752 = 4 May 2025)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    if (n > 1 && n < 100000) {
      // Excel epoch: Dec 30 1899
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d;
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

// Detect if a row looks like a header row (has at least 3 of the expected column names)
function looksLikeHeader(row: string[]): boolean {
  const flat = row.map((c) => norm(String(c ?? "")));
  const expected = ["customer", "mobile", "phone", "name", "email", "source", "stage", "remarks", "project", "budget"];
  return expected.filter((e) => flat.some((c) => c === e || c.startsWith(e))).length >= 3;
}

// Parse Excel buffer → array of row objects (first useful sheet, auto-detect header)
function parseExcel(buf: ArrayBuffer): { rows: Row[]; sheetName: string; detectedHeaderRow: number; allSheets: string[] } | { error: string } {
  let wb: XLSX.WorkBook;
  try { wb = XLSX.read(buf, { type: "array", cellDates: true }); }
  catch (e) { return { error: `Could not read Excel file: ${String(e).slice(0, 100)}` }; }

  // Try each sheet — pick the first one that yields a header row + data rows
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const grid = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "", blankrows: false, raw: false }) as string[][];
    if (grid.length < 2) continue;

    // Find header row within first 5 rows
    let headerRow = -1;
    for (let i = 0; i < Math.min(5, grid.length); i++) {
      if (looksLikeHeader(grid[i])) { headerRow = i; break; }
    }
    if (headerRow === -1) continue;

    const headers = grid[headerRow].map((h) => String(h ?? "").trim());
    const dataRows = grid.slice(headerRow + 1);
    const rows: Row[] = dataRows
      .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
      .map((r) => {
        const obj: Row = {};
        headers.forEach((h, i) => { if (h) obj[h] = String(r[i] ?? "").trim(); });
        return obj;
      });
    if (rows.length > 0) return { rows, sheetName, detectedHeaderRow: headerRow, allSheets: wb.SheetNames };
  }
  return { error: `No data sheet found. Sheets present: ${wb.SheetNames.join(", ")}. Make sure your data has columns like Customer/Mobile/Email in the first 5 rows.` };
}

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const url = new URL(req.url);
  // preview=1 → dry-run only. Parse + check duplicates but write NOTHING.
  const isDryRun = url.searchParams.get("preview") === "1";
  const fd = await req.formData();
  const file = fd.get("file");
  const campaign = (fd.get("campaign")?.toString() ?? "").trim() || undefined;
  // leadOrigin — controls which CRM section the imported leads appear in.
  // "ACTIVE"    → main Leads page (default for standard imports)
  // "COLD"      → Revival Engine only (cold-data batches)
  // "PORTFOLIO" → historical purchase records
  // "SYSTEM"    → reserved for system-generated records
  const rawLeadOrigin = (fd.get("leadOrigin")?.toString() ?? "").trim();
  const importType: string =
    rawLeadOrigin === "ACTIVE" || rawLeadOrigin === "COLD" || rawLeadOrigin === "PORTFOLIO" || rawLeadOrigin === "SYSTEM"
      ? rawLeadOrigin
      : "COLD";
  // When the admin imports through /cold-calls "Import cold data", isColdCall=true
  // is set as a form field. Every newly created lead gets isColdCall=true + left
  // unassigned (ownerId=null) so admin can bulk-assign afterwards.
  const importAsColdData = String(fd.get("isColdCall") ?? "") === "true";
  // When admin imports an agent's existing-client MIS (e.g. "Mehak MIS.xlsx"),
  // pre-assign every row to that agent. Source treated as CSV_IMPORT, status
  // bumped to CONTACTED (these aren't fresh leads). NEVER round-robin's them.
  const assignToUserId = String(fd.get("assignToUserId") ?? "").trim() || null;
  // Force-team-override — admin picks "Dubai" or "India" in the upload UI so the
  // entire import goes into one bucket. Without this, mixed sheets land split
  // between teams (a row mentioning "Dubai Marina" went to Dubai, the next row
  // mentioning "Gurgaon" went to India — same sheet, two buckets). Now: if admin
  // picked a team, every row in this import respects that choice.
  const forceTeamRaw = String(fd.get("forceTeam") ?? "").trim();
  const forceTeam = forceTeamRaw === "Dubai" || forceTeamRaw === "India" ? forceTeamRaw : null;
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "File is empty (0 bytes)" }, { status: 400 });

  const fileName = file.name.toLowerCase();
  const isExcel = fileName.endsWith(".xlsx") || fileName.endsWith(".xlsm") || fileName.endsWith(".xls") || file.type.includes("spreadsheet");

  // Parse rows
  let rows: Row[] = [];
  let parseInfo: { sheetName?: string; detectedHeaderRow?: number; allSheets?: string[] } = {};
  if (isExcel) {
    const buf = await file.arrayBuffer();
    const r = parseExcel(buf);
    if ("error" in r) return NextResponse.json({ error: r.error, hint: "Try saving as CSV (File → Save As → .csv) if Excel import keeps failing." }, { status: 422 });
    rows = r.rows;
    parseInfo = { sheetName: r.sheetName, detectedHeaderRow: r.detectedHeaderRow, allSheets: r.allSheets };
  } else {
    const text = await file.text();
    const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
    if (parsed.errors.length > 5) {
      return NextResponse.json({ error: "CSV parse errors", details: parsed.errors.slice(0, 5) }, { status: 422 });
    }
    rows = parsed.data;
  }

  if (rows.length === 0) {
    return NextResponse.json({
      error: "Found 0 data rows. Check that your file has header row + data rows.",
      hint: isExcel ? `Detected sheet: ${parseInfo.sheetName}. Other sheets: ${parseInfo.allSheets?.join(", ")}` : "Verify CSV has a header row matching Customer/Mobile/Email column names.",
    }, { status: 422 });
  }

  const detectedColumns = Object.keys(rows[0] ?? {});

  // ── PREVIEW / DRY-RUN ──────────────────────────────────────────────────────
  // preview=1: scan rows, check for duplicates and missing fields, return a
  // summary of what WOULD happen — without writing a single row. The importer
  // shows this to the admin who then confirms or cancels.
  if (isDryRun) {
    let newRows = 0, dupRows = 0, missingName = 0, missingPhone = 0, missingProject = 0;
    const dupSamples: { name: string; phone: string; existingStatus: string }[] = [];
    const unknownStatuses = new Set<string>();

    for (const row of rows) {
      const nameRaw = pick(row, "customer", "name", "fullname", "leadname", "customername");
      const phoneRaw = pick(row, "mobile", "phone", "contact", "phonenumber", "whatsapp");
      const email = pick(row, "email", "emailid", "mail");
      if (!nameRaw && !phoneRaw && !email) continue;
      if (!nameRaw) missingName++;
      if (!phoneRaw) missingPhone++;
      if (!pick(row, "project")) missingProject++;

      const callStatus = pick(row, "status", "callstatus");
      if (callStatus) unknownStatuses.add(callStatus);

      if (phoneRaw) {
        const phones = splitPhones(phoneRaw, "+91");
        const phone = phones[0];
        if (phone) {
          const fp = normalizePhone(phone);
          if (fp) {
            // Preview dedupe count must match the real import: only ACTIVE leads
            // count as duplicates. Soft-deleted leads are re-created on re-import.
            const existing = await prisma.lead.findFirst({
              where: { fingerprint: { startsWith: fp }, deletedAt: null },
              select: { name: true, phone: true, currentStatus: true },
            });
            if (existing) {
              dupRows++;
              if (dupSamples.length < 8) {
                dupSamples.push({
                  name: nameRaw ?? "—",
                  phone: phoneRaw,
                  existingStatus: existing.currentStatus ?? existing.name,
                });
              }
            } else {
              newRows++;
            }
          } else { newRows++; }
        } else { newRows++; }
      } else { newRows++; }
    }

    return NextResponse.json({
      preview: true,
      totalRows: rows.length,
      newRows, dupRows,
      missingName, missingPhone, missingProject,
      dupSamples,
      uniqueStatuses: [...unknownStatuses].slice(0, 20),
      detectedColumns,
      fileType: isExcel ? "Excel" : "CSV",
      sheetName: parseInfo.sheetName,
      allSheets: parseInfo.allSheets,
      // Automation safety status
      automationNote: "All automation is OFF by default during import (Import Safe Mode). No WhatsApp, emails, round-robin, or SLA alerts will fire.",
    });
  }

  let created = 0, deduped = 0, enriched = 0, autofilled = 0;
  // Imports no longer create CallLog rows from remarks — always 0 now, kept so
  // the import-audit meta shape stays stable.
  const callLogsCreated = 0;
  const errors: string[] = [];

  // ── Import History: create a batch row up-front so every NEW lead created
  // below can be stamped with its id (Lead.importBatchId). Counts are finalized
  // after the loop. Admins can later soft-delete / roll back the whole batch
  // from the Import History screen, returning the CRM to its pre-import state.
  const importBatch = await prisma.importBatch.create({
    data: {
      fileName: file.name,
      fileSize: file.size,
      sheetName: parseInfo.sheetName ?? null,
      importType,
      team: forceTeam,
      totalRows: rows.length,
      importedById: me.id,
    },
  });


  // Load all known project names once — used by remark autofill to spot
  // project mentions in free-text ("interested in Azizi Venice" → sourceDetail).
  const knownProjects = (await prisma.project.findMany({ select: { name: true } })).map((p) => p.name);

  // NOTE: imported remark cells are no longer parsed into per-entry CallLog
  // rows, so there's no "sheet owner" fallback to attribute unnamed entries to.
  // The raw remark text is kept on Lead.remarks and surfaced as read-only
  // Historical Notes. assignToUserId still assigns the imported LEAD below.

  for (const [i, row] of rows.entries()) {
    _consumedKeys = new Set();   // reset mapped-header tracking for this row
    const nameRaw = pick(row, "customer", "name", "fullname", "leadname", "customername");
    const phoneRaw = pick(row, "mobile", "phone", "contact", "phonenumber", "whatsapp");
    const altPhoneRaw = pick(row, "altnumber", "altphone", "alternatephone", "alternatenumber", "phone2", "secondarynumber", "secondaryphone");
    const email = pick(row, "email", "emailid", "mail");
    if (!nameRaw && !phoneRaw && !email) continue;

    // Split the customer cell — MIS rows like "Soumya, Ayush Gupta" with two phone
    // numbers represent a joint inquiry (family/friend buying together). One lead,
    // both names. First name → name, rest → altName.
    const nameParts = (nameRaw ?? "").split(/[,;|]+|\s+(?:and|&)\s+/i)
      .map((s) => s.trim()).filter(Boolean);
    const name = nameParts[0] ?? "";
    const altName = nameParts.slice(1).join(" & ") || undefined;

    // Split the primary phone cell — "+919146449146, 7779990838" → first to phone,
    // second to altPhone. Without splitting, both get concatenated into one
    // 22-digit fake number.
    // Fallback country: India for now (most affected sheets). If we later need
    // per-team defaults this can read from the row's `forwardedTeam` / source.
    const phones = splitPhones(phoneRaw, "+91");
    const altPhones = splitPhones(altPhoneRaw, "+91");
    const phone = phones[0];
    // Pick the next available phone for altPhone: rest of primary cell, then
    // any from the Alt-Number column. Cap at one for now.
    const altPhone = phones[1] ?? altPhones.find((p) => p !== phone);

    // Budget: parse with the shared currency-aware parser. interpretBudget keeps
    // the verbatim text (budgetRaw), splits ranges ("10-12 Cr" → 10cr..12cr with
    // unit inheritance), and never strips Cr/Lakh. Currency is resolved later
    // (after team routing) by strict priority — see the budget block below.
    const budgetInfo = interpretBudget(
      pick(row, "budgetaed", "budget", "budgetmin", "minbudget"),
      pick(row, "budgetmax", "maxbudget"),
    );
    try {
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: pick(row, "city", "location", "address"),
        configuration: pick(row, "configuration", "config", "bhk", "type"),
        budgetMin: budgetInfo.min ?? undefined,
        budgetMax: budgetInfo.max ?? undefined,
        notesShort: pick(row, "message", "requirement", "todo"),
        tags: pick(row, "tags", "tag"),
        source: parseSource(pick(row, "source")),
        sourceDetail: campaign,
      });
      if (r.deduped) deduped++; else created++;

      const update: Record<string, unknown> = {};
      // Stamp the import origin on every new row — drives Leads vs Revival Engine separation.
      // Phase D: ALL bulk imports land in MASTER_DATA (untriaged repository).
      // Admin then bulk Moves to Leads / Revival. No record auto-enters the
      // active pipeline. (The batch's importType metadata still records the
      // admin's intent for reference.)
      if (!r.deduped) update.leadOrigin = "MASTER_DATA";
      // Stamp the import batch on every NEW row so the whole import can be
      // rolled back / soft-deleted later. Deduped (updated) rows are NOT
      // stamped — they pre-existed and must survive a batch rollback.
      if (!r.deduped) update.importBatchId = importBatch.id;
      if (altPhone) update.altPhone = altPhone;
      if (altName) update.altName = altName;
      const company = pick(row, "company"); if (company) update.company = company;
      const address = pick(row, "address"); if (address) update.address = address;
      const whoIsClient = pick(row, "whoisclient", "client", "clientinfo", "about");
      if (whoIsClient) update.whoIsClient = whoIsClient;
      const project = pick(row, "project");
      if (project) update.sourceDetail = update.sourceDetail ?? project;
      const categorization = pick(row, "categorization", "category");
      if (categorization) update.categorization = categorization;
      const stage = pick(row, "stage");
      const callStatus = pick(row, "status", "callstatus");
      // Preserve the raw sheet value so agents can see original vs mapped stage
      const rawStatus = callStatus || stage;
      if (rawStatus) update.originalSheetStatus = rawStatus;
      if (stage) update.status = mapSheetStatus(stage);
      else if (callStatus) update.status = mapSheetStatus(callStatus);
      // Canonicalize casing so imports never reintroduce variants like
      // "Never Respond Phone calls" that would leak past the exact-match
      // terminal/workable classification.
      if (callStatus) update.currentStatus = canonicalStatus(callStatus);
      const followup = parseDate(pick(row, "followupdate", "followup", "nextfollowup"));
      if (followup) update.followupDate = followup;
      const meeting = parseDate(pick(row, "meeting", "meetingdate"));
      if (meeting) update.meetingDate = meeting;
      const sv = parseDate(pick(row, "sitevisit", "sitevisitdate"));
      if (sv) update.siteVisitDate = sv;
      const detailShared = pick(row, "detailshared", "shared");
      if (detailShared) update.detailShared = detailShared;
      const todo = pick(row, "todo", "todonext", "nextaction");
      if (todo) update.todoNext = todo;
      const potential = parsePotential(pick(row, "potential"));
      if (potential && !r.deduped) update.potential = potential;
      const fund = parseFund(pick(row, "fundreadiness", "fund", "funds"));
      if (fund && !r.deduped) update.fundReadiness = fund;
      const mood = parseMood(pick(row, "moodstatus", "mood"));
      if (mood) update.moodStatus = mood;
      const when = parseInvestTimeline(pick(row, "whencaninvest", "timeline", "invest", "whencaninvest"));
      if (when && !r.deduped) update.whenCanInvest = when;
      // Team: admin-picked override wins over per-row column. Lalit's testing
      // sheets had rows split across India + Dubai despite all being one team's
      // pipeline — forceTeam fixes that at import time.
      // Always run through resolveTeam so routing provenance columns are set.
      {
        const rowTeamRaw = forceTeam ?? pick(row, "forwardedteam", "team") ?? null;
        const teamResult = resolveTeam({
          forceTeam: rowTeamRaw,
          forceMethod: "import",
          sourceDetail: (update.sourceDetail as string | undefined) ?? undefined,
          projectSlug: pick(row, "project"),
          text: pick(row, "remarks", "remark"),
        });
        if (teamResult.team) {
          update.forwardedTeam = teamResult.team;
          const rf = routingFieldsFor(teamResult);
          update.routingMethod = rf.routingMethod;
          update.routingSource = rf.routingSource;
          update.routingReason = rf.routingReason;
          // Currency follows team automatically (AED for Dubai, INR for India)
          if (!update.budgetCurrency) update.budgetCurrency = teamResult.team === "Dubai" ? "AED" : "INR";
        }
      }
      // AI score from the MIS "Categorization" / "Status" column — sheet writes win
      // over the AI rule-engine. "Highly Responsive – picks calls regularly" → HOT,
      // "Cold / not picking" → COLD, etc.
      const categoColumn = pick(row, "categorization", "category");
      const callStatusColumn = pick(row, "status", "callstatus");
      const aiFromSheet = aiScoreFromCategorization(categoColumn) ?? aiScoreFromCategorization(callStatusColumn);
      if (aiFromSheet) {
        update.aiScore = aiFromSheet.score;
        update.aiScoreValue = aiFromSheet.value;
        update.aiSummary = `From sheet "Categorization": ${categoColumn ?? callStatusColumn}`;
        update.aiUpdatedAt = new Date();
      }
      const remarks = pick(row, "remarks", "remark");
      if (remarks) update.remarks = remarks;
      // Historic lead date — every MIS sheet's first column is "Date" (the day
      // the lead actually came in). Without this override every imported row
      // gets today's createdAt, which destroys the historic timeline + breaks
      // every "leads created this week" report retroactively. Lalit explicitly
      // asked for "Date in mis will be date when this lead was generated".
      const historicDate = parseDate(pick(row, "date", "leaddate", "createdon", "createddate", "entrydate"));
      if (historicDate && !r.deduped) {
        update.createdAt = historicDate;
        // also backdate lastTouchedAt so "idle 24h" flags don't fire on import day
        update.lastTouchedAt = historicDate;
      }
      // Item 6 — "worked today" follow-up suppression (import-time decision only).
      // If the sheet shows the lead was contacted TODAY (a last-contact column =
      // the import date) and its follow-up is today-or-earlier, it was already
      // worked today — clear the due date so it does NOT appear in Today's Pending
      // / Overdue / Missed. It re-enters the queue when the agent next schedules a
      // follow-up. Historical imports (last-contact in the past) and future
      // follow-ups are left untouched, so genuinely-overdue leads still surface.
      const lastContact = parseDate(pick(row, "lastcontact", "lastcontactdate", "lastcalldate", "lastcall", "calleddate", "lastcontacted"));
      if (!r.deduped && lastContact && update.followupDate instanceof Date) {
        const istDayKey = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
        const todayKey = istDayKey(new Date());
        if (istDayKey(lastContact) === todayKey && istDayKey(update.followupDate) <= todayKey) {
          update.followupDate = null;          // not a real pending task — worked today
          update.lastTouchedAt = new Date();   // reflect "worked now"
        }
      }
      // Cold-data specific columns — what they already own + via whom
      const alreadyBought = pick(row, "alreadybought", "alreadyowns", "owns", "purchased");
      if (alreadyBought) update.alreadyBought = alreadyBought;
      const alreadyBoughtBy = pick(row, "alreadyboughtby", "boughtvia", "via", "broker", "boughtfrom");
      if (alreadyBoughtBy) update.alreadyBoughtBy = alreadyBoughtBy;
      // When importing a cold-data batch: flag every new row + leave ownerId null
      if (importAsColdData && !r.deduped) {
        update.isColdCall = true;
        update.ownerId = null;
      }
      // Pre-assigned import (Mehak MIS, etc.) — every NEW row goes to picked agent
      // and is NOT cold (these are already the agent's existing clients).
      if (assignToUserId && !r.deduped) {
        update.ownerId = assignToUserId;
        update.assignedAt = new Date();
        update.isColdCall = false;
        // Phase D: even pre-assigned imports land in MASTER_DATA first (intended
        // owner is recorded, but admin must Move-to-Leads to activate). Keeps the
        // "all imports land in Master Data; no auto-movement" rule intact.
        update.leadOrigin = "MASTER_DATA";
        // Bump status from NEW to CONTACTED — they're existing relationships
        update.status = "CONTACTED";
      }
      // ── Budget: verbatim raw + market-resolved currency (strict priority) ──
      // budgetRaw preserves EXACTLY what the sheet had ("10 Cr", "4 Cr - 5 Cr").
      // Currency priority: explicit col/symbol → country → project/developer →
      // sheet name → team → UNKNOWN (never guessed). On dedupe, only a row that
      // actually carries a budget updates these — a blank never wipes an existing
      // value (latest-sheet-wins, merge-safe).
      if (budgetInfo.raw) {
        const budgetHeader = Object.keys(row).find((k) => /budget/i.test(k)) ?? "";
        const headerHint = /aed|dhs/i.test(budgetHeader) ? "AED"
          : /inr|₹|rs/i.test(budgetHeader) ? "INR" : null;
        // Explicit signal: a dedicated Currency column, else a currency token
        // embedded in the budget text ("AED 800K", "₹4 Cr"), else a header hint.
        // Use ONLY "currency" — "budgetcurrency" fuzzy-matches the plain "Budget"
        // column ("budgetcurrency".startsWith("budget")) and would read the amount.
        const rawCcyHint = budgetInfo.raw && /(?:aed|dhs|inr|rupee|rs\b|₹)/i.test(budgetInfo.raw) ? budgetInfo.raw : undefined;
        const ccy = resolveBudgetCurrency({
          explicit: pick(row, "currency") ?? rawCcyHint ?? headerHint,
          country: pick(row, "country") ?? inferCountryFromCity(pick(row, "city", "location")),
          projectName: pick(row, "project") ?? (update.sourceDetail as string | undefined),
          sheetName: importBatch.fileName,
          team: (update.forwardedTeam as string | undefined) ?? forceTeam ?? pick(row, "forwardedteam", "team"),
        });
        update.budgetRaw = budgetInfo.raw;
        if (budgetInfo.min != null) update.budgetMin = budgetInfo.min;
        if (budgetInfo.max != null) update.budgetMax = budgetInfo.max;
        update.budgetCurrency = ccy;
      }
      // Preserve EVERY unmapped Excel column verbatim (original header → value) in
      // customFields, so no sheet data is silently dropped. On a dedupe, merge with
      // any prior import's custom fields so earlier columns survive.
      const cf: Record<string, string> = {};
      for (const k of Object.keys(row)) {
        if (_consumedKeys.has(k)) continue;
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
      if (Object.keys(update).length > 0) {
        await prisma.lead.update({ where: { id: r.lead.id }, data: update });
        enriched++;
      }

      // Auto-fill structured fields from remarks (only for brand-new rows, only
      // for empty fields — never overwrites what the sheet explicitly set).
      if (remarks && !r.deduped) {
        const suggestions = extractFromRemarks(remarks, knownProjects);
        // Build the "existing" snapshot AFTER all the explicit column writes above
        const existing = {
          budgetMin: (update.budgetMin ?? r.lead.budgetMin) as number | null,
          budgetMax: (update.budgetMax ?? r.lead.budgetMax) as number | null,
          budgetCurrency: (update.budgetCurrency ?? r.lead.budgetCurrency) as string | null,
          configuration: (update.configuration ?? r.lead.configuration) as string | null,
          city: (update.city ?? r.lead.city) as string | null,
          potential: (update.potential ?? r.lead.potential) as Potential | null,
          fundReadiness: (update.fundReadiness ?? r.lead.fundReadiness) as FundReadiness | null,
          whenCanInvest: (update.whenCanInvest ?? r.lead.whenCanInvest) as InvestTimeline | null,
          company: (update.company ?? r.lead.company) as string | null,
          sourceDetail: (update.sourceDetail ?? r.lead.sourceDetail) as string | null,
          forwardedTeam: (update.forwardedTeam ?? r.lead.forwardedTeam) as string | null,
        };
        const toApply = mergeSuggestions(existing as never, suggestions, false);
        if (Object.keys(toApply).length > 0) {
          await prisma.lead.update({ where: { id: r.lead.id }, data: toApply as never });
          autofilled++;
        }
      }

      // Imported remark cells are intentionally NOT turned into CallLog rows.
      // Doing so manufactured fake "calls" — inventing an agent name from the
      // text and defaulting the outcome to CONNECTED — which polluted every
      // call statistic (connected / no-answer / last-outcome / talk-time /
      // best-time) and surfaced words like "Expressway Gurgaon Tanuj" as the
      // caller. The full remark text is preserved on Lead.remarks (set above)
      // and rendered as read-only "Historical Note" entries in the conversation
      // stream via extractUndatedSegments(). Only real agent-logged calls
      // (Log-Call UI / Acefone webhook) create CallLog rows now.
      // (callLogsCreated stays 0 — accurate; kept for the import audit shape.)
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e).slice(0, 200)}`);
    }
  }

  // Finalize the import batch with the real counts (drives the Import History
  // row + rollback warnings). Skipped = rows that matched nothing usable.
  const skippedCount = Math.max(0, rows.length - created - deduped - errors.length);
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

  await audit({
    userId: me.id,
    action: "import.csv",
    entity: "Lead",
    meta: {
      fileName: file.name,
      fileSize: file.size,
      rowsProcessed: rows.length,
      created,
      deduped,
      enriched,
      callLogsCreated,
      errors: errors.slice(0, 5),
      sheetName: parseInfo.sheetName ?? null,
      campaign: campaign ?? null,
      importType,
      assignToUserId: assignToUserId ?? null,
      forceTeam: forceTeam ?? null,
    },
    request: reqMeta(req),
  }).catch(() => {}); // non-fatal

  return NextResponse.json({
    ok: true,
    fileType: isExcel ? "Excel" : "CSV",
    sheetName: parseInfo.sheetName,
    detectedHeaderRow: parseInfo.detectedHeaderRow,
    allSheets: parseInfo.allSheets,
    rowsProcessed: rows.length,
    created, deduped, enriched, callLogsCreated, autofilled,
    importBatchId: importBatch.id,
    detectedColumns,
    errors: errors.slice(0, 10),
  });
}
