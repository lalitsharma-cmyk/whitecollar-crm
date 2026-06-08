import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import bcrypt from "bcryptjs";

const ROLES = ["ADMIN", "MANAGER", "AGENT"];

async function adminOnly() {
  const me = await requireUser();
  return me.role === "ADMIN" ? me : null;
}

export async function GET() {
  const me = await adminOnly();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: { id: true, name: true, email: true, role: true, team: true, active: true, hrOnly: true, hrTeam: true },
  });
  return NextResponse.json({ users });
}

export async function POST(req: NextRequest) {
  const me = await adminOnly();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "AGENT").trim();
  const hrOnly = Boolean(body.hrOnly);
  const tempPassword = String(body.tempPassword ?? "").trim();

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!email.includes("@")) return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  if (!ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  if (tempPassword.length < 8) return NextResponse.json({ error: "Temporary password must be at least 8 characters" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });

  const passwordHash = await bcrypt.hash(tempPassword, 10);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role: role as "ADMIN" | "MANAGER" | "AGENT", hrOnly, team: hrOnly ? "HQ" : null, active: true },
    select: { id: true, name: true, email: true, role: true, hrOnly: true, active: true },
  });
  return NextResponse.json({ ok: true, user }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const me = await adminOnly();
  if (!me) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const data: { hrOnly?: boolean; hrTeam?: boolean; active?: boolean; role?: "ADMIN" | "MANAGER" | "AGENT" } = {};
  if (typeof body.hrOnly === "boolean") data.hrOnly = body.hrOnly;
  if (typeof body.hrTeam === "boolean") data.hrTeam = body.hrTeam;
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.role && ROLES.includes(body.role)) data.role = body.role;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  if (id === me.id && data.active === false) return NextResponse.json({ error: "You can't deactivate yourself" }, { status: 400 });

  const user = await prisma.user.update({ where: { id }, data, select: { id: true, hrOnly: true, active: true, role: true } });
  return NextResponse.json({ ok: true, user });
}
