import { prisma } from "../src/lib/prisma";
import * as fs from "fs"; import * as path from "path";
async function main(){
  const rows = await prisma.lead.findMany({ select: { id: true, leadOrigin: true } });
  const dir = path.join(process.cwd(), "backups"); if(!fs.existsSync(dir)) fs.mkdirSync(dir);
  const file = path.join(dir, `phase-d-leadorigin-backup-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(rows));
  console.log(`backed up ${rows.length} leadOrigin values → ${file}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
