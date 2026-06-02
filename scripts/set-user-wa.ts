// One-off: set a user's companyWhatsAppNumber (E.164). Reuses the same
// normalization as the phone setter.
import { prisma } from "../src/lib/prisma";

const EMAIL = (process.argv[2] ?? "").toLowerCase().trim();
const RAW = (process.argv[3] ?? "").trim();
if (!EMAIL || !RAW) { console.error("usage: tsx set-user-wa.ts <email> <number>"); process.exit(1); }

function normalize(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return `+${d}`;
}

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) { console.error(`NO_SUCH_USER: ${EMAIL}`); process.exit(2); }
  const wa = normalize(RAW);
  await prisma.user.update({ where: { id: user.id }, data: { companyWhatsAppNumber: wa } });
  console.log(`OK: ${user.name} (${user.role}) companyWhatsAppNumber set to ${wa}`);
  await prisma.$disconnect();
})();
