// Bulk-import units (inventory) into a Project from pasted CSV text.
// ADMIN/MANAGER only. Body is JSON: { csv: string } — NOT multipart, keeps
// the client trivially simple (just a textarea + fetch).
//
// CSV format: header row required. Recognised columns (case-insensitive):
//   code, configuration, carpetArea, floor, view, priceBase, status
// `code`, `configuration`, `priceBase` are required per row; the rest optional.
// Each row upserts on the unique key @@unique([projectId, code]) so re-running
// the import safely updates existing units rather than duplicating them.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { UnitStatus, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

interface RowError {
  row: number;
  error: string;
}

// Tiny CSV parser — handles quoted fields, embedded commas/quotes ("" escape),
// CRLF and LF line endings. Good enough for admin paste-in; not RFC-perfect
// but doesn't need to be.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // swallow — handled by following \n or treat as line end
      if (text[i + 1] === "\n") {
        i++;
        continue;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush final field/row if file didn't end with newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop trailing empty rows (common when textarea ends with blank line).
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === "")) {
    rows.pop();
  }
  return rows;
}

function parseNum(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim();
  if (s === "") return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseInt32(v: string | undefined): number | null {
  const n = parseNum(v);
  if (n === null) return null;
  return Number.isInteger(n) ? n : Math.trunc(n);
}

function parseStatus(v: string | undefined): UnitStatus | null {
  if (!v) return null;
  const up = v.trim().toUpperCase();
  if (up === "") return null;
  if ((Object.values(UnitStatus) as string[]).includes(up)) {
    return up as UnitStatus;
  }
  return null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await requireRole("ADMIN", "MANAGER");
  const { id: projectId } = await params;

  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const csv = typeof body?.csv === "string" ? body.csv : "";
  if (!csv.trim()) {
    return NextResponse.json({ error: "csv body field is required" }, { status: 400 });
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return NextResponse.json(
      { error: "CSV must include a header row and at least one data row" },
      { status: 400 }
    );
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name.toLowerCase());
  const colCode = idx("code");
  const colCfg = idx("configuration");
  const colCarpet = idx("carpetArea");
  const colFloor = idx("floor");
  const colView = idx("view");
  const colPrice = idx("priceBase");
  const colStatus = idx("status");

  if (colCode < 0 || colCfg < 0 || colPrice < 0) {
    return NextResponse.json(
      {
        error:
          "Header must include at minimum: code, configuration, priceBase",
      },
      { status: 400 }
    );
  }

  let created = 0;
  let updated = 0;
  const errors: RowError[] = [];

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // Skip fully blank lines.
    if (cells.every((c) => c.trim() === "")) continue;

    const rowNum = r + 1; // human-friendly (1-based with header = row 1)
    const code = (cells[colCode] ?? "").trim();
    const configuration = (cells[colCfg] ?? "").trim();
    const priceBaseRaw = cells[colPrice];

    if (!code) {
      errors.push({ row: rowNum, error: "missing code" });
      continue;
    }
    if (!configuration) {
      errors.push({ row: rowNum, error: "missing configuration" });
      continue;
    }
    const priceBase = parseNum(priceBaseRaw);
    if (priceBase === null) {
      errors.push({ row: rowNum, error: "missing or invalid priceBase" });
      continue;
    }

    const carpetArea = colCarpet >= 0 ? parseNum(cells[colCarpet]) : null;
    const floor = colFloor >= 0 ? parseInt32(cells[colFloor]) : null;
    const view = colView >= 0 ? (cells[colView] ?? "").trim() || null : null;
    const statusVal = colStatus >= 0 ? parseStatus(cells[colStatus]) : null;

    try {
      const result = await prisma.unit.upsert({
        where: { projectId_code: { projectId, code } },
        create: {
          projectId,
          code,
          configuration,
          carpetArea: carpetArea ?? undefined,
          floor: floor ?? undefined,
          view: view ?? undefined,
          priceBase,
          ...(statusVal ? { status: statusVal } : {}),
        },
        update: {
          configuration,
          carpetArea: carpetArea ?? undefined,
          floor: floor ?? undefined,
          view: view ?? undefined,
          priceBase,
          ...(statusVal ? { status: statusVal } : {}),
        },
        select: { createdAt: true, updatedAt: true },
      });
      // Upsert doesn't tell us which path it took — infer from timestamps.
      if (result.createdAt.getTime() === result.updatedAt.getTime()) {
        created++;
      } else {
        updated++;
      }
    } catch (e) {
      const msg =
        e instanceof Prisma.PrismaClientKnownRequestError
          ? `db error ${e.code}`
          : e instanceof Error
            ? e.message
            : "unknown error";
      errors.push({ row: rowNum, error: msg });
    }
  }

  return NextResponse.json({ ok: true, created, updated, errors });
}
