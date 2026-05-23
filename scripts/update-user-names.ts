// Updates the 4 agents to full names + generates fresh passwords.
// Sameer and Lalit stay as-is.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const UPDATES = [
  { email: "mehak@whitecollarrealty.com",  name: "Mehak Mukhija" },
  { email: "dinesh@whitecollarrealty.com", name: "Dinesh Gill" },
  { email: "yasir@whitecollarrealty.com",  name: "Yasir Khan" },
  { email: "tanuj@whitecollarrealty.com",  name: "Tanuj Chopra" },
];

function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = ""; const buf = randomBytes(12);
  for (let i = 0; i < 12; i++) s += chars[buf[i] % chars.length];
  return s;
}

async function main() {
  console.log("📝 Updating agent full names + rotating passwords…\n");
  const out: Array<{ email: string; name: string; password: string }> = [];

  for (const u of UPDATES) {
    const password = genPassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await prisma.user.update({
      where: { email: u.email },
      data: { name: u.name, passwordHash },
    }).catch(() => null);
    if (!result) { console.log(`  ✗ ${u.email} not found — skipped`); continue; }
    out.push({ email: u.email, name: u.name, password });
  }

  console.log("Email                                | Name             | Password");
  console.log("-".repeat(80));
  for (const r of out) {
    console.log(`${r.email.padEnd(36)} | ${r.name.padEnd(16)} | ${r.password}`);
  }
  console.log("\n⚠ Share via WhatsApp DM. These replace the previous passwords.");
  console.log("Sameer + Lalit passwords UNCHANGED (still use the ones from earlier).");
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
