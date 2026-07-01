// ColdClientInfoCard — editable "Client Information" for a Cold Data (Revival) record.
//
// PERMANENT ARCHITECTURE (Lalit): Cold Data = Master Database, Lead = Working Pipeline —
// never mixed. This card edits ONLY client-information DATA fields (contact, company,
// source, property enquired, budget, profession, configuration, address, purpose,
// LinkedIn, tags) directly on the cold record. It deliberately exposes NONE of the
// Lead-only workflow (BANT, lead score, AI qualification, follow-up, meeting, site
// visit, voice guidance, escalation, snooze, pipeline/deal stage, tasks, scheduling) —
// those unlock only after "Convert to Lead".
//
// Single source of truth: Convert FLIPS the same row (leadOrigin→ACTIVE_LEAD), it does
// NOT copy — so every edit made here auto-carries to the Lead with no duplicate entry.
// All edits POST to /api/leads/[id]/update, which logs field-level history
// (who · old→new · timestamp) via recordFieldChanges → shown in the Change History card.
//
// Permissions mirror the Lead view + the server (ADMIN_ONLY_FIELDS): name / phone /
// email + Source are ADMIN-only to edit; non-admins see the phone MASKED (last-4) and
// can still edit the non-PII data fields on a cold record they have access to (the
// server re-checks scope via loadOwnedLead).
import InlineEdit from "@/components/InlineEdit";
import ContactField from "@/components/ContactField";
import LinkedInField from "@/components/LinkedInField";
import LeadTagsEditor from "@/components/LeadTagsEditor";

function maskPhone(p?: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return d.length >= 4 ? `···${d.slice(-4)}` : p;
}

export type ColdClientLead = {
  id: string;
  name: string | null;
  phone: string | null;
  altPhone: string | null;
  email: string | null;
  altEmail: string | null;
  company: string | null;
  profession: string | null;
  designation: string | null;
  nationality: string | null;
  preferredLocation: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  address: string | null;
  sourceRaw: string | null;
  source: string | null;
  sourceDetail: string | null;
  configuration: string | null;
  propertyType: string | null;
  budgetMin: number | null;
  budgetCurrency: string | null;
  clientType: string | null;
  linkedInUrl: string | null;
  tags: string | null;
  forwardedTeam: string | null;
};

const label = "text-xs text-gray-500 dark:text-slate-400";

export default function ColdClientInfoCard({ lead, isAdmin }: { lead: ColdClientLead; isAdmin: boolean }) {
  const budgetHint = lead.budgetCurrency === "INR" ? "type 30L · 3Cr · 500K" : "type 2.5M · 500K";
  const budgetDisplay = lead.budgetMin ? `${lead.budgetCurrency ?? ""} ${(lead.budgetMin / 1_000_000).toFixed(1)}M` : undefined;
  const configOptions = lead.forwardedTeam === "India"
    ? [
        { value: "1BHK", label: "1 BHK" }, { value: "2BHK", label: "2 BHK" }, { value: "3BHK", label: "3 BHK" },
        { value: "4BHK", label: "4 BHK" }, { value: "Villa", label: "Villa" }, { value: "Plot", label: "Plot" },
        { value: "Commercial", label: "Commercial" },
      ]
    : [
        { value: "Studio", label: "Studio" }, { value: "1BR", label: "1 BR" }, { value: "2BR", label: "2 BR" },
        { value: "3BR", label: "3 BR" }, { value: "4BR", label: "4 BR" }, { value: "Penthouse", label: "Penthouse" },
        { value: "Villa", label: "Villa" }, { value: "Commercial", label: "Commercial" },
      ];

  return (
    <div className="card p-4">
      <div className="font-semibold mb-1 dark:text-slate-100">
        Client information{" "}
        <span className="text-[10px] text-gray-400 dark:text-slate-500 font-normal">(click any value to edit · saved to the Cold Data Bank)</span>
      </div>
      <p className="text-[10px] text-amber-700 dark:text-amber-300/80 mb-3">
        🗄 Master-database record — client info only. Lead workflow (BANT, follow-up, meetings, pipeline) unlocks on Convert to Lead.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm [&>div]:min-w-0 [&>div]:overflow-hidden">
        {/* Name — ADMIN-only edit (ADMIN_ONLY_FIELDS) */}
        <div>
          <div className={label}>🧑 Name</div>
          {isAdmin
            ? <InlineEdit leadId={lead.id} field="name" value={lead.name ?? ""} placeholder="Add name" />
            : <div className="mt-0.5 text-sm dark:text-slate-200">{lead.name || <span className="text-gray-400">—</span>}</div>}
        </div>
        {/* Phone — ADMIN edits + sees full; others see MASKED (last-4), no edit */}
        <div>
          <div className={label}>📞 Phone</div>
          {isAdmin
            ? <ContactField leadId={lead.id} field="phone" kind="phone" value={lead.phone} editable />
            : <ContactField leadId={lead.id} field="phone" kind="phone" value={lead.phone} readOnlyText={maskPhone(lead.phone)} />}
        </div>
        {/* Alt phone — not PII-locked; anyone with access may edit */}
        <div>
          <div className={label}>📱 Alt phone</div>
          <ContactField leadId={lead.id} field="altPhone" kind="phone" value={lead.altPhone} editable />
        </div>
        {/* Email — ADMIN-only edit (PII); others view */}
        <div>
          <div className={label}>✉️ Email</div>
          <ContactField leadId={lead.id} field="email" kind="email" value={lead.email} editable={isAdmin} />
        </div>
        {/* Alt email */}
        <div>
          <div className={label}>✉️ Alt email</div>
          <ContactField leadId={lead.id} field="altEmail" kind="email" value={lead.altEmail} editable />
        </div>
        {/* Company */}
        <div>
          <div className={label}>🏢 Company</div>
          <InlineEdit leadId={lead.id} field="company" value={lead.company ?? ""} placeholder="Add value" />
        </div>
        {/* Profession */}
        <div>
          <div className={label}>💼 Profession</div>
          <InlineEdit leadId={lead.id} field="profession" value={lead.profession ?? ""} placeholder="Add value" />
        </div>
        {/* Designation — job title */}
        <div>
          <div className={label}>🪪 Designation</div>
          <InlineEdit leadId={lead.id} field="designation" value={lead.designation ?? ""} placeholder="Add value" />
        </div>
        {/* Nationality */}
        <div>
          <div className={label}>🌍 Nationality</div>
          <InlineEdit leadId={lead.id} field="nationality" value={lead.nationality ?? ""} placeholder="Add value" />
        </div>
        {/* Preferred Location */}
        <div>
          <div className={label}>📍 Preferred Location</div>
          <InlineEdit leadId={lead.id} field="preferredLocation" value={lead.preferredLocation ?? ""} placeholder="Add value" />
        </div>
        {/* Purpose — Investment / End Use (clientType) */}
        <div>
          <div className={label}>🎯 Purpose</div>
          <InlineEdit leadId={lead.id} field="clientType" type="select" value={lead.clientType ?? ""}
            options={[
              { value: "INVESTOR", label: "Investor" }, { value: "END_USER", label: "End User" },
              { value: "BOTH", label: "Both" }, { value: "UNCLEAR", label: "Unclear" },
            ]} placeholder="Not set" />
        </div>
        {/* Source — ADMIN-only (verbatim provenance) */}
        <div>
          <div className={label}>📥 Source</div>
          {isAdmin
            ? <InlineEdit leadId={lead.id} field="sourceRaw" value={lead.sourceRaw ?? lead.source ?? ""} placeholder="Set source" />
            : <div className="mt-0.5 text-sm dark:text-slate-200">{lead.sourceRaw ?? lead.source ?? <span className="text-gray-400">—</span>}</div>}
        </div>
        {/* Property Enquired / Source Details (sourceDetail) */}
        <div>
          <div className={label}>🏢 Property Enquired</div>
          <InlineEdit leadId={lead.id} field="sourceDetail" value={lead.sourceDetail ?? ""} placeholder="Add value" />
        </div>
        {/* Configuration */}
        <div>
          <div className={label}>🏠 Configuration</div>
          <InlineEdit leadId={lead.id} field="configuration" type="select" value={lead.configuration ?? ""} options={configOptions} placeholder="Add value" />
        </div>
        {/* Property Type */}
        <div>
          <div className={label}>🏗️ Property Type</div>
          <InlineEdit leadId={lead.id} field="propertyType" type="select" value={lead.propertyType ?? ""}
            options={[{ value: "Residential", label: "Residential" }, { value: "Commercial", label: "Commercial" }, { value: "Mixed Use", label: "Mixed Use" }]}
            placeholder="Add value" />
        </div>
        {/* Budget */}
        <div>
          <div className={label}>💰 Budget</div>
          <InlineEdit leadId={lead.id} field="budgetMin" value={lead.budgetMin ?? ""} parseAs="budget" display={budgetDisplay} editHint={budgetHint} placeholder="Add value" />
        </div>
        {/* City */}
        <div>
          <div className={label}>🏙 City</div>
          <InlineEdit leadId={lead.id} field="city" value={lead.city ?? ""} placeholder="Add value" />
        </div>
        {/* State / Province */}
        <div>
          <div className={label}>📍 State / Province</div>
          <InlineEdit leadId={lead.id} field="state" value={lead.state ?? ""} placeholder="Add value" />
        </div>
        {/* Country */}
        <div>
          <div className={label}>🌍 Country</div>
          <InlineEdit leadId={lead.id} field="country" value={lead.country ?? ""} placeholder="Add value" />
        </div>
        {/* Address — full width */}
        <div className="sm:col-span-2">
          <div className={label}>🏠 Address</div>
          <InlineEdit leadId={lead.id} field="address" value={lead.address ?? ""} placeholder="Add value" />
        </div>
        {/* LinkedIn — full width */}
        <div className="sm:col-span-2">
          <div className={label}>🔗 LinkedIn</div>
          <LinkedInField leadId={lead.id} value={lead.linkedInUrl} />
        </div>
        {/* Tags — full width */}
        <div className="sm:col-span-2">
          <div className={label}>🏷 Tags</div>
          <LeadTagsEditor leadId={lead.id} initialTags={lead.tags} />
        </div>
      </div>
    </div>
  );
}
