"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImportMappingTable, { type MappingRow, type CrmFieldOption } from "./ImportMappingTable";

// ────────────────────────────────────────────────────────────────────────────
// LeadImportWizard — the SHARED Import-Mapping-Approval wizard used by every
// lead importer (Main CSV, Pre-assigned MIS, Cold-data, Google Sheet).
//
//   1. Upload / connect   — CSV/Excel file  OR  Google Sheet URL
//   2. Preview columns    — every detected sheet column
//   3. Suggested mapping  — auto-detected CRM field per column (the engine's
//                           fuzzy guess, surfaced as a SUGGESTION not the final)
//   4. Admin confirmation — re-map / ignore (→ customFields) per column; low-
//                           confidence rows flagged. Reuses ImportMappingTable.
//   5. Data preview       — first ~10 rows: mapped CRM fields + blanks + per-row
//                           duplicate flag.
//   6. Duplicate choice   — Skip / Update / Create new / Add as conversation.
//   7. Import + report    — only after explicit confirm. Then a full report.
//
// The engine already accepts an explicit `mapping` + `dupMode` and a preview
// dry-run, so this single component drives BOTH /api/intake/csv and
// /api/intake/google-sheet with no forked import logic.
// ────────────────────────────────────────────────────────────────────────────

type WizardMode = "csv" | "google-sheet";

// Kept in sync with the canonical DupMode union in src/lib/importMapping.ts.
type DupMode = "merge" | "skip" | "update" | "create" | "conversation" | "revival";

interface PreviewResult {
  preview: true;
  totalRows: number;
  newRows: number;
  dupRows: number;
  missingName: number;
  missingPhone: number;
  missingProject: number;
  dupSamples: { name: string; phone: string; existingStatus: string }[];
  uniqueStatuses: string[];
  detectedColumns: string[];
  mapping?: MappingRow[];
  crmFields?: CrmFieldOption[];
  ignoreValue?: string;
  sampleRows?: Record<string, string>[];
  fileType: string;
  sheetName?: string;
  automationNote?: string;
}

interface ImportResult {
  ok?: boolean;
  fileType?: string;
  sheetName?: string;
  rowsProcessed?: number;
  created: number;
  deduped: number;
  enriched: number;
  autofilled?: number;
  dupMode?: DupMode;
  skippedDup?: number;
  conversationAppended?: number;
  revived?: number;
  mappingConfirmed?: boolean;
  customFieldsCreated?: number;
  detectedColumns?: string[];
  futureDateCount?: number;
  unmatchedOwners?: string[];
  unmatchedOwnerCount?: number;
  errors?: string[];
}

const DUP_OPTIONS: { val: DupMode; label: string; desc: string }[] = [
  { val: "merge", label: "Merge / enrich", desc: "Add new info to the existing lead (default). Never overwrites a filled field with a blank." },
  { val: "skip", label: "Skip duplicate", desc: "Leave the existing lead completely untouched." },
  { val: "update", label: "Update existing", desc: "Write the sheet's values onto the existing lead (sheet wins)." },
  { val: "create", label: "Create new anyway", desc: "Import as a brand-new lead even if a match exists." },
  { val: "conversation", label: "Add as conversation", desc: "Append only the remark to the existing lead's history." },
  { val: "revival", label: "Revive existing (merge + append history)", desc: "Existing leads are updated & their history appended — nothing is skipped. Fills empty fields only, moves the lead into the Revival Engine." },
];

export interface LeadImportWizardProps {
  /** "csv" → file upload to /api/intake/csv. "google-sheet" → URL to /api/intake/google-sheet. */
  mode: WizardMode;
  /** Extra form/body fields sent on BOTH the preview and the import request
   *  (e.g. { assignToUserId } for pre-assigned MIS, { isColdCall: "true" } for
   *  cold data). Preserved verbatim so importer-specific behaviour is unchanged. */
  extraFields?: Record<string, string>;
  /** Show a campaign text input (defaults true). */
  showCampaign?: boolean;
  /** Default duplicate-handling mode (defaults "merge" = legacy behaviour). */
  defaultDupMode?: DupMode;
  /** Called after a successful import (in addition to router.refresh()). */
  onDone?: (result: ImportResult) => void;
  /** Compact styling for tight cards/modals. */
  compact?: boolean;
}

export default function LeadImportWizard({
  mode,
  extraFields,
  showCampaign = true,
  defaultDupMode = "merge",
  onDone,
  compact = false,
}: LeadImportWizardProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = useState("");
  const [campaign, setCampaign] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<{ msg: string; hint?: string } | null>(null);
  // Editable column→CRM-field map (seeded from the server proposal).
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [dupMode, setDupMode] = useState<DupMode>(defaultDupMode);

  const isCsv = mode === "csv";
  const canPreview = isCsv ? !!file : sheetUrl.trim().length > 0;

  // ── Request builders ───────────────────────────────────────────────────────
  function csvBody(withMapping: boolean): FormData {
    const fd = new FormData();
    fd.append("file", file!);
    if (campaign) fd.append("campaign", campaign);
    for (const [k, v] of Object.entries(extraFields ?? {})) fd.append(k, v);
    if (withMapping) {
      if (Object.keys(mapping).length > 0) fd.append("mapping", JSON.stringify(mapping));
      fd.append("dupMode", dupMode);
    }
    return fd;
  }
  function sheetBody(withMapping: boolean): string {
    const body: Record<string, unknown> = {
      url: sheetUrl.trim(),
      campaign: campaign.trim() || undefined,
      ...(extraFields ?? {}),
    };
    if (!withMapping) body.preview = true;
    if (withMapping) {
      if (Object.keys(mapping).length > 0) body.mapping = mapping;
      body.dupMode = dupMode;
    }
    return JSON.stringify(body);
  }

  async function runPreview() {
    if (!canPreview) return;
    setBusy(true); setErr(null); setPreview(null); setResult(null); setConfirmed(false); setMapping({});
    try {
      const res = isCsv
        ? await fetch("/api/intake/csv?preview=1", { method: "POST", body: csvBody(false) })
        : await fetch("/api/intake/google-sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: sheetBody(false) });
      const json = await res.json().catch(() => ({ error: "Server returned invalid response" }));
      if (!res.ok) { setErr({ msg: json.error ?? `Preview failed (HTTP ${res.status})`, hint: json.hint }); return; }
      const p = json as PreviewResult;
      setPreview(p);
      if (p.mapping) {
        const seed: Record<string, string> = {};
        for (const m of p.mapping) seed[m.column] = m.crmField;
        setMapping(seed);
      }
    } catch (e) {
      setErr({ msg: `Network error: ${String(e)}` });
    } finally { setBusy(false); }
  }

  async function confirmImport() {
    if (!confirmed) { setErr({ msg: "Confirm the column mapping first." }); return; }
    setBusy(true); setErr(null);
    try {
      const res = isCsv
        ? await fetch("/api/intake/csv", { method: "POST", body: csvBody(true) })
        : await fetch("/api/intake/google-sheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: sheetBody(true) });
      const json = await res.json().catch(() => ({ error: "Server returned invalid response" }));
      if (!res.ok) { setErr({ msg: json.error ?? `Import failed (HTTP ${res.status})`, hint: json.hint }); return; }
      const r = json as ImportResult;
      setResult(r);
      setPreview(null); setConfirmed(false); setMapping({});
      router.refresh();
      onDone?.(r);
    } catch (e) {
      setErr({ msg: `Network error: ${String(e)}` });
    } finally { setBusy(false); }
  }

  function resetAll() {
    setFile(null); setSheetUrl(""); setPreview(null); setResult(null);
    setErr(null); setConfirmed(false); setMapping({}); setDupMode(defaultDupMode);
  }

  // Live mapping rows = server proposal columns re-merged with admin edits.
  const liveMappingRows: MappingRow[] = (preview?.mapping ?? []).map((m) => ({
    ...m,
    crmField: mapping[m.column] ?? m.crmField,
  }));

  // Reverse map (crmField → sheet column) for the data-preview header labels.
  const ignoreValue = preview?.ignoreValue ?? "__ignore";
  const mappedColumns = useMemo(() => {
    // Columns that ARE mapped to a real CRM field (in detected order), with label.
    const labelByField = new Map((preview?.crmFields ?? []).map((f) => [f.field, f.label]));
    return (preview?.detectedColumns ?? [])
      .map((col) => ({ col, field: mapping[col] ?? ignoreValue }))
      .filter((x) => x.field && x.field !== ignoreValue)
      .map((x) => ({ ...x, label: labelByField.get(x.field) ?? x.field }));
  }, [preview, mapping, ignoreValue]);

  // Phones that the server flagged as duplicates → highlight matching preview rows.
  const dupPhoneSet = useMemo(() => {
    const digits = (s: string) => s.replace(/\D/g, "").slice(-10);
    return new Set((preview?.dupSamples ?? []).map((d) => digits(d.phone)).filter((d) => d.length >= 7));
  }, [preview]);

  function rowIsDup(row: Record<string, string>): boolean {
    if (dupPhoneSet.size === 0) return false;
    // Find the value mapped to "phone" for this row.
    const phoneCol = mappedColumns.find((m) => m.field === "phone")?.col;
    const raw = phoneCol ? row[phoneCol] : undefined;
    if (!raw) return false;
    return dupPhoneSet.has(raw.replace(/\D/g, "").slice(-10));
  }

  const pad = compact ? "p-3" : "p-4";

  return (
    <div>
      {/* ── Import Safe Mode banner ── */}
      {!result && (
        <div className="mb-3 p-2.5 rounded-lg border border-emerald-300 bg-emerald-50 flex items-start gap-2">
          <span className="text-base mt-0.5">🔒</span>
          <div className="text-[11px] text-emerald-700">
            <b className="text-emerald-800">Import Safe Mode</b> — no WhatsApp, emails, round-robin, or SLA alerts fire during import. Nothing is written until you confirm the mapping below.
          </div>
        </div>
      )}

      {/* ── Step 1: input ── */}
      {!preview && !result && (
        <div className="space-y-2">
          {isCsv ? (
            <label className="block border-2 border-dashed border-[#e5e7eb] rounded-lg p-5 text-center text-sm text-gray-500 cursor-pointer hover:border-[#c9a24b]">
              <input
                type="file"
                accept=".csv,.xlsx,.xlsm,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setErr(null); }}
                className="hidden"
              />
              {file ? <span>📄 {file.name} · {(file.size / 1024).toFixed(1)} KB</span>
                    : <span>Drop CSV or Excel here, or <b className="text-[#0b1a33]">click to browse</b></span>}
            </label>
          ) : (
            <>
              <input
                type="url"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={sheetUrl}
                onChange={(e) => setSheetUrl(e.target.value)}
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm font-mono"
              />
              <div className="text-[11px] text-gray-500">
                ⚠ Sheet must be shared <b>&quot;Anyone with the link → Viewer&quot;</b>. Any URL works (edit / view / share, even with #gid).
              </div>
            </>
          )}
          {showCampaign && (
            <input
              type="text"
              placeholder="Campaign (optional)"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            />
          )}
          <button onClick={runPreview} disabled={busy || !canPreview} className="btn btn-primary w-full justify-center disabled:opacity-50">
            {busy ? (isCsv ? "Scanning file…" : "Fetching from Google…") : "📋 Preview & map columns"}
          </button>
        </div>
      )}

      {/* ── Preview + mapping ── */}
      {preview && (
        <div className={`mt-1 rounded-lg border border-blue-200 bg-blue-50 ${pad} space-y-3`}>
          <div className="font-bold text-blue-900 text-sm flex items-center gap-2">
            📋 Import Preview
            <span className="text-[11px] font-normal text-blue-700">— nothing imported yet</span>
          </div>

          {/* Summary counts */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
            <div className="bg-white rounded-lg p-2.5 border border-blue-100">
              <div className="text-xl font-bold text-[#0b1a33]">{preview.totalRows}</div>
              <div className="text-[10px] text-gray-500">Total rows</div>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-emerald-100">
              <div className="text-xl font-bold text-emerald-700">{preview.newRows}</div>
              <div className="text-[10px] text-gray-500">New leads</div>
            </div>
            <div className="bg-white rounded-lg p-2.5 border border-amber-100">
              <div className="text-xl font-bold text-amber-700">{preview.dupRows}</div>
              <div className="text-[10px] text-gray-500">Duplicates</div>
            </div>
          </div>

          {/* Warnings */}
          {(preview.missingName > 0 || preview.missingPhone > 0) && (
            <div className="text-[11px] space-y-0.5">
              {preview.missingName > 0 && <div className="text-amber-700">⚠ {preview.missingName} rows missing name</div>}
              {preview.missingPhone > 0 && <div className="text-amber-700">⚠ {preview.missingPhone} rows missing phone number</div>}
            </div>
          )}

          {/* Step 3-4: mapping table */}
          {preview.mapping && preview.crmFields && preview.ignoreValue ? (
            <div className="rounded-lg border border-blue-100 bg-white p-3">
              <ImportMappingTable
                rows={liveMappingRows}
                crmFields={preview.crmFields}
                ignoreValue={preview.ignoreValue}
                onChange={(column, crmField) => {
                  setMapping((m) => ({ ...m, [column]: crmField }));
                  setConfirmed(false);
                }}
              />
            </div>
          ) : (
            preview.detectedColumns.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-blue-700">Detected columns ({preview.detectedColumns.length}) ↓</summary>
                <div className="mt-1 font-mono text-gray-600">{preview.detectedColumns.join(" · ")}</div>
              </details>
            )
          )}

          {/* Step 5: data preview (first 10 rows, mapped fields + dup flag) */}
          {preview.sampleRows && preview.sampleRows.length > 0 && mappedColumns.length > 0 && (
            <details className="rounded-lg border border-blue-100 bg-white p-3" open>
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-gray-700">
                Data preview — first {preview.sampleRows.length} rows (mapped)
              </summary>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-[11px]">
                  <thead className="bg-[#f7f8fa] text-gray-600">
                    <tr>
                      <th className="text-left font-semibold px-2 py-1.5">#</th>
                      {mappedColumns.map((m) => (
                        <th key={m.col} className="text-left font-semibold px-2 py-1.5 whitespace-nowrap">{m.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sampleRows.map((row, i) => {
                      const dup = rowIsDup(row);
                      return (
                        <tr key={i} className={`border-t border-[#eef0f3] ${dup ? "bg-amber-50" : ""}`}>
                          <td className="px-2 py-1.5 text-gray-400">
                            {i + 1}{dup && <span className="ml-1 text-amber-700" title="Duplicate of an existing lead">🔁</span>}
                          </td>
                          {mappedColumns.map((m) => {
                            const v = row[m.col] ?? "";
                            return (
                              <td key={m.col} className="px-2 py-1.5 align-top">
                                {v ? <span className="text-gray-800">{v}</span> : <span className="text-gray-300 italic">blank</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-gray-400 mt-1">🔁 = phone/email already exists as an active lead. Columns set to <i>Ignore</i> are not shown here but preserved verbatim.</div>
            </details>
          )}

          {/* Step 6: duplicate-handling choice */}
          {preview.dupRows > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-800">
                {preview.dupRows} duplicate{preview.dupRows === 1 ? "" : "s"} — how should they be handled?
              </div>
              {DUP_OPTIONS.map((o) => (
                <label key={o.val} className="flex items-start gap-2 text-xs cursor-pointer">
                  <input type="radio" name="dupMode" className="mt-0.5 accent-[#0b1a33]"
                    checked={dupMode === o.val} onChange={() => { setDupMode(o.val); setConfirmed(false); }} />
                  <span className="text-gray-700"><b>{o.label}</b> — {o.desc}</span>
                </label>
              ))}
            </div>
          )}

          {/* Confirmation gate */}
          <label className="flex items-start gap-2 text-xs cursor-pointer bg-white border border-blue-200 rounded-lg p-2.5">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 accent-[#0b1a33]" />
            <span className="text-gray-700">
              <b>I confirm this column mapping is correct.</b> Columns set to <i>Ignore</i> are kept verbatim as imported fields and not written to a CRM field.
            </span>
          </label>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={confirmImport} disabled={busy || !confirmed}
              title={confirmed ? "" : "Confirm the mapping above to enable import"}
              className="flex-1 btn btn-primary justify-center disabled:opacity-50 disabled:cursor-not-allowed">
              {busy ? "Importing…"
                : dupMode === "revival"
                  // Revival re-engages existing leads, so the meaningful count is
                  // new + duplicates (both get processed), not "new leads" alone.
                  ? `✅ Import — revive ${preview.dupRows} existing${preview.newRows > 0 ? ` + ${preview.newRows} new` : ""}`
                  : `✅ Import ${preview.newRows} new lead${preview.newRows === 1 ? "" : "s"}`}
            </button>
            <button onClick={resetAll} disabled={busy}
              className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Import report ── */}
      {result && (
        <div className={`mt-1 text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg ${pad} space-y-1.5`}>
          <div className="font-bold">
            {/* Revival imports re-engage EXISTING leads, so "0 new leads" is
                expected & correct — lead with the revived count, not the create
                count, so the admin sees the import actually did something. */}
            {result.dupMode === "revival" && (result.revived ?? 0) > 0
              ? `✅ Import complete — ${result.revived} lead${result.revived === 1 ? "" : "s"} revived (re-engaged)`
              : "✅ Import complete"}
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
            <Stat label="Rows processed" value={result.rowsProcessed} />
            <Stat label="New leads created" value={result.created} />
            <Stat label="Duplicates" value={result.deduped} />
            <Stat label="Enriched" value={result.enriched} />
            {result.dupMode === "skip" && <Stat label="Skipped (dup)" value={result.skippedDup} />}
            {result.dupMode === "conversation" && <Stat label="Conversation added" value={result.conversationAppended} />}
            {result.dupMode === "revival" && <Stat label="Revived (re-engaged)" value={result.revived} />}
            {typeof result.customFieldsCreated === "number" && result.customFieldsCreated > 0 && (
              <Stat label="Custom-field columns" value={result.customFieldsCreated} />
            )}
            {typeof result.futureDateCount === "number" && result.futureDateCount > 0 && (
              <Stat label="Future-dated (review)" value={result.futureDateCount} />
            )}
          </div>
          <div className="text-[11px] text-emerald-700">
            Duplicate mode: <b>{result.dupMode ?? "merge"}</b>
            {result.mappingConfirmed ? " · mapping confirmed by admin" : " · auto-detected mapping"}
            {" · 🔒 Import Safe Mode was ON."}
          </div>
          {result.detectedColumns && result.detectedColumns.length > 0 && (
            <details>
              <summary className="text-[11px] cursor-pointer">Columns mapped ↓</summary>
              <div className="text-[11px] mt-1 font-mono">{result.detectedColumns.join(" · ")}</div>
            </details>
          )}
          {result.unmatchedOwners && result.unmatchedOwners.length > 0 && (
            <details>
              <summary className="text-[11px] text-amber-700 cursor-pointer">
                {result.unmatchedOwnerCount ?? result.unmatchedOwners.length} Assigned-User value{(result.unmatchedOwnerCount ?? result.unmatchedOwners.length) === 1 ? "" : "s"} didn&apos;t match a CRM user — left unassigned ↓
              </summary>
              <div className="text-[11px] mt-1 text-gray-600">
                These leads were imported <b>unassigned</b>. Fix the name/email or assign them from Master Data:
                <div className="mt-1 font-mono">{result.unmatchedOwners.join(" · ")}</div>
              </div>
            </details>
          )}
          {result.errors && result.errors.length > 0 && (
            <details>
              <summary className="text-[11px] text-amber-700 cursor-pointer">{result.errors.length} row errors ↓</summary>
              <ul className="text-[11px] mt-1 list-disc list-inside">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </details>
          )}
          <button onClick={resetAll} className="text-[11px] text-emerald-600 hover:underline mt-1">Import another</button>
        </div>
      )}

      {err && (
        <div className={`mt-2 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg ${pad}`}>
          <div className="font-bold">❌ Failed</div>
          <div>{err.msg}</div>
          {err.hint && <div className="text-xs mt-1 text-red-700">💡 {err.hint}</div>}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="bg-white rounded border border-emerald-100 px-2 py-1 flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <b className="text-[#0b1a33]">{value ?? 0}</b>
    </div>
  );
}
