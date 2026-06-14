import { prisma } from "../src/lib/prisma";
const SUPPRESSED = ["Junk","Invalid Number","Number Changed","Pass Away","Blocked Me","Drop The Plan","By Mistake Inquiry"];
const HARDCODED5 = ["Junk","Invalid Number","Pass Away","Number Changed","By Mistake Inquiry"];
async function main(){
  const agents = await prisma.user.findMany({ where: { role: { in: ["AGENT","ADMIN"] }, active: true }, select: { id: true, name: true } });
  console.log("agent            | owned(ALL incl deleted) | owned(deletedAt:null) | Profile-active(5,noDel) | Dash-active(7,+del)");
  for (const a of agents) {
    const all = await prisma.lead.count({ where: { ownerId: a.id } });
    if (all === 0) continue;
    const live = await prisma.lead.count({ where: { ownerId: a.id, deletedAt: null } });
    const profile = await prisma.lead.count({ where: { ownerId: a.id, currentStatus: { notIn: HARDCODED5 } } });
    const dash = await prisma.lead.count({ where: { ownerId: a.id, deletedAt: null, currentStatus: { notIn: SUPPRESSED } } });
    console.log(`${(a.name??"").padEnd(16)} | ${String(all).padStart(22)} | ${String(live).padStart(20)} | ${String(profile).padStart(22)} | ${String(dash).padStart(17)}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
