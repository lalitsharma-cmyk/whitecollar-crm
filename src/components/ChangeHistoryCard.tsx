// Lead-detail "Change History" — renders the financial-grade field-level audit
// trail (LeadFieldHistory) old→new + who + when + source, plus the lead's import
// source (which sheet/batch it came from). Admin/manager view. Pure display.
import { fmtIST12 } from "@/lib/datetime";

const FIELD_LABEL: Record<string, string> = {
  currentStatus: "Status", status: "Status", budgetMin: "Budget", budgetMax: "Budget (max)",
  budgetCurrency: "Currency", budgetRaw: "Budget (raw)", bantStatus: "BANT",
  ownerId: "Owner (assignment)", forwardedTeam: "Team",
  followupDate: "Follow-up date", meetingDate: "Meeting date", siteVisitDate: "Site-visit date",
  source: "Source", sourceRaw: "Source (raw)", sourceDetail: "Property Enquired",
  medium: "Medium", mediumOther: "Custom medium", leadOrigin: "Section",
  remarks: "Remarks", city: "City", state: "State / Province", country: "Country",
  address: "Address", configuration: "Configuration", propertyType: "Property Type",
  needType: "Need", needSummary: "Need", potential: "Potential",
  fundReadiness: "Fund readiness", authorityLevel: "Authority", authorityPerson: "Authority (who)",
  whenCanInvest: "Timeline",
  name: "Name", altName: "Alt name", phone: "Phone", altPhone: "Alt phone",
  email: "Email", altEmail: "Alt email", company: "Company", profession: "Profession",
  linkedInUrl: "LinkedIn",
  // Buyer Data fields (shared card is used by the buyer detail's Change History too).
  clientName: "Client name", ownerName: "Owner name", agentName: "Sales agent",
  nationality: "Nationality", passport: "Passport", passportExpiry: "Passport expiry",
  projectName: "Project", tower: "Tower / Building", unitNumber: "Unit number",
  size: "Size", actualSize: "Actual size", area: "Area",
  transactionValue: "Transaction value", pricePerSqFt: "Price / sq.ft",
  transactionDate: "Transaction date", transactionId: "Transaction ID",
  transactionType: "Transaction type", role: "Role", businessStatus: "Status",
};

// Imported/custom-field changes are recorded as "customFields.<Original Header>".
// Show the original header (after the dot) prefixed with a 📋 so it reads as an
// imported value edit, not a core CRM field.
function fieldLabel(field: string): string {
  if (field.startsWith("customFields.")) return `📋 ${field.slice("customFields.".length)}`;
  return FIELD_LABEL[field] ?? field;
}
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
    if (field === "followupDate") { const d = new Date(v); if (!isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }); }
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
                <b>{fieldLabel(r.field)}</b>{" "}
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
