import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedLead } from "@/lib/leadScope";
import { fmtIST } from "@/lib/datetime";
import { audit, reqMeta } from "@/lib/audit";

/**
 * GET /api/leads/[id]/activity-csv
 *
 * Downloads the COMPLETE chronological history of one lead — Activities,
 * CallLogs and Notes merged into a single CSV. Ownership-scoped via
 * loadOwnedLead so an agent can only export their own leads (manager/admin
 * scope follows the same rules as the rest of the app).
 *
 * Columns: timestamp_ist, type, title, description, agent, duration_sec, outcome
 */

// RFC-4180-ish CSV cell escape: wrap in quotes when the value contains a
// comma, quote, or newline; double up embedded quotes.
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

interface Row {
  ts: Date;
  type: string;
  title: string;
  description: string;
  agent: string;
  durationSec: string;
  outcome: string;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me, lead } = scoped;

  const [activities, callLogs, notes] = await Promise.all([
    prisma.activity.findMany({
      where: { leadId: id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.callLog.findMany({
      where: { leadId: id },
      include: { user: { select: { name: true } } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.note.findMany({
      where: { leadId: id },
      include: { user: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const rows: Row[] = [];

  for (const a of activities) {
    rows.push({
      ts: a.completedAt ?? a.scheduledAt ?? a.createdAt,
      type: a.type,
      title: a.title,
      description: a.description ?? "",
      agent: a.user?.name ?? "System",
      durationSec: "",
      outcome: a.status,
    });
  }
  for (const c of callLogs) {
    rows.push({
      ts: c.startedAt,
      type: `CALL_${c.direction}`,
      title: `Call · ${c.outcome.replaceAll("_", " ")}`,
      description: c.notes ?? "",
      // Live-logged calls use user.name; MIS-imported ones carry the parsed agent.
      agent: c.attributedAgentName ?? c.user?.name ?? "—",
      durationSec: c.durationSec != null ? String(c.durationSec) : "",
      outcome: c.outcome,
    });
  }
  for (const n of notes) {
    rows.push({
      ts: n.createdAt,
      type: "NOTE",
      title: "Note",
      description: n.body,
      agent: n.user?.name ?? "—",
      durationSec: "",
      outcome: "",
    });
  }

  // Newest first across all three sources.
  rows.sort((a, b) => b.ts.getTime() - a.ts.getTime());

  const header = ["timestamp_ist", "type", "title", "description", "agent", "duration_sec", "outcome"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      csvCell(`${fmtIST(r.ts)} IST`),
      csvCell(r.type),
      csvCell(r.title),
      csvCell(r.description),
      csvCell(r.agent),
      csvCell(r.durationSec),
      csvCell(r.outcome),
    ].join(","));
  }
  // CRLF line endings — Excel-friendly.
  const csv = lines.join("\r\n") + "\r\n";

  // Audit the export so a leak of one lead's full history is traceable.
  const { ip, userAgent } = reqMeta(req);
  await audit({
    userId: me.id,
    action: "lead.activity-export",
    entity: "Lead",
    entityId: id,
    meta: { rows: rows.length },
    request: { ip, userAgent },
  });

  const datePart = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const filename = `wcr-lead-${id.slice(0, 8)}-${datePart}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
