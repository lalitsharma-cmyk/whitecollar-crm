// Compare regex date-count vs parseRemarks output for every imported lead.
import { PrismaClient } from "@prisma/client";
import { parseRemarks } from "../src/lib/remarkParser";

const p = new PrismaClient();
(async () => {
  const leads = await p.lead.findMany({
    where: { remarks: { not: null } },
    select: { name: true, remarks: true },
    orderBy: { createdAt: "desc" },
    take: 60,
  });
  let mismatchCount = 0;
  for (const l of leads) {
    const text = l.remarks ?? "";
    const naive = (text.match(/[oO]n\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/g) ?? []).length;
    const parsed = parseRemarks(text);
    const mark = naive !== parsed.length ? "⚠" : " ";
    if (naive !== parsed.length) mismatchCount++;
    console.log(`${mark} ${l.name.padEnd(28)} naive=${naive}  parsed=${parsed.length}`);
  }
  console.log(`\nTotal mismatches: ${mismatchCount} of ${leads.length}`);
  // Show one missing-entry example
  for (const l of leads) {
    const naive = (l.remarks?.match(/[oO]n\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/g) ?? []).length;
    const parsed = parseRemarks(l.remarks ?? "");
    if (naive > parsed.length) {
      console.log(`\nExample mismatch: ${l.name}`);
      console.log(`  naive matches (${naive}):`);
      (l.remarks?.match(/[oO]n\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/g) ?? [])
        .forEach((m, i) => console.log(`    ${i+1}. ${m}`));
      console.log(`  parsed entries (${parsed.length}):`);
      parsed.forEach((e, i) => console.log(`    ${i+1}. ${e.when.toISOString().slice(0,10)} ${e.text.slice(0,60)}`));
      break;
    }
  }
  await p.$disconnect();
})();
