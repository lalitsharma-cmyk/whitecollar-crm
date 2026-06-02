// One-off: reset a single user's password to a freshly generated strong
// temporary value. Writes the plaintext to the local credentials file ONLY
// (never stdout/chat). bcrypt is one-way so this is the only way to restore
// access to a locked-out account.
import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import { appendFileSync } from "fs";
import { randomBytes } from "crypto";

const EMAIL = process.argv[2];
if (!EMAIL) { console.error("usage: tsx reset-admin-pw.ts <email>"); process.exit(1); }

function strongPw(): string {
  // Readable-ish but strong: WCR-<6 hex>-<6 hex> (48 bits entropy, easy to type once)
  const a = randomBytes(3).toString("hex");
  const b = randomBytes(3).toString("hex");
  return `WCR-${a}-${b}`;
}

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL.toLowerCase().trim() } });
  if (!user) { console.error(`NO_SUCH_USER: ${EMAIL}`); process.exit(2); }

  const pw = strongPw();
  const hash = await bcrypt.hash(pw, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  const stamp = new Date().toISOString();
  const block =
    `\n--- PASSWORD RESET ${stamp} ---\n` +
    `Account: ${user.name} (${user.role})\n` +
    `Login ID: ${user.email}\n` +
    `TEMP password: ${pw}\n` +
    `>>> Change this immediately after logging in (Profile / Settings).\n`;
  appendFileSync("C:/Users/Lenovo/WCR-CRM-CREDENTIALS.txt", block, "utf8");

  // Deliberately DO NOT print the password to stdout.
  console.log(`OK: reset password for ${user.email} (${user.role}). Temp password written to WCR-CRM-CREDENTIALS.txt — NOT shown here.`);
  await prisma.$disconnect();
})();
