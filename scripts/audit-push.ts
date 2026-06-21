// scripts/audit-push.ts   (npx tsx scripts/audit-push.ts)  — READ-ONLY
// Why doesn't background mobile push fire? Check the 3 real gates:
//   1. Are there ANY PushSubscription rows? (0 → nobody enrolled → nothing to send)
//   2. Is TEST MODE on? (suppresses notification triggers regardless of code)
//   3. Are the VAPID env keys present? (no keys → webpush can't send)
import { prisma } from "../src/lib/prisma";

async function main() {
  console.log("════════════ MOBILE PUSH AUDIT (read-only) ════════════\n");

  // 1) Subscriptions
  const subs = await prisma.pushSubscription.findMany({
    select: { userId: true, userAgent: true, createdAt: true },
  });
  console.log(`PushSubscription rows: ${subs.length}`);
  if (subs.length) {
    const byUser = new Map<string, number>();
    for (const s of subs) byUser.set(s.userId, (byUser.get(s.userId) ?? 0) + 1);
    const users = await prisma.user.findMany({ where: { id: { in: [...byUser.keys()] } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    for (const [uid, n] of byUser) {
      console.log(`  • ${nameOf.get(uid) ?? uid}: ${n} device(s)`);
    }
    console.log("\n  Device user-agents:");
    for (const s of subs) console.log(`    - ${(s.userAgent ?? "?").slice(0, 70)}`);
  } else {
    console.log("  ⚠ ZERO subscriptions — no device has tapped Enable. Background push CANNOT fire for anyone.");
  }

  // 2) Test mode
  const settingRows = await prisma.$queryRawUnsafe<{ key: string; value: string }[]>(
    `SELECT key, value FROM "Setting" WHERE key ILIKE '%test%' OR key ILIKE '%notif%'`
  ).catch(() => []);
  console.log(`\nSettings (test/notif): ${settingRows.length ? "" : "(none found)"}`);
  for (const r of settingRows) console.log(`  ${r.key} = ${r.value}`);

  // 3) VAPID env
  console.log("\nVAPID env present:");
  for (const k of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "NEXT_PUBLIC_VAPID_PUBLIC_KEY"]) {
    console.log(`  ${k}: ${process.env[k] ? "SET" : "—(missing locally; may still be set on Vercel)"}`);
  }

  console.log("\n════════════ END ════════════");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
