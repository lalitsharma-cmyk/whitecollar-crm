// Rotates every password + secret. Run once after suspecting any leak.
//   - All user passwords (Lalit, Sameer, Mehak, Dinesh, Yasir, Tanuj)
//   - NEXTAUTH_SECRET (kicks out all existing sessions — everyone must re-login)
//   - INTAKE_SECRET, EMAIL_INTAKE_KEY, CRON_SECRET (regenerated)
//   - Intake API keys (website + WhatsApp) rotated
//
// Run: DATABASE_URL="postgresql://..." npx tsx scripts/rotate-all-secrets.ts
import { PrismaClient, LeadSource } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

function gen(len = 16, charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789") {
  const buf = randomBytes(len);
  let s = "";
  for (let i = 0; i < len; i++) s += charset[buf[i] % charset.length];
  return s;
}
function token(prefix: string) {
  return `${prefix}_${gen(24, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
}

async function main() {
  console.log("🛡  SECURITY LOCKDOWN — rotating every secret\n");

  // 1. Rotate all user passwords
  const users = await prisma.user.findMany({ orderBy: { email: "asc" } });
  const newCreds: Array<{ email: string; name: string; password: string }> = [];
  for (const u of users) {
    const password = gen(14);
    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    newCreds.push({ email: u.email, name: u.name, password });
  }

  // 2. Rotate intake API keys
  const keys = await prisma.intakeKey.findMany();
  const newKeys: Array<{ label: string; source: string; key: string }> = [];
  for (const k of keys) {
    const newKey = token(k.source === LeadSource.WEBSITE ? "wcr_live_web" : k.source === LeadSource.WHATSAPP ? "wcr_live_wa" : "wcr_live");
    await prisma.intakeKey.update({ where: { id: k.id }, data: { key: newKey } });
    newKeys.push({ label: k.label, source: k.source, key: newKey });
  }

  // 3. Generate new app secrets (manually paste into .env + Vercel)
  const newSecrets = {
    NEXTAUTH_SECRET: gen(32) + gen(16),
    INTAKE_SECRET: gen(32),
    EMAIL_INTAKE_KEY: token("wcr_email"),
    CRON_SECRET: token("wcr_cron"),
  };

  console.log("┌───────────────────────────────────────────────────────────────────────┐");
  console.log("│ 🔑 NEW USER PASSWORDS — distribute via WhatsApp DM, never via chat   │");
  console.log("└───────────────────────────────────────────────────────────────────────┘");
  for (const c of newCreds) {
    console.log(`  ${c.email.padEnd(36)} ${c.name.padEnd(18)} ${c.password}`);
  }

  console.log("\n┌───────────────────────────────────────────────────────────────────────┐");
  console.log("│ 🔑 NEW INTAKE API KEYS — paste into your Google Form / website embed │");
  console.log("└───────────────────────────────────────────────────────────────────────┘");
  for (const k of newKeys) {
    console.log(`  ${k.source.padEnd(10)} ${k.label.padEnd(34)} ${k.key}`);
  }

  console.log("\n┌───────────────────────────────────────────────────────────────────────┐");
  console.log("│ 🔑 NEW APP SECRETS — paste into Vercel env vars (Settings → Env Vars)│");
  console.log("└───────────────────────────────────────────────────────────────────────┘");
  for (const [k, v] of Object.entries(newSecrets)) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }

  console.log("\n⚠ NEXTAUTH_SECRET rotation kicks ALL current sessions — everyone re-logs in. Intended.");
  console.log("⚠ Also rotate the Neon DB password manually: Neon dashboard → Settings → Reset password");
  console.log("⚠ Also rotate the GitHub PAT: https://github.com/settings/tokens → Delete + create new");
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
