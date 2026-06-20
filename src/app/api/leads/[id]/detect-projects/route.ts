// POST /api/leads/[id]/detect-projects
//
// Scans all text sources for a lead (remarks, notes, call notes, WA messages)
// and auto-detects:
//   - ProjectMatches  → upserted into LeadProject (autoDetected=true)
//   - UnmatchedMentions → inserted into UnmatchedMention (if not already present)
//   - InterestNotes   → inserted into LeadInterestNote (if not already present)
//
// Returns: { projectsAdded: N, unmatchedMentions: M, interestNotes: K }

import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { loadOwnedLead } from "@/lib/leadScope";
import { projectWhereForLead } from "@/lib/propertyScope";
import {
  detectProjectsAndInterests,
  buildSourcesFromLead,
} from "@/lib/projectDetector";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth + ownership check
  const scoped = await loadOwnedLead(id);
  if (scoped.error) return scoped.error;

  // Load full lead data needed for detection
  const lead = await prisma.lead.findUnique({
    where: { id },
    include: {
      notes: { select: { body: true, createdAt: true } },
      callLogs: { select: { notes: true, startedAt: true } },
      waMessages: {
        select: { body: true, receivedAt: true },
        take: 50,
        orderBy: { receivedAt: "desc" },
      },
    },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  // Load projects for matching — scoped to the lead's market so an India lead is
  // never auto-suggested a Dubai project from a stray remark token (and vice versa).
  const allProjects = await prisma.project.findMany({
    where: projectWhereForLead(lead, scoped.me),
    select: { id: true, name: true, city: true },
  });

  // Build sources and run detection
  const sources = buildSourcesFromLead({
    remarks: lead.remarks,
    notesShort: lead.notesShort,
    notes: lead.notes,
    callLogs: lead.callLogs,
    waMessages: lead.waMessages,
  });

  const { projectMatches, unmatchedMentions, interestNotes } =
    detectProjectsAndInterests(sources, allProjects);

  // ---------------------------------------------------------------------------
  // 1. Upsert LeadProject rows
  // ---------------------------------------------------------------------------
  // @@unique([leadId, projectId]) — if row already exists (e.g. manually added),
  // use update:{} (no-op) to preserve any manual settings.
  let projectsAdded = 0;

  for (const match of projectMatches) {
    await prisma.leadProject.upsert({
      where: {
        leadId_projectId: {
          leadId: id,
          projectId: match.projectId,
        },
      },
      create: {
        leadId: id,
        projectId: match.projectId,
        autoDetected: true,
        suggestion: true,  // pending user accept/reject
        sourceType: match.sourceType,
        sourceDate: match.sourceDate,
        sourceText: match.sourceText.slice(0, 200),
      },
      update: {
        // No-op: preserve existing row (if already accepted/rejected, don't revert)
        sourceType: match.sourceType,
        sourceDate: match.sourceDate,
        sourceText: match.sourceText.slice(0, 200),
      },
    });
    projectsAdded++;
  }

  // ---------------------------------------------------------------------------
  // 2. Create UnmatchedMention rows (skip duplicates)
  // ---------------------------------------------------------------------------
  let unmatchedCount = 0;

  for (const mention of unmatchedMentions) {
    const existing = await prisma.unmatchedMention.findFirst({
      where: {
        leadId: id,
        mentionText: mention.mentionText,
        sourceType: mention.sourceType,
      },
      select: { id: true },
    });

    if (!existing) {
      await prisma.unmatchedMention.create({
        data: {
          leadId: id,
          mentionText: mention.mentionText,
          sourceType: mention.sourceType,
          sourceDate: mention.sourceDate,
          sourceText: mention.sourceText.slice(0, 150),
        },
      });
      unmatchedCount++;
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Create LeadInterestNote rows (skip duplicates)
  // ---------------------------------------------------------------------------
  let interestNoteCount = 0;

  for (const note of interestNotes) {
    const existing = await prisma.leadInterestNote.findFirst({
      where: {
        leadId: id,
        noteText: note.noteText,
      },
      select: { id: true },
    });

    if (!existing) {
      await prisma.leadInterestNote.create({
        data: {
          leadId: id,
          noteText: note.noteText,
          autoDetected: true,
          sourceType: note.sourceType,
          sourceDate: note.sourceDate,
        },
      });
      interestNoteCount++;
    }
  }

  return NextResponse.json({
    projectsAdded,
    unmatchedMentions: unmatchedCount,
    interestNotes: interestNoteCount,
  });
}
