import type { EngineLeadInput } from "./types";

/**
 * Build the normalized, provider-agnostic EngineLeadInput from a Prisma lead row
 * (with activities/callLogs included). This is the ONLY place raw CRM data is
 * read into the engine layer — it never flows back, enforcing "AI advises,
 * never overwrites".
 *
 * Defensive by design: accepts a loose structural shape so it survives schema
 * drift in the Activity/CallLog relations.
 */

interface RawActivity {
  type?: string | null;
  title?: string | null;
  note?: string | null;
  description?: string | null;
  createdAt?: Date | string | null;
}
interface RawCall {
  createdAt?: Date | string | null;
  startedAt?: Date | string | null;
}
export interface RawLeadForSnapshot {
  id: string;
  name: string;
  status?: string | null;
  currentStatus?: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
  configuration?: string | null;
  notesShort?: string | null;
  needSummary?: string | null;
  whoIsClient?: string | null;
  source?: string | null;
  forwardedTeam?: string | null;
  remarks?: string | null;
  authorityLevel?: string | null;
  authorityPerson?: string | null;
  whenCanInvest?: string | null;
  fundReadiness?: string | null;
  alreadyBought?: string | null;
  meetingDate?: Date | string | null;
  siteVisitDate?: Date | string | null;
  followupDate?: Date | string | null;
  lastTouchedAt?: Date | string | null;
  updatedAt?: Date | string | null;
  owner?: { name?: string | null } | null;
  activities?: RawActivity[];
  callLogs?: RawCall[];
}

function toDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function daysAgo(d: Date | null, ref: number): number | null {
  if (!d) return null;
  return Math.max(0, Math.floor((ref - d.getTime()) / 86_400_000));
}

function formatBudget(min?: number | null, max?: number | null, cur?: string | null): string | null {
  if (min == null && max == null) return null;
  const c = cur ?? "AED";
  const fmt = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M` : v.toLocaleString());
  if (min != null && max != null) return `${c} ${fmt(min)}–${fmt(max)}`;
  return `${c} ${fmt((min ?? max)!)}${min != null && max == null ? "+" : ""}`;
}

function activityLine(a: RawActivity): string {
  const when = toDate(a.createdAt);
  const label = a.title || a.type || "activity";
  const detail = a.note || a.description || "";
  const date = when ? when.toISOString().slice(0, 10) : "";
  return `${date ? date + " · " : ""}${label}${detail ? ": " + detail.slice(0, 120) : ""}`;
}

/**
 * @param refNow epoch ms used for "days ago" math. Pass Date.now() from the
 * caller (server component) so this stays a pure function.
 */
export function buildLeadSnapshot(lead: RawLeadForSnapshot, refNow: number): EngineLeadInput {
  const activities = lead.activities ?? [];
  const meeting = toDate(lead.meetingDate);
  const siteVisit = toDate(lead.siteVisitDate);

  const lastActivity = activities
    .map((a) => toDate(a.createdAt))
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const lastContact = toDate(lead.lastTouchedAt) ?? lastActivity ?? toDate(lead.updatedAt);

  // Count meetings / site visits from explicit date fields + activity keywords.
  const meetingKeyword = activities.filter((a) => /meet|zoom|call.?back|discussion/i.test(`${a.type ?? ""} ${a.title ?? ""}`)).length;
  const visitKeyword = activities.filter((a) => /site.?visit|visit|property tour/i.test(`${a.type ?? ""} ${a.title ?? ""}`)).length;

  return {
    id: lead.id,
    name: lead.name,
    status: lead.currentStatus ?? lead.status ?? null,
    budget: formatBudget(lead.budgetMin, lead.budgetMax, lead.budgetCurrency),
    source: lead.source ?? null,
    team: lead.forwardedTeam ?? null,
    requirement: lead.configuration ?? lead.notesShort ?? null,
    remarks: lead.remarks ?? null,
    bant: {
      budget: formatBudget(lead.budgetMin, lead.budgetMax, lead.budgetCurrency) ?? lead.fundReadiness ?? null,
      authority: lead.authorityLevel ?? lead.authorityPerson ?? null,
      need: lead.needSummary ?? lead.whoIsClient ?? null,
      timeline: lead.whenCanInvest ?? (meeting ? `meeting ${meeting.toISOString().slice(0, 10)}` : null) ?? (siteVisit ? `site visit ${siteVisit.toISOString().slice(0, 10)}` : null),
    },
    recentActivities: activities.slice(0, 15).map(activityLine),
    lastContactDays: daysAgo(lastContact, refNow),
    meetingsCount: (meeting ? 1 : 0) + meetingKeyword,
    siteVisitsCount: (siteVisit ? 1 : 0) + visitKeyword,
    ownerName: lead.owner?.name ?? null,
  };
}
