import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { pickRoundRobinAgent, fingerprintFor } from "@/lib/assignment";
import { defaultCurrencyForLocation } from "@/lib/money";
import { notify, notifyRoles } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import { currentWindow } from "@/lib/assignmentWindow";
import { sendAfterHoursWelcome } from "@/lib/whatsappOutbound";
import { sendSpeedToLeadResponses } from "@/lib/speedToLead";

export interface RawLeadInput {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  source: LeadSource;
  sourceDetail?: string;
  configuration?: string;
  budgetMin?: number;
  budgetMax?: number;
  notesShort?: string;
  tags?: string;
  team?: string;
}

const FIRST_CALL_SLA_MIN = 15;

/**
 * Idempotent lead creation:
 *   • Dedupes by phone+email fingerprint.
 *   • If duplicate: bumps duplicateCount, notifies Admin + the existing owner.
 *   • If new: leaves ownerId NULL so Admin gets a chance to manually assign
 *     within 5 minutes (after which the reconciler auto-assigns).
 *
 * NOTE: behavior change — new leads are NOT auto-assigned on intake anymore,
 * so Admin can route them. The reconciler handles unattended leads.
 */
export async function ingestLead(input: RawLeadInput) {
  // Normalize phone to E.164 up-front so dedupe fingerprint is consistent and
  // every wa.me / tel: link downstream gets a valid number.
  const fallbackDial = input.country === "India" ? "+91"
    : input.country === "UAE" ? "+971"
    : input.team === "India" ? "+91"
    : input.team === "Dubai" ? "+971"
    : undefined;
  if (input.phone) {
    const normalized = toE164(input.phone, fallbackDial);
    if (normalized) input.phone = normalized;
  }
  const fp = fingerprintFor(input.phone, input.email);

  // ── Duplicate path ──
  if (fp) {
    const existing = await prisma.lead.findUnique({
      where: { fingerprint: fp },
      include: { owner: true },
    });
    if (existing) {
      const now = new Date();
      await prisma.lead.update({
        where: { id: existing.id },
        data: {
          duplicateCount: { increment: 1 },
          lastDuplicateAt: now,
          lastTouchedAt: now,
        },
      });
      await prisma.activity.create({
        data: {
          leadId: existing.id,
          userId: existing.ownerId,
          type: ActivityType.NOTE,
          status: ActivityStatus.DONE,
          title: `Duplicate intake from ${input.source}`,
          description: input.notesShort,
          completedAt: now,
        },
      });

      // Notify Admin/Manager AND the current owner (if any)
      await notifyRoles(["ADMIN", "MANAGER"], {
        kind: "LEAD_DUPLICATE",
        severity: "WARNING",
        title: `🔁 ${existing.name} contacted us again (${(existing.duplicateCount ?? 0) + 1}x)`,
        body: `New ${input.source} hit on existing lead. Current owner: ${existing.owner?.name ?? "Unassigned"}. ${input.notesShort ?? ""}`.trim(),
        linkUrl: `/leads/${existing.id}`,
        leadId: existing.id,
      });
      if (existing.ownerId) {
        await notify({
          userId: existing.ownerId,
          kind: "LEAD_DUPLICATE",
          severity: "WARNING",
          title: `Your lead ${existing.name} reached out again`,
          body: `Source: ${input.source}. ${input.notesShort ?? ""}`.trim(),
          linkUrl: `/leads/${existing.id}`,
          leadId: existing.id,
        });
      }
      return { lead: existing, deduped: true as const };
    }
  }

  // ── New lead path ── (no immediate auto-assign — Admin gets 5 min)
  const currency = defaultCurrencyForLocation(input.city, input.country);
  const team = input.team ?? (currency === "INR" ? "India" : "Dubai");

  const lead = await prisma.lead.create({
    data: {
      name: input.name?.trim() || "Unknown",
      phone: input.phone?.trim(),
      email: input.email?.toLowerCase().trim(),
      city: input.city,
      country: input.country,
      source: input.source,
      sourceDetail: input.sourceDetail,
      status: LeadStatus.NEW,
      configuration: input.configuration,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      budgetCurrency: currency,
      forwardedTeam: team,
      notesShort: input.notesShort,
      tags: input.tags,
      fingerprint: fp,
      lastTouchedAt: new Date(),
    },
  });
  await prisma.activity.create({
    data: {
      leadId: lead.id,
      type: ActivityType.LEAD_CREATED,
      status: ActivityStatus.DONE,
      title: `Lead created from ${input.source}`,
      description: input.notesShort,
      completedAt: new Date(),
    },
  });
  // Overnight (10pm-10am IST) — fire auto-WhatsApp welcome from company number.
  // Best-effort: stub mode just logs to AuditLog + WhatsAppMessage; real send
  // happens once admin sets WA_BUSINESS_TOKEN.
  const window = currentWindow();
  if (window.kind === "OVERNIGHT_QUEUE" && lead.phone) {
    sendAfterHoursWelcome(lead.id, lead.phone, lead.name).catch(() => {});
  }

  // Admin alert — they have 5 minutes to assign manually
  const adminBody = window.kind === "OFFICE_RR"
    ? `Assign within 5 minutes or it will be auto-routed to ${team} round-robin (present agents only).`
    : window.kind === "EVENING_LALIT"
      ? `After-hours lead — will auto-assign to Lalit if you don't pick it up.`
      : `Overnight lead — queued for your 10am morning window. Auto-WA welcome has been triggered.`;
  await notifyRoles(["ADMIN", "MANAGER"], {
    kind: "LEAD_ASSIGNED",
    severity: window.kind === "OVERNIGHT_QUEUE" ? "WARNING" : "INFO",
    title: `New ${input.source} lead: ${lead.name}`,
    body: adminBody,
    linkUrl: `/leads/${lead.id}`,
    leadId: lead.id,
  });

  // ── Speed-to-lead auto-response: fire-and-forget WA + email under 60s ──
  // Runs after the after-hours welcome trigger so the WA-dedupe check inside
  // sees the just-created WhatsAppMessage row and skips the duplicate send.
  sendSpeedToLeadResponses(lead.id).catch(() => {});

  return { lead, deduped: false as const };
}

/**
 * Reassign a lead to a specific user (manual or system-triggered).
 * Sets SLA clock and notifies the new owner.
 */
export async function assignLeadTo(leadId: string, userId: string, reason: string) {
  const now = new Date();
  const slaFirstCallBy = new Date(now.getTime() + FIRST_CALL_SLA_MIN * 60 * 1000);

  const [lead, agent] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!lead || !agent) throw new Error("Lead or user not found");

  await prisma.lead.update({
    where: { id: leadId },
    data: { ownerId: userId, assignedAt: now, slaFirstCallBy, slaEscalated: false },
  });
  await prisma.assignment.create({ data: { leadId, userId, reason } });
  await notify({
    userId,
    kind: "LEAD_ASSIGNED",
    severity: "INFO",
    title: `📩 New lead: ${lead.name}`,
    body: `Source: ${lead.source}. Call within ${FIRST_CALL_SLA_MIN} minutes — ${reason}.`,
    linkUrl: `/leads/${leadId}`,
    leadId,
  });
}
