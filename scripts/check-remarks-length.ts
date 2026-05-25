import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const leads = await p.lead.findMany({
    where: { remarks: { not: null } },
    select: { name: true, remarks: true, callLogs: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  for (const l of leads) {
    const len = (l.remarks ?? "").length;
    const lines = (l.remarks ?? "").split(/\r?\n/).length;
    const dates = (l.remarks ?? "").match(/[oO]n\s+\d/g)?.length ?? 0;
    console.log(`\n${l.name.padEnd(25)} chars=${len.toString().padStart(5)} lines=${lines.toString().padStart(3)} on-dates=${dates}  callLogs=${l.callLogs.length}`);
    console.log("  first 200:", (l.remarks ?? "").slice(0, 200).replace(/\s+/g, " "));
    console.log("  last 200:",  (l.remarks ?? "").slice(-200).replace(/\s+/g, " "));
  }
  await p.$disconnect();
})();
