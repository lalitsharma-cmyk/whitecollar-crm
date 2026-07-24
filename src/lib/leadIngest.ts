import { prisma } from "@/lib/prisma";
import { LeadSource, LeadStatus, ActivityType, ActivityStatus, AIScore, ClientType } from "@prisma/client";
import { pickRoundRobinAgent, fingerprintFor, leadDedupOR, resolveAutoAssignOwner } from "@/lib/assignment";
import { phoneCanonicalDigits } from "@/lib/phoneCountry";
import { defaultCurrencyForLocation } from "@/lib/money";
import { notify, notifyRoles } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import { currentWindow } from "@/lib/assignmentWindow";
import { sendAfterHoursWelcome } from "@/lib/whatsappOutbound";
import { sendSpeedToLeadResponses } from "@/lib/speedToLead";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getWhatsappAutomationEnabled, getWebsiteAutoAssign } from "@/lib/settings";
import { notifyHotLead } from "@/lib/push";
import { findMatchingLeads, summariseHistory, projectsFromInterestedUnits } from "@/lib/investorMatch";
import { audit } from "@/lib/audit";
import { websiteMessageRemark } from "@/lib/websiteRemark";
import { sourceEnumLabel } from "@/lib/sourceLabel";
import { BOOKED_STATUSES, isTerminalStatus } from "@/lib/lead-statuses";
import { terminalStatusSideEffects, isLostStatus } from "@/lib/lostRejected";
import { resolveTeam, routingFieldsFor, automationGate } from "@/lib/teamRouting";
import { resetAttemptCycleData } from "@/lib/callAttempts";
import { leadRoutingBudget, currencyForTeam } from "@/lib/budgetRouting";
import { resolveMarket } from "@/lib/market";
import type { Classification } from "@/lib/leadClassifier";
import { cleanNeedSnapshot } from "@/lib/needSnapshot";
import { runIntelligenceCheck } from "@/lib/intelligenceCheck";
import { inferPropertyType } from "@/lib/propertyType";
import { inferCountryFromCity, inferStateFromCity } from "@/lib/cityCountry";
import { normalizeNameList } from "@/lib/nameFormat";

export interface RawLeadInput {
  name: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
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
  /** Auto-classification result — passed by WEBSITE intake only. When present it
   *  drives forwardedTeam + routing audit + Source(Blog)/Project/Lead-Type/Event-
   *  City. Importers & manual entry NEVER pass it, so their routing is unchanged. */
  classification?: Classification;
  /** Property Type ("Residential" | "Commercial") — website property page may send
   *  it explicitly. When absent it's derived from the project category / configuration. */
  propertyType?: string;
  /** When the lead was actually generated (from import Date column). If provided,
   *  used as the lead's createdAt instead of the current timestamp. */
  createdAt?: Date;
  /** Import-fidelity (Lalit created-date rule): was the TIME portion of createdAt
   *  actually known? Importers pass `true` only when a Time column was mapped +
   *  parsed, else `false` (the sheet had no time → "Created Time" displays BLANK).
   *  Omitted by live intake (website/manual/Meta) → stored NULL → display unchanged
   *  (the createdAt IS the real moment). Written verbatim to Lead.createdTimeKnown. */
  createdTimeKnown?: boolean;
  /** Manual New-Lead form ONLY: the id of the admin/manager creating the lead.
   *  When present, the LEAD_CREATED Activity is attributed to them so the initial
   *  remark renders in Smart Timeline with date + time + USER (not an anonymous
   *  system row). Importers & website intake DON'T pass it → unchanged. */
  createdByUserId?: string;
  /** Import wizard "Create new anyway" duplicate mode ONLY: when true, the
   *  phone+email duplicate check is skipped and a NEW lead is always created,
   *  even if an active lead with the same fingerprint exists. Defaults false →
   *  every other caller (website / manual / merge-mode import) dedupes exactly
   *  as before. */
  skipDedup?: boolean;
  /** Real-time SINGLE-lead intake (website / Meta / email / manual-without-owner
   *  / quick-add) sets this true to OPT IN to team auto-assignment (Dubai→Lalit,
   *  Tuesday-IST India→Yasir, else Tanuj). Bulk importers + buyer-convert leave it
   *  false/undefined so they are NEVER auto-routed (parked for triage). WEBSITE-
   *  source leads auto-assign regardless (back-compat). New-leads-only. */
  autoAssign?: boolean;
}

const FIRST_CALL_SLA_MIN = 15;

/**
 * TERMINAL-STATUS INTAKE RULE (Lalit 2026-07-10) — "workable leads belong to agents,
 * terminal leads belong to the system." The ONE helper every intake path funnels
 * ownership + follow-up through when a lead ARRIVES already carrying a terminal status,
 * so a lost/rejected or won/closed lead never lands in an agent's active queue:
 *
 *   • LOST / Rejected → unassign (ownerId + assignedAt → null) and stash the owner in
 *     previousOwnerId (current owner wins, stored value is the idempotent fallback so a
 *     re-save never wipes the name to null), and clear the follow-up (+ reminder).
 *   • Won / CLOSED    → KEEP the owner (that ownership IS the booking attribution);
 *     only clear the follow-up. NEVER unassigned.
 *   • non-terminal    → {} — the caller's ownership/follow-up is left exactly as-is.
 *
 * `cur` is the ownership the write WOULD otherwise land the lead with (the resolved /
 * auto-assigned / sheet-specified / pre-assigned owner, read BEFORE the write). Spread
 * the result LAST into the create/update `data` so it overrides any owner/follow-up set
 * above it. The field logic is NOT re-derived here — it delegates to the single source
 * of truth, terminalStatusSideEffects() in lostRejected.ts, so intake, the inline
 * status write and the bulk paths can never drift apart. (Auto-assignment is skipped
 * separately at the choke point in ingestLead() below, keyed off isTerminalStatus.)
 */
export function terminalIntakeFields(
  status: string | null | undefined,
  cur: { ownerId: string | null; previousOwnerId: string | null },
): ReturnType<typeof terminalStatusSideEffects> {
  return terminalStatusSideEffects(status, cur);
}

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
  // Proper-Case the client name(s) at the source so every downstream write
  // (lead.create, notification bodies, investor-match) stores/show a clean name.
  // normalizeName only touches all-upper / all-lower values — intentional
  // mixed-case ("McDonald") is preserved, and non-name values are passed through.
  // Lead.name can hold multiple comma/slash/&-joined names → normalize each part.
  if (input.name) input.name = normalizeNameList(input.name);
  const fp = fingerprintFor(input.phone, input.email);

  // §17 — Auto-fill country from city (curated map, sync) when the intake didn't
  // supply one. Applies to website + import + manual so every new lead lands with
  // a country where the city is known (the long tail is filled by the backfill /
  // a later manual edit, which also runs the cached Nominatim fallback).
  if (input.city && !input.country) {
    const inferred = inferCountryFromCity(input.city);
    if (inferred) input.country = inferred;
  }
  if (input.city && !input.state) {
    const st = inferStateFromCity(input.city);
    if (st) input.state = st;
  }

  // ── Duplicate path (D2 fix, Lalit 2026-07-15) ──
  // Match on canonical-phone-tail OR email as INDEPENDENT signals (leadDedupOR) —
  // NOT the old single "phone|email" fingerprint string, which never matched a
  // phone-only re-import of a lead first stored with phone+email. ONLY active leads
  // dedupe (deletedAt:null): a soft-deleted lead (admin delete / rolled-back import)
  // must NOT swallow a re-import — re-importing the same file after a delete has to
  // recreate the records. (`fp` is still computed above; it's written to the
  // fingerprint column on create + guarded by the partial-unique active index.)
  const dedupOR = input.skipDedup ? [] : leadDedupOR(input.phone, input.email);
  if (dedupOR.length > 0) {
    const existing = await prisma.lead.findFirst({
      where: { deletedAt: null, OR: dedupOR },
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
          // Actor = null → renders as "System". A duplicate-intake event is
          // detected by the ingest pipeline, NOT performed by the lead owner.
          // Stamping the owner here fabricated false authorship (Lalit, 2026-07-01).
          userId: null,
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
        body: `New ${input.source} hit on existing lead. Current owner: ${existing.owner?.name ?? "Unassigned"}. ${cleanNeedSnapshot(input.notesShort) ?? ""}`.trim(),
        linkUrl: `/leads/${existing.id}`,
        leadId: existing.id,
        source: { type: "LEAD_INTAKE", id: existing.id, createdById: null },
      });
      if (existing.ownerId) {
        await notify({
          userId: existing.ownerId,
          kind: "LEAD_DUPLICATE",
          severity: "WARNING",
          title: `Your lead ${existing.name} reached out again`,
          body: `Source: ${input.source}. ${cleanNeedSnapshot(input.notesShort) ?? ""}`.trim(),
          linkUrl: `/leads/${existing.id}`,
          leadId: existing.id,
          source: { type: "LEAD_INTAKE", id: existing.id, createdById: null },
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
  const cls = input.classification;
  const routingResult = input.team
    ? resolveTeam({ forceTeam: input.team, forceMethod: "manual" })
    : resolveTeam({
        source: input.source,
        sourceDetail: input.sourceDetail,
        projectSlug: input.projectSlug,
        url: input.url,
        text: input.notesShort,
      });
  // The website auto-classifier (project-DB-aware, never-guess) overrides keyword
  // routing when present and no team was forced. Otherwise keep existing behavior.
  const useCls = !!cls && !input.team;
  const team = useCls ? cls!.team : routingResult.team;  // null = awaiting-team
  const routingFields = useCls
    ? { routingMethod: "rule", routingSource: cls!.auditSource, routingReason: cls!.reason }
    : routingFieldsFor(routingResult);

  // Default follow-up = lead's createdAt + 10 minutes (Lalit, 2026-06-25).
  // A fresh lead should be contacted almost immediately, so the default next
  // action is "in 10 minutes" rather than the old "today 7:00pm" close-of-
  // business stamp (which let same-day leads sit untouched for hours and made
  // every fresh lead share one identical 7pm slot). We key off the lead's ACTUAL
  // createdAt — which is `input.createdAt` for imports (the sheet's generation
  // date) or "now" for website/manual intake — so the +10-min offset is always
  // IST-consistent (createdAt is an absolute instant; +10 min is timezone-free).
  // The agent can edit this datetime later on the lead-detail page.
  // IMPORTANT: importers PRESERVE an explicit sheet follow-up — they overwrite
  // this default in their post-create update ONLY when the row carried a real
  // follow-up date; an empty follow-up column keeps this createdAt+10min value.
  const effectiveCreatedAt = input.createdAt ?? new Date();
  const followupDefault = new Date(effectiveCreatedAt.getTime() + 10 * 60 * 1000);

  // ── Property Type (Residential/Commercial) ──
  // Explicit value (website property page) wins; else derive from the matched
  // project's Master category, else the configuration keywords. SAME helper the
  // historical backfill uses → old and new leads classify identically.
  const projName = (useCls && cls?.project) ? cls.project : (input.sourceDetail ?? input.projectSlug ?? null);
  let projectCategory: string | null = null;
  if (projName) {
    const proj = await prisma.project.findFirst({
      where: { name: { equals: projName, mode: "insensitive" } },
      select: { category: true },
    });
    projectCategory = proj?.category ?? null;
  }
  const propertyType = input.propertyType
    ?? inferPropertyType({ projectCategory, configuration: input.configuration, projectName: projName, notes: input.notesShort });

  // TERMINAL-ON-ARRIVAL (Lalit 2026-07-10): a lead created already carrying a terminal
  // status must not enter an agent's active queue. On the create path the lead has no
  // owner yet (an owner can only come from the auto-assign block below, which is ALSO
  // skipped for terminal — see the choke point), so the only meaningful create-time
  // effect is to NOT set the default follow-up. The owner-unassign for a pre-assigned
  // import owner happens on the importer update paths via terminalIntakeFields. Real-
  // time routes pass a non-terminal "Fresh Lead", so this is inert for them.
  const arrivedTerminalOnCreate = isTerminalStatus(input.currentStatus);

  const lead = await prisma.lead.create({
    data: {
      name: input.name?.trim() || "Unknown",
      phone: input.phone?.trim(),
      email: input.email?.toLowerCase().trim(),
      city: input.city,
      state: input.state,
      country: input.country,
      source: input.source,
      // Classifier may relabel Source → "Blog" and fill Project (matched master).
      // sourceRaw is the canonical Source the CRM shows/filters/reports on — it must
      // NEVER be null (a null silently drops the lead from the Source filter and
      // re-trips the data-integrity-jun25 gate). Keep any explicitly-provided raw
      // import/intake string; otherwise fall back to the human label of the source
      // enum — the SAME mapping the #166 sourceRaw backfill used (sourceEnumLabel).
      // This covers website-form / meta / manual / import-without-a-source-column.
      sourceRaw: cls?.isBlog ? "Blog" : (input.sourceRaw?.trim() || sourceEnumLabel(input.source)),
      sourceDetail: (useCls && cls?.project) ? cls.project : input.sourceDetail,
      status: LeadStatus.NEW,
      // Excel/MIS status: real-time intake stamps "Fresh Lead"; importers leave it
      // unset here and set their own from the sheet (so this never touches imports).
      ...(input.currentStatus ? { currentStatus: input.currentStatus } : {}),
      configuration: input.configuration,
      propertyType,
      budgetMin: input.budgetMin,
      budgetMax: input.budgetMax,
      budgetCurrency: currency,
      forwardedTeam: team,
      // Set the derived India/UAE market at CREATION so there is never a gap
      // (the lead-market-segregation invariant requires market whenever team is
      // set). The data-quality self-heal is only a periodic backstop for other
      // create paths (imports / buyer-convert); this closes the main one.
      market: resolveMarket({ forwardedTeam: team, budgetCurrency: currency }),
      // Routing provenance — set at intake so every lead has a full audit trail
      routingMethod: routingFields.routingMethod,
      routingSource: routingFields.routingSource,
      routingReason: routingFields.routingReason,
      notesShort: input.notesShort,
      // Lead Type (Event/Property) appended to tags; full routing audit + extras
      // kept in customFields so the lead-detail Routing card can explain itself.
      tags: [input.tags, useCls ? cls?.leadType : null].filter(Boolean).join(", ") || null,
      ...(useCls && cls
        ? { customFields: {
            ...(cls.eventCity ? { "Event City": cls.eventCity } : {}),
            ...(cls.leadType ? { "Lead Type": cls.leadType } : {}),
            ...(cls.project ? { "Matched Project": cls.project } : {}),
            "Matched Rule": cls.rule,
            "Routing Confidence": cls.confidence,
          } }
        : {}),
      // "Create new anyway" (skipDedup): store a NULL fingerprint so this
      // intentional duplicate does not collide with the partial-unique index
      // Lead_fingerprint_active_key (active rows) and does not silently swallow
      // future imports of the same contact. phone/email are still stored.
      fingerprint: input.skipDedup ? null : fp,
      // Canonical phone (digits-only CC+national) — computed from the E.164 phone
      // normalized above, so dedup + storage share the ONE canonical rule. Stored
      // on EVERY intake (website/manual/Meta/CSV/Sheet) whenever a phone is present.
      ...(input.phone ? { phoneCanonical: phoneCanonicalDigits(input.phone) || null } : {}),
      lastTouchedAt: new Date(),
      // Terminal-on-arrival gets NO default follow-up (a done lead must never sit on
      // the Action-List follow-up board); a workable lead keeps the +10-min default.
      followupDate: arrivedTerminalOnCreate ? null : followupDefault,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      // Import-fidelity: honor an explicit createdTimeKnown from importers (true =
      // Time column parsed; false = no Time column → display blank). Omitted by live
      // intake → left NULL (display unchanged). Only written when explicitly provided.
      ...(input.createdTimeKnown != null ? { createdTimeKnown: input.createdTimeKnown } : {}),
    },
  });
  await prisma.activity.create({
    data: {
      leadId: lead.id,
      // ITEM 2 (manual New-Lead form): the form passes createdByUserId so this
      // creation event is ATTRIBUTED to the creator → it renders in Smart Timeline
      // with date + time + USER ("✨ Lead Created · <name> · <IST time>"). The
      // remark text itself already appears once as a dated Conversation-History
      // entry (the websiteMessageRemark → rawRemarks block just below, which fires
      // for any genuine message), so we DROP the remark from this event's
      // description on the manual path to avoid showing the same text twice.
      // Website/import set no creator → unchanged (anonymous event, remark kept).
      userId: input.createdByUserId ?? null,
      type: ActivityType.LEAD_CREATED,
      status: ActivityStatus.DONE,
      title: `Lead created from ${input.source}`,
      description: input.createdByUserId ? null : input.notesShort,
      completedAt: new Date(),
    },
  });

  // ── Website/form message → Raw History ONLY (Lalit, 2026-06-20) ──
  // A genuine client message from the form is stored in rawRemarks only (immutable
  // imported archive). It does NOT populate remarks (which is reserved for CRM ops).
  // Stamped at the LEAD-GENERATED time (IST). The source/campaign NAME is never
  // inserted (helper returns null for it), and an empty message creates no entry —
  // so no duplicate, no blank timeline row.
  {
    const tag = (input.source as string) === "WEBSITE" ? "Website / Client Message" : "Client Message";
    const remark = websiteMessageRemark(input.notesShort, lead.createdAt, { tag, sourceRaw: input.sourceRaw, sourceDetail: input.sourceDetail });
    if (remark) {
      await prisma.lead.update({ where: { id: lead.id }, data: { rawRemarks: remark } });
    }
  }

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
            source: { type: "LEAD_INTAKE", id: lead.id, createdById: null },
          });
        } else {
          await notifyRoles(["ADMIN", "MANAGER"], {
            kind: "LEAD_DUPLICATE",
            severity: "WARNING",
            title,
            body: `${body} — assign to a senior agent.`,
            linkUrl: `/leads/${lead.id}`,
            leadId: lead.id,
            source: { type: "LEAD_INTAKE", id: lead.id, createdById: null },
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
  const waOn = await getWhatsappAutomationEnabled();
  // Automation gate: no auto-WA until team is classified AND WhatsApp automation is ON.
  const gate = automationGate(lead.forwardedTeam, !waOn);
  if (window.kind === "OVERNIGHT_QUEUE" && lead.phone && gate.ok) {
    sendAfterHoursWelcome(lead.id, lead.phone, lead.name).catch(() => {});
  } else if (window.kind === "OVERNIGHT_QUEUE" && lead.phone && !gate.ok) {
    console.log("[ingestLead] after-hours welcome suppressed:", gate.reason);
  }

  // ── Website lead auto-assignment ──────────────────────────────────────────
  // Default (no routing rule): by fixed team rule — Dubai → Lalit, India →
  // Tanuj (Yasir on Tue-IST). 2026-07-17: an admin Routing Rule "Website Leads →
  // Lalit Sharma" now overrides this, sending ALL website leads to Lalit
  // (replaced the earlier temporary Dubai→Mehak default; Mehak long retired).
  // Toggle websiteAutoAssignEnabled in /settings still gates the whole path.
  // GUARDS (all must hold): source is WEBSITE · toggle ON · a team was resolved ·
  // the lead is still unassigned · a valid, active, non-HR assignee is mapped for
  // that team. Uses the canonical assignLeadTo() so the Assignment-history row +
  // owner notification fire (Agent Performance + notifications stay correct).
  // NEVER touches imports / manual creation / existing leads (only this fresh
  // WEBSITE intake path). Best-effort: a failure here never blocks lead creation.
  const isWebLead = input.source === LeadSource.WEBSITE;
  // Auto-assign fires for real-time SINGLE-lead intake: WEBSITE-source forms (back-
  // compat) PLUS any caller that opted in via input.autoAssign (Meta, email, the
  // universal intake key, manual-without-owner, quick-add). NEVER for bulk imports
  // or buyer-convert (they don't set the flag) — they stay parked for triage. WHO
  // gets the lead now comes from the central business rule resolveTeamAutoAssignee()
  // (Dubai→Lalit · Tuesday-IST India→Yasir · else Tanuj), NOT the static
  // websiteLeadAssignees map. The websiteAutoAssignEnabled toggle still gates it.
  const wantsAutoAssign = isWebLead || input.autoAssign === true;
  let autoAssigned = false;
  // ── TERMINAL-STATUS AUTO-ASSIGN SKIP (Lalit 2026-07-10) ────────────────────────────
  // A lead that ARRIVES already carrying a terminal status — LOST/Rejected (e.g. a
  // "Not Interested" import) OR Won/Closed (a "Booked With Us" import) — must NEVER be
  // handed to an agent by the auto-assign rule. It is not new active work: LOST is dead,
  // Won/Closed is already booked. This is the ONE intake auto-assign choke point, so
  // EVERY current and future intake route that opts into autoAssign inherits the skip
  // for free — none of them has to remember the rule. (The matching follow-up clear is
  // applied on the create data just above; the owner-unassign for a pre-assigned import
  // owner is applied via terminalIntakeFields in the CSV/Sheet importer update paths,
  // where the terminal status is stamped post-create.)
  const arrivedTerminal = isTerminalStatus(lead.currentStatus);
  // NOTE: no `lead.forwardedTeam` in this outer gate. The DEFAULT team-rule still
  // requires a team (see gateOk below — Lalit's mandatory-team policy: never GUESS a
  // team), but an explicit admin ROUTING RULE (e.g. "all website leads → Lalit") is a
  // deliberate directive that may assign a team-less lead. Assigning to a specific
  // named owner isn't "guessing a market", so it honors the policy's spirit.
  if (wantsAutoAssign && !arrivedTerminal) {
    try {
      const cfg = await getWebsiteAutoAssign();          // keep ONLY for the enable toggle
      // Routing Scheduler → leave-cover default. resolveAutoAssignOwner consults the
      // admin Routing Rules first (Admin → Lead Routing): a live matching rule picks
      // the owner (single / round-robin / weighted); "Pause Automatic Assignment"
      // leaves the lead UNASSIGNED for manual distribution; no rule → the exact
      // pre-existing default, resolveActiveAssignee (fixed team rule + leave-cover
      // #16: on-leave agent redirects to cover teammate → Lalit → park).
      const rb = leadRoutingBudget(lead, currencyForTeam(lead.forwardedTeam));
      const resolution = await resolveAutoAssignOwner({
        module: "lead-intake",
        team: lead.forwardedTeam,
        market: lead.market,
        source: input.source,
        project: lead.sourceDetail,
        country: lead.country,
        budget: rb.value,
        budgetState: rb.state,
        // An existing eligible owner wins (re-ingest / dedup-update of an owned lead).
        // Passing it here also stops the round-robin pointer burning on a pick that
        // the `!lead.ownerId` gate below would have discarded anyway.
        currentOwnerId: lead.ownerId,
      });
      const targetUserId = (resolution.kind === "paused" || resolution.kind === "preserved") ? null : resolution.userId;
      // A RULE match may assign regardless of team; the DEFAULT path keeps the
      // mandatory-team gate (team-less non-rule leads still park in awaiting-team,
      // byte-identical to before).
      const gateOk = resolution.kind === "rule" ? true : !!lead.forwardedTeam;
      if (cfg.enabled && gateOk && targetUserId && !lead.ownerId) {
        // Validate the resolved user is real, active and not HR-only before assigning.
        const assignee = await prisma.user.findFirst({
          where: { id: targetUserId, active: true, hrOnly: false },
          select: { id: true },
        });
        if (assignee) {
          const reason = resolution.kind === "rule" ? resolution.reason : `auto-assign (${lead.forwardedTeam} team)`;
          await assignLeadTo(lead.id, assignee.id, reason);
          if (resolution.kind === "rule") {
            await prisma.lead.update({
              where: { id: lead.id },
              data: { routingMethod: "rule", routingSource: `routing_rule:${resolution.ruleId}`, routingReason: resolution.reason },
            });
          }
          lead.ownerId = assignee.id; // reflect locally so the alert block below adapts
          autoAssigned = true;
        }
      }
    } catch (err) {
      console.error("[ingestLead] auto-assign failed for lead", lead.id, err);
    }
  }

  // Admin alert — they have 5 minutes to assign manually
  // Lalit's mandatory-team policy (2026-06): when the intake doesn't supply
  // a team, NOTHING auto-routes. The lead sits in /admin/awaiting-team
  // until an admin/manager tags it Dubai or India. The reconciler also
  // skips null-team leads in its 5-min orphan sweep.
  // Website leads get a dedicated "please assign" alert to Admin/Super-Admin.
  // notify() already fans out web push + the in-app bell sound; WARNING also emails.
  const webLeadBody = autoAssigned
    ? `New website lead auto-assigned${lead.forwardedTeam ? ` to the ${lead.forwardedTeam} team` : ""}.${lead.name && lead.name !== "Unknown" ? ` — ${lead.name}` : ""}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ""}`
    : `New website lead received. Please assign.${lead.name && lead.name !== "Unknown" ? ` — ${lead.name}` : ""}${lead.sourceDetail ? ` (${lead.sourceDetail})` : ""}`;

  if (lead.forwardedTeam === null) {
    await notifyRoles(["ADMIN", "MANAGER"], {
      kind: "LEAD_ASSIGNED",
      severity: "WARNING",
      title: isWebLead ? `🌐 New website lead received` : `⚠️ New lead needs team assignment: ${lead.name}`,
      body: isWebLead ? webLeadBody : `This ${input.source} lead arrived without a team tag. Open the lead and pick Dubai or India to start the round-robin.`,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
      source: { type: "LEAD_INTAKE", id: lead.id, createdById: null },
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
      title: isWebLead
        ? (autoAssigned ? `🌐 New website lead auto-assigned (${lead.forwardedTeam})` : `🌐 New website lead received`)
        : `New ${input.source} lead: ${lead.name}`,
      body: isWebLead ? webLeadBody : adminBody,
      linkUrl: `/leads/${lead.id}`,
      leadId: lead.id,
      source: { type: "LEAD_INTAKE", id: lead.id, createdById: null },
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

/** Thrown by assignLeadTo when the target lead is still REJECTED. Every assignment
 *  surface (inline-assign, bulk reassign, manual assign, awaiting-team round-robin)
 *  funnels through assignLeadTo, so refusing here is the ONE guard that guarantees a
 *  rejected lead can never be re-owned — which is exactly the breach that stranded 17
 *  leads as rejected-but-owned (a bulk reassign swept up already-rejected leads).
 *  Callers catch this and tell the user to reactivate the lead first (Rejected-Lead
 *  workflow "reactivate-before-reassign", 2026-06-27). */
export class LeadRejectedError extends Error {
  constructor(public leadId: string, public leadName?: string | null) {
    super("LEAD_REJECTED");
    this.name = "LeadRejectedError";
  }
}

/** Thrown when an assignment names a deactivated user (left the org / suspended /
 *  disabled). Assignment routes translate it to a 409/400 with a clear message.
 *  Enforced at the assignLeadTo choke point so NO backend path can assign to a
 *  former employee, regardless of what the frontend shows. */
export class InactiveUserError extends Error {
  constructor(public userId: string, public userName?: string | null) {
    super("USER_INACTIVE");
    this.name = "InactiveUserError";
  }
}

/**
 * Reassign a lead to a specific user (manual or system-triggered).
 * Sets SLA clock and notifies the new owner.
 *
 * REACTIVATE-BEFORE-REASSIGN: throws LeadRejectedError if the lead is still rejected.
 * The reject decision (reason / note / timeline) is left fully intact — the lead must
 * be reactivated (which clears rejectedAt) before it can be assigned to anyone.
 */
export async function assignLeadTo(leadId: string, userId: string, reason: string) {
  const now = new Date();
  const slaFirstCallBy = new Date(now.getTime() + FIRST_CALL_SLA_MIN * 60 * 1000);

  const [lead, agent] = await Promise.all([
    prisma.lead.findUnique({ where: { id: leadId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!lead || !agent) throw new Error("Lead or user not found");
  // ── FORMER / INACTIVE USER GUARD (Lalit offboarding, 2026-07-23) ───────────
  // A lead can never be assigned to a deactivated user (left the org / suspended /
  // disabled). This is THE single assignment choke point — manual assign, bulk
  // reassign, master-data assign, routing "apply to existing", revival reassign
  // all funnel through here — so this one guard makes every backend assignment API
  // reject an inactive target, exactly as required: "do not rely only on the
  // frontend hiding the user." The routing PICKER already filters active:true, so
  // auto-assignment never SELECTS an inactive user; this closes the direct/manual
  // paths that name a userId explicitly.
  if (!agent.active) throw new InactiveUserError(userId, agent.name);
  // A rejected lead must be reactivated before it can be (re)assigned. This is the
  // SINGLE choke point every assignment path funnels through, so this one line closes
  // all of them — and any future caller — against re-owning a rejected lead (the
  // hard-unassign invariant). Never touches the reject record; only refuses the write.
  if (lead.rejectedAt != null) throw new LeadRejectedError(leadId, lead.name);

  // ── LOST-status reactivation (Lalit RCA, 2026-07-21) ──────────────────────
  // The reject guard above only catches leads unassigned via the REJECT route
  // (rejectedAt set). A lead made terminal by a LOST *status change* ("Not
  // Interested", "Funds Issue", …) is unassigned by terminalStatusSideEffects but
  // keeps rejectedAt = null, so it sails past that guard. Assigning an owner turns
  // it back into active work — it MUST leave the LOST state in the SAME write, or
  // it ends up owned AND lost (the exact drift this RCA fixed: Ahlam / Gagan).
  //
  // Reset to "Fresh Lead" — the status the dedicated /reactivate route already
  // uses, valid in BOTH India and Dubai masters (unlike "Not Contacted", which is
  // India-only). previousStatus stashes what it was, for the timeline. Gated on
  // isLostStatus ONLY: a booked/sold (CLOSED) lead legitimately keeps its owner
  // AND status when transferred, so it is deliberately untouched here — the same
  // asymmetry terminalStatusSideEffects enforces. Paths that already reactivate
  // before calling this (Master-Data assign → "Not Contacted") arrive non-lost, so
  // this is a no-op for them; it only heals the paths that DON'T pre-reactivate.
  const wasLost = isLostStatus(lead.currentStatus);
  const reactivate = wasLost
    ? { currentStatus: "Fresh Lead", previousStatus: lead.currentStatus }
    : {};

  await prisma.lead.update({
    where: { id: leadId },
    // resetAttemptCycleData: ownership change = fresh owner-specific attempt cycle
    // (Lalit 2026-07-17) — attempt/connect counters to 0, last-attempt cleared,
    // 👻 ghosting cleared. The OLD owner's calls stay in CallLog/audit forever;
    // this is the ONE assignment choke point, so every path (manual, bulk, master
    // assign, routing rules, buyer convert, revival reassign) resets identically.
    data: { ownerId: userId, assignedAt: now, slaFirstCallBy, slaEscalated: false, ...reactivate, ...resetAttemptCycleData() },
  });
  // Record the reactivation on the timeline so the status change is auditable
  // (the caller logs the ownerId change; this captures the status side-effect).
  if (wasLost) {
    await prisma.leadFieldHistory.create({
      data: { leadId, field: "currentStatus", oldValue: lead.currentStatus, newValue: "Fresh Lead",
              changedById: null, source: "assign-reactivate" },
    }).catch(() => {});
  }
  await prisma.assignment.create({ data: { leadId, userId, reason } });
  await notify({
    userId,
    kind: "LEAD_ASSIGNED",
    severity: "INFO",
    title: `📩 New lead: ${lead.name}`,
    body: `Source: ${lead.source}. Call within ${FIRST_CALL_SLA_MIN} minutes — ${reason}.`,
    linkUrl: `/leads/${leadId}`,
    leadId,
    source: { type: "ASSIGNMENT", id: leadId, createdById: null },
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
