import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { parseJsonArray, formatTxnValue, inferBuyerCurrency } from "@/lib/buyerIntelligence";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

// Buyer Data CSV export — ADMIN ONLY (passport + financial data). Watermarked +
// audited like the lead export so a leaked file traces back to the downloader.
// Filtering options (both still ADMIN-only + still deletedAt-excluded + audited):
//   • GET  ?project=          → one project (used by the project-buyers section).
//   • POST { buyerIds:[…] }   → the exact rows the table currently shows, so the
//                               CSV reflects ALL active header/top/search filters
//                               (the table is client-side; this hands the visible
//                               id set to the audited server export). Capped 20k.

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

async function buildExport(
  req: NextRequest,
  me: { id: string; email: string; name: string },
  where: Record<string, unknown>,
  note: string | null,
) {
  // Market — Dubai by default; ?market=India exports the India-market set. Admin-only
  // route (both handlers 403 non-admins), so an admin may export either market.
  const market = new URL(req.url).searchParams.get("market") === "India" ? "India" : "Dubai";
  const records = await prisma.buyerRecord.findMany({
    // Recycle-bin records never exported; one market at a time (no cross-market mixing).
    where: { deletedAt: null, market, ...where },
    orderBy: { transactionDate: "desc" },
  });

  const rows = records.map((r) => {
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source });
    return {
      id: r.id,
      clientName: r.clientName,
      coBuyers: parseJsonArray(r.coBuyerNames).join("; "),
      phones: parseJsonArray(r.phones).join("; "),
      emails: parseJsonArray(r.emails).join("; "),
      passport: r.passport ?? "",
      nationality: r.nationality ?? "",
      developer: r.developer ?? "",
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
  });
  const csv = toCsv(rows);
  const format = new URL(req.url).searchParams.get("format")?.toLowerCase() === "xlsx" ? "xlsx" : "csv";

  const stamp = new Date().toISOString();
  const watermarkLines = [
    `# Confidential ${market} Buyer Data export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Rows: ${records.length}${note ? `  ·  ${note}` : ""}  ·  Contains passport & financial data — do NOT share outside the company.`,
  ];
  const footer = `\r\n# Exported by ${me.name} at ${stamp} — confidential\r\n`;

  await audit({
    userId: me.id,
    action: "export.buyer-data",
    entity: "BuyerRecord",
    meta: { rowCount: records.length, market, format, note: note ?? undefined },
    request: reqMeta(req),
  });

  const base = `wcr-${market.toLowerCase()}-buyer-data-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), `${market} Buyers`);
    const infoRows = [...watermarkLines.map((l) => ({ Info: l.replace(/^# ?/, "") })), { Info: footer.trim().replace(/^# ?/, "") }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(infoRows, { skipHeader: true }), "Export Info");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  }
  return new Response(watermarkLines.join("\r\n") + "\r\n" + csv + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${base}.csv"`,
    },
  });
}

export async function GET(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const project = new URL(req.url).searchParams.get("project")?.trim() || null;
  return buildExport(req, me, project ? { projectName: { equals: project, mode: "insensitive" } } : {}, project ? `Project: ${project}` : null);
}

// POST { buyerIds } → export exactly the filtered set the table currently shows.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.buyerIds) ? body.buyerIds.filter((x: unknown): x is string => typeof x === "string").slice(0, 20000) : [];
  if (ids.length === 0) return NextResponse.json({ error: "No rows to export" }, { status: 400 });
  return buildExport(req, me, { id: { in: ids } }, `Filtered selection (${ids.length} rows)`);
}
