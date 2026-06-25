/**
 * scripts/diag-terminal-followup-report.ts   (READ-ONLY — ZERO writes)
 *
 * Per-lead decision report for the 9 terminal leads that still carry a followupDate
 * (the data-integrity-jun25 regression). Gathers everything needed to classify each
 * lead by hand, and proposes a classification — but changes NOTHING.
 *
 * For each lead: ID, Name, Owner, Current Status, Current Stage, Source, Follow-up
 * date, Last Activity, Last Remark, why it is rejected, why it still has a follow-up
 * (who set it + when + via which path), engagement signals, duplicate check, and a
 * RECOMMENDED classification (Correctly Rejected | Revisit Candidate | Wrongly
 * Rejected | Duplicate | Archive).
 *
 * Usage:  npx tsx scripts/diag-terminal-followup-report.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const ist = (d: Date | null | undefined) =>
  d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "—";
const dateOnly = (d: Date | null | undefined) =>
  d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium" }) : "—";

// Last meaningful line of a remark blob (strip leading bullets / timestamps noise).
function lastRemarkLine(remarks: string | null): string {
  if (!remarks) return "—";
  const lines = remarks.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "—";
  const last = lines[lines.length - 1];
  return last.length > 240 ? last.slice(0, 240) + "…" : last;
}

// Dead/unreachable statuses → staying rejected is correct (cannot be worked).
const UNREACHABLE = new Set(["Never Respond Phone Calls", "Never Responding", "Number Changed", "Invalid Number", "Junk", "Blocked Me", "Pass Away"]);

async function main() {
  console.log("📋 Terminal-lead + follow-up — per-lead decision report (READ-ONLY, no changes)");
  console.log("═".repeat(82));

  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
    select: {
      id: true, name: true, currentStatus: true, status: true,
      source: true, sourceRaw: true, sourceDetail: true,
      followupDate: true, forwardedTeam: true, leadOrigin: true, createdAt: true, lastTouchedAt: true,
      rejectionReason: true, rejectionNote: true, rejectedAt: true, rejectedById: true,
      ownerId: true,
      phone: true, altPhone: true, email: true, altEmail: true,
      remarks: true, budgetMin: true, budgetMax: true, budgetCurrency: true, potential: true, aiScore: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Resolve user names for owner / rejectedBy / follow-up-changer in one query.
  const fuHistByLead = new Map<string, { source: string | null; changedById: string | null; changedAt: Date; oldValue: string | null; newValue: string | null }>();
  for (const l of leads) {
    const h = await prisma.leadFieldHistory.findFirst({
      where: { leadId: l.id, field: "followupDate" },
      orderBy: { changedAt: "desc" },
      select: { source: true, changedById: true, changedAt: true, oldValue: true, newValue: true },
    });
    if (h) fuHistByLead.set(l.id, h);
  }
  const userIds = new Set<string>();
  for (const l of leads) { if (l.ownerId) userIds.add(l.ownerId); if (l.rejectedById) userIds.add(l.rejectedById); }
  for (const h of fuHistByLead.values()) if (h.changedById) userIds.add(h.changedById);
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } });
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const report: Record<string, unknown>[] = [];

  for (const l of leads) {
    // Last activity + engagement signals.
    const lastAct = await prisma.activity.findFirst({
      where: { leadId: l.id },
      orderBy: [{ completedAt: "desc" }, { scheduledAt: "desc" }, { createdAt: "desc" }],
      select: { type: true, title: true, outcome: true, status: true, scheduledAt: true, completedAt: true, createdAt: true },
    });
    const actTotal = await prisma.activity.count({ where: { leadId: l.id } });
    const meetingCount = await prisma.activity.count({
      where: { leadId: l.id, type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING", "MEETING"] } },
    });

    // Duplicate check — other live leads sharing a phone tail or an email.
    const tails = [l.phone, l.altPhone].filter(Boolean).map((p) => p!.replace(/\D/g, "").slice(-10)).filter((t) => t.length >= 7);
    const emails = [l.email, l.altEmail].filter(Boolean) as string[];
    const dupOR: any[] = [];
    for (const t of tails) dupOR.push({ phone: { endsWith: t } }, { altPhone: { endsWith: t } });
    for (const e of emails) dupOR.push({ email: { equals: e, mode: "insensitive" } }, { altEmail: { equals: e, mode: "insensitive" } });
    const dups = dupOR.length
      ? await prisma.lead.findMany({ where: { id: { not: l.id }, deletedAt: null, OR: dupOR }, select: { id: true, name: true, currentStatus: true } })
      : [];

    const fu = fuHistByLead.get(l.id);
    const whyFollowup = fu
      ? `set ${ist(fu.changedAt)} by ${fu.changedById ? (userName.get(fu.changedById) ?? fu.changedById) : "system"} via "${fu.source ?? "?"}" (${fu.oldValue ? "was " + dateOnly(new Date(fu.oldValue)) : "was empty"} → ${l.followupDate ? dateOnly(l.followupDate) : "—"})`
      : "no follow-up history row (set at import/creation)";
    const whyRejected = l.rejectedAt
      ? `Reject flow on ${ist(l.rejectedAt)} by ${l.rejectedById ? (userName.get(l.rejectedById) ?? l.rejectedById) : "?"} · reason ${l.rejectionReason ?? "?"}${l.rejectionNote ? ` · note: "${l.rejectionNote}"` : ""}`
      : `status "${l.currentStatus}" set WITHOUT the reject flow (no rejectedAt) — applied via import / manual status set`;

    // Recommended classification (heuristic; Lalit decides per-lead).
    const engaged = meetingCount > 0 || (l.budgetMin != null) || l.potential === "HIGH" || l.potential === "MEDIUM" || l.aiScore === "HOT" || l.aiScore === "WARM";
    const futureFu = l.followupDate != null && l.followupDate.getTime() > Date.now();
    let cls: string, why: string;
    if (dups.length) {
      cls = "Duplicate";
      why = `shares phone/email with ${dups.length} other live lead(s): ${dups.map((d) => `${d.name} [${d.currentStatus ?? "—"}]`).join("; ")}`;
    } else if (UNREACHABLE.has(l.currentStatus ?? "")) {
      cls = "Correctly Rejected";
      why = `"${l.currentStatus}" is an unreachable/dead outcome — cannot be worked; just clear the stray follow-up so it leaves the board.`;
    } else if (l.currentStatus === "War Fear" && (engaged || futureFu)) {
      cls = "Revisit Candidate";
      why = `War Fear is a TEMPORARY obstacle (geopolitical), and ${engaged ? "this lead showed real engagement" : "a fresh forward follow-up was just scheduled"} — a candidate to re-engage when the situation eases.`;
    } else {
      cls = "Correctly Rejected";
      why = `"${l.currentStatus}" with little/no engagement — keep rejected; clear the stray follow-up.`;
    }

    report.push({ id: l.id, name: l.name, currentStatus: l.currentStatus, recommended: cls });

    console.log("\n" + "━".repeat(82));
    console.log(`#${report.length}  ${l.name ?? "(no name)"}`);
    console.log(`    Lead ID         : ${l.id}`);
    console.log(`    Owner           : ${l.ownerId ? (userName.get(l.ownerId) ?? l.ownerId) : "— (unassigned)"}   ·   Team: ${l.forwardedTeam ?? "—"}`);
    console.log(`    Current Status  : ${l.currentStatus}        (Stage enum: ${l.status})`);
    console.log(`    Source          : ${l.source}${l.sourceRaw ? ` · raw "${l.sourceRaw}"` : ""}${l.sourceDetail ? ` · project "${l.sourceDetail}"` : ""}`);
    console.log(`    Section/origin  : ${l.leadOrigin}   ·   Created: ${dateOnly(l.createdAt)}   ·   Budget: ${l.budgetMin ?? "—"}${l.budgetCurrency ? " " + l.budgetCurrency : ""}   ·   Potential: ${l.potential ?? "—"}`);
    console.log(`    Follow-up Date  : ${ist(l.followupDate)}   ${l.followupDate && l.followupDate.getTime() < Date.now() ? "(OVERDUE — on board now)" : "(upcoming — on board)"}`);
    console.log(`    Last Activity   : ${lastAct ? `${lastAct.type}${lastAct.outcome ? "/" + lastAct.outcome : ""} — "${lastAct.title ?? ""}" @ ${ist(lastAct.completedAt ?? lastAct.scheduledAt ?? lastAct.createdAt)}` : "— (none)"}   ·   total activities: ${actTotal}, meetings/visits: ${meetingCount}`);
    console.log(`    Last Remark     : ${lastRemarkLine(l.remarks)}`);
    console.log(`    Why rejected    : ${whyRejected}`);
    console.log(`    Why has follow-up: ${whyFollowup}`);
    console.log(`    Duplicates      : ${dups.length ? dups.map((d) => `${d.name} [${d.id}] (${d.currentStatus ?? "—"})`).join("; ") : "none found"}`);
    console.log(`    ▶ RECOMMENDED   : ${cls}`);
    console.log(`        reason: ${why}`);
  }

  // Persist the report alongside the backups for the audit trail.
  const stamp = new Date(leads[0]?.createdAt ?? 0).toISOString().slice(0, 10);
  const out = `./backups/terminal-followup-report-${stamp}.json`;
  writeFileSync(out, JSON.stringify({ generatedFor: "data-integrity-jun25 decision", count: report.length, leads: report }, null, 2));

  console.log("\n" + "═".repeat(82));
  console.log("RECOMMENDATION SUMMARY (you decide per-lead — nothing changed):");
  const byCls = new Map<string, number>();
  for (const r of report) byCls.set(r.recommended as string, (byCls.get(r.recommended as string) ?? 0) + 1);
  for (const [c, n] of [...byCls.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(2)}  ${c}`);
  console.log(`\nReport saved: ${out}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
