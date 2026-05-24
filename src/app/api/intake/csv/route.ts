import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, LeadStatus, CallDirection } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseRemarks } from "@/lib/remarkParser";

type Row = Record<string, string>;

function norm(s: string): string { return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); }
function pick(row: Row, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}
function parseBudget(s?: string): number | undefined {
  if (!s) return;
  const cleaned = s.replace(/[^\d.kKmM]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return;
  if (/m/i.test(cleaned)) return num * 1_000_000;
  if (/k/i.test(cleaned)) return num * 1_000;
  return num < 1000 ? num * 1_000_000 : num;
}
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
function parseStage(s?: string): LeadStatus {
  if (!s) return LeadStatus.NEW;
  const n = norm(s);
  if (n.includes("contact")) return LeadStatus.CONTACTED;
  if (n.includes("qualif")) return LeadStatus.QUALIFIED;
  if (n.includes("visit")) return LeadStatus.SITE_VISIT;
  if (n.includes("negotiat")) return LeadStatus.NEGOTIATION;
  if (n.includes("book")) return LeadStatus.BOOKING_DONE;
  if (n.includes("won")) return LeadStatus.WON;
  if (n.includes("lost") || n.includes("dropped") || n.includes("reject")) return LeadStatus.LOST;
  return LeadStatus.NEW;
}
function parsePotential(s?: string): Potential | undefined {
  if (!s) return; const n = norm(s);
  if (n.startsWith("h") || n.includes("hot")) return Potential.HIGH;
  if (n.startsWith("m") || n.includes("warm")) return Potential.MEDIUM;
  if (n.startsWith("l") || n.includes("cold") || n.includes("future")) return Potential.LOW;
  return Potential.UNKNOWN;
}
function parseFund(s?: string): FundReadiness | undefined {
  if (!s) return; const n = norm(s);
  if (n.includes("cash")) return FundReadiness.CASH_READY;
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
  if (!s) return; const n = norm(s);
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
  const fd = await req.formData();
  const file = fd.get("file");
  const campaign = (fd.get("campaign")?.toString() ?? "").trim() || undefined;
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

  let created = 0, deduped = 0, enriched = 0, callLogsCreated = 0;
  const errors: string[] = [];
  const detectedColumns = Object.keys(rows[0] ?? {});

  for (const [i, row] of rows.entries()) {
    const name = pick(row, "customer", "name", "fullname", "leadname", "customername");
    const phone = pick(row, "mobile", "phone", "contact", "phonenumber", "whatsapp");
    const email = pick(row, "email", "emailid", "mail");
    if (!name && !phone && !email) continue;

    try {
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: pick(row, "city", "location", "address"),
        configuration: pick(row, "configuration", "config", "bhk", "type"),
        budgetMin: parseBudget(pick(row, "budgetaed", "budget", "budgetmin", "minbudget")),
        budgetMax: parseBudget(pick(row, "budgetmax", "maxbudget")),
        notesShort: pick(row, "message", "requirement", "todo"),
        tags: pick(row, "tags", "tag"),
        source: parseSource(pick(row, "source")),
        sourceDetail: campaign,
      });
      if (r.deduped) deduped++; else created++;

      const update: Record<string, unknown> = {};
      const company = pick(row, "company"); if (company) update.company = company;
      const address = pick(row, "address"); if (address) update.address = address;
      const whoIsClient = pick(row, "whoisclient", "client", "clientinfo", "about");
      if (whoIsClient) update.whoIsClient = whoIsClient;
      const project = pick(row, "project");
      if (project) update.sourceDetail = update.sourceDetail ?? project;
      const categorization = pick(row, "categorization", "category");
      if (categorization) update.categorization = categorization;
      const stage = pick(row, "stage");
      if (stage) update.status = parseStage(stage);
      const callStatus = pick(row, "status", "callstatus");
      if (callStatus) update.currentStatus = callStatus;
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
      if (potential) update.potential = potential;
      const fund = parseFund(pick(row, "fundreadiness", "fund", "funds"));
      if (fund) update.fundReadiness = fund;
      const mood = parseMood(pick(row, "moodstatus", "mood"));
      if (mood) update.moodStatus = mood;
      const when = parseInvestTimeline(pick(row, "whencaninvest", "timeline", "invest"));
      if (when) update.whenCanInvest = when;
      const team = pick(row, "forwardedteam", "team");
      if (team) update.forwardedTeam = team;
      const remarks = pick(row, "remarks", "remark");
      if (remarks) update.remarks = remarks;
      const explicitCcy = pick(row, "currency", "budgetcurrency");
      if (explicitCcy) {
        const c = explicitCcy.toUpperCase();
        if (c === "AED" || c === "INR") update.budgetCurrency = c;
      } else {
        const budgetHeader = Object.keys(row).find((k) => /budget/i.test(k));
        if (budgetHeader) {
          if (/aed/i.test(budgetHeader)) update.budgetCurrency = "AED";
          else if (/inr|₹|rs/i.test(budgetHeader)) update.budgetCurrency = "INR";
        }
      }
      if (Object.keys(update).length > 0) {
        await prisma.lead.update({ where: { id: r.lead.id }, data: update });
        enriched++;
      }

      // PARSE multi-line remarks into per-date CallLog rows
      if (remarks && !r.deduped) {
        const parsed = parseRemarks(remarks);
        for (const p of parsed) {
          await prisma.callLog.create({
            data: {
              leadId: r.lead.id,
              userId: me.id, // attribute to the importer (Lalit)
              direction: CallDirection.OUTBOUND,
              phoneNumber: phone ?? "(imported)",
              outcome: p.outcome,
              notes: `${p.agentName}: ${p.text}`,
              startedAt: p.when,
            },
          });
          callLogsCreated++;
        }
      }
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e).slice(0, 200)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    fileType: isExcel ? "Excel" : "CSV",
    sheetName: parseInfo.sheetName,
    detectedHeaderRow: parseInfo.detectedHeaderRow,
    allSheets: parseInfo.allSheets,
    rowsProcessed: rows.length,
    created, deduped, enriched, callLogsCreated,
    detectedColumns,
    errors: errors.slice(0, 10),
  });
}
