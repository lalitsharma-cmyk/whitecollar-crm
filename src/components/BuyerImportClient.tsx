"use client";
import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

// Buyer transaction import with a COLUMN-MAPPING WIZARD. Auto-detects the header
// row, then shows EVERY sheet column with a per-column decision:
//   • Match to a known BuyerRecord field (dropdown)  — pre-filled by auto-detection,
//   • Keep as a new field (preserved verbatim in extraFields under its column name),
//   • Skip (drop this column).
// NEVER loses data: anything not explicitly matched/skipped is kept in extraFields.
// Admin-only (page + API both gate it). Only clientName is required; transactionDate
// comes from the sheet (Excel serials & dd/mm/yyyy supported).

const BUYER_FIELDS: [string, string][] = [
  ["clientName", "Client Name"], ["coBuyerNames", "Co-buyers"], ["phones", "Phone(s)"], ["emails", "Email(s)"],
  ["passport", "Passport"], ["nationality", "Nationality"],
  ["projectName", "Project"], ["tower", "Tower / Building"], ["unitNumber", "Unit Number"],
  ["propertyType", "Property Type"], ["configuration", "Configuration"],
  ["transactionValue", "Transaction Value"], ["pricePerSqFt", "Price / sq.ft"],
  ["transactionDate", "Transaction Date"], ["transactionId", "Transaction ID"],
  ["agentName", "Agent"],
  // Remarks / notes / activity history → BuyerRecord.remarks (verbatim Raw History +
  // a derived Smart Timeline). Parity with the Lead import's Remarks mapping.
  ["remarks", "Remarks / Notes"],
];
const FIELD_LABEL = Object.fromEntries(BUYER_FIELDS) as Record<string, string>;

const GUESS: Record<string, string[]> = {
  clientName: ["client name", "buyer name", "customer name", "name of buyer", "purchaser", "owner name", "name"],
  coBuyerNames: ["co buyer", "co-buyer", "joint buyer", "co applicant", "co-applicant", "second buyer", "family"],
  phones: ["phone", "mobile", "contact", "contact number", "mobile number", "phone number", "cell"],
  emails: ["email", "email id", "e-mail", "mail", "email address"],
  passport: ["passport", "passport no", "passport number"],
  nationality: ["nationality", "country", "citizenship"],
  projectName: ["project", "project name", "development", "property name", "building project"],
  tower: ["tower", "building", "block", "wing"],
  unitNumber: ["unit", "unit no", "unit number", "apartment", "flat", "villa no", "apt"],
  propertyType: ["property type", "type", "asset type", "category"],
  configuration: ["configuration", "config", "bhk", "bedrooms", "layout", "unit type"],
  transactionValue: ["transaction value", "deal value", "sale price", "price", "amount", "value", "consideration", "total value", "sale value"],
  pricePerSqFt: ["price per sqft", "price per sq ft", "psf", "rate", "per sqft", "price/sqft", "rate per sqft"],
  transactionDate: ["transaction date", "deal date", "booking date", "date of sale", "sale date", "agreement date", "date", "purchase date"],
  transactionId: ["transaction id", "deal id", "booking id", "reference", "ref no", "transaction ref", "deal reference"],
  agentName: ["agent", "agent name", "sales agent", "broker", "rm", "relationship manager", "sold by"],
  remarks: ["remarks", "remark", "notes", "note", "comments", "comment", "follow-up notes", "followup notes", "activity history", "activity", "conversation", "history", "status", "follow-up", "followup", "follow up"],
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isJunkHeader = (h: string) => !h || !h.trim() || /^__empty/i.test(h.trim());
const ALL_SYN = (() => { const s = new Set<string>(); for (const f in GUESS) GUESS[f].forEach((x) => s.add(x)); return [...s]; })();
function fieldMatchCount(cells: string[]): number {
  let score = 0;
  for (const c of cells) { const n = norm(c); if (!n) continue; if (ALL_SYN.some((s) => n === s || n.includes(s) || s.includes(n))) score++; }
  return score;
}
function detectHeaderRow(grid: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(20, grid.length); i++) {
    const s = fieldMatchCount(grid[i] ?? []);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  return best;
}

// A per-column decision. target = a BuyerRecord field name, or "__keep" (extraFields)
// or "__skip" (drop). Auto-detection pre-fills known columns to their field; unknown
// columns default to "__keep" so NO data is lost unless the admin chooses to skip.
type ColTarget = string; // field name | "__keep" | "__skip"
const KEEP = "__keep";
const SKIP = "__skip";

function guessColumnMap(headers: string[]): Record<string, ColTarget> {
  const out: Record<string, ColTarget> = {};
  const takenFields = new Set<string>();
  // First pass: assign each header to its best-matching field (one field per column).
  for (const h of headers) {
    const nh = norm(h);
    let matched: string | null = null;
    for (const [field] of BUYER_FIELDS) {
      if (takenFields.has(field)) continue;
      const cands = (GUESS[field] ?? [field]).map(norm);
      if (cands.includes(nh) || cands.some((c) => nh.includes(c) || c.includes(nh))) { matched = field; break; }
    }
    if (matched) { out[h] = matched; takenFields.add(matched); }
    else out[h] = KEEP; // unknown → preserved in extraFields by default
  }
  return out;
}

export default function BuyerImportClient() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "run" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [colMap, setColMap] = useState<Record<string, ColTarget>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, updated: 0, skipped: 0, failed: 0 });
  const [batchId, setBatchId] = useState<string | null>(null);
  // Duplicate handling — what to do with a row that matches an existing live buyer
  // (by buyerKey / phone / email). Default "skip" never creates a duplicate.
  const [dupMode, setDupMode] = useState<"skip" | "update" | "create" | "history">("skip");

  function applyHeaderRow(g: string[][], hr: number) {
    const raw = (g[hr] ?? []).map((c) => String(c ?? "").trim());
    const data = g.slice(hr + 1).map((row) => {
      const o: Record<string, string> = {};
      raw.forEach((h, j) => { if (!isJunkHeader(h)) o[h] = String(row[j] ?? "").trim(); });
      return o;
    }).filter((o) => Object.values(o).some((v) => v !== ""));
    const clean = raw.filter((h) => !isJunkHeader(h));
    setHeaders(clean); setRows(data); setColMap(guessColumnMap(clean)); setHeaderRow(hr);
  }

  async function onFile(file: File) {
    setErr(null); setNote(null); setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const g = (XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "", blankrows: false }) as unknown[][])
        .map((r) => r.map((c) => String(c ?? "").trim()));
      if (g.length < 2) { setErr("That file has no data rows."); return; }
      setGrid(g);
      applyHeaderRow(g, detectHeaderRow(g));
      setStep("map");
    } catch {
      setErr("Could not read that file. Use .xlsx or .csv.");
    }
  }

  // Derived: which field each known column maps to, and the field→column inverse.
  const fieldToCol = useMemo(() => {
    const inv: Record<string, string> = {};
    for (const [col, target] of Object.entries(colMap)) {
      if (target !== KEEP && target !== SKIP && !inv[target]) inv[target] = col;
    }
    return inv;
  }, [colMap]);

  const keptCols = headers.filter((h) => colMap[h] === KEEP);
  const skippedCols = headers.filter((h) => colMap[h] === SKIP);
  const matchedCols = headers.filter((h) => colMap[h] !== KEEP && colMap[h] !== SKIP);
  const canImport = !!fieldToCol.clientName;
  const valOf = (r: Record<string, string>, col?: string) => (col ? (r[col] ?? "").trim() : "");
  const validRows = rows.filter((r) => valOf(r, fieldToCol.clientName)).length;

  // When the admin matches a column to a field already used by another column, free
  // the old column (one field ↔ one column).
  function setColTarget(col: string, target: ColTarget) {
    setColMap((prev) => {
      const next = { ...prev, [col]: target };
      if (target !== KEEP && target !== SKIP) {
        for (const [c, t] of Object.entries(next)) if (c !== col && t === target) next[c] = KEEP;
      }
      return next;
    });
  }

  async function runImport() {
    if (!canImport) { setErr("Match a column to Client Name first."); return; }
    setErr(null); setNote("⏳ Import started…");
    setStep("run");

    // Build mapped rows + preserve every KEEP column into _extra. SKIP columns dropped.
    // `_raw` keeps the COMPLETE original row (every column, verbatim) so the server can
    // store it on BuyerRecord.rawImport — nothing is ever lost, even SKIP'd columns.
    type MappedRow = Record<string, string | Record<string, string>> & { _extra: Record<string, string>; _raw: Record<string, string>; clientName?: string };
    const mapped: MappedRow[] = rows.map((r) => {
      const extra: Record<string, string> = {};
      const raw: Record<string, string> = {};
      const o: MappedRow = { _extra: extra, _raw: raw };
      for (const [field, col] of Object.entries(fieldToCol)) o[field] = r[col] ?? "";
      for (const h of keptCols) { const v = (r[h] ?? "").trim(); if (v) extra[h] = v; }
      // rawImport = every column of the source row, verbatim (incl. mapped + skipped).
      for (const h of headers) { const v = (r[h] ?? "").trim(); if (v) raw[h] = v; }
      return o;
    }).filter((o) => String(o.clientName ?? "").trim());

    if (mapped.length === 0) { setErr("No rows have a Client Name — nothing to import."); setNote("❌ Every row is missing Client Name."); setStep("map"); return; }

    let bid: string | null = null;
    try {
      const r0 = await fetch("/api/buyer-data/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ init: true, source: "Excel file", sourceRef: fileName, total: mapped.length }) });
      const j0 = await r0.json();
      if (!r0.ok) { setNote(`❌ ${j0.error ?? "Could not start import."}`); setErr(j0.error ?? "Import init failed."); setStep("map"); return; }
      bid = j0.id ?? null;
      setBatchId(bid);
    } catch { setNote("❌ Could not start import (network)."); setStep("map"); return; }

    const BATCH = 200;
    const acc = { imported: 0, updated: 0, skipped: 0, failed: 0 };
    setProgress({ done: 0, total: mapped.length, ...acc });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/buyer-data/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: bid, rows: chunk, rowOffset: i, sourceFile: fileName, dupMode }),
        });
        const j = await res.json();
        if (!res.ok) { setNote(`❌ Import failed: ${j.error ?? "server error"}`); setErr(j.error ?? "Import failed."); setStep("map"); return; }
        acc.imported += j.imported || 0; acc.updated += j.updated || 0; acc.skipped += j.skipped || 0; acc.failed += j.failed || 0;
      } catch { acc.failed += chunk.length; }
      setProgress({ done: Math.min(i + BATCH, mapped.length), total: mapped.length, ...acc });
    }
    const bits = [`✅ Imported ${acc.imported} record${acc.imported !== 1 ? "s" : ""}`];
    if (acc.updated) bits.push(`${acc.updated} updated`);
    if (acc.skipped) bits.push(`${acc.skipped} duplicate${acc.skipped !== 1 ? "s" : ""} skipped`);
    if (acc.failed) bits.push(`${acc.failed} failed`);
    setNote(`${bits.join(" · ")}.`);
    setStep("done");
    router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-2 text-base sm:text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const rowPreview = (cells: string[]) => cells.filter((c) => c && c.trim()).slice(0, 6).join("  ·  ") || "(blank row)";
  const sampleValue = (h: string) => { for (const r of rows) { const v = (r[h] ?? "").trim(); if (v) return v; } return ""; };

  return (
    <div className="card p-5 space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
      {note && <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200">{note}</div>}

      {step === "upload" && (
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="text-3xl mb-2">📥</div>
          <div className="text-sm text-gray-600 dark:text-slate-300">Drop a <b>Excel (.xlsx)</b> or <b>CSV</b> file of buyer transactions, or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b></div>
          <div className="text-[11px] text-gray-400 mt-1">Header row auto-detected · map each column (or keep it as-is) · no data is dropped.</div>
        </label>
      )}

      {step === "map" && (
        <div className="space-y-4">
          {/* Header-row picker */}
          <div className="bg-gray-50 dark:bg-slate-800/50 rounded-lg p-3 space-y-1.5">
            <div className="text-xs font-semibold text-gray-600 dark:text-slate-300">Header row <span className="font-normal text-gray-400">— auto-detected</span></div>
            {grid.slice(0, Math.min(8, grid.length)).map((r, i) => (
              <label key={i} className={`flex items-start gap-2 text-xs cursor-pointer rounded px-1.5 py-1 ${headerRow === i ? "bg-white dark:bg-slate-700 ring-1 ring-[#1a2e4a]/30" : ""}`}>
                <input type="radio" name="hr" checked={headerRow === i} onChange={() => applyHeaderRow(grid, i)} className="mt-0.5" />
                <span className="text-gray-400 shrink-0">Row {i + 1}:</span>
                <span className="text-gray-700 dark:text-slate-200 truncate">{rowPreview(r)}</span>
              </label>
            ))}
          </div>

          <div className="text-sm text-gray-600 dark:text-slate-300">
            <b>{rows.length}</b> data rows · <b>{headers.length}</b> columns from <b>{fileName}</b> · <b className="text-green-700 dark:text-green-400">{validRows}</b> with a client name
          </div>

          {/* ── COLUMN MAPPING WIZARD ──────────────────────────────────────── */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-gray-500">✨ Each sheet column — match to a field, keep as a new field, or skip. Auto-mapped — review &amp; correct.</div>
            <button type="button" onClick={() => setColMap(guessColumnMap(headers))} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:border-slate-600">↻ Re-auto-map</button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500 dark:text-slate-400">
                <th className="px-2 py-1.5">Sheet column</th><th className="px-2 py-1.5">Sample</th><th className="px-2 py-1.5">Maps to</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {headers.map((h) => {
                  const target = colMap[h] ?? KEEP;
                  const tone = target === SKIP ? "opacity-50" : "";
                  return (
                    <tr key={h} className={tone}>
                      <td className="px-2 py-1.5 font-medium text-gray-700 dark:text-slate-200 whitespace-nowrap max-w-[180px] truncate" title={h}>{h}</td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-slate-400 max-w-[160px] truncate" title={sampleValue(h)}>{sampleValue(h) || <span className="text-gray-300">—</span>}</td>
                      <td className="px-2 py-1.5">
                        <select value={target} onChange={(e) => setColTarget(h, e.target.value)}
                          className={`border rounded-lg px-2 py-1.5 text-base sm:text-sm dark:bg-slate-800 dark:text-slate-100 ${target !== KEEP && target !== SKIP ? "border-green-300" : target === SKIP ? "border-gray-200" : "border-emerald-200"}`}>
                          <optgroup label="Match to field">
                            {BUYER_FIELDS.map(([f, l]) => {
                              const usedElsewhere = fieldToCol[f] && fieldToCol[f] !== h;
                              return <option key={f} value={f} disabled={!!usedElsewhere}>{l}{f === "clientName" ? " (required)" : ""}{usedElsewhere ? " — used" : ""}</option>;
                            })}
                          </optgroup>
                          <option value={KEEP}>＋ Keep as new field (preserved)</option>
                          <option value={SKIP}>✕ Skip this column</option>
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mapping summary */}
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-green-800 dark:bg-green-900/20 dark:border-green-700 dark:text-green-300">{matchedCols.length} matched to fields</span>
            <span className="rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300">{keptCols.length} kept as new fields</span>
            {skippedCols.length > 0 && <span className="rounded-full bg-gray-100 border border-gray-200 px-2.5 py-1 text-gray-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400">{skippedCols.length} skipped</span>}
          </div>
          {keptCols.length > 0 && (
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300">Kept verbatim in “Imported Fields”: <b>{keptCols.join(", ")}</b></div>
          )}

          {/* Preview */}
          {matchedCols.length > 0 && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="text-[11px] w-full">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500">{matchedCols.map((h) => <th key={h} className="px-2 py-1 whitespace-nowrap">{FIELD_LABEL[colMap[h]]}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.slice(0, 5).map((r, i) => <tr key={i}>{matchedCols.map((h) => <td key={h} className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-slate-300 max-w-[140px] truncate">{r[h] ?? ""}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}

          {/* ── DUPLICATE HANDLING ──────────────────────────────────────────
              What to do with a row that matches an EXISTING live buyer (matched
              by name+phone / phone / email). Default "Skip" never creates a
              duplicate on re-import. (Reference pattern: HR import's radio.) */}
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-1.5">
            <div className="text-xs font-semibold text-gray-600 dark:text-slate-300">If a buyer already exists (matched by phone / email / name)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-sm">
              {([
                ["skip", "Skip duplicate", "Leave the existing buyer untouched (no duplicate row)."],
                ["update", "Update existing", "Fill the existing buyer's blank fields + add the new remark to its history."],
                ["history", "Add to conversation history", "Append only the imported remark/notes to the existing buyer's timeline."],
                ["create", "Create new anyway", "Import as a brand-new buyer even though one matches."],
              ] as const).map(([val, label, hint]) => (
                <label key={val} className={`flex items-start gap-2 cursor-pointer rounded-lg px-2 py-1.5 border ${dupMode === val ? "border-[#1a2e4a] bg-[#1a2e4a]/5 dark:bg-blue-900/20" : "border-transparent hover:bg-gray-50 dark:hover:bg-slate-800"}`}>
                  <input type="radio" name="dupMode" className="mt-0.5" checked={dupMode === val} onChange={() => setDupMode(val)} />
                  <span className="min-w-0">
                    <span className="font-medium text-gray-800 dark:text-slate-100">{label}</span>
                    <span className="block text-[11px] text-gray-500 dark:text-slate-400">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {!canImport ? (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5"><b>Cannot import:</b> match a column to <b>Client Name</b> above.</div>
          ) : (
            <div className="text-[11px] text-green-700 dark:text-green-400">✓ Ready — {validRows} valid rows.</div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={runImport} disabled={!canImport}
              className={`btn justify-center ${canImport ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
              title={canImport ? "" : "Match Client Name first"}>
              Confirm &amp; Import {validRows || rows.length}
            </button>
            <button type="button" onClick={() => setStep("upload")} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm dark:text-slate-300 dark:border-slate-600">Back</button>
          </div>
        </div>
      )}

      {step === "run" && (
        <div className="space-y-3 py-4">
          <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">Importing… {progress.done} / {progress.total}</div>
          <div className="w-full h-3 bg-gray-100 dark:bg-slate-800 rounded-full overflow-hidden"><div className="h-full bg-[#1a2e4a] transition-all" style={{ width: `${pct}%` }} /></div>
          <div className="text-[11px] text-gray-500">✅ {progress.imported} imported{progress.updated ? ` · ✏ ${progress.updated} updated` : ""}{progress.skipped ? ` · ⏭ ${progress.skipped} skipped` : ""} · ⚠ {progress.failed} failed — keep this tab open.</div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3 text-center py-4">
          <div className="text-4xl">🎉</div>
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">Import complete</div>
          <div className="text-sm text-gray-600 dark:text-slate-300">✅ {progress.imported} imported{progress.updated ? ` · ✏ ${progress.updated} updated` : ""}{progress.skipped ? ` · ⏭ ${progress.skipped} duplicate${progress.skipped !== 1 ? "s" : ""} skipped` : ""} · ⚠ {progress.failed} failed</div>
          {progress.failed > 0 && batchId && (
            <div className="text-[11px] text-gray-500">Failed rows are logged with the reason (batch {batchId.slice(0, 8)}…).</div>
          )}
          <div className="flex gap-2 justify-center">
            <Link href="/buyer-data" className="btn btn-primary justify-center">View buyer data</Link>
            <button type="button" onClick={() => { setStep("upload"); setGrid([]); setHeaders([]); setRows([]); setColMap({}); setNote(null); setBatchId(null); setDupMode("skip"); }} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm dark:text-slate-300 dark:border-slate-600">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}
