// One-off: dump everything about a specific lead, plus simulate what the
// detail page would render for the Remarks card.
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const id = process.argv[2] ?? "cmpllr842002il504ujtr4zzd";
  const lead = await p.lead.findUnique({ where: { id } });
  if (!lead) { console.log("Not found:", id); await p.$disconnect(); return; }

  console.log("ID:        ", lead.id);
  console.log("Name:      ", lead.name);
  console.log("Owner:     ", lead.ownerId);
  console.log("Created:   ", lead.createdAt.toISOString());
  console.log("Source:    ", lead.source);
  console.log("");
  console.log("Has remarks?", lead.remarks != null && lead.remarks.length > 0);
  console.log("Remarks len:", lead.remarks?.length ?? 0);
  console.log("Remarks lines:", (lead.remarks ?? "").split(/\r?\n/).length);
  console.log("");
  console.log("RAW REMARKS (first 500 chars):");
  console.log(JSON.stringify((lead.remarks ?? "").slice(0, 500)));
  console.log("");
  console.log("RAW REMARKS (last 500 chars):");
  console.log(JSON.stringify((lead.remarks ?? "").slice(-500)));
  console.log("");

  // Simulate the InlineEdit textarea read-view pretty-print
  const raw = lead.remarks ?? "";
  const pretty = raw
    .replace(/(\s*,\s*){2,}/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[\s,]+|[\s,]+$/g, "");
  console.log("AFTER PRETTY-PRINT (what the new UI will show):");
  console.log("=".repeat(60));
  console.log(pretty);
  console.log("=".repeat(60));

  // Entry-count badge calculation
  const entryCount = (raw.match(/[oO]n\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}/g) ?? []).length;
  console.log(`\nEntry-count badge: 📅 ${entryCount} call entries · ${raw.length} chars`);

  await p.$disconnect();
})();
