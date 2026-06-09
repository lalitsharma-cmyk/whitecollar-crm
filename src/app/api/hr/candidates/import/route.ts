import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { HRCandidateStatus, Prisma } from "@prisma/client";
import { fingerprintFor } from "@/lib/assignment";
import { categorizeStatus } from "@/lib/hrStatus";

// Status handling now lives in lib/hrStatus.categorizeStatus(): the EXACT Excel
// text is preserved on HRCandidate.originalStatus and shown to the user, while
// `status` stores the mapped CRM category. Nothing falls through to "unmapped".

function num(v?: string): number | null { if (!v) return null; const n = parseFloat(String(v).replace(/[^\d.]/g, "")); return isNaN(n) ? null : n; }

// ── Date parsing: ISO, dd/mm/yyyy, "9 Jun 2026", JS Date string, Excel serial ─
function atNoonIST(d: Date): Date { const x = new Date(d); x.setUTCHours(6, 30, 0, 0); return x; }
function parseHrDate(v?: string): Date | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // Excel serial number (days since 1899-12-30)
  if (/^\d{4,6}(\.\d+)?$/.test(s)) {
    const serial = parseFloat(s);
    if (serial > 20000 && serial < 80000) {
      const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return atNoonIST(d);
    }
  }
  // dd/mm/yyyy or dd-mm-yyyy (Indian order)
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1]), mon = parseInt(dmy[2]) - 1;
    let year = parseInt(dmy[3]); if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) return new Date(Date.UTC(year, mon, day, 6, 30));
  }
  // generic (ISO, "9 Jun 2026", "Thu Jun 09 2026 ...")
  const t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);
  return null;
}

type Row = Record<string, string>;
function toData(r: Row) {
  return {
    name: (r.name ?? "").trim(),
    phone: r.phone?.trim() || null, whatsappPhone: r.whatsappPhone?.trim() || null,
    email: r.email?.trim().toLowerCase() || null, location: r.location?.trim() || null, city: r.city?.trim() || null,
    currentCompany: r.currentCompany?.trim() || null, currentProfile: r.currentProfile?.trim() || null,
    positionApplied: r.positionApplied?.trim() || null, experience: r.experience?.trim() || null,
    realEstateExperience: r.realEstateExperience?.trim() || null,
    currentSalary: num(r.currentSalary), expectedSalary: num(r.expectedSalary),
    noticePeriod: r.noticePeriod?.trim() || null, source: r.source?.trim() || "Import",
    remarks: r.remarks?.trim() || null,
  };
}

async function attachResume(candidateId: string, url: string, userId: string) {
  await prisma.hRResume.updateMany({ where: { candidateId, isActive: true }, data: { isActive: false } });
  await prisma.hRResume.create({
    data: { candidateId, url, filename: (url.split("/").pop() || "resume").slice(0, 120), mimeType: "application/octet-stream", isActive: true, uploadedById: userId },
  });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

const SCHEDULED_STATUSES: HRCandidateStatus[] = ["F2F_INTERVIEW_SCHEDULED", "VIRTUAL_INTERVIEW_SCHEDULED"];

// Build the workflow records (follow-ups / interviews / timeline) an imported
// row implies. This is the core of the fix: a candidate row is turned into an
// operational recruitment workflow, not just a contact.
function buildWorkflow(r: Row, status: HRCandidateStatus, ownerId: string) {
  const followUpDate = parseHrDate(r.followUpDate);
  const interviewDate = parseHrDate(r.interviewDate);
  const joiningDate = parseHrDate(r.joiningDate);
  const rawStatus = (r.status ?? "").trim();
  const remarks = r.remarks?.trim() || "";

  const isNoShow = status === "NO_SHOW";
  const isScheduled = SCHEDULED_STATUSES.includes(status);

  const followUps: Prisma.HRFollowUpCreateManyCandidateInput[] = [];
  const interviews: Prisma.HRInterviewCreateManyCandidateInput[] = [];
  const activities: Prisma.HRActivityCreateManyCandidateInput[] = [];

  const now = new Date();

  // Interview event from an explicit interview date or a scheduled status.
  if (interviewDate || (isScheduled && followUpDate)) {
    const when = interviewDate ?? followUpDate!;
    interviews.push({
      type: status === "VIRTUAL_INTERVIEW_SCHEDULED" ? "VIRTUAL" : "FACE_TO_FACE",
      scheduledAt: when, confirmationStatus: "PENDING", attendanceStatus: "SCHEDULED",
      notes: "Scheduled from Excel import",
    });
    activities.push({ type: "INTERVIEW_SCHEDULED", userId: ownerId, notes: `Interview scheduled for ${fmtDate(when)} (imported)` });
  }

  // No-show → recovery interview + recovery follow-up + timeline.
  if (isNoShow) {
    interviews.push({
      type: "FACE_TO_FACE", scheduledAt: interviewDate ?? followUpDate ?? now,
      confirmationStatus: "PENDING", attendanceStatus: "NO_SHOW", notes: "Did not attend (imported)",
      noShowReason: remarks || null,
    });
    followUps.push({ type: "NO_SHOW_RECOVERY", dueAt: now, autoCreated: true, userId: ownerId, notes: "No-show recovery — re-engage candidate" });
    activities.push({ type: "INTERVIEW_NO_SHOW", userId: ownerId, notes: "Candidate did not attend the interview (imported)" });
  } else if (followUpDate) {
    // Regular follow-up from the Excel follow-up date.
    followUps.push({ type: "CALL_BACK", dueAt: followUpDate, autoCreated: true, userId: ownerId, notes: r.nextAction?.trim() || "Follow up (imported)" });
  }

  // Always leave a timeline entry preserving the original recruitment story.
  const summary = [
    "Imported from Excel.",
    rawStatus ? `Original status: ${rawStatus}.` : null,
    followUpDate ? `Follow-up: ${fmtDate(followUpDate)}.` : null,
    interviewDate ? `Interview: ${fmtDate(interviewDate)}.` : null,
    joiningDate ? `Joining: ${fmtDate(joiningDate)}.` : null,
    remarks ? `Remarks: ${remarks}` : null,
  ].filter(Boolean).join(" ");
  activities.push({ type: "NOTE_ADDED", userId: ownerId, notes: summary });

  // Next action + date drive the dashboard "who to call now" / "no next action".
  const nextActionDate = isNoShow ? now : (followUpDate ?? interviewDate ?? null);
  const nextAction = isNoShow ? "No-show recovery — re-engage"
    : (interviewDate || isScheduled) ? "Confirm / conduct interview"
    : followUpDate ? (r.nextAction?.trim() || "Follow up with candidate")
    : (r.nextAction?.trim() || null);

  return { followUps, interviews, activities, nextActionDate, nextAction, joiningDate, hasFollowUpDate: !!followUpDate, hasInterviewDate: !!interviewDate };
}

// Batched candidate import. The client sends rows in chunks (~100) and shows
// progress, so no single request risks the serverless timeout.
export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") return NextResponse.json({ error: "Only Admin / HR Manager can import." }, { status: 403 });

  const body = await req.json();
  const rows: Row[] = Array.isArray(body.rows) ? body.rows : [];
  const strategy: "skip" | "update" | "create" = ["skip", "update", "create"].includes(body.strategy) ? body.strategy : "skip";
  const ownerId: string = body.primaryOwnerId || me.id;
  const importBatchId: string | null = typeof body.importBatchId === "string" && body.importBatchId ? body.importBatchId : null;

  const summary = {
    imported: 0, updated: 0, skipped: 0, failed: 0,
    followUpsCreated: 0, interviewsCreated: 0, noShowRecoveriesCreated: 0, timelineEntriesCreated: 0,
    missingStatus: 0, missingFollowUpDate: 0, missingInterviewDate: 0,
    errorRows: [] as { row: string; reason: string }[],
  };
  if (rows.length === 0) return NextResponse.json(summary);

  // One indexed lookup for the whole batch + existing-workflow counts so a
  // re-import (reprocessing) doesn't duplicate auto-created records.
  const fps = Array.from(new Set(rows.map(r => fingerprintFor(r.phone, r.email)).filter(Boolean) as string[]));
  const existing = fps.length
    ? await prisma.hRCandidate.findMany({
        where: { fingerprint: { in: fps } },
        select: { id: true, fingerprint: true, _count: { select: { followUps: true, interviews: true, activities: true } } },
      })
    : [];
  const existingByFp = new Map(existing.map(e => [e.fingerprint!, e]));
  const seenFp = new Set<string>();

  for (const r of rows) {
    const phoneVal = (r.phone ?? "").trim();
    const name = (r.name ?? "").trim() || (phoneVal ? `Candidate - ${phoneVal}` : "");
    if (!name) { summary.failed++; summary.errorRows.push({ row: r.email?.trim() || "(blank row)", reason: "Missing both name and phone" }); continue; }

    const rawStatus = (r.status ?? "").trim();
    const status = categorizeStatus(rawStatus);
    if (!rawStatus) summary.missingStatus++;

    const wf = buildWorkflow(r, status, ownerId);
    if (!wf.hasFollowUpDate) summary.missingFollowUpDate++;
    if (!wf.hasInterviewDate) summary.missingInterviewDate++;

    const fp = fingerprintFor(r.phone, r.email);
    const existsRow = fp ? existingByFp.get(fp) : undefined;

    try {
      if (existsRow) {
        if (strategy === "skip") { summary.skipped++; continue; }
        if (strategy === "update") {
          const d = toData(r);
          const upd: Record<string, unknown> = { status, nextActionDate: wf.nextActionDate, nextAction: wf.nextAction, joiningDate: wf.joiningDate };
          if (rawStatus) upd.originalStatus = rawStatus;
          for (const [k, v] of Object.entries(d)) if (v !== null && v !== "" && k !== "name") upd[k] = v;
          await prisma.hRCandidate.update({ where: { id: existsRow.id }, data: upd });

          // Only create workflow records the candidate is missing — keeps a
          // reprocess re-import idempotent (won't pile up duplicate rows).
          if (existsRow._count.followUps === 0 && wf.followUps.length) {
            await prisma.hRFollowUp.createMany({ data: wf.followUps.map(f => ({ ...f, candidateId: existsRow.id })) as Prisma.HRFollowUpCreateManyInput[] });
            summary.followUpsCreated += wf.followUps.length;
            summary.noShowRecoveriesCreated += wf.followUps.filter(f => f.type === "NO_SHOW_RECOVERY").length;
          }
          if (existsRow._count.interviews === 0 && wf.interviews.length) {
            await prisma.hRInterview.createMany({ data: wf.interviews.map(i => ({ ...i, candidateId: existsRow.id })) as Prisma.HRInterviewCreateManyInput[] });
            summary.interviewsCreated += wf.interviews.length;
          }
          if (existsRow._count.activities === 0 && wf.activities.length) {
            await prisma.hRActivity.createMany({ data: wf.activities.map(a => ({ ...a, candidateId: existsRow.id })) as Prisma.HRActivityCreateManyInput[] });
            summary.timelineEntriesCreated += wf.activities.length;
          }
          if (r.resumeUrl?.trim()) await attachResume(existsRow.id, r.resumeUrl.trim(), me.id);
          summary.updated++;
          continue;
        }
        // strategy === "create" → fall through, force a duplicate (no fingerprint).
      }

      const forcedDup = !!existsRow || (fp ? seenFp.has(fp) : false);
      if (fp && !forcedDup) seenFp.add(fp);

      const cand = await prisma.hRCandidate.create({
        data: {
          ...toData(r), name, status, originalStatus: rawStatus || null, primaryOwnerId: ownerId, fingerprint: forcedDup ? null : fp,
          importBatchId,
          nextActionDate: wf.nextActionDate, nextAction: wf.nextAction, joiningDate: wf.joiningDate,
          followUps: wf.followUps.length ? { createMany: { data: wf.followUps } } : undefined,
          interviews: wf.interviews.length ? { createMany: { data: wf.interviews } } : undefined,
          activities: wf.activities.length ? { createMany: { data: wf.activities } } : undefined,
        },
      });
      if (r.resumeUrl?.trim()) await attachResume(cand.id, r.resumeUrl.trim(), me.id);

      summary.imported++;
      summary.followUpsCreated += wf.followUps.length;
      summary.interviewsCreated += wf.interviews.length;
      summary.noShowRecoveriesCreated += wf.followUps.filter(f => f.type === "NO_SHOW_RECOVERY").length;
      summary.timelineEntriesCreated += wf.activities.length;
    } catch (e) { summary.failed++; summary.errorRows.push({ row: name, reason: String(e).slice(0, 150) }); }
  }

  return NextResponse.json(summary);
}
