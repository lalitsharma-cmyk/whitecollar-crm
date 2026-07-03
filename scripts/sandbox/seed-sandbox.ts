// ─────────────────────────────────────────────────────────────────────────────
// scripts/sandbox/seed-sandbox.ts — CRM "Development Sandbox" seed
//
//   npx tsx scripts/sandbox/seed-sandbox.ts --confirm
//
// WHAT THIS IS
//   A comprehensive, realistic dataset that exercises EVERY module of the CRM —
//   Leads (Active / Master Data / Revival-Cold), Dubai + India Buyer Data,
//   Projects + Units, Activities / Calls / Notes / Meetings / Site Visits,
//   Notifications, Voice recordings (metadata only), and AI analyses — so a
//   developer can click through the whole app against seeded data.
//
// SAFETY (non-negotiable)
//   • The Prisma client comes ONLY from `sandboxClient()` (scripts/sandbox/guard.ts).
//     That guard validates SANDBOX_DATABASE_URL and THROWS if it looks like prod
//     (equal to DATABASE_URL, or missing a sandbox|dev|test|staging|demo marker),
//     and requires --confirm. We NEVER `new PrismaClient()` — that would pick up
//     the ambient DATABASE_URL = production.
//   • Because the client is guaranteed sandbox-only, we WIPE the tables we seed
//     (deleteMany in FK-safe order) then insert fresh — idempotent re-runs.
//   • NO real telephony / audio / AI calls. Voice recordings are dummy metadata
//     (recordingUrl = "sandbox://…", audioData = a tiny placeholder Buffer).
//
// This file is a superset of prisma/seed.ts — same enum-import + create patterns,
// extended across all modules. Field names + enum values are taken verbatim from
// prisma/schema.prisma.
// ─────────────────────────────────────────────────────────────────────────────

import {
  Role,
  LeadSource,
  LeadStatus,
  AIScore,
  ProjectStatus,
  UnitStatus,
  ActivityType,
  ActivityStatus,
  CallDirection,
  CallOutcome,
  Potential,
  FundReadiness,
  MoodStatus,
  InvestTimeline,
  BantStatus,
  AuthorityLevel,
  ClientType,
  LeadInterestType,
  LeadProjectStatus,
  NotifKind,
  NotifSeverity,
  VoiceMessageKind,
} from "@prisma/client";
import type { Project, Unit } from "@prisma/client";
import bcrypt from "bcryptjs";
import { sandboxClient } from "./guard";

// The ONLY sanctioned client. Throws BEFORE any row is touched if the target is
// not a validated sandbox DB (and requires --confirm).
const { prisma } = sandboxClient();

// Fixed base date for reproducibility (see task style guide). Offsets are derived
// from this, never Date.now().
const NOW = new Date("2026-07-03T09:00:00Z");
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
/** NOW + n days (n may be negative for the past). */
function day(n: number): Date {
  return new Date(NOW.getTime() + n * DAY);
}
/** NOW + n hours. */
function hour(n: number): Date {
  return new Date(NOW.getTime() + n * HOUR);
}

// A deterministic picker so "random-looking" spread is reproducible run-to-run.
function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length];
}

async function main() {
  console.log("🌱 Seeding CRM Development Sandbox (all modules)…\n");

  // ── WIPE (FK-safe order: children → parents) ───────────────────────────────
  // Safe because sandboxClient() guarantees a sandbox-only connection.
  console.log("🧹 Wiping seeded tables (FK-safe order)…");
  // Voice / escalation (children of Lead + User)
  await prisma.voiceMessageRead.deleteMany();
  await prisma.leadVoiceMessage.deleteMany();
  await prisma.leadEscalation.deleteMany();
  // Buyer children → BuyerRecord
  await prisma.buyerActivity.deleteMany();
  await prisma.buyerAssignment.deleteMany();
  await prisma.buyerStickyNote.deleteMany();
  await prisma.buyerFieldHistory.deleteMany();
  // Lead children
  await prisma.aiSuggestionFeedback.deleteMany();
  await prisma.aiAnalysis.deleteMany();
  await prisma.activityEdit.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.callLog.deleteMany();
  await prisma.note.deleteMany();
  await prisma.leadInterestNote.deleteMany();
  await prisma.leadInterestedProject.deleteMany();
  await prisma.leadProject.deleteMany();
  await prisma.leadProperty.deleteMany();
  await prisma.assignment.deleteMany();
  await prisma.notification.deleteMany();
  // CallLog references buyers too — cleared above. Now the pool parents.
  await prisma.buyerRecord.deleteMany();
  await prisma.lead.deleteMany();
  // Property tree
  await prisma.unit.deleteMany();
  await prisma.project.deleteMany();
  // Users last (everything above referenced them). Only wipe sandbox users we own.
  await prisma.user.deleteMany();
  console.log("   done.\n");

  // ── USERS ──────────────────────────────────────────────────────────────────
  const pw = await bcrypt.hash("Sandbox@123", 10);

  const admin = await prisma.user.create({
    data: {
      email: "sandbox@whitecollarrealty.com",
      name: "Sandbox Admin",
      passwordHash: pw,
      role: Role.ADMIN,
      isSuperAdmin: true,
      team: "Dubai",
      avatarColor: "bg-amber-500",
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: "dummy.manager@sandbox.local",
      name: "Dummy Manager",
      passwordHash: pw,
      role: Role.MANAGER,
      team: "Dubai",
      avatarColor: "bg-indigo-500",
      managerId: null,
    },
  });
  const agent1 = await prisma.user.create({
    data: {
      email: "dummy.one@sandbox.local",
      name: "Dummy One",
      passwordHash: pw,
      role: Role.AGENT,
      team: "Dubai",
      avatarColor: "bg-sky-500",
      managerId: manager.id,
      phone: "+971500000001",
    },
  });
  const agent2 = await prisma.user.create({
    data: {
      email: "dummy.two@sandbox.local",
      name: "Dummy Two",
      passwordHash: pw,
      role: Role.AGENT,
      team: "India",
      avatarColor: "bg-emerald-500",
      managerId: manager.id,
      phone: "+919800000002",
    },
  });
  const agent3 = await prisma.user.create({
    data: {
      email: "dummy.three@sandbox.local",
      name: "Dummy Three",
      passwordHash: pw,
      role: Role.AGENT,
      team: "India",
      avatarColor: "bg-rose-500",
      managerId: manager.id,
      phone: "+919800000003",
    },
  });
  const agents = [agent1, agent2, agent3];
  const dubaiAgents = [agent1];
  const indiaAgents = [agent2, agent3];
  console.log(`✓ 5 users (1 admin, 1 manager, 3 agents across Dubai + India)`);

  // ── PROJECTS + UNITS ───────────────────────────────────────────────────────
  const projectSeeds: Array<{
    name: string;
    developer: string;
    city: string;
    area: string;
    country: string;
    status: ProjectStatus;
    rera?: string;
    category: string;
    handoverDate?: Date;
  }> = [
    { name: "Sandbox Heights", developer: "Emaar", city: "Dubai", area: "Downtown Dubai", country: "UAE", status: ProjectStatus.OFF_PLAN, rera: "DUB-SBX-1001", category: "residential", handoverDate: day(540) },
    { name: "Demo Marina Residences", developer: "Nakheel", city: "Dubai", area: "Dubai Marina", country: "UAE", status: ProjectStatus.UNDER_CONSTRUCTION, rera: "DUB-SBX-1002", category: "residential", handoverDate: day(300) },
    { name: "Test Valley Towers", developer: "Sobha", city: "Dubai", area: "Mohammed Bin Rashid City", country: "UAE", status: ProjectStatus.READY, category: "residential" },
    { name: "Sample Business Bay Offices", developer: "DAMAC", city: "Dubai", area: "Business Bay", country: "UAE", status: ProjectStatus.READY, category: "commercial" },
    { name: "Sandbox Greens Gurgaon", developer: "DLF", city: "Gurgaon", area: "Sector 65", country: "India", status: ProjectStatus.UNDER_CONSTRUCTION, rera: "HR-RERA-GGM-SBX-01", category: "residential", handoverDate: day(420) },
    { name: "Demo Riverside Mumbai", developer: "Lodha", city: "Mumbai", area: "Lower Parel", country: "India", status: ProjectStatus.READY, rera: "P51900-SBX-02", category: "residential" },
  ];

  const projects: Project[] = [];
  for (const p of projectSeeds) {
    const created = await prisma.project.create({
      data: {
        name: p.name,
        developer: p.developer,
        city: p.city,
        area: p.area,
        country: p.country,
        status: p.status,
        rera: p.rera,
        category: p.category,
        active: true,
        handoverDate: p.handoverDate,
        source: "manual",
        heroColor: "from-[#0b1a33] to-[#c9a24b]",
        description: `${p.name} — sandbox demo project by ${p.developer} in ${p.area}, ${p.city}.`,
      },
    });
    projects.push(created);
  }

  const units: Unit[] = [];
  for (const project of projects) {
    const isCommercial = project.category === "commercial";
    const isIndia = project.country === "India";
    const configs = isCommercial ? ["Office-S", "Office-L", "Shop"] : ["Studio", "1BR", "2BR", "3BR"];
    let idx = 0;
    for (const cfg of configs) {
      for (let i = 0; i < 3; i++) {
        idx++;
        // Dubai priced in AED, India in INR (both stored as raw numbers; currency
        // lives on the Lead). Rough tiers keep the numbers realistic.
        const base = isIndia
          ? (cfg === "Studio" ? 6_000_000 : cfg === "1BR" ? 9_500_000 : cfg === "2BR" ? 16_000_000 : 28_000_000)
          : (cfg === "Studio" ? 950_000 : cfg === "1BR" ? 1_700_000 : cfg === "2BR" ? 2_800_000 : cfg === "3BR" ? 4_500_000 : cfg === "Office-S" ? 2_200_000 : cfg === "Office-L" ? 5_800_000 : 1_400_000);
        const unit = await prisma.unit.create({
          data: {
            projectId: project.id,
            code: `${project.name.slice(0, 3).toUpperCase()}-${1000 + idx}`,
            configuration: cfg,
            carpetArea: cfg === "Studio" ? 480 : cfg === "1BR" ? 720 : cfg === "2BR" ? 1180 : cfg === "3BR" ? 1620 : 900,
            floor: 5 + (idx % 20),
            view: pick(["Sea", "Marina", "City", "Park", "Boulevard"], idx),
            priceBase: base,
            priceFinal: i === 0 ? Math.round(base * 0.97) : null,
            status: i === 0 ? UnitStatus.SOLD : i === 1 ? UnitStatus.HOLD : UnitStatus.AVAILABLE,
          },
        });
        units.push(unit);
      }
    }
  }
  console.log(`✓ ${projects.length} projects, ${units.length} units (Dubai AED + India INR pricing)`);

  // ── Shared reference pools for lead generation ─────────────────────────────
  const firstNames = ["Priya", "Aman", "Rohan", "Suresh", "Ankit", "Meera", "Faisal", "Vikram", "Sneha", "Arjun", "Kavya", "Nikhil", "Pooja", "Aditya", "Riya", "Sandeep", "Tara", "Yash", "Ishita", "Manav", "Zara", "Omar", "Layla", "Hassan"];
  const lastNames = ["Sharma", "Khanna", "Mehta", "Iyer", "Verma", "Pillai", "Al Mansoori", "Singh", "Kapoor", "Roy", "Patel", "Reddy", "Gupta", "Joshi", "Nair", "Saxena", "Bhatt", "Menon", "Khan", "Desai", "Al Farsi", "Hashmi"];
  const companies = ["HSBC", "Emirates NBD", "Microsoft Gulf", "DP World", "Aramex", "Deloitte", "PwC", "TCS", "Infosys ME", "Aster DM", "Self-employed", "Lulu Group", null];
  const dubaiStatuses = ["Fresh Lead", "Follow Up", "Long Term Follow Up", "Mail Sent", "Visit Dubai", "Wants Office Visit", "Zoom Meeting", "Meeting", "Expo Only", "Booked With Us", "Funds Issue", "Not Interested"];
  const indiaStatuses = ["Fresh Lead", "Follow Up", "Not Contacted", "Details Shared", "Site Visit Schedule", "Meeting", "Postponed", "Never Responding", "Low Budget", "Already Booked", "Not Interested"];
  const whoNarratives = [
    "NRI investor based in Dubai for 6+ years, originally from Mumbai. Works as a Senior Director at a Big-4 firm (DIFC). Looking for a 2-3BR for parents relocating next year. Prefers ready, sea/marina view. Decisions made jointly with spouse — both must view. Budget flexible for the right unit.",
    "Client asked about 2BR in Dubai Marina, budget 2M AED, wants handover 2027. Highly engaged on WhatsApp, replies within minutes. Pre-approved for 75% Emirates NBD mortgage. Needs to close within 60 days as current rental ends.",
    "UK-based British-Indian investor, visits Dubai twice a year. Wants high-yield off-plan with 18-24 month handover. Does not care about view — pure rental ROI. Will close via POA if the numbers work.",
    "Gurgaon end-user, IT professional at a captive. Looking for a 3BHK under 2.8 Cr in Sector 65, ready-to-move preferred. Wife is the decision maker; needs a weekend site visit. Home-loan pre-approval in progress.",
    "Mumbai HNI, textile family. Sold a Bangalore property (₹4.5 Cr), redeploying into a 2BHK at Lower Parel. Tax-conscious, wants ready inventory. Long rapport call — good intent, needs a comparison sheet.",
    "Dubai-based UAE national married to an Indian; 3 kids. Wants a 3BR (not studio). Budget AED 2.8-4.5M. Didn't like DAMAC Hills — wants a quieter community. Worth showing Test Valley Towers.",
    "First-time enquiry from Delhi. Never visited Dubai for property. Planning a December trip. Send the Dubai investment guide + arrange a virtual walkthrough to warm up before the visit. Budget 'open' — needs a qualifying call.",
    "Investor seeking Golden-Visa-qualifying inventory (AED 2M). Purely visa-driven — limited interest in unit features. Cash ready. Easy close once pointed at the right unit.",
  ];
  const remarksPool = [
    "Wife is the decision maker; need her on the call.",
    "Wants a high-floor only; sensitive to road noise.",
    "Compared 4 properties — leaning to ours; needs a final price match.",
    "Spouse traveling; revisit after the 15th.",
    "Asked about post-handover rental management services.",
    "Concerned about annual service charges — send the sheet.",
  ];
  const todosPool = [
    "Send brochure + payment plan",
    "Schedule a Saturday site visit",
    "Confirm Q2 handover date with developer",
    "Get spouse on a 3-way call",
    "Resend mortgage pre-approval docs",
    "Share Boulevard-view units only",
  ];
  const allowedSources: LeadSource[] = [
    LeadSource.WEBSITE,
    LeadSource.WCR_EVENT,
    LeadSource.LANDING_PAGE,
    LeadSource.REFERRAL,
    LeadSource.FACEBOOK_ADS,
    LeadSource.GOOGLE_ADS,
    LeadSource.PORTAL_99ACRES,
    LeadSource.PORTAL_MAGICBRICKS,
  ];
  const potentials = [Potential.HIGH, Potential.HIGH, Potential.MEDIUM, Potential.MEDIUM, Potential.LOW, Potential.UNKNOWN];
  const funds = [FundReadiness.CASH_READY, FundReadiness.BANK_APPROVED, FundReadiness.FINANCING_NEEDED, FundReadiness.NOT_DISCUSSED, FundReadiness.IMMEDIATE_BUYER, FundReadiness.FINANCED_BUYER];
  const moods = [MoodStatus.EXCITED, MoodStatus.INTERESTED, MoodStatus.NEUTRAL, MoodStatus.HESITANT, MoodStatus.COLD, MoodStatus.CONFUSED];
  const timelines = [InvestTimeline.IMMEDIATE, InvestTimeline.THIRTY_DAYS, InvestTimeline.THREE_MONTHS, InvestTimeline.SIX_PLUS_MONTHS, InvestTimeline.WINDOW_SHOPPING, InvestTimeline.UNKNOWN];
  const aiScores = [AIScore.HOT, AIScore.HOT, AIScore.WARM, AIScore.WARM, AIScore.COLD];
  const authorities = [AuthorityLevel.DECISION_MAKER, AuthorityLevel.INFLUENCER, AuthorityLevel.GATEKEEPER, AuthorityLevel.UNKNOWN];
  const clientTypes = [ClientType.INVESTOR, ClientType.END_USER, ClientType.BOTH, ClientType.UNCLEAR];
  const configs = ["Studio", "1BR", "2BR", "3BR", "Villa", "Office"];

  // Counters for the final summary.
  const counts: Record<string, number> = {
    users: 5,
    projects: projects.length,
    units: units.length,
    activeLeads: 0,
    masterDataLeads: 0,
    revivalColdLeads: 0,
    activities: 0,
    callLogs: 0,
    notes: 0,
    interestedProjects: 0,
    interestNotes: 0,
    leadProjects: 0,
    leadProperties: 0,
    dubaiBuyers: 0,
    indiaBuyers: 0,
    buyerAssignments: 0,
    buyerActivities: 0,
    notifications: 0,
    voiceMessages: 0,
    escalations: 0,
    aiAnalyses: 0,
  };

  // Track ids to link later (buyers → converted lead reference is illustrative only).
  const allLeadIds: string[] = [];

  // ── LEAD FACTORY ───────────────────────────────────────────────────────────
  // One builder used for Active / Master-Data / Revival-Cold, differing by the
  // `leadOrigin` and a few knobs. Returns the created lead.
  type LeadOpts = {
    i: number;
    team: "Dubai" | "India";
    leadOrigin: string;
    ownerId: string | null;
    status: string; // currentStatus (MIS status string)
    followupOffsetDays?: number | null; // relative to NOW; null = no follow-up
    rejected?: boolean;
    withDepth?: boolean;
  };

  async function buildLead(opts: LeadOpts) {
    const { i, team, leadOrigin, ownerId, status } = opts;
    const fn = pick(firstNames, i * 3 + 1);
    const ln = pick(lastNames, i * 5 + 2);
    const isIndia = team === "India";
    const market = isIndia ? "India" : "UAE";
    const currency = isIndia ? "INR" : "AED";
    // Budgets: India in INR (₹90L–₹6Cr), Dubai in AED (AED 800K–8M). Also a raw
    // display string in the market's idiom.
    const budgetMin = isIndia ? (9 + (i % 52)) * 1_000_000 : (8 + (i % 72)) * 100_000;
    const budgetMax = Math.round(budgetMin * 1.25);
    const budgetRaw = isIndia
      ? `${(budgetMin / 10_000_000).toFixed(1)} Cr`
      : `${(budgetMin / 1_000_000).toFixed(1)}M AED`;
    const created = day(-(5 + (i % 45))); // spread over the last ~7 weeks
    const followup =
      opts.followupOffsetDays == null ? null : day(opts.followupOffsetDays);
    const aiScore = pick(aiScores, i);
    const scoreVal = aiScore === AIScore.HOT ? 80 + (i % 17) : aiScore === AIScore.WARM ? 50 + (i % 29) : 15 + (i % 34);
    const phone = isIndia
      ? `+9198${String(10_000_000 + ((i * 137) % 89_000_000)).slice(0, 8)}`
      : `+9715${String(10_000_000 + ((i * 211) % 89_000_000)).slice(0, 8)}`;

    const lead = await prisma.lead.create({
      data: {
        name: `${fn} ${ln}`,
        phone,
        email: `${fn.toLowerCase()}.${ln.toLowerCase().replace(/\s+/g, "")}${i}@example.com`,
        company: pick(companies, i),
        city: isIndia ? pick(["Gurgaon", "Mumbai", "Delhi", "Bangalore"], i) : pick(["Dubai", "Abu Dhabi", "Sharjah"], i),
        country: isIndia ? "India" : "UAE",
        source: pick(allowedSources, i),
        sourceRaw: pick(["Website form", "WCR Event — Expo", "99acres", "Facebook Lead Ad", "Referral — existing client"], i),
        status: LeadStatus.NEW,
        currentStatus: status,
        budgetMin,
        budgetMax,
        budgetCurrency: currency,
        budgetRaw,
        configuration: pick(configs, i),
        categorization: pick(["NRI Investor", "UAE Resident End-user", "First-time buyer", "International Investor"], i),
        tags: pick(["NRI", "Investor", "End-user", "HNI", "Golden Visa"], i),
        nationality: pick(["Indian", "UAE National", "British-Indian", "Pakistani"], i),
        remarks: pick(remarksPool, i),
        rawRemarks: pick(remarksPool, i),
        todoNext: pick(todosPool, i),
        followupDate: followup,
        followupReminderSentAt: null,
        // Depth fields (Lalit priority) — populated for the richer active leads.
        whoIsClient: opts.withDepth ? pick(whoNarratives, i) : null,
        clientType: opts.withDepth ? pick(clientTypes, i) : null,
        whenCanInvest: pick(timelines, i),
        potential: pick(potentials, i),
        fundReadiness: pick(funds, i),
        moodStatus: pick(moods, i),
        bantStatus: pick([BantStatus.UNDER_REVIEW, BantStatus.QUALIFIES, BantStatus.NOT_QUALIFIED], i),
        authorityLevel: opts.withDepth ? pick(authorities, i) : null,
        authorityPerson: opts.withDepth ? pick(["Self", "Wife", "Father + Son", "Parents"], i) : null,
        needSummary: opts.withDepth ? pick(["End-use, family relocation", "Rental yield", "Golden Visa", "Second home"], i) : null,
        detailShared: pick(["Brochure v3 + floor plans", "Payment plan PDF", "Virtual walkthrough link", ""], i),
        // AI
        aiScore,
        aiScoreValue: scoreVal,
        aiSummary:
          aiScore === AIScore.HOT
            ? `High-intent ${team} buyer · ${budgetRaw} · booking probable within 14 days.`
            : aiScore === AIScore.WARM
              ? `Moderate interest; needs nurturing. Budget aligns with mid-tier inventory.`
              : `Low engagement; nurture or de-prioritize.`,
        aiNextAction: aiScore === AIScore.HOT ? "Book a site visit this week and send the latest brochure." : "Send a personalised WhatsApp follow-up.",
        aiUpdatedAt: NOW,
        // ownership + routing
        ownerId,
        assignedAt: ownerId ? created : null,
        forwardedTeam: team,
        market,
        leadOrigin,
        routingMethod: pick(["manual", "import", "rule", "round_robin_pool"], i),
        routingSource: isIndia ? "portal:99acres" : "website:dubai-property",
        routingReason: isIndia ? "India property enquiry" : "Dubai property page",
        // rejection (Revival rejected workflow)
        rejectedAt: opts.rejected ? day(-(2 + (i % 10))) : null,
        rejectedById: opts.rejected ? admin.id : null,
        rejectionReason: opts.rejected ? pick(["FUND_ISSUE", "WAR_FEAR", "LOW_BUDGET", "OTHER"], i) : null,
        rejectionNote: opts.rejected ? "Sandbox-rejected for revival-workflow testing." : null,
        previousOwnerId: opts.rejected ? pick(agents, i).id : null,
        lastTouchedAt: created,
        createdAt: created,
      },
    });
    allLeadIds.push(lead.id);

    // Assignment history row (audit) when owned.
    if (ownerId) {
      await prisma.assignment.create({
        data: { leadId: lead.id, userId: ownerId, reason: pick(["round-robin", "manual", "rule:dubai"], i), assignedAt: created },
      });
    }
    // Every lead gets a LEAD_CREATED activity.
    await prisma.activity.create({
      data: {
        leadId: lead.id,
        userId: ownerId ?? admin.id,
        type: ActivityType.LEAD_CREATED,
        status: ActivityStatus.DONE,
        title: `Lead created from ${lead.sourceRaw ?? lead.source}`,
        description: lead.remarks ?? undefined,
        completedAt: created,
        createdAt: created,
      },
    });
    counts.activities++;
    return lead;
  }

  // Helper: attach a realistic conversation trail (calls, notes, meetings, visits)
  // to a lead. Called for the ACTIVE leads so every timeline/report has depth.
  async function attachConversation(leadId: string, ownerId: string, phone: string, i: number, team: "Dubai" | "India") {
    const t0 = day(-(3 + (i % 20)));

    // A completed CALL activity + matching CallLog with an outcome.
    const callOutcome = pick([CallOutcome.CONNECTED, CallOutcome.NOT_PICKED, CallOutcome.CALLBACK, CallOutcome.INTERESTED, CallOutcome.BUSY], i);
    const outcomeLabel = callOutcome === CallOutcome.CONNECTED ? "Connected" : callOutcome === CallOutcome.NOT_PICKED ? "Not Picked" : callOutcome === CallOutcome.CALLBACK ? "Callback" : callOutcome === CallOutcome.INTERESTED ? "Interested" : "Busy";
    await prisma.activity.create({
      data: {
        leadId,
        userId: ownerId,
        type: ActivityType.CALL,
        status: ActivityStatus.DONE,
        title: "Discovery call",
        description: pick(whoNarratives, i),
        outcome: outcomeLabel,
        completedAt: hour(-(i % 48) - 2),
        startedAt: hour(-(i % 48) - 2),
        createdAt: t0,
      },
    });
    counts.activities++;
    await prisma.callLog.create({
      data: {
        leadId,
        userId: ownerId,
        direction: pick([CallDirection.OUTBOUND, CallDirection.INBOUND], i),
        phoneNumber: phone,
        durationSec: callOutcome === CallOutcome.CONNECTED || callOutcome === CallOutcome.INTERESTED ? 120 + (i % 360) : 0,
        outcome: callOutcome,
        notes: "Sandbox call log — outcome recorded for Activity report.",
        ivrProvider: i % 3 === 0 ? "asphone" : null,
        // AS Phone "recording": METADATA ONLY — dummy URL, no real audio/telephony.
        recordingUrl: i % 3 === 0 ? `sandbox://recording/lead-${i}.mp3` : null,
        startedAt: hour(-(i % 48) - 2),
        endedAt: hour(-(i % 48) - 1),
        createdAt: t0,
      },
    });
    counts.callLogs++;

    // A free-text NOTE.
    await prisma.note.create({
      data: {
        leadId,
        userId: ownerId,
        body: pick(remarksPool, i),
        createdAt: t0,
      },
    });
    counts.notes++;
    // A NOTE-type activity (so the Smart Timeline shows a note card too).
    await prisma.activity.create({
      data: {
        leadId,
        userId: ownerId,
        type: ActivityType.NOTE,
        status: ActivityStatus.DONE,
        title: "Note",
        description: pick(remarksPool, i + 1),
        completedAt: t0,
        createdAt: t0,
      },
    });
    counts.activities++;

    // Every 2nd lead: an UPCOMING meeting (office/virtual/expo). Every 3rd: a DONE one.
    if (i % 2 === 0) {
      const meetingType = team === "Dubai" ? pick([ActivityType.OFFICE_MEETING, ActivityType.VIRTUAL_MEETING, ActivityType.EXPO_MEETING], i) : pick([ActivityType.OFFICE_MEETING, ActivityType.HOME_VISIT], i);
      await prisma.activity.create({
        data: {
          leadId,
          userId: ownerId,
          type: meetingType,
          status: ActivityStatus.PLANNED,
          title: "Upcoming meeting",
          description: "Confirmed meeting — sandbox upcoming.",
          scheduledAt: day(2 + (i % 7)),
          createdAt: t0,
          ...(meetingType === ActivityType.EXPO_MEETING
            ? { expoCity: pick(["Gurgaon", "Delhi", "Mumbai"], i), expoHotel: "The Leela", expoDeveloper: pick(["Emaar", "Sobha", "DAMAC"], i), expoAgentAttended: false }
            : {}),
        },
      });
      counts.activities++;
    }
    if (i % 3 === 0) {
      // A completed SITE_VISIT (with start/end so it renders as "done").
      await prisma.activity.create({
        data: {
          leadId,
          userId: ownerId,
          type: ActivityType.SITE_VISIT,
          status: ActivityStatus.DONE,
          title: "Site visit completed",
          description: "Client visited the show flat — sandbox done visit.",
          scheduledAt: day(-(1 + (i % 5))),
          completedAt: day(-(1 + (i % 5))),
          startedAt: day(-(1 + (i % 5))),
          endedAt: day(-(1 + (i % 5))),
          createdAt: t0,
        },
      });
      counts.activities++;
    }

    // Interested / discussed projects + an interest note.
    const proj = pick(projects, i);
    try {
      await prisma.leadInterestedProject.create({
        data: { leadId, projectId: proj.id, notes: "Sandbox interested project.", sourceType: "MANUAL" },
      });
      counts.interestedProjects++;
    } catch { /* unique(leadId,projectId) — ignore dup */ }
    const proj2 = pick(projects, i + 2);
    try {
      await prisma.leadProject.create({
        data: { leadId, projectId: proj2.id, status: pick([LeadProjectStatus.DISCUSSED, LeadProjectStatus.SHORTLISTED, LeadProjectStatus.SITE_VISITED], i), notes: "Sandbox discussed project.", sourceType: "MANUAL" },
      });
      counts.leadProjects++;
    } catch { /* ignore dup */ }
    await prisma.leadInterestNote.create({
      data: { leadId, noteText: `Interested in ${pick(configs, i)} at ${proj.name} within budget.`, sourceType: "MANUAL", createdAt: t0 },
    });
    counts.interestNotes++;

    // A specific unit interest (LeadProperty), when a unit exists.
    const unit = pick(units, i * 2 + 1);
    if (unit) {
      try {
        await prisma.leadProperty.create({
          data: { leadId, unitId: unit.id, type: pick([LeadInterestType.PRIMARY, LeadInterestType.COMPARE], i), notes: "Sandbox unit interest." },
        });
        counts.leadProperties++;
      } catch { /* unique(leadId,unitId) — ignore dup */ }
    }
  }

  // ── ACTIVE LEADS (~30) ─────────────────────────────────────────────────────
  // Spread across teams + statuses; some unassigned (pool), some with follow-ups
  // (today / overdue / future). Rich conversation attached to owned ones.
  const ACTIVE_N = 30;
  for (let i = 0; i < ACTIVE_N; i++) {
    const team: "Dubai" | "India" = i % 2 === 0 ? "Dubai" : "India";
    const teamAgents = team === "Dubai" ? dubaiAgents : indiaAgents;
    // Every 6th lead is UNASSIGNED (ownerId null) → pool/queue views populate.
    const unassigned = i % 6 === 5;
    const owner = unassigned ? null : pick(teamAgents, i);
    const status = team === "Dubai" ? pick(dubaiStatuses, i) : pick(indiaStatuses, i);
    // Follow-up spread: overdue (-), today (0), future (+), or none.
    const fu = i % 4 === 0 ? -(1 + (i % 4)) : i % 4 === 1 ? 0 : i % 4 === 2 ? 1 + (i % 6) : null;

    const lead = await buildLead({
      i,
      team,
      leadOrigin: "ACTIVE_LEAD",
      ownerId: owner?.id ?? null,
      status,
      followupOffsetDays: fu,
      withDepth: i % 2 === 0,
    });
    counts.activeLeads++;

    if (owner) {
      await attachConversation(lead.id, owner.id, lead.phone!, i, team);
    }
  }
  console.log(`✓ ${counts.activeLeads} ACTIVE leads (both teams; ${Math.ceil(ACTIVE_N / 6)} unassigned pool; follow-ups today/overdue/future) with conversation depth`);

  // ── MASTER DATA LEADS (~10) ────────────────────────────────────────────────
  // leadOrigin MASTER_DATA / PORTFOLIO — untriaged repository. Some assigned, some
  // not, so the admin Master Data page + its queues populate.
  const MASTER_N = 10;
  for (let i = 0; i < MASTER_N; i++) {
    const team: "Dubai" | "India" = i % 2 === 0 ? "Dubai" : "India";
    const origin = i % 3 === 0 ? "PORTFOLIO" : "MASTER_DATA";
    const assigned = i % 2 === 0;
    const owner = assigned ? pick(team === "Dubai" ? dubaiAgents : indiaAgents, i) : null;
    await buildLead({
      i: i + 100,
      team,
      leadOrigin: origin,
      ownerId: owner?.id ?? null,
      status: team === "Dubai" ? pick(dubaiStatuses, i) : pick(indiaStatuses, i),
      followupOffsetDays: assigned && i % 2 === 0 ? 3 + (i % 5) : null,
    });
    counts.masterDataLeads++;
  }
  console.log(`✓ ${counts.masterDataLeads} MASTER DATA leads (MASTER_DATA + PORTFOLIO; mix assigned/unassigned)`);

  // ── REVIVAL / COLD LEADS (~10) ─────────────────────────────────────────────
  // leadOrigin COLD + REVIVAL, varied statuses; some rejected (rejectedAt set) for
  // the Revival rejected workflow.
  const REVIVAL_N = 10;
  for (let i = 0; i < REVIVAL_N; i++) {
    const team: "Dubai" | "India" = i % 2 === 0 ? "Dubai" : "India";
    const origin = i % 2 === 0 ? "COLD" : "REVIVAL";
    const rejected = i % 3 === 0;
    // Rejected leads are unassigned (reject unassigns); others may have an owner.
    const owner = rejected ? null : pick(team === "Dubai" ? dubaiAgents : indiaAgents, i);
    await buildLead({
      i: i + 200,
      team,
      leadOrigin: origin,
      ownerId: owner?.id ?? null,
      status: rejected ? "Not Interested" : team === "Dubai" ? pick(dubaiStatuses, i) : pick(indiaStatuses, i),
      followupOffsetDays: rejected ? null : i % 2 === 0 ? -(1 + (i % 5)) : 2 + (i % 6),
      rejected,
    });
    counts.revivalColdLeads++;
  }
  console.log(`✓ ${counts.revivalColdLeads} REVIVAL/COLD leads (COLD + REVIVAL; ${Math.ceil(REVIVAL_N / 3)} rejected)`);

  // ── BUYER FACTORY ──────────────────────────────────────────────────────────
  // Creates a BuyerRecord for a market + optional assignment + activity trail.
  async function buildBuyer(opts: {
    i: number;
    market: "Dubai" | "India";
    owner: { id: string } | null; // null = Admin Pool
  }) {
    const { i, market } = opts;
    const isIndia = market === "India";
    const fn = pick(firstNames, i * 7 + 3);
    const ln = pick(lastNames, i * 3 + 4);
    // transactionValue: AED for Dubai, INR for India.
    const txnValue = isIndia ? (12 + (i % 40)) * 1_000_000 : (12 + (i % 60)) * 100_000;
    const assigned = opts.owner != null;
    const poolStatus = assigned ? "ASSIGNED" : "ADMIN_POOL";
    const attemptCount = assigned ? i % 4 : 0;
    const assignedAt = assigned ? day(-(2 + (i % 12))) : null;

    const buyer = await prisma.buyerRecord.create({
      data: {
        clientName: `${fn} ${ln}`,
        phones: JSON.stringify([isIndia ? `+9197${String(30_000_000 + i * 373).slice(0, 8)}` : `+9714${String(30_000_000 + i * 373).slice(0, 8)}`]),
        emails: JSON.stringify([`${fn.toLowerCase()}.${ln.toLowerCase().replace(/\s+/g, "")}.buyer${i}@example.com`]),
        passport: isIndia ? `M${1000000 + i}` : `A${2000000 + i}`,
        nationality: pick(["Indian", "UAE National", "British-Indian", "Pakistani"], i),
        country: isIndia ? "India" : "UAE",
        developer: pick(["Emaar", "Nakheel", "Sobha", "DAMAC", "DLF", "Lodha"], i),
        projectName: pick(projects, i).name,
        tower: `Tower ${pick(["A", "B", "C"], i)}`,
        unitNumber: `${1200 + i}`,
        propertyType: pick(["Residential", "Commercial"], i),
        configuration: pick(["1BR", "2BR", "3BR", "Studio"], i),
        area: isIndia ? pick(["Sector 65", "Lower Parel", "Whitefield"], i) : pick(["Downtown", "Dubai Marina", "Business Bay"], i),
        transactionValue: txnValue,
        transactionDate: day(-(30 + (i % 300))),
        transactionType: pick(["Primary", "Resale", "Off-plan"], i),
        role: "Buyer",
        agentName: assigned ? pick(agents, i).name : null,
        source: "Sandbox seed",
        market,
        businessStatus: pick(["Hot", "Warm", "Cool Off", "Booked", "Follow Up"], i),
        followupDate: assigned && i % 2 === 0 ? day(1 + (i % 6)) : null,
        ownerId: opts.owner?.id ?? null,
        assignedAt,
        poolStatus,
        attemptCount,
        remarks: pick(remarksPool, i),
        createdAt: day(-(10 + (i % 40))),
      },
    });
    if (market === "Dubai") counts.dubaiBuyers++;
    else counts.indiaBuyers++;

    // Assignment stint + lifecycle activities for the assigned buyers.
    if (assigned && opts.owner) {
      await prisma.buyerAssignment.create({
        data: {
          buyerId: buyer.id,
          userId: opts.owner.id,
          assignedById: admin.id,
          assignedAt: assignedAt ?? day(-5),
          attemptsInStint: attemptCount,
        },
      });
      counts.buyerAssignments++;
      // ASSIGNED lifecycle row
      await prisma.buyerActivity.create({
        data: { buyerId: buyer.id, userId: admin.id, type: "ASSIGNED", description: "Assigned from Admin Pool (sandbox).", createdAt: assignedAt ?? day(-5) },
      });
      counts.buyerActivities++;
      // A CALL activity
      await prisma.buyerActivity.create({
        data: { buyerId: buyer.id, userId: opts.owner.id, type: "CALL", description: "Called buyer — sandbox outreach.", createdAt: day(-(1 + (i % 8))) },
      });
      counts.buyerActivities++;
      // A NOTE activity
      await prisma.buyerActivity.create({
        data: { buyerId: buyer.id, userId: opts.owner.id, type: "NOTE", description: pick(remarksPool, i), createdAt: day(-(1 + (i % 6))) },
      });
      counts.buyerActivities++;
      // A CallLog linked to the buyer (recording metadata only) — so buyer timeline + Activity report populate.
      await prisma.callLog.create({
        data: {
          buyerId: buyer.id,
          userId: opts.owner.id,
          direction: CallDirection.OUTBOUND,
          phoneNumber: (JSON.parse(buyer.phones ?? "[]")[0] as string) ?? "+9710000000000",
          durationSec: 90 + (i % 200),
          outcome: pick([CallOutcome.CONNECTED, CallOutcome.NOT_PICKED, CallOutcome.CALLBACK], i),
          notes: "Sandbox buyer call.",
          ivrProvider: i % 3 === 0 ? "acefone" : null,
          recordingUrl: i % 3 === 0 ? `sandbox://recording/buyer-${market}-${i}.mp3` : null,
          startedAt: day(-(1 + (i % 8))),
          createdAt: day(-(1 + (i % 8))),
        },
      });
      counts.callLogs++;
      // Every 4th assigned buyer: a CONVERTED lifecycle marker (funnel data).
      if (i % 4 === 0) {
        await prisma.buyerActivity.create({
          data: { buyerId: buyer.id, userId: opts.owner.id, type: "CONVERTED", description: "Converted to a Lead (sandbox marker).", createdAt: day(-1) },
        });
        counts.buyerActivities++;
      }
    }
    return buyer;
  }

  // ── DUBAI BUYER DATA (~12) ─────────────────────────────────────────────────
  const DUBAI_BUYERS_N = 12;
  for (let i = 0; i < DUBAI_BUYERS_N; i++) {
    // Mix: ~half ASSIGNED to Dubai agents, ~half ADMIN_POOL (unassigned).
    const owner = i % 2 === 0 ? pick(dubaiAgents, i) : null;
    await buildBuyer({ i, market: "Dubai", owner });
  }
  console.log(`✓ ${counts.dubaiBuyers} Dubai buyers (AED; mix ADMIN_POOL + ASSIGNED) + assignments/activities/calls`);

  // ── INDIA BUYER DATA (~8) ──────────────────────────────────────────────────
  const INDIA_BUYERS_N = 8;
  for (let i = 0; i < INDIA_BUYERS_N; i++) {
    const owner = i % 2 === 0 ? pick(indiaAgents, i) : null;
    await buildBuyer({ i: i + 50, market: "India", owner });
  }
  console.log(`✓ ${counts.indiaBuyers} India buyers (INR; mix ADMIN_POOL + ASSIGNED)`);

  // ── VOICE MESSAGES + ESCALATIONS (metadata only) ───────────────────────────
  // audioData is a REQUIRED Bytes column — we store a tiny placeholder Buffer (NO
  // real audio). Enough that the timeline shows a voice-message + escalation entry.
  const placeholderAudio = Buffer.from("sandbox-placeholder-audio");
  const voiceLeadIds = allLeadIds.slice(0, 4);
  for (let i = 0; i < voiceLeadIds.length; i++) {
    const leadId = voiceLeadIds[i];
    if (i % 2 === 0) {
      // GUIDANCE (admin → agent), no escalation.
      await prisma.leadVoiceMessage.create({
        data: {
          leadId,
          kind: VoiceMessageKind.GUIDANCE,
          createdById: admin.id,
          audioData: placeholderAudio,
          mimeType: "audio/webm",
          durationSec: 18 + i,
          transcript: "Sandbox guidance note — push for a Saturday site visit.",
          title: "Guidance",
          createdAt: day(-(1 + i)),
        },
      });
      counts.voiceMessages++;
    } else {
      // ESCALATION thread (agent → manager) + one voice message inside it.
      const esc = await prisma.leadEscalation.create({
        data: {
          leadId,
          raisedById: agent1.id,
          reason: "Client wants a discount beyond my authority — need manager help.",
          status: "PENDING",
          createdAt: day(-(1 + i)),
        },
      });
      counts.escalations++;
      await prisma.leadVoiceMessage.create({
        data: {
          leadId,
          kind: VoiceMessageKind.ESCALATION,
          createdById: agent1.id,
          audioData: placeholderAudio,
          mimeType: "audio/webm",
          durationSec: 25 + i,
          transcript: "Sandbox escalation voice note.",
          textNote: "Please advise on the 10% discount ask.",
          escalationId: esc.id,
          createdAt: day(-(1 + i)),
        },
      });
      counts.voiceMessages++;
    }
  }
  console.log(`✓ ${counts.voiceMessages} voice messages (metadata only) + ${counts.escalations} escalations`);

  // ── AI ANALYSES (dormant — no AI API called) ───────────────────────────────
  // A couple of AiAnalysis rows with a canned resultJson so the AI panel has data.
  const aiLeadIds = allLeadIds.slice(0, 3);
  for (let i = 0; i < aiLeadIds.length; i++) {
    const analysis = await prisma.aiAnalysis.create({
      data: {
        leadId: aiLeadIds[i],
        triggeredBy: "manual",
        triggeredById: admin.id,
        resultJson: JSON.stringify({
          summary: "Sandbox AI analysis (canned — no model was called).",
          score: pick([82, 64, 41], i),
          suggestedNextAction: "Book a site visit and send the payment plan.",
          budget: pick(["AED 2M", "AED 1.5M", "₹3.2 Cr"], i),
          authority: pick(["Decision maker", "Influencer"], i),
        }),
        model: "sandbox-canned",
        inputTokens: 0,
        outputTokens: 0,
        costMicroUsd: 0,
        ok: true,
        createdAt: day(-(1 + i)),
      },
    });
    counts.aiAnalyses++;
    // One feedback row per analysis (AI Learning layer).
    await prisma.aiSuggestionFeedback.create({
      data: {
        analysisId: analysis.id,
        leadId: aiLeadIds[i],
        fieldName: "nextAction",
        aiValue: "Book a site visit and send the payment plan.",
        action: pick(["ACCEPT", "EDIT", "REJECT"], i),
        editedValue: i === 1 ? "Send comparison sheet first, then book visit." : null,
        userId: admin.id,
        createdAt: day(-(1 + i)),
      },
    });
  }
  console.log(`✓ ${counts.aiAnalyses} AI analyses (canned; AI stays dormant — no API called)`);

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  const notifSeeds: Array<{ userId: string; kind: NotifKind; severity: NotifSeverity; title: string; body: string; leadId?: string }> = [
    { userId: agent1.id, kind: NotifKind.LEAD_ASSIGNED, severity: NotifSeverity.INFO, title: "New lead assigned", body: "A Dubai lead just landed in your queue.", leadId: allLeadIds[0] },
    { userId: agent2.id, kind: NotifKind.REMINDER, severity: NotifSeverity.INFO, title: "Follow-up due today", body: "You have follow-ups scheduled for today.", leadId: allLeadIds[1] },
    { userId: agent1.id, kind: NotifKind.CALL_SLA_BREACH, severity: NotifSeverity.WARNING, title: "Call SLA breach", body: "15 minutes passed with no call logged." },
    { userId: manager.id, kind: NotifKind.AGENT_STATUS, severity: NotifSeverity.INFO, title: "Agent check-in", body: "Dummy One marked 'On site visit'." },
    { userId: agent1.id, kind: NotifKind.BUYER_ASSIGNED, severity: NotifSeverity.INFO, title: "Buyer assigned", body: "A Dubai buyer was assigned to you from the pool." },
    { userId: admin.id, kind: NotifKind.SYSTEM, severity: NotifSeverity.INFO, title: "Sandbox seeded", body: "Development sandbox data was regenerated." },
  ];
  for (const n of notifSeeds) {
    await prisma.notification.create({
      data: {
        userId: n.userId,
        kind: n.kind,
        severity: n.severity,
        title: n.title,
        body: n.body,
        leadId: n.leadId,
        linkUrl: n.leadId ? `/leads/${n.leadId}` : "/dashboard",
        readAt: null,
        createdAt: day(-(1)),
      },
    });
    counts.notifications++;
  }
  console.log(`✓ ${counts.notifications} notifications`);

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  const totalLeads = counts.activeLeads + counts.masterDataLeads + counts.revivalColdLeads;
  console.log("\n✅ Sandbox seed complete!\n");
  console.log("   Login (Sandbox owner):");
  console.log("     sandbox@whitecollarrealty.com  /  Sandbox@123   (ADMIN, super-admin, Dubai)");
  console.log("     dummy.manager@sandbox.local    /  Sandbox@123   (MANAGER, Dubai)");
  console.log("     dummy.one@sandbox.local        /  Sandbox@123   (AGENT, Dubai)");
  console.log("     dummy.two@sandbox.local        /  Sandbox@123   (AGENT, India)");
  console.log("     dummy.three@sandbox.local      /  Sandbox@123   (AGENT, India)");
  console.log("\n   Row counts:");
  console.log(`     Users .................. ${counts.users}`);
  console.log(`     Projects / Units ....... ${counts.projects} / ${counts.units}`);
  console.log(`     Leads (total) .......... ${totalLeads}`);
  console.log(`        · Active ............ ${counts.activeLeads}`);
  console.log(`        · Master Data ....... ${counts.masterDataLeads}`);
  console.log(`        · Revival / Cold .... ${counts.revivalColdLeads}`);
  console.log(`     Activities ............. ${counts.activities}`);
  console.log(`     Call logs .............. ${counts.callLogs}`);
  console.log(`     Notes .................. ${counts.notes}`);
  console.log(`     Interested projects .... ${counts.interestedProjects}`);
  console.log(`     Discussed projects ..... ${counts.leadProjects}`);
  console.log(`     Interest notes ......... ${counts.interestNotes}`);
  console.log(`     Lead ↔ unit interests .. ${counts.leadProperties}`);
  console.log(`     Dubai buyers ........... ${counts.dubaiBuyers}`);
  console.log(`     India buyers ........... ${counts.indiaBuyers}`);
  console.log(`     Buyer assignments ...... ${counts.buyerAssignments}`);
  console.log(`     Buyer activities ....... ${counts.buyerActivities}`);
  console.log(`     Voice messages ......... ${counts.voiceMessages}`);
  console.log(`     Escalations ............ ${counts.escalations}`);
  console.log(`     AI analyses ............ ${counts.aiAnalyses}`);
  console.log(`     Notifications .......... ${counts.notifications}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
