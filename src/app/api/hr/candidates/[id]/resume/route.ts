import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { loadOwnedCandidate } from "@/lib/hrAccess";

// Max file size: 5 MB (base64 encoded ≈ 6.7 MB stored — acceptable for ~10 HR users)
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;

  const fd = await req.formData();
  const file = fd.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 5 MB)" }, { status: 413 });

  const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
  if (!allowed.includes(file.type) && !/\.(pdf|docx?|jpe?g|png|webp|heic)$/i.test(file.name)) {
    return NextResponse.json({ error: "Only PDF, DOC, DOCX, or image files are supported" }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  const dataUrl = `data:${file.type};base64,${base64}`;

  // Deactivate previous active resume
  await prisma.hRResume.updateMany({
    where: { candidateId: id, isActive: true },
    data: { isActive: false },
  });

  const resume = await prisma.hRResume.create({
    data: {
      candidateId: id,
      url: dataUrl,
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      isActive: true,
      uploadedById: me.id,
    },
  });

  // Log activity
  await prisma.hRActivity.create({
    data: {
      candidateId: id,
      userId: me.id,
      type: "NOTE_ADDED",
      notes: `Resume uploaded: ${file.name}`,
    },
  });

  return NextResponse.json({ resume: { id: resume.id, filename: resume.filename, isActive: resume.isActive } }, { status: 201 });
}

// GET — stream a stored resume so the browser reliably opens/downloads it.
// Resumes are stored as base64 data URLs in Postgres; linking an <a href> at a
// huge data: URL fails in Chrome (top-level data-URL navigation is blocked) and
// import-attached rows stored the raw Excel cell as `url` (→ 404). This route
// decodes + streams the bytes, or redirects if the value is a real http(s) URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const url = new URL(req.url);
  const resumeId = url.searchParams.get("resumeId");
  const download = url.searchParams.get("download") === "1";

  // Additive, backward-compatible mode: `?list=1` returns the full version
  // history (metadata only, never the file bytes) for THIS candidate, newest
  // first. Used by the Resume Bank version-history view. Existing callers that
  // omit `list` keep getting the streamed file as before.
  if (url.searchParams.get("list") === "1") {
    const versions = await prisma.hRResume.findMany({
      where: { candidateId },
      orderBy: [{ isActive: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, filename: true, mimeType: true, sizeBytes: true,
        isActive: true, createdAt: true,
        uploadedBy: { select: { name: true } },
      },
    });
    return NextResponse.json({ versions });
  }

  const resume = resumeId
    ? await prisma.hRResume.findUnique({ where: { id: resumeId } })
    : await prisma.hRResume.findFirst({ where: { candidateId, isActive: true }, orderBy: { createdAt: "desc" } });

  if (!resume || resume.candidateId !== candidateId) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const val = resume.url ?? "";
  // Real external/storage URL → redirect to it.
  if (/^https?:\/\//i.test(val)) return NextResponse.redirect(val);

  // base64 (or plain) data URL → decode + stream with the right headers.
  const m = val.match(/^data:([^;,]*)?(;base64)?,([\s\S]*)$/);
  if (m) {
    const mime = resume.mimeType || m[1] || "application/octet-stream";
    const buf = m[2] ? Buffer.from(m[3], "base64") : Buffer.from(decodeURIComponent(m[3]), "utf8");
    const safeName = (resume.filename || "resume").replace(/[^\w.\-]+/g, "_");
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safeName}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  }

  // Anything else (relative path / raw Excel text) — cannot be served.
  return NextResponse.json({ error: "Resume file link is invalid — please re-upload this resume." }, { status: 404 });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: candidateId } = await params;
  const access = await loadOwnedCandidate(candidateId);
  if (access.error) return access.error;
  const url = new URL(req.url);
  const resumeId = url.searchParams.get("resumeId");
  if (!resumeId) return NextResponse.json({ error: "resumeId required" }, { status: 400 });

  // Verify the resume actually belongs to this candidate before deleting
  // (prevents deleting another candidate's resume by id).
  const resume = await prisma.hRResume.findUnique({ where: { id: resumeId }, select: { candidateId: true } });
  if (!resume || resume.candidateId !== candidateId) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  await prisma.hRResume.delete({ where: { id: resumeId } });
  return NextResponse.json({ ok: true });
}
