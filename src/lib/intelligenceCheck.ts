/**
 * intelligenceCheck.ts — Customer Intelligence Engine
 *
 * PURE matching + history-fetch library. No UI, no API routes, no AI calls.
 * Runs BEFORE round-robin / SLA / automation so every new lead is pre-checked
 * for duplicates and previous interactions before an agent picks it up.
 *
 * CONTRACT (callers must honour):
 *   - Call runIntelligenceCheck(leadId) AFTER prisma.lead.create(), BEFORE
 *     any assignment / round-robin / SLA timer fires.
 *   - Wrap in try/catch — intelligence is best-effort, never crashes intake.
 *   - STRONG match → do NOT block assignment; the caller can signal downstream
 *     that intelligence is attached.
 *   - MEDIUM / WEAK / NONE → proceed normally.
 *
 * Export surface:
 *   runIntelligenceCheck(leadId)  — full match + upsert IntelligenceMatch
 *   getIntelligenceResult(leadId) — read back stored result (no re-compute)
 */

import { prisma } from "@/lib/prisma";
import { MatchType } from "@prisma/client";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type MatchLevel = "STRONG" | "MEDIUM" | "WEAK" | "NONE";

export interface MatchedField {
  field: string;
  value: string;
  source: string;
  recordId: string;
}

export interface HistoryEvent {
  date: string | null;
  agent: string | null;
  text: string;
  source: string;
  recordId: string;
}

export interface IntelligenceResult {
  matchType: MatchLevel;
  confidence: number; // 0–100
  matchedBy: MatchedField[];
  history: HistoryEvent[];
  previousAgentName: string | null;
  previousStatus: string | null;
  lastContactAt: Date | null;
  totalRecordsFound: number;
  totalPropertiesFound: number;
  projectMatch: "SAME_PROJECT" | "DIFFERENT_PROJECT" | "EXISTING_BUYER" | null;
  projectNote: string | null;
  profileId: string | null; // CustomerProfile.id if found/created
  // Denormalized for the intelligence card display
  previousLeads: Array<{
    id: string;
    name: string;
    status: string;
    createdAt: Date;
    agentName: string | null;
    remarks: string | null;
  }>;
  portfolioEntries: Array<{
    project: string;
    unit: string | null;
    tower: string | null;
    transactionValueAed: number | null;
    date: Date | null;
  }>;
  // Legacy / AI fields (kept for backward compat with existing callers)
  aiSummary: string | null;
  suggestedApproach: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Inline Levenshtein distance — no package dependency (~20 lines).
 * Works on short strings (names). For long strings the DP table is small enough.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Allocate DP table
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [];
    for (let j = 0; j <= n; j++) {
      dp[i][j] = i === 0 ? j : j === 0 ? i : 0;
    }
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp[m][n];
}

/** Return last N digits of a phone string (digits only). Empty string if too short. */
function lastDigits(phone: string | null | undefined, n = 6): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return digits.length >= n ? digits.slice(-n) : "";
}

/** Normalise a name: lowercase, trim, collapse internal whitespace. */
function normName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** First token of a normalised name — for DB-side contains filter before Levenshtein. */
function firstToken(name: string): string {
  return name.split(" ")[0] ?? "";
}

/** Normalise email for case-insensitive comparison. */
function normEmail(e: string | null | undefined): string {
  return (e ?? "").toLowerCase().trim();
}

/** Email domain portion (empty string if unparseable). */
function emailDomain(e: string | null | undefined): string {
  const parts = normEmail(e).split("@");
  return parts.length === 2 ? (parts[1] ?? "") : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main engine
// ─────────────────────────────────────────────────────────────────────────────

export async function runIntelligenceCheck(
  leadId: string
): Promise<IntelligenceResult> {
  // ── 1. Load the new lead ──────────────────────────────────────────────────
  const newLead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    include: {
      discussed: {
        include: { project: { select: { id: true, name: true } } },
      },
    },
  });

  // Phones we should check across all match strategies
  const phonesToCheck: string[] = [];
  if (newLead.phone) phonesToCheck.push(newLead.phone);
  if (newLead.altPhone) phonesToCheck.push(newLead.altPhone);

  // ── 2. STRONG MATCH (confidence 85–95) ───────────────────────────────────
  //
  // Each strong hit captures (confidence, MatchedField). We de-duplicate by
  // recordId+field keeping the highest confidence if the same combination
  // appears through multiple signals.

  type StrongHit = { confidence: number; field: MatchedField };
  const strongHits: StrongHit[] = [];

  const pushStrong = (
    confidence: number,
    fieldName: string,
    value: string,
    source: string,
    recordId: string
  ) => {
    const existing = strongHits.find(
      (h) => h.field.recordId === recordId && h.field.field === fieldName
    );
    if (existing) {
      if (confidence > existing.confidence) existing.confidence = confidence;
      return;
    }
    strongHits.push({
      confidence,
      field: { field: fieldName, value, source, recordId },
    });
  };

  // 2a. lead.phone exact match → 95
  if (newLead.phone) {
    const rows = await prisma.lead.findMany({
      where: { id: { not: leadId }, phone: newLead.phone },
      select: { id: true },
    });
    for (const r of rows) {
      pushStrong(95, "phone", newLead.phone, "lead.phone", r.id);
    }
  }

  // 2b. altPhone cross-match → 92
  //   lead.altPhone = input.phone  OR  lead.phone = input.altPhone  OR  lead.altPhone = input.altPhone
  const altCrossOR: object[] = [];
  if (newLead.phone) {
    altCrossOR.push({ id: { not: leadId }, altPhone: newLead.phone });
  }
  if (newLead.altPhone) {
    altCrossOR.push({ id: { not: leadId }, phone: newLead.altPhone });
    altCrossOR.push({ id: { not: leadId }, altPhone: newLead.altPhone });
  }
  if (altCrossOR.length > 0) {
    const rows = await prisma.lead.findMany({
      where: { OR: altCrossOR },
      select: { id: true, phone: true, altPhone: true },
    });
    for (const r of rows) {
      const matchedVal =
        r.altPhone === newLead.phone
          ? (newLead.phone ?? "")
          : r.phone === newLead.altPhone
            ? (newLead.altPhone ?? "")
            : (newLead.altPhone ?? "");
      pushStrong(92, "phone/altPhone", matchedVal, "lead.altPhone", r.id);
    }
  }

  // 2c. Email exact match (case-insensitive) → 90
  if (newLead.email) {
    const rows = await prisma.lead.findMany({
      where: {
        id: { not: leadId },
        email: { equals: newLead.email, mode: "insensitive" },
      },
      select: { id: true },
    });
    for (const r of rows) {
      pushStrong(90, "email", newLead.email, "lead.email", r.id);
    }
  }

  // 2d. WhatsApp phone match → 88
  if (phonesToCheck.length > 0) {
    const waRows = await prisma.whatsAppMessage.findMany({
      where: { phoneNumber: { in: phonesToCheck } },
      select: { phoneNumber: true, leadId: true },
      distinct: ["phoneNumber", "leadId"],
    });
    for (const wa of waRows) {
      if (wa.leadId && wa.leadId !== leadId) {
        pushStrong(88, "whatsapp", wa.phoneNumber, "WhatsAppMessage", wa.leadId);
      }
    }
  }

  // 2e. PropertyPortfolio phone match → 88  (recordId = portfolio row id)
  if (phonesToCheck.length > 0) {
    const ppRows = await prisma.propertyPortfolio.findMany({
      where: {
        OR: [
          { primaryPhone: { in: phonesToCheck } },
          { secondaryPhone: { in: phonesToCheck } },
        ],
      },
      select: { id: true, primaryPhone: true, secondaryPhone: true },
    });
    for (const pp of ppRows) {
      const matchedVal = phonesToCheck.includes(pp.primaryPhone ?? "")
        ? (pp.primaryPhone ?? "")
        : (pp.secondaryPhone ?? "");
      pushStrong(88, "portfolio.phone", matchedVal, "PropertyPortfolio", pp.id);
    }
  }

  // Collect strong-matched Lead IDs (PropertyPortfolio rows are separate)
  const strongLeadIds = [
    ...new Set(
      strongHits
        .filter((h) => h.field.source !== "PropertyPortfolio")
        .map((h) => h.field.recordId)
    ),
  ];

  let matchType: MatchLevel = "NONE";
  let confidence = 0;
  let matchedBy: MatchedField[] = [];

  if (strongHits.length > 0) {
    matchType = "STRONG";
    confidence = Math.max(...strongHits.map((h) => h.confidence));
    matchedBy = strongHits.map((h) => h.field);
  }

  // ── 3. MEDIUM MATCH (confidence 55–75) — only if no strong ───────────────
  type MediumHit = { confidence: number; field: MatchedField };
  const mediumHits: MediumHit[] = [];

  if (matchType === "NONE") {
    const newNameNorm = normName(newLead.name);
    const newCity = (newLead.city ?? "").toLowerCase().trim();
    const newEmailDomain = emailDomain(newLead.email);
    const newLastDigits = lastDigits(newLead.phone);
    const newAltLastDigits = lastDigits(newLead.altPhone);
    const newProjectIds = newLead.discussed.map((d) => d.projectId);
    const newCompany = (newLead.company ?? "").toLowerCase().trim();

    if (newNameNorm.length >= 3) {
      // Use first token as DB-side filter to narrow before in-process Levenshtein
      const token = firstToken(newNameNorm);

      const candidates = await prisma.lead.findMany({
        where: {
          id: { not: leadId },
          name: { contains: token, mode: "insensitive" },
        },
        select: {
          id: true,
          name: true,
          city: true,
          email: true,
          company: true,
          phone: true,
          altPhone: true,
          discussed: {
            select: { projectId: true },
          },
        },
      });

      for (const c of candidates) {
        const cNameNorm = normName(c.name);
        const cCity = (c.city ?? "").toLowerCase().trim();
        const cEmailDomain = emailDomain(c.email);
        const cLastDigits = lastDigits(c.phone);
        const cAltLastDigits = lastDigits(c.altPhone);
        const cProjectIds = c.discussed.map((d) => d.projectId);
        const cCompany = (c.company ?? "").toLowerCase().trim();
        const editDist = levenshtein(newNameNorm, cNameNorm);

        // 3a. Exact normalised name + city → 72
        if (
          newNameNorm === cNameNorm &&
          newCity &&
          cCity &&
          newCity === cCity
        ) {
          mediumHits.push({
            confidence: 72,
            field: {
              field: "name+city",
              value: `${newLead.name} / ${newLead.city}`,
              source: "lead",
              recordId: c.id,
            },
          });
          continue;
        }

        // 3b. Exact normalised name + same project → 70
        if (
          newNameNorm === cNameNorm &&
          newProjectIds.some((pid) => cProjectIds.includes(pid))
        ) {
          mediumHits.push({
            confidence: 70,
            field: {
              field: "name+project",
              value: newLead.name,
              source: "lead",
              recordId: c.id,
            },
          });
          continue;
        }

        // 3c. Name edit-distance ≤ 2 + matching last 6 phone digits → 68
        const phoneDigitsMatch =
          (newLastDigits.length === 6 &&
            (cLastDigits === newLastDigits ||
              cAltLastDigits === newLastDigits)) ||
          (newAltLastDigits.length === 6 &&
            (cLastDigits === newAltLastDigits ||
              cAltLastDigits === newAltLastDigits));

        if (editDist <= 2 && phoneDigitsMatch) {
          mediumHits.push({
            confidence: 68,
            field: {
              field: "fuzzyName+phoneDigits",
              value: newLead.name,
              source: "lead",
              recordId: c.id,
            },
          });
          continue;
        }

        // 3d. Edit-distance ≤ 2 + same email domain + same city → 65
        if (
          editDist <= 2 &&
          newEmailDomain &&
          cEmailDomain &&
          newEmailDomain === cEmailDomain &&
          newCity &&
          cCity &&
          newCity === cCity
        ) {
          mediumHits.push({
            confidence: 65,
            field: {
              field: "fuzzyName+emailDomain+city",
              value: newLead.name,
              source: "lead",
              recordId: c.id,
            },
          });
          continue;
        }

        // 3e. Same company + overlapping last-6-digit match → 58
        if (
          newCompany &&
          cCompany &&
          newCompany === cCompany &&
          phoneDigitsMatch
        ) {
          mediumHits.push({
            confidence: 58,
            field: {
              field: "company+phoneDigits",
              value: newCompany,
              source: "lead",
              recordId: c.id,
            },
          });
        }
      }
    }

    if (mediumHits.length > 0) {
      matchType = "MEDIUM";
      confidence = Math.max(...mediumHits.map((h) => h.confidence));
      matchedBy = mediumHits.map((h) => h.field);
    }
  }

  // ── 4. WEAK MATCH (confidence 30–45) — only if no strong or medium ────────
  //   DO NOT block or merge on weak. Just record it.
  type WeakHit = { confidence: number; field: MatchedField };
  const weakHits: WeakHit[] = [];

  if (matchType === "NONE") {
    const newNameNorm = normName(newLead.name);
    const newProjectIds = newLead.discussed.map((d) => d.projectId);
    const newCity = (newLead.city ?? "").toLowerCase().trim();

    // 4a. Similar name only (edit-distance ≤ 3, min length 5) → 42
    if (newNameNorm.length >= 5) {
      const token = firstToken(newNameNorm);
      const candidates = await prisma.lead.findMany({
        where: {
          id: { not: leadId },
          name: { contains: token, mode: "insensitive" },
        },
        select: { id: true, name: true },
      });
      for (const c of candidates) {
        const cNameNorm = normName(c.name);
        if (cNameNorm.length < 5) continue;
        if (levenshtein(newNameNorm, cNameNorm) <= 3) {
          weakHits.push({
            confidence: 42,
            field: {
              field: "fuzzyName",
              value: newLead.name,
              source: "lead",
              recordId: c.id,
            },
          });
        }
      }
    }

    // 4b. Same project enquiry only → 35 (only if no name-match found)
    if (weakHits.length === 0 && newProjectIds.length > 0) {
      const rows = await prisma.leadProject.findMany({
        where: {
          projectId: { in: newProjectIds },
          leadId: { not: leadId },
        },
        select: { leadId: true, projectId: true },
        distinct: ["leadId"],
        take: 20,
      });
      for (const r of rows) {
        if (!weakHits.find((h) => h.field.recordId === r.leadId)) {
          weakHits.push({
            confidence: 35,
            field: {
              field: "sameProject",
              value: r.projectId,
              source: "LeadProject",
              recordId: r.leadId,
            },
          });
        }
      }
    }

    // 4c. Same city only → 30 (not enough to merge, purely informational)
    if (weakHits.length === 0 && newCity) {
      const rows = await prisma.lead.findMany({
        where: {
          id: { not: leadId },
          city: { equals: newCity, mode: "insensitive" },
        },
        select: { id: true },
        take: 5,
      });
      for (const r of rows) {
        weakHits.push({
          confidence: 30,
          field: {
            field: "city",
            value: newCity,
            source: "lead.city",
            recordId: r.id,
          },
        });
      }
    }

    if (weakHits.length > 0) {
      matchType = "WEAK";
      confidence = Math.max(...weakHits.map((h) => h.confidence));
      matchedBy = weakHits.map((h) => h.field);
    }
  }

  // ── 5. HISTORY FETCH ──────────────────────────────────────────────────────
  //   For all matched lead IDs: callLogs, notes, activities → HistoryEvent[].
  //   Also fetch PropertyPortfolio by phone.

  // All matched Lead IDs (excludes PropertyPortfolio / WhatsApp source rows)
  const allMatchedLeadIds = [
    ...new Set(
      matchedBy
        .filter(
          (f) =>
            f.source !== "PropertyPortfolio" && f.source !== "WhatsAppMessage"
        )
        .map((f) => f.recordId)
    ),
  ];

  const history: HistoryEvent[] = [];
  const previousLeadsOut: IntelligenceResult["previousLeads"] = [];
  const portfolioEntries: IntelligenceResult["portfolioEntries"] = [];

  // Fetch PropertyPortfolio entries from portfolio match signals
  const portfolioMatchIds = [
    ...new Set(
      matchedBy
        .filter((f) => f.source === "PropertyPortfolio")
        .map((f) => f.recordId)
    ),
  ];
  if (portfolioMatchIds.length > 0) {
    const ppRows = await prisma.propertyPortfolio.findMany({
      where: { id: { in: portfolioMatchIds } },
      select: {
        project: true,
        unit: true,
        tower: true,
        transactionValueAed: true,
        date: true,
      },
    });
    for (const pp of ppRows) {
      portfolioEntries.push({
        project: pp.project,
        unit: pp.unit,
        tower: pp.tower,
        transactionValueAed: pp.transactionValueAed,
        date: pp.date,
      });
    }
  }

  // Also fetch any portfolio entries matched by phone but not already included
  if (phonesToCheck.length > 0) {
    const extraPP = await prisma.propertyPortfolio.findMany({
      where: {
        OR: [
          { primaryPhone: { in: phonesToCheck } },
          { secondaryPhone: { in: phonesToCheck } },
        ],
        id: { notIn: portfolioMatchIds },
      },
      select: {
        project: true,
        unit: true,
        tower: true,
        transactionValueAed: true,
        date: true,
      },
    });
    for (const pp of extraPP) {
      portfolioEntries.push({
        project: pp.project,
        unit: pp.unit,
        tower: pp.tower,
        transactionValueAed: pp.transactionValueAed,
        date: pp.date,
      });
    }
  }

  // Fetch timeline for matched leads
  if (allMatchedLeadIds.length > 0) {
    const matchedLeads = await prisma.lead.findMany({
      where: { id: { in: allMatchedLeadIds } },
      include: {
        owner: { select: { name: true } },
        callLogs: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        notes: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
        activities: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    for (const lead of matchedLeads) {
      // Build previousLeads entry
      previousLeadsOut.push({
        id: lead.id,
        name: lead.name,
        status: lead.status as string,
        createdAt: lead.createdAt,
        agentName: lead.owner?.name ?? null,
        remarks: lead.remarks ?? null,
      });

      // CallLogs → HistoryEvent
      for (const cl of lead.callLogs) {
        const agentName = cl.attributedAgentName ?? cl.user?.name ?? null;
        history.push({
          date: cl.startedAt.toISOString(),
          agent: agentName,
          text: [
            `Call ${cl.direction.toLowerCase()}`,
            cl.outcome.replace(/_/g, " "),
            cl.durationSec ? `${cl.durationSec}s` : null,
            cl.notes ?? null,
          ]
            .filter(Boolean)
            .join(" — "),
          source: "CallLog",
          recordId: cl.id,
        });
      }

      // Notes → HistoryEvent
      for (const note of lead.notes) {
        history.push({
          date: note.createdAt.toISOString(),
          agent: note.user?.name ?? null,
          text: note.body,
          source: "Note",
          recordId: note.id,
        });
      }

      // Activities → HistoryEvent
      for (const act of lead.activities) {
        history.push({
          date: act.createdAt.toISOString(),
          agent: act.user?.name ?? null,
          text: [
            act.type.replace(/_/g, " "),
            act.title,
            act.description ?? null,
          ]
            .filter(Boolean)
            .join(" — "),
          source: "Activity",
          recordId: act.id,
        });
      }
    }
  }

  // Sort all events newest-first
  history.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  // Derive summary fields (most recent lead by createdAt)
  const sortedPrev = [...previousLeadsOut].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const mostRecentPrev = sortedPrev[0] ?? null;
  const previousAgentName = mostRecentPrev?.agentName ?? null;
  const previousStatus = mostRecentPrev?.status ?? null;
  const lastContactAt =
    history.length > 0 && history[0]?.date ? new Date(history[0].date) : null;

  // ── 6. PROJECT COMPARISON ─────────────────────────────────────────────────
  const newProjectNames = newLead.discussed.map((d) =>
    d.project.name.toLowerCase()
  );
  const newProjectIdsSet = new Set(newLead.discussed.map((d) => d.projectId));

  let projectMatch: IntelligenceResult["projectMatch"] = null;
  let projectNote: string | null = null;

  // EXISTING_BUYER check — portfolio entry for same project
  const portfolioProjectsLower = portfolioEntries.map((p) =>
    p.project.toLowerCase()
  );
  const buyerHit = newProjectNames.find((pn) =>
    portfolioProjectsLower.includes(pn)
  );
  if (buyerHit) {
    projectMatch = "EXISTING_BUYER";
    projectNote = `Client has a property portfolio entry for "${newLead.discussed.find((d) => d.project.name.toLowerCase() === buyerHit)?.project.name ?? buyerHit}" — existing buyer.`;
  } else if (allMatchedLeadIds.length > 0) {
    // Compare against previous lead project discussions
    const prevDiscussed = await prisma.leadProject.findMany({
      where: { leadId: { in: allMatchedLeadIds } },
      include: { project: { select: { id: true, name: true } } },
    });
    const prevProjectIdSet = new Set(prevDiscussed.map((d) => d.projectId));
    const overlap = newLead.discussed.filter((d) =>
      prevProjectIdSet.has(d.projectId)
    );

    if (overlap.length > 0) {
      projectMatch = "SAME_PROJECT";
      const names = overlap.map((d) => d.project.name).join(", ");
      projectNote = `Previously enquired about: ${names}. Same project(s) again.`;
    } else if (prevDiscussed.length > 0 && newLead.discussed.length > 0) {
      projectMatch = "DIFFERENT_PROJECT";
      const prevNames = [
        ...new Set(prevDiscussed.map((d) => d.project.name)),
      ].join(", ");
      const currNames = newLead.discussed.map((d) => d.project.name).join(", ");
      projectNote = `Previous enquiry: ${prevNames}. Current enquiry: ${currNames}.`;
    }
  }

  // ── 7. CUSTOMER PROFILE UPSERT (STRONG only) ──────────────────────────────
  let profileId: string | null = null;

  if (matchType === "STRONG") {
    // Gather previous project names from history leads
    const historyLeadProjectRows = await prisma.leadProject.findMany({
      where: { leadId: { in: strongLeadIds } },
      include: { project: { select: { name: true } } },
    });
    const allProjectNames = [
      ...new Set([
        ...newProjectNames,
        ...historyLeadProjectRows.map((lp) =>
          lp.project.name.toLowerCase()
        ),
      ]),
    ];
    const prevAgentNames = [
      ...new Set(
        previousLeadsOut
          .map((l) => l.agentName)
          .filter((n): n is string => n !== null)
      ),
    ];

    // Find existing CustomerProfile by phone or email
    let existingProfile = null;
    if (phonesToCheck.length > 0) {
      existingProfile = await prisma.customerProfile.findFirst({
        where: {
          OR: [
            { primaryPhone: { in: phonesToCheck } },
            { secondaryPhone: { in: phonesToCheck } },
          ],
        },
      });
    }
    if (!existingProfile && newLead.email) {
      existingProfile = await prisma.customerProfile.findFirst({
        where: { email: { equals: newLead.email, mode: "insensitive" } },
      });
    }

    const now = new Date();

    if (existingProfile) {
      const existingProjects: string[] = JSON.parse(
        existingProfile.previousProjects || "[]"
      );
      const existingAgents: string[] = JSON.parse(
        existingProfile.previousAgents || "[]"
      );
      const updated = await prisma.customerProfile.update({
        where: { id: existingProfile.id },
        data: {
          lastInteractedAt: now,
          previousProjects: JSON.stringify([
            ...new Set([...existingProjects, ...allProjectNames]),
          ]),
          previousAgents: JSON.stringify([
            ...new Set([...existingAgents, ...prevAgentNames]),
          ]),
          totalProperties: portfolioEntries.length,
          // Fill any missing contact fields from the new lead
          primaryPhone: existingProfile.primaryPhone ?? newLead.phone ?? undefined,
          secondaryPhone:
            existingProfile.secondaryPhone ?? newLead.altPhone ?? undefined,
          email: existingProfile.email ?? newLead.email ?? undefined,
          city: existingProfile.city ?? newLead.city ?? undefined,
          company: existingProfile.company ?? newLead.company ?? undefined,
        },
      });
      profileId = updated.id;
    } else {
      const created = await prisma.customerProfile.create({
        data: {
          name: newLead.name,
          primaryPhone: newLead.phone ?? undefined,
          secondaryPhone: newLead.altPhone ?? undefined,
          email: newLead.email ?? undefined,
          city: newLead.city ?? undefined,
          company: newLead.company ?? undefined,
          totalProperties: portfolioEntries.length,
          previousProjects: JSON.stringify(allProjectNames),
          previousAgents: JSON.stringify(prevAgentNames),
          lastInteractedAt: now,
        },
      });
      profileId = created.id;
    }
  }

  // ── 8. STORE RESULT (upsert IntelligenceMatch) ────────────────────────────
  const result: IntelligenceResult = {
    matchType,
    confidence,
    matchedBy,
    history,
    previousAgentName,
    previousStatus,
    lastContactAt,
    totalRecordsFound: allMatchedLeadIds.length,
    totalPropertiesFound: portfolioEntries.length,
    projectMatch,
    projectNote,
    profileId,
    previousLeads: previousLeadsOut,
    portfolioEntries,
    aiSummary: null,
    suggestedApproach: null,
  };

  await prisma.intelligenceMatch.upsert({
    where: { leadId },
    create: {
      leadId,
      profileId: profileId ?? undefined,
      matchType: matchType as MatchType,
      confidence,
      matchedBy: JSON.stringify(matchedBy),
      historyJson: JSON.stringify(history),
      previousAgentName,
      previousStatus,
      lastContactAt,
      totalRecordsFound: result.totalRecordsFound,
      totalPropertiesFound: result.totalPropertiesFound,
      projectMatch,
      projectNote,
      checkedAt: new Date(),
    },
    update: {
      profileId: profileId ?? undefined,
      matchType: matchType as MatchType,
      confidence,
      matchedBy: JSON.stringify(matchedBy),
      historyJson: JSON.stringify(history),
      previousAgentName,
      previousStatus,
      lastContactAt,
      totalRecordsFound: result.totalRecordsFound,
      totalPropertiesFound: result.totalPropertiesFound,
      projectMatch,
      projectNote,
      checkedAt: new Date(),
    },
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read-back: parse stored JSON into IntelligenceResult without re-running check
// ─────────────────────────────────────────────────────────────────────────────

export async function getIntelligenceResult(
  leadId: string
): Promise<IntelligenceResult | null> {
  const stored = await prisma.intelligenceMatch.findUnique({
    where: { leadId },
  });
  if (!stored) return null;

  const matchedBy: MatchedField[] = (() => {
    try {
      return JSON.parse(stored.matchedBy) as MatchedField[];
    } catch {
      return [];
    }
  })();

  const history: HistoryEvent[] = (() => {
    try {
      return JSON.parse(stored.historyJson) as HistoryEvent[];
    } catch {
      return [];
    }
  })();

  // Reconstruct previousLeads from matched lead IDs stored in matchedBy
  const matchedLeadIds = [
    ...new Set(
      matchedBy
        .filter(
          (f) =>
            f.source !== "PropertyPortfolio" && f.source !== "WhatsAppMessage"
        )
        .map((f) => f.recordId)
    ),
  ];

  const previousLeads: IntelligenceResult["previousLeads"] = [];
  if (matchedLeadIds.length > 0) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: matchedLeadIds } },
      include: { owner: { select: { name: true } } },
    });
    for (const l of leads) {
      previousLeads.push({
        id: l.id,
        name: l.name,
        status: l.status as string,
        createdAt: l.createdAt,
        agentName: l.owner?.name ?? null,
        remarks: l.remarks ?? null,
      });
    }
  }

  // Fetch portfolio entries for the profile (if any)
  const portfolioEntries: IntelligenceResult["portfolioEntries"] = [];
  if (stored.profileId) {
    const ppRows = await prisma.propertyPortfolio.findMany({
      where: { profileId: stored.profileId },
      select: {
        project: true,
        unit: true,
        tower: true,
        transactionValueAed: true,
        date: true,
      },
    });
    for (const pp of ppRows) {
      portfolioEntries.push({
        project: pp.project,
        unit: pp.unit,
        tower: pp.tower,
        transactionValueAed: pp.transactionValueAed,
        date: pp.date,
      });
    }
  }

  return {
    matchType: stored.matchType as MatchLevel,
    confidence: stored.confidence,
    matchedBy,
    history,
    previousAgentName: stored.previousAgentName ?? null,
    previousStatus: stored.previousStatus ?? null,
    lastContactAt: stored.lastContactAt ?? null,
    totalRecordsFound: stored.totalRecordsFound,
    totalPropertiesFound: stored.totalPropertiesFound,
    projectMatch: stored.projectMatch as IntelligenceResult["projectMatch"],
    projectNote: stored.projectNote ?? null,
    profileId: stored.profileId ?? null,
    previousLeads,
    portfolioEntries,
    aiSummary: stored.aiSummary ?? null,
    suggestedApproach: stored.suggestedApproach ?? null,
  };
}
