"use client";
// Expandable "Bulk import units" panel for the Properties detail page.
// Admin/Manager only — gating happens in the parent server component.
// Pastes raw CSV text, POSTs as JSON to /api/admin/projects/[id]/units/import,
// then refreshes the page so the new inventory rows appear in the table above.
import { useState } from "react";
import { useRouter } from "next/navigation";

interface ImportResult {
  ok: boolean;
  created: number;
  updated: number;
  errors: { row: number; error: string }[];
}

const HEADER_HINT = "code,configuration,carpetArea,floor,view,priceBase,status";
const EXAMPLE = `${HEADER_HINT}
T-A-1801,2BHK,1240,18,Marina,2500000,AVAILABLE
T-A-1802,3BHK,1640,18,Marina,3400000,HOLD`;

export default function UnitsCsvImport({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!csv.trim()) {
      setErr("Paste some CSV first.");
      return;
    }
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch(
        `/api/admin/projects/${projectId}/units/import`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv }),
        }
      );
      const json = await res.json().catch(() => ({ error: "Invalid server response" }));
      if (!res.ok) {
        setErr(json.error ?? `Import failed (HTTP ${res.status})`);
        return;
      }
      setResult(json as ImportResult);
      router.refresh();
    } catch (e) {
      setErr(`Network error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-4 mt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <h2 className="font-semibold">Bulk import units</h2>
          <div className="text-xs text-gray-500 mt-0.5">
            Paste availability as CSV to add or update multiple units at once.
          </div>
        </div>
        <span className="text-xs text-gray-500">{open ? "▲ Hide" : "▼ Show"}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="text-[11px] font-mono text-gray-600 bg-gray-50 border rounded px-2 py-1">
            Header: <span className="font-semibold">{HEADER_HINT}</span>
            <span className="text-gray-500"> · carpetArea / floor / view / status optional</span>
          </div>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={EXAMPLE}
            rows={8}
            className="w-full text-xs font-mono p-2 border rounded resize-y"
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 text-sm rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
            {csv && (
              <button
                type="button"
                onClick={() => {
                  setCsv("");
                  setResult(null);
                  setErr(null);
                }}
                disabled={busy}
                className="px-3 py-1.5 text-sm rounded border hover:bg-gray-50"
              >
                Clear
              </button>
            )}
          </div>
          {err && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
              {err}
            </div>
          )}
          {result && (
            <div className="text-sm bg-emerald-50 border border-emerald-200 rounded p-2">
              <div className="font-medium text-emerald-800">
                Imported: {result.created} created · {result.updated} updated
                {result.errors.length > 0
                  ? ` · ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`
                  : ""}
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-1 text-xs text-red-700 list-disc ml-5 max-h-32 overflow-auto">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
