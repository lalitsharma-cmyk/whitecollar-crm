// One-off: set a user's contact phone (normalized to E.164 India +91).
import { prisma } from "../src/lib/prisma";

const EMAIL = (process.argv[2] ?? "").toLowerCase().trim();
const RAW = (process.argv[3] ?? "").trim();
if (!EMAIL || !RAW) { console.error("usage: tsx set-user-phone.ts <email> <number>"); process.exit(1); }

// Normalize: strip non-digits; if 10-digit Indian mobile, prefix +91; if it
// already starts with country code keep it; else store as +<digits>.
function normalize(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  if (raw.trim().startsWith("+")) return `+${d}`;
  return `+${d}`;
}

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) { console.error(`NO_SUCH_USER: ${EMAIL}`); process.exit(2); }
  const phone = normalize(RAW);
  await prisma.user.update({ where: { id: user.id }, data: { phone } });
  console.log(`OK: ${user.name} (${user.role}) phone set to ${phone}`);
  await prisma.$disconnect();
})();
