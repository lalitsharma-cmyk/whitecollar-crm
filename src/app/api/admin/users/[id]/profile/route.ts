// Admin/Manager: update an agent's profile fields — specialization tags + daily call target.
// Spec §9.13 (specialization vocab) + "Daily call targets per agent" item from master spec.
// Both fields are optional in the body; only provided keys are updated.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

const ALLOWED_SPECIALIZATIONS = new Set([
  "Dubai investor",
  "Gurgaon luxury",
  "Villa closer",
  "Commercial",
  "NRI",
  "First-time buyer",
  "Negotiation support",
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireRole("ADMIN", "MANAGER");
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: { specializations?: string | null; dailyCallTarget?: number } = {};

  if ("specializations" in body) {
    const raw = body.specializations;
    if (raw === null || raw === "") {
      data.specializations = null;
    } else if (typeof raw === "string") {
      const cleaned = raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && ALLOWED_SPECIALIZATIONS.has(s));
      // dedupe while preserving order
      const seen = new Set<string>();
      const unique = cleaned.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));
      data.specializations = unique.length === 0 ? null : unique.join(",");
    } else {
      return NextResponse.json({ error: "specializations must be a comma-separated string or null" }, { status: 400 });
    }
  }

  if ("dailyCallTarget" in body) {
    const raw = body.dailyCallTarget;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1000 || !Number.isInteger(n)) {
      return NextResponse.json({ error: "dailyCallTarget must be an integer 0–1000" }, { status: 400 });
    }
    data.dailyCallTarget = n;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields provided" }, { status: 400 });
  }

  await prisma.user.update({ where: { id }, data });
  await audit({
    userId: me.id,
    action: "user.profile.set",
    entity: "User",
    entityId: id,
    meta: data,
    request: reqMeta(req),
  });
  return NextResponse.json({ ok: true });
}
