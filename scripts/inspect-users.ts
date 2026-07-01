import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const users = await p.user.findMany({
    select: { id: true, name: true, email: true, role: true, team: true, active: true },
    orderBy: { name: "asc" },
  });
  console.log("Users in production:");
  for (const u of users) {
    console.log(`  [${u.role.padEnd(7)}] ${u.name.padEnd(22)} ${u.email.padEnd(40)} team=${u.team ?? "—"} active=${u.active}`);
  }
  // Call-log attribution distribution
  const callLogs = await p.callLog.groupBy({
    by: ["userId"],
    _count: { _all: true },
  });
  console.log("\nCall logs by attributed user:");
  const byUser = new Map(users.map((u) => [u.id, u.name]));
  for (const c of callLogs) {
    const name = (c.userId ? byUser.get(c.userId) : null) ?? `<deleted: ${(c.userId ?? "").slice(0, 8)}>`;
    console.log(`  ${name.padEnd(25)} ${c._count._all} calls`);
  }
  await p.$disconnect();
})();
