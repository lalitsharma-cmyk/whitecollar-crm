// Sets up the real White Collar Realty team and removes demo users.
//
//   Admin    : Sameer (Admin)
//   Admin    : Lalit  (CEO — has all rights)
//   Dubai    : Mehak, Dinesh  (agents)
//   India    : Yasir, Tanuj   (agents)
//
// Run: DATABASE_URL="postgresql://..." npx tsx scripts/setup-real-users.ts
// Prints passwords at the end — copy & distribute via WhatsApp.

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const ADMINS = [
  { name: "Sameer",         email: "sameer@whitecollarrealty.com", team: "HQ",    avatarColor: "bg-amber-500" },
  { name: "Lalit Sharma",   email: "lalit@whitecollarrealty.com",  team: "HQ",    avatarColor: "bg-indigo-500" },
];
const DUBAI = [
  { name: "Mehak",          email: "mehak@whitecollarrealty.com",  team: "Dubai", avatarColor: "bg-sky-500" },
  { name: "Dinesh",         email: "dinesh@whitecollarrealty.com", team: "Dubai", avatarColor: "bg-rose-500" },
];
const INDIA = [
  { name: "Yasir",          email: "yasir@whitecollarrealty.com",  team: "India", avatarColor: "bg-emerald-500" },
  { name: "Tanuj",          email: "tanuj@whitecollarrealty.com",  team: "India", avatarColor: "bg-violet-500" },
];

function genPassword() {
  // 12-char readable: avoid I/l/0/O confusion
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let s = ""; const buf = randomBytes(12);
  for (let i = 0; i < 12; i++) s += chars[buf[i] % chars.length];
  return s;
}

async function main() {
  // Wipe everything except intake keys
  await prisma.activity.deleteMany();
  await prisma.callLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.leadProperty.deleteMany();
  await prisma.whatsAppMessage.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.user.deleteMany();
  console.log("🗑  Cleared existing users + leads + activity");

  const created: Array<{ email: string; name: string; role: string; team: string; password: string }> = [];

  for (const u of ADMINS) {
    const password = genPassword();
    await prisma.user.create({
      data: { ...u, role: Role.ADMIN, passwordHash: await bcrypt.hash(password, 10) },
    });
    created.push({ ...u, role: "ADMIN", password });
  }
  for (const u of [...DUBAI, ...INDIA]) {
    const password = genPassword();
    await prisma.user.create({
      data: { ...u, role: Role.AGENT, passwordHash: await bcrypt.hash(password, 10) },
    });
    created.push({ ...u, role: "AGENT", password });
  }

  console.log(`\n✅ Created ${created.length} users.\n`);
  console.log("📋 PASSWORDS — share with each person via secure channel (WhatsApp DM):\n");
  console.log("Email                                    | Role  | Team  | Password");
  console.log("-".repeat(80));
  for (const u of created) {
    console.log(`${u.email.padEnd(40)} | ${u.role.padEnd(5)} | ${u.team.padEnd(5)} | ${u.password}`);
  }
  console.log("\n⚠ Tell each user to log in and change their password on first sign-in.");
  console.log("   (Profile-change UI: shipping in next iteration; for now you can rotate via DB if needed.)");
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
