// ─────────────────────────────────────────────────────────────────────────────
// backfill-phone-normalize.ts — ONE-TIME historical phone + fingerprint backfill
// ─────────────────────────────────────────────────────────────────────────────
//
// PURPOSE
//   Lead de-duplication at intake relies on the stored `fingerprint` column on
//   the Lead model. The fingerprint is `fingerprintFor(phone, email)` =
//   "<digits-of-phone>|<lowercased-email>". At intake the phone is FIRST passed
//   through normalizePhone() (canonical E.164, e.g. a bare Indian 10-digit number
//   "9876543210" → "+919876543210"), so NEW rows get a canonical fingerprint
//   (digits "919876543210|…").
//
//   But HISTORICAL rows created before that normalization landed may carry a
//   fingerprint built from a NON-canonical phone — e.g. "9876543210|" instead of
//   "919876543210|". Consequence: a returning client slips in as a brand-new lead
//   because the old and new fingerprints don't match.
//
//   This script recomputes each lead's normalized `phone` / `altPhone` and
//   `fingerprint` so that FUTURE intake dedupes against the canonical form.
//
// SAFETY (this WILL eventually be run against PRODUCTION by a non-technical owner)
//   • DEFAULT = DRY-RUN: read-only, prints a plain-text report, writes NOTHING.
//   • Only the explicit `--apply` flag performs writes.
//   • NEVER deletes anything.
//   • NEVER throws on the unique-`fingerprint` constraint — collisions are
//     DETECTED, SKIPPED, and REPORTED for a human to merge.
//   • NEVER auto-merges duplicates. Merging is a human decision made in the app
//     at /admin/duplicates. This script only surfaces the clusters.
//   • NEVER blanks a phone number: if normalizePhone() returns null we keep the
//     original value untouched.
//   • In --apply mode every row's write is wrapped in try/catch — a single bad
//     row logs and is skipped; the run never aborts midway.
//
// WHAT GETS WRITTEN (only in --apply, only the fields that actually changed)
//   • phone        → normalized E.164 (or left as-is if normalize returns null)
//   • altPhone     → normalized E.164 (or left as-is if normalize returns null)
//   • fingerprint  → recomputed from (normalized phone + email), ONLY when it
//                    changed AND the new value isn't already taken by another row
//                    (the column is @unique). Phone/altPhone are NOT unique, so
//                    they are always safe to write even when the fingerprint is
//                    skipped due to a collision.
//
// INVOCATION (run from the repo root, same convention as the sibling
//             backfill-phones.ts / backfill-split-phones.ts scripts)
//   Dry-run (SAFE — reads only, writes nothing, OK against prod):
//       npx tsx scripts/backfill-phone-normalize.ts
//   Apply  (writes the changes):
//       npx tsx scripts/backfill-phone-normalize.ts --apply
//
// ─────────────────────────────────────────────────────────────────────────────

import { PrismaClient } from "@prisma/client";
import { normalizePhone } from "../src/lib/phone";

// ── INLINED copy of fingerprintFor (do NOT import from src/lib/assignment.ts —
//    that module starts with `import "server-only"` and would crash a plain
//    tsx script). This is a byte-for-byte copy of the intake helper so the
//    fingerprints we compute match exactly what live intake produces.
function fingerprintFor(phone?: string | null, email?: string | null) {
  const p = (phone ?? "").replace(/\D/g, "");
  const e = (email ?? "").toLowerCase().trim();
  if (!p && !e) return null;
  return `${p}|${e}`;
}

const apply = process.argv.includes("--apply");

// A small, readable rendering for null/empty values in the dry-run report.
function show(v: string | null | undefined): string {
  return v === null || v === undefined || v === "" ? "(none)" : v;
}

type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  fingerprint: string | null;
};

type Plan = {
  lead: LeadRow;
  newPhone: string | null;
  newAlt: string | null;
  newFp: string | null;
  phoneChanged: boolean;
  altChanged: boolean;
  fpChanged: boolean;
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const leads: LeadRow[] = await prisma.lead.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        altPhone: true,
        email: true,
        fingerprint: true,
      },
    });

    // ── Build the plan for every lead ────────────────────────────────────────
    const plans: Plan[] = leads.map((lead) => {
      // Keep the ORIGINAL value if normalize returns null — never blank a number.
      const newPhone = lead.phone ? normalizePhone(lead.phone) ?? lead.phone : lead.phone;
      const newAlt = lead.altPhone ? normalizePhone(lead.altPhone) ?? lead.altPhone : lead.altPhone;
      // Fingerprint uses the SAME inputs intake uses: normalized PRIMARY phone +
      // email. altPhone is intentionally NOT part of the fingerprint.
      const newFp = fingerprintFor(newPhone, lead.email);

      return {
        lead,
        newPhone,
        newAlt,
        newFp,
        phoneChanged: newPhone !== lead.phone,
        altChanged: newAlt !== lead.altPhone,
        fpChanged: newFp !== lead.fingerprint,
      };
    });

    const phoneChanges = plans.filter((p) => p.phoneChanged);
    const altChanges = plans.filter((p) => p.altChanged);
    const fpChanges = plans.filter((p) => p.fpChanged);

    // ── Collision detection: which NEW fingerprints would be shared by ≥2 rows? ─
    // The fingerprint column is @unique, so two rows can't both hold the same
    // value. A shared newFp is therefore a real duplicate cluster that
    // normalization has surfaced — a human must merge it in /admin/duplicates.
    const byNewFp = new Map<string, LeadRow[]>();
    for (const p of plans) {
      if (!p.newFp) continue;
      const arr = byNewFp.get(p.newFp);
      if (arr) arr.push(p.lead);
      else byNewFp.set(p.newFp, [p.lead]);
    }
    const collisionClusters = [...byNewFp.entries()].filter(([, rows]) => rows.length >= 2);

    // ─────────────────────────────────────────────────────────────────────────
    // DRY-RUN (default): print a plain-text report, write NOTHING.
    // ─────────────────────────────────────────────────────────────────────────
    if (!apply) {
      console.log("=== Phone + fingerprint backfill — DRY RUN (read-only) ===\n");
      console.log(`Total leads scanned:            ${leads.length}`);
      console.log(`Phones that would change:       ${phoneChanges.length}`);
      console.log(`Alt phones that would change:   ${altChanges.length}`);
      console.log(`Fingerprints that would change: ${fpChanges.length}`);

      // Sample rows — show the most meaningful ones first (anything where the
      // fingerprint changes), then any remaining phone-only changes, up to ~30.
      const sampleSource = [
        ...plans.filter((p) => p.fpChanged),
        ...plans.filter((p) => !p.fpChanged && (p.phoneChanged || p.altChanged)),
      ];
      const samples = sampleSource.slice(0, 30);
      if (samples.length > 0) {
        console.log(`\n--- Sample of changes (showing ${samples.length} of ${sampleSource.length}) ---`);
        for (const p of samples) {
          console.log(
            `${p.lead.name}:  ${show(p.lead.phone)} → ${show(p.newPhone)}   ` +
              `fp ${show(p.lead.fingerprint)} → ${show(p.newFp)}`,
          );
        }
      } else {
        console.log("\nNo phone/fingerprint changes detected — data already canonical.");
      }

      // Collision clusters — what a human will need to merge after applying.
      if (collisionClusters.length > 0) {
        console.log(
          `\n⚠ ${collisionClusters.length} duplicate clusters would surface — ` +
            `review & merge in /admin/duplicates:`,
        );
        for (const [fp, rows] of collisionClusters) {
          console.log(`   fingerprint ${fp}`);
          for (const r of rows) {
            console.log(`   • ${r.name} (${r.id})`);
          }
        }
      } else {
        console.log("\nNo duplicate clusters would surface.");
      }

      console.log("\nDRY RUN — nothing was written. Re-run with --apply to write changes.");
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // --apply: write the changes.
    // ─────────────────────────────────────────────────────────────────────────
    console.log("=== Phone + fingerprint backfill — APPLY (writing changes) ===\n");

    // Seed the "taken" set with every CURRENT fingerprint we are NOT going to
    // change. Those values stay occupied, so a recomputed fingerprint that
    // happens to equal one of them must be skipped to avoid a unique-constraint
    // violation. As we successfully write a new fingerprint we add it too.
    const takenFingerprints = new Set<string>();
    for (const p of plans) {
      if (!p.fpChanged && p.lead.fingerprint) takenFingerprints.add(p.lead.fingerprint);
    }

    let rowsUpdated = 0;
    let fingerprintsRewritten = 0;
    const collisionSkipped: { id: string; name: string; newFp: string }[] = [];
    const errors: { id: string; name: string; message: string }[] = [];

    for (const p of plans) {
      // Decide whether we may write the new fingerprint:
      //   • it must be non-null
      //   • it must actually be changing
      //   • it must NOT already be taken by another row (column is @unique)
      let writeFp = false;
      if (p.newFp && p.fpChanged) {
        if (takenFingerprints.has(p.newFp)) {
          // A different row already holds this fingerprint → real duplicate.
          // Skip the fingerprint write (still apply the safe phone normalization)
          // and record it for the owner to merge by hand in /admin/duplicates.
          collisionSkipped.push({ id: p.lead.id, name: p.lead.name, newFp: p.newFp });
        } else {
          writeFp = true;
        }
      }

      // Build the data object with ONLY the fields that changed. phone/altPhone
      // are not unique so they are always safe; fingerprint only when writeFp.
      const data: { phone?: string | null; altPhone?: string | null; fingerprint?: string | null } = {};
      if (p.phoneChanged) data.phone = p.newPhone;
      if (p.altChanged) data.altPhone = p.newAlt;
      if (writeFp) data.fingerprint = p.newFp;

      // Nothing to do for this row.
      if (Object.keys(data).length === 0) continue;

      try {
        await prisma.lead.update({ where: { id: p.lead.id }, data });
        rowsUpdated++;
        if (writeFp && p.newFp) {
          fingerprintsRewritten++;
          takenFingerprints.add(p.newFp); // now occupied
        }
      } catch (e) {
        // Never abort the whole run on a single bad row (incl. any unique-
        // constraint race we didn't pre-detect).
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ id: p.lead.id, name: p.lead.name, message });
        console.log(`   ✗ skipped ${p.lead.name} (${p.lead.id}): ${message}`);
      }
    }

    // ── Final summary ─────────────────────────────────────────────────────────
    console.log("\n--- Summary ---");
    console.log(`Rows updated:            ${rowsUpdated}`);
    console.log(`Fingerprints rewritten:  ${fingerprintsRewritten}`);
    console.log(`Fingerprints skipped (duplicate — merge manually): ${collisionSkipped.length}`);
    for (const c of collisionSkipped) {
      console.log(`   • ${c.name} (${c.id})  wanted fp ${c.newFp}`);
    }
    console.log(`Errors:                  ${errors.length}`);
    for (const er of errors) {
      console.log(`   • ${er.name} (${er.id}): ${er.message}`);
    }
    if (collisionSkipped.length > 0) {
      console.log(
        "\n⚠ Duplicate clusters were left untouched. Review & merge them in /admin/duplicates.",
      );
    }
    console.log("\nDone.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
