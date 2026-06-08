// Audit (and optionally --fix) HR candidates whose owner is a Sales user.
// HR users = hrOnly OR ADMIN. Anyone else owning an HR candidate is wrong.
import { prisma } from "../src/lib/prisma";

const FIX = process.argv.includes("--fix");

(async () => {
  const hrUsers = await prisma.user.findMany({
    where: { active: true, OR: [{ hrOnly: true }, { role: "ADMIN" }] },
    select: { id: true, name: true, hrOnly: true, role: true },
  });
  const hrIds = hrUsers.map(u => u.id);
  const sales = await prisma.user.findMany({ where: { id: { notIn: hrIds } }, select: { id: true, name: true } });
  const salesIds = sales.map(s => s.id);

  const primaryBad = await prisma.hRCandidate.findMany({
    where: { primaryOwnerId: { in: salesIds } },
    select: { id: true, name: true, primaryOwner: { select: { name: true } } },
  });
  const secondaryBad = await prisma.hRCandidate.findMany({
    where: { secondaryOwnerId: { in: salesIds } },
    select: { id: true, name: true, secondaryOwner: { select: { name: true } } },
  });

  console.log(`HR users (${hrUsers.length}): ${hrUsers.map(u => `${u.name}${u.hrOnly ? " [hrOnly]" : ` [${u.role}]`}`).join(", ")}`);
  console.log(`Non-HR (sales) users: ${sales.map(s => s.name).join(", ") || "(none)"}`);
  console.log(`\nHR candidates with a SALES primary owner: ${primaryBad.length}`);
  primaryBad.slice(0, 25).forEach(c => console.log(`  - ${c.name} → owned by ${c.primaryOwner?.name}`));
  console.log(`HR candidates with a SALES secondary owner: ${secondaryBad.length}`);
  secondaryBad.slice(0, 25).forEach(c => console.log(`  - ${c.name} → secondary ${c.secondaryOwner?.name}`));

  if (FIX && (primaryBad.length || secondaryBad.length)) {
    const defaultOwner = hrUsers.find(u => u.hrOnly) ?? hrUsers[0];
    if (!defaultOwner) { console.log("\nNo HR user available to reassign to!"); process.exit(1); }
    const p = await prisma.hRCandidate.updateMany({ where: { primaryOwnerId: { in: salesIds } }, data: { primaryOwnerId: defaultOwner.id } });
    const s = await prisma.hRCandidate.updateMany({ where: { secondaryOwnerId: { in: salesIds } }, data: { secondaryOwnerId: null } });
    console.log(`\nFIXED: reassigned ${p.count} primary → ${defaultOwner.name}; cleared ${s.count} secondary owners.`);
  }
  await prisma.$disconnect();
})();
