import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  await prisma.setting.upsert({ where:{key:"roundRobin.enabled"}, create:{key:"roundRobin.enabled",value:"false"}, update:{value:"false"} });
  const rr = await prisma.setting.findUnique({where:{key:"roundRobin.enabled"}});
  const tm = await prisma.setting.findUnique({where:{key:"testingMode.enabled"}});
  console.log(`roundRobin.enabled = ${rr?.value}  ·  testingMode.enabled = ${tm?.value ?? "true(default)"}`);
  console.log("→ Auto-assign reconciler is OFF (needs roundRobin ON + testingMode OFF to run).");
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
