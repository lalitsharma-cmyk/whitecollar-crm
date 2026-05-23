import "server-only";
import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { pickRoundRobinAgent, fingerprintFor } from "@/lib/assignment";
import { defaultCurrencyForLocation } from "@/lib/money";

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
  team?: string; // for distribution
}

/**
 * Idempotent lead creation: dedupes by phone+email fingerprint.
 * Returns { lead, deduped: boolean }.
 * Auto-assigns to a round-robin agent if no owner provided.
 */
export async function ingestLead(input: RawLeadInput) {
  const fp = fingerprintFor(input.phone, input.email);

  // Dedupe
  if (fp) {
    const existing = await prisma.lead.findUnique({ where: { fingerprint: fp } });
    if (existing) {
      await prisma.activity.create({
        data: {
          leadId: existing.id,
          type: ActivityType.NOTE,
          status: ActivityStatus.DONE,
          title: `Duplicate intake from ${input.source}`,
          description: input.notesShort,
          completedAt: new Date(),
        },
      });
      return { lead: existing, deduped: true as const };
    }
  }

  // Currency from city/country (Dubai → AED, India → INR)
  const currency = defaultCurrencyForLocation(input.city, input.country);
  const team = input.team ?? (currency === "INR" ? "India" : "Dubai");

  // Assign via round-robin (prefer matching team)
  const agent = (await pickRoundRobinAgent({ team, source: input.source })) ?? (await pickRoundRobinAgent({ source: input.source }));

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
      ownerId: agent?.id,
      fingerprint: fp,
      lastTouchedAt: new Date(),
    },
  });

  if (agent) {
    await prisma.assignment.create({ data: { leadId: lead.id, userId: agent.id, reason: "round-robin" } });
  }
  await prisma.activity.create({
    data: {
      leadId: lead.id,
      userId: agent?.id,
      type: ActivityType.LEAD_CREATED,
      status: ActivityStatus.DONE,
      title: `Lead created from ${input.source}`,
      description: input.notesShort,
      completedAt: new Date(),
    },
  });

  return { lead, deduped: false as const };
}
