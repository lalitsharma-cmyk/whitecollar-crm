// Bulk-set phone + companyWhatsAppNumber for the 4 agents from the office sheet.
// Matches by current CRM login email (stable) — does NOT change emails here.
import { prisma } from "../src/lib/prisma";

const ROWS: { email: string; phone: string }[] = [
  { email: "tanuj@whitecollarrealty.com",  phone: "9821306009" },
  { email: "yasir@whitecollarrealty.com",  phone: "8076492812" },
  { email: "mehak@whitecollarrealty.com",  phone: "8287538868" },
  { email: "dinesh@whitecollarrealty.com", phone: "9217674680" },
];

function norm(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `+91${d}`;
  if (d.length === 12 && d.startsWith("91")) return `+${d}`;
  return `+${d}`;
}

(async () => {
  for (const r of ROWS) {
    const u = await prisma.user.findUnique({ where: { email: r.email } });
    if (!u) { console.log(`SKIP (not found): ${r.email}`); continue; }
    const phone = norm(r.phone);
    await prisma.user.update({ where: { id: u.id }, data: { phone, companyWhatsAppNumber: phone } });
    console.log(`OK: ${u.name} → phone+WhatsApp ${phone}`);
  }
  await prisma.$disconnect();
})();
