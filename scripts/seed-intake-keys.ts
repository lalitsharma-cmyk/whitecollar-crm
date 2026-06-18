// Seed one IntakeKey per lead source so EVERY channel can auto-enter leads via
// the universal endpoint (/api/intake/lead — source is derived from the key).
// Idempotent: keyed on label, so re-running never duplicates. Existing WEBSITE +
// WHATSAPP keys are left untouched.
//
//   npx tsx scripts/seed-intake-keys.ts
import { prisma } from "../src/lib/prisma";
import { LeadSource } from "@prisma/client";
import crypto from "crypto";

const SEED: { source: LeadSource; label: string; tag: string }[] = [
  { source: LeadSource.EVENT,              label: "Townscript / Eventbrite (events)",        tag: "event" },
  { source: LeadSource.FACEBOOK_ADS,       label: "Meta Lead Ads (Facebook + Instagram)",    tag: "meta" },
  { source: LeadSource.GOOGLE_ADS,         label: "Google Ads Lead Forms",                    tag: "google" },
  { source: LeadSource.PORTAL_99ACRES,     label: "99acres",                                  tag: "99acres" },
  { source: LeadSource.PORTAL_MAGICBRICKS, label: "MagicBricks",                              tag: "magicbricks" },
  { source: LeadSource.PORTAL_HOUSING,     label: "Housing.com",                              tag: "housing" },
  { source: LeadSource.REFERRAL,           label: "Referral / partner",                       tag: "referral" },
  { source: LeadSource.OTHER,              label: "Generic / Zapier / Make",                  tag: "zapier" },
];

async function main() {
  for (const s of SEED) {
    const existing = await prisma.intakeKey.findFirst({ where: { label: s.label } });
    if (existing) { console.log(`  skip (exists): ${s.label}`); continue; }
    const key = `wcr_live_${s.tag}_${crypto.randomBytes(12).toString("hex")}`;
    await prisma.intakeKey.create({ data: { label: s.label, key, source: s.source, active: true } });
    console.log(`  created: ${s.source.padEnd(18)} ${key}  "${s.label}"`);
  }
  const all = await prisma.intakeKey.findMany({ where: { hrScope: false }, orderBy: { createdAt: "asc" }, select: { source: true, label: true } });
  console.log(`\nTotal sales intake keys: ${all.length}`);
  all.forEach((k) => console.log(`  ${k.source.padEnd(18)} "${k.label}"`));
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
