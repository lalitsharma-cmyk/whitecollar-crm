import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { parseJsonArray, formatTxnValue, inferBuyerCurrency } from "@/lib/buyerIntelligence";
import { NextResponse } from "next/server";

// Buyer Data CSV export — ADMIN ONLY (passport + financial data). Watermarked +
// audited like the lead export so a leaked file traces back to the downloader.
// Optional ?project= filters to one project (used by the project-buyers section).

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\r\n");
}
const IST_OFFSET_MS = 330 * 60 * 1000;
function istDate(d: Date | null): string {
  if (!d) return "";
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const url = new URL(req.url);
  const project = url.searchParams.get("project")?.trim() || null;

  const records = await prisma.buyerRecord.findMany({
    where: {
      deletedAt: null, // recycle-bin records never exported
      ...(project ? { projectName: { equals: project, mode: "insensitive" } } : {}),
    },
    orderBy: { transactionDate: "desc" },
  });

  const csv = toCsv(records.map((r) => {
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source });
    return {
      id: r.id,
      clientName: r.clientName,
      coBuyers: parseJsonArray(r.coBuyerNames).join("; "),
      phones: parseJsonArray(r.phones).join("; "),
      emails: parseJsonArray(r.emails).join("; "),
      passport: r.passport ?? "",
      nationality: r.nationality ?? "",
      project: r.projectName ?? "",
      tower: r.tower ?? "",
      unit: r.unitNumber ?? "",
      propertyType: r.propertyType ?? "",
      configuration: r.configuration ?? "",
      transactionValue: r.transactionValue ?? "",
      transactionValueDisplay: formatTxnValue(r.transactionValue, ccy),
      pricePerSqFt: r.pricePerSqFt ?? "",
      transactionDate: istDate(r.transactionDate),
      transactionId: r.transactionId ?? "",
      agent: r.agentName ?? "",
      source: r.source ?? "",
      buyerKey: r.buyerKey ?? "",
      createdAt: istDate(r.createdAt),
    };
  }));

  const stamp = new Date().toISOString();
  const watermark = [
    `# Confidential buyer-data export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Rows: ${records.length}${project ? `  ·  Project: ${project}` : ""}  ·  Contains passport & financial data — do NOT share outside the company.`,
    "",
  ].join("\r\n");
  const footer = `\r\n# Exported by ${me.name} at ${stamp} — confidential\r\n`;

  await audit({
    userId: me.id,
    action: "export.buyer-data",
    entity: "BuyerRecord",
    meta: { rowCount: records.length, project: project ?? undefined },
    request: reqMeta(req),
  });

  const filename = `wcr-buyer-data-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
  return new Response(watermark + csv + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
