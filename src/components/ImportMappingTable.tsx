"use client";
import { useMemo } from "react";

export type Confidence = "high" | "medium" | "unknown";

export interface MappingRow {
  column: string;
  crmField: string;       // a CRM field key, or the ignore sentinel
  confidence: Confidence;
}

export interface CrmFieldOption {
  field: string;
  label: string;
}

/**
 * Import Mapping Approval gate — steps 2-5 of the gated import flow.
 *
 *  - one row per DETECTED sheet column → proposed CRM field
 *  - a CONFIDENCE badge (green = exact header match, amber = fuzzy/prefix,
 *    grey = unknown/no confident field)
 *  - UNKNOWN columns are highlighted (amber row) so the admin notices them
 *  - a per-column <select> lets the admin re-map to any CRM field, or send the
 *    column to "Ignore / keep as Imported Field" (customFields verbatim)
 *
 * The parent owns the mapping state + the confirm checkbox that gates Import.
 */
export default function ImportMappingTable({
  rows,
  crmFields,
  ignoreValue,
  onChange,
}: {
  rows: MappingRow[];
  crmFields: CrmFieldOption[];
  ignoreValue: string;
  onChange: (column: string, crmField: string) => void;
}) {
  const unknownCount = useMemo(
    () => rows.filter((r) => r.crmField === ignoreValue).length,
    [rows, ignoreValue],
  );

  // A CRM field assigned to more than one column → flag (only one column can
  // feed a given field; the importer reads the first non-empty one). Helps the
  // admin notice an accidental double-map.
  const dupTargets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      if (r.crmField === ignoreValue) continue;
      counts.set(r.crmField, (counts.get(r.crmField) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([f]) => f));
  }, [rows, ignoreValue]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-bold uppercase tracking-widest text-gray-700">
          Column mapping — review before importing
        </div>
        {unknownCount > 0 && (
          <span className="text-[11px] font-semibold text-amber-700 bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">
            {unknownCount} unknown column{unknownCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      <p className="text-[11px] text-gray-500">
        Each sheet column below maps to a CRM field. Amber = fuzzy guess, grey =
        not recognised. Re-map anything that looks wrong, or set it to
        <b> Ignore</b> to keep the raw value as an imported field. Nothing is
        written until you confirm.
      </p>

      <div className="overflow-x-auto rounded-lg border border-[#e5e7eb]">
        <table className="w-full text-xs">
          <thead className="bg-[#f7f8fa] text-gray-600">
            <tr>
              <th className="text-left font-semibold px-3 py-2">Sheet column</th>
              <th className="text-left font-semibold px-3 py-2">Confidence</th>
              <th className="text-left font-semibold px-3 py-2">CRM field</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isUnknown = r.crmField === ignoreValue;
              const isDup = dupTargets.has(r.crmField);
              return (
                <tr
                  key={r.column}
                  className={`border-t border-[#eef0f3] ${isUnknown ? "bg-amber-50" : "bg-white"}`}
                >
                  <td className="px-3 py-2 font-mono text-gray-800 align-middle">
                    {r.column || <span className="text-gray-400">(blank header)</span>}
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <ConfidenceBadge confidence={r.confidence} />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <select
                      value={r.crmField}
                      onChange={(e) => onChange(r.column, e.target.value)}
                      className={`w-full min-w-[11rem] border rounded-md px-2 py-1.5 bg-white text-xs ${
                        isUnknown ? "border-amber-300 text-amber-800" : "border-[#e5e7eb]"
                      }`}
                    >
                      <option value={ignoreValue}>Ignore / keep as Imported Field</option>
                      {crmFields.map((f) => (
                        <option key={f.field} value={f.field}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    {isDup && (
                      <div className="text-[10px] text-amber-700 mt-0.5">
                        ⚠ also mapped by another column
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const map: Record<Confidence, { label: string; cls: string }> = {
    high:    { label: "High",    cls: "text-emerald-700 bg-emerald-100 border-emerald-300" },
    medium:  { label: "Fuzzy",   cls: "text-amber-700 bg-amber-100 border-amber-300" },
    unknown: { label: "Unknown", cls: "text-gray-600 bg-gray-100 border-gray-300" },
  };
  const { label, cls } = map[confidence];
  return (
    <span className={`inline-block text-[10px] font-semibold rounded-full border px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  );
}
