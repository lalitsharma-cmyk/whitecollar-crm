"use client";
import LeadImportWizard from "./LeadImportWizard";

/**
 * Google-Sheet importer — now runs the shared Import-Mapping-Approval wizard:
 * paste a sheet URL → preview columns → confirm the suggested CRM-field mapping
 * (or re-map / ignore) → 10-row data preview with duplicate flags → choose how
 * duplicates are handled → import + report. Backed by /api/intake/google-sheet
 * (which gained ?preview + explicit mapping + dupMode support).
 */
export default function GoogleSheetImporter() {
  return <LeadImportWizard mode="google-sheet" />;
}
