// ─────────────────────────────────────────────────────────────────────────────
// scripts/heal-lead-invariants.ts — one-time DATA heal that brings three live
// lead-integrity invariants back to green. Each heal is a NON-DESTRUCTIVE
// enforcement of a rule Lalit already locked in — it changes only the exact
// rows that violate the rule, and only the field(s) the canonical write-path
// would have set. Fully reversible from the JSON backup written before any write.
//
// CONDITIONS HEALED (all scoped deletedAt:null):
//   (A) rejected-but-OWNED  (rejectedAt≠null ∧ ownerId≠null)
//       → mirror the reject route's unassign (Lalit's 2026-06-27 rule "reject
//         UNASSIGNS"): previousOwnerId = previousOwnerId ?? ownerId  (keep the
//         ORIGINAL owner-at-rejection if already recorded), ownerId = null,
//         assignedAt = null, followupDate = null, followupReminderSentAt = null.
//         If such a lead somehow isn't in a terminal status, stamp the terminal
//         reject status too (so nulling its owner can't create a new "leak").
//   (B) rejected-UNASSIGNED with a NON-TERMINAL status (would leak into an
//       assign queue) → stamp the terminal reject status (rejectionStatusFor).
//   (C) TERMINAL status carrying an active followupDate → clear followupDate +
//       followupReminderSentAt (a done lead must not sit in a follow-up queue).
//
// SAFETY CONTRACT (do not relax):
//   • Touches ONLY rows matching the exact invariant queries; only the fields
//     named above. Never deletes a lead, remark, activity, or assignment stint.
//   • Ownership attribution is preserved via previousOwnerId (agentPerformance
//     reports read it), exactly like the live reject route — nothing is lost.
//   • Backs up every touched lead's full before-state to backups/ before writing
//     (reversible) and read-back verifies all three counts return to 0 after.
//   • Writes one AuditLog row per condition (action=lead.heal.*), entity=Lead.
//   • IDEMPOTENT — a second run finds 0 rows and writes nothing.
//
//   npx tsx scripts/heal-lead-invariants.ts            # dry-run (default)
//   npx tsx scripts/heal-lead-invariants.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";
import { rejectionStatusFor } from "../src/lib/reject-reasons";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const TERM = new Set(TERMINAL_STATUSES);
const isTerminal = (s: string | null | undefined) => !!s && TERM.has(s);
// A rejected lead's terminal status derives from its rejection reason; fall back
// to the terminal "Other" outcome when the reason is missing/unmapped.
const terminalFor = (reason: string | null | undefined): string => {
  const s = rejectionStatusFor(reason ?? "OTHER");
  return TERM.has(s) ? s : "Other";
};

type Patch = {
  previousOwnerId?: string | null;
  ownerId?: null;
  assignedAt?: null;
  followupDate?: null;
  followupReminderSentAt?: null;
  currentStatus?: string;
};

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Lead-integrity heal (rejected-owned · rejected-nonterminal · terminal-followup)\n`);

  // ── Fetch the exact violating rows for each condition ───────────────────────
  const A = await prisma.lead.findMany({
    where: { deletedAt: null, rejectedAt: { not: null }, ownerId: { not: null } },
    select: { id: true, name: true, ownerId: true, previousOwnerId: true, currentStatus: true, rejectionReason: true },
  });
  const B = await prisma.lead.findMany({
    where: {
      deletedAt: null, rejectedAt: { not: null }, ownerId: null, isColdCall: false,
      OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }],
    },
    select: { id: true, name: true, currentStatus: true, rejectionReason: true },
  });
  const C = await prisma.lead.findMany({
    where: { deletedAt: null, followupDate: { not: null }, currentStatus: { in: TERMINAL_STATUSES } },
    select: { id: true, name: true, currentStatus: true, followupDate: true },
  });

  // ── Merge into ONE patch per lead (a lead may match >1 condition) ───────────
  const patches = new Map<string, { name: string; patch: Patch; reasons: string[] }>();
  const add = (id: string, name: string, patch: Patch, reason: string) => {
    const cur = patches.get(id) ?? { name, patch: {}, reasons: [] };
    cur.patch = { ...cur.patch, ...patch };
    cur.reasons.push(reason);
    patches.set(id, cur);
  };
  for (const l of A) {
    const patch: Patch = {
      previousOwnerId: l.previousOwnerId ?? l.ownerId, // keep ORIGINAL owner-at-rejection if present
      ownerId: null, assignedAt: null, followupDate: null, followupReminderSentAt: null,
    };
    if (!isTerminal(l.currentStatus)) patch.currentStatus = terminalFor(l.rejectionReason);
    add(l.id, l.name ?? "(no name)", patch, "rejected-owned→unassign");
  }
  for (const l of B) add(l.id, l.name ?? "(no name)", { currentStatus: terminalFor(l.rejectionReason) }, "rejected-nonterminal→terminal");
  for (const l of C) add(l.id, l.name ?? "(no name)", { followupDate: null, followupReminderSentAt: null }, "terminal-followup→clear");

  console.log(`Condition A (rejected-but-owned):        ${A.length}`);
  console.log(`Condition B (rejected+unassigned+non-terminal): ${B.length}`);
  console.log(`Condition C (terminal with followupDate): ${C.length}`);
  console.log(`Distinct leads to touch (merged):        ${patches.size}\n`);
  for (const [id, { name, patch, reasons }] of [...patches].slice(0, 20)) {
    console.log(`  ▸ ${name} [${id}] ${reasons.join("+")} → ${JSON.stringify(patch)}`);
  }
  if (patches.size > 20) console.log(`  … and ${patches.size - 20} more`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply.`); await prisma.$disconnect(); return; }
  if (patches.size === 0) { console.log(`\n✅ APPLY — 0 changes (idempotent). Nothing written.`); await prisma.$disconnect(); return; }

  // ── BACKUP full before-state of every touched lead (reversible) ─────────────
  mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const ids = [...patches.keys()];
  const before = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, ownerId: true, previousOwnerId: true, assignedAt: true,
      currentStatus: true, followupDate: true, followupReminderSentAt: true,
      rejectedAt: true, rejectionReason: true,
    },
  });
  const backupUrl = new URL(`../backups/heal-lead-invariants-${TS}.json`, import.meta.url);
  writeFileSync(backupUrl, JSON.stringify({
    generatedAt: new Date().toISOString(),
    conditions: { A: A.length, B: B.length, C: C.length, mergedLeads: patches.size },
    plan: [...patches].map(([id, v]) => ({ id, name: v.name, reasons: v.reasons, patch: v.patch })),
    before,
  }, null, 2));
  console.log(`\n🔒 Backed up ${before.length} leads → backups/heal-lead-invariants-${TS}.json`);

  // ── APPLY — one update per lead ─────────────────────────────────────────────
  let written = 0;
  for (const [id, { patch }] of patches) {
    await prisma.lead.update({ where: { id }, data: patch });
    written++;
  }
  console.log(`✅ APPLIED — ${written} leads updated.`);

  // ── AUDIT — one row per condition (JSON backup is the rollback artifact) ─────
  const auditRow = (action: string, count: number, entityIds: string[]) =>
    prisma.auditLog.create({
      data: {
        userId: null, action, entity: "Lead", entityId: null,
        meta: JSON.stringify({ count, leadIds: entityIds.slice(0, 100), backup: `backups/heal-lead-invariants-${TS}.json`, note: "one-time invariant heal (non-destructive, reversible)" }),
      },
    });
  if (A.length) await auditRow("lead.heal.rejected-owned-unassign", A.length, A.map((l) => l.id));
  if (B.length) await auditRow("lead.heal.rejected-nonterminal-status", B.length, B.map((l) => l.id));
  if (C.length) await auditRow("lead.heal.terminal-followup-clear", C.length, C.map((l) => l.id));
  console.log(`🧾 AuditLog: ${[A.length && "A", B.length && "B", C.length && "C"].filter(Boolean).join(" + ")} row(s) written.`);

  // ── READ-BACK VERIFY — all three counts must be 0 now ───────────────────────
  console.log(`\n🔎 Read-back verify…`);
  const a2 = await prisma.lead.count({ where: { deletedAt: null, rejectedAt: { not: null }, ownerId: { not: null } } });
  const b2 = await prisma.lead.count({ where: { deletedAt: null, rejectedAt: { not: null }, ownerId: null, isColdCall: false, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] } });
  const c2 = await prisma.lead.count({ where: { deletedAt: null, followupDate: { not: null }, currentStatus: { in: TERMINAL_STATUSES } } });
  console.log(`   rejected-but-owned (want 0):            ${a2}`);
  console.log(`   rejected+unassigned+non-terminal (want 0): ${b2}`);
  console.log(`   terminal-with-followup (want 0):        ${c2}`);
  if (a2 === 0 && b2 === 0 && c2 === 0) console.log(`   ✅ VERIFIED — all three invariants green; idempotent (re-run = 0).`);
  else process.exitCode = 1;

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
