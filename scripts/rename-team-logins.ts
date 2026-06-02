// Bulk: change the 4 agents' login emails to their real Gmail addresses +
// reset each password to a fresh temp. Plaintext goes to the local
// credentials file ONLY (never stdout/chat). Matches by current email.
import { prisma } from "../src/lib/prisma";
import bcrypt from "bcryptjs";
import { appendFileSync } from "fs";
import { randomBytes } from "crypto";

const ROWS: { old: string; neu: string }[] = [
  { old: "tanuj@whitecollarrealty.com",  neu: "tanujchoprawcr@gmail.com" },
  { old: "yasir@whitecollarrealty.com",  neu: "saleswhitecollarrealty@gmail.com" },
  { old: "mehak@whitecollarrealty.com",  neu: "mehakmukhijawcr@gmail.com" },
  { old: "dinesh@whitecollarrealty.com", neu: "dineshgillwcr@gmail.com" },
];

const pw = () => `WCR-${randomBytes(3).toString("hex")}-${randomBytes(3).toString("hex")}`;

(async () => {
  const stamp = new Date().toISOString();
  let block = `\n--- TEAM LOGIN MIGRATION + PASSWORD RESET ${stamp} ---\n`;
  for (const r of ROWS) {
    const old = r.old.toLowerCase().trim();
    const neu = r.neu.toLowerCase().trim();
    const u = await prisma.user.findUnique({ where: { email: old } });
    if (!u) { console.log(`SKIP (not found): ${old}`); block += `SKIP: ${old} not found\n`; continue; }
    const clash = await prisma.user.findUnique({ where: { email: neu } });
    if (clash && clash.id !== u.id) { console.log(`SKIP (email taken): ${neu}`); block += `SKIP: ${neu} already taken\n`; continue; }
    const p = pw();
    const hash = await bcrypt.hash(p, 10);
    await prisma.user.update({ where: { id: u.id }, data: { email: neu, passwordHash: hash } });
    console.log(`OK: ${u.name} login ${old} -> ${neu}, password reset`);
    block += `${u.name} (${u.role})\n  NEW login: ${neu}\n  TEMP password: ${p}\n`;
  }
  block += `>>> Each agent logs in with their NEW email + temp password, then changes it in Settings.\n`;
  appendFileSync("C:/Users/Lenovo/WCR-CRM-CREDENTIALS.txt", block, "utf8");
  console.log("Temp passwords written to WCR-CRM-CREDENTIALS.txt (NOT shown here).");
  await prisma.$disconnect();
})();
