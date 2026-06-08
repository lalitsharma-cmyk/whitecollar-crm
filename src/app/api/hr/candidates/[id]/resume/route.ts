import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Max file size: 5 MB (base64 encoded ≈ 6.7 MB stored — acceptable for ~10 HR users)
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id: candidateId } = await params;
  const url = new URL(req.url);
  const resumeId = url.searchParams.get("resumeId");
  if (!resumeId) return NextResponse.json({ error: "resumeId required" }, { status: 400 });

  await prisma.hRResume.delete({ where: { id: resumeId } });
  return NextResponse.json({ ok: true });
}
