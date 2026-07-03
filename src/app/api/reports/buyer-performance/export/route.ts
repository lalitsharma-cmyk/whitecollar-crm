import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { canExportData, EXPORT_DENIED } from "@/lib/exportPerms";
import { audit, reqMeta } from "@/lib/audit";
import { normalizeTeam } from "@/lib/teamRouting";
import {
  buildBuyerReport,
  resolveDateRange,
  BUYER_METRIC_COLUMNS,
  type BuyerReportScope,
} from "@/lib/buyerPerformance";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────
// Buyer Performance export — ADMIN ONLY, audited.
//   ?format=csv (default) | xlsx
//   ?range=…&from=…&to=…  — same window as the report page.
//   ?team=India|Dubai     — optional scope (admin).
// One row per agent, one column per metric (BUYER_METRIC_COLUMNS — the single
// source of truth shared with the on-screen table). CSV is watermarked with the
// downloader's identity, matching /api/reports/agent-performance/export.
// ─────────────────────────────────────────────────────────────────────────

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const me = await requireRole("ADMIN");
  if (!canExportData(me)) return NextResponse.json({ error: EXPORT_DENIED }, { status: 403 });
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries()) as Record<string, string | undefined>;

  const range = resolveDateRange(sp.range, sp.from, sp.to);
  const team = sp.team === "India" || sp.team === "Dubai" ? sp.team : null;
  const scope: BuyerReportScope = { role: "ADMIN", meId: me.id, team };
  // (normalizeTeam imported for parity with other report routes; team already validated.)
  void normalizeTeam;

  const rows = await buildBuyerReport(range, scope);

  const headers = BUYER_METRIC_COLUMNS.map((c) => c.label);
  const matrix: (string | number)[][] = rows.map((m) => BUYER_METRIC_COLUMNS.map((c) => c.get(m)));

  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  const stamp = new Date().toISOString();
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const scopeTag = `${range.preset}${team ? `-${team}` : ""}`;

  await audit({
    userId: me.id,
    action: "export.buyer_performance",
    entity: "BuyerRecord",
    meta: { rowCount: rows.length, format, range: range.preset, team: team ?? "all" },
    request: reqMeta(req),
  });

  if (format === "xlsx") {
    const ws = XLSX.utils.aoa_to_sheet([headers, ...matrix]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dubai Buyer Performance");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `wcr-dubai-buyer-performance-${scopeTag}-${dateTag}.xlsx`;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // CSV (RFC 4180, CRLF) + watermark header/footer.
  const lines = [headers.join(",")];
  for (const r of matrix) lines.push(r.map(csvEscape).join(","));
  const body = lines.join("\r\n");
  const watermark = [
    `# Confidential Dubai Buyer Data performance export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Period: ${range.label}  ·  Market: Dubai  ·  Agents: ${rows.length}`,
    `# Sharing this file outside the company breaches the Data Handling policy.`,
    "",
  ].join("\r\n");
  const footer = `\r\n# Exported by ${me.name} at ${stamp} — confidential\r\n`;
  const filename = `wcr-dubai-buyer-performance-${scopeTag}-${dateTag}.csv`;

  return new Response(watermark + body + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
