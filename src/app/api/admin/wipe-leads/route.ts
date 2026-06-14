import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { getTestingModeEnabled } from "@/lib/settings";

// SUPER-ADMIN + TESTING-MODE ONLY: wipe all leads + their children. This is a
// destructive *testing* tool (retry imports cleanly on a throwaway dataset).
// It is hard-guarded so it can NEVER fire against live production data:
//   1. caller must be a Super Admin (not just any ADMIN),
//   2. Testing Mode must be ON — in live mode this refuses outright,
//   3. the body must carry the exact confirmation phrase.
// Live leads (Lalit/Tanuj/Mehak and team) are therefore protected from an
// accidental mass delete. For removing a single mistaken import, use the
// reversible import rollback/purge flow instead (/api/intake/history/[id]).
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (!me.isSuperAdmin) {
    return NextResponse.json({ error: "Only a Super Admin may wipe leads." }, { status: 403 });
  }
  const testing = await getTestingModeEnabled();
  if (!testing) {
    return NextResponse.json(
      { error: "Refused: lead wipe is only allowed while Testing Mode is ON. Live data is protected." },
      { status: 403 },
    );
  }
  const body = await req.json().catch(() => ({} as { confirm?: unknown }));
  if (body?.confirm !== "WIPE ALL LEADS") {
    return NextResponse.json(
      { error: 'Refused: missing confirmation. Send { "confirm": "WIPE ALL LEADS" } to proceed.' },
      { status: 400 },
    );
  }

  const before = await prisma.lead.count();
  await prisma.activity.deleteMany({});
  await prisma.callLog.deleteMany({});
  await prisma.note.deleteMany({});
  await prisma.assignment.deleteMany({});
  await prisma.leadProperty.deleteMany({});
  await prisma.leadProject.deleteMany({});
  await prisma.whatsAppMessage.deleteMany({});
  const r = await prisma.lead.deleteMany({});
  await audit({ userId: me.id, action: "admin.wipe-leads", entity: "Lead",
    meta: { before, deleted: r.count }, request: reqMeta(req) });
  return NextResponse.json({ ok: true, deletedLeads: r.count, before });
}
