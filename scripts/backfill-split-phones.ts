// One-off backfill for the multi-phone bug. Walks every Lead, re-splits its
// `phone` field, and writes:
//   • a corrected primary phone (first valid number)
//   • the second number into `altPhone` (if currently empty)
// Skips rows where phone is already a clean single E.164 number.
//
// Safe to re-run — only touches rows where the split actually yields >1 number.
//
// Usage: npx tsx scripts/backfill-split-phones.ts

import { PrismaClient } from "@prisma/client";
import { splitPhones, toE164 } from "../src/lib/phone";

const p = new PrismaClient();

(async () => {
  const leads = await p.lead.findMany({
    where: { phone: { not: null } },
    select: { id: true, name: true, phone: true, altPhone: true },
  });

  let scanned = 0;
  let touched = 0;
  const examples: string[] = [];

  for (const l of leads) {
    scanned++;
    const raw = l.phone ?? "";
    // First sanity: a normal E.164 is +<1-3 country digits><up to 12 subscriber>
    // ~16 digits MAX (Iran, etc). If the digit count is >16, it's almost
    // certainly a merge. Otherwise still call splitPhones to catch comma+space cases.
    const digitCount = raw.replace(/\D/g, "").length;
    const looksMerged = digitCount > 15;
    const split = splitPhones(raw, "+91");
    if (split.length <= 1 && !looksMerged) continue; // already clean

    // If looksMerged but splitPhones returned 1 long number, we have a phone that
    // came in WITHOUT separators (e.g. "+919146449146777999"). Try to chop after
    // the 12th digit (India: +91 + 10 = 12 digits total).
    let primary: string | undefined = split[0];
    let alt: string | undefined = split[1];
    if (!alt && looksMerged && raw.startsWith("+91")) {
      const all = raw.replace(/\D/g, "");
      const first = "+" + all.slice(0, 12);   // +91 + 10
      const remainder = all.slice(12);
      if (remainder.length >= 10) {
        // Treat remainder as a second India number if it's 10 digits
        primary = first;
        const remE164 = toE164(remainder, "+91");
        alt = remE164 ?? undefined;
      }
    }
    if (!primary) continue;

    const data: Record<string, unknown> = {};
    if (primary !== l.phone) data.phone = primary;
    if (alt && !l.altPhone) data.altPhone = alt;
    if (Object.keys(data).length === 0) continue;

    await p.lead.update({ where: { id: l.id }, data });
    touched++;
    if (examples.length < 10) {
      examples.push(`  ${l.name.padEnd(20)} "${raw.slice(0, 40)}" → phone=${data.phone ?? "(unchanged)"} alt=${data.altPhone ?? "(unchanged)"}`);
    }
  }

  console.log(`📊 Scanned ${scanned} leads. Touched ${touched}.`);
  if (examples.length) {
    console.log(`\nFirst ${examples.length} changes:\n${examples.join("\n")}`);
  }
  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
