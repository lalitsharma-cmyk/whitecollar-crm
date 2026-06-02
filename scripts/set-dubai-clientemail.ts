// @ts-nocheck — legacy admin script; references a removed `clientEmail` User field.
// Not run in production; kept for git history. Disable typecheck so it doesn't
// block the Next.js build.
//
// Set the shared client-mail (from) address for the Dubai team. Login emails
// (their personal Gmails) are untouched — this is only the client-facing
// "from" identity. Matched by current login email.
import { prisma } from "../src/lib/prisma";

const SHARED = "dubaisalesteam@whitecollarrealty.com";
const DUBAI = ["mehakmukhijawcr@gmail.com", "dineshgillwcr@gmail.com"];

(async () => {
  for (const email of DUBAI) {
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u) { console.log(`SKIP (not found): ${email}`); continue; }
    await prisma.user.update({ where: { id: u.id }, data: { clientEmail: SHARED } });
    console.log(`OK: ${u.name} (${u.team}) clientEmail = ${SHARED}`);
  }
  await prisma.$disconnect();
})();
