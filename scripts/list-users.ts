// One-off: list every CRM user with name / email / role / team / active /
// last-login. Used so the admin (Lalit) can confirm who exists and what
// their login ID is. Does NOT touch passwords — those are bcrypt-hashed
// and cannot be read back.

import { prisma } from "../src/lib/prisma";

(async () => {
  const users = await prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, team: true, active: true },
  });
  console.log(`LOGIN ROSTER — ${users.length} users`);
  console.log("=".repeat(85));
  console.log("Name".padEnd(22) + "Role".padEnd(10) + "Team".padEnd(10) + "Active  Email");
  console.log("=".repeat(85));
  for (const u of users) {
    console.log(
      u.name.padEnd(22) +
      u.role.padEnd(10) +
      (u.team ?? "—").padEnd(10) +
      (u.active ? "  ✓   " : "  ✗   ") +
      "  " + u.email
    );
  }
  await prisma.$disconnect();
})();
