import { type NextRequest } from "next/server";
import { requireHrPermission, hrScopeWhere } from "@/lib/hrAccess";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { statusLabel } from "@/lib/hrStatus";

const COLS: [string, (c: Cand) => string][] = [
  ["Name", c => c.name],
  ["Phone", c => c.phone ?? ""],
  ["WhatsApp", c => c.whatsappPhone ?? ""],
  ["Email", c => c.email ?? ""],
  ["Location", c => c.location ?? ""],
  ["City", c => c.city ?? ""],
  ["Position Applied", c => c.positionApplied ?? ""],
  ["Current Company", c => c.currentCompany ?? ""],
  ["Current Profile", c => c.currentProfile ?? ""],
  ["Total Experience", c => c.experience ?? ""],
  ["RE Experience", c => c.realEstateExperience ?? ""],
  ["Current Salary", c => c.currentSalary != null ? String(c.currentSalary) : ""],
  ["Expected Salary", c => c.expectedSalary != null ? String(c.expectedSalary) : ""],
  ["Notice Period", c => c.noticePeriod ?? ""],
  ["Source", c => c.source ?? ""],
  ["Status", c => statusLabel(c.status)],
  ["Next Action", c => c.nextAction ?? ""],
  ["Follow-Up Date", c => c.nextActionDate ? new Date(c.nextActionDate).toISOString().slice(0, 10) : ""],
  ["Joining Date", c => c.joiningDate ? new Date(c.joiningDate).toISOString().slice(0, 10) : ""],
  ["Owner", c => c.primaryOwner?.name ?? ""],
  ["Remarks", c => c.remarks ?? ""],
  ["Added", c => new Date(c.createdAt).toISOString().slice(0, 10)],
];
type Cand = Prisma.HRCandidateGetPayload<{ include: { primaryOwner: { select: { name: true } } } }>;
function cell(s: string) { return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

// Server export (CSV) — supports All + filtered (status/position/source/date) + selected ids.
export async function GET(req: NextRequest) {
  const access = await requireHrPermission("exportData");
  if (access.error) return access.error;
  const { me } = access;
  const sp = req.nextUrl.searchParams;

  const filter: Prisma.HRCandidateWhereInput = {};
  const ids = sp.get("ids");
  if (ids) filter.id = { in: ids.split(",").filter(Boolean) };
  const status = sp.get("status"); if (status) filter.status = status as Cand["status"];
  const position = sp.get("position"); if (position) filter.positionApplied = position;
  const source = sp.get("source"); if (source) filter.source = source;
  const from = sp.get("from"), to = sp.get("to");
  if (from || to) filter.createdAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + "T23:59:59") } : {}) };

  // Defense-in-depth: scope exported rows to what the caller may see.
  const where: Prisma.HRCandidateWhereInput = { AND: [hrScopeWhere(me), filter] };

  const candidates = await prisma.hRCandidate.findMany({
    where, orderBy: { createdAt: "desc" }, take: 25000,
    include: { primaryOwner: { select: { name: true } } },
  });

  const csv = [COLS.map(c => c[0]).join(","), ...candidates.map(c => COLS.map(([, f]) => cell(f(c))).join(","))].join("\n");
  return new Response("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="candidates-${new Date().toISOString().slice(0, 10)}.csv"` },
  });
}
