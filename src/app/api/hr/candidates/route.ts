import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";
import { fingerprintFor } from "@/lib/assignment";

// Closed statuses — suppressed from default list view
const CLOSED_STATUSES: HRCandidateStatus[] = [
  "NOT_INTERESTED","NOT_SUITABLE","HIGH_SALARY","OTHER_PROFILE",
  "REJECTED","OFFER_DECLINED","WRONG_NUMBER","SWITCH_OFF",
  "NEVER_RESPONSE","NOT_RESPONDING",
];

export async function GET(req: NextRequest) {
  const me = await requireUser();
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("q") ?? undefined;
  const showClosed = url.searchParams.get("closed") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const PAGE = 50;

  const where: NonNullable<Parameters<typeof prisma.hRCandidate.findMany>[0]>["where"] = {};

  if (status) {
    where.status = status as HRCandidateStatus;
  } else if (!showClosed) {
    where.status = { notIn: CLOSED_STATUSES };
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
      { currentCompany: { contains: search, mode: "insensitive" } },
      { currentProfile: { contains: search, mode: "insensitive" } },
    ];
  }

  // Agents only see candidates they own
  if (me.role === "AGENT") {
    where.OR = [
      { primaryOwnerId: me.id },
      { secondaryOwnerId: me.id },
    ];
  }

  const [candidates, total] = await Promise.all([
    prisma.hRCandidate.findMany({
      where, orderBy: { nextActionDate: { sort: "asc", nulls: "last" } },
      skip: (page - 1) * PAGE, take: PAGE,
      include: {
        primaryOwner: { select: { name: true, avatarColor: true } },
        followUps: { where: { completedAt: null }, orderBy: { dueAt: "asc" }, take: 1 },
        interviews: { where: { attendanceStatus: "SCHEDULED" }, orderBy: { scheduledAt: "asc" }, take: 1 },
        _count: { select: { activities: true } },
      },
    }),
    prisma.hRCandidate.count({ where }),
  ]);

  return NextResponse.json({ candidates, total, page, pages: Math.ceil(total / PAGE) });
}

export async function POST(req: NextRequest) {
  const me = await requireUser();
  const body = await req.json();

  // Duplicate check
  const fp = fingerprintFor(body.phone, body.email);
  if (fp) {
    const existing = await prisma.hRCandidate.findUnique({ where: { fingerprint: fp } });
    if (existing) {
      return NextResponse.json({ duplicate: true, existingId: existing.id, existingName: existing.name }, { status: 409 });
    }
  }

  const candidate = await prisma.hRCandidate.create({
    data: {
      name: body.name,
      phone: body.phone || null,
      altPhone: body.altPhone || null,
      whatsappPhone: body.whatsappPhone || null,
      email: body.email || null,
      location: body.location || null,
      currentCompany: body.currentCompany || null,
      currentProfile: body.currentProfile || null,
      experience: body.experience || null,
      currentSalary: body.currentSalary ? parseFloat(body.currentSalary) : null,
      expectedSalary: body.expectedSalary ? parseFloat(body.expectedSalary) : null,
      noticePeriod: body.noticePeriod || null,
      source: body.source || null,
      status: (body.status as HRCandidateStatus) || "NEW",
      remarks: body.remarks || null,
      tags: body.tags || null,
      nextAction: body.nextAction || null,
      nextActionDate: body.nextActionDate ? new Date(body.nextActionDate) : null,
      primaryOwnerId: body.primaryOwnerId || me.id,
      secondaryOwnerId: body.secondaryOwnerId || null,
      fingerprint: fp,
    },
  });

  // Log creation activity
  await prisma.hRActivity.create({
    data: {
      candidateId: candidate.id,
      userId: me.id,
      type: "NOTE_ADDED",
      notes: "Candidate added to CRM.",
      newStatus: candidate.status,
    },
  });

  return NextResponse.json({ candidate }, { status: 201 });
}
