// Set each agent's fixed weekly day off (User.weeklyOff).
// weeklyOff uses JS getDay() convention: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat.
// Matched by case-insensitive substring on User.name (first name). Run AFTER the
// 20260602100000_add_user_weekly_off migration is applied.
//
// Known offs (2026-06-02): Mehak=Wed, Yasir=Mon, Tanuj=Tue, Dinesh=Tue.
import { prisma } from "../src/lib/prisma";

const OFFS: { name: string; weeklyOff: number }[] = [
  { name: "Mehak",  weeklyOff: 3 }, // Wednesday
  { name: "Yasir",  weeklyOff: 1 }, // Monday
  { name: "Tanuj",  weeklyOff: 2 }, // Tuesday
  { name: "Dinesh", weeklyOff: 2 }, // Tuesday
];

(async () => {
  for (const { name, weeklyOff } of OFFS) {
    const users = await prisma.user.findMany({
      where: { name: { contains: name, mode: "insensitive" } },
    });
    if (users.length === 0) { console.log(`SKIP (not found): ${name}`); continue; }
    for (const u of users) {
      await prisma.user.update({ where: { id: u.id }, data: { weeklyOff } });
      console.log(`OK: ${u.name} (${u.team}) weeklyOff=${weeklyOff}`);
    }
  }
  await prisma.$disconnect();
})();
