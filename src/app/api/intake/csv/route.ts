import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, LeadStatus, CallDirection, AIScore } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseRemarks } from "@/lib/remarkParser";
import { extractFromRemarks, mergeSuggestions } from "@/lib/remarkAutofill";
import { splitPhones } from "@/lib/phone";

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

  let created = 0, deduped = 0, enriched = 0, callLogsCreated = 0, autofilled = 0;
  const errors: string[] = [];
  const detectedColumns = Object.keys(rows[0] ?? {});

  // Load all known project names once — used by remark autofill to spot
  // project mentions in free-text ("interested in Azizi Venice" → sourceDetail).
  const knownProjects = (await prisma.project.findMany({ select: { name: true } })).map((p) => p.name);

  for (const [i, row] of rows.entries()) {
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
      // Team: admin-picked override wins over per-row column. Lalit's testing
      // sheets had rows split across India + Dubai despite all being one team's
      // pipeline — forceTeam fixes that at import time.
      if (forceTeam) {
        update.forwardedTeam = forceTeam;
        // Currency follows team automatically (AED for Dubai, INR for India)
        if (!update.budgetCurrency) update.budgetCurrency = forceTeam === "Dubai" ? "AED" : "INR";
      } else {
        const team = pick(row, "forwardedteam", "team");
        if (team) update.forwardedTeam = team;
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
        // Bump status from NEW to CONTACTED — they're existing relationships
        update.status = "CONTACTED";
      }
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

      // PARSE multi-line remarks into per-date CallLog rows
      if (remarks && !r.deduped) {
        const parsed = parseRemarks(remarks);
        for (const p of parsed) {
          await prisma.callLog.create({
            data: {
              leadId: r.lead.id,
              userId: me.id, // bookkeeping — who ran the import (typically admin)
              // The actual person who made the call lives in p.agentName (parsed
              // from the remark prefix). Surface it on the call history card
              // instead of attributing every imported call to the importer.
              attributedAgentName: p.agentName,
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
    created, deduped, enriched, callLogsCreated, autofilled,
    detectedColumns,
    errors: errors.slice(0, 10),
  });
}
