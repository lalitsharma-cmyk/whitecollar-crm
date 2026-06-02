// One-off: change a user's login email AND reset their password to a fresh
// strong temp value. Plaintext goes to the local credentials file ONLY.
import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import { appendFileSync } from "fs";
import { randomBytes } from "crypto";

const OLD = (process.argv[2] ?? "").toLowerCase().trim();
const NEW = (process.argv[3] ?? "").toLowerCase().trim();
if (!OLD || !NEW) { console.error("usage: tsx reset-and-rename.ts <oldEmail> <newEmail>"); process.exit(1); }

function strongPw(): string {
  return `WCR-${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`;
}

(async () => {
  const user = await prisma.user.findUnique({ where: { email: OLD } });
  if (!user) { console.error(`NO_SUCH_USER: ${OLD}`); process.exit(2); }

  // Guard: don't collide with an existing different account on the new email.
  if (NEW !== OLD) {
    const clash = await prisma.user.findUnique({ where: { email: NEW } });
    if (clash && clash.id !== user.id) { console.error(`EMAIL_TAKEN: ${NEW} already belongs to ${clash.name}`); process.exit(3); }
  }

  const pw = strongPw();
  const hash = await bcrypt.hash(pw, 10);
  await prisma.user.update({ where: { id: user.id }, data: { email: NEW, passwordHash: hash } });

  const stamp = new Date().toISOString();
  const block =
    `\n--- LOGIN CHANGED + PASSWORD RESET ${stamp} ---\n` +
    `Account: ${user.name} (${user.role})\n` +
    `OLD login ID: ${OLD}\n` +
    `NEW login ID: ${NEW}\n` +
    `TEMP password: ${pw}\n` +
    `>>> Log in with the NEW email + temp password, then change the password in Settings.\n`;
  appendFileSync("C:/Users/Lenovo/WCR-CRM-CREDENTIALS.txt", block, "utf8");

  console.log(`OK: ${user.name} (${user.role}) login changed ${OLD} -> ${NEW}, password reset. Temp password written to WCR-CRM-CREDENTIALS.txt (NOT shown here).`);
  await prisma.$disconnect();
})();
