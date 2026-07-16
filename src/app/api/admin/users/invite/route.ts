// ADMIN-only: invite (create) a new user with a hashed temporary password.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { audit, reqMeta } from "@/lib/audit";

const VALID_ROLES = new Set(["ADMIN", "MANAGER", "AGENT"]);
const VALID_TEAMS = new Set(["Dubai", "India"]);

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  if ((me as { hrOnly?: boolean }).hrOnly) {
    return NextResponse.json({ error: "HR-only admins cannot create CRM users." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "").trim();
  const team = String(body.team ?? "").trim() || null;
  const tempPassword = String(body.tempPassword ?? "").trim();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  if (!VALID_ROLES.has(role)) return NextResponse.json({ error: "Role must be ADMIN, MANAGER, or AGENT" }, { status: 400 });
  // Only a super-admin may mint another ADMIN (privilege-escalation guard, 2026-07-17).
  if (role === "ADMIN" && !me.isSuperAdmin) {
    return NextResponse.json({ error: "Only a super-admin can create an ADMIN account." }, { status: 403 });
  }
  if (team !== null && !VALID_TEAMS.has(team)) return NextResponse.json({ error: "Team must be Dubai or India" }, { status: 400 });
  if (!tempPassword || tempPassword.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });

  const passwordHash = await bcrypt.hash(tempPassword, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: role as "ADMIN" | "MANAGER" | "AGENT",
      team,
      active: true,
    },
    select: { id: true, name: true, email: true, role: true, team: true, active: true, createdAt: true },
  });

  await audit({
    userId: me.id,
    action: "user.invite",
    entity: "User",
    entityId: user.id,
    meta: { name, email, role, team },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, user }, { status: 201 });
}
