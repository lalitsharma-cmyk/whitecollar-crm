// READ-ONLY audit — investigate the two "Sameer" users in the active Sales agent list.
// Loads .env for DATABASE_URL exactly like scripts/prod-uat.ts. Performs ONLY
// findMany / count queries — NO writes, NO mutations. Safe to run against prod.
//
// Run:  npx tsx scripts/audit-sameer-users.ts
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = /^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

const IST = (d: Date | null | undefined) =>
  d ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d) + " IST" : "—";
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

async function main() {
  // Match every user whose name contains "sameer" (case-insensitive) — catches
  // "Sameer", "sameer ", "Sameer Khan", "Mohd Sameer", and trailing-space variants.
  const sameers = await prisma.user.findMany({
    where: { name: { contains: "sameer", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n================ "Sameer" user audit (read-only) ================`);
  console.log(`Matched ${sameers.length} user record(s) by name ~ "sameer":\n`);

  const summary: { name: string; id: string; email: string; active: boolean; total: number; activeLeads: number }[] = [];

  for (const u of sameers) {
    const totalLeads   = await prisma.lead.count({ where: { ownerId: u.id } });
    const activeLeads  = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null } });
    const deletedLeads = totalLeads - activeLeads;
    const callLogs     = await prisma.callLog.count({ where: { userId: u.id } });
    const activities   = await prisma.activity.count({ where: { userId: u.id } });
    const assignments  = await prisma.assignment.count({ where: { userId: u.id } });
    const latestLead   = await prisma.lead.findFirst({ where: { ownerId: u.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true, name: true } });
    // Has this account ever actually been LOGGED INTO? (stray vs in-use + security signal)
    const sessions     = await prisma.userSession.count({ where: { userId: u.id } });
    const lastSession  = await prisma.userSession.findFirst({ where: { userId: u.id }, orderBy: { lastActiveAt: "desc" }, select: { lastActiveAt: true, ip: true, city: true, country: true, revokedAt: true } });
    const devices      = await prisma.device.findMany({ where: { userId: u.id }, select: { name: true, status: true, lastSeenAt: true, lastIp: true } });

    summary.push({ name: u.name, id: u.id, email: u.email, active: u.active, total: totalLeads, activeLeads });

    console.log("──────────────────────────────────────────────────────────");
    console.log(`  name        : "${u.name}"        (quoted to reveal stray spaces / case)`);
    console.log(`  id          : ${u.id}`);
    console.log(`  email       : ${u.email}`);
    console.log(`  role        : ${u.role}`);
    console.log(`  team        : ${u.team ?? "—"}`);
    console.log(`  phone       : ${u.phone ?? "—"}`);
    console.log(`  active      : ${u.active}`);
    console.log(`  hrOnly      : ${u.hrOnly}`);
    console.log(`  managerId   : ${u.managerId ?? "—"}`);
    console.log(`  createdAt   : ${IST(u.createdAt)}`);
    console.log(`  ── owned leads (prisma.lead.count by ownerId) ──`);
    console.log(`     total     : ${totalLeads}`);
    console.log(`     active    : ${activeLeads}   (deletedAt = null — what the UI shows)`);
    console.log(`     recycled  : ${deletedLeads}   (soft-deleted)`);
    console.log(`     latest    : ${latestLead ? `${IST(latestLead.createdAt)} — "${latestLead.name}"` : "none"}`);
    console.log(`  ── other user-linked rows (context for safe deactivation) ──`);
    console.log(`     callLogs    : ${callLogs}`);
    console.log(`     activities  : ${activities}`);
    console.log(`     assignments : ${assignments}`);
    console.log(`  ── login footprint (has this account ever been used?) ──`);
    console.log(`     sessions    : ${sessions}`);
    console.log(`     lastLogin   : ${lastSession ? `${IST(lastSession.lastActiveAt)} from ${lastSession.ip ?? "?"} (${[lastSession.city, lastSession.country].filter(Boolean).join(", ") || "loc unknown"})${lastSession.revokedAt ? " [revoked]" : ""}` : "never logged in"}`);
    console.log(`     devices     : ${devices.length}${devices.length ? " → " + devices.map((d) => `${d.name} [${d.status}] last ${IST(d.lastSeenAt)}`).join("; ") : ""}`);
  }

  // Pairwise comparison — same person vs distinct people.
  if (sameers.length === 2) {
    const [a, b] = sameers;
    const sameEmail = a.email.trim().toLowerCase() === b.email.trim().toLowerCase();
    const samePhone = digits(a.phone) !== "" && digits(a.phone) === digits(b.phone);
    console.log("\n──────────────── COMPARISON ────────────────");
    console.log(`  same email?  ${sameEmail}    (${a.email}  vs  ${b.email})`);
    console.log(`  same phone?  ${samePhone}    (${a.phone ?? "—"}  vs  ${b.phone ?? "—"})`);
    console.log(`  same team?   ${a.team === b.team}    (${a.team ?? "—"}  vs  ${b.team ?? "—"})`);
    const oneEmpty = summary.some((s) => s.total === 0);
    console.log(`\n  Heuristic verdict: ${
      sameEmail
        ? "LIKELY DUPLICATE — identical email (same login identity)."
        : samePhone
          ? "POSSIBLE DUPLICATE — same phone, different emails (verify with Lalit)."
          : oneEmpty
            ? "INCONCLUSIVE — different identifiers but one record owns 0 leads; confirm with Lalit whether it's a stray."
            : "LIKELY TWO DISTINCT PEOPLE — different email & phone, both own leads."
    }`);
  } else {
    console.log(`\n  (Expected 2 records; got ${sameers.length}. Review the list above.)`);
  }

  console.log("\n(Read-only audit complete — no data was modified.)\n");
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
