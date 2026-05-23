import { NextResponse, type NextRequest } from "next/server";
import Papa from "papaparse";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, LeadStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Row = Record<string, string>;

// Header normalizer: strips emojis/punctuation/whitespace, lowercases. So
//   "📞 Mobile" → "mobile",  "💰Budget (AED)" → "budgetaed",  "To Do✅" → "todo"
function norm(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

// Pick the first matching column by normalized header
function pick(row: Row, ...candidates: string[]): string | undefined {
  const normalized = candidates.map(norm);
  for (const key of Object.keys(row)) {
    const nk = norm(key);
    for (const target of normalized) {
      if (nk === target || nk.startsWith(target) || target.startsWith(nk)) {
        const v = row[key]?.toString().trim();
        if (v) return v;
      }
    }
  }
  return undefined;
}

function parseBudget(s?: string): number | undefined {
  if (!s) return undefined;
  const cleaned = s.replace(/[^\d.kKmM]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return undefined;
  if (/m/i.test(cleaned)) return num * 1_000_000;
  if (/k/i.test(cleaned)) return num * 1_000;
  // raw number — if < 1000 assume Millions (common in agent shorthand "2.5")
  return num < 1000 ? num * 1_000_000 : num;
}

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
  if (n.includes("lost")) return LeadStatus.LOST;
  return LeadStatus.NEW;
}

function parsePotential(s?: string): Potential | undefined {
  if (!s) return undefined;
  const n = norm(s);
  if (n.startsWith("h")) return Potential.HIGH;
  if (n.startsWith("m")) return Potential.MEDIUM;
  if (n.startsWith("l")) return Potential.LOW;
  return Potential.UNKNOWN;
}

function parseFund(s?: string): FundReadiness | undefined {
  if (!s) return undefined;
  const n = norm(s);
  if (n.includes("cash")) return FundReadiness.CASH_READY;
  if (n.includes("approved") || n.includes("bank")) return FundReadiness.BANK_APPROVED;
  if (n.includes("financ") || n.includes("loan") || n.includes("mortgage")) return FundReadiness.FINANCING_NEEDED;
  return FundReadiness.NOT_DISCUSSED;
}

function parseMood(s?: string): MoodStatus | undefined {
  if (!s) return undefined;
  const n = norm(s);
  if (n.includes("excit")) return MoodStatus.EXCITED;
  if (n.includes("interest")) return MoodStatus.INTERESTED;
  if (n.includes("neutral")) return MoodStatus.NEUTRAL;
  if (n.includes("hesit")) return MoodStatus.HESITANT;
  if (n.includes("cold")) return MoodStatus.COLD;
  if (n.includes("confus")) return MoodStatus.CONFUSED;
  if (n.includes("angry") || n.includes("upset")) return MoodStatus.ANGRY;
  return MoodStatus.NEUTRAL;
}

function parseInvestTimeline(s?: string): InvestTimeline | undefined {
  if (!s) return undefined;
  const n = norm(s);
  if (n.includes("immed") || n.includes("week") || n.includes("now")) return InvestTimeline.IMMEDIATE;
  if (n.includes("30") || n.includes("month") && !n.includes("3") && !n.includes("6")) return InvestTimeline.THIRTY_DAYS;
  if (n.includes("3month") || n.includes("quarter")) return InvestTimeline.THREE_MONTHS;
  if (n.includes("6") || n.includes("year")) return InvestTimeline.SIX_PLUS_MONTHS;
  if (n.includes("brows") || n.includes("explor") || n.includes("shop")) return InvestTimeline.WINDOW_SHOPPING;
  return InvestTimeline.UNKNOWN;
}

function parseDate(s?: string): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

export async function POST(req: NextRequest) {
  await requireUser();
  const fd = await req.formData();
  const file = fd.get("file");
  const campaign = (fd.get("campaign")?.toString() ?? "").trim() || undefined;
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });

  const text = await file.text();
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  if (parsed.errors.length > 5) {
    return NextResponse.json({ error: "CSV parse errors", details: parsed.errors.slice(0, 5) }, { status: 422 });
  }

  let created = 0, deduped = 0, enriched = 0;
  const errors: string[] = [];
  const detectedColumns = Object.keys(parsed.data[0] ?? {});

  for (const [i, row] of parsed.data.entries()) {
    const name = pick(row, "customer", "name", "fullname", "leadname", "customername");
    const phone = pick(row, "mobile", "phone", "contact", "phonenumber", "whatsapp");
    const email = pick(row, "email", "emailid", "mail");
    if (!name && !phone && !email) continue;

    try {
      // Create or merge via ingestLead
      const r = await ingestLead({
        name: name ?? phone ?? email ?? "Unknown",
        phone, email,
        city: pick(row, "city", "location"),
        country: undefined,
        configuration: pick(row, "configuration", "config", "bhk", "type"),
        budgetMin: parseBudget(pick(row, "budgetaed", "budget", "budgetmin", "minbudget")),
        budgetMax: parseBudget(pick(row, "budgetmax", "maxbudget")),
        notesShort: pick(row, "remarks", "message", "requirement"),
        tags: pick(row, "tags", "tag"),
        source: parseSource(pick(row, "source")),
        sourceDetail: campaign,
      });
      if (r.deduped) deduped++; else created++;

      // Enrich with the Dubai-sheet depth fields the basic ingestLead doesn't cover
      const update: Record<string, unknown> = {};
      const company = pick(row, "company");
      if (company) update.company = company;
      const address = pick(row, "address");
      if (address) update.address = address;
      const whoIsClient = pick(row, "whoisclient", "client", "clientinfo", "about");
      if (whoIsClient) update.whoIsClient = whoIsClient;
      const project = pick(row, "project");
      if (project) update.sourceDetail = update.sourceDetail ?? project;
      const categorization = pick(row, "categorization", "category");
      if (categorization) update.categorization = categorization;
      const stage = pick(row, "stage");
      if (stage) update.status = parseStage(stage);
      const callStatus = pick(row, "status");
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
      const remarks = pick(row, "remarks");
      if (remarks) update.remarks = remarks;

      if (Object.keys(update).length > 0) {
        await prisma.lead.update({ where: { id: r.lead.id }, data: update });
        enriched++;
      }
    } catch (e) {
      errors.push(`Row ${i + 2}: ${String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    created, deduped, enriched,
    detectedColumns,
    errors: errors.slice(0, 10),
  });
}
