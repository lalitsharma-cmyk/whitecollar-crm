import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { ActivityType, ActivityStatus, AIScore, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { loadOwnedLead } from "@/lib/leadScope";
import { rescoreLead } from "@/lib/leadRescorer";
import { fireWorkflowTrigger } from "@/lib/workflowEngine";
import { getScheduledActionsEnabled, getBantGateMode } from "@/lib/settings";
import { evaluateBantGate, type BantFields } from "@/lib/bantGate";
import { awardXp, type AwardResult, type XpReason } from "@/lib/gamification.server";
import { canSetStatus, isStatusValidForTeam, isBookedStatus, NEEDS_REVIEW } from "@/lib/lead-statuses";
import { terminalStatusSideEffects, followupAllowedForStatus } from "@/lib/lostRejected";
import { isPropertyType } from "@/lib/propertyType";
import { recordFieldChanges, TRACKED_FIELDS } from "@/lib/fieldHistory";
import { normalizeNameList } from "@/lib/nameFormat";
import { notify } from "@/lib/notify";
import { assignLeadTo } from "@/lib/leadIngest";
import { hasContactActivityToday } from "@/lib/followupGate";
import { teamToMarket } from "@/lib/market";
import { phoneCanonicalDigits } from "@/lib/phoneCountry";
import { NotifKind, type Prisma } from "@prisma/client";

// Inline-edit endpoint — accepts one or more field updates and logs an Activity
// for status/stage changes. Only allows whitelisted fields.

const ALLOWED: Record<string, "string" | "date" | "number" | "enum" | "bool"> = {
  name: "string", altName: "string", phone: "string", altPhone: "string",
  email: "string", altEmail: "string", company: "string",
  city: "string", state: "string", country: "string", address: "string",
  configuration: "string", currentStatus: "string", categorization: "string",
  // propertyType: "Residential" | "Commercial" — agent/admin/super-admin editable (not PII-locked).
  propertyType: "string",
  sourceDetail: "string",  // "Project" the lead came for — admin/manager editable (Master Data inline)
  tags: "string", notesShort: "string",
  // remarks: editable by agents. When edited, an Activity record is created (see line ~287).
  // rawRemarks MUST NOT be in ALLOWED — it is the immutable imported archive, never edited here.
  remarks: "string",
  whoIsClient: "string", detailShared: "string", todoNext: "string",
  // ClientType: 'INVESTOR' | 'END_USER' | 'BOTH' | 'UNCLEAR' (or null to clear)
  clientType: "enum",
  budgetMin: "number", budgetMax: "number", budgetCurrency: "string",
  // budgetRaw — the verbatim budget text; Admin / Super-Admin-only (gated below),
  // so an admin can directly clear corrupted text ("Lalit Sir") without it being
  // re-derived. Agents edit the numeric budget instead.
  budgetRaw: "string",
  // forwardedTeam (Dubai / India routing) — Admin / Manager only (gated below).
  forwardedTeam: "enum",
  // ownerId — lead ASSIGNMENT. Handled SPECIALLY before the generic loop: it
  // routes through assignLeadTo() (Assignment history row + notify + SLA), never
  // a bare ownerId set. Admin / Manager only (gated below). Listed here only so
  // the "Nothing to update" guard counts it; the generic loop skips it.
  ownerId: "string",
  followupDate: "date", meetingDate: "date", siteVisitDate: "date",
  // createdAt = enquiry date (admin-only inline edit — gated below in ADMIN_ONLY_FIELDS)
  createdAt: "date",
  status: "enum", potential: "enum", fundReadiness: "enum",
  moodStatus: "enum", whenCanInvest: "enum",
  // source (lead provenance / LeadSource enum) — Admin / Super-Admin-only; gated below.
  source: "enum",
  // sourceRaw — verbatim free-text source ("Townscript"); Admin/Super-Admin-only.
  sourceRaw: "string",
  bantStatus: "enum", bantReason: "string",
  // BANT depth — Authority + Need.
  // authorityPerson is the new free-text "who decides" field ("Self", "Wife", etc.)
  // authorityLevel (enum) kept for backward compat with existing data.
  authorityLevel: "enum", authorityPerson: "string", needSummary: "string",
  isColdCall: "bool", coldCallReason: "string",
  profession: "string", designation: "string", nationality: "string", preferredLocation: "string", linkedInUrl: "string",
  // WCR Event conditional fields (shown when source = WCR_EVENT)
  eventName: "string", eventCountry: "string", eventState: "string", eventCity: "string",
  // Referral source field (shown when source = REFERRAL)
  referralName: "string",
  // Communication medium (how they came — Call, WhatsApp, Email, Other)
  medium: "string", mediumOther: "string",
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Ownership check: agents can only mutate leads they own; admins/managers any.
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;
  const { me } = scoped;
  const body = await req.json().catch(() => ({}));
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // ── customFields (Imported Fields) MERGE edit — Admin / Super-Admin only ──────
  // Imported sheet columns live in the Lead.customFields JSON blob. Editing one
  // value must MERGE the single key back in WITHOUT dropping the other keys (a
  // bare `update: { customFields: {k:v} }` would replace the whole object). We
  // read the current blob, overlay the edited key(s), write it back, and record
  // a Change-History row per key as "customFields.<key>" (old→new). Handled here,
  // before the generic loop, and returns immediately. Body shape:
  //   { customFields: { "<Original Header>": "<new value>" } }
  // A null/"" value clears that one key (removes it from the blob).
  if ("customFields" in body) {
    if (me.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Only an Admin or Super Admin can edit imported fields.", adminOnly: true },
        { status: 403 },
      );
    }
    const patch = body.customFields;
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      return NextResponse.json({ error: "customFields must be an object of key→value." }, { status: 400 });
    }
    const cur = await prisma.lead.findUnique({ where: { id }, select: { customFields: true } });
    const base: Record<string, unknown> =
      cur?.customFields && typeof cur.customFields === "object" && !Array.isArray(cur.customFields)
        ? { ...(cur.customFields as Record<string, unknown>) }
        : {};
    // Build before/after maps keyed as customFields.<key> for the audit, and apply
    // the merge to a copy of the blob. Clearing (null/"") deletes the key.
    const beforeCF: Record<string, unknown> = {};
    const afterCF: Record<string, unknown> = {};
    const merged: Record<string, unknown> = { ...base };
    for (const [k, raw] of Object.entries(patch as Record<string, unknown>)) {
      const oldVal = base[k] ?? null;
      const newVal = raw == null || raw === "" ? null : String(raw);
      beforeCF[`customFields.${k}`] = oldVal;
      afterCF[`customFields.${k}`] = newVal;
      if (newVal == null) delete merged[k];
      else merged[k] = newVal;
    }
    await prisma.lead.update({
      where: { id },
      data: { customFields: merged as Prisma.InputJsonValue, lastTouchedAt: new Date() },
    });
    recordFieldChanges(prisma, id, me.id, beforeCF, afterCF, "inline-edit").catch(() => {});
    return NextResponse.json({ ok: true, customFields: true, updated: Object.keys(patch).length });
  }

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

  // Source (lead provenance) is an Admin / Super-Admin-only correction. Stricter
  // than ADMIN_ONLY_FIELDS (which allows managers): block agents AND managers.
  // role "ADMIN" covers super-admins (isSuperAdmin is a flag on an ADMIN).
  if (("source" in body || "sourceRaw" in body || "budgetRaw" in body) && me.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an Admin or Super Admin can change the lead source or raw budget text." },
      { status: 403 },
    );
  }

  // forwardedTeam (Dubai / India routing) — Admin / Manager only; block agents,
  // who must not reroute leads between teams.
  if ("forwardedTeam" in body && me.role === "AGENT") {
    return NextResponse.json(
      { error: "Only an Admin or Manager can change the lead's team." },
      { status: 403 },
    );
  }

  // ── ownerId — lead ASSIGNMENT (Admin / Manager only) ─────────────────────────
  // Handled here, BEFORE the generic field loop, and routed through assignLeadTo()
  // so every assignment (incl. Master Data inline-assign) writes an Assignment
  // history row, sets the SLA clock, and NOTIFIES the new owner. A bare ownerId
  // updateMany would skip all three — which is what kept Master Data assigns
  // invisible to the Agent Performance report (it counts by Assignment history).
  // This branch returns immediately; ownerId is never re-applied via the loop.
  if ("ownerId" in body) {
    if (me.role === "AGENT") {
      return NextResponse.json(
        { error: "Only an Admin or Manager can assign leads.", adminOnly: true },
        { status: 403 },
      );
    }
    const newOwnerId = body.ownerId == null || body.ownerId === "" ? null : String(body.ownerId);
    const cur = await prisma.lead.findUnique({ where: { id }, select: { ownerId: true, rejectedAt: true } });
    // REACTIVATE-BEFORE-REASSIGN — refuse assigning an owner to a rejected lead
    // (unassigning is still fine). assignLeadTo is the hard backstop; this is the
    // clean 409 for the inline-assign UI (Master Data / lead detail), which is
    // exactly where rejected leads are visible and got re-owned.
    if (newOwnerId !== null && cur?.rejectedAt != null) {
      return NextResponse.json({ error: "This lead is rejected — reactivate it first, then assign.", rejected: true }, { status: 409 });
    }
    if (newOwnerId === null) {
      // Unassign — clear owner + SLA. No assignLeadTo (there's no owner to notify).
      if (cur?.ownerId != null) {
        await prisma.lead.update({
          where: { id },
          data: { ownerId: null, assignedAt: null, slaFirstCallBy: null, slaEscalated: false, lastTouchedAt: new Date() },
        });
        recordFieldChanges(prisma, id, me.id, { ownerId: cur.ownerId }, { ownerId: null }, "inline-edit").catch(() => {});
      }
      return NextResponse.json({ ok: true, assigned: false, unassigned: true });
    }
    // Manager may only assign WITHIN their team scope — canTouchLead already
    // verified they can see this lead; also verify the target user is active +
    // non-HR so we never assign to a deactivated / recruitment account.
    const target = await prisma.user.findFirst({ where: { id: newOwnerId, active: true, hrOnly: false }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "Target agent not found or inactive." }, { status: 404 });
    if (cur?.ownerId !== newOwnerId) {
      await assignLeadTo(id, newOwnerId, `Reassigned by ${me.role === "ADMIN" ? "admin" : "manager"} (inline edit)`);
      recordFieldChanges(prisma, id, me.id, { ownerId: cur?.ownerId ?? null }, { ownerId: newOwnerId }, "inline-edit").catch(() => {});
    }
    return NextResponse.json({ ok: true, assigned: true });
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

  // Property Type is a controlled vocabulary — Residential / Commercial / Mixed
  // Use only (or blank to clear). Never let a Source value (Import/Google/…) land
  // here. The dropdowns only offer valid values; this guards direct API calls.
  if (typeof body.propertyType === "string" && body.propertyType && !isPropertyType(body.propertyType)) {
    return NextResponse.json({ error: "Property Type must be Residential, Commercial, or Mixed Use." }, { status: 400 });
  }

  // ── Follow-up-date-change protection (Lalit's policy) ─────────────────────────
  // An AGENT must not silently change the Follow-up Date (Scheduling & Next Action
  // inline edit) without a real contact attempt today. If they try to MOVE
  // followupDate and there's no valid contact activity today, require a reschedule
  // reason. A reason satisfies it (logged to the timeline). Admins/managers bypass.
  // Only fires on an actual CHANGE — re-saving the same date, or clearing it on a
  // complete path, is unaffected. Other field edits in the same PATCH are allowed.
  let rescheduleReasonForTimeline: string | null = null;
  if (me.role === "AGENT" && "followupDate" in body) {
    const newRaw = body.followupDate;
    const newDate = newRaw == null || newRaw === "" ? null : new Date(String(newRaw));
    const cur = await prisma.lead.findUnique({ where: { id }, select: { followupDate: true } });
    const curMs = cur?.followupDate ? cur.followupDate.getTime() : null;
    const newMs = newDate && !isNaN(newDate.getTime()) ? newDate.getTime() : null;
    const isChange = curMs !== newMs;
    // Setting a date (not clearing) is the protected action. Clearing a follow-up
    // is what Complete does and is never blocked here.
    if (isChange && newMs != null) {
      const reason = String(body.rescheduleReason ?? "").trim();
      const hasContact = await hasContactActivityToday(id);
      if (!hasContact && !reason) {
        return NextResponse.json(
          { error: "Please log an activity or provide a valid reschedule reason before changing the follow-up date.", rescheduleReasonRequired: true },
          { status: 400 },
        );
      }
      if (reason) rescheduleReasonForTimeline = reason;
    }
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

  // Team-change revalidation — if the team is changing and the caller didn't also
  // explicitly set a status, re-check the EXISTING status against the NEW team's
  // master. A status that doesn't exist there becomes "Needs Review" (never a
  // forced wrong-team status). Leads keep their status unless the team changes.
  if ("forwardedTeam" in updates && !("currentStatus" in updates)) {
    const cur = await prisma.lead.findUnique({ where: { id }, select: { currentStatus: true, forwardedTeam: true } });
    const newTeam = (updates.forwardedTeam as string | null) ?? null;
    if (cur && cur.forwardedTeam !== newTeam && !isStatusValidForTeam(cur.currentStatus, newTeam)) {
      updates.currentStatus = NEEDS_REVIEW;
      activityNotes.push(`status → ${NEEDS_REVIEW} (team changed)`);
    }
  }

  // MARKET tracks TEAM — whenever a team is (re)assigned via inline edit, derive
  // the India/UAE market in the SAME write so the lead-market-segregation invariant
  // can never drift. Only set on a non-null team (clearing a team leaves any
  // currency-derived market intact — additive, never destructive).
  if ("forwardedTeam" in updates && updates.forwardedTeam) {
    updates.market = teamToMarket(updates.forwardedTeam as string);
  }

  // Proper-Case name fields on inline edit (name/altName only — never phone/
  // email/company/etc.). normalizeNameList preserves intentional mixed-case and
  // skips non-name values; multi-name cells normalize each part. Applied to the
  // string values just parsed above, before the DB write + history capture.
  for (const nf of ["name", "altName"] as const) {
    if (typeof updates[nf] === "string" && updates[nf]) {
      updates[nf] = normalizeNameList(updates[nf] as string);
    }
  }

  if (Object.keys(updates).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // ── Terminal-status side-effects — SHARED lost/rejected + closed/won rule ──────
  // The single source of truth (src/lib/lostRejected.ts), identical to the rule the
  // reject route applies: moving a lead INTO a LOST status unassigns it (owner →
  // previousOwner, owner + assignedAt cleared) AND clears its follow-up; a CLOSED/WON
  // status KEEPS its owner (that ownership is the booking attribution) and only clears
  // the follow-up. A workable status returns {}, so the spread is a no-op there — we
  // apply it unconditionally. Read the lead's CURRENT ownership BEFORE the update
  // (previousOwnerId isn't on the slim loadOwnedLead select, so fetch it here). The
  // ownerId + followupDate old→new transitions are captured by the existing
  // recordFieldChanges below (both are TRACKED_FIELDS) — no separate history write.
  // Fetch current ownership + status once (loadOwnedLead's select is slim). Needed
  // both for the terminal side-effects and the follow-up guard just below.
  const curOwn = await prisma.lead.findUnique({
    where: { id },
    select: { ownerId: true, previousOwnerId: true, currentStatus: true },
  });
  // The status this update RESULTS in — the one being set, or the stored one when
  // the payload doesn't touch status.
  const effectiveStatus =
    typeof updates.currentStatus === "string" && updates.currentStatus
      ? updates.currentStatus
      : (curOwn?.currentStatus ?? null);

  // ── RC-1 GUARD (Lalit RCA, 2026-07-21) ────────────────────────────────────
  // A follow-up must never be written onto a terminal (lost/closed) lead. The
  // block below clears the follow-up when a status TRANSITIONS to terminal, but an
  // inline edit of ONLY followupDate on an ALREADY-terminal lead skipped it — the
  // confirmed leak (a 24-Jul follow-up landed on a "Funds Issue" lead). Refuse it,
  // so the agent reactivates the lead first rather than silently scheduling a dead
  // one back into the follow-up queue. (Clearing a follow-up to null is always OK.)
  if ("followupDate" in updates && updates.followupDate != null && !followupAllowedForStatus(effectiveStatus)) {
    return NextResponse.json(
      { error: `This lead is "${effectiveStatus}" — reactivate it before scheduling a follow-up.` },
      { status: 400 },
    );
  }

  if (typeof updates.currentStatus === "string" && updates.currentStatus) {
    Object.assign(
      updates,
      terminalStatusSideEffects(updates.currentStatus, {
        ownerId: curOwn?.ownerId ?? null,
        previousOwnerId: curOwn?.previousOwnerId ?? null,
      }),
    );
  }

  // §17 — Location enrichment on City edit + manual-lock + impossible-combo guard.
  const editingCity = "city" in updates && !!updates.city;
  const editingCountry = "country" in updates;   // user is directly setting country
  const editingState = "state" in updates;       // user is directly setting state
  if (editingCity || editingCountry || editingState) {
    const loc = await prisma.lead.findUnique({
      where: { id },
      select: { city: true, country: true, state: true, locationManual: true },
    });
    // Directly editing Country/State = the user takes manual control → lock it so a
    // later City change won't overwrite their value.
    if (editingCountry || editingState) updates.locationManual = true;

    // On a City change, RE-ENRICH Country + State and overwrite the previously
    // auto-filled values (fixes "Dubai→Gurgaon kept UAE"). Skip only when the
    // location was manually locked and the user isn't also editing country/state now.
    if (editingCity && !editingCountry && !editingState && loc?.locationManual !== true) {
      const { lookupLocation } = await import("@/lib/locationLookup");
      const enriched = await lookupLocation(updates.city as string);
      if (enriched?.country) {
        updates.country = enriched.country;
        updates.state = enriched.state ?? null;   // refresh state too (clears stale)
        activityNotes.push(`location re-enriched: ${enriched.state ? enriched.state + ", " : ""}${enriched.country}`);
      }
    }

    // Impossible City↔Country combo guard (e.g. Gurgaon + UAE). Only when the
    // curated map is confident AND a non-admin is forcing a mismatch. Admins may
    // override (logged); the auto-re-enrich above means this only bites a manual lock.
    const { inferCountryFromCity } = await import("@/lib/cityCountry");
    const finalCity = (("city" in updates ? updates.city : loc?.city) ?? "") as string;
    const finalCountry = (("country" in updates ? updates.country : loc?.country) ?? "") as string;
    const curatedCountry = inferCountryFromCity(finalCity);
    if (curatedCountry && finalCountry && curatedCountry !== finalCountry) {
      if (me.role !== "ADMIN") {
        return NextResponse.json({
          error: `"${finalCity}" is in ${curatedCountry}, not ${finalCountry}. Fix the City or Country — or ask an Admin to override.`,
          locationConflict: true,
        }, { status: 422 });
      }
      activityNotes.push(`⚠ admin override: ${finalCity} kept as ${finalCountry} (map says ${curatedCountry})`);
    }
  }

  updates.lastTouchedAt = new Date();
  // Keep phoneCanonical in lockstep with a manual phone edit (the ONE canonical
  // rule feeds dedup): recompute on a set, clear on a clear. Admin-only field, so
  // this only runs on an authorized phone change.
  if ("phone" in updates) {
    updates.phoneCanonical = typeof updates.phone === "string" && updates.phone
      ? (phoneCanonicalDigits(updates.phone) || null)
      : null;
  }
  // Editing the enquiry DATE (admin-only inline edit) sets a date without a time —
  // so the Created Time must display blank. Mark the time unknown on that edit.
  if ("createdAt" in updates) updates.createdTimeKnown = false;
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

  // A manual numeric budget edit supersedes any imported verbatim text: clear
  // budgetRaw so the freshly-typed value is what displays (displayBudget prefers
  // budgetRaw). Skipped if the caller set budgetRaw explicitly.
  if (("budgetMin" in updates || "budgetMax" in updates) && !("budgetRaw" in updates)) {
    updates.budgetRaw = null;
  }

  await prisma.lead.update({ where: { id }, data: updates as never });

  if (beforeRow) {
    recordFieldChanges(prisma, id, me.id, beforeRow as Record<string, unknown>, updates, "inline-edit").catch(() => {});
  }

  // ── Status-changed notification — tell the lead OWNER when their lead's
  //    currentStatus moves (e.g. an admin/manager reclassifies it). Skip when
  //    the editor IS the owner (they already know). beforeRow selects
  //    TRACKED_FIELDS (incl. currentStatus) so the before-value is reliable
  //    whenever currentStatus is part of this PATCH. Fire-and-forget.
  if (updates.currentStatus && (beforeRow as { currentStatus?: unknown } | null)?.currentStatus !== updates.currentStatus) {
    const ownerId = scoped.lead.ownerId;
    if (ownerId && ownerId !== me.id) {
      notify({
        userId: ownerId,
        kind: NotifKind.SYSTEM,
        severity: "INFO",
        title: `🔁 Status → ${updates.currentStatus}`,
        body: scoped.lead.name,
        linkUrl: `/leads/${id}`,
        leadId: id,
        source: { type: "ASSIGNMENT", id, createdById: me.id },
      }).catch(() => {});
    }
  }

  // Dedicated Smart-Timeline entry for a follow-up-date CHANGE so it reads clearly
  // ("Follow-up date changed — reason: …") instead of being buried in a generic
  // "Inline edit" row. Records the reason (when given) + a report bucket.
  if ("followupDate" in updates) {
    const newWhen = updates.followupDate instanceof Date
      ? (updates.followupDate as Date).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST"
      : "cleared";
    await prisma.activity.create({
      data: {
        leadId: id, userId: me.id,
        type: ActivityType.NOTE,
        status: ActivityStatus.DONE,
        title: rescheduleReasonForTimeline
          ? `📅 Follow-up date changed to ${newWhen} by ${me.name} — reason: ${rescheduleReasonForTimeline}`
          : `📅 Follow-up date changed to ${newWhen} by ${me.name}`,
        actionContext: rescheduleReasonForTimeline ? "followup-change:reason" : "followup-change:contacted",
        completedAt: new Date(),
      },
    });
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
  const scheduledOn = await getScheduledActionsEnabled();
  if (scheduledOn) {
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
    // Canonical casings first: office-visit list includes BOTH "Wants Office Visit"
    // (canonical, lead-statuses) and "Want Office Visit" (legacy); booking uses the
    // shared isBookedStatus helper so "Booked With Us" (canonical, capital W) AND
    // "Booked with Us" (legacy) both award BOOKING_DONE. Previously the block matched
    // only the legacy casings, so a normal inline edit to a canonical booking/office
    // visit awarded no XP.
    if (ns && ["Meeting", "Site Visit Schedule", "Visit Dubai", "Wants Office Visit", "Want Office Visit", "Zoom Meeting"].includes(ns))
      reason = "NEGOTIATION_STARTED";
    else if (isBookedStatus(ns)) reason = "BOOKING_DONE";
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
