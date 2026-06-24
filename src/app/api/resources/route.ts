// Gallery / Resource Library — list/search + create (any active user, incl. AGENT).
//
//   GET  /api/resources?category=&type=&project=&q=&includeDeleted=
//        → list active resources. NEVER selects fileData (kept out of list
//          payloads — only the download route streams bytes).
//   POST /api/resources
//        → create a resource. multipart/form-data for a FILE upload (size + MIME
//          capped); application/json for a URL or TEXT resource.
import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import {
  MAX_FILE_BYTES,
  isAllowedMime,
  canCreateResources,
} from "@/lib/resources";

export const dynamic = "force-dynamic";

// Columns returned for list/cards — explicitly EXCLUDES fileData (bytea).
const LIST_SELECT = {
  id: true,
  title: true,
  category: true,
  type: true,
  fileName: true,
  mimeType: true,
  fileSize: true,
  fileUrl: true,
  textContent: true,
  projectName: true,
  tags: true,
  uploadedById: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  _count: { select: { shares: true } },
} satisfies Prisma.ResourceSelect;

export async function GET(req: NextRequest) {
  await requireUser();
  const url = new URL(req.url);
  const category = url.searchParams.get("category")?.trim() || "";
  const type = url.searchParams.get("type")?.trim().toUpperCase() || "";
  const project = url.searchParams.get("project")?.trim() || "";
  const q = url.searchParams.get("q")?.trim() || "";

  const where: Prisma.ResourceWhereInput = { deletedAt: null };
  if (category) where.category = category;
  if (type === "FILE" || type === "URL" || type === "TEXT") where.type = type;
  if (project) where.projectName = { contains: project, mode: "insensitive" };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { tags: { contains: q, mode: "insensitive" } },
      { projectName: { contains: q, mode: "insensitive" } },
      { category: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.resource.findMany({
    where,
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  // Any active, authenticated user (incl. AGENT) may upload — direct upload,
  // no approval flow. requireUser() already enforces active + authenticated.
  const me = await requireUser();
  if (!canCreateResources(me.role)) {
    return NextResponse.json({ error: "You must be signed in to upload resources" }, { status: 403 });
  }

  const ct = req.headers.get("content-type") ?? "";

  // ── FILE upload (multipart/form-data) ──
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    if (file.size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` }, { status: 413 });
    }
    if (!isAllowedMime(file.type)) {
      return NextResponse.json({ error: "Only images and PDF files are allowed" }, { status: 415 });
    }

    const title = String(fd.get("title") ?? "").trim() || file.name;
    const category = String(fd.get("category") ?? "").trim() || "Other";
    const projectName = String(fd.get("projectName") ?? "").trim() || null;
    const tags = String(fd.get("tags") ?? "").trim() || null;

    const buf = Buffer.from(await file.arrayBuffer());
    const created = await prisma.resource.create({
      data: {
        title,
        category,
        type: "FILE",
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
        fileData: buf,
        projectName,
        tags,
        uploadedById: me.id,
      },
      select: { id: true, title: true, type: true, category: true },
    });
    return NextResponse.json({ resource: created }, { status: 201 });
  }

  // ── URL / TEXT resource (application/json) ──
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const type = String(body.type ?? "").toUpperCase();
  const title = String(body.title ?? "").trim();
  const category = String(body.category ?? "").trim() || "Other";
  const projectName = String(body.projectName ?? "").trim() || null;
  const tags = String(body.tags ?? "").trim() || null;

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  if (type === "URL") {
    const fileUrl = String(body.fileUrl ?? "").trim();
    if (!/^https?:\/\//i.test(fileUrl)) {
      return NextResponse.json({ error: "A valid http(s) URL is required" }, { status: 400 });
    }
    const created = await prisma.resource.create({
      data: { title, category, type: "URL", fileUrl, projectName, tags, uploadedById: me.id },
      select: { id: true, title: true, type: true, category: true },
    });
    return NextResponse.json({ resource: created }, { status: 201 });
  }

  if (type === "TEXT") {
    const textContent = String(body.textContent ?? "").trim();
    if (!textContent) return NextResponse.json({ error: "Template text is required" }, { status: 400 });
    const created = await prisma.resource.create({
      data: { title, category: category || "Template", type: "TEXT", textContent, projectName, tags, uploadedById: me.id },
      select: { id: true, title: true, type: true, category: true },
    });
    return NextResponse.json({ resource: created }, { status: 201 });
  }

  return NextResponse.json({ error: "type must be FILE (multipart), URL, or TEXT" }, { status: 400 });
}
