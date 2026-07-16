import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { canExportData, EXPORT_DENIED } from "@/lib/exportPerms";
import { audit, reqMeta } from "@/lib/audit";
import {
  buildIntakeReport,
  resolveIntakeParams,
  MODULE_LABELS,
} from "@/app/(app)/reports/lead-intake/intake";
import * as XLSX from "xlsx";

// ─────────────────────────────────────────────────────────────────────────
// Lead Source Intake export — ADMIN ONLY, audited (mirrors the
// agent-performance export gate exactly).
//   ?format=csv (default) | xlsx
//   ?grain=daily|weekly|monthly|yearly|custom (&from=&to= for custom)
//   ?team=all|Dubai|India · ?module=all|leads|master|revival|dubai-buyer|
//   india-buyer · ?source=<verbatim sourceRaw>|all
// Same params as /reports/lead-intake; the numbers come from the SAME
// buildIntakeReport the on-screen report renders (single source of truth), so
// the exported summary + source×date matrix equal the page for the active
// filters. CSV is watermarked with the downloader's identity.
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

  const params = await resolveIntakeParams(sp, me);
  const report = await buildIntakeReport(me, params);

  // ── Summary section ─────────────────────────────────────────────────────
  const summaryRows: (string | number)[][] = [
    ["Period", report.rangeLabel],
    ["Grain", params.grain === "custom" ? `custom (${params.bucketGrain} buckets)` : params.grain],
    ["Team", params.team],
    ["Module", MODULE_LABELS[params.module]],
    ["Source filter", params.source],
    ["Total received", report.summary.total.n],
    ["Received today", report.summary.today.n],
    ["Assigned", report.summary.assigned.n],
    [report.isBuyerView ? "In pool" : "Unassigned", report.summary.unassigned.n],
    ["Converted", report.summary.converted.n],
    [report.isBuyerView ? "Rejected" : "Rejected / Lost", report.summary.lost.n],
  ];
  if (report.summary.lostRemainder) {
    summaryRows.push(["Rejected (workable status remainder)", report.summary.lostRemainder.n]);
  }
  if (report.unstatused) {
    // Unclassified-data directive: visible bucket, in no lifecycle category.
    summaryRows.push(["Missing status (in Total, in no lifecycle card)", report.unstatused.n]);
  }
  for (const s of report.buyerStrips) {
    summaryRows.push(
      [`${s.label} — total`, s.total.n],
      [`${s.label} — in pool`, s.pool.n],
      [`${s.label} — assigned`, s.assigned.n],
      [`${s.label} — converted`, s.converted.n],
      [`${s.label} — rejected`, s.rejected.n],
    );
  }

  // ── Source × Date matrix for the ACTIVE filters ─────────────────────────
  // Rows = verbatim source buckets (as on the page, incl. the visible
  // "Unclassified (no source)" bucket), columns = the report's date buckets,
  // then Total / Converted / Conversion %. report.sourceBucketMatrix is built
  // by buildIntakeReport from the SAME per-module envelopes the page's drills
  // use, so Σcells reconciles with the on-screen tables exactly.
  const bucketLabels = report.buckets.map((b) => b.label);
  const matrixHeader = ["Source", ...bucketLabels, "Total", "Converted", "Conversion %"];
  const matrix: (string | number)[][] = report.sourceBucketMatrix.map((row) => [
    row.label,
    ...row.perBucket,
    row.total,
    row.converted ?? "—",
    row.convPct == null ? "—" : `${row.convPct.toFixed(1)}%`,
  ]);
  // Bucket totals footer — reconciles with the page's date-wise table.
  matrix.push([
    "TOTAL",
    ...report.buckets.map((b) => report.dateRows.find((d) => d.bucket.key === b.key)?.count.n ?? 0),
    report.summary.total.n,
    report.isBuyerView ? "—" : report.summary.converted.n,
    "",
  ]);

  const format = sp.format === "xlsx" ? "xlsx" : "csv";
  const stamp = new Date().toISOString();
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const scopeTag = `${params.module}-${params.grain}${params.team !== "all" ? `-${params.team}` : ""}`;

  await audit({
    userId: me.id,
    action: "export.lead_intake",
    entity: "Lead",
    meta: {
      format,
      grain: params.grain,
      from: params.fromKey,
      to: params.toKey,
      team: params.team,
      module: params.module,
      source: params.source,
      total: report.summary.total.n,
    },
    request: reqMeta(req),
  });

  if (format === "xlsx") {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Metric", "Value"], ...summaryRows]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([matrixHeader, ...matrix]), "Source x Date");
    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const filename = `wcr-lead-intake-${scopeTag}-${dateTag}.xlsx`;
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // CSV (RFC 4180, CRLF) + watermark header/footer — same idiom as the
  // agent-performance export.
  const lines: string[] = ["Metric,Value"];
  for (const r of summaryRows) lines.push(r.map(csvEscape).join(","));
  lines.push("");
  lines.push(matrixHeader.map(csvEscape).join(","));
  for (const r of matrix) lines.push(r.map(csvEscape).join(","));
  const body = lines.join("\r\n");
  const watermark = [
    `# Confidential lead-intake export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Period: ${report.rangeLabel}  ·  Team: ${params.team}  ·  Module: ${MODULE_LABELS[params.module]}  ·  Source: ${params.source}`,
    `# Sharing this file outside the company breaches the Data Handling policy.`,
    "",
  ].join("\r\n");
  const footer = `\r\n# Exported by ${me.name} at ${stamp} — confidential\r\n`;
  const filename = `wcr-lead-intake-${scopeTag}-${dateTag}.csv`;

  return new Response(watermark + body + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
