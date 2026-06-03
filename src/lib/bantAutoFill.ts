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
  if (n >= 1_000_000) return `${+(n/1_000_000).toFixed(1)}M AED`;
  if (n >= 1_000) return `${+(n/1_000).toFixed(0)}K AED`;
  return `${n} AED`;
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

function detectAuthority(text: string): { value: string; enumValue: string; confidence: BantConfidence } | null {
  const t = text.toLowerCase();
  if (/\b(?:i am|i'm|myself|self|i will|i decide|sole)\s*(?:the\s+)?(?:decision\s*maker|investor|buyer|deciding|investing)\b/.test(t))
    return { value: "Self — decision maker", enumValue: "DECISION_MAKER", confidence: "HIGH" };
  if (/\bself\s*decision\b|\bmy\s*own\s*decision\b|\bself\s+investor\b/.test(t))
    return { value: "Self — decision maker", enumValue: "DECISION_MAKER", confidence: "HIGH" };
  if (/\b(?:wife|husband|spouse)\s*(?:will|needs? to|to)\s*(?:decide|approve|finalise|confirm|see)\b/.test(t))
    return { value: "Spouse needs to approve", enumValue: "INFLUENCER", confidence: "HIGH" };
  if (/\b(?:father|dad|mother|mum|mom|parent)\s*(?:will|to)\s*(?:decide|approve|confirm)\b/.test(t))
    return { value: "Parent decision", enumValue: "INFLUENCER", confidence: "HIGH" };
  if (/\bneed\s*(?:to\s*)?(?:consult|check|ask|discuss|talk)\s*(?:with\s+)?\w+/.test(t))
    return { value: "Consulting someone first", enumValue: "INFLUENCER", confidence: "MEDIUM" };
  return null;
}

function detectNeed(text: string): string | null {
  const t = text.toLowerCase();
  const parts: string[] = [];
  const bhk = t.match(/(\d)\s*(?:bhk|br|bedroom)/);
  if (bhk) parts.push(`${bhk[1]}BHK`);
  if (/\bvilla\b/.test(t)) parts.push("Villa");
  if (/\bpenthouse|ph\b/.test(t)) parts.push("Penthouse");
  if (/\bstudio\b/.test(t)) parts.push("Studio");
  if (/rental\s*yield|rental\s*income|passive\s*income|roi/.test(t)) parts.push("Rental yield");
  else if (/end\s*use|own\s*use|self\s*use|to\s*(?:stay|live)/.test(t)) parts.push("Own use");
  else if (/investment\b/.test(t)) parts.push("Investment");
  if (/parents?\s*(?:relocat|moving|shifting)/.test(t)) parts.push("Parents relocating");
  if (/migrat|relocat|shifting\s*to\s*dubai/.test(t)) parts.push("Relocation");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function detectTimeline(text: string): { value: string; enumValue: string; confidence: BantConfidence } | null {
  const t = text.toLowerCase();
  if (/\b(?:immediate|asap|right now|ready now|this week|today|urgent)\b/.test(t))
    return { value: "Immediate", enumValue: "IMMEDIATE", confidence: "HIGH" };
  if (/within\s*30\s*days?|next\s*month|by\s*month.?end|30\s*days/.test(t))
    return { value: "30 days", enumValue: "THIRTY_DAYS", confidence: "HIGH" };
  if (/(?:in|within)\s*(?:2|3|two|three)\s*months?|next\s*quarter/.test(t))
    return { value: "2–3 months", enumValue: "THREE_MONTHS", confidence: "HIGH" };
  if (/(?:in|after)\s*(?:6|six)\s*months?|next\s*year|long.?term|after\s*property\s*sale/.test(t))
    return { value: "6+ months", enumValue: "SIX_PLUS_MONTHS", confidence: "HIGH" };
  if (/just\s*(?:looking|browsing|exploring)|window\s*shopping|not\s*decided/.test(t))
    return { value: "Just browsing", enumValue: "WINDOW_SHOPPING", confidence: "MEDIUM" };
  const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
  for (const month of months) {
    if (new RegExp(`\\b${month}\\b`).test(t))
      return { value: `Around ${month[0]!.toUpperCase() + month.slice(1)}`, enumValue: "THREE_MONTHS", confidence: "LOW" };
  }
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
  type AH = { result: { value: string; enumValue: string; confidence: BantConfidence }; src: TextSource };
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
    const n = detectNeed(src.text);
    if (n) nHits.push({ result: { value: n, confidence: src.label === "Call note" ? "HIGH" : "MEDIUM" }, src });
    const t = detectTimeline(src.text);
    if (t) tHits.push({ result: t, src });
  }

  const out: BantSuggestions = { scannedAt: new Date().toISOString() };

  const bBest = pickBest(bHits);
  if (bBest) out.budget = { value: bBest.result.value, rawValue: bBest.result.rawValue, confidence: bBest.result.confidence, source: fmtSrc(bBest.src.label, bBest.src.date), date: bBest.src.date.toISOString(), snippet: bBest.src.text.slice(0, 120) };

  const aBest = pickBest(aHits);
  if (aBest) out.authority = { value: aBest.result.value, enumValue: aBest.result.enumValue, confidence: aBest.result.confidence, source: fmtSrc(aBest.src.label, aBest.src.date), date: aBest.src.date.toISOString(), snippet: aBest.src.text.slice(0, 120) };

  const nBest = pickBest(nHits);
  if (nBest) out.need = { value: nBest.result.value, confidence: nBest.result.confidence, source: fmtSrc(nBest.src.label, nBest.src.date), date: nBest.src.date.toISOString(), snippet: nBest.src.text.slice(0, 120) };

  const tBest = pickBest(tHits);
  if (tBest) out.timeline = { value: tBest.result.value, enumValue: tBest.result.enumValue, confidence: tBest.result.confidence, source: fmtSrc(tBest.src.label, tBest.src.date), date: tBest.src.date.toISOString(), snippet: tBest.src.text.slice(0, 120) };

  return out;
}
