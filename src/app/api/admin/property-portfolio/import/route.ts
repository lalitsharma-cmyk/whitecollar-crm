// POST /api/admin/property-portfolio/import
//
// Admin-only. Accepts a JSON array of PropertyPortfolio rows and bulk-imports
// them, linking each record to an existing CustomerProfile when the phone
// matches (primaryPhone or secondaryPhone).
//
// Request body:
//   { rows: PortfolioImportRow[] }
//
// Response:
//   { imported: number, linked: number, unlinked: number }
//
// Auth: ADMIN only.

import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface PortfolioImportRow {
  ownerName: string;
  primaryPhone?: string | null;
  secondaryPhone?: string | null;
  project: string;
  tower?: string | null;
  unit?: string | null;
  bedrooms?: string | null;
  transactionValueAed?: number | null;
  actualSizeSqft?: number | null;
  agentName?: string | null;
  status?: string | null;
  date?: string | null;         // ISO date string or any Date-parseable value
  remarks?: string | null;
  importSource?: string | null;
}

export async function POST(req: NextRequest) {
  await requireRole("ADMIN");

  let body: { rows?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json(
      { error: "Body must be { rows: PortfolioImportRow[] }" },
      { status: 400 }
    );
  }

  const rows = body.rows as PortfolioImportRow[];
  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, linked: 0, unlinked: 0 });
  }

  let imported = 0;
  let linked = 0;
  let unlinked = 0;

  for (const row of rows) {
    if (!row.ownerName || !row.project) continue; // skip invalid rows

    // Collect all phones to try for profile matching
    const phones: string[] = [row.primaryPhone, row.secondaryPhone]
      .filter((p): p is string => typeof p === "string" && p.trim() !== "");

    let profileId: string | null = null;

    // Find a matching CustomerProfile by phone
    if (phones.length > 0) {
      const profile = await prisma.customerProfile.findFirst({
        where: {
          OR: [
            { primaryPhone: { in: phones } },
            { secondaryPhone: { in: phones } },
          ],
        },
        select: { id: true },
      });
      profileId = profile?.id ?? null;
    }

    // Parse date if provided
    let parsedDate: Date | null = null;
    if (row.date) {
      const d = new Date(row.date);
      if (!isNaN(d.getTime())) parsedDate = d;
    }

    await prisma.propertyPortfolio.create({
      data: {
        ownerName: row.ownerName.trim(),
        primaryPhone: row.primaryPhone?.trim() ?? null,
        secondaryPhone: row.secondaryPhone?.trim() ?? null,
        project: row.project.trim(),
        tower: row.tower?.trim() ?? null,
        unit: row.unit?.trim() ?? null,
        bedrooms: row.bedrooms?.trim() ?? null,
        transactionValueAed: typeof row.transactionValueAed === "number" ? row.transactionValueAed : null,
        actualSizeSqft: typeof row.actualSizeSqft === "number" ? row.actualSizeSqft : null,
        agentName: row.agentName?.trim() ?? null,
        status: row.status?.trim() ?? null,
        date: parsedDate,
        remarks: row.remarks?.trim() ?? null,
        importSource: row.importSource?.trim() ?? null,
        profileId: profileId ?? undefined,
      },
    });

    imported++;
    if (profileId) linked++; else unlinked++;
  }

  return NextResponse.json({ imported, linked, unlinked });
}
