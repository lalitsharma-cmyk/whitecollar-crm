import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  // Reject-origin "Booked With Us" (the ones to remap).
  const rej = await prisma.lead.count({ where: { rejectionReason: "BOOKED_WITH_US" } });
  // Real bookings via status (NOT to touch): status booked but reason != BOOKED_WITH_US.
  const statusBooked = await prisma.lead.count({ where: { currentStatus: { in: ["Booked With Us","Booked with Us"] } } });
  const realBookings = await prisma.lead.count({ where: { currentStatus: { in: ["Booked With Us","Booked with Us"] }, NOT: { rejectionReason: "BOOKED_WITH_US" } } });
  console.log(`rejectionReason=BOOKED_WITH_US (REMAP these): ${rej}`);
  console.log(`currentStatus Booked With Us (any): ${statusBooked}  ·  of which NOT reject-origin (DO NOT TOUCH): ${realBookings}`);
  const sample = await prisma.lead.findMany({ where: { rejectionReason: "BOOKED_WITH_US" }, take: 12,
    select: { name: true, currentStatus: true, rejectionNote: true, remarks: true, rawRemarks: true } });
  console.log(`\nSamples (note/remarks drive Purchased-Elsewhere vs Booked-Other-Channel):`);
  for (const l of sample) {
    const txt = (l.rejectionNote || l.remarks || l.rawRemarks || "").replace(/\s+/g," ").slice(0,90);
    console.log(`  ${(l.currentStatus??"—").padEnd(16)} ${l.name?.slice(0,22).padEnd(24)} ${JSON.stringify(txt)}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
