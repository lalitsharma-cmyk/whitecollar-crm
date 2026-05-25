import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  console.log({
    leads: await p.lead.count(),
    callLogs: await p.callLog.count(),
    callLogsWithLead: await p.callLog.count({ where: { leadId: { not: null } } }),
    callLogsWithRealLead: await p.callLog.count({ where: { lead: { isNot: null } } }),
    activities: await p.activity.count(),
    users: await p.user.count(),
    projects: await p.project.count(),
  });
  // Sample a callLog
  const sample = await p.callLog.findFirst();
  if (sample) {
    console.log("Sample CallLog:", { id: sample.id.slice(0, 8), leadId: sample.leadId, attributedAgentName: sample.attributedAgentName, notes: sample.notes?.slice(0, 80) });
    if (sample.leadId) {
      const lead = await p.lead.findUnique({ where: { id: sample.leadId } });
      console.log("→ lead exists?", lead ? `YES (${lead.name})` : "NO (orphaned)");
    }
  }
  await p.$disconnect();
})();
