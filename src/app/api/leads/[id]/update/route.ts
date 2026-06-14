import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, AIScore, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getTestingModeEnabled, getBantGateMode } from "@/lib/settings";
import { evaluateBantGate, type BantFields } from "@/lib/bantGate";
import { awardXp, type AwardResult, type XpReason } from "@/lib/gamification.server";
import { canSetStatus } from "@/lib/lead-statuses";
import { recordFieldChanges, TRACKED_FIELDS } from "@/lib/fieldHistory";
import type { Prisma } from "@prisma/client";

// Inline-edit endpoint — accepts one or more field updates and logs an Activity
// for status/stage changes. Only allows whitelisted fields.

const ALLOWED: Record<string, "string" | "date" | "number" | "enum" | "bool"> = {
  name: "string", altName: "string", phone: "string", altPhone: "string", email: "string", company: "string",
  city: "string", country: "string", address: "string",
  configuration: "string", currentStatus: "string", categorization: "string",
  tags: "string", notesShort: "string", remarks: "string",
  whoIsClient: "string", detailShared: "string", todoNext: "string",
  // ClientType: 'INVESTOR' | 'END_USER' | 'BOTH' | 'UNCLEAR' (or null to clear)
  clientType: "enum",
  budgetMin: "number", budgetMax: "number", budgetCurrency: "string",
  followupDate: "date", meetingDate: "date", siteVisitDate: "date",
  // createdAt = enquiry date (admin-only inline edit — gated below in ADMIN_ONLY_FIELDS)
  createdAt: "date",
  status: "enum", potential: "enum", fundReadiness: "enum",
  moodStatus: "enum", whenCanInvest: "enum",
  bantStatus: "enum", bantReason: "string",
  // BANT depth — Authority + Need.
  // authorityPerson is the new free-text "who decides" field ("Self", "Wife", etc.)
  // authorityLevel (enum) kept for backward compat with existing data.
  authorityLevel: "enum", authorityPerson: "string", needSummary: "string",
  isColdCall: "bool", coldCallReason: "string",
  profession: "enum", linkedInUrl: "string",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ownership check: agents can only mutate leads they own; admins/managers any.
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Name / phone / email are sensitive PII — only admin/manager may change them.
  // createdAt (enquiry date) is also admin-only — prevents agents from backdating.
  // Agents see a "request admin" affordance in the UI; enforce it server-side too.
  const ADMIN_ONLY_FIELDS = new Set(["name", "phone", "email", "createdAt"]);
  if (me.role === "AGENT") {
    const restricted = Object.keys(body).filter(k => ADMIN_ONLY_FIELDS.has(k));
    if (restricted.length > 0) {
      return NextResponse.json(
        { error: "Only an admin can change name, phone, or email. Ask your admin to update it.", adminOnly: true },
        { status: 403 }
      );
    }
  }

  // Status governance — "Fresh Lead" is system-generated and outcome /
  // classification statuses (War Fear, Funds Issue, Booked With Us, Sell Out, …)
  // are applied only via the Reject flow / admin. Block agents (and managers for
  // Fresh Lead / Booked) from setting them directly, so reporting stays clean.
  if (typeof body.currentStatus === "string" && body.currentStatus &&
      !canSetStatus(me.role, body.currentStatus, scoped.lead.forwardedTeam)) {
    return NextResponse.json(
      { error: `"${body.currentStatus}" can't be set here — use Reject lead for outcome statuses, or ask an admin.` },
      { status: 403 },
    );
  }

  const updates: Record<string, unknown> = {};
  const activityNotes: string[] = [];

  for (const [key, raw] of Object.entries(body)) {
    if (!(key in ALLOWED)) continue;
    const kind = ALLOWED[key];
    if (raw == null || raw === "") {
      updates[key] = null;
      activityNotes.push(`${key} cleared`);
      continue;
    }
    if (kind === "string") { updates[key] = String(raw); activityNotes.push(`${key} set`); }
    else if (kind === "number") { const n = Number(raw); if (!isNaN(n)) { updates[key] = n; activityNotes.push(`${key} set to ${n}`); } }
    else if (kind === "date") { const d = new Date(String(raw)); if (!isNaN(d.getTime())) { updates[key] = d; activityNotes.push(`${key} → ${d.toISOString().slice(0,10)}`); } }
    else if (kind === "bool") {
      const b = raw === true || raw === "true" || raw === "1" || raw === 1;
      updates[key] = b;
      activityNotes.push(`${key} → ${b}`);
    }
    else if (kind === "enum") {
      updates[key] = raw;
      activityNotes.push(`${key} → ${raw}`);
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // §17 — Auto-fill country when city is saved and country is not explicitly set.
  if ("city" in updates && updates.city && !("country" in updates)) {
    const { inferCountryFromCity } = await import("@/lib/cityCountry");
    const inferredCountry = inferCountryFromCity(updates.city as string);
    // Only auto-fill when the lead has no country yet (don't overwrite explicit value)
    const existing = await prisma.lead.findUnique({ where: { id }, select: { country: true } });
    if (inferredCountry && !existing?.country) {
      updates.country = inferredCountry;
      activityNotes.push(`country auto-filled: ${inferredCountry}`);
    }
  }

  updates.lastTouchedAt = new Date();
  // If followupDate moved, re-arm the 10-min-before reminder so the new time gets pushed.
  if ("followupDate" in updates) updates.followupReminderSentAt = null;
  // Capture the BEFORE-status so a status change to NEGOTIATION/BOOKING_DONE/WON
  // only awards XP on the actual transition, not on a no-op re-save. We fetch
  // the current BANT fields in the SAME query so the stage-gate can evaluate the
  // MERGED view (incoming updates overlaid on current) — this prevents a false
  // block when an agent fills BANT and advances stage in one PATCH.
  const prevRow = "status" in updates
    ? await prisma.lead.findUnique({
        where: { id },
        select: { status: true, budgetMin: true, authorityLevel: true, needSummary: true, whenCanInvest: true },
      })
    : null;
  const prevStatus = prevRow?.status ?? null;

  // BANT stage-gate — only on a REAL transition into a (possibly) gated stage.
  // Merge: use the incoming value when that field is present in this PATCH,
  // otherwise the freshly-loaded current value. SOFT warns (collected below and
  // returned with the success payload); only HARD blocks with a 422 BEFORE we
  // write anything.
  let bantGateWarning: { message: string | null; missing: string[] } | null = null;
  if ("status" in updates && prevRow && updates.status !== prevStatus) {
    const mergedBant: BantFields = {
      budgetMin: ("budgetMin" in updates ? (updates.budgetMin as number | null) : prevRow.budgetMin),
      authorityLevel: ("authorityLevel" in updates ? (updates.authorityLevel as string | null) : prevRow.authorityLevel),
      needSummary: ("needSummary" in updates ? (updates.needSummary as string | null) : prevRow.needSummary),
      whenCanInvest: ("whenCanInvest" in updates ? (updates.whenCanInvest as string | null) : prevRow.whenCanInvest),
    };
    const gate = evaluateBantGate({ targetStatus: String(updates.status), lead: mergedBant, mode: await getBantGateMode() });
    if (gate.blocked) {
      return NextResponse.json({ error: gate.message, bantBlocked: true, missing: gate.missing }, { status: 422 });
    }
    if (gate.warn) bantGateWarning = { message: gate.message, missing: gate.missing };
  }

  // ── Audit history — capture old→new for every tracked field on this edit,
  //    so status / budget / BANT / follow-up / source / remarks / location
  //    changes are all recoverable and reportable. Best-effort (never blocks).
  const trackedKeys = TRACKED_FIELDS.filter((f) => f in updates);
  const beforeRow = trackedKeys.length
    ? await prisma.lead.findUnique({ where: { id }, select: Object.fromEntries(trackedKeys.map((f) => [f, true])) as Prisma.LeadSelect })
    : null;

  await prisma.lead.update({ where: { id }, data: updates as never });

  if (beforeRow) {
    recordFieldChanges(prisma, id, me.id, beforeRow as Record<string, unknown>, updates, "inline-edit").catch(() => {});
  }

  if (activityNotes.length) {
    await prisma.activity.create({
      data: {
        leadId: id, userId: me.id,
        type: "status" in updates ? ActivityType.STATUS_CHANGE : ActivityType.NOTE,
        status: ActivityStatus.DONE,
        title: `Inline edit: ${activityNotes.length} field(s)`,
        description: activityNotes.join(", "),
        completedAt: new Date(),
      },
    });
  }

  // Fire-and-forget behavioural re-score when signals likely shifted (BANT or stage change).
  // Other inline edits don't influence the rescorer's inputs so we skip them for noise control.
  if ("bantStatus" in updates || "status" in updates) {
    rescoreLead(id).catch(() => {});
  }
  // Workflow engine — BANT/status changes are common triggers that can send
  // WhatsApp/email via workflow actions. Gate behind testing-mode so we don't
  // ping real client numbers during go-live data testing.
  const testingMode = await getTestingModeEnabled();
  if (!testingMode) {
    if ("bantStatus" in updates) {
      fireWorkflowTrigger("BANT_CHANGED", id, { newBant: updates.bantStatus }).catch(() => {});
    }
    if ("status" in updates) {
      fireWorkflowTrigger("STATUS_CHANGED", id, { newStatus: updates.status }).catch(() => {});
    }
  }

  // ── Gamification: status-change XP on real transitions only.
  // Award XP when currentStatus moves to closing or booked statuses.
  let awarded: AwardResult | null = null;
  if ("currentStatus" in updates && updates.currentStatus !== prevStatus) {
    let reason: XpReason | null = null;
    const ns = updates.currentStatus as string | null;
    if (ns && ["Meeting", "Site Visit Schedule", "Visit Dubai", "Want Office Visit", "Zoom Meeting"].includes(ns))
      reason = "NEGOTIATION_STARTED";
    else if (ns === "Booked with Us") reason = "BOOKING_DONE";
    if (reason) {
      try { awarded = await awardXp(me.id, reason); } catch { /* never block save */ }
    }
  }

  return NextResponse.json({
    ok: true,
    updated: Object.keys(updates).length - 1,
    awardedXp: awarded
      ? {
          amount: awarded.awarded,
          label: awarded.label,
          newXp: awarded.newXp,
          leveledUp: awarded.leveledUp,
          newLevel: awarded.leveledUp ? awarded.newLevel : null,
        }
      : null,
    // SOFT-mode BANT nudge: move was allowed, but flag the missing signals so
    // the inline-edit UI can warn the agent. Absent on OFF / HARD-allowed paths.
    ...(bantGateWarning ? { bantWarning: bantGateWarning.message, missing: bantGateWarning.missing } : {}),
  });
}
