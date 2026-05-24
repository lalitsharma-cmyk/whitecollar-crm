// One-off: reset Lalit's admin password to a known value he can use immediately.
// Run: npx tsx scripts/reset-my-password.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const NEW_PASSWORD = "WCRealty@2026"; // change after first login
const EMAIL = "lalit@whitecollarrealty.com";

async function main() {
  const prisma = new PrismaClient();
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  const u = await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash: hash },
  });
  console.log(`\nReset password for: ${u.email}`);
  console.log(`Role: ${u.role}`);
  console.log(`New password: ${NEW_PASSWORD}`);
  console.log(`\nSign in at: https://crm.whitecollarrealty.com/login`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
