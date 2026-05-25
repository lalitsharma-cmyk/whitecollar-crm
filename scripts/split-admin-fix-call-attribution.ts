// Three things in one script, run order matters:
//
// PHASE 1: backfill CallLog.attributedAgentName for every existing row by
//   parsing the agent prefix out of the notes field ("Nitisha: text" → "Nitisha").
//   Must run BEFORE renaming Lalit so the user.name lookups still resolve as expected
//   (though we don't actually USE user.name here — we use the prefix in notes).
//
// PHASE 2: rename current `lalit@whitecollarrealty.com` (the admin) to
//   `admin@wcrcrm.com`, name="Admin". His ADMIN role + permissions stay.
//
// PHASE 3: create a NEW user `lalit@wcrcrm.com`, name="Lalit Sharma",
//   role=MANAGER, team="HQ" — for Lalit's actual calling work. Manager role
//   so he can see all teams' leads + can call without the admin overlap.
//
// Generates fresh bcrypt passwords and prints them at the end. Lalit needs to
// store the new ones — old `lalit@whitecollarrealty.com` login stops working
// (the email itself changed).
//
// Idempotent-ish: if already run, the upserts no-op safely. Re-running won't
// re-randomise passwords for accounts that already moved.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

const p = new PrismaClient();

function genPassword(): string {
  // 14 chars: 3 word-ish + 3 digits + 2 symbols, base64-safe-readable.
  const raw = randomBytes(10).toString("base64").replace(/[+/=]/g, "");
  const digits = String(Math.floor(1000 + Math.random() * 9000));
  return `WCR-${raw}-${digits}`;
}

(async () => {
  console.log("═══ PHASE 1: Backfill call-log attribution ════════════════");
  const calls = await p.callLog.findMany({
    where: { attributedAgentName: null },
    select: { id: true, notes: true, userId: true },
  });
  console.log(`Scanning ${calls.length} call logs without attribution…`);
  // Parser: notes start with "Name: text". Name is one or two CamelCase tokens.
  const re = /^([A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15})?)\s*:\s*/;
  let attributed = 0;
  const byName = new Map<string, number>();
  for (const c of calls) {
    if (!c.notes) continue;
    const m = c.notes.match(re);
    if (!m) continue;
    const name = m[1].trim();
    await p.callLog.update({
      where: { id: c.id },
      data: { attributedAgentName: name },
    });
    attributed++;
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  console.log(`  ✓ Attributed ${attributed} of ${calls.length} calls.`);
  console.log("  Distribution:");
  const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [n, count] of top) console.log(`    ${n.padEnd(22)} ${count}`);

  console.log("\n═══ PHASE 2: Rename lalit@whitecollarrealty.com → admin@wcrcrm.com ════");
  const oldLalit = await p.user.findUnique({
    where: { email: "lalit@whitecollarrealty.com" },
  });
  let adminPassword: string | null = null;
  if (!oldLalit) {
    console.log("  ⚠ Existing lalit@whitecollarrealty.com not found — checking admin@wcrcrm.com");
    const adminExists = await p.user.findUnique({ where: { email: "admin@wcrcrm.com" } });
    console.log(adminExists ? "  ✓ admin@wcrcrm.com already exists, skipping." : "  ⚠ No admin to rename or create.");
  } else if (oldLalit.email === "admin@wcrcrm.com") {
    console.log("  ✓ Already renamed in a prior run.");
  } else {
    adminPassword = genPassword();
    await p.user.update({
      where: { id: oldLalit.id },
      data: {
        email: "admin@wcrcrm.com",
        name: "Admin",
        passwordHash: await bcrypt.hash(adminPassword, 10),
        // Keep role=ADMIN, team=HQ, active=true, all permissions intact.
      },
    });
    console.log(`  ✓ Renamed user ${oldLalit.id}: email→admin@wcrcrm.com  name→Admin`);
  }

  console.log("\n═══ PHASE 3: Create new lalit@wcrcrm.com (MANAGER) ════════════");
  let lalitPassword: string | null = null;
  const existingNew = await p.user.findUnique({ where: { email: "lalit@wcrcrm.com" } });
  if (existingNew) {
    console.log(`  ✓ lalit@wcrcrm.com already exists (id=${existingNew.id.slice(0, 8)}), skipping.`);
  } else {
    lalitPassword = genPassword();
    const created = await p.user.create({
      data: {
        email: "lalit@wcrcrm.com",
        name: "Lalit Sharma",
        passwordHash: await bcrypt.hash(lalitPassword, 10),
        role: "MANAGER",   // sees all teams, can call, separate from Admin
        team: "HQ",
        active: true,
        avatarColor: "bg-amber-500",
      },
    });
    console.log(`  ✓ Created user lalit@wcrcrm.com  role=MANAGER  id=${created.id}`);
  }

  console.log("\n═══ FINAL: Users in production ═══════════════════════════");
  const users = await p.user.findMany({
    select: { name: true, email: true, role: true, team: true, active: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  for (const u of users) {
    console.log(`  [${u.role.padEnd(7)}] ${u.name.padEnd(22)} ${u.email.padEnd(35)} team=${u.team ?? "—"} active=${u.active}`);
  }

  if (adminPassword || lalitPassword) {
    console.log("\n╔══════════════════════════════════════════════════════════╗");
    console.log("║ NEW LOGIN CREDENTIALS — store these somewhere safe       ║");
    console.log("╠══════════════════════════════════════════════════════════╣");
    if (adminPassword) {
      console.log(`║ Admin account                                            ║`);
      console.log(`║   Email:    admin@wcrcrm.com                             ║`);
      console.log(`║   Password: ${adminPassword.padEnd(45)}║`);
      console.log("║                                                          ║");
    }
    if (lalitPassword) {
      console.log(`║ Lalit Sharma (Manager)                                   ║`);
      console.log(`║   Email:    lalit@wcrcrm.com                             ║`);
      console.log(`║   Password: ${lalitPassword.padEnd(45)}║`);
    }
    console.log("╚══════════════════════════════════════════════════════════╝");
    console.log("\n⚠ The old lalit@whitecollarrealty.com login no longer works.");
  }

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
