// "Imported Fields / Sheet Data" — every Excel column that didn't map to a known
// CRM field, preserved verbatim (original header → original value). Shown on the
// lead / master-data / revival detail so no imported sheet data is ever hidden.
// Visible to ALL roles (it's lead information, not a permissioned action).
export default function ImportedFieldsCard({ customFields }: { customFields: unknown }) {
  const entries =
    customFields && typeof customFields === "object" && !Array.isArray(customFields)
      ? Object.entries(customFields as Record<string, unknown>).filter(([, v]) => v != null && String(v).trim() !== "")
      : [];
  if (entries.length === 0) return null;
  return (
    <div data-lead-section="overview" className="card p-4">
      <div className="font-semibold mb-2 dark:text-slate-100">📋 Imported Fields <span className="text-[10px] text-gray-400 font-normal">— extra columns from the import sheet</span></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {entries.map(([k, v]) => (
          <div key={k} className="flex flex-col min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-gray-400 truncate" title={k}>{k}</span>
            <span className="text-gray-800 dark:text-slate-200 break-words">{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
