import { classifyText } from "../src/lib/remarkParser";
const NOTcount = [
  "Shared sample video","Shared project video","Shared sample flat video","Shared brochure",
  "Shared floor plan","Shared price list","Shared payment plan","Shared location map",
  "Shared inventory","Shared presentation","Shared details on WhatsApp","Shared project information",
  "shared sample flat photos","saw sample video","client saw sample video","sample shown over video",
  "showed sample video","sent brochure on whatsapp","whatsapp the floor plan","forwarded price list",
];
const MUSTcount = [
  "Site visit done","Visited project","Site visit completed","Client visited site",
  "Physical visit conducted","Office meeting completed","Project visit completed",
  "came for site visit","saw sample flat","shown the sample apartment","sample flat shown",
  "site visit done, shared brochure afterwards",
];
let fail = 0;
console.log("MUST NOT be SITE_VISIT/MEETING:");
for (const p of NOTcount) { const c = classifyText(p); const bad = (c==="SITE_VISIT"||c==="MEETING"||c==="VIRTUAL_MEETING"); if(bad)fail++; console.log(`  ${bad?"✗":"✓"} ${c.padEnd(16)} ${JSON.stringify(p)}`); }
console.log("\nMUST count as a visit/meeting:");
for (const p of MUSTcount) { const c = classifyText(p); const ok=(c==="SITE_VISIT"||c==="MEETING"); if(!ok)fail++; console.log(`  ${ok?"✓":"✗"} ${c.padEnd(16)} ${JSON.stringify(p)}`); }
console.log(`\n${fail===0?"ALL PASS":fail+" FAILED"}`);
process.exit(fail?1:0);
