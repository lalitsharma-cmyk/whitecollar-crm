// PUBLIC token-gated file download — streams a FILE resource's bytes WITHOUT a
// CRM login so a client who receives a WhatsApp/Email share link can open it.
//
// CAPABILITY MODEL: the resource cuid is the capability — it is unguessable
// (collision-resistant random id), so possession of the link is authorization.
// This is acceptable for shareable MARKETING collateral (brochures, creatives,
// payment plans). Do NOT store anything sensitive as a FILE resource.
//
// Guards: must exist, must be type=FILE with bytes, must NOT be soft-deleted.
// URL/TEXT resources are not served here (URL shares link straight to fileUrl).
import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const download = new URL(req.url).searchParams.get("download") === "1";

  // fileData IS selected here (this is the only route that loads bytes).
  const r = await prisma.resource.findUnique({
    where: { id },
    select: { type: true, fileName: true, mimeType: true, fileData: true, fileUrl: true, deletedAt: true },
  });

  if (!r || r.deletedAt) {
    return new Response("Not found", { status: 404 });
  }

  // External-URL resource → redirect to the hosted file.
  if (r.type === "URL" && r.fileUrl && /^https?:\/\//i.test(r.fileUrl)) {
    return Response.redirect(r.fileUrl, 302);
  }

  if (r.type !== "FILE" || !r.fileData) {
    return new Response("Not a downloadable file", { status: 404 });
  }

  const mime = r.mimeType || "application/octet-stream";
  const safeName = (r.fileName || "file").replace(/[^\w.\-]+/g, "_");
  // Prisma returns Bytes as a Node Buffer / Uint8Array.
  const bytes = r.fileData as unknown as Uint8Array;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
      "Content-Length": String(bytes.byteLength),
      // Public marketing collateral — fine to cache on the client/CDN briefly.
      "Cache-Control": "public, max-age=300",
    },
  });
}
