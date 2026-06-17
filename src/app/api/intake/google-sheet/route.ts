import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveTeam, routingFieldsFor } from "@/lib/teamRouting";
import { interpretBudget, resolveBudgetCurrency } from "@/lib/budgetCurrency";
import { inferCountryFromCity } from "@/lib/cityCountry";
import { canonicalStatus } from "@/lib/lead-statuses";
import { mergeRawRemark } from "@/lib/rawRemarks";
import { validEmail, validBudgetRaw, looksLikeStatus, validPhone } from "@/lib/importValidate";
import { normalizePhone } from "@/lib/phone";
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
// Tracks which sheet headers were mapped to a known CRM field for the current
// row, so every OTHER column is preserved verbatim in customFields. Reset per row.
let _consumedKeys = new Set<string>();
function pick(row: Row, ...candidates: string[]): string | undefined {
  const wanted = candidates.map(norm);
  for (const k of Object.keys(row)) {
    const nk = norm(k);
    for (const t of wanted) {
      if (nk === t || nk.startsWith(t) || t.startsWith(nk)) {
        // Mark "mapped" (hidden from customFields) only on an exact match or when
        // the header is a PREFIX of the candidate ("mob"→"mobile"). Headers that
        // EXTEND a candidate ("sourcecampaign" ⊃ "source") stay as custom fields.
        if (nk === t || t.startsWith(nk)) _consumedKeys.add(k);
        const v = row[k]?.toString().trim();
        if (v) return v;
      }
    }
  }
}

// Budget parsing uses the shared currency-aware interpretBudget() — the old
// local parser silently 10×–100× corrupted Cr/Lakh values and has been removed.
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
  // Unrecognized but PRESENT source (e.g. "Townscript", "Eventbrite") → OTHER as
  // a coarse legacy bucket only. The verbatim value is preserved in sourceRaw and
  // is what the CRM displays/filters on — we NEVER silently relabel it "CSV".
  return LeadSource.OTHER;
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
    _consumedKeys = new Set();   // reset per-row: tracks headers mapped to CRM fields
    const name = pick(row, "customer", "name", "fullname", "leadname");
    // VALIDATE (same rules as CSV import): normalize to E.164 then reject
    // malformed (country-code-only "+91", merged/over-long) → store blank rather
    // than corrupt phone data.
    const phoneRaw = pick(row, "mobile", "phone", "contact", "whatsapp");
    const phone = phoneRaw ? (validPhone(normalizePhone(phoneRaw, "IN")) ?? undefined) : undefined;
    // VALIDATE: only store an email that is actually an email — never a name or
    // boolean leaked from an adjacent column ("tanuj", "false").
    const email = validEmail(pick(row, "email", "emailid"));
    if (!name && !phone && !email) continue;

    // VALIDATE: a budget must contain a number. A digit-less value ("Lalit Sir")
    // is NOT a budget — drop it rather than store a name in the budget field.
    const budgetCol = validBudgetRaw(pick(row, "budgetaed", "budgetinr", "budget", "budgetmin"));
    const budgetInfo = budgetCol
      ? interpretBudget(budgetCol, validBudgetRaw(pick(row, "budgetmax")))
      : { min: null, max: null, raw: null };
    try {
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: pick(row, "city", "location"),
        configuration: pick(row, "configuration", "config", "bhk", "type"),
        budgetMin: budgetInfo.min ?? undefined,
        budgetMax: budgetInfo.max ?? undefined,
        notesShort: pick(row, "remarks", "message", "requirement"),
        tags: pick(row, "tags"),
        source: parseSource(pick(row, "source")),
        sourceDetail: campaign,
      });
      if (r.deduped) deduped++; else created++;

      const update: Record<string, unknown> = {};
      // Stamp the batch on NEW rows so a rollback can find + soft-delete them.
      if (!r.deduped) update.importBatchId = importBatch.id;
      // Phase D: bulk imports land in MASTER_DATA (untriaged); admin moves them.
      if (!r.deduped) update.leadOrigin = "MASTER_DATA";
      const co = pick(row, "company"); if (co) update.company = co;
      const ad = pick(row, "address"); if (ad) update.address = ad;
      const wc = pick(row, "whoisclient", "client", "clientinfo"); if (wc) update.whoIsClient = wc;
      const cat = pick(row, "categorization", "category"); if (cat) update.categorization = cat;
      // RAW-FIRST remarks (bugfix): the Sheet importer previously routed the
      // Remarks column ONLY into notesShort, so imported history never reached
      // Lead.remarks / Conversation History. Now the exact remark is stored
      // verbatim in the immutable rawRemarks audit field (and mirrored to the
      // display copy), growing — never overwriting — on re-import.
      const sheetRemark = pick(row, "remarks", "remark");
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
      const st = parseStage(pick(row, "stage")); if (st) update.status = st as any;
      // VALIDATE: only accept a real status label — never a TRUE/FALSE/numeric
      // token leaked from a Meeting/Site-Visit column.
      const cs = pick(row, "status"); if (cs && looksLikeStatus(cs)) update.currentStatus = canonicalStatus(cs);
      // SOURCE FIDELITY: store the verbatim Source column exactly as written
      // ("Townscript", "Eventbrite", "WhatsApp Campaign June"). Display + filters
      // read this; it is NEVER mapped, normalized, or defaulted.
      const srcRaw = pick(row, "source"); if (srcRaw) update.sourceRaw = srcRaw;
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
          explicit: pick(row, "currency") ?? rawCcyHint ?? headerHint,
          country: pick(row, "country") ?? inferCountryFromCity(pick(row, "city", "location")),
          projectName: pick(row, "project") ?? (update.sourceDetail as string | undefined),
          sheetName: importBatch.fileName,
          team: (update.forwardedTeam as string | undefined) ?? pick(row, "forwardedteam", "team"),
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
