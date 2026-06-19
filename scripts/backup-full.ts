// COMPLETE backup — every table in the database (not the partial pre-deploy set).
import { prisma } from "../src/lib/prisma";
import { gzipSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";
(async () => {
  const tables: { table_name: string }[] = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  );
  const dump: Record<string, unknown[]> = {};
  let totalRows = 0;
  const summary: string[] = [];
  for (const { table_name } of tables) {
    const rows: unknown[] = await prisma.$queryRawUnsafe(`SELECT * FROM "${table_name}"`);
    dump[table_name] = rows;
    totalRows += rows.length;
    if (rows.length) summary.push(`${table_name}:${rows.length}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = `backups/FULL-${stamp}`;
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(dump, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const gz = gzipSync(Buffer.from(json));
  writeFileSync(`${dir}/full-snapshot.json.gz`, gz);
  console.log(`✅ COMPLETE backup → ${dir}/full-snapshot.json.gz (${(gz.length/1024/1024).toFixed(1)} MB)`);
  console.log(`   tables: ${tables.length} · total rows: ${totalRows}`);
  console.log(`   ${summary.join("  ")}`);
  await prisma.$disconnect();
})().catch((e) => { console.error("ERR", String(e)); process.exit(1); });
