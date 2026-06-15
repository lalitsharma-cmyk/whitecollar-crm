import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hrDuplicateWhere } from "@/lib/hrDuplicates";
import { fingerprintFor } from "@/lib/assignment";
import { getSetting } from "@/lib/settings";
import { HRActivityType, type Prisma } from "@prisma/client";

// =====================================================================
// REAL-TIME WEBSITE → HR CRM INTAKE
//
// POST /api/intake/hr — every HR form on whitecollarrealty.com (Career Page,
// Job Application, Walk-in, Internship, HR Landing) posts here on submit. No
// cron, no manual sync. Auth = X-WCR-Key (an IntakeKey row with hrScope=true).
//
// Behaviour:
//   • Dedup by mobile (last-10) + email. A re-applicant does NOT create a second
//     candidate — a new HRApplication row is appended (full application history).
//   • Resume (if a URL is supplied) is attached to the candidate profile.
//   • Default owner comes from the `hr.websiteDefaultOwnerId` setting.
//   • EVERY submission writes one HRIntakeLog row (CREATED | APPENDED | FAILED).
// =====================================================================

const SOURCES = [
  "Website Career Page",
  "Website Job Application",
  "Walk-in Form",
  "Internship Form",
  "HR Landing Page",
] as const;

const Body = z.object({
  name: z.string().min(1),
  phone: z.string().min(5),
  positionApplied: z.string().min(1),
  source: z.enum(SOURCES),
  email: z.string().email().optional(),
  whatsappPhone: z.string().optional(),
  altPhone: z.string().optional(),
  locationPreference: z.string().optional(),
  experience: z.string().optional(),
  city: z.string().optional(),
  currentCompany: z.string().optional(),
  currentProfile: z.string().optional(),
  remarks: z.string().optional(),
  resumeUrl: z.string().url().optional(),
  resumeFilename: z.string().optional(),
  submittedAt: z.string().optional(), // ISO timestamp from the form; falls back to now
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-WCR-Key",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;

  // Best-effort logger — never throws, never blocks the response.
  const log = (
    outcome: "CREATED" | "APPENDED" | "FAILED",
    httpStatus: number,
    extra: { source?: string | null; candidateId?: string | null; applicationId?: string | null; error?: string | null; payload?: unknown } = {},
  ) =>
    prisma.hRIntakeLog
      .create({
        data: {
          outcome,
          httpStatus,
          ip,
          source: extra.source ?? null,
          candidateId: extra.candidateId ?? null,
          applicationId: extra.applicationId ?? null,
          error: extra.error ?? null,
          payload: (extra.payload ?? null) as Prisma.InputJsonValue,
        },
      })
      .catch(() => {});

  const fail = async (status: number, error: string, payload?: unknown, source?: string | null) => {
    await log("FAILED", status, { error, payload, source });
    return NextResponse.json({ ok: false, error }, { status, headers: CORS });
  };

  // ── Auth ──────────────────────────────────────────────────────────
  const apiKey = req.headers.get("x-wcr-key") ?? new URL(req.url).searchParams.get("key");
  if (!apiKey) return fail(401, "Missing X-WCR-Key");
  const key = await prisma.intakeKey.findUnique({ where: { key: apiKey } });
  if (!key || !key.active || !key.hrScope) return fail(401, "Invalid or non-HR key");

  // ── Parse + validate ──────────────────────────────────────────────
  let raw: unknown;
  try { raw = await req.json(); }
  catch { return fail(400, "Invalid JSON"); }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return fail(422, "Validation failed: " + JSON.stringify(parsed.error.flatten().fieldErrors), raw);
  }
  const d = parsed.data;
  const submittedAt = d.submittedAt && !isNaN(Date.parse(d.submittedAt)) ? new Date(d.submittedAt) : new Date();

  try {
    // ── Default owner (validated active HR user, else unassigned) ─────
    const ownerSetting = (await getSetting("hr.websiteDefaultOwnerId")) || "";
    let ownerId: string | null = null;
    if (ownerSetting) {
      const owner = await prisma.user.findFirst({ where: { id: ownerSetting, active: true }, select: { id: true } });
      ownerId = owner?.id ?? null;
    }

    // ── Dedup by mobile / whatsapp / email ────────────────────────────
    const dupWhere = hrDuplicateWhere(d.phone, d.whatsappPhone, d.email);
    const existing = dupWhere
      ? await prisma.hRCandidate.findFirst({ where: dupWhere, select: { id: true, status: true } })
      : null;

    // ── Resume helper — attach to the profile, make it the active one ──
    const attachResume = async (candidateId: string): Promise<string | null> => {
      if (!d.resumeUrl) return null;
      await prisma.hRResume.updateMany({ where: { candidateId, isActive: true }, data: { isActive: false } });
      const r = await prisma.hRResume.create({
        data: {
          candidateId,
          url: d.resumeUrl,
          filename: d.resumeFilename || `${d.name.replace(/\s+/g, "_")}_resume`,
          isActive: true,
        },
        select: { id: true },
      });
      return r.id;
    };

    if (existing) {
      // ── Re-applicant → append a new application, never duplicate ─────
      const resumeId = await attachResume(existing.id);
      const application = await prisma.hRApplication.create({
        data: {
          candidateId: existing.id,
          positionApplied: d.positionApplied,
          source: d.source,
          locationPreference: d.locationPreference || null,
          experience: d.experience || null,
          resumeId,
          statusAtApply: existing.status,
          submittedAt,
          rawPayload: d as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await prisma.hRActivity.create({
        data: { candidateId: existing.id, type: HRActivityType.NOTE_ADDED, notes: `Re-applied via ${d.source} for "${d.positionApplied}"` },
      }).catch(() => {});
      await prisma.intakeKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } }).catch(() => {});
      await log("APPENDED", 200, { source: d.source, candidateId: existing.id, applicationId: application.id, payload: d });
      return NextResponse.json({ ok: true, deduped: true, candidateId: existing.id, applicationId: application.id }, { headers: CORS });
    }

    // ── New candidate ─────────────────────────────────────────────────
    const candidate = await prisma.hRCandidate.create({
      data: {
        name: d.name.trim(),
        phone: d.phone || null,
        whatsappPhone: d.whatsappPhone || null,
        altPhone: d.altPhone || null,
        email: d.email || null,
        location: d.locationPreference || null,
        city: d.city || null,
        currentCompany: d.currentCompany || null,
        currentProfile: d.currentProfile || null,
        positionApplied: d.positionApplied,
        experience: d.experience || null,
        source: d.source,
        status: "NEW",
        remarks: d.remarks || null,
        primaryOwnerId: ownerId,
        fingerprint: fingerprintFor(d.phone, d.email),
      },
      select: { id: true, status: true },
    });
    const resumeId = await attachResume(candidate.id);
    const application = await prisma.hRApplication.create({
      data: {
        candidateId: candidate.id,
        positionApplied: d.positionApplied,
        source: d.source,
        locationPreference: d.locationPreference || null,
        experience: d.experience || null,
        resumeId,
        statusAtApply: candidate.status,
        submittedAt,
        rawPayload: d as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    await prisma.hRActivity.create({
      data: { candidateId: candidate.id, type: HRActivityType.NOTE_ADDED, notes: `Created from ${d.source} — applied for "${d.positionApplied}"`, newStatus: "NEW" },
    }).catch(() => {});
    await prisma.intakeKey.update({ where: { id: key.id }, data: { lastUsed: new Date() } }).catch(() => {});
    await log("CREATED", 201, { source: d.source, candidateId: candidate.id, applicationId: application.id, payload: d });
    return NextResponse.json({ ok: true, deduped: false, candidateId: candidate.id, applicationId: application.id }, { status: 201, headers: CORS });
  } catch (e) {
    return fail(500, `Server error: ${e instanceof Error ? e.message : String(e)}`, d, d.source);
  }
}
