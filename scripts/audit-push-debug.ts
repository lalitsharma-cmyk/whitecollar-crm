// scripts/audit-push-debug.ts   (npx tsx scripts/audit-push-debug.ts)  — READ-ONLY
// Dump the most recent push-enrolment diagnostics so we can see what each device
// (esp. iPhones) reports when tapping Enable. Pairs with /api/push/debug.
import { prisma } from "../src/lib/prisma";

async function main() {
  const rows = await prisma.auditLog.findMany({
    where: { action: "push.debug" },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { user: { select: { name: true } } },
  }).catch(() => [] as never[]);

  if (!rows.length) {
    console.log("No push.debug events yet. Ask an affected user to open the CRM and tap Enable once, then re-run.");
    console.log("(Also confirm there are still 0 rows: npx tsx scripts/audit-push.ts)");
    return;
  }
  console.log(`Last ${rows.length} push.debug events (newest first):\n`);
  for (const r of rows as Array<{ createdAt: Date; user: { name: string } | null; meta: string | null }>) {
    let m: Record<string, unknown> = {};
    try { m = r.meta ? JSON.parse(r.meta) : {}; } catch {}
    const when = new Date(r.createdAt.getTime() + 330 * 60000).toISOString().replace("T", " ").slice(0, 19);
    console.log(`${when} IST · ${r.user?.name ?? "?"} · ${m.context}/${m.result}` +
      ` · perm=${m.permission} ios=${m.ios} standalone=${m.standalone} saved=${m.saved}` +
      (m.error ? ` · ERR: ${m.error}` : "") +
      `\n    ${String(m.ua ?? "").slice(0, 110)}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
