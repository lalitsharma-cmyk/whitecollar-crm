// "Imported Fields / Sheet Data" — every Excel column that didn't map to a known
// CRM field, preserved verbatim (original header → original value). Shown on the
// lead / master-data / revival detail so no imported sheet data is ever hidden.
// Visible to ALL roles (it's lead information, not a permissioned action).
//
// rawImport (optional) is the IMMUTABLE full original row — EVERY column, incl.
// the mapped ones (name/phone/email/source/dates/…) — shown verbatim in a
// collapsible "Original Imported Row" so the exact imported value of every field
// is always recoverable, not just the unmapped extras.
export default function ImportedFieldsCard({ customFields, rawImport }: { customFields: unknown; rawImport?: unknown }) {
  const entries =
    customFields && typeof customFields === "object" && !Array.isArray(customFields)
      ? Object.entries(customFields as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim() !== "")
      : [];
  const rawEntries =
    rawImport && typeof rawImport === "object" && !Array.isArray(rawImport)
      ? Object.entries(rawImport as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim() !== "")
      : [];
  if (entries.length === 0 && rawEntries.length === 0) return null;
  return (
    <div data-lead-section="overview" className="card p-4">
      {entries.length > 0 && (
        <>
          <div className="font-semibold mb-2 dark:text-slate-100">📋 Imported Fields <span className="text-[10px] text-gray-400 font-normal">— extra columns from the import sheet</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {entries.map(([k, v]) => (
              <div key={k} className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 truncate" title={k}>{k}</span>
                <span className="text-gray-800 dark:text-slate-200 break-words">{String(v)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {rawEntries.length > 0 && (
        <details className={entries.length > 0 ? "mt-3 pt-3 border-t border-gray-200 dark:border-slate-700" : ""}>
          <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 dark:text-slate-400 select-none">
            🔒 Original Imported Row — verbatim audit ({rawEntries.length} column{rawEntries.length === 1 ? "" : "s"}, exactly as written)
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm mt-2">
            {rawEntries.map(([k, v]) => (
              <div key={k} className="flex flex-col min-w-0">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 truncate" title={k}>{k}</span>
                <span className="text-gray-800 dark:text-slate-200 break-words whitespace-pre-wrap">{String(v)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
