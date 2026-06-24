"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import LeadImportWizard from "./LeadImportWizard";

/**
 * Master Data Import — admin-only control above the Master Data grid.
 *
 * Opens the SHARED Import-Mapping-Approval wizard (the SAME one the main CSV
 * uploader, Pre-assigned MIS, Cold-data and Google-Sheet importers use): upload
 * Excel/CSV → preview detected columns → confirm/re-map/ignore each column →
 * 10-row data preview with duplicate flags → duplicate-handling choice (Merge /
 * Skip / Update / Create new / Add as conversation) → import + full report.
 *
 * Master Data context: imported rows land as SALES leads (the cold flag stays
 * false — this importer never sets it), so every imported row shows up in the
 * Master Data grid (which is scoped to non-cold leads). They enter
 * leadOrigin=MASTER_DATA (the engine's default for all bulk imports), i.e. the
 * untriaged repository — no record auto-enters the active pipeline. The wizard's
 * field mapping covers Client Name, Mobile, Alternate Mobile, Email, Alternate
 * Email, Source, Medium, Property Enquired, Budget, Status, Team, Assigned User,
 * Follow-up Date and Remarks; an Assigned-User column is matched to a CRM user by
 * name/email (unmatched → unassigned + reported); unknown columns are preserved
 * as Imported Fields (customFields); Remarks land verbatim in Raw History + the
 * Smart Timeline; sheet Date drives the lead date (never the import timestamp).
 *
 * The /api/intake/csv endpoint is already role-gated to ADMIN (requireRole) and
 * the Master Data page itself redirects non-admins, so this control is never
 * shown to — nor usable by — agents.
 */
export default function MasterDataImportControls() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-primary self-start sm:self-auto"
        title="Import an Excel or CSV sheet of leads into Master Data"
      >
        <Upload className="w-4 h-4" /> Import
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-3 sm:p-4 overflow-y-auto"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-slate-800 rounded-xl max-w-2xl w-full p-5 shadow-2xl my-4 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="font-semibold text-lg text-[#0b1a33] dark:text-slate-100">Import to Master Data</div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                  Upload an Excel (.xlsx) or CSV file. Review the column mapping and a data preview before anything is written.
                  Imported leads appear here in Master Data.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-slate-200 shrink-0"
                aria-label="Close import"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Shared wizard, Master Data preset. No extraFields → leads are NOT
                cold (isColdCall stays false) so they land in this grid. defaultDupMode
                "skip" — Master Data sheets are often existing-client lists / re-uploads;
                don't disturb existing leads by default. Admin can switch to
                Merge / Update / Create / Add-as-conversation in the wizard. */}
            <LeadImportWizard
              mode="csv"
              defaultDupMode="skip"
              onDone={() => router.refresh()}
            />
          </div>
        </div>
      )}
    </>
  );
}
