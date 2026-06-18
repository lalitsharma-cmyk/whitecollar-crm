import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, ActivityType, ActivityStatus, AIScore, ClientType } from "@prisma/client";
import { pickRoundRobinAgent, fingerprintFor } from "@/lib/assignment";
import { defaultCurrencyForLocation } from "@/lib/money";
import { notify, notifyRoles } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import { currentWindow } from "@/lib/assignmentWindow";
import { sendAfterHoursWelcome } from "@/lib/whatsappOutbound";
import { sendSpeedToLeadResponses } from "@/lib/speedToLead";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getTestingModeEnabled } from "@/lib/settings";
import { notifyHotLead } from "@/lib/push";
import { findMatchingLeads, summariseHistory, projectsFromInterestedUnits } from "@/lib/investorMatch";
import { audit } from "@/lib/audit";
import { BOOKED_STATUSES } from "@/lib/lead-statuses";
import { resolveTeam, routingFieldsFor, automationGate } from "@/lib/teamRouting";
import { runIntelligenceCheck } from "@/lib/intelligenceCheck";

export interface RawLeadInput {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  country?: string;
  source: LeadSource;
  /** Verbatim free-text source ("Townscript", "Meta Lead Ad: Dubai Expo") — preserved
   *  exactly as received, per the source-fidelity rule. Falls back to the enum label. */
  sourceRaw?: string;
  /** Excel/MIS status to stamp at creation. Real-time intake passes "Fresh Lead";
   *  importers DON'T (they set status from the sheet post-ingest, or leave it null). */
  currentStatus?: string;
  sourceDetail?: string;
  /** Inquired project slug/name — fed into resolveTeam for market keyword matching. */
  projectSlug?: string;
  /** Landing / referrer URL — fed into resolveTeam for market keyword matching. */
  url?: string;
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
  // NOTE (Lalit clarification 2026-06): team is NOT a phone-country signal —
  // the Dubai team can hold India numbers and vice-versa. Only `country` (the
  // lead's actual country) drives the fallback dial. When neither is given,
  // toE164() now infers from the digit shape itself.
  const fallbackDial = input.country === "India" ? "+91"
    : input.country === "UAE" ? "+971"
    : undefined;          // team no longer used here
  if (input.phone) {
    const normalized = toE164(input.phone, fallbackDial);
    if (normalized) input.phone = normalized;
  }
  const fp = fingerprintFor(input.phone, input.email);

  // ── Duplicate path ──
  // ONLY active leads dedupe. A soft-deleted lead (admin delete / rolled-back
  // import) must NOT be treated as a duplicate — re-importing the same file
  // after a delete has to recreate the records. findFirst + deletedAt:null
  // (not findUnique) because fingerprint is now unique only among active rows
  // (partial index Lead_fingerprint_active_key).
  if (fp) {
    const existing = await prisma.lead.findFirst({
      where: { fingerprint: fp, deletedAt: null },
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
      // Hot-lead Web Push (spec §12.3) — if the dup is an already-HOT owned
      // lead, the owner deserves a push when they're not on the screen. Guarded
      // 1×/24h per lead inside notifyHotLead.
      if (existing.aiScore === AIScore.HOT && existing.ownerId) {
        notifyHotLead({
          id: existing.id,
          name: existing.name,
          ownerId: existing.ownerId,
          budgetMin: existing.budgetMin,
          budgetMax: existing.budgetMax,
          budgetCurrency: existing.budgetCurrency,
        }).catch(() => {});
      }
      return { lead: existing, deduped: true as const };
    }
  }

  // ── New lead path ── (no immediate auto-assign — Admin gets 5 min)
  const currency = defaultCurrencyForLocation(input.city, input.country);

  // ── Team routing (Lead Routing Architecture) ──────────────────────────
  // Priority: explicit input.team > market keywords > null (awaiting-team).
  // HARD RULE: NEVER use phone/country/city to infer team — see teamRouting.ts.
  const routingResult = input.team
    ? resolveTeam({ forceTeam: input.team, forceMethod: "manual" })
    : resolveTeam({
        source: input.source,
        sourceDetail: input.sourceDetail,
        projectSlug: input.projectSlug,
        url: input.url,
        text: input.notesShort,
      });
  const team = routingResult.team;  // null = awaiting-team, correct
  const routingFields = routingFieldsFor(routingResult);

  // Default follow-up = TODAY at 7:00pm IST (close of business). Lalit's ask:
  // "Any new lead received today should automatically have today's followup
  // date and should be shown in it." So /leads default "Today" view captures
  // every fresh lead the moment it arrives. The agent can later edit this
  // datetime on the lead-detail page if they need a different time.
  // CSV import path passes its own followupDate later (parsed from sheet) →
  // that overwrites this default in the post-create update.
  function todayEodIST(): Date {
    const istOffsetMs = 330 * 60 * 1000;
    const nowIST = new Date(Date.now() + istOffsetMs);
    const eodIST = new Date(nowIST);
    eodIST.setUTCHours(19, 0, 0, 0);    // 7:00pm IST
    // If we're already past 7pm IST, schedule for end of day still — agent
    // will see it in "Today" + "Overdue" both (overdue takes priority in UI).
    return new Date(eodIST.getTime() - istOffsetMs);
  }

  const lead = await prisma.lead.create({
    data: {
      name: input.name?.trim() || "Unknown",
      phone: input.phone?.trim(),
      email: input.email?.toLowerCase().trim(),
      city: input.city,
      country: input.country,
      source: input.source,
      sourceRaw: input.sourceRaw?.trim() || null,
      sourceDetail: input.sourceDetail,
      status: LeadStatus.NEW,
      // Excel/MIS status: real-time intake stamps "Fresh Lead"; importers leave it
      // unset here and set their own from the sheet (so this never touches imports).
      ...(input.currentStatus ? { currentStatus: input.currentStatus } : {}),
      configuration: input.configuration,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      budgetCurrency: currency,
      forwardedTeam: team,
      // Routing provenance — set at intake so every lead has a full audit trail
      routingMethod: routingFields.routingMethod,
      routingSource: routingFields.routingSource,
      routingReason: routingFields.routingReason,
      notesShort: input.notesShort,
      tags: input.tags,
      fingerprint: fp,
      lastTouchedAt: new Date(),
      followupDate: todayEodIST(),
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

  // ── Customer Intelligence pre-assignment check ──
  // MUST complete before any round-robin / assignment / SLA step fires.
  // Best-effort: a failure here NEVER blocks lead creation.
  try {
    await runIntelligenceCheck(lead.id);
  } catch (err) {
    console.error("[intelligenceCheck] failed for lead", lead.id, err);
  }

  // ── Heuristic clientType auto-tag (Lalit ask 2026-06-02) ──
  // Mirrors the back-fill SQL in 20260602b_add_client_type/migration.sql so
  // newly-ingested leads land in the same state as historical ones. Order
  // matters: BOTH first (most specific), then INVESTOR, then END_USER.
  // Anything that doesn't match stays NULL and the agent picks from the
  // dropdown on the lead-detail page.
  try {
    const haystack = [
      input.notesShort ?? "",
      input.tags ?? "",
      input.sourceDetail ?? "",
    ].join(" ").toLowerCase();
    let guess: ClientType | null = null;
    const mentionsInvestor = haystack.includes("investor");
    const mentionsEndUser = /end[\s-]?user|self[\s-]?use|relocate|move[\s-]?in/.test(haystack);
    if (haystack.includes("both") || (mentionsInvestor && mentionsEndUser)) {
      guess = ClientType.BOTH;
    } else if (mentionsInvestor) {
      guess = ClientType.INVESTOR;
    } else if (mentionsEndUser) {
      guess = ClientType.END_USER;
    }
    if (guess) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { clientType: guess },
      });
    }
  } catch {
    // Never block intake on a heuristic miss — leave clientType null.
  }

  // ── Returning-investor detection (Lalit ask 2026-06-02) ──
  // For any newly-created lead, scan for prior Lead rows that look like the
  // same person (phone tail / email / name+city). If any match is WON or
  // booked, flip categorization=Investor and merge bought-project history
  // onto the new lead so the agent sees it on first render. Best-effort —
  // never blocks intake.
  try {
    const matches = await findMatchingLeads({
      name: lead.name,
      phone: lead.phone,
      email: lead.email,
      city: lead.city,
      excludeLeadId: lead.id,
    });
    if (matches.length > 0) {
      const summary = summariseHistory(matches);
      const investorMatches = matches.filter(
        (m) => BOOKED_STATUSES.includes(m.currentStatus ?? "") || m.bookingDoneAt != null
      );
      // Augment with project names pulled from interestedUnits on WON matches —
      // covers the case where historical leads never had alreadyBought filled
      // but DID have a booked unit linked.
      const unitProjects = await projectsFromInterestedUnits(
        investorMatches.map((m) => m.id)
      );
      const merged = new Map<string, string>();
      for (const p of [...summary.evidence.projectsBought, ...unitProjects]) {
        const key = p.toLowerCase();
        if (!merged.has(key)) merged.set(key, p);
      }
      const joinedList = Array.from(merged.values()).join(", ");

      if (summary.isInvestor) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            categorization: "Investor",
            ...(joinedList ? { alreadyBought: joinedList } : {}),
          },
        });
        // Notify whoever currently owns the new lead. If still unassigned at
        // ingest, notify Admin/Manager so they know to route to a senior agent.
        const title = `🔁 ${lead.name} is an existing investor — see history`;
        const body = `${summary.evidence.bookings} prior bookings, ${summary.evidence.previousInquiries} inquiries on file${joinedList ? `. Owns: ${joinedList}` : "."}`;
        if (lead.ownerId) {
          await notify({
            userId: lead.ownerId,
            kind: "LEAD_DUPLICATE",
            severity: "WARNING",
            title,
            body,
            linkUrl: `/leads/${lead.id}`,
            leadId: lead.id,
          });
        } else {
          await notifyRoles(["ADMIN", "MANAGER"], {
            kind: "LEAD_DUPLICATE",
            severity: "WARNING",
            title,
            body: `${body} — assign to a senior agent.`,
            linkUrl: `/leads/${lead.id}`,
            leadId: lead.id,
          });
        }
      }
      // Always audit-log when matches existed, even sub-investor — useful for
      // tracking how good the matcher is. Meta carries the matched ids and
      // their reasons so debugging stale matches is straightforward.
      await audit({
        action: "lead.investor_detected",
        entity: "Lead",
        entityId: lead.id,
        meta: {
          isInvestor: summary.isInvestor,
          matchedLeadIds: matches.map((m) => m.id),
          matchReasons: matches.map((m) => m.matchReason),
          wonLeads: summary.evidence.wonLeads,
          bookings: summary.evidence.bookings,
          projectsBought: Array.from(merged.values()),
        },
      });
    }
  } catch {
    // Never fail intake because of investor-match — swallow and move on.
  }

  // Overnight (10pm-10am IST) — fire auto-WhatsApp welcome from company number.
  // Best-effort: stub mode just logs to AuditLog + WhatsAppMessage; real send
  // happens once admin sets WA_BUSINESS_TOKEN.
  // Testing-mode kill-switch: skip — Lalit doesn't want overnight auto-WA going
  // to real client numbers while he's importing existing-client data for testing.
  const window = currentWindow();
  const testingMode = await getTestingModeEnabled();
  // Automation gate: no automation until team is classified AND testing mode is OFF.
  const gate = automationGate(lead.forwardedTeam, testingMode);
  if (window.kind === "OVERNIGHT_QUEUE" && lead.phone && gate.ok) {
    sendAfterHoursWelcome(lead.id, lead.phone, lead.name).catch(() => {});
  } else if (window.kind === "OVERNIGHT_QUEUE" && lead.phone && !gate.ok) {
    console.log("[ingestLead] after-hours welcome suppressed:", gate.reason);
  }

  // Admin alert — they have 5 minutes to assign manually
  // Lalit's mandatory-team policy (2026-06): when the intake doesn't supply
  // a team, NOTHING auto-routes. The lead sits in /admin/awaiting-team
  // until an admin/manager tags it Dubai or India. The reconciler also
  // skips null-team leads in its 5-min orphan sweep.
  // Website leads get a dedicated "please assign" alert to Admin/Super-Admin.
  // notify() already fans out web push + the in-app bell sound; WARNING also emails.
  const isWebLead = input.source === LeadSource.WEBSITE;
  const webLeadBody = `New website lead received. Please assign.${lead.name && lead.name !== "Unknown" ? ` — ${lead.name}` : ""}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ""}`;

  if (lead.forwardedTeam === null) {
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "LEAD_ASSIGNED",
      severity: "WARNING",
      title: isWebLead ? `🌐 New website lead received` : `⚠️ New lead needs team assignment: ${lead.name}`,
      body: isWebLead ? webLeadBody : `This ${input.source} lead arrived without a team tag. Open the lead and pick Dubai or India to start the round-robin.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
  } else {
    const adminBody = window.kind === "OFFICE_RR"
      ? `Assign within 5 minutes or it will be auto-routed to ${team} round-robin (present agents only).`
      : window.kind === "EVENING_LALIT"
        ? `After-hours lead — will auto-assign to Lalit if you don't pick it up.`
        : `Overnight lead — queued for your 10am morning window. Auto-WA welcome has been triggered.`;
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "LEAD_ASSIGNED",
      severity: window.kind === "OVERNIGHT_QUEUE" ? "WARNING" : "INFO",
      title: isWebLead ? `🌐 New website lead received` : `New ${input.source} lead: ${lead.name}`,
      body: isWebLead ? webLeadBody : adminBody,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
    });
  }

  // ── Speed-to-lead auto-response: fire-and-forget WA + email under 60s ──
  // Runs after the after-hours welcome trigger so the WA-dedupe check inside
  // sees the just-created WhatsAppMessage row and skips the duplicate send.
  // Automation gate: also requires team to be classified before firing.
  if (gate.ok) {
    sendSpeedToLeadResponses(lead.id).catch(() => {});
  } else {
    console.log("[ingestLead] speed-to-lead suppressed:", gate.reason);
  }

  // ── Workflow engine: fire any LEAD_CREATED rules ──
  // Automation gate: also requires team to be classified before firing.
  // Workflow actions can send WhatsApp/email to real client numbers — don't fire
  // until team is set and testing mode is off.
  if (gate.ok) {
    fireWorkflowTrigger("LEAD_CREATED", lead.id, { source: input.source }).catch(() => {});
  } else {
    console.log("[ingestLead] workflow trigger suppressed:", gate.reason);
  }

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
  // Hot-lead Web Push (spec §12.3) — if a HOT lead just got an owner, the
  // agent should be alerted even when they're not on the screen. Guarded
  // 1×/24h per lead inside notifyHotLead.
  if (lead.aiScore === AIScore.HOT) {
    notifyHotLead({
      id: lead.id,
      name: lead.name,
      ownerId: userId,
      budgetMin: lead.budgetMin,
      budgetMax: lead.budgetMax,
      budgetCurrency: lead.budgetCurrency,
    }).catch(() => {});
  }
}
