import { prisma } from "@/lib/prisma";
import { format } from "date-fns";

export type BantConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface BantSuggestion {
  value: string;
  rawValue?: number;
  enumValue?: string;
  source: string;
  date: string;
  confidence: BantConfidence;
  snippet: string;
}

export interface BantSuggestions {
  budget?: BantSuggestion;
  authority?: BantSuggestion;
  need?: BantSuggestion;
  timeline?: BantSuggestion;
  scannedAt: string;
}

interface TextSource { text: string; label: string; date: Date; }

function unitMult(u: string): number {
  const lu = u.toLowerCase();
  if (/^cr/.test(lu)) return 10_000_000;
  if (/lakh|^l$/.test(lu)) return 100_000;
  if (/^m/.test(lu)) return 1_000_000;
  if (/^k/.test(lu)) return 1_000;
  return 1;
}

function fmtAmt(n: number, c: "AED" | "INR"): string {
  if (c === "INR") {
    if (n >= 10_000_000) return `${+(n/10_000_000).toFixed(1)} Cr`;
    if (n >= 100_000) return `${+(n/100_000).toFixed(1)} L`;
    return `${+(n/1000).toFixed(0)}K`;
  }
  // AED: prefix format — "AED 1.7M"
  if (n >= 1_000_000) return `AED ${+(n/1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `AED ${+(n/1_000).toFixed(0)}K`;
  return `AED ${n}`;
}

function detectBudget(text: string): { amount: number; display: string; currency: "AED" | "INR" } | null {
  const lower = text.toLowerCase();
  const rangeRe = /(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh|l\b|m(?:n|illion)?|k)\b/i;
  const rm = lower.match(rangeRe);
  if (rm) {
    const a = parseFloat(rm[1]);
    const mult = unitMult(rm[3]);
    const currency: "AED" | "INR" = /cr|lakh/.test(rm[3]) ? "INR" : "AED";
    const display = fmtAmt(a * mult, currency) + "–" + fmtAmt(parseFloat(rm[2]) * mult, currency);
    return { amount: a * mult, display, currency };
  }
  const singleRe = /(\d+(?:\.\d+)?)\s*(cr(?:ore)?s?|lakh|l\b|m(?:n|illion)?|k)\b/i;
  const sm = lower.match(singleRe);
  if (sm) {
    const amount = parseFloat(sm[1]) * unitMult(sm[2]);
    const currency: "AED" | "INR" = /cr|lakh/.test(sm[2]) ? "INR" : "AED";
    return { amount, display: fmtAmt(amount, currency), currency };
  }
  return null;
}

function detectAuthority(text: string): { value: string; confidence: BantConfidence } | null {
  const t = text.toLowerCase();

  // ─── SELF ──────────────────────────────────────────────────────────────────
  if (/\b(i am|i'm|myself|i will|i alone)\s*(the\s+)?(decision\s*maker|deciding|investor|buyer|investing)\b/.test(t))
    return { value: "Self", confidence: "HIGH" };
  if (/\bi\s*will\s*(decide|take\s*(the\s+)?decision|book)\b|\bself\s*decision\b|\bmy\s*own\s*decision\b/.test(t))
    return { value: "Self", confidence: "HIGH" };

  // ─── HUSBAND + WIFE ────────────────────────────────────────────────────────
  if (/\b(husband\s*(and|with|&)\s*wife|wife\s*(and|with|&)\s*husband)\b/.test(t))
    return { value: "Husband + Wife", confidence: "HIGH" };
  if (/\bjoint\s*decision\b|\bboth\s*of\s*us\s*(will|to)\s*(decide|finali[sz]e)\b/.test(t))
    return { value: "Husband + Wife", confidence: "MEDIUM" };

  // ─── SPOUSE + SELF ─────────────────────────────────────────────────────────
  if (/\b(spouse\s*(and\s*self|with\s*self)|myself\s*(and\s*)?(?:wife|husband))\b/.test(t))
    return { value: "Spouse + Self", confidence: "HIGH" };
  if (/\bneed\s*(to\s*)?(consult|discuss|check|ask|talk)\s*(with\s*)?(wife|husband|spouse)\b/.test(t))
    return { value: "Spouse + Self", confidence: "MEDIUM" };
  if (/\b(decide|discuss|finali[sz]e)\s*with\s*(my\s+)?(wife|husband|spouse)\b/.test(t))
    return { value: "Spouse + Self", confidence: "HIGH" };

  // ─── FATHER + SON ──────────────────────────────────────────────────────────
  if (/\b(father\s*(and|with|&)\s*son|son\s*(and|with|&)\s*father)\b/.test(t))
    return { value: "Father + Son", confidence: "HIGH" };
  if (/\bclient\s*(and|with)\s*father\b|\bfather\s*(will\s*)?visit\b|\bvisit\s*with\s*(his\s*)?father\b/.test(t))
    return { value: "Father + Son", confidence: "HIGH" };

  // ─── INDIVIDUAL FAMILY ─────────────────────────────────────────────────────
  if (/\bwife\s*(will|needs?\s*to|to)\s*(decide|approve|finali[sz]e|confirm|see)\b/.test(t))
    return { value: "Wife", confidence: "HIGH" };
  if (/\bwife\s*(is\s*)?(the\s+)?decision\s*maker\b/.test(t))
    return { value: "Wife", confidence: "HIGH" };

  if (/\bhusband\s*(will|needs?\s*to|to)\s*(decide|approve|finali[sz]e|confirm|see)\b/.test(t))
    return { value: "Husband", confidence: "HIGH" };

  if (/\b(father|dad)\s*(will|needs?\s*to|to)\s*(decide|approve|finali[sz]e|confirm|see)\b/.test(t))
    return { value: "Father", confidence: "HIGH" };
  if (/\blooking\s*(for|with)\s*(his|her|my)\s*father\b|\bdiscuss\s*with\s*(his\s*)?father\b/.test(t))
    return { value: "Father", confidence: "HIGH" };
  if (/\b(need\s*(to\s*)?)?(consult|check|ask|talk)\s*(with\s*)?(father|dad)\b/.test(t))
    return { value: "Father", confidence: "MEDIUM" };

  if (/\b(mother|mum|mom)\s*(will|needs?\s*to|to)\s*(decide|approve|confirm|see)\b/.test(t))
    return { value: "Mother", confidence: "HIGH" };
  if (/\bdiscuss\s*with\s*(his\s*|her\s*|my\s*)?(mother|mum|mom)\b/.test(t))
    return { value: "Mother", confidence: "HIGH" };

  if (/\bbrother\s*(will|needs?\s*to|to|is)\s*(deciding|decide|approve|evaluate|evaluating|confirm)\b/.test(t))
    return { value: "Brother", confidence: "HIGH" };
  if (/\bhis\s*brother\s*(is\s*)?(evaluating|deciding|checking)\b/.test(t))
    return { value: "Brother", confidence: "HIGH" };

  if (/\bsister\s*(will|needs?\s*to|to)\s*(decide|approve|confirm)\b/.test(t))
    return { value: "Sister", confidence: "HIGH" };

  if (/\b(his|her|my)\s*son\s*(will|needs?\s*to|to)\s*(decide|approve|confirm)\b/.test(t))
    return { value: "Son", confidence: "HIGH" };

  if (/\bdaughter\s*(will|needs?\s*to|to)\s*(decide|approve|confirm)\b/.test(t))
    return { value: "Daughter", confidence: "HIGH" };

  // ─── PARENTS / FAMILY ──────────────────────────────────────────────────────
  if (/\b(both\s*parents?|father\s*and\s*mother|mother\s*and\s*father|parents?\s*(will|to)\s*(decide|confirm))\b/.test(t))
    return { value: "Parents", confidence: "HIGH" };
  if (/\blooking\s*(for|with)\s*(both\s*)?parents?\b/.test(t))
    return { value: "Parents", confidence: "HIGH" };
  if (/\b(need\s*(to\s*)?)?(consult|check|ask)\s*(with\s*)?(parents?)\b/.test(t))
    return { value: "Parents", confidence: "MEDIUM" };

  if (/\b(whole\s*family|family\s*(will|to)\s*(decide|discuss|approve))\b/.test(t))
    return { value: "Family", confidence: "MEDIUM" };
  if (/\bneed\s*(to\s*)?(consult|discuss|ask)\s*(with\s*)?(?:the\s*)?family\b/.test(t))
    return { value: "Family", confidence: "MEDIUM" };

  // ─── BUSINESS / CORPORATE ──────────────────────────────────────────────────
  if (/\bbusiness\s*partner\s*(will|to)\s*(decide|approve|discuss)\b/.test(t))
    return { value: "Business Partner", confidence: "HIGH" };
  if (/\binvestor\s*(group|committee|partners?)\b/.test(t))
    return { value: "Investor Group", confidence: "HIGH" };
  if (/\b(company|management|board)\s*(will|to)\s*(decide|approve|invest)\b/.test(t))
    return { value: "Company / Management", confidence: "HIGH" };

  return null;
}

// Extract "for X purpose" qualifier from text near a property type mention
function extractPurpose(text: string): string {
  const t = text.toLowerCase();
  if (/rental\s*(?:yield|income|purpose|investment)?|passive\s*income|roi/.test(t)) return "for rental income";
  if (/end\s*use|end\s*user|own\s*use|self\s*use|(?:to|for)\s*(?:stay|live|residence|residing)/.test(t)) return "for own use";
  if (/capital\s*appreciation|cap.*apprec/.test(t)) return "for capital appreciation";
  if (/investment|invest\b/.test(t)) return "for investment";
  if (/(?:family|parents?)\s*(?:relocat|moving|shifting)/.test(t)) return "family relocation";
  if (/commercial/.test(t)) return "commercial";
  return "";
}

function detectNeed(text: string, team?: string | null): string | null {
  const t = text.toLowerCase();
  const isDubai = team === "Dubai";
  const parts: string[] = [];

  // Bedroom type — use BR for Dubai, BHK for India
  const bedroomMatch = t.match(/(\d)\s*(?:bhk|br(?:k|h)?|bedroom)/);
  if (bedroomMatch) {
    parts.push(isDubai ? `${bedroomMatch[1]}BR` : `${bedroomMatch[1]}BHK`);
  }

  // Dubai-specific unit types
  if (/\bstudio\b/.test(t)) parts.push("Studio");
  if (/\bvilla\b/.test(t)) parts.push("Villa");
  if (/\bpenthouse|ph\b/.test(t)) parts.push("Penthouse");
  if (/\btownhouse\b/.test(t)) parts.push("Townhouse");

  if (parts.length === 0) return null;

  // Append purpose if found
  const purpose = extractPurpose(t);
  if (purpose) parts.push(purpose);

  return parts.join(" ");
}

function detectTimeline(text: string): { value: string; enumValue: string; confidence: BantConfidence } | null {
  const t = text.toLowerCase();

  // ─── IMMEDIATE ───────────────────────────────────────────────────────────
  // ONLY fire when the text explicitly describes buying-action urgency.
  // Words like "today" or "this week" alone are NOT evidence — they appear in
  // every call note to describe WHEN the call happened, not when the client
  // intends to buy. We require "today/this week" to be combined with a clear
  // booking-action verb.
  const immediateExplicit =
    /\b(?:immediate\s*(?:requirement|buyer|interest|purchase)|asap|ready\s*now|ready\s*to\s*buy|wants?\s*to\s*book\s*now|book\s*now|wants?\s*to\s*finaliz|finaliz(?:e|ing)\s*(?:this\s*week|now|today)|wants?\s*eoi\s*today|wants?\s*to\s*close|close\s*(?:the\s*)?deal\s*(?:now|this\s*week))\b/.test(t) ||
    /site\s*visit\s*(?:today|tomorrow)\s*(?:for|to)\s*book|wants?\s*to\s*sign|ready\s*to\s*sign/.test(t);
  if (immediateExplicit)
    return { value: "Immediate", enumValue: "IMMEDIATE", confidence: "HIGH" };

  // ─── 30 DAYS ─────────────────────────────────────────────────────────────
  if (/within\s*30\s*days?|next\s*month|by\s*(?:end\s*of\s*)?(?:this\s*)?month|30\s*days/.test(t))
    return { value: "30 days", enumValue: "THIRTY_DAYS", confidence: "HIGH" };

  // ─── 2–3 MONTHS ──────────────────────────────────────────────────────────
  // "in/within/after 2-3 months", "will look after 2/3 months", "2-3 months"
  if (/(?:in|within|after|look\s*after)\s*(?:2|3|two|three)\s*months?|next\s*quarter/.test(t) ||
      /(?:2|3|two|three)\s*(?:to|-)\s*(?:3|4|four)\s*months?/.test(t))
    return { value: "2–3 months", enumValue: "THREE_MONTHS", confidence: "HIGH" };

  // "few months", "couple of months", "in some months"
  if (/(?:a\s*)?few\s*months?|couple\s*of\s*months?|some\s*months?/.test(t))
    return { value: "2–3 months", enumValue: "THREE_MONTHS", confidence: "MEDIUM" };

  // ─── 6+ MONTHS ───────────────────────────────────────────────────────────
  if (/(?:in|within|after)\s*(?:6|7|8|9|10|11|12|six)\s*months?/.test(t) ||
      /(?:after|in)\s*(?:1|2|one|two|a)\s*years?|next\s*year|long.?term/.test(t) ||
      /after\s*(?:property\s*sale|selling\s*(?:his|her|my|the)?\s*(?:flat|house|property|apartment))|after\s*funds?\s*arrang/.test(t))
    return { value: "6+ months", enumValue: "SIX_PLUS_MONTHS", confidence: "HIGH" };

  // ─── WINDOW SHOPPING / NOT SURE ──────────────────────────────────────────
  if (/just\s*(?:looking|browsing|exploring|searching)|window\s*shopping/.test(t))
    return { value: "Just browsing", enumValue: "WINDOW_SHOPPING", confidence: "MEDIUM" };
  if (/\bnot\s*(?:sure|decided|ready|confirmed)\b|\bno\s*(?:specific\s*)?timeline\b/.test(t))
    return { value: "Not sure", enumValue: "WINDOW_SHOPPING", confidence: "MEDIUM" };

  // ─── WAITING ON EXTERNAL EVENT ───────────────────────────────────────────
  // "will visit Dubai first", "after Dubai visit", "after site visit"
  if (/(?:will|wants?\s*to)\s*(?:go|visit|come\s*to)\s*dubai\s*first|after\s*(?:(?:going\s*to|visiting)\s*)?dubai/.test(t))
    return { value: "Will visit Dubai first", enumValue: "SIX_PLUS_MONTHS", confidence: "MEDIUM" };
  if (/after\s*(?:site\s*)?visit|after\s*funds?\s*releas|after\s*(?:the\s*)?meeting/.test(t))
    return { value: "After visit / funds release", enumValue: "THREE_MONTHS", confidence: "MEDIUM" };

  // Month-name mentions are intentionally NOT used as a timeline signal —
  // month names appear constantly in dates of call notes and add noise.
  return null;
}

function pickBest<T extends { confidence: BantConfidence }>(
  items: Array<{ result: T; src: TextSource }>
): { result: T; src: TextSource } | undefined {
  const order: BantConfidence[] = ["HIGH", "MEDIUM", "LOW"];
  return [...items].sort((a, b) => order.indexOf(a.result.confidence) - order.indexOf(b.result.confidence))[0];
}

function fmtSrc(label: string, date: Date): string {
  return `${label}, ${format(date, "dd MMM yyyy")}`;
}

export async function runBantAutoFill(leadId: string): Promise<BantSuggestions> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      callLogs:   { orderBy: { startedAt: "desc" }, take: 30, select: { notes: true, startedAt: true } },
      notes:      { orderBy: { createdAt: "desc" }, take: 10, select: { body: true, createdAt: true } },
      activities: { orderBy: { createdAt: "desc" }, take: 20, select: { title: true, description: true, createdAt: true } },
      waMessages: { orderBy: { receivedAt: "desc" }, take: 20, select: { body: true, receivedAt: true } },
    },
  });

  const team = lead.forwardedTeam;

  const sources: TextSource[] = [];
  if (lead.remarks) sources.push({ text: lead.remarks, label: "Remarks", date: lead.createdAt });
  if (lead.needSummary) sources.push({ text: lead.needSummary, label: "Need field", date: lead.createdAt });
  for (const cl of lead.callLogs) {
    if (cl.notes) sources.push({ text: cl.notes, label: "Call note", date: cl.startedAt });
  }
  for (const n of lead.notes) {
    sources.push({ text: n.body, label: "Note", date: n.createdAt });
  }
  for (const a of lead.activities) {
    const txt = [a.title, a.description].filter(Boolean).join(" ");
    if (txt) sources.push({ text: txt, label: "Activity", date: a.createdAt });
  }
  for (const wa of lead.waMessages) {
    if (wa.body) sources.push({ text: wa.body, label: "WhatsApp", date: wa.receivedAt });
  }

  type BH = { result: { value: string; rawValue: number; confidence: BantConfidence }; src: TextSource };
  type AH = { result: { value: string; confidence: BantConfidence }; src: TextSource };
  type NH = { result: { value: string; confidence: BantConfidence }; src: TextSource };
  type TH = { result: { value: string; enumValue: string; confidence: BantConfidence }; src: TextSource };

  const bHits: BH[] = [];
  const aHits: AH[] = [];
  const nHits: NH[] = [];
  const tHits: TH[] = [];

  for (const src of sources) {
    const b = detectBudget(src.text);
    if (b) bHits.push({ result: { value: b.display, rawValue: b.amount, confidence: src.label === "Call note" ? "HIGH" : "MEDIUM" }, src });
    const a = detectAuthority(src.text);
    if (a) aHits.push({ result: a, src });
    const n = detectNeed(src.text, team);
    if (n) nHits.push({ result: { value: n, confidence: src.label === "Call note" ? "HIGH" : "MEDIUM" }, src });
    const t = detectTimeline(src.text);
    if (t) tHits.push({ result: t, src });
  }

  const out: BantSuggestions = { scannedAt: new Date().toISOString() };

  const bBest = pickBest(bHits);
  if (bBest) out.budget = { value: bBest.result.value, rawValue: bBest.result.rawValue, confidence: bBest.result.confidence, source: fmtSrc(bBest.src.label, bBest.src.date), date: bBest.src.date.toISOString(), snippet: bBest.src.text.slice(0, 120) };

  const aBest = pickBest(aHits);
  if (aBest) out.authority = { value: aBest.result.value, confidence: aBest.result.confidence, source: fmtSrc(aBest.src.label, aBest.src.date), date: aBest.src.date.toISOString(), snippet: aBest.src.text.slice(0, 120) };

  const nBest = pickBest(nHits);
  if (nBest) out.need = { value: nBest.result.value, confidence: nBest.result.confidence, source: fmtSrc(nBest.src.label, nBest.src.date), date: nBest.src.date.toISOString(), snippet: nBest.src.text.slice(0, 120) };

  const tBest = pickBest(tHits);
  if (tBest) out.timeline = { value: tBest.result.value, enumValue: tBest.result.enumValue, confidence: tBest.result.confidence, source: fmtSrc(tBest.src.label, tBest.src.date), date: tBest.src.date.toISOString(), snippet: tBest.src.text.slice(0, 120) };

  return out;
}
