// ─────────────────────────────────────────────────────────────────────────────
// scripts/sandbox/anonymize-from-prod.ts — PROD → SANDBOX anonymized refresh
//
//   npx tsx scripts/sandbox/anonymize-from-prod.ts --confirm
//
// WHAT THIS IS
//   A REFRESHABLE pipeline that copies a PRODUCTION snapshot into the isolated
//   Sandbox database with every piece of PII replaced by REALISTIC FAKE data
//   (never blanks). The sandbox ends up structurally identical to prod — same
//   ids, same relations, same status/enum/date distributions — so interns / QA
//   can click the whole app against lifelike data, but no real client identity,
//   phone, email, passport, budget figure, or conversation text survives.
//
//   Re-running WIPES the loaded sandbox tables first, so a refresh is idempotent:
//   run it again to pull a fresh snapshot.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  PROD-WRITE SAFETY — the #1 requirement of this file
//   • `prod` is a READ-ONLY PrismaClient bound to DATABASE_URL. This file ONLY
//     ever calls `.findMany()` / `.count()` on it. There is not a single
//     create/update/delete/upsert/$executeRaw against `prod` anywhere below.
//   • `sb` is the GUARDED writer from ./guard (sandboxClient()). That guard
//     refuses to run unless SANDBOX_DATABASE_URL is set, is different from
//     DATABASE_URL, carries a sandbox marker, and --confirm was passed. EVERY
//     write goes through `sb`.
//   • An explicit assert below throws if DATABASE_URL === SANDBOX_DATABASE_URL,
//     before either client is created (belt-and-braces on top of the guard).
//   • Real bytea / recordings / audio are NEVER copied — recordingUrl is nulled,
//     attachment/voice tables are skipped.
//
// DETERMINISM
//   All fakes come from scripts/sandbox/anonymize.ts, seeded by each row's own id
//   (or phone/email), so the mapping is stable run-to-run and consistent across
//   modules (a lead keeps ONE fake identity in Leads + Buyer + timeline). No
//   Math.random / Date.now is used here; copied timestamps are passed through.
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sandboxClient } from "./guard";
import {
  fakeName,
  fakePhone,
  fakeEmail,
  fakePassport,
  fakeBudget,
  fakeConversation,
  fakeMessage,
  fakeFreeText,
} from "./anonymize";

// ── SAFETY ASSERT (before any client is constructed) ─────────────────────────
// The guard enforces this too, but we assert here so a misconfiguration can
// never even build a prod-pointed writer.
{
  const prodUrl = process.env.DATABASE_URL?.trim();
  const sbUrl = process.env.SANDBOX_DATABASE_URL?.trim();
  if (prodUrl && sbUrl && prodUrl === sbUrl) {
    throw new Error(
      "REFUSING: DATABASE_URL === SANDBOX_DATABASE_URL. Production and sandbox must be different databases.",
    );
  }
}

// ── PROD CLIENT — READ-ONLY. Only findMany/count are called on this. ─────────
const prod = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// ── SANDBOX CLIENT — the guarded writer. Throws (before any row) if the target
//    is not a validated sandbox DB, and requires --confirm. ──────────────────
const { prisma: sb } = sandboxClient();

// ── Batch reader — pull a prod table in id-ordered pages so we never hold the
//    whole table (prod has thousands of leads / calls) in memory at once. ────
const BATCH = 1000;

/**
 * Stream a prod model in ascending-id batches, applying `perRow` to build the
 * sandbox `data`, then `createMany` (skipDuplicates) into the sandbox. Returns
 * the number of rows written. READ side hits `prod` (findMany only); WRITE side
 * hits `sb`. `where` lets a caller scope the prod read (unused today).
 */
// Minimal structural views of the Prisma delegates we use. Typed with `any`
// args (Prisma's real findMany/createMany arg types are richly generic and won't
// structurally match a hand-written narrow type) but a PRECISE row/return type,
// so the `perRow` mapper — where field correctness actually matters — stays fully
// type-checked. A Prisma delegate is assignable to these because its findMany
// returns a PrismaPromise<TRow[]> (a Promise<TRow[]>) and accepts our args.
interface ReadDelegate<TRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany(args: any): Promise<TRow[]>;
}
interface WriteDelegate<TData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createMany(args: { data: TData[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
}

/**
 * Stream a prod model in ascending-id batches, applying `perRow` to build the
 * sandbox `data`, then `createMany` (skipDuplicates) into the sandbox. Returns
 * the number of rows written. READ side hits `prod` (findMany only); WRITE side
 * hits `sb`. `where` lets a caller scope the prod read (unused today).
 */
async function copyModel<TRow extends { id: string }, TData>(
  label: string,
  prodDelegate: ReadDelegate<TRow>,
  sbDelegate: WriteDelegate<TData>,
  perRow: (row: TRow) => TData,
  where?: unknown,
): Promise<number> {
  let cursor: string | undefined;
  let total = 0;
  for (;;) {
    // READ-ONLY prod query.
    const rows = await prodDelegate.findMany({
      where,
      orderBy: { id: "asc" },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    const data = rows.map(perRow);
    // GUARDED sandbox write.
    const res = await sbDelegate.createMany({ data, skipDuplicates: true });
    total += res.count;
    cursor = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
  }
  console.log(`   • ${label}: ${total}`);
  return total;
}

/** Parse a JSON string array of contacts (phones/emails) safely; returns []. */
function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log("🔄 Prod → Sandbox anonymized refresh starting…\n");
  console.log("   (prod client is READ-ONLY; every write goes through the sandbox guard)\n");

  // ── WIPE the tables we load, FK-safe (children → parents). Makes the refresh
  //    idempotent. Safe because `sb` is guaranteed sandbox-only by the guard. ──
  console.log("🧹 Wiping sandbox tables we load (FK-safe order)…");
  // GENERATED demo rows (leaf tables that reference User/Lead) — clear FIRST so
  // the Notifications + AI steps below re-seed cleanly on every refresh.
  await sb.aiAnalysis.deleteMany();
  await sb.notification.deleteMany();
  // Buyer children → BuyerRecord
  await sb.buyerActivity.deleteMany();
  await sb.buyerAssignment.deleteMany();
  // Lead children
  await sb.activity.deleteMany();
  await sb.callLog.deleteMany(); // references BOTH Lead and BuyerRecord — clear before either
  await sb.note.deleteMany();
  await sb.whatsAppMessage.deleteMany();
  await sb.leadInterestedProject.deleteMany();
  await sb.assignment.deleteMany();
  // Parents
  await sb.buyerRecord.deleteMany();
  await sb.lead.deleteMany();
  await sb.project.deleteMany();
  // Users last (everything above referenced them).
  await sb.user.deleteMany();
  console.log("   done.\n");

  const copied: Record<string, number> = {};
  const pw = await bcrypt.hash("Sandbox@123", 10);

  // ── USERS ──────────────────────────────────────────────────────────────────
  // Keep id/role/team/active/isSuperAdmin/managerId/avatarColor; anonymize
  // name/email/phone; reset every passwordHash to Sandbox@123.
  // NOTE: managerId is a self-FK. createMany can't defer it, and a manager may
  // sort after their report by id. So we NULL managerId on insert, then restore
  // it in a second pass once all users exist (only for managers we actually
  // copied — dangling refs are dropped).
  const prodUsers = await prod.user.findMany({ orderBy: { id: "asc" } });
  const copiedUserIds = new Set(prodUsers.map((u) => u.id));
  {
    let n = 0;
    for (let i = 0; i < prodUsers.length; i += BATCH) {
      const slice = prodUsers.slice(i, i + BATCH);
      const res = await sb.user.createMany({
        data: slice.map((u) => ({
          id: u.id,
          email: fakeEmail(u.id),
          name: fakeName(u.id),
          passwordHash: pw,
          role: u.role,
          team: u.team,
          phone: u.phone ? fakePhone(u.id, u.team === "India" ? "IN" : u.team === "Dubai" ? "AE" : undefined) : null,
          avatarColor: u.avatarColor,
          active: u.active,
          isSuperAdmin: u.isSuperAdmin,
          hrOnly: u.hrOnly,
          hrTeam: u.hrTeam,
          canControlConversations: u.canControlConversations,
          leadOpsOnly: u.leadOpsOnly,
          weeklyOff: u.weeklyOff,
          createdAt: u.createdAt,
          // managerId restored in the second pass below.
        })),
        skipDuplicates: true,
      });
      n += res.count;
    }
    copied.users = n;
    // Second pass — restore self-referential managerId now that all rows exist.
    for (const u of prodUsers) {
      if (u.managerId && copiedUserIds.has(u.managerId)) {
        await sb.user.update({ where: { id: u.id }, data: { managerId: u.managerId } });
      }
    }
  }

  // Ensure at least one demo SUPER-ADMIN exists so interns get full-UI access.
  const haveSuperAdmin = prodUsers.some((u) => u.isSuperAdmin && u.active);
  if (!haveSuperAdmin) {
    await sb.user.create({
      data: {
        email: "sandbox.admin@demo-crm.local",
        name: "Sandbox Admin",
        passwordHash: pw,
        role: "ADMIN",
        isSuperAdmin: true,
        team: "Dubai",
        avatarColor: "bg-amber-500",
        active: true,
      },
    });
    copied.users += 1;
    console.log("   • (no super-admin copied → created sandbox.admin@demo-crm.local / Sandbox@123)");
  }
  console.log(`   • User: ${copied.users}`);

  // ── PROJECT ──────────────────────────────────────────────────────────────
  // Public developments (not PII) — copy verbatim (keep real names/developer).
  copied.project = await copyModel(
    "Project",
    prod.project,
    sb.project,
    (p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      developer: p.developer,
      city: p.city,
      area: p.area,
      country: p.country,
      active: p.active,
      status: p.status,
      handoverDate: p.handoverDate,
      description: p.description,
      brochureUrl: p.brochureUrl,
      imageUrl: p.imageUrl,
      heroColor: p.heroColor,
      rera: p.rera,
      category: p.category,
      source: p.source,
      syncedAt: p.syncedAt,
      createdAt: p.createdAt,
    }),
  );

  // ── LEAD ───────────────────────────────────────────────────────────────────
  // Anonymize every identity/contact/free-text/money field; KEEP status, source,
  // origin, ownership, team/market, dates, flags, projectName (public), enums.
  copied.lead = await copyModel(
    "Lead",
    prod.lead,
    sb.lead,
    (l) => {
      // Region hint for realistic phones (India vs UAE market).
      const region: "IN" | "AE" | undefined =
        l.market === "India" ? "IN" : l.market === "UAE" ? "AE" : undefined;
      const convoCtx = { project: l.preferredLocation ?? null, budget: l.budgetMin ?? l.budgetMax ?? null };
      return {
        id: l.id,
        // ── PII → fakes ──
        name: fakeName(l.id),
        altName: l.altName ? fakeName(`${l.id}:alt`) : null,
        phone: l.phone ? fakePhone(l.id, region) : null,
        altPhone: l.altPhone ? fakePhone(`${l.id}:alt`, region) : null,
        email: l.email ? fakeEmail(l.id) : null,
        altEmail: l.altEmail ? fakeEmail(`${l.id}:alt`) : null,
        address: l.address ? fakeFreeText(`${l.id}:addr`, convoCtx) : null,
        // Free-text conversation / remark blobs → realistic notes (internally
        // consistent — weave in the lead's own preferred location + budget band).
        remarks: l.remarks ? fakeConversation(l.id, convoCtx) : null,
        rawRemarks: l.rawRemarks ? fakeConversation(`${l.id}:raw`, convoCtx) : null,
        notesShort: l.notesShort ? fakeMessage(`${l.id}:short`) : null,
        whoIsClient: l.whoIsClient ? fakeConversation(`${l.id}:who`, convoCtx) : null,
        needSummary: l.needSummary ? fakeMessage(`${l.id}:need`) : null,
        todoNext: l.todoNext ? fakeMessage(`${l.id}:todo`) : null,
        detailShared: l.detailShared ? fakeMessage(`${l.id}:detail`) : null,
        bantReason: l.bantReason ? fakeMessage(`${l.id}:bant`) : null,
        eoiNotes: l.eoiNotes ? fakeMessage(`${l.id}:eoi`) : null,
        authorityPerson: l.authorityPerson, // "Self"/"Wife"/"Parents" — role, not identity → keep
        company: l.company ? fakeFreeText(`${l.id}:co`, convoCtx) : null, // employer can identify → fake (kept realistic)
        designation: l.designation, // generic job title — keep
        referralName: l.referralName ? fakeName(`${l.id}:ref`) : null,
        alreadyBought: l.alreadyBought, // project names (public) — keep
        alreadyBoughtBy: l.alreadyBoughtBy ? fakeName(`${l.id}:boughtby`) : null,
        // Money → same currency band, fake figure.
        budgetMin: l.budgetMin != null ? fakeBudget(l.budgetMin, `${l.id}:bmin`) : null,
        budgetMax: l.budgetMax != null ? fakeBudget(l.budgetMax, `${l.id}:bmax`) : null,
        budgetCurrency: l.budgetCurrency, // required — KEEP (never convert)
        budgetRaw: l.budgetRaw ? `${l.budgetCurrency ?? ""} (sandbox)`.trim() : null,
        // NOTE: rawImport / customFields / rawRemarks-in-JSON can carry verbatim
        // PII from the original sheet → DROP them entirely (set null) rather than
        // risk leaking a real name/phone buried in the raw row.
        rawImport: undefined,
        customFields: undefined,
        // ── Structure / enums / dates / flags — KEEP verbatim ──
        source: l.source,
        sourceDetail: l.sourceDetail,
        sourceRaw: l.sourceRaw,
        medium: l.medium,
        mediumOther: l.mediumOther,
        status: l.status,
        currentStatus: l.currentStatus,
        originalSheetStatus: l.originalSheetStatus,
        configuration: l.configuration,
        propertyType: l.propertyType,
        tags: l.tags,
        categorization: l.categorization,
        language: l.language,
        clientType: l.clientType,
        whenCanInvest: l.whenCanInvest,
        potential: l.potential,
        fundReadiness: l.fundReadiness,
        moodStatus: l.moodStatus,
        bantStatus: l.bantStatus,
        authorityLevel: l.authorityLevel,
        profession: l.profession,
        nationality: l.nationality,
        preferredLocation: l.preferredLocation,
        city: l.city,
        state: l.state,
        country: l.country,
        locationManual: l.locationManual,
        // scheduling / AI (aiSummary/aiNextAction are model-generated, non-PII by
        // nature, but may echo client text → regenerate a neutral line).
        meetingDate: l.meetingDate,
        siteVisitDate: l.siteVisitDate,
        followupDate: l.followupDate,
        aiScore: l.aiScore,
        aiScoreValue: l.aiScoreValue,
        aiSummary: l.aiSummary ? fakeMessage(`${l.id}:aisum`) : null,
        aiNextAction: l.aiNextAction ? fakeMessage(`${l.id}:aiact`) : null,
        aiUpdatedAt: l.aiUpdatedAt,
        // ownership + routing
        ownerId: l.ownerId,
        customerId: undefined, // don't carry the Customer graph (not loaded here)
        forwardedTeam: l.forwardedTeam,
        market: l.market,
        assignedAt: l.assignedAt,
        routingMethod: l.routingMethod,
        routingSource: l.routingSource,
        routingReason: l.routingReason,
        leadOrigin: l.leadOrigin,
        // SLA / manager / cold
        slaFirstCallBy: l.slaFirstCallBy,
        slaEscalated: l.slaEscalated,
        needsManagerReview: l.needsManagerReview,
        managerReviewReason: l.managerReviewReason,
        flaggedAt: l.flaggedAt,
        isColdCall: l.isColdCall,
        coldCallReason: l.coldCallReason,
        // dedupe
        fingerprint: l.fingerprint,
        duplicateCount: l.duplicateCount,
        lastDuplicateAt: l.lastDuplicateAt,
        // import provenance (keep the batch id string; batch table not loaded)
        importBatchId: undefined, // FK → ImportBatch (not loaded) — drop to avoid dangling FK
        deletedAt: l.deletedAt,
        deletedById: l.deletedById,
        followupReminderSentAt: l.followupReminderSentAt,
        // rejection / revival
        rejectionReason: l.rejectionReason,
        rejectionNote: l.rejectionNote ? fakeMessage(`${l.id}:rejnote`) : null,
        rejectedAt: l.rejectedAt,
        rejectedById: l.rejectedById,
        previousOwnerId: l.previousOwnerId,
        reEngageAt: l.reEngageAt,
        reEngageOwnerId: l.reEngageOwnerId,
        // EOI / booking (statuses + dates — keep; amounts scrubbed)
        eoiStage: l.eoiStage,
        eoiAmount: l.eoiAmount != null ? Math.round(fakeBudget(l.eoiAmount, `${l.id}:eoiamt`)) : null,
        eoiCurrency: l.eoiCurrency,
        eoiPaymentMethod: l.eoiPaymentMethod,
        eoiCollectedAt: l.eoiCollectedAt,
        kycStatus: l.kycStatus,
        kycReceivedAt: l.kycReceivedAt,
        bookingFormStatus: l.bookingFormStatus,
        bookingFormSentAt: l.bookingFormSentAt,
        bookingFormSignedAt: l.bookingFormSignedAt,
        paymentProofStatus: l.paymentProofStatus,
        paymentProofReceivedAt: l.paymentProofReceivedAt,
        developerConfirmationStatus: l.developerConfirmationStatus,
        developerConfirmedAt: l.developerConfirmedAt,
        bookingDoneAt: l.bookingDoneAt,
        commissionAmount: l.commissionAmount != null ? Math.round(fakeBudget(l.commissionAmount, `${l.id}:comm`)) : null,
        commissionCurrency: l.commissionCurrency,
        commissionStatus: l.commissionStatus,
        commissionReceivedAt: l.commissionReceivedAt,
        eoiApprovalRequired: l.eoiApprovalRequired,
        eoiApprovedById: l.eoiApprovedById,
        eoiApprovedAt: l.eoiApprovedAt,
        // conditional source
        eventName: l.eventName,
        eventCountry: l.eventCountry,
        eventState: l.eventState,
        eventCity: l.eventCity,
        // timestamps
        lastTouchedAt: l.lastTouchedAt,
        createdAt: l.createdAt,
      };
    },
  );

  // ── ASSIGNMENT (audit history for owned leads) ──────────────────────────────
  // No identity PII; keep structure. reason can be free-text → keep (it's
  // "round-robin"/"manual"/"rule:*", operational not personal).
  copied.assignment = await copyModel(
    "Assignment",
    prod.assignment,
    sb.assignment,
    (a) => ({
      id: a.id,
      leadId: a.leadId,
      userId: a.userId,
      reason: a.reason,
      assignedAt: a.assignedAt,
    }),
  );

  // ── ACTIVITY (timeline) ─────────────────────────────────────────────────────
  // description/title may hold conversation text → anonymize. KEEP type, status,
  // scheduledAt/completedAt, outcome (enum-ish label), reminder flags, expo fields.
  copied.activity = await copyModel(
    "Activity",
    prod.activity,
    sb.activity,
    (a) => ({
      id: a.id,
      leadId: a.leadId,
      userId: a.userId,
      type: a.type,
      status: a.status,
      // Titles like "Lead created from Website" are fine to keep, but titles can
      // also echo a client name → replace with a neutral realistic line.
      title: a.title ? fakeMessage(`${a.id}:title`) : "Activity",
      description: a.description ? fakeConversation(`${a.id}:desc`) : null,
      scheduledAt: a.scheduledAt,
      completedAt: a.completedAt,
      outcome: a.outcome, // "Connected"/"Not Picked"/… label — keep
      followupDate: a.followupDate,
      actionContext: a.actionContext,
      attendedByUserId: a.attendedByUserId,
      additionalAttendees: a.additionalAttendees,
      rescheduledCount: a.rescheduledCount,
      isNoShow: a.isNoShow,
      startedAt: a.startedAt,
      startedLat: a.startedLat,
      startedLng: a.startedLng,
      endedAt: a.endedAt,
      endedLat: a.endedLat,
      endedLng: a.endedLng,
      locationTrack: a.locationTrack,
      reminderSentAt: a.reminderSentAt,
      reminderSentAt1h: a.reminderSentAt1h,
      // expo / dubai visit fields — venue/developer are public, but the developer
      // salesperson + our contact are people → anonymize those two.
      expoCity: a.expoCity,
      expoHotel: a.expoHotel,
      expoDeveloper: a.expoDeveloper,
      expoDeveloperContact: a.expoDeveloperContact ? fakeName(`${a.id}:expocontact`) : null,
      expoAgentAttended: a.expoAgentAttended,
      dubaiDeveloperSalesperson: a.dubaiDeveloperSalesperson ? fakeName(`${a.id}:dubaisales`) : null,
      cabScheduled: a.cabScheduled,
      decisionInOffice: a.decisionInOffice,
      distanceKm: a.distanceKm,
      reimbursementAmount: a.reimbursementAmount,
      createdAt: a.createdAt,
    }),
  );

  // ── CALLLOG ─────────────────────────────────────────────────────────────────
  // notes → fake; phoneNumber → fake; recordingUrl → null (attachments hidden);
  // attributedAgentName → fake name; KEEP outcome, direction, durationSec, dates,
  // ivrProvider/ivrCallId/accountId (operational metadata, non-PII).
  copied.callLog = await copyModel(
    "CallLog",
    prod.callLog,
    sb.callLog,
    (c) => ({
      id: c.id,
      leadId: c.leadId,
      buyerId: c.buyerId,
      userId: c.userId,
      direction: c.direction,
      phoneNumber: fakePhone(c.id, undefined),
      durationSec: c.durationSec,
      outcome: c.outcome, // required enum — keep
      notes: c.notes ? fakeMessage(`${c.id}:notes`) : null,
      attributedAgentName: c.attributedAgentName ? fakeName(`${c.id}:agent`) : null,
      ivrProvider: c.ivrProvider,
      ivrCallId: c.ivrCallId, // @unique; fresh DB so no collision; non-PII
      ivrAccountId: c.ivrAccountId,
      recordingUrl: null, // NEVER copy recordings
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      createdAt: c.createdAt,
    }),
  );

  // ── NOTE ────────────────────────────────────────────────────────────────────
  // body/voiceOriginal are free-text → anonymize.
  copied.note = await copyModel(
    "Note",
    prod.note,
    sb.note,
    (n) => ({
      id: n.id,
      leadId: n.leadId,
      userId: n.userId,
      body: fakeConversation(`${n.id}:body`),
      voiceOriginal: n.voiceOriginal ? fakeMessage(`${n.id}:voice`) : null,
      createdAt: n.createdAt,
    }),
  );

  // ── WHATSAPPMESSAGE ─────────────────────────────────────────────────────────
  // body → fake message; phoneNumber → fake; KEEP direction/timestamps/actor.
  // providerMsgId is @unique — keep (fresh DB, no collision; it's an opaque id).
  copied.whatsAppMessage = await copyModel(
    "WhatsAppMessage",
    prod.whatsAppMessage,
    sb.whatsAppMessage,
    (w) => ({
      id: w.id,
      leadId: w.leadId,
      phoneNumber: fakePhone(w.id, undefined),
      direction: w.direction,
      body: fakeMessage(`${w.id}:body`),
      templateId: w.templateId,
      providerMsgId: w.providerMsgId,
      actorUserId: w.actorUserId,
      receivedAt: w.receivedAt,
    }),
  );

  // ── LEADINTERESTEDPROJECT ───────────────────────────────────────────────────
  // Links lead↔project; only free-text is `notes`/`sourceText` → anonymize those.
  copied.leadInterestedProject = await copyModel(
    "LeadInterestedProject",
    prod.leadInterestedProject,
    sb.leadInterestedProject,
    (p) => ({
      id: p.id,
      leadId: p.leadId,
      projectId: p.projectId,
      notes: p.notes ? fakeMessage(`${p.id}:notes`) : null,
      autoDetected: p.autoDetected,
      sourceType: p.sourceType,
      sourceDate: p.sourceDate,
      sourceText: p.sourceText ? fakeMessage(`${p.id}:src`) : null,
      suggestion: p.suggestion,
      interestedAt: p.interestedAt,
    }),
  );

  // ── BUYERRECORD ─────────────────────────────────────────────────────────────
  // clientName/coBuyers/phones/emails/passport/ownerName → fakes; notes/remarks →
  // fake conversation; transactionValue/pricePerSqFt → fake budget; KEEP
  // poolStatus, ownerId, market, projectName, developer, transactionDate/type,
  // attemptCount, businessStatus, configuration, area, etc. rawImport/extraFields
  // dropped (verbatim sheet PII risk).
  copied.buyerRecord = await copyModel(
    "BuyerRecord",
    prod.buyerRecord,
    sb.buyerRecord,
    (b) => {
      const region: "IN" | "AE" | undefined =
        b.market === "India" ? "IN" : b.market === "Dubai" || b.country === "UAE" ? "AE" : undefined;
      const phones = parseJsonArray(b.phones).map((_, idx) => fakePhone(`${b.id}:ph${idx}`, region));
      const emails = parseJsonArray(b.emails).map((_, idx) => fakeEmail(`${b.id}:em${idx}`));
      const coBuyers = parseJsonArray(b.coBuyerNames).map((_, idx) => fakeName(`${b.id}:co${idx}`));
      const convoCtx = { project: b.projectName ?? null, budget: b.transactionValue ?? null };
      return {
        id: b.id,
        clientName: fakeName(b.id),
        coBuyerNames: b.coBuyerNames ? JSON.stringify(coBuyers) : null,
        phones: b.phones ? JSON.stringify(phones.length ? phones : [fakePhone(b.id, region)]) : null,
        emails: b.emails ? JSON.stringify(emails.length ? emails : [fakeEmail(b.id)]) : null,
        passport: b.passport ? fakePassport(b.id) : null,
        nationality: b.nationality,
        passportExpiry: b.passportExpiry ? "01/01/2030" : null, // scrub verbatim expiry text
        ownerName: b.ownerName ? fakeName(`${b.id}:owner`) : null,
        country: b.country,
        developer: b.developer, // public
        projectName: b.projectName, // public
        tower: b.tower,
        unitNumber: b.unitNumber,
        propertyType: b.propertyType,
        configuration: b.configuration,
        size: b.size,
        actualSize: b.actualSize,
        area: b.area,
        transactionValue: b.transactionValue != null ? fakeBudget(b.transactionValue, `${b.id}:txn`) : null,
        pricePerSqFt: b.pricePerSqFt != null ? fakeBudget(b.pricePerSqFt, `${b.id}:psf`) / 1000 : null,
        transactionDate: b.transactionDate,
        transactionId: b.transactionId ? `SBX-${b.id.slice(-8)}` : null, // scrub real deal ref
        transactionType: b.transactionType,
        role: b.role,
        agentName: b.agentName ? fakeName(`${b.id}:agent`) : null,
        source: b.source,
        sourceFile: b.sourceFile,
        extraFields: undefined, // verbatim sheet columns → drop (PII risk)
        rawImport: undefined, // verbatim import row → drop (PII risk)
        buyerKey: b.buyerKey, // hash — non-PII, keep for rollup demo
        market: b.market,
        createdAt: b.createdAt,
        importBatchId: undefined, // FK → BuyerImportBatch (not loaded) — drop
        // lifecycle / pipeline
        ownerId: b.ownerId,
        assignedAt: b.assignedAt,
        poolStatus: b.poolStatus,
        businessStatus: b.businessStatus,
        followupDate: b.followupDate,
        attemptCount: b.attemptCount,
        remarks: b.remarks ? fakeConversation(`${b.id}:rem`, convoCtx) : null,
        convertedLeadId: b.convertedLeadId, // Lead is loaded above → FK stays valid
        convertedAt: b.convertedAt,
        convertedById: b.convertedById,
        rejectedAt: b.rejectedAt,
        rejectedById: b.rejectedById,
        rejectionReason: b.rejectionReason,
        rejectCategory: b.rejectCategory,
        aiEligibleForRevival: b.aiEligibleForRevival,
        returnedToPoolAt: b.returnedToPoolAt,
        deletedAt: b.deletedAt,
        deletedById: b.deletedById,
      };
    },
  );

  // ── BUYERASSIGNMENT (stint history) ─────────────────────────────────────────
  // No identity PII; keep structure verbatim.
  copied.buyerAssignment = await copyModel(
    "BuyerAssignment",
    prod.buyerAssignment,
    sb.buyerAssignment,
    (a) => ({
      id: a.id,
      buyerId: a.buyerId,
      userId: a.userId,
      assignedAt: a.assignedAt,
      assignedById: a.assignedById,
      returnedAt: a.returnedAt,
      returnReason: a.returnReason,
      attemptsInStint: a.attemptsInStint,
      createdAt: a.createdAt,
    }),
  );

  // ── BUYERACTIVITY (buyer timeline) ──────────────────────────────────────────
  // description is free-text → anonymize; KEEP type + dates.
  copied.buyerActivity = await copyModel(
    "BuyerActivity",
    prod.buyerActivity,
    sb.buyerActivity,
    (a) => ({
      id: a.id,
      buyerId: a.buyerId,
      userId: a.userId,
      type: a.type,
      description: a.description ? fakeConversation(`${a.id}:desc`) : null,
      createdAt: a.createdAt,
    }),
  );

  // ── GENERATED DEMO CONTENT (Notifications + AI) ─────────────────────────────
  // These two modules have NO prod rows worth anonymizing (Notification bodies /
  // AiAnalysis.resultJson would carry verbatim client text + real AI cost), so
  // instead of copying prod we GENERATE realistic sample rows straight into the
  // sandbox. Everything below writes ONLY through `sb`, is fully deterministic
  // (seeded by ids / indices — no Math.random / Date.now), and is idempotent with
  // the wipe above. Content references the already-anonymized copied lead names so
  // the demo notifications/analyses read consistently with the rest of the sandbox.

  // Pull back the ids we just copied (the copyModel helper returns only counts).
  // Small selects — id + the couple of fields we weave into realistic text.
  const sbUsers = await sb.user.findMany({
    where: { active: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const sbLeads = await sb.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, ownerId: true, preferredLocation: true, followupDate: true },
    orderBy: { id: "asc" },
    take: 400, // enough to source varied names; we only use a slice per user
  });

  // Deterministic base timestamp (NO Date.now): anchor to the newest copied lead's
  // follow-up date if present, else a fixed sandbox epoch. `new Date(base + …)` is
  // allowed by the determinism rule; the offset is derived from row indices only.
  const EPOCH = new Date("2026-07-04T09:00:00.000Z").getTime();
  const HOUR = 3_600_000;

  // ── NOTIFICATIONS (~2–3 per sandbox user, mixed kinds) ──────────────────────
  // Each row traces to a real copied record (sourceType/sourceId) exactly as the
  // production notify() helper requires. kind = NotifKind enum; sourceType =
  // NotifSourceType (src/lib/notifSource.ts). createdById is null (system-fired).
  if (sbUsers.length > 0 && sbLeads.length > 0) {
    // 3 canned templates; index i picks which subset each user gets so the mix
    // varies but stays deterministic. Each template names a copied (fake) lead.
    const templates: {
      kind: "REMINDER" | "BUYER_ASSIGNED" | "SYSTEM";
      severity: "INFO" | "WARNING";
      sourceType: "FOLLOWUP" | "ASSIGNMENT" | "SITE_VISIT";
      title: (leadName: string) => string;
      body: (leadName: string, loc: string | null) => string;
      link: (leadId: string) => string;
      hourOffset: number;
    }[] = [
      {
        kind: "REMINDER",
        severity: "INFO",
        sourceType: "FOLLOWUP",
        title: (n) => `☎ Follow-up with ${n} in 10 min`,
        body: (n, loc) => `Scheduled follow-up call with ${n}${loc ? ` about ${loc}` : ""}. Open the lead to log the outcome.`,
        link: (id) => `/leads/${id}`,
        hourOffset: 0,
      },
      {
        kind: "BUYER_ASSIGNED",
        severity: "INFO",
        sourceType: "ASSIGNMENT",
        title: () => `🏷️ 3 buyers assigned to you`,
        body: (n) => `A new batch of buyer records is in your pool — first up: ${n}. Start dialling from the Buyer Data tab.`,
        link: () => `/buyer-data`,
        hourOffset: 2,
      },
      {
        kind: "REMINDER",
        severity: "WARNING",
        sourceType: "SITE_VISIT",
        title: () => `🔔 Site visit in 30 min`,
        body: (n, loc) => `Site visit with ${n}${loc ? ` at ${loc}` : ""} starts soon. Confirm the meeting point and share the location.`,
        link: (id) => `/leads/${id}`,
        hourOffset: 4,
      },
    ];

    let notifCount = 0;
    for (let u = 0; u < sbUsers.length; u++) {
      const user = sbUsers[u];
      // 2–3 notifications per user (deterministic: even index → 3, odd → 2).
      const perUser = u % 2 === 0 ? 3 : 2;
      for (let k = 0; k < perUser; k++) {
        const t = templates[(u + k) % templates.length];
        // Pick a copied lead deterministically to source the notification from.
        const lead = sbLeads[(u * 3 + k) % sbLeads.length];
        const when = new Date(EPOCH - (u * perUser + k) * HOUR);
        await sb.notification.create({
          data: {
            userId: user.id,
            kind: t.kind,
            severity: t.severity,
            title: t.title(lead.name),
            body: t.body(lead.name, lead.preferredLocation),
            linkUrl: t.link(lead.id),
            leadId: t.sourceType === "ASSIGNMENT" ? null : lead.id,
            // Source tracking — points at the exact copied record it "fired" from.
            sourceType: t.sourceType,
            sourceId: lead.id,
            createdById: null, // system/cron-fired demo rows
            // Roughly half read, half unread (deterministic) for a lifelike inbox.
            readAt: (u + k) % 2 === 0 ? null : when,
            createdAt: when,
          },
        });
        notifCount++;
      }
    }
    copied.notification = notifCount;
    console.log(`   • Notification (generated): ${notifCount}`);
  }

  // ── AI (AiAnalysis) — ~1 per some leads, capped ~15 ─────────────────────────
  // Canned, realistic analyses. NO AI API call. model = "sandbox-canned", zero
  // tokens/cost. resultJson is a valid (minimal) AiAnalysisResult so the Lead AI
  // panel renders summary / recommended next action / lead quality without error.
  {
    const AI_CAP = 15;
    // Deterministic sample: every Nth lead up to the cap (skip leads with no owner
    // so the panel's owner-scoped view has something to show).
    const aiLeads = sbLeads.filter((l) => l.ownerId).filter((_, i) => i % 5 === 0).slice(0, AI_CAP);

    const qualities = ["Hot", "Warm", "Cold"] as const;
    const probabilities = ["High", "Medium", "Low"] as const;
    let aiCount = 0;
    for (let i = 0; i < aiLeads.length; i++) {
      const l = aiLeads[i];
      const quality = qualities[i % qualities.length];
      const prob = probabilities[i % probabilities.length];
      const loc = l.preferredLocation ?? "a Dubai project";
      // Minimal but structurally-valid result payload (the UI reads these keys).
      const result = {
        summary: `${l.name} is a ${quality.toLowerCase()} lead interested in ${loc}. Budget and timeline look consistent with recent conversations; keep the momentum with a timely follow-up. (Sandbox demo analysis — not from a real AI run.)`,
        fieldExtraction: {},
        scheduling: {
          recommendedNextAction:
            quality === "Hot"
              ? `Call ${l.name} today and offer a site visit slot this week.`
              : quality === "Warm"
                ? `Send ${l.name} a shortlist for ${loc} and schedule a follow-up call.`
                : `Nurture ${l.name} with a monthly market update; revisit in 30 days.`,
          recommendedFollowUpDate: null,
          reason: `Classified ${quality} based on engagement and stated interest in ${loc}.`,
          confidence: 60 + (i % 4) * 10,
          sourceRemark: null,
        },
        leadQuality: {
          classification: quality,
          closingProbability: prob,
          reason: `Interest in ${loc} with a workable budget band.`,
          biggestBlocker: quality === "Cold" ? "Timeline is undecided." : null,
          missingInfo: [],
          whyNotClosed: null,
          leadStatus: quality === "Cold" ? "LongTermFollowUp" : "Active",
        },
        objections: [],
      };
      const when = new Date(EPOCH - i * HOUR);
      await sb.aiAnalysis.create({
        data: {
          leadId: l.id,
          triggeredBy: "manual",
          triggeredById: l.ownerId, // the copied owner "ran" it
          resultJson: JSON.stringify(result),
          model: "sandbox-canned",
          inputTokens: 0,
          outputTokens: 0,
          costMicroUsd: 0,
          ok: true,
          error: null,
          createdAt: when,
        },
      });
      aiCount++;
    }
    copied.aiAnalysis = aiCount;
    console.log(`   • AiAnalysis (generated): ${aiCount}`);
  }

  // ── SKIPPED (on purpose) ────────────────────────────────────────────────────
  //   • Voice / recordings (LeadVoiceMessage.audioData bytea, recordingUrl) — never
  //     copy real audio; the empty tables are fine for the anonymized snapshot.
  //   • Attachments / documents / resume bytea — not copied.
  //   • Customer identity-resolution graph, ImportBatch/BuyerImportBatch, HR, audit
  //     logs — out of scope for this PII refresh (FKs to them are nulled above).

  // ── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log("\n✅ Anonymized prod → sandbox refresh complete.\n");
  console.log("   Login: any copied user @ their (fake) email, password  Sandbox@123");
  console.log("          (a super-admin is guaranteed — sandbox.admin@demo-crm.local if none copied)\n");
  console.log("   Rows copied per model:");
  for (const [k, v] of Object.entries(copied)) {
    console.log(`     ${k.padEnd(24, ".")} ${v}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Disconnect BOTH clients.
    await prod.$disconnect();
    await sb.$disconnect();
  });
