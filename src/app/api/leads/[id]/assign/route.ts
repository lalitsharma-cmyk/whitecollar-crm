import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";

// Manual reassign — Admin or Manager only.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
  await assignLeadTo(id, userId, "manual assignment");
  return NextResponse.json({ ok: true });
}
