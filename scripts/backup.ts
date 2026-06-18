// Pre-deploy snapshot — READ-ONLY export of business-critical tables to a gzipped
// JSON under backups/pre-deploy-<ts>/. Zero writes, safe to run on live prod any
// time. Wired into scripts/deploy.sh so every deploy is preceded by a backup
// (Production Safety Rule #2). Restore guidance: docs/DEPLOY_SAFETY.md.
import { prisma } from "../src/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join("backups", `pre-deploy-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  // Business-critical records. Users WITHOUT password hashes. High-volume tables
  // (notifications, audit) bounded to the most recent rows to keep the file small.
  const data: Record<string, unknown> = {
    _meta: { stamp, commit: process.env.DEPLOY_COMMIT ?? null, note: "WCR CRM pre-deploy snapshot" },
    users:         await prisma.user.findMany({ select: { id: true, email: true, name: true, role: true, team: true, active: true, isSuperAdmin: true, hrOnly: true } }),
    leads:         await prisma.lead.findMany(),
    activities:    await prisma.activity.findMany(),
    notes:         await prisma.note.findMany(),
    assignments:   await prisma.assignment.findMany(),
    fieldHistory:  await prisma.leadFieldHistory.findMany(),
    callLogs:      await prisma.callLog.findMany(),
    stickyNotes:   await prisma.stickyNote.findMany(),
    importBatches: await prisma.importBatch.findMany(),
    devices:       await prisma.device.findMany(),
    notifications: await prisma.notification.findMany({ take: 5000, orderBy: { createdAt: "desc" } }),
    auditLogs:     await prisma.auditLog.findMany({ take: 10000, orderBy: { createdAt: "desc" } }),
  };

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  const file = path.join(dir, "snapshot.json.gz");
  fs.writeFileSync(file, gz);

  const counts = Object.fromEntries(
    Object.entries(data).filter(([k]) => k !== "_meta").map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]),
  );
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ stamp, file: "snapshot.json.gz", bytes: gz.length, counts }, null, 2));

  console.log(`✅ Backup → ${file} (${(gz.length / 1024).toFixed(0)} KB)`);
  console.log(`   ${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  ")}`);
  console.log(`BACKUP_DIR=${dir}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("❌ BACKUP FAILED:", e); process.exit(1); });
