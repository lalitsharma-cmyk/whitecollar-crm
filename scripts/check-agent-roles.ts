import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const users = await prisma.user.findMany({ where:{ active:true }, select:{ name:true, email:true, role:true, team:true, isSuperAdmin:true }, orderBy:{ role:"asc" } });
  console.log("ACTIVE USERS:");
  for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.isSuperAdmin?"★":" "} ${(u.team??"—").padEnd(7)} ${u.name} <${u.email}>`);
  const agents = users.filter(u=>u.role==="AGENT");
  console.log(`\nAgents: ${agents.map(a=>a.name).join(", ")}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
