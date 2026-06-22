// Reset an EXISTING CRM user's password to a strong, randomly-generated one.
//   npx tsx scripts/set-user-password.ts <email>
// Generates the password securely (node crypto), bcrypt-hashes it, updates the
// user, and prints the new password ONCE to relay. Does NOT create new users.
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) { console.error("Usage: tsx scripts/set-user-password.ts <email>"); process.exit(1); }

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// Strong + reasonably typeable: avoids ambiguous chars (0/O, 1/l/I), guarantees a
// mix of cases / digits / symbol, hyphen-grouped for readability on a phone.
function strongPassword(): string {
  const U = "ABCDEFGHJKLMNPQRSTUVWXYZ", L = "abcdefghijkmnpqrstuvwxyz", D = "23456789", S = "!@#$%&*?";
  const pick = (s: string) => s[randomInt(s.length)];
  const all = U + L + D;
  const chars = [pick(U), pick(L), pick(D), pick(S), pick(U), pick(L), pick(D), pick(L), pick(U), pick(D)];
  while (chars.length < 12) chars.push(pick(all));
  // Fisher-Yates shuffle (crypto-random) so the guaranteed-class chars aren't positional.
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  const p = chars.join("");
  return `${p.slice(0, 4)}-${p.slice(4, 8)}-${p.slice(8)}`;
}

async function main() {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, name: true, role: true, team: true, active: true } });
  if (!user) { console.error(`❌ No user with email ${email}. (This script only RESETS existing users.)`); process.exit(1); }

  const password = strongPassword();
  const hash = await bcrypt.hash(password, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });

  console.log(`\n✅ Password reset for: ${user.name} (${user.role}${user.team ? " · " + user.team : ""})${user.active ? "" : "  ⚠ INACTIVE"}`);
  console.log(`   ───────────────────────────────────────────`);
  console.log(`   Login URL:  https://crm.whitecollarrealty.com/login`);
  console.log(`   Email:      ${email}`);
  console.log(`   Password:   ${password}`);
  console.log(`   ───────────────────────────────────────────`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
