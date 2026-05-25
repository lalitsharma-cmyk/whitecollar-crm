import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
(async () => {
  const sample = await p.lead.findFirst({ select: { followupReminderSentAt: true } }).catch((e: Error) => ({ error: e.message }));
  const sampleAct = await p.activity.findFirst({ select: { reminderSentAt: true } }).catch((e: Error) => ({ error: e.message }));
  console.log('Lead.followupReminderSentAt queryable:', JSON.stringify(sample));
  console.log('Activity.reminderSentAt queryable:    ', JSON.stringify(sampleAct));
  const settings = await p.setting.findMany({ select: { key: true, value: true } });
  console.log('\nSettings in production:');
  for (const s of settings) console.log('  ' + s.key.padEnd(28) + ' = ' + s.value);
  const counts = {
    users: await p.user.count(),
    leads: await p.lead.count(),
    projects: await p.project.count(),
    activities: await p.activity.count(),
    templates: await p.template.count(),
    workflows: await p.workflow.count(),
  };
  console.log('\nDB row counts:', counts);
  await p.$disconnect();
})();
