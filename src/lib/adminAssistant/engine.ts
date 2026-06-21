// ─────────────────────────────────────────────────────────────────────────────
// Admin AI Assistant — planner + executor + undo.
//
// SAFETY INVARIANTS (enforced here, not just by convention):
//   • Every Lead query is forced to `deletedAt: null` — recycle-bin leads can
//     never be counted or mutated.
//   • Only four reversible fields are ever written: ownerId, tags, forwardedTeam,
//     followupDate. There is no code path to delete, or to touch remarks /
//     rawRemarks / conversation history / createdAt.
//   • Nothing is written until an admin approves a previewed run; execute()
//     captures each lead's BEFORE value so undo() can restore it exactly.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { ParsedCommand, LeadFilter } from "./parse";

export type AgentLite = { id: string; name: string; role: string; team: string | null };

export type PreviewLead = {
  id: string; name: string | null; phone: string | null;
  owner: string | null; team: string | null; status: string | null;
};

export type Preview = {
  ok: boolean;
  error?: string;
  intent: ParsedCommand["intent"];
  explanation: string;
  field?: "ownerId" | "tags" | "forwardedTeam" | "followupDate";
  newValueLabel?: string;     // human label of what will be written
  newValueRaw?: string;       // stored value (id / iso / team / tag)
  count: number;
  sample: PreviewLead[];
  affectedIds: string[];
  agentCandidates?: { id: string; name: string }[]; // when an agent name is ambiguous
  readOnly: boolean;          // true for QUERY / UNSUPPORTED
};

// ── Agent resolution — match a typed name to ONE active user ─────────────────
export async function resolveAgent(name: string): Promise<{ ok: true; user: AgentLite } | { ok: false; candidates: AgentLite[] }> {
  const n = name.trim().toLowerCase();
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, name: true, role: true, team: true },
  });
  const exact = users.filter((u) => u.name.toLowerCase() === n);
  if (exact.length === 1) return { ok: true, user: exact[0] };
  const first = users.filter((u) => u.name.toLowerCase().split(/\s+/)[0] === n);
  if (first.length === 1) return { ok: true, user: first[0] };
  const contains = users.filter((u) => u.name.toLowerCase().includes(n));
  if (contains.length === 1) return { ok: true, user: contains[0] };
  return { ok: false, candidates: (contains.length ? contains : users).slice(0, 8) };
}

// ── Filter → Prisma where (ALWAYS deletedAt:null) ────────────────────────────
export async function buildWhere(filter: LeadFilter, now = new Date()): Promise<{ where: Prisma.LeadWhereInput; ownerNote?: string }> {
  const where: Prisma.LeadWhereInput = { deletedAt: null };
  let ownerNote: string | undefined;
  if (filter.team) where.forwardedTeam = filter.team;
  if (filter.unassigned) where.ownerId = null;
  if (filter.noFollowup) where.followupDate = null;
  if (filter.origin) where.leadOrigin = filter.origin;
  if (filter.status) where.currentStatus = { contains: filter.status, mode: "insensitive" };
  if (filter.source) where.sourceRaw = { contains: filter.source, mode: "insensitive" };
  if (filter.createdWithinDays) where.createdAt = { gte: new Date(now.getTime() - filter.createdWithinDays * 86400_000) };
  if (filter.ownerName) {
    const r = await resolveAgent(filter.ownerName);
    if (r.ok) where.ownerId = r.user.id;
    else { where.ownerId = "__no_such_owner__"; ownerNote = `No active user matches “${filter.ownerName}”.`; }
  }
  // Single-lead targeting — EXACT (case-insensitive) match, never a partial/fuzzy
  // expansion. ANDs with any team filter above, so "this India lead named X" stays
  // inside the India set and never cross-matches Dubai.
  if (filter.leadName) where.name = { equals: filter.leadName, mode: "insensitive" };
  if (filter.email) where.email = { equals: filter.email, mode: "insensitive" };
  if (filter.phone) where.phone = { contains: filter.phone.slice(-10) };
  return { where, ownerNote };
}

async function sampleOf(where: Prisma.LeadWhereInput, take = 8): Promise<PreviewLead[]> {
  const rows = await prisma.lead.findMany({
    where, take, orderBy: { createdAt: "desc" },
    select: { id: true, name: true, phone: true, currentStatus: true, forwardedTeam: true, owner: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, owner: r.owner?.name ?? null, team: r.forwardedTeam, status: r.currentStatus }));
}

// ── PREVIEW — read-only; never writes ────────────────────────────────────────
export async function previewParsed(parsed: ParsedCommand, now = new Date()): Promise<Preview> {
  if (parsed.intent === "UNSUPPORTED") {
    return { ok: false, intent: "UNSUPPORTED", explanation: parsed.explanation, error: parsed.reason, count: 0, sample: [], affectedIds: [], readOnly: true };
  }
  const { where, ownerNote } = await buildWhere(parsed.filter, now);

  // Final safety net (defense-in-depth, independent of the parser): a MUTATING
  // command must never run against an unbounded set. If the only constraint is the
  // implicit deletedAt:null, refuse — narrow to a specific lead or explicit filter.
  const mutating = parsed.intent !== "QUERY";
  if (mutating && Object.keys(where).filter((k) => k !== "deletedAt").length === 0) {
    return { ok: false, intent: parsed.intent, explanation: parsed.explanation,
      error: "Refusing to modify every lead — narrow to a specific lead (name / phone / email) or an explicit filter (e.g. unassigned, a team, a status).",
      count: 0, sample: [], affectedIds: [], readOnly: false };
  }

  const count = await prisma.lead.count({ where });
  const sample = await sampleOf(where);
  const ids = (await prisma.lead.findMany({ where, select: { id: true } })).map((r) => r.id);
  const base = { intent: parsed.intent, explanation: parsed.explanation, count, sample, affectedIds: ids };

  if (parsed.intent === "QUERY") return { ok: true, ...base, readOnly: true };
  if (ownerNote) return { ok: false, ...base, readOnly: false, error: ownerNote };
  if (count === 0) return { ok: false, ...base, readOnly: false, error: "No matching leads — nothing to change." };

  switch (parsed.intent) {
    case "ASSIGN": {
      const r = await resolveAgent(parsed.agentName);
      if (!r.ok) return { ok: false, ...base, readOnly: false, field: "ownerId",
        error: `No single active agent matches “${parsed.agentName}”.`, agentCandidates: r.candidates.map((c) => ({ id: c.id, name: c.name })) };
      return { ok: true, ...base, readOnly: false, field: "ownerId", newValueRaw: r.user.id, newValueLabel: r.user.name };
    }
    case "TAG":
      return { ok: true, ...base, readOnly: false, field: "tags", newValueRaw: parsed.tag, newValueLabel: parsed.tag };
    case "SET_TEAM":
      return { ok: true, ...base, readOnly: false, field: "forwardedTeam", newValueRaw: parsed.team, newValueLabel: parsed.team };
    case "SET_FOLLOWUP":
      return { ok: true, ...base, readOnly: false, field: "followupDate", newValueRaw: parsed.dateISO, newValueLabel: parsed.dateLabel };
  }
}

function mergeTag(old: string | null, tag: string): string {
  const have = (old ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (have.some((t) => t.toLowerCase() === tag.toLowerCase())) return have.join(", ");
  return [...have, tag].join(", ");
}

// ── EXECUTE — applies an approved run, capturing before-values for undo ──────
export async function executeRun(runId: string, meId: string): Promise<{ ok: boolean; affected: number; error?: string }> {
  const run = await prisma.assistantRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, affected: 0, error: "Run not found." };
  if (run.status !== "PREVIEW") return { ok: false, affected: 0, error: `Run already ${run.status.toLowerCase()}.` };
  const field = run.field as "ownerId" | "tags" | "forwardedTeam" | "followupDate" | null;
  if (!field) return { ok: false, affected: 0, error: "This run has no executable action." };
  const ids = (run.affectedIds as string[] | null) ?? [];
  const value = run.newValue ?? "";

  // Re-fetch in scope (deletedAt:null re-enforced) + current value for undo.
  const leads = await prisma.lead.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, ownerId: true, tags: true, forwardedTeam: true, followupDate: true },
  });
  if (leads.length === 0) return { ok: false, affected: 0, error: "No leads still in scope (they may have changed since preview)." };

  const before: { id: string; old: string | null }[] = [];
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      if (field === "tags") {
        for (const l of leads) {
          before.push({ id: l.id, old: l.tags ?? null });
          await tx.lead.update({ where: { id: l.id }, data: { tags: mergeTag(l.tags, value) } });
        }
      } else if (field === "ownerId") {
        for (const l of leads) before.push({ id: l.id, old: l.ownerId ?? null });
        await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { ownerId: value, assignedAt: now } });
      } else if (field === "forwardedTeam") {
        for (const l of leads) before.push({ id: l.id, old: l.forwardedTeam ?? null });
        await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { forwardedTeam: value } });
      } else if (field === "followupDate") {
        for (const l of leads) before.push({ id: l.id, old: l.followupDate ? l.followupDate.toISOString() : null });
        await tx.lead.updateMany({ where: { id: { in: leads.map((l) => l.id) } }, data: { followupDate: new Date(value) } });
      }
      // Per-lead audit trail (source = "assistant").
      await tx.leadFieldHistory.createMany({
        data: before.map((b) => ({ leadId: b.id, field: field!, oldValue: b.old, newValue: field === "ownerId" ? (run.newValue ?? "") : value, changedById: meId, source: "assistant" })),
      });
      await tx.assistantRun.update({
        where: { id: runId },
        data: { status: "EXECUTED", executedAt: now, affectedCount: leads.length, beforeValues: before },
      });
    });
    return { ok: true, affected: leads.length };
  } catch (e) {
    await prisma.assistantRun.update({ where: { id: runId }, data: { status: "FAILED", error: String((e as Error).message).slice(0, 500) } }).catch(() => {});
    return { ok: false, affected: 0, error: "Execution failed — no changes were committed (transaction rolled back)." };
  }
}

// ── UNDO — restores every captured before-value ──────────────────────────────
export async function undoRun(runId: string, meId: string): Promise<{ ok: boolean; restored: number; error?: string }> {
  const run = await prisma.assistantRun.findUnique({ where: { id: runId } });
  if (!run) return { ok: false, restored: 0, error: "Run not found." };
  if (run.status !== "EXECUTED") return { ok: false, restored: 0, error: `Run is ${run.status.toLowerCase()} — nothing to undo.` };
  const field = run.field as "ownerId" | "tags" | "forwardedTeam" | "followupDate" | null;
  const before = (run.beforeValues as { id: string; old: string | null }[] | null) ?? [];
  if (!field || before.length === 0) return { ok: false, restored: 0, error: "No reversible change recorded." };

  try {
    await prisma.$transaction(async (tx) => {
      for (const b of before) {
        const data: Prisma.LeadUpdateInput =
          field === "followupDate" ? { followupDate: b.old ? new Date(b.old) : null }
          : field === "ownerId"    ? { owner: b.old ? { connect: { id: b.old } } : { disconnect: true } }
          : field === "tags"       ? { tags: b.old }
          :                          { forwardedTeam: b.old };
        await tx.lead.update({ where: { id: b.id }, data });
        await tx.leadFieldHistory.create({ data: { leadId: b.id, field, oldValue: run.newValue ?? "", newValue: b.old, changedById: meId, source: "assistant-undo" } });
      }
      await tx.assistantRun.update({ where: { id: runId }, data: { status: "UNDONE", undoneAt: new Date() } });
    });
    return { ok: true, restored: before.length };
  } catch {
    return { ok: false, restored: 0, error: "Undo failed — transaction rolled back." };
  }
}
