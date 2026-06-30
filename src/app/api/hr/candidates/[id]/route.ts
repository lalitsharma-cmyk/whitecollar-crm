import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus } from "@prisma/client";
import { loadOwnedCandidate, hrCan, hrRoleOf, hrNotFound } from "@/lib/hrAccess";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // RBAC: 404 if the caller can't see this candidate.
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;

  const c = await prisma.hRCandidate.findUnique({
    where: { id },
    include: {
      primaryOwner:   { select: { id: true, name: true, avatarColor: true } },
      secondaryOwner: { select: { id: true, name: true, avatarColor: true } },
      activities:     { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
      interviews:     { orderBy: { scheduledAt: "asc" }, include: { interviewer: { select: { name: true } } } },
      followUps:      { orderBy: { dueAt: "asc" }, include: { user: { select: { name: true } } } },
      resumes:        { orderBy: { createdAt: "desc" } },
    },
  });
  if (!c) return hrNotFound();
  return NextResponse.json({ candidate: c });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // RBAC: must be allowed to act on this candidate.
  const access = await loadOwnedCandidate(id);
  if (access.error) return access.error;
  const { me } = access;
  const body = await req.json();

  // Fetch the full editable surface so we can DIFF old vs new and log an
  // HRActivity per meaningful field change (timeline + Recent Activity must be
  // complete — previously only a status change was recorded).
  const existing = await prisma.hRCandidate.findUnique({
    where: { id },
    select: {
      status: true, name: true, phone: true, altPhone: true, whatsappPhone: true,
      email: true, location: true, city: true, currentCompany: true, currentProfile: true,
      positionApplied: true, experience: true, realEstateExperience: true,
      currentSalary: true, expectedSalary: true, noticePeriod: true, source: true,
      remarks: true, tags: true, nextAction: true, nextActionDate: true, joiningDate: true,
      primaryOwnerId: true, secondaryOwnerId: true,
      fitExperience: true, fitCommunication: true, fitStability: true, fitSalary: true,
      fitNotice: true, interviewFeedback: true, joiningProbability: true,
    },
  });
  if (!existing) return hrNotFound();

  // Ownership reassignment is gated on the `assign` permission — a Junior HR
  // editing their own candidate cannot move it to (or away from) themselves.
  const canAssign = hrCan(me, "assign");

  // Validate any owner target up-front: a candidate may only be assigned to an
  // ACTIVE HR user (never orphaned onto a Sales/inactive account). Invalid → skip that field.
  const isActiveHrUser = async (uid: unknown): Promise<boolean> => {
    if (!uid || typeof uid !== "string") return false;
    const u = await prisma.user.findFirst({
      where: { id: uid, active: true, OR: [{ hrOnly: true }, { hrTeam: true }, { role: "ADMIN" }] },
      select: { id: true },
    });
    return !!u;
  };
  const okPrimary = ("primaryOwnerId" in body && body.primaryOwnerId) ? await isActiveHrUser(body.primaryOwnerId) : true;
  const okSecondary = ("secondaryOwnerId" in body && body.secondaryOwnerId) ? await isActiveHrUser(body.secondaryOwnerId) : true;

  const data: Record<string, unknown> = {};
  const allowed = ["name","phone","altPhone","whatsappPhone","email","location","city","currentCompany",
    "currentProfile","positionApplied","experience","realEstateExperience","currentSalary","expectedSalary",
    "noticePeriod","source","status","remarks","tags","nextAction","nextActionDate","joiningDate","primaryOwnerId","secondaryOwnerId",
    "fitExperience","fitCommunication","fitStability","fitSalary","fitNotice","interviewFeedback","joiningProbability"];
  for (const key of allowed) {
    if (!(key in body)) continue;
    if ((key === "primaryOwnerId" || key === "secondaryOwnerId") && !canAssign) continue; // silently ignore reassignment by non-assigners
    // Skip an owner field whose target isn't an active HR user (clearing to null still allowed).
    if (key === "primaryOwnerId" && body.primaryOwnerId && !okPrimary) continue;
    if (key === "secondaryOwnerId" && body.secondaryOwnerId && !okSecondary) continue;
    if (key === "currentSalary" || key === "expectedSalary") {
      data[key] = body[key] ? parseFloat(body[key]) : null;
    } else if (key === "nextActionDate" || key === "joiningDate") {
      data[key] = body[key] ? new Date(body[key]) : null;
    } else {
      data[key] = body[key] || null;
    }
  }

  if (data.status === "OFFER_RELEASED" && hrRoleOf(me) === "JUNIOR_HR") {
    return NextResponse.json({ error: "Junior HR can't release offers — ask a Senior HR." }, { status: 403 });
  }

  // A manual status change overrides the imported original-status label so the
  // badge reflects the new choice (the timeline still records the change).
  if (body.status && body.status !== existing.status) data.originalStatus = null;

  const updated = await prisma.hRCandidate.update({ where: { id }, data });

  // Log status change (kept as a distinct STATUS_CHANGED activity with the
  // old/new badge, exactly as before).
  if (body.status && body.status !== existing.status) {
    await prisma.hRActivity.create({
      data: {
        candidateId: id, userId: me.id,
        type: "STATUS_CHANGED",
        notes: body.statusNote || null,
        oldStatus: existing.status as HRCandidateStatus,
        newStatus: body.status as HRCandidateStatus,
      },
    });
  }

  // DIFF every other editable field that actually changed and write one
  // NOTE_ADDED activity per change so the timeline + Recent Activity are
  // complete (owner/salary/fit/feedback/joiningDate/remarks/nextAction/… were
  // previously silent). Status is excluded — handled above.
  const fmtMoney = (v: number | null | undefined) =>
    v == null ? "—" : `${(v / 100000).toLocaleString("en-IN", { maximumFractionDigits: 2 })}L`;
  const fmtDate = (v: Date | null | undefined) =>
    v == null ? "—" : new Date(v).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const fmtText = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  const sameDate = (a: Date | null | undefined, b: unknown) =>
    (a == null && b == null) || (a != null && b instanceof Date && new Date(a).getTime() === b.getTime());

  // Resolve owner names once (only if an owner field is in the changeset).
  const ownerName = async (uid: unknown): Promise<string> => {
    if (!uid || typeof uid !== "string") return "—";
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { name: true } });
    return u?.name || "Unknown";
  };

  // [field key, human label, kind]
  const fieldDefs: Array<[string, string, "text" | "money" | "date" | "owner"]> = [
    ["name", "Name", "text"], ["phone", "Phone", "text"], ["altPhone", "Alt Phone", "text"],
    ["whatsappPhone", "WhatsApp", "text"], ["email", "Email", "text"], ["location", "Location", "text"],
    ["city", "City", "text"], ["currentCompany", "Current Company", "text"],
    ["currentProfile", "Current Profile", "text"], ["positionApplied", "Position Applied", "text"],
    ["experience", "Experience", "text"], ["realEstateExperience", "Real Estate Experience", "text"],
    ["currentSalary", "Current Salary", "money"], ["expectedSalary", "Expected Salary", "money"],
    ["noticePeriod", "Notice Period", "text"], ["source", "Source", "text"],
    ["remarks", "Remarks", "text"], ["tags", "Tags", "text"], ["nextAction", "Next Action", "text"],
    ["nextActionDate", "Next Action Date", "date"], ["joiningDate", "Joining Date", "date"],
    ["fitExperience", "Fit: Experience", "text"], ["fitCommunication", "Fit: Communication", "text"],
    ["fitStability", "Fit: Stability", "text"], ["fitSalary", "Fit: Salary", "text"],
    ["fitNotice", "Fit: Notice", "text"], ["interviewFeedback", "Interview Feedback", "text"],
    ["joiningProbability", "Joining Probability", "text"],
    ["primaryOwnerId", "Owner", "owner"], ["secondaryOwnerId", "Secondary Owner", "owner"],
  ];

  const ex = existing as Record<string, unknown>;
  const changeNotes: string[] = [];
  for (const [key, label, kind] of fieldDefs) {
    if (!(key in data)) continue; // field wasn't part of the (permission-filtered) update
    const before = ex[key];
    const after = data[key];
    if (kind === "date") {
      if (sameDate(before as Date | null, after)) continue;
      changeNotes.push(`Updated ${label}: ${fmtDate(before as Date | null)} → ${fmtDate(after as Date | null)}`);
    } else if (kind === "money") {
      if ((before ?? null) === (after ?? null)) continue;
      changeNotes.push(`Updated ${label}: ${fmtMoney(before as number | null)} → ${fmtMoney(after as number | null)}`);
    } else if (kind === "owner") {
      if ((before ?? null) === (after ?? null)) continue;
      changeNotes.push(`${label} changed: ${await ownerName(before)} → ${await ownerName(after)}`);
    } else {
      if ((before ?? null) === (after ?? null)) continue;
      changeNotes.push(`Updated ${label}: ${fmtText(before)} → ${fmtText(after)}`);
    }
  }

  if (changeNotes.length > 0) {
    await prisma.hRActivity.createMany({
      data: changeNotes.map(notes => ({
        candidateId: id, userId: me.id, type: "NOTE_ADDED" as const, notes,
      })),
    });
  }

  return NextResponse.json({ candidate: updated });
}
