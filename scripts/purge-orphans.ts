// Clean up orphaned rows (leadId=null) that survived a Lead.deleteMany call.
// The Lead → CallLog FK has onDelete: SetNull, so wiping leads leaves call
// rows with leadId=null. They're invisible in any per-lead view but waste DB
// rows + skew the call-history attribution counts.

import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const before = {
    callLogs: await p.callLog.count(),
    callLogsOrphan: await p.callLog.count({ where: { leadId: null } }),
    activities: await p.activity.count(),
    waMessages: await p.whatsAppMessage.count(),
    notes: await p.note.count(),
  };
  console.log("BEFORE:", before);

  const r1 = await p.callLog.deleteMany({ where: { leadId: null } });
  const r2 = await p.whatsAppMessage.deleteMany({ where: { leadId: null as never } }).catch(() => ({ count: 0 }));
  // Activity.leadId is required (non-null) so no orphans possible there
  // Note.leadId same

  console.log(`\nDeleted ${r1.count} orphan call logs, ${r2.count} orphan WA messages.`);
  console.log("AFTER:", {
    callLogs: await p.callLog.count(),
    activities: await p.activity.count(),
  });

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
