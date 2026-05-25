// Seeds the 16 starter templates (8 WA + 8 Email). Idempotent: only inserts
// rows whose name doesn't already exist, so admin edits aren't overwritten.
//
// Run: npx tsx scripts/seed-templates.ts
import { PrismaClient, TemplateKind, TemplateTrigger } from "@prisma/client";
import { SEED_TEMPLATES } from "../src/lib/templates";

async function main() {
  const prisma = new PrismaClient();
  const existing = new Set((await prisma.template.findMany({ select: { name: true } })).map(t => t.name));
  let created = 0, skipped = 0;
  for (const t of SEED_TEMPLATES) {
    if (existing.has(t.name)) { skipped++; continue; }
    await prisma.template.create({
      data: {
        kind: t.kind as TemplateKind,
        trigger: t.trigger as TemplateTrigger,
        name: t.name,
        subject: "subject" in t ? t.subject : null,
        body: t.body,
      },
    });
    created++;
  }
  console.log(`Templates: ${created} created, ${skipped} already existed.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
