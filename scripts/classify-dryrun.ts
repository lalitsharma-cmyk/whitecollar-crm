// READ-ONLY dry-run of the lead auto-classifier. Writes NOTHING.
// Shows (a) the owner's spec examples and (b) real records → what the classifier
// would tag a NEW equivalent lead. For approval before any intake wiring/deploy.
import { prisma } from "../src/lib/prisma";
import { classifyLead, type ProjectRef } from "../src/lib/leadClassifier";

function row(label: string, c: ReturnType<typeof classifyLead>) {
  const team = c.team ?? "AWAITING";
  return `${label}\n    → Source=${c.source} | Type=${c.leadType ?? "—"} | Market=${c.market ?? "—"} | Team=${team} | Project=${c.project ?? "—"} | EventCity=${c.eventCity ?? "—"} | rule=${c.rule} | ${c.confidence.toUpperCase()}`;
}

(async () => {
  const projects: ProjectRef[] = await prisma.project.findMany({ select: { name: true, city: true, country: true } });

  console.log("══════════ A) OWNER SPEC EXAMPLES (blog leads) ══════════");
  const spec: { t: string; m: string }[] = [
    { t: "Dubai Property Expo in London", m: "Dubai Property Expo in London" },
    { t: "Dubai Property Expo in Istanbul", m: "Dubai Property Expo in Istanbul" },
    { t: "Dubai Property Expo in Ahmedabad", m: "Dubai Property Expo in Ahmedabad" },
    { t: "Sobha Central (Dubai project blog)", m: "Sobha Central" },
    { t: "DAMAC Riverside (Dubai project blog)", m: "DAMAC Riverside" },
    { t: "Emaar Beachfront (Dubai project blog)", m: "Emaar Beachfront" },
    { t: "Dubai investment blog", m: "Dubai investment opportunities 2026" },
    { t: "Whiteland (India project blog)", m: "Whiteland Westin Residences" },
    { t: "DLF (India project blog)", m: "DLF The Dahlias Gurgaon" },
    { t: "Smartworld (India project blog)", m: "Smartworld One DXP" },
    { t: "Central Park (India project blog)", m: "Central Park Flower Valley" },
    { t: "TARC (India project blog)", m: "TARC Kailasa" },
    { t: "DAMAC Riverside (not in DB)", m: "DAMAC Riverside" },
    { t: "DAMAC Islands (in DB)", m: "DAMAC Islands" },
    { t: "BARE DAMAC", m: "DAMAC" },
    { t: "BARE Emaar (both-market dev)", m: "Emaar" },
    { t: "BARE Sobha (both-market dev)", m: "Sobha" },
    { t: "Ambiguous (no signal)", m: "Please share details of luxury apartments" },
  ];
  for (const s of spec) {
    const c = classifyLead({ sourceRaw: "Blog", source: "WEBSITE", message: s.m }, projects);
    console.log(row(`  • ${s.t}  [msg: "${s.m}"]`, c));
  }

  console.log("\n══════════ B) REAL RECORDS (what a NEW equivalent lead would get) ══════════");
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, source: { in: ["WEBSITE", "EVENT", "FACEBOOK_ADS", "GOOGLE_ADS"] } },
    select: { name: true, source: true, sourceRaw: true, sourceDetail: true, city: true, notesShort: true, forwardedTeam: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: 16,
  });
  for (const l of leads) {
    const c = classifyLead(
      { source: l.source, sourceRaw: l.sourceRaw, sourceDetail: l.sourceDetail, message: l.notesShort, city: l.city },
      projects,
    );
    const cur = l.forwardedTeam ?? "AWAITING";
    const flag = (c.team ?? "AWAITING") === cur ? "=" : "Δ CHANGED";
    const sigs = `msg="${(l.notesShort || "").slice(0, 40)}" detail="${l.sourceDetail || ""}" city="${l.city || ""}"`;
    console.log(row(`  • ${l.name}  [${l.source}] (current: ${cur}) ${flag}\n      signals: ${sigs}`, c));
    console.log(`      why: ${c.reason}`);
  }
  await prisma.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
