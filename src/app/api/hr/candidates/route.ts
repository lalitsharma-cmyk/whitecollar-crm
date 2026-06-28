import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus, HRFollowUpType } from "@prisma/client";
import { fingerprintFor } from "@/lib/assignment";
import { hrDuplicateWhere } from "@/lib/hrDuplicates";
import { CLOSED_STATUS_KEYS } from "@/lib/hrStatus";
import { hrApiAuth, hrActiveScopeWhere, hrRoleOf } from "@/lib/hrAccess";

export async function GET(req: NextRequest) {
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const { me } = auth;
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const search = url.searchParams.get("q") ?? undefined;
  const showClosed = url.searchParams.get("closed") === "1";
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const PAGE = 50;

  const filters: NonNullable<Parameters<typeof prisma.hRCandidate.findMany>[0]>["where"] = {};

  if (status) {
    filters.status = status as HRCandidateStatus;
  } else if (!showClosed) {
    filters.status = { notIn: CLOSED_STATUS_KEYS };
  }

  if (search) {
    filters.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { email: { contains: search, mode: "insensitive" } },
      { currentCompany: { contains: search, mode: "insensitive" } },
      { currentProfile: { contains: search, mode: "insensitive" } },
    ];
  }

  // Scope by HR role: Junior HR only sees their own candidates; Admin/Senior HR see all.
  // Combined with the request filters via AND so the search OR isn't clobbered.
  // hrActiveScopeWhere also excludes soft-deleted (recycle-bin) candidates.
  const where = { AND: [hrActiveScopeWhere(me), filters] };

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
  const auth = await hrApiAuth();
  if (auth.error) return auth.error;
  const { me } = auth;
  const body = await req.json();

  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: "Candidate name is required." }, { status: 400 });
  }
  if (!body.phone || !String(body.phone).trim()) {
    return NextResponse.json({ error: "Mobile number is required." }, { status: 400 });
  }
  if (!body.positionApplied || !String(body.positionApplied).trim()) {
    return NextResponse.json({ error: "Position applied for is required." }, { status: 400 });
  }

  const status = (body.status as HRCandidateStatus) || "NEW";

  if (status === "OFFER_RELEASED" && me.role === "AGENT") {
    return NextResponse.json({ error: "Interns can't release offers — ask a manager." }, { status: 403 });
  }
  // Follow-up is OPTIONAL at creation. A candidate with no next action surfaces under
  // "No Next Action" on the dashboard / Missed center until HR schedules the first follow-up.
  const nextActionDate = body.nextActionDate ? new Date(body.nextActionDate) : null;

  // Duplicate check — mobile, WhatsApp, or email (last-10-digit aware).
  const dupWhere = hrDuplicateWhere(body.phone, body.whatsappPhone, body.email);
  if (dupWhere) {
    const existing = await prisma.hRCandidate.findFirst({ where: { AND: [dupWhere, { deletedAt: null }] }, select: { id: true, name: true } });
    if (existing) {
      return NextResponse.json({ duplicate: true, existingId: existing.id, existingName: existing.name }, { status: 409 });
    }
  }

  const fp = fingerprintFor(body.phone, body.email);

  // Junior HR own what they create — they can never assign an arbitrary owner.
  const isJunior = hrRoleOf(me) === "JUNIOR_HR";
  const primaryOwnerId = isJunior ? me.id : (body.primaryOwnerId || me.id);
  const secondaryOwnerId = isJunior ? null : (body.secondaryOwnerId || null);

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
      primaryOwnerId,
      secondaryOwnerId,
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
