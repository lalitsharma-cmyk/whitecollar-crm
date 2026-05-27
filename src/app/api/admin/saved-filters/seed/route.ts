// Bulk-seed starter Smart Lists from src/lib/savedFilterSeeds.ts.
//
// Admin only. Inserts each preset as a SYSTEM filter (createdById = null) so
// every user sees them in the SavedFiltersBar. Idempotent — skips any name
// already present in the system-seed namespace, so an admin can safely re-run
// this after we add new presets to the seed file.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { canonicalizeQuery } from "@/lib/savedFilters";
import { SAVED_FILTER_SEEDS } from "@/lib/savedFilterSeeds";

export const dynamic = "force-dynamic";

export async function POST() {
  await requireRole("ADMIN");

  // System-seed namespace = createdById IS NULL. We only dedupe against other
  // system seeds — a user's personal filter named "Hot today" should not block
  // us from creating the system version.
  const existing = await prisma.savedFilter.findMany({
    where: { createdById: null, name: { in: SAVED_FILTER_SEEDS.map((s) => s.name) } },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((f) => f.name));

  const toCreate = SAVED_FILTER_SEEDS.filter((s) => !existingNames.has(s.name));
  const skipped = SAVED_FILTER_SEEDS.length - toCreate.length;

  if (toCreate.length > 0) {
    await prisma.savedFilter.createMany({
      data: toCreate.map((s) => ({
        name: s.name,
        icon: s.icon,
        // Canonicalise so chip-match (queriesMatch) lines up with URLs the user
        // builds via the filter UI — same logic the user-facing POST runs.
        queryString: canonicalizeQuery(s.queryString),
        sortOrder: s.sortOrder,
        isShared: true,
        createdById: null,
      })),
    });
  }

  return NextResponse.json({
    ok: true,
    created: toCreate.length,
    skipped,
  });
}
