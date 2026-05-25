// Smart CMA — generates a branded buyer-facing PDF for a lead.
// Sections:
//   1. Cover page (lead name, agent, company)
//   2. Client requirements snapshot (budget, configuration, BANT, who-is-client)
//   3. Top 3 matching units (from inventoryMatch) with project + price + view
//   4. Side-by-side comparison table
//   5. Indicative payment plan (configurable %)
//   6. ROI / rental yield estimate
//   7. Next steps + agent signature

import PDFDocument from "pdfkit";
import type { Lead, User, Unit, Project } from "@prisma/client";
import { fmtMoney } from "@/lib/money";

interface UnitWithProject extends Unit { project: Project; }

interface PaymentMilestone { label: string; pct: number; }

const DEFAULT_PAYMENT_PLAN: PaymentMilestone[] = [
  { label: "Booking",         pct: 10 },
  { label: "Within 60 days",  pct: 15 },
  { label: "Construction milestones", pct: 30 },
  { label: "On handover",     pct: 45 },
];

// Brand colours (matches the CRM UI)
const NAVY = "#0b1a33";
const GOLD = "#c9a24b";
const INK  = "#0b1a33";
const MUTED = "#6b7280";

export interface CmaInput {
  lead: Lead;
  agent: Pick<User, "name" | "email" | "phone" | "companyWhatsAppNumber">;
  units: UnitWithProject[];                   // already filtered to top-N
  paymentPlan?: PaymentMilestone[];
  expectedYieldPct?: number;                  // e.g. 7 for "7% pa expected gross yield"
}

/**
 * Renders the CMA PDF as a Node Buffer. Synchronous from caller's POV via
 * the standard pdfkit "doc.on('end')" pattern.
 */
export async function renderCmaPdf(input: CmaInput): Promise<Buffer> {
  const { lead, agent, units } = input;
  const plan = input.paymentPlan ?? DEFAULT_PAYMENT_PLAN;
  const yieldPct = input.expectedYieldPct ?? (lead.budgetCurrency === "AED" ? 7 : 4);

  const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: {
    Title: `Property comparison for ${lead.name}`,
    Author: "White Collar Realty",
    Subject: "Personalised property shortlist + payment plan",
  }});

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const endPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // ── 1. COVER PAGE ──
  doc.rect(0, 0, doc.page.width, 200).fill(NAVY);
  doc.fillColor("white").font("Helvetica-Bold").fontSize(26).text("White Collar Realty", 50, 60);
  doc.font("Helvetica").fontSize(11).fillColor(GOLD).text("Personalised Property Comparison", 50, 95);

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(36)
    .text(lead.name, 50, 240, { width: doc.page.width - 100 });
  doc.font("Helvetica").fontSize(11).fillColor(MUTED).text("Prepared by your dedicated advisor", 50, 290);

  doc.fontSize(14).fillColor(INK).font("Helvetica-Bold").text(agent.name, 50, 340);
  if (agent.email) doc.fontSize(10).fillColor(MUTED).font("Helvetica").text(agent.email, 50, 360);
  if (agent.companyWhatsAppNumber) doc.text(`WhatsApp: ${agent.companyWhatsAppNumber}`, 50, 374);
  doc.text(`Generated: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`, 50, 388);

  doc.rect(0, doc.page.height - 60, doc.page.width, 60).fill(GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("CONFIDENTIAL • For client review only", 50, doc.page.height - 35);

  // ── 2. CLIENT SNAPSHOT ──
  doc.addPage();
  sectionHeader(doc, "Your Requirements");
  const snapshot: [string, string][] = [
    ["Configuration",       lead.configuration ?? "—"],
    ["Budget (min)",        lead.budgetMin ? fmtMoney(lead.budgetMin, lead.budgetCurrency) : "—"],
    ["Budget (max)",        lead.budgetMax ? fmtMoney(lead.budgetMax, lead.budgetCurrency) : "—"],
    ["Location preference", [lead.city, lead.country].filter(Boolean).join(", ") || "—"],
    ["Profession",          lead.profession ?? "—"],
    ["Investment timeline", lead.whenCanInvest?.replaceAll("_", " ") ?? "—"],
    ["Fund readiness",      lead.fundReadiness?.replaceAll("_", " ") ?? "—"],
  ];
  for (const [k, v] of snapshot) twoColRow(doc, k, v);
  if (lead.whoIsClient) {
    doc.moveDown(0.5);
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10).text("WHO IS THE CLIENT", { underline: false });
    doc.fillColor(INK).font("Helvetica").fontSize(10).text(lead.whoIsClient, { width: doc.page.width - 100 });
  }

  // ── 3. UNIT SHORTLIST ──
  doc.addPage();
  sectionHeader(doc, `Top ${units.length} Properties Matched`);
  if (units.length === 0) {
    doc.fillColor(MUTED).font("Helvetica-Oblique").fontSize(11)
      .text("No inventory matches your current criteria. Your advisor will reach out with off-list options.", { width: doc.page.width - 100 });
  } else {
    for (const u of units) {
      unitCard(doc, u, lead.budgetCurrency);
    }
  }

  // ── 4. COMPARISON TABLE ──
  if (units.length > 1) {
    doc.addPage();
    sectionHeader(doc, "Side-by-Side Comparison");
    comparisonTable(doc, units, lead.budgetCurrency);
  }

  // ── 5. PAYMENT PLAN ──
  doc.addPage();
  sectionHeader(doc, "Indicative Payment Plan");
  const samplePrice = units[0]?.priceBase ?? lead.budgetMin ?? 0;
  doc.fillColor(MUTED).font("Helvetica").fontSize(10)
    .text(`Based on a unit price of ${fmtMoney(samplePrice, lead.budgetCurrency)} (sample — actual schedule varies by developer).`, { width: doc.page.width - 100 });
  doc.moveDown(0.5);
  for (const m of plan) {
    const amt = Math.round(samplePrice * m.pct / 100);
    twoColRow(doc, `${m.label} (${m.pct}%)`, fmtMoney(amt, lead.budgetCurrency));
  }
  doc.moveDown(0.5);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(10)
    .text(`Expected gross rental yield: ${yieldPct}% p.a.`, { width: doc.page.width - 100 });
  doc.fillColor(MUTED).font("Helvetica").fontSize(9)
    .text("Yields are estimates based on comparable units and may vary with handover date, market conditions, and management costs.", { width: doc.page.width - 100 });

  // ── 6. NEXT STEPS + SIGNATURE ──
  doc.addPage();
  sectionHeader(doc, "Next Steps");
  const steps = [
    "1. Review the units above and shortlist 1-2 favourites.",
    "2. Schedule a site visit (we'll arrange viewing slots + transportation).",
    "3. Meet with the developer's sales team — we coordinate directly.",
    "4. Negotiate price + payment plan with our help.",
    "5. Sign booking form and pay token amount.",
  ];
  for (const s of steps) {
    doc.fillColor(INK).font("Helvetica").fontSize(11).text(s, { width: doc.page.width - 100 });
    doc.moveDown(0.4);
  }
  doc.moveDown(2);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(12).text("Your advisor");
  doc.fillColor(INK).fontSize(11).font("Helvetica").text(agent.name);
  if (agent.email) doc.fillColor(MUTED).fontSize(10).text(agent.email);
  if (agent.companyWhatsAppNumber) doc.text(`WhatsApp: ${agent.companyWhatsAppNumber}`);

  // Footer on every page
  const totalPages = doc.bufferedPageRange().count;
  for (let i = 0; i < totalPages; i++) {
    doc.switchToPage(i);
    doc.fillColor(MUTED).font("Helvetica").fontSize(8)
      .text(`White Collar Realty · crm.whitecollarrealty.com · Page ${i + 1} of ${totalPages}`,
        50, doc.page.height - 30,
        { align: "center", width: doc.page.width - 100 });
  }

  doc.end();
  return endPromise;
}

// ── primitives ───────────────────────────────────────────────────────

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(20).text(title, 50, 50);
  doc.moveTo(50, 80).lineTo(120, 80).lineWidth(3).strokeColor(GOLD).stroke();
  doc.moveDown(2);
  doc.font("Helvetica").fontSize(11).fillColor(INK);
}

function twoColRow(doc: PDFKit.PDFDocument, label: string, value: string) {
  const y = doc.y;
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(label, 50, y, { width: 200 });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(10).text(value, 260, y, { width: doc.page.width - 310 });
  doc.moveDown(0.4);
}

function unitCard(doc: PDFKit.PDFDocument, u: UnitWithProject, currency: string) {
  if (doc.y > doc.page.height - 160) doc.addPage();
  const startY = doc.y;
  doc.rect(50, startY, doc.page.width - 100, 110).strokeColor("#e5e7eb").lineWidth(1).stroke();

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text(u.project.name, 60, startY + 10);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10).text(
    `${u.project.area ?? u.project.city} · ${u.project.country} · ${u.project.developer ?? "—"}`,
    60, startY + 30
  );

  // Grid: config / area / floor / view / price
  const cellsY = startY + 50;
  cell(doc, 60,  cellsY, "CONFIG",  u.configuration);
  cell(doc, 150, cellsY, "AREA",    `${u.carpetArea} sqft`);
  cell(doc, 240, cellsY, "FLOOR",   String(u.floor ?? "—"));
  cell(doc, 330, cellsY, "VIEW",    u.view ?? "—");
  cell(doc, 420, cellsY, "PRICE",   fmtMoney(u.priceBase, currency));

  doc.y = startY + 120;
  doc.moveDown(0.4);
}

function cell(doc: PDFKit.PDFDocument, x: number, y: number, label: string, value: string) {
  doc.fillColor(MUTED).font("Helvetica").fontSize(7).text(label, x, y);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(value, x, y + 10, { width: 90 });
}

function comparisonTable(doc: PDFKit.PDFDocument, units: UnitWithProject[], currency: string) {
  const startY = doc.y + 10;
  const colW = (doc.page.width - 100 - 110) / units.length;
  const rowLabels = [
    ["Project",       (u: UnitWithProject) => u.project.name],
    ["Area",          (u: UnitWithProject) => u.project.area ?? "—"],
    ["Configuration", (u: UnitWithProject) => u.configuration],
    ["Carpet area",   (u: UnitWithProject) => `${u.carpetArea} sqft`],
    ["Floor",         (u: UnitWithProject) => String(u.floor ?? "—")],
    ["View",          (u: UnitWithProject) => u.view ?? "—"],
    ["Status",        (u: UnitWithProject) => u.project.status.replaceAll("_", " ")],
    ["Price",         (u: UnitWithProject) => fmtMoney(u.priceBase, currency)],
  ] as const;

  let y = startY;
  for (const [label, getter] of rowLabels) {
    doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(9).text(label, 50, y, { width: 110 });
    units.forEach((u, i) => {
      doc.fillColor(INK).font("Helvetica").fontSize(9).text(String(getter(u)), 160 + colW * i, y, { width: colW - 5 });
    });
    y += 22;
    doc.moveTo(50, y - 4).lineTo(doc.page.width - 50, y - 4).strokeColor("#f1f2f6").lineWidth(0.5).stroke();
  }
  doc.y = y + 10;
}
