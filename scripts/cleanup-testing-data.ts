// ─────────────────────────────────────────────────────────────────────────────
// cleanup-testing-data.ts — FULL pre-go-live TESTING-DATA cleanup
// ─────────────────────────────────────────────────────────────────────────────
//
// PURPOSE
//   We are still in testing/staging (NOT live). This script wipes every piece of
//   TEST BUSINESS DATA and all linked/derived records, then resets derived
//   per-user scores — leaving a clean baseline before fresh data is imported.
//
//   It does NOT touch system structure: code, schema, pages, settings, roles,
//   auth users (admin/managers/agents), permissions, team structure, templates,
//   saved filters, workflow DEFINITIONS, intake keys, custom-field DEFINITIONS,
//   or real Project/Unit property master data.
//
// WHAT GETS DELETED (test business + derived rows)
//   • CallLog                 (orphaned call history — leadId was SetNull on wipe)
//   • WhatsAppMessage         (orphaned WA history — leadId was SetNull on wipe)
//   • Notification            (every in-app bell item — all test/auto-generated)
//   • DailyMood               (end-of-day mood check-ins)
//   • VaultEntry              (private agent journal/mood/vent/win entries)
//   • WorkflowRun             (workflow EXECUTION rows — NOT the workflow defs)
//   • AuditLog                (action audit trail of test activity)
//   • Attendance              (daily present/late/absent rows)
//   • AttendanceLog           (login/logout tracking)
//   • Target                  (per-agent / per-team metric targets)   [see note]
//   • CronRun                 (cron health log rows)
//   • CustomFieldValue (LEAD) (custom-field values attached to deleted leads;
//                              PROJECT custom-field values are PRESERVED)
//   • Residual Lead-children  (Activity / Note / Assignment / StickyNote /
//                              LeadProperty / LeadProject — should already be 0
//                              via cascade, deleted here only if any survive)
//
// WHAT GETS RESET (NOT deleted — the User row + account stays intact)
//   • User gamification columns → xp=0, dailyStreak=0, followupStreak=0,
//                                 coldCallStreak=0, lastStreakDay=null, badges=""
//     (dailyCallTarget is a CONFIG goal, not progress — left untouched.)
//
// WHAT IS PRESERVED (never read for deletion)
//   • User accounts, roles, teams, reporting lines, photos, prefs
//   • Project, Unit            (real property master — see SURFACED note below)
//   • Setting                  (all config; we only FLIP testingMode ON)
//   • Template, SavedFilter    (message library + saved views)
//   • Workflow, WorkflowAction (automation DEFINITIONS)
//   • IntakeKey                (website / WhatsApp intake API keys)
//   • CustomField              (field DEFINITIONS; only LEAD VALUES are cleared)
//   • PushSubscription         (browser push device bindings — re-subscribe is
//                               automatic; deleting silently breaks push, so kept)
//
// SURFACED FOR A HUMAN (NOT auto-deleted)
//   • Project / Unit rows are LISTED in the report. The instruction says remove
//     real property master ONLY if it is dummy. The script can't know which
//     projects are dummy, so it never deletes them — it prints them for Lalit
//     to decide. Lead↔property LINKS (LeadProperty/LeadProject) are already gone.
//
// AUTOMATIONS
//   In --apply the FIRST write flips Setting "testingMode.enabled" → "true",
//   the master kill-switch that pauses round-robin, speed-to-lead, SLA
//   escalation, auto-flagging and overnight auto-WA. It is LEFT ON so the
//   upcoming fresh-data import doesn't trigger outbound spam. Turn it back OFF
//   from /settings only at go-live.
//
// SAFETY
//   • DEFAULT = DRY-RUN: counts everything, writes a JSON snapshot, deletes/writes
//     NOTHING. Only the explicit `--apply` flag performs writes.
//   • Both modes write a full JSON restore-point snapshot to
//     C:\Users\Lenovo\crm-lead-backups\ (OUTSIDE the repo).
//   • Each delete is wrapped in try/catch — one bad table never aborts the run.
//   • NEVER deletes Users, Projects, Units, Settings, Templates, Workflows,
//     SavedFilters, IntakeKeys, CustomField defs, or PushSubscriptions.
//
// INVOCATION (from repo root)
//   Dry-run (SAFE — reads only, writes a snapshot, deletes nothing):
//       npx tsx scripts/cleanup-testing-data.ts
//   Apply  (performs the cleanup):
//       npx tsx scripts/cleanup-testing-data.ts --apply
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ── tsx does not auto-load .env and the project has no dotenv dep, so the
//    script self-loads DATABASE_URL exactly like the sibling backfill scripts.
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return;
  const env = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*?)\s*$/);
    if (m) {
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env.DATABASE_URL = v;
      return;
    }
  }
  throw new Error("DATABASE_URL not found in .env");
}
loadDatabaseUrl();

const APPLY = process.argv.includes("--apply");

// Gamification defaults (must match prisma/schema.prisma User defaults).
const GAMIFICATION_RESET = {
  xp: 0,
  dailyStreak: 0,
  followupStreak: 0,
  coldCallStreak: 0,
  lastStreakDay: null as string | null,
  badges: "",
};

async function main() {
  const prisma = new PrismaClient();
  try {
    // ── LEAD-entity custom-field ids (so we only clear LEAD values, keep PROJECT) ─
    const leadCustomFieldIds = (
      await prisma.customField.findMany({ where: { entity: "LEAD" }, select: { id: true } })
    ).map((f) => f.id);

    // ── Count everything we intend to touch ──────────────────────────────────
    const [
      callLog, whatsAppMessage, notification, dailyMood, vaultEntry,
      workflowRun, auditLog, attendance, attendanceLog, target, cronRun,
      activity, note, assignment, stickyNote, leadProperty, leadProject,
      leadCfv,
    ] = await Promise.all([
      prisma.callLog.count(),
      prisma.whatsAppMessage.count(),
      prisma.notification.count(),
      prisma.dailyMood.count(),
      prisma.vaultEntry.count(),
      prisma.workflowRun.count(),
      prisma.auditLog.count(),
      prisma.attendance.count(),
      prisma.attendanceLog.count(),
      prisma.target.count(),
      prisma.cronRun.count(),
      prisma.activity.count(),
      prisma.note.count(),
      prisma.assignment.count(),
      prisma.stickyNote.count(),
      prisma.leadProperty.count(),
      prisma.leadProject.count(),
      leadCustomFieldIds.length
        ? prisma.customFieldValue.count({ where: { fieldId: { in: leadCustomFieldIds } } })
        : Promise.resolve(0),
    ]);

    // ── Preserved-table counts (printed so the report can prove they survived) ─
    const [
      users, leads, projects, units, settings, templates, savedFilters,
      workflows, workflowActions, intakeKeys, customFields, projectCfv,
      pushSubscriptions,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.lead.count(),
      prisma.project.count(),
      prisma.unit.count(),
      prisma.setting.count(),
      prisma.template.count(),
      prisma.savedFilter.count(),
      prisma.workflow.count(),
      prisma.workflowAction.count(),
      prisma.intakeKey.count(),
      prisma.customField.count(),
      prisma.customFieldValue.count({
        where: leadCustomFieldIds.length ? { fieldId: { notIn: leadCustomFieldIds } } : {},
      }),
      prisma.pushSubscription.count(),
    ]);

    // Users whose gamification columns are non-default (i.e. would be reset).
    const usersWithScores = await prisma.user.count({
      where: {
        OR: [
          { xp: { not: 0 } },
          { dailyStreak: { not: 0 } },
          { followupStreak: { not: 0 } },
          { coldCallStreak: { not: 0 } },
          { lastStreakDay: { not: null } },
          { badges: { not: "" } },
        ],
      },
    });

    // Project/Unit rows surfaced for the human dummy-vs-real decision.
    const projectList = await prisma.project.findMany({
      select: { id: true, name: true, developer: true, city: true, source: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const currentTestingMode = await prisma.setting.findUnique({ where: { key: "testingMode.enabled" } });

    const deleteCounts: Record<string, number> = {
      CallLog: callLog,
      WhatsAppMessage: whatsAppMessage,
      Notification: notification,
      DailyMood: dailyMood,
      VaultEntry: vaultEntry,
      WorkflowRun: workflowRun,
      AuditLog: auditLog,
      Attendance: attendance,
      AttendanceLog: attendanceLog,
      Target: target,
      CronRun: cronRun,
      "Activity (residual)": activity,
      "Note (residual)": note,
      "Assignment (residual)": assignment,
      "StickyNote (residual)": stickyNote,
      "LeadProperty (residual)": leadProperty,
      "LeadProject (residual)": leadProject,
      "CustomFieldValue (LEAD)": leadCfv,
    };
    const totalToDelete = Object.values(deleteCounts).reduce((a, b) => a + b, 0);

    // ── Full restore-point snapshot (written in BOTH dry-run and apply) ────────
    const backupDir = resolve(process.cwd(), "..", "crm-lead-backups");
    mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = resolve(backupDir, `cleanup-testing-data-${APPLY ? "apply" : "dryrun"}-${stamp}.json`);

    const snapshot = {
      takenAt: new Date().toISOString(),
      mode: APPLY ? "apply" : "dryrun",
      deleteCounts,
      preserved: {
        users, leads, projects, units, settings, templates, savedFilters,
        workflows, workflowActions, intakeKeys, customFields,
        "customFieldValue(PROJECT)": projectCfv, pushSubscriptions,
      },
      usersWithScores,
      currentTestingMode: currentTestingMode?.value ?? "(default false)",
      rows: {
        callLog: await prisma.callLog.findMany(),
        whatsAppMessage: await prisma.whatsAppMessage.findMany(),
        notification: await prisma.notification.findMany(),
        dailyMood: await prisma.dailyMood.findMany(),
        vaultEntry: await prisma.vaultEntry.findMany(),
        workflowRun: await prisma.workflowRun.findMany(),
        auditLog: await prisma.auditLog.findMany(),
        attendance: await prisma.attendance.findMany(),
        attendanceLog: await prisma.attendanceLog.findMany(),
        target: await prisma.target.findMany(),
        cronRun: await prisma.cronRun.findMany(),
        activity: activity ? await prisma.activity.findMany() : [],
        note: note ? await prisma.note.findMany() : [],
        assignment: assignment ? await prisma.assignment.findMany() : [],
        stickyNote: stickyNote ? await prisma.stickyNote.findMany() : [],
        leadProperty: leadProperty ? await prisma.leadProperty.findMany() : [],
        leadProject: leadProject ? await prisma.leadProject.findMany() : [],
        customFieldValueLead: leadCustomFieldIds.length
          ? await prisma.customFieldValue.findMany({ where: { fieldId: { in: leadCustomFieldIds } } })
          : [],
        // Gamification columns only — enough to restore scores without dumping PII.
        userGamification: await prisma.user.findMany({
          select: { id: true, name: true, xp: true, dailyStreak: true, followupStreak: true, coldCallStreak: true, lastStreakDay: true, badges: true },
        }),
      },
    };
    writeFileSync(backupPath, JSON.stringify(snapshot, null, 2), "utf8");

    // ── Report header ─────────────────────────────────────────────────────────
    console.log(`=== Testing-data cleanup — ${APPLY ? "APPLY (writing)" : "DRY RUN (read-only)"} ===\n`);
    console.log(`Snapshot written: ${backupPath}\n`);

    console.log("ROWS TO DELETE (test business + derived):");
    for (const [t, n] of Object.entries(deleteCounts)) console.log(`   ${t.padEnd(26)} ${n}`);
    console.log(`   ${"—".repeat(26)} —`);
    console.log(`   ${"TOTAL".padEnd(26)} ${totalToDelete}\n`);

    console.log("USER SCORES TO RESET (accounts kept, only gamification columns zeroed):");
    console.log(`   Users with non-default scores: ${usersWithScores} of ${users}\n`);

    console.log("PRESERVED (never deleted):");
    console.log(`   Users ${users} · Projects ${projects} · Units ${units} · Settings ${settings}`);
    console.log(`   Templates ${templates} · SavedFilters ${savedFilters} · Workflows ${workflows} (actions ${workflowActions})`);
    console.log(`   IntakeKeys ${intakeKeys} · CustomFields ${customFields} · CustomFieldValue(PROJECT) ${projectCfv} · PushSubscriptions ${pushSubscriptions}\n`);

    console.log(`Current testingMode.enabled: ${currentTestingMode?.value ?? "(unset → default false)"}`);
    console.log(`${APPLY ? "→ will be set to \"true\" (automations paused, left ON for fresh import)" : "→ would be set to \"true\" on --apply"}\n`);

    console.log(`PROJECT / UNIT MASTER — NOT auto-deleted (review for dummies):`);
    if (projectList.length === 0) {
      console.log("   (no projects)\n");
    } else {
      for (const p of projectList) {
        console.log(`   • ${p.name}${p.developer ? ` — ${p.developer}` : ""} (${p.city}) [source: ${p.source ?? "?"}] ${p.id}`);
      }
      console.log("");
    }

    if (!APPLY) {
      console.log("DRY RUN — nothing was deleted or changed. Re-run with --apply to perform the cleanup.");
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // --apply: perform the cleanup.
    // ─────────────────────────────────────────────────────────────────────────
    console.log("=== APPLYING ===\n");

    // 1) FIRST: pause automations (master kill-switch). Left ON afterwards.
    await prisma.setting.upsert({
      where: { key: "testingMode.enabled" },
      create: { key: "testingMode.enabled", value: "true" },
      update: { value: "true" },
    });
    console.log("   ✓ testingMode.enabled = true (automations paused)");

    // 2) Delete each test/derived table. Guard every one so a single failure
    //    never aborts the rest.
    const results: Record<string, number | string> = {};
    async function wipe(label: string, fn: () => Promise<{ count: number }>) {
      try {
        const r = await fn();
        results[label] = r.count;
        console.log(`   ✓ ${label.padEnd(26)} deleted ${r.count}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results[label] = `ERROR: ${msg}`;
        console.log(`   ✗ ${label.padEnd(26)} ${msg}`);
      }
    }

    await wipe("CallLog", () => prisma.callLog.deleteMany({}));
    await wipe("WhatsAppMessage", () => prisma.whatsAppMessage.deleteMany({}));
    await wipe("Notification", () => prisma.notification.deleteMany({}));
    await wipe("DailyMood", () => prisma.dailyMood.deleteMany({}));
    await wipe("VaultEntry", () => prisma.vaultEntry.deleteMany({}));
    await wipe("WorkflowRun", () => prisma.workflowRun.deleteMany({}));
    await wipe("AuditLog", () => prisma.auditLog.deleteMany({}));
    await wipe("Attendance", () => prisma.attendance.deleteMany({}));
    await wipe("AttendanceLog", () => prisma.attendanceLog.deleteMany({}));
    await wipe("Target", () => prisma.target.deleteMany({}));
    await wipe("CronRun", () => prisma.cronRun.deleteMany({}));
    // Residual Lead-children (normally already 0 via cascade).
    await wipe("Activity (residual)", () => prisma.activity.deleteMany({}));
    await wipe("Note (residual)", () => prisma.note.deleteMany({}));
    await wipe("Assignment (residual)", () => prisma.assignment.deleteMany({}));
    await wipe("StickyNote (residual)", () => prisma.stickyNote.deleteMany({}));
    await wipe("LeadProperty (residual)", () => prisma.leadProperty.deleteMany({}));
    await wipe("LeadProject (residual)", () => prisma.leadProject.deleteMany({}));
    if (leadCustomFieldIds.length) {
      await wipe("CustomFieldValue (LEAD)", () =>
        prisma.customFieldValue.deleteMany({ where: { fieldId: { in: leadCustomFieldIds } } }),
      );
    }

    // 3) Reset gamification columns on every user (accounts untouched).
    try {
      const r = await prisma.user.updateMany({ data: GAMIFICATION_RESET });
      results["User gamification reset"] = r.count;
      console.log(`   ✓ ${"User gamification reset".padEnd(26)} ${r.count} users zeroed`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results["User gamification reset"] = `ERROR: ${msg}`;
      console.log(`   ✗ User gamification reset ${msg}`);
    }

    // ── Post-cleanup verification — prove the test tables are now empty ────────
    const [
      vCallLog, vWa, vNotif, vMood, vVault, vWfRun, vAudit, vAtt, vAttLog,
      vTarget, vCron, vAct, vNote, vAssign, vSticky, vLeadProp, vLeadProj,
      vLeadCfv, vScores,
    ] = await Promise.all([
      prisma.callLog.count(),
      prisma.whatsAppMessage.count(),
      prisma.notification.count(),
      prisma.dailyMood.count(),
      prisma.vaultEntry.count(),
      prisma.workflowRun.count(),
      prisma.auditLog.count(),
      prisma.attendance.count(),
      prisma.attendanceLog.count(),
      prisma.target.count(),
      prisma.cronRun.count(),
      prisma.activity.count(),
      prisma.note.count(),
      prisma.assignment.count(),
      prisma.stickyNote.count(),
      prisma.leadProperty.count(),
      prisma.leadProject.count(),
      leadCustomFieldIds.length
        ? prisma.customFieldValue.count({ where: { fieldId: { in: leadCustomFieldIds } } })
        : Promise.resolve(0),
      prisma.user.count({
        where: {
          OR: [
            { xp: { not: 0 } }, { dailyStreak: { not: 0 } }, { followupStreak: { not: 0 } },
            { coldCallStreak: { not: 0 } }, { lastStreakDay: { not: null } }, { badges: { not: "" } },
          ],
        },
      }),
    ]);

    console.log("\n--- POST-CLEANUP VERIFICATION (all should be 0) ---");
    const verify: Record<string, number> = {
      CallLog: vCallLog, WhatsAppMessage: vWa, Notification: vNotif, DailyMood: vMood,
      VaultEntry: vVault, WorkflowRun: vWfRun, AuditLog: vAudit, Attendance: vAtt,
      AttendanceLog: vAttLog, Target: vTarget, CronRun: vCron, Activity: vAct, Note: vNote,
      Assignment: vAssign, StickyNote: vSticky, LeadProperty: vLeadProp, LeadProject: vLeadProj,
      "CustomFieldValue(LEAD)": vLeadCfv, "Users with scores": vScores,
    };
    let allClean = true;
    for (const [t, n] of Object.entries(verify)) {
      console.log(`   ${t.padEnd(24)} ${n}${n === 0 ? "" : "  ⚠ NOT EMPTY"}`);
      if (n !== 0) allClean = false;
    }

    // Confirm preserved tables are intact (counts unchanged).
    const [pUsers, pProjects, pUnits, pTemplates, pWorkflows, pIntake] = await Promise.all([
      prisma.user.count(), prisma.project.count(), prisma.unit.count(),
      prisma.template.count(), prisma.workflow.count(), prisma.intakeKey.count(),
    ]);
    console.log("\n--- PRESERVED (unchanged) ---");
    console.log(`   Users ${pUsers} · Projects ${pProjects} · Units ${pUnits} · Templates ${pTemplates} · Workflows ${pWorkflows} · IntakeKeys ${pIntake}`);

    console.log(`\n${allClean ? "✓ All test tables empty and scores reset." : "⚠ Some tables not empty — see above."}`);
    console.log("✓ testingMode.enabled is ON (automations paused). Turn OFF in /settings at go-live.");
    console.log(`\nSnapshot/restore point: ${backupPath}`);
    console.log("\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
