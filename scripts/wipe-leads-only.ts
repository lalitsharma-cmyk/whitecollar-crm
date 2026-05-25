// Wipes ALL leads + their dependent rows from production.
// KEEPS users, projects, units, templates, saved filters, workflow rules,
// intake keys, AND settings. Also writes an AuditLog entry recording the wipe.
//
// Also flips testingMode.enabled = true at the end so the freshly-cleared CRM
// doesn't immediately auto-WA / auto-assign the real client data Lalit imports next.
//
// Usage (Windows PowerShell):
//   npx tsx scripts/wipe-leads-only.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    leads: await prisma.lead.count(),
    callLogs: await prisma.callLog.count(),
    activities: await prisma.activity.count(),
    notes: await prisma.note.count(),
    assignments: await prisma.assignment.count(),
    waMessages: await prisma.whatsAppMessage.count(),
    leadProperties: await prisma.leadProperty.count(),
    discussed: await prisma.leadProject.count(),
    workflowRuns: await prisma.workflowRun.count(),
    // preserved
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    units: await prisma.unit.count(),
    templates: await prisma.template.count(),
    savedFilters: await prisma.savedFilter.count(),
    workflows: await prisma.workflow.count(),
    settings: await prisma.setting.count(),
  };
  console.log("📊 BEFORE:", before);

  // Delete children first (dependency order)
  const rWA = await prisma.whatsAppMessage.deleteMany({});
  const rCalls = await prisma.callLog.deleteMany({});
  const rActs = await prisma.activity.deleteMany({});
  const rNotes = await prisma.note.deleteMany({});
  const rAssign = await prisma.assignment.deleteMany({});
  const rDisc = await prisma.leadProject.deleteMany({});
  const rProps = await prisma.leadProperty.deleteMany({});
  // Workflow runs reference leads
  const rRuns = await prisma.workflowRun.deleteMany({});
  // Finally the leads themselves (cold-data lives on Lead.isColdCall — drops with the lead row)
  const rLeads = await prisma.lead.deleteMany({});

  // Flip the master kill-switch ON so nothing auto-fires on the upcoming re-import
  await prisma.setting.upsert({
    where: { key: "testingMode.enabled" },
    create: { key: "testingMode.enabled", value: "true" },
    update: { value: "true" },
  });
  // Belt-and-braces: explicitly turn off speed-to-lead and round-robin too
  await prisma.setting.upsert({
    where: { key: "speedToLead.enabled" },
    create: { key: "speedToLead.enabled", value: "false" },
    update: { value: "false" },
  });
  await prisma.setting.upsert({
    where: { key: "roundRobin.enabled" },
    create: { key: "roundRobin.enabled", value: "false" },
    update: { value: "false" },
  });

  // Audit-log the wipe — meta is a JSON-stringified TEXT column
  await prisma.auditLog.create({
    data: {
      action: "leads.wipe-all",
      entity: "Lead",
      meta: JSON.stringify({
        leads: rLeads.count,
        callLogs: rCalls.count,
        activities: rActs.count,
        notes: rNotes.count,
        assignments: rAssign.count,
        waMessages: rWA.count,
        leadProperties: rProps.count,
        discussed: rDisc.count,
        workflowRuns: rRuns.count,
        reason: "Second pre-go-live wipe — Lalit re-importing real client data with testing-mode ON",
      }),
    },
  });

  console.log("\n🗑 Deletions:");
  console.log(`  leads:                 ${rLeads.count}`);
  console.log(`  callLogs:              ${rCalls.count}`);
  console.log(`  activities:            ${rActs.count}`);
  console.log(`  notes:                 ${rNotes.count}`);
  console.log(`  assignments:           ${rAssign.count}`);
  console.log(`  whatsappMessages:      ${rWA.count}`);
  console.log(`  leadProperties:        ${rProps.count}`);
  console.log(`  discussedProjects:     ${rDisc.count}`);
  console.log(`  workflowRuns:          ${rRuns.count}`);

  console.log("\n🛡 Settings flipped:");
  console.log(`  testingMode.enabled    = true`);
  console.log(`  speedToLead.enabled    = false`);
  console.log(`  roundRobin.enabled     = false`);

  const after = {
    leads: await prisma.lead.count(),
    users: await prisma.user.count(),
    projects: await prisma.project.count(),
    units: await prisma.unit.count(),
    templates: await prisma.template.count(),
    savedFilters: await prisma.savedFilter.count(),
    workflows: await prisma.workflow.count(),
    settings: await prisma.setting.count(),
  };
  console.log("\n📊 AFTER:", after);
  console.log("\n✅ Leads wiped. Users + projects + units + templates intact. Testing mode ON.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
