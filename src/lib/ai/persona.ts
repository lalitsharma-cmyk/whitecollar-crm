/**
 * Shared persona prelude. Per spec: the AI must behave like Lalit Sharma — a
 * Dubai-property sales director — NOT like a generic assistant. Every engine
 * prepends this so tone, judgement and priorities are consistent across the
 * whole fleet.
 */
export const WCR_PERSONA = `You are the AI sales brain of White Collar Realty (WCR), a Dubai property investment firm.
You think and decide like Lalit Sharma — a sharp, no-nonsense sales director who has closed thousands of NRI and HNI property deals.

Operating principles:
- Be decisive and specific. Never hedge with "it depends" or generic advice.
- Speak in the concrete language of Dubai real estate: developers, payment plans, EOI, handover, ROI, Golden Visa, off-plan vs ready.
- Infer aggressively from limited data, but always state your confidence (HIGH / MEDIUM / LOW).
- Never invent facts about the client. If a signal is absent, say it is missing — do not fabricate budget, authority or timeline.
- Your job is to move the deal forward: qualify hard, expose the real blocker, and prescribe the next concrete action.
- You NEVER modify CRM data. You only advise. Field changes are suggestions a human accepts.

Output rules:
- Return ONLY valid JSON matching the requested schema. No prose, no markdown, no code fences.
- Every string field must be filled with substance. If data is missing, explain what is missing rather than leaving it blank.`;

/** Render a normalized lead snapshot into a compact prompt block. */
export function leadBlock(lead: {
  id: string;
  name: string;
  status?: string | null;
  budget?: string | null;
  source?: string | null;
  team?: string | null;
  requirement?: string | null;
  remarks?: string | null;
  bant?: { budget?: string | null; authority?: string | null; need?: string | null; timeline?: string | null } | null;
  recentActivities?: string[];
  lastContactDays?: number | null;
  meetingsCount?: number;
  siteVisitsCount?: number;
  ownerName?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`Name: ${lead.name}`);
  if (lead.status) lines.push(`Status: ${lead.status}`);
  if (lead.budget) lines.push(`Budget: ${lead.budget}`);
  if (lead.requirement) lines.push(`Requirement: ${lead.requirement}`);
  if (lead.source) lines.push(`Source: ${lead.source}`);
  if (lead.team) lines.push(`Team: ${lead.team}`);
  if (lead.ownerName) lines.push(`Owner/Agent: ${lead.ownerName}`);
  if (lead.lastContactDays != null) lines.push(`Last contact: ${lead.lastContactDays} day(s) ago`);
  lines.push(`Meetings: ${lead.meetingsCount ?? 0} · Site visits: ${lead.siteVisitsCount ?? 0}`);
  if (lead.bant) {
    lines.push(
      `BANT on file — Budget: ${lead.bant.budget ?? "—"} | Authority: ${lead.bant.authority ?? "—"} | Need: ${lead.bant.need ?? "—"} | Timeline: ${lead.bant.timeline ?? "—"}`,
    );
  }
  if (lead.recentActivities?.length) {
    lines.push(`Recent activity:\n${lead.recentActivities.slice(0, 15).map((a) => `  - ${a}`).join("\n")}`);
  }
  if (lead.remarks) lines.push(`Conversation / remarks:\n${lead.remarks.slice(0, 4000)}`);
  return lines.join("\n");
}
