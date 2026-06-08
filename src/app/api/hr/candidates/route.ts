import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus, HRFollowUpType } from "@prisma/client";
import { fingerprintFor } from "@/lib/assignment";
import { hrDuplicateWhere } from "@/lib/hrDuplicates";

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

  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "Candidate name is required." }, { status: 400 });
  }

  const status = (body.status as HRCandidateStatus) || "NEW";
  const isActive = !CLOSED_STATUSES.includes(status);
  const nextActionDate = body.nextActionDate ? new Date(body.nextActionDate) : null;

  // No active candidate may be saved without a follow-up.
  if (isActive && !nextActionDate) {
    return NextResponse.json(
      { error: "A next follow-up date & time is required for active candidates." },
      { status: 400 },
    );
  }

  // Duplicate check — mobile, WhatsApp, or email (last-10-digit aware).
  const dupWhere = hrDuplicateWhere(body.phone, body.whatsappPhone, body.email);
  if (dupWhere) {
    const existing = await prisma.hRCandidate.findFirst({ where: dupWhere, select: { id: true, name: true } });
    if (existing) {
      return NextResponse.json({ duplicate: true, existingId: existing.id, existingName: existing.name }, { status: 409 });
    }
  }

  const fp = fingerprintFor(body.phone, body.email);

  const candidate = await prisma.hRCandidate.create({
    data: {
      name: String(body.name).trim(),
      phone: body.phone || null,
      altPhone: body.altPhone || null,
      whatsappPhone: body.whatsappPhone || null,
      email: body.email || null,
      location: body.location || null,
      city: body.city || null,
      currentCompany: body.currentCompany || null,
      currentProfile: body.currentProfile || null,
      positionApplied: body.positionApplied || null,
      experience: body.experience || null,
      realEstateExperience: body.realEstateExperience || null,
      currentSalary: body.currentSalary ? parseFloat(body.currentSalary) : null,
      expectedSalary: body.expectedSalary ? parseFloat(body.expectedSalary) : null,
      noticePeriod: body.noticePeriod || null,
      source: body.source || null,
      status,
      remarks: body.remarks || null,
      tags: body.tags || null,
      nextAction: body.nextAction || null,
      nextActionDate,
      primaryOwnerId: body.primaryOwnerId || me.id,
      secondaryOwnerId: body.secondaryOwnerId || null,
      fingerprint: fp,
    },
  });

  // Creation timeline entry — Candidate Created (by / date / time on the activity).
  await prisma.hRActivity.create({
    data: {
      candidateId: candidate.id,
      userId: me.id,
      type: "NOTE_ADDED",
      notes: "Candidate created.",
      newStatus: candidate.status,
    },
  });

  // Every active candidate gets an initial follow-up so nothing slips.
  if (nextActionDate) {
    const fuType = (body.followUpType as HRFollowUpType) || "CALL_BACK";
    await prisma.hRFollowUp.create({
      data: {
        candidateId: candidate.id,
        userId: me.id,
        type: fuType,
        dueAt: nextActionDate,
        notes: body.nextAction || null,
      },
    });
    await prisma.hRActivity.create({
      data: {
        candidateId: candidate.id,
        userId: me.id,
        type: "FOLLOWUP_CREATED",
        notes: `Follow-up set: ${fuType.replace(/_/g, " ")} on ${nextActionDate.toLocaleDateString("en-IN")}`,
      },
    });
  }

  return NextResponse.json({ candidate }, { status: 201 });
}
