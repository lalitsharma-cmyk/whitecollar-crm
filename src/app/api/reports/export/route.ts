import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";

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
  await requireUser();
  const type = new URL(req.url).searchParams.get("type") ?? "leads";

  let csv = "", filename = "export.csv";
  if (type === "leads") {
    const leads = await prisma.lead.findMany({ include: { owner: true } });
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
    csv = toCsv(calls.map(c => ({
      id: c.id, startedAt: c.startedAt.toISOString(), lead: c.lead?.name ?? c.phoneNumber,
      agent: c.user.name, direction: c.direction, outcome: c.outcome, durationSec: c.durationSec,
      notes: c.notes,
    })));
    filename = `calls-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
