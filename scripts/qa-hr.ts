// Read-only QA snapshot of the HR CRM prod data.
import { prisma } from "../src/lib/prisma";

const CLOSED = ["NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE","REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF","NEVER_RESPONSE","NOT_RESPONDING","JOINED","CLOSED","INVALID_NUMBER"];

(async () => {
  const hrUsers = await prisma.user.findMany({ where: { active: true, OR: [{ hrOnly: true }, { hrTeam: true }] }, select: { name: true, role: true, hrOnly: true, hrTeam: true } });
  const lalit = await prisma.user.findUnique({ where: { email: "lalitsharma@whitecollarrealty.com" }, select: { name: true, hrOnly: true, hrTeam: true, role: true } });
  const allUsers = await prisma.user.findMany({ where: { active: true }, select: { name: true, role: true, hrOnly: true, hrTeam: true } });
  const total = await prisma.hRCandidate.count();
  const byStatus = await prisma.hRCandidate.groupBy({ by: ["status"], _count: true });
  const noPosition = await prisma.hRCandidate.count({ where: { positionApplied: null } });
  const noNextAction = await prisma.hRCandidate.count({ where: { nextActionDate: null, status: { notIn: CLOSED as never[] } } });
  const pendingFU = await prisma.hRFollowUp.count({ where: { completedAt: null } });
  const overdueFU = await prisma.hRFollowUp.count({ where: { completedAt: null, dueAt: { lt: new Date() } } });
  const interviews = await prisma.hRInterview.count();
  const resumes = await prisma.hRResume.count();
  const imports = await prisma.hRImport.findMany({ orderBy: { createdAt: "desc" }, take: 5, select: { fileName: true, total: true, imported: true, updated: true, failed: true } });
  // orphan owner check
  const hrIds = (await prisma.user.findMany({ where: { OR: [{ hrOnly: true }, { hrTeam: true }, { role: "ADMIN" }] }, select: { id: true } })).map(u => u.id);
  const salesOwned = await prisma.hRCandidate.count({ where: { primaryOwnerId: { notIn: hrIds }, NOT: { primaryOwnerId: null } } });

  console.log("== HR PICKER USERS (hrOnly OR hrTeam) ==");
  console.log("  " + (hrUsers.map(u => `${u.name}${u.hrOnly ? "[hrOnly]" : ""}${u.hrTeam ? "[hrTeam]" : ""}`).join(", ") || "(none)"));
  console.log("  Lalit:", JSON.stringify(lalit));
  console.log("== ALL ACTIVE USERS ==");
  allUsers.forEach(u => console.log(`  ${u.name.padEnd(16)} ${u.role.padEnd(8)} hrOnly=${u.hrOnly} hrTeam=${u.hrTeam}`));
  console.log("== CANDIDATES ==");
  console.log(`  total=${total}  noPosition=${noPosition}  noNextAction(active)=${noNextAction}  salesOwned=${salesOwned}`);
  console.log("  byStatus:", byStatus.map(s => `${s.status}:${s._count}`).join("  "));
  console.log("== FOLLOW-UPS / INTERVIEWS / RESUMES ==");
  console.log(`  pendingFU=${pendingFU}  overdueFU=${overdueFU}  interviews=${interviews}  resumes=${resumes}`);
  console.log("== RECENT IMPORTS ==");
  console.log("  " + (imports.map(i => `${i.fileName}: ${i.imported} new/${i.total} (${i.failed} failed)`).join(" | ") || "none"));
  await prisma.$disconnect();
})();
