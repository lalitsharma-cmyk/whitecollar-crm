// Backup status → Admin notification. Called by the db-backup GitHub Actions
// workflow after each daily backup (success or failure). Pure backup-automation:
// it only sends a notification, touches NO lead/CRM data. Auth: bearer CRON_SECRET.
import { NextResponse, type NextRequest } from "next/server";
import { notifyRoles } from "@/lib/notify";
import { startCronRun, finishCronRun } from "@/lib/cronRun";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const ok = String(body.status ?? "") === "ok";
  const detail = String(body.detail ?? "").slice(0, 400);

  const runId = await startCronRun("backup-report");
  try {
    await notifyRoles(["ADMIN"], {
      kind: "SYSTEM",
      severity: ok ? "INFO" : "CRITICAL",
      title: ok ? "✅ Database backup completed" : "🔴 Database backup FAILED",
      body: detail || (ok
        ? "Daily database backup uploaded to Google Drive."
        : "Daily database backup FAILED — check the GitHub Actions run and docs/BACKUP_SETUP.md."),
      linkUrl: "/admin/cron-health",
      email: true, // backup status always emails admins (success + failure)
    });
    await finishCronRun(runId, "OK", undefined, { ok, detail });
    return NextResponse.json({ ok: true });
  } catch (e) {
    await finishCronRun(runId, "ERROR", String(e));
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
