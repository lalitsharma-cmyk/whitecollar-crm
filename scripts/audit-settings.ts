import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const DEF: Record<string,string> = { "roundRobin.enabled":"true (default)", "testingMode.enabled":"true (default)", "speedToLead.enabled":"true (default)", "ai.enabled":"false (default)" };
async function main(){
  console.log("LIVE automation settings (Setting table; else default):");
  for (const k of Object.keys(DEF)) {
    const row = await prisma.setting.findUnique({ where:{ key:k } });
    console.log(`  ${k.padEnd(24)} = ${row ? `"${row.value}"  (set in DB)` : DEF[k]}`);
  }
  console.log("\nActor / owner user IDs from the audit:");
  for (const id of ["cmplo0t6v0000vpxslasvbwuq","cmpidrrjp0002vphgqb432xq7","cmpidrs1n0005vphgg1tj84pj","cmpidrs1n0005vphgg1tj84pj"]) {
    const u = await prisma.user.findUnique({ where:{ id }, select:{ name:true, email:true, role:true, team:true } });
    if (u) console.log(`  ${id} = ${u.name} (${u.email}, ${u.role}, team ${u.team})`);
  }
  // Mehak (Tanishk's owner)
  const mehak = await prisma.user.findFirst({ where:{ email:{ contains:"mehakmukhija", mode:"insensitive" } }, select:{ id:true, name:true, team:true } });
  console.log(`  Mehak = ${JSON.stringify(mehak)}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
