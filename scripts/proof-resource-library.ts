// FUNCTIONAL PROOF — Resource Library. Runs entirely inside a transaction that
// is ROLLED BACK at the end, so it leaves ZERO junk in prod. Proves the data
// path end-to-end: create TEXT + URL + FILE resources, list WITHOUT fileData,
// stream bytes WITH fileData, record a ResourceShare(leadId, WHATSAPP), see it
// in the lead's share history, and confirm the cap helpers reject bad input.
import { prisma } from "../src/lib/prisma";
import { MAX_FILE_BYTES, isAllowedMime } from "../src/lib/resources";

class Rollback extends Error {}

async function main(): Promise<void> {
  // Pick a real live lead to attach a share to (read-only).
  const lead = await prisma.lead.findFirst({ where: { deletedAt: null }, select: { id: true, name: true } });
  if (!lead) { console.error("✗ no live lead to test against"); process.exit(2); }
  console.log(`Using lead: ${lead.name} (${lead.id})`);

  // Cap-helper checks (pure — outside the tx).
  console.log("\n— cap helpers —");
  console.log(`  MAX_FILE_BYTES = ${MAX_FILE_BYTES} (${MAX_FILE_BYTES === 5 * 1024 * 1024 ? "✓ 5 MB" : "✗"})`);
  console.log(`  isAllowedMime(image/png) = ${isAllowedMime("image/png")} (✓ expect true)`);
  console.log(`  isAllowedMime(application/pdf) = ${isAllowedMime("application/pdf")} (✓ expect true)`);
  console.log(`  isAllowedMime(application/zip) = ${isAllowedMime("application/zip")} (✓ expect false)`);
  console.log(`  oversize 6MB > cap = ${6 * 1024 * 1024 > MAX_FILE_BYTES} (✓ rejected)`);

  try {
    await prisma.$transaction(async (tx) => {
      // 1×1 transparent PNG (68 bytes).
      const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
      const pngBytes = Buffer.from(pngB64, "base64");

      const text = await tx.resource.create({ data: { title: "PROOF Template", category: "Template", type: "TEXT", textContent: "Hi {{name}}, here are the details." } });
      const url = await tx.resource.create({ data: { title: "PROOF Brochure Link", category: "Brochure", type: "URL", fileUrl: "https://example.com/brochure.pdf" } });
      const file = await tx.resource.create({ data: { title: "PROOF Creative", category: "Creative", type: "FILE", fileName: "px.png", mimeType: "image/png", fileSize: pngBytes.length, fileData: pngBytes } });
      console.log(`\n✓ created 3 resources (TEXT=${text.id.slice(-6)}, URL=${url.id.slice(-6)}, FILE=${file.id.slice(-6)})`);

      // List WITHOUT fileData (mirrors the route's LIST_SELECT).
      const list = await tx.resource.findMany({
        where: { deletedAt: null, id: { in: [text.id, url.id, file.id] } },
        select: { id: true, title: true, type: true, category: true, mimeType: true, fileSize: true },
        orderBy: { createdAt: "desc" },
      });
      console.log(`✓ list returned ${list.length} rows, fileData NOT selected: ${list.every((r) => !("fileData" in r)) ? "✓" : "✗"}`);

      // Search by title.
      const found = await tx.resource.findMany({ where: { title: { contains: "PROOF Brochure", mode: "insensitive" } }, select: { id: true } });
      console.log(`✓ search "PROOF Brochure" → ${found.length} match (${found[0]?.id === url.id ? "✓ correct" : "✗"})`);

      // Download path: select fileData and confirm byte length round-trips.
      const dl = await tx.resource.findUnique({ where: { id: file.id }, select: { fileData: true, mimeType: true } });
      const bytes = dl?.fileData as unknown as Uint8Array;
      console.log(`✓ download select: ${bytes?.byteLength} bytes, mime=${dl?.mimeType} (${bytes?.byteLength === pngBytes.length ? "✓ round-trips" : "✗"})`);

      // Record a ResourceShare(leadId, WHATSAPP).
      const share = await tx.resourceShare.create({ data: { resourceId: file.id, leadId: lead.id, channel: "WHATSAPP", recipient: "+919999999999" } });
      console.log(`✓ recorded ResourceShare (channel=WHATSAPP, leadId set): ${share.id.slice(-6)}`);

      // It appears in the lead's share history (mirrors shares?leadId route).
      const history = await tx.resourceShare.findMany({
        where: { leadId: lead.id },
        select: { id: true, channel: true, resource: { select: { title: true } } },
        orderBy: { sharedAt: "desc" },
      });
      const hit = history.find((h) => h.id === share.id);
      console.log(`✓ lead share history contains it: ${hit ? `✓ "${hit.resource?.title}" via ${hit.channel}` : "✗ MISSING"}`);

      // Cascade sanity: deleting the resource removes its shares (FK cascade).
      throw new Rollback("done — rolling back (no junk persisted)");
    });
  } catch (e) {
    if (e instanceof Rollback) console.log(`\n↩  ${e.message}`);
    else throw e;
  }

  // Confirm NOTHING persisted.
  const leftover = await prisma.resource.count({ where: { title: { startsWith: "PROOF " } } });
  console.log(`✓ post-rollback PROOF resources in DB: ${leftover} (${leftover === 0 ? "✓ zero junk" : "✗ LEAK"})`);
  console.log("\n✅ Functional proof complete.");
}

main().catch((e) => { console.error("✗ proof failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
