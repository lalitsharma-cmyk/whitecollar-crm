import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

// CSV export — ADMIN ONLY. Every export is audited and the CSV is watermarked
// with the downloader's email + timestamp, so a leaked file traces back to
// the person who took it.

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const type = new URL(req.url).searchParams.get("type") ?? "leads";

  let csv = "", filename = "export.csv", rowCount = 0;
  if (type === "leads") {
    const leads = await prisma.lead.findMany({ include: { owner: true } });
    rowCount = leads.length;
    csv = toCsv(leads.map(l => ({
      id: l.id, name: l.name, phone: l.phone, email: l.email,
      source: l.source, status: l.status, city: l.city, country: l.country,
      configuration: l.configuration, budgetMin: l.budgetMin, budgetMax: l.budgetMax,
      aiScore: l.aiScore, aiScoreValue: l.aiScoreValue, owner: l.owner?.name,
      lastTouchedAt: l.lastTouchedAt?.toISOString(), createdAt: l.createdAt.toISOString(),
    })));
    filename = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  } else if (type === "calls") {
    const calls = await prisma.callLog.findMany({ include: { lead: true, user: true } });
    rowCount = calls.length;
    csv = toCsv(calls.map(c => ({
      id: c.id, startedAt: c.startedAt.toISOString(), lead: c.lead?.name ?? c.phoneNumber,
      agent: c.user.name, direction: c.direction, outcome: c.outcome, durationSec: c.durationSec,
      notes: c.notes,
    })));
    filename = `calls-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  // Watermark — first 3 lines are a comment header. Excel ignores them as long
  // as they start with "#"; lets us trace any leaked CSV back to the downloader.
  const stamp = new Date().toISOString();
  const watermark = [
    `# Confidential export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Type: ${type}  ·  Rows: ${rowCount}  ·  Sharing this file outside the company breaches the Data Handling policy.`,
    "",
  ].join("\n");

  await audit({
    userId: me.id,
    action: `export.${type}`,
    entity: type === "leads" ? "Lead" : "CallLog",
    meta: { rowCount, filename },
    request: reqMeta(req),
  });

  return new Response(watermark + csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
