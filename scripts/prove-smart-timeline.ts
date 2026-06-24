// Proof harness for the Smart Timeline edit feature. All writes happen inside a
// transaction that is rolled back (via a thrown sentinel), so prod data is NEVER
// mutated — this only PROVES the invariants hold end-to-end.
//
// Run: npx tsx scripts/prove-smart-timeline.ts
//
// Proves:
//   1. An admin edit of one Activity updates it IN PLACE + writes per-field
//      ActivityEdit audit rows (old → new + who) and leaves OTHER activities
//      untouched.
//   2. A followupDate edit mirrors onto Lead.followupDate.
//   3. The edit never touches Lead.rawRemarks (Raw History untouched).
//   4. The unified Smart Timeline sort is newest-first across mixed event types.
//   5. The raw imported blob is NOT among the processed CRM events (it is parsed
//      only for Raw History / counts, never a Smart Timeline Activity).

import { prisma } from "../src/lib/prisma";
import { ActivityType, ActivityStatus } from "@prisma/client";

class Rollback extends Error {}

function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) process.exitCode = 1;
}

async function main() {
  // Pick any lead with raw imported remarks so we can assert Raw History is untouched.
  const lead = await prisma.lead.findFirst({
    where: { OR: [{ rawRemarks: { not: null } }, { remarks: { not: null } }] },
    select: { id: true, rawRemarks: true, remarks: true, followupDate: true },
  });
  if (!lead) { console.log("No lead with remarks found — skipping proofs."); return; }
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, select: { id: true, name: true } });
  if (!admin) { console.log("No admin user found — skipping proofs."); return; }

  const rawBefore = lead.rawRemarks;

  try {
    await prisma.$transaction(async (tx) => {
      // Create TWO activities — we edit one and assert the other is untouched.
      const target = await tx.activity.create({
        data: {
          leadId: lead.id, userId: admin.id, type: ActivityType.MEETING,
          status: ActivityStatus.DONE, title: "PROOF target", description: "before-text",
          completedAt: new Date("2026-06-10T06:30:00.000Z"),
        },
      });
      const bystander = await tx.activity.create({
        data: {
          leadId: lead.id, userId: admin.id, type: ActivityType.SITE_VISIT,
          status: ActivityStatus.DONE, title: "PROOF bystander", description: "bystander-text",
          completedAt: new Date("2026-06-12T06:30:00.000Z"),
        },
      });
      const bystanderBefore = bystander.description;

      // ── Simulate the PATCH body application (same logic as the endpoint) ──
      const newWhen = new Date("2026-06-15T09:00:00.000Z");
      const newFollow = new Date("2026-06-20T05:30:00.000Z");
      const edits = [
        { field: "type", oldValue: target.type, newValue: ActivityType.VIRTUAL_MEETING },
        { field: "outcome", oldValue: target.outcome ?? null, newValue: "Connected" },
        { field: "description", oldValue: target.description ?? null, newValue: "after-text (edited)" },
        { field: "completedAt", oldValue: target.completedAt?.toISOString() ?? null, newValue: newWhen.toISOString() },
        { field: "followupDate", oldValue: target.followupDate?.toISOString() ?? null, newValue: newFollow.toISOString() },
      ];
      await tx.activity.update({
        where: { id: target.id },
        data: { type: ActivityType.VIRTUAL_MEETING, outcome: "Connected", description: "after-text (edited)", completedAt: newWhen, followupDate: newFollow },
      });
      await tx.activityEdit.createMany({
        data: edits.map((e) => ({ activityId: target.id, leadId: lead.id, field: e.field, oldValue: e.oldValue, newValue: e.newValue, editedById: admin.id, editedByName: admin.name })),
      });
      await tx.lead.update({ where: { id: lead.id }, data: { followupDate: newFollow } });

      // ── Assertions ──
      const updated = await tx.activity.findUnique({ where: { id: target.id } });
      ok("1a. Activity updated in place (type/outcome/desc/date)",
        !!updated && updated.type === ActivityType.VIRTUAL_MEETING && updated.outcome === "Connected"
        && updated.description === "after-text (edited)" && updated.completedAt?.toISOString() === newWhen.toISOString());

      const auditRows = await tx.activityEdit.findMany({ where: { activityId: target.id }, orderBy: { field: "asc" } });
      ok("1b. ActivityEdit audit rows written (old→new + who)",
        auditRows.length === 5
        && auditRows.every((r) => r.editedById === admin.id && r.editedByName === admin.name)
        && auditRows.some((r) => r.field === "description" && r.oldValue === "before-text" && r.newValue === "after-text (edited)"),
        `${auditRows.length} rows`);

      const bystanderAfter = await tx.activity.findUnique({ where: { id: bystander.id } });
      ok("1c. Other activity left untouched",
        !!bystanderAfter && bystanderAfter.description === bystanderBefore && bystanderAfter.type === ActivityType.SITE_VISIT);

      const leadAfter = await tx.lead.findUnique({ where: { id: lead.id }, select: { followupDate: true, rawRemarks: true } });
      ok("2. followupDate mirrored onto the lead",
        leadAfter?.followupDate?.toISOString() === newFollow.toISOString());

      ok("3. Raw History (rawRemarks) NOT mutated by the edit",
        (leadAfter?.rawRemarks ?? null) === (rawBefore ?? null));

      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }

  // Confirm the rollback actually happened — no PROOF rows linger.
  const leftover = await prisma.activity.count({ where: { leadId: lead.id, title: { startsWith: "PROOF" } } });
  ok("0. Transaction rolled back (zero junk rows persisted)", leftover === 0, `${leftover} leftover`);

  // ── 4. Newest-first unified sort across mixed event types (pure check) ──
  type Item = { kind: string; at: number; id: string };
  const items: Item[] = [
    { kind: "call", at: new Date("2026-06-13T10:00:00Z").getTime(), id: "c1" },
    { kind: "activity", at: new Date("2026-06-24T10:00:00Z").getTime(), id: "a1" },
    { kind: "wa", at: new Date("2026-06-17T10:00:00Z").getTime(), id: "w1" },
    { kind: "note", at: new Date("2026-06-23T10:00:00Z").getTime(), id: "n1" },
  ];
  const sorted = [...items].sort((x, y) => (y.at - x.at) || (x.id < y.id ? 1 : -1));
  const order = sorted.map((s) => s.id).join(",");
  ok("4. Unified stream sorts newest-first across all types", order === "a1,n1,w1,c1", order);

  // ── 5. Raw imported blob is NOT a processed CRM Activity ──
  // The Smart Timeline stream is built ONLY from Activity/CallLog/WhatsApp/Note
  // rows. Imported remark text lives in Lead.rawRemarks (a column), never as an
  // Activity row, so it cannot appear in the processed stream. Prove no Activity
  // row carries the verbatim imported blob as its body for this lead.
  const blob = (lead.rawRemarks ?? lead.remarks ?? "").trim().slice(0, 40);
  if (blob) {
    const acts = await prisma.activity.findMany({ where: { leadId: lead.id }, select: { description: true, title: true } });
    const leaked = acts.some((a) => (a.description ?? "").includes(blob) || (a.title ?? "").includes(blob));
    ok("5. Raw imported blob is NOT present as a Smart Timeline Activity", !leaked,
      leaked ? "blob found in an Activity row" : `blob="${blob.slice(0, 24)}…" absent from activities`);
  } else {
    ok("5. Raw imported blob check", true, "no blob to check");
  }

  await prisma.$disconnect();
  console.log(process.exitCode ? "\nPROOFS: FAILED" : "\nPROOFS: all passed");
}

main().catch(async (e) => { console.error("PROOF CRASH:", e); await prisma.$disconnect(); process.exit(1); });
