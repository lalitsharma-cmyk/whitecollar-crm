// /api/leads/check-duplicate — read-only dedup probe (B-01 dedup groundwork)
//
// Called by <DedupWarning> client component when the user stops typing in the
// phone or email field on /leads/new (and the QuickAddLeadFab).
//
// Method: GET   (safe / cacheable — no side effects)
// Query params:
//   phone  — raw or E.164 phone (optional)
//   email  — email address (optional)
//
// Response: { duplicates: DuplicateMatch[] }
//
// Auth: any authenticated user (same session check as all app routes).
// No role restriction — AGENT/MANAGER/ADMIN all need to see dup warnings.

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { findPossibleDuplicates } from "@/lib/dedup";
import { leadScopeWhere } from "@/lib/leadScope";

export interface DuplicateMatch {
  id: string;
  name: string;
  status: string;
  ownerName: string | null;
}

export async function GET(req: NextRequest) {
  let me: Awaited<ReturnType<typeof requireUser>>;
  try {
    // Auth check — same pattern as other read-only API routes.
    me = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const phone = searchParams.get("phone") ?? undefined;
  const email = searchParams.get("email") ?? undefined;

  if (!phone && !email) {
    return NextResponse.json({ duplicates: [] });
  }

  // Scope the probe to what THIS user is allowed to see (audit B-02 class):
  // AGENT → only their own leads, MANAGER → own + report tree, ADMIN → all.
  // This stops the dedup warning from disclosing a teammate's lead name/owner.
  const scope = await leadScopeWhere(me);
  const leads = await findPossibleDuplicates({ phone, email, scope });

  const duplicates: DuplicateMatch[] = leads.map((l) => ({
    id: l.id,
    name: l.name,
    status: l.status,
    ownerName: l.owner?.name ?? null,
  }));

  return NextResponse.json({ duplicates });
}
