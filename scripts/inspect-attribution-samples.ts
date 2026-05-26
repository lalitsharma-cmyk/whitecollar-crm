// Inspect sample notes for each attribution name so we can decide mappings.
import { prisma } from "../src/lib/prisma";

const TARGETS = ["Sharma", "Javed", "Nitsha", "Unknown", "Devansh", "Sandeep", "Dinesh", "Neeraj"];

async function main() {
  // Team members from /team
  const team = await prisma.user.findMany({ select: { name: true, role: true } });
  console.log("Active team members:");
  for (const u of team) console.log(`  ${u.role.padEnd(8)} ${u.name}`);
  console.log("");

  for (const name of TARGETS) {
    const count = await prisma.callLog.count({ where: { attributedAgentName: name } });
    console.log(`\n──── "${name}" — ${count} rows ────`);
    const samples = await prisma.callLog.findMany({
      where: { attributedAgentName: name },
      select: { notes: true, lead: { select: { name: true } } },
      take: 3,
    });
    for (const s of samples) {
      console.log(`  lead=${s.lead?.name?.padEnd(20) ?? "—"}  notes=${(s.notes ?? "").slice(0, 120)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
