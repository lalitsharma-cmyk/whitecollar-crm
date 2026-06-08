// One-off: flag a user as HR-only (or clear it). HR-only users (e.g. Nisha,
// HR Intern) are redirected out of the Sales CRM to /hr by (app)/layout.tsx
// and can only use the HR Recruitment workspace.
//   usage: tsx scripts/set-hr-only.ts <email> [true|false]   (default: true)
import { prisma } from "../src/lib/prisma";

const EMAIL = (process.argv[2] ?? "").toLowerCase().trim();
const VALUE = (process.argv[3] ?? "true").trim().toLowerCase();
if (!EMAIL) { console.error("usage: tsx scripts/set-hr-only.ts <email> [true|false]"); process.exit(1); }
const hrOnly = !["false", "0", "no", "off"].includes(VALUE);

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) { console.error(`NO_SUCH_USER: ${EMAIL}`); process.exit(2); }
  await prisma.user.update({ where: { id: user.id }, data: { hrOnly } });
  console.log(`OK: ${user.name} (${user.role}) hrOnly = ${hrOnly}`);
  await prisma.$disconnect();
})();
