import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";
// runIntelligenceCheck is called inside ingestLead() for every new (non-deduped)
// lead. No explicit call needed here — the check fires sequentially before any
// assignment or automation runs, satisfying the bulk-import constraint.

// Accepts any Google Sheets URL the user pastes (edit URL, share URL, view URL).
// Extracts the sheet ID and (optional) gid (per-tab), then fetches the public
// CSV export. No OAuth needed — the sheet must be shared as "Anyone with the link".

type Row = Record<string, string>;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
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
function parseDate(s?: string) { if (!s) return; const d = new Date(s); return isNaN(d.getTime()) ? undefined : d; }
function parseSource(s?: string): LeadSource {
  if (!s) return LeadSource.CSV_IMPORT;
  const n = norm(s);
  if (n.includes("whatsapp") || n.includes("wa")) return LeadSource.WHATSAPP;
  if (n.includes("website") || n.includes("web")) return LeadSource.WEBSITE;
  if (n.includes("event") || n.includes("expo")) return LeadSource.EVENT;
  if (n.includes("referral")) return LeadSource.REFERRAL;
  if (n.includes("call")) return LeadSource.INBOUND_CALL;
  if (n.includes("facebook") || n.includes("fb") || n.includes("meta")) return LeadSource.FACEBOOK_ADS;
  if (n.includes("google")) return LeadSource.GOOGLE_ADS;
  return LeadSource.CSV_IMPORT;
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
  const meUser = await requireUser();
  const body = await req.json().catch(() => ({}));
  const url = String(body.url ?? "").trim();
  const campaign = body.campaign ? String(body.campaign).trim() : undefined;
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

  let created = 0, deduped = 0, enriched = 0;
  const errors: string[] = [];
  const detectedColumns = Object.keys(parsed.data[0] ?? {});

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
    const name = pick(row, "customer", "name", "fullname", "leadname");
    const phone = pick(row, "mobile", "phone", "contact", "whatsapp");
    const email = pick(row, "email", "emailid");
    if (!name && !phone && !email) continue;

    try {
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: pick(row, "city", "location"),
        configuration: pick(row, "configuration", "config", "bhk", "type"),
        budgetMin: parseBudget(pick(row, "budgetaed", "budgetinr", "budget", "budgetmin")),
        budgetMax: parseBudget(pick(row, "budgetmax")),
        notesShort: pick(row, "remarks", "message", "requirement"),
        tags: pick(row, "tags"),
        source: parseSource(pick(row, "source")),
        sourceDetail: campaign,
      });
      if (r.deduped) deduped++; else created++;

      const update: Record<string, unknown> = {};
      // Stamp the batch on NEW rows so a rollback can find + soft-delete them.
      if (!r.deduped) update.importBatchId = importBatch.id;
      const co = pick(row, "company"); if (co) update.company = co;
      const ad = pick(row, "address"); if (ad) update.address = ad;
      const wc = pick(row, "whoisclient", "client", "clientinfo"); if (wc) update.whoIsClient = wc;
      const cat = pick(row, "categorization", "category"); if (cat) update.categorization = cat;
      const st = parseStage(pick(row, "stage")); if (st) update.status = st as any;
      const cs = pick(row, "status"); if (cs) update.currentStatus = cs;
      const fu = parseDate(pick(row, "followupdate", "followup")); if (fu) update.followupDate = fu;
      const me = parseDate(pick(row, "meeting", "meetingdate")); if (me) update.meetingDate = me;
      const sv = parseDate(pick(row, "sitevisit")); if (sv) update.siteVisitDate = sv;
      const td = pick(row, "todo", "todonext", "nextaction"); if (td) update.todoNext = td;
      const ds = pick(row, "detailshared"); if (ds) update.detailShared = ds;
      const po = parsePotential(pick(row, "potential")); if (po) update.potential = po;
      const fd = parseFund(pick(row, "fundreadiness", "fund")); if (fd) update.fundReadiness = fd;
      const md = parseMood(pick(row, "moodstatus", "mood")); if (md) update.moodStatus = md;
      const tl = parseTimeline(pick(row, "whencaninvest", "timeline")); if (tl) update.whenCanInvest = tl;
      {
        const rowTeamRaw = pick(row, "forwardedteam", "team") ?? null;
        const teamResult = resolveTeam({
          forceTeam: rowTeamRaw,
          forceMethod: "import",
          sourceDetail: campaign,
          projectSlug: pick(row, "project"),
          text: pick(row, "remarks", "message", "requirement"),
        });
        if (teamResult.team) {
          update.forwardedTeam = teamResult.team;
          const rf = routingFieldsFor(teamResult);
          update.routingMethod = rf.routingMethod;
          update.routingSource = rf.routingSource;
          update.routingReason = rf.routingReason;
        }
      }
      // Currency inference
      const budgetHeader = Object.keys(row).find(k => /budget/i.test(k));
      if (budgetHeader) {
        if (/aed/i.test(budgetHeader)) update.budgetCurrency = "AED";
        else if (/inr|₹|rs/i.test(budgetHeader)) update.budgetCurrency = "INR";
      }
      if (Object.keys(update).length) {
        await prisma.lead.update({ where: { id: r.lead.id }, data: update });
        enriched++;
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
    rowsProcessed: parsed.data.length,
    created, deduped, enriched,
    importBatchId: importBatch.id,
    detectedColumns, errors: errors.slice(0,10),
  });
}
