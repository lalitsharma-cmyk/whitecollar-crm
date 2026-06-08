// One-off: add/remove a user from the HR team (appears in HR owner/interviewer
// pickers; keeps Sales access). For admins like Kimmi / Lalit who also work HR.
//   usage: tsx scripts/set-hr-access.ts <email> [true|false]   (default: true)
import { prisma } from "../src/lib/prisma";

const EMAIL = (process.argv[2] ?? "").toLowerCase().trim();
const VALUE = (process.argv[3] ?? "true").trim().toLowerCase();
if (!EMAIL) { console.error("usage: tsx scripts/set-hr-access.ts <email> [true|false]"); process.exit(1); }
const hrTeam = !["false", "0", "no", "off"].includes(VALUE);

(async () => {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) { console.error(`NO_SUCH_USER: ${EMAIL}`); process.exit(2); }
  await prisma.user.update({ where: { id: user.id }, data: { hrTeam } });
  console.log(`OK: ${user.name} (${user.role}) hrTeam = ${hrTeam}`);
  await prisma.$disconnect();
})();
