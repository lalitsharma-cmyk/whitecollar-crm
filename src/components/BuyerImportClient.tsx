"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

// Buyer transaction import — clones the HR import UX (auto-detect header row,
// map sheet columns to BuyerRecord fields, preserve EVERY unmapped column into
// extraFields). Admin-only (the page + the API both gate it). Only clientName is
// required; everything else is optional. transactionDate comes from the sheet.

const BUYER_FIELDS: [string, string][] = [
  ["clientName", "Client Name"], ["coBuyerNames", "Co-buyers"], ["phones", "Phone(s)"], ["emails", "Email(s)"],
  ["passport", "Passport"], ["nationality", "Nationality"],
  ["projectName", "Project"], ["tower", "Tower / Building"], ["unitNumber", "Unit Number"],
  ["propertyType", "Property Type"], ["configuration", "Configuration"],
  ["transactionValue", "Transaction Value"], ["pricePerSqFt", "Price / sq.ft"],
  ["transactionDate", "Transaction Date"], ["transactionId", "Transaction ID"],
  ["agentName", "Agent"],
];

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
};
const ALL_SYN = (() => { const s = new Set<string>(); for (const f in GUESS) GUESS[f].forEach((x) => s.add(x)); return [...s]; })();

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const isJunkHeader = (h: string) => !h || !h.trim() || /^__empty/i.test(h.trim());
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
function guessMapping(headers: string[]): Record<string, string> {
  const m: Record<string, string> = {};
  const taken = new Set<string>();
  for (const [field] of BUYER_FIELDS) {
    const cands = (GUESS[field] ?? [field]).map(norm);
    const exact = headers.find((h) => !taken.has(h) && cands.includes(norm(h)));
    const loose = exact ?? headers.find((h) => !taken.has(h) && cands.some((c) => norm(h).includes(c)));
    if (loose) { m[field] = loose; taken.add(loose); }
  }
  return m;
}

export default function BuyerImportClient() {
  const router = useRouter();
  const [step, setStep] = useState<"upload" | "map" | "run" | "done">("upload");
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, imported: 0, failed: 0 });
  const [batchId, setBatchId] = useState<string | null>(null);

  function applyHeaderRow(g: string[][], hr: number) {
    const raw = (g[hr] ?? []).map((c) => String(c ?? "").trim());
    const data = g.slice(hr + 1).map((row) => {
      const o: Record<string, string> = {};
      raw.forEach((h, j) => { if (!isJunkHeader(h)) o[h] = String(row[j] ?? "").trim(); });
      return o;
    }).filter((o) => Object.values(o).some((v) => v !== ""));
    const clean = raw.filter((h) => !isJunkHeader(h));
    setHeaders(clean); setRows(data); setMapping(guessMapping(clean)); setHeaderRow(hr);
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

  const usedCols = new Set(Object.values(mapping).filter(Boolean));
  const unmapped = headers.filter((h) => !usedCols.has(h));
  const canImport = !!mapping.clientName;
  const valOf = (r: Record<string, string>, col?: string) => (col ? (r[col] ?? "").trim() : "");
  const validRows = rows.filter((r) => valOf(r, mapping.clientName)).length;
  const previewFields = BUYER_FIELDS.filter(([f]) => mapping[f]);

  async function runImport() {
    if (!canImport) { setErr("Map a column to Client Name first."); return; }
    setErr(null); setNote("⏳ Import started…");
    setStep("run");

    // Build mapped rows + preserve every unmapped column into _extra.
    type MappedRow = Record<string, string | Record<string, string>> & { _extra: Record<string, string>; clientName?: string };
    const mapped: MappedRow[] = rows.map((r) => {
      const extra: Record<string, string> = {};
      const o: MappedRow = { _extra: extra };
      for (const [field, col] of Object.entries(mapping)) if (col) o[field] = r[col] ?? "";
      for (const h of unmapped) { const v = (r[h] ?? "").trim(); if (v) extra[h] = v; }
      return o;
    }).filter((o) => String(o.clientName ?? "").trim());

    if (mapped.length === 0) { setErr("No rows have a Client Name — nothing to import."); setNote("❌ Every row is missing Client Name."); setStep("map"); return; }

    // 1. init the batch.
    let bid: string | null = null;
    try {
      const r0 = await fetch("/api/buyer-data/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ init: true, source: "Excel file", sourceRef: fileName, total: mapped.length }) });
      const j0 = await r0.json();
      if (!r0.ok) { setNote(`❌ ${j0.error ?? "Could not start import."}`); setErr(j0.error ?? "Import init failed."); setStep("map"); return; }
      bid = j0.id ?? null;
      setBatchId(bid);
    } catch { setNote("❌ Could not start import (network)."); setStep("map"); return; }

    // 2. chunked import.
    const BATCH = 200;
    const acc = { imported: 0, failed: 0 };
    setProgress({ done: 0, total: mapped.length, ...acc });
    for (let i = 0; i < mapped.length; i += BATCH) {
      const chunk = mapped.slice(i, i + BATCH);
      try {
        const res = await fetch("/api/buyer-data/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: bid, rows: chunk, rowOffset: i, sourceFile: fileName }),
        });
        const j = await res.json();
        if (!res.ok) { setNote(`❌ Import failed: ${j.error ?? "server error"}`); setErr(j.error ?? "Import failed."); setStep("map"); return; }
        acc.imported += j.imported || 0; acc.failed += j.failed || 0;
      } catch { acc.failed += chunk.length; }
      setProgress({ done: Math.min(i + BATCH, mapped.length), total: mapped.length, ...acc });
    }
    setNote(`✅ Imported ${acc.imported} record${acc.imported !== 1 ? "s" : ""}${acc.failed ? `, ${acc.failed} failed` : ""}.`);
    setStep("done");
    router.refresh();
  }

  const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100";
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const rowPreview = (cells: string[]) => cells.filter((c) => c && c.trim()).slice(0, 6).join("  ·  ") || "(blank row)";

  return (
    <div className="card p-5 space-y-4">
      {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
      {note && <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded p-2 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-200">{note}</div>}

      {step === "upload" && (
        <label className="block border-2 border-dashed border-gray-200 dark:border-slate-600 rounded-xl p-8 text-center cursor-pointer hover:border-[#1a2e4a] transition">
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <div className="text-3xl mb-2">📥</div>
          <div className="text-sm text-gray-600 dark:text-slate-300">Drop a <b>Excel (.xlsx)</b> or <b>CSV</b> file of buyer transactions, or <b className="text-[#1a2e4a] dark:text-blue-400">click to browse</b></div>
          <div className="text-[11px] text-gray-400 mt-1">Header row auto-detected · every unmapped column is preserved (no data dropped).</div>
        </label>
      )}

      {step === "map" && (
        <div className="space-y-4">
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

          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-xs text-gray-500">✨ auto-mapped — review &amp; correct.</div>
            <button type="button" onClick={() => setMapping(guessMapping(headers))} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 dark:text-slate-300 dark:border-slate-600">↻ Auto Map</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {BUYER_FIELDS.map(([field, label]) => {
              const mapped = !!mapping[field];
              const req = field === "clientName";
              return (
                <div key={field} className="flex items-center gap-2">
                  <span className={`text-xs w-32 shrink-0 ${mapped ? "text-gray-700 dark:text-slate-200 font-medium" : "text-gray-400"}`}>{label}{req && <span className="text-amber-500"> ◦</span>}</span>
                  <select className={`${inp} ${mapped ? "border-green-300" : ""}`} value={mapping[field] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}>
                    <option value="">— ignore —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              );
            })}
          </div>

          {unmapped.length > 0 && (
            <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2.5 dark:bg-emerald-900/20 dark:border-emerald-700">
              <span className="font-semibold text-emerald-800 dark:text-emerald-300">Preserved columns ({unmapped.length}):</span>
              <span className="text-emerald-700 dark:text-emerald-200"> {unmapped.join(", ")}</span>
              <span className="text-emerald-600"> — kept verbatim in “Imported Fields” (not dropped).</span>
            </div>
          )}

          {previewFields.length > 0 && rows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
              <table className="text-[11px] w-full">
                <thead><tr className="bg-gray-50 dark:bg-slate-800 text-left text-gray-500">{previewFields.map(([f, l]) => <th key={f} className="px-2 py-1 whitespace-nowrap">{l}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                  {rows.slice(0, 5).map((r, i) => <tr key={i}>{previewFields.map(([f]) => <td key={f} className="px-2 py-1 whitespace-nowrap text-gray-700 dark:text-slate-300 max-w-[140px] truncate">{r[mapping[f]] ?? ""}</td>)}</tr>)}
                </tbody>
              </table>
            </div>
          )}

          {!canImport ? (
            <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5"><b>Cannot import:</b> map a column to <b>Client Name</b> above.</div>
          ) : (
            <div className="text-[11px] text-green-700 dark:text-green-400">✓ Ready — {validRows} valid rows.</div>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={runImport} disabled={!canImport}
              className={`btn justify-center ${canImport ? "btn-primary" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}
              title={canImport ? "" : "Map Client Name first"}>
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
          <div className="text-[11px] text-gray-500">✅ {progress.imported} imported · ⚠ {progress.failed} failed — keep this tab open.</div>
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3 text-center py-4">
          <div className="text-4xl">🎉</div>
          <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">Import complete</div>
          <div className="text-sm text-gray-600 dark:text-slate-300">✅ {progress.imported} imported · ⚠ {progress.failed} failed</div>
          {progress.failed > 0 && batchId && (
            <div className="text-[11px] text-gray-500">Failed rows are logged with the reason (batch {batchId.slice(0, 8)}…).</div>
          )}
          <div className="flex gap-2 justify-center">
            <Link href="/buyer-data" className="btn btn-primary justify-center">View buyer data</Link>
            <button type="button" onClick={() => { setStep("upload"); setGrid([]); setHeaders([]); setRows([]); setMapping({}); setNote(null); setBatchId(null); }} className="btn justify-center px-4 border border-gray-300 text-gray-600 rounded-lg text-sm dark:text-slate-300 dark:border-slate-600">Import another</button>
          </div>
        </div>
      )}
    </div>
  );
}
