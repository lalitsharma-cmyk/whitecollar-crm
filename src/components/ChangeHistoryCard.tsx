// Lead-detail "Change History" — renders the financial-grade field-level audit
// trail (LeadFieldHistory) old→new + who + when + source, plus the lead's import
// source (which sheet/batch it came from). Admin/manager view. Pure display.
import { fmtIST12 } from "@/lib/datetime";

const FIELD_LABEL: Record<string, string> = {
  currentStatus: "Status", status: "Status", budgetMin: "Budget", budgetMax: "Budget (max)",
  budgetCurrency: "Currency", bantStatus: "BANT", ownerId: "Owner (assignment)",
  followupDate: "Follow-up date", source: "Source", leadOrigin: "Section",
  remarks: "Remarks", city: "City", country: "Country", configuration: "Configuration",
  needType: "Need", potential: "Potential",
};
const SRC_LABEL: Record<string, string> = {
  "inline-edit": "edit", bulk: "bulk", import: "import", eoi: "EOI", reject: "reject", move: "move", system: "system",
};

export interface FieldHistoryRow {
  id: string; field: string; oldValue: string | null; newValue: string | null;
  changedAt: Date | string; changedBy: { name: string } | null; source: string | null;
}
export interface ImportSource {
  id: string; fileName: string; createdAt: Date | string; importedBy: { name: string } | null;
}

export default function ChangeHistoryCard({
  rows, importBatch, ownerNames,
}: {
  rows: FieldHistoryRow[];
  importBatch?: ImportSource | null;
  ownerNames?: Record<string, string>;
}) {
  const showVal = (field: string, v: string | null) => {
    if (v == null || v === "") return "—";
    if (field === "ownerId") return ownerNames?.[v] ?? "Unassigned";
    if (field === "followupDate") { const d = new Date(v); if (!isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    return v.length > 44 ? v.slice(0, 44) + "…" : v;
  };
  return (
    <div data-lead-section="admin" className="card p-4">
      <div className="font-semibold mb-2 dark:text-slate-100">📜 Change History <span className="text-[10px] text-gray-400 font-normal">— field-level audit</span></div>

      {importBatch && (
        <div className="text-[11px] text-gray-500 dark:text-slate-400 mb-3 pb-2 border-b border-gray-100 dark:border-slate-800">
          📥 Imported from <b className="text-gray-700 dark:text-slate-200">{importBatch.fileName}</b>
          {importBatch.importedBy?.name ? <> by {importBatch.importedBy.name}</> : null}
          {" · "}{fmtIST12(typeof importBatch.createdAt === "string" ? new Date(importBatch.createdAt) : importBatch.createdAt)} IST
          <span className="block text-[10px] text-gray-400 font-mono mt-0.5">batch {importBatch.id}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-gray-500 dark:text-slate-400 text-sm">No tracked changes yet — every status / budget / BANT / follow-up / owner / remark change from now on is logged here.</div>
      ) : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {rows.map((r) => (
            <div key={r.id} className="text-xs border-b border-gray-100 dark:border-slate-800 pb-1.5">
              <div className="dark:text-slate-200">
                <b>{FIELD_LABEL[r.field] ?? r.field}</b>{" "}
                <span className="text-gray-400">{showVal(r.field, r.oldValue)}</span>
                <span className="mx-1 text-gray-400">→</span>
                <span className="font-medium text-[#0b1a33] dark:text-blue-300">{showVal(r.field, r.newValue)}</span>
              </div>
              <div className="text-[10px] text-gray-400">
                {r.changedBy?.name ?? "system"} · {fmtIST12(typeof r.changedAt === "string" ? new Date(r.changedAt) : r.changedAt)} IST{r.source ? ` · ${SRC_LABEL[r.source] ?? r.source}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
