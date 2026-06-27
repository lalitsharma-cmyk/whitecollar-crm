import { redirect } from "next/navigation";
import { ingestLead, assignLeadTo } from "@/lib/leadIngest";
import { LeadSource } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultCurrencyForTeam } from "@/lib/money";
import { defaultDialForTeam, toE164 } from "@/lib/phone";
import { validateMedium, getAvailableMediums } from "@/lib/mediumManager";
import { getAvailableEventNames } from "@/lib/eventNameManager";
import { normalizeNameList } from "@/lib/nameFormat";
import PhoneInput from "@/components/PhoneInput";
import DedupWarning from "@/components/DedupWarning";
import LeadSourceMediumFields from "@/components/LeadSourceMediumFields";
import LocationSelect from "@/components/LocationSelect";
import RequirementSection from "@/components/RequirementSection";

async function createLeadAction(formData: FormData) {
  "use server";
  // Lead creation is ADMIN/MANAGER only. Server actions are reachable via direct
  // POST, so the role check must live here — not just on the page/button. Agents
  // work only the leads already assigned to them.
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/leads");
  const sourceRaw = String(formData.get("source") ?? "").trim();
  const source = sourceRaw && (Object.values(LeadSource) as string[]).includes(sourceRaw)
    ? (sourceRaw as LeadSource) : LeadSource.OTHER;

  // PhoneInput posts already-E164'd value; normalise anyway as defence
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = toE164(rawPhone) ?? undefined;
  const rawAltPhone = String(formData.get("altPhone") ?? "").trim();
  const altPhone = rawAltPhone ? (toE164(rawAltPhone) ?? undefined) : undefined;

  const remarksText = String(formData.get("remarks") ?? "").trim() || undefined;
  const { lead } = await ingestLead({
    name: String(formData.get("name") ?? "").trim(),
    phone,
    email: String(formData.get("email") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    configuration: String(formData.get("configuration") ?? "").trim() || undefined,
    budgetMin: Number(formData.get("budgetMin")) || undefined,
    budgetMax: Number(formData.get("budgetMax")) || undefined,
    notesShort: remarksText,
    source,
    // ITEM 2: attribute the LEAD_CREATED Activity to the creator so the initial
    // remark shows in Smart Timeline with date + time + USER. The remark text
    // itself renders once as a dated Conversation-History entry (leadIngest's
    // websiteMessageRemark → rawRemarks), and this flag adds the "✨ Lead Created
    // · <creator> · <IST time>" row — no duplication. See leadIngest.ts.
    createdByUserId: me.id,
  });

  // Add alternative contact info after lead creation. Proper-Case the alt name(s)
  // at the source (the primary name is normalized inside ingestLead).
  const altName = normalizeNameList(String(formData.get("altName") ?? "").trim()) || undefined;
  const altEmail = String(formData.get("altEmail") ?? "").trim() || undefined;
  if (altName || altPhone || altEmail) {
    await prisma.lead.update({ where: { id: lead.id }, data: { altName, altPhone, altEmail } });
  }

  // Enrich with depth fields. opt() trims + drops blanks.
  const opt = <T,>(v: FormDataEntryValue | null): T | undefined => {
    const s = (v ?? "").toString().trim();
    return s ? (s as unknown as T) : undefined;
  };

  const update: Record<string, unknown> = {};
  const team = String(formData.get("forwardedTeam") ?? "");
  if (team) update.forwardedTeam = team;
  // Currency is selected on the form (reacts to team; INR for India, AED/INR for
  // Dubai). NOTE: budget values are stored as entered — no FX conversion.
  const currency = String(formData.get("budgetCurrency") ?? "").trim();
  if (currency && ["AED", "INR", "GBP", "USD"].includes(currency)) {
    update.budgetCurrency = currency;
  }
  const company = opt<string>(formData.get("company")); if (company) update.company = company;
  const city = opt<string>(formData.get("city")); if (city) update.city = city;
  const state = opt<string>(formData.get("state")); if (state) update.state = state;
  const country = opt<string>(formData.get("country")); if (country) update.country = country;
  const address = opt<string>(formData.get("address")); if (address) update.address = address;
  const propertyType = opt<string>(formData.get("propertyType")); if (propertyType) update.propertyType = propertyType;
  const sourceDetail = opt<string>(formData.get("sourceDetail")); if (sourceDetail) update.sourceDetail = sourceDetail;
  const currentStatus = opt<string>(formData.get("currentStatus")); if (currentStatus) update.currentStatus = currentStatus;
  const categorization = opt<string>(formData.get("categorization")); if (categorization) update.categorization = categorization;
  // profession is now free TEXT (enum widened — migration 20260623170000).
  const profession = opt<string>(formData.get("profession")); if (profession) update.profession = profession;
  const linkedInUrl = opt<string>(formData.get("linkedInUrl"));
  if (linkedInUrl) {
    // Basic URL validation — reject anything not http(s)
    if (/^https?:\/\//i.test(linkedInUrl)) update.linkedInUrl = linkedInUrl;
  }
  const remarks = opt<string>(formData.get("remarks")); if (remarks) update.remarks = remarks;
  // Medium field (with optional custom value when medium="Other")
  const medium = opt<string>(formData.get("medium"));
  const mediumOther = opt<string>(formData.get("mediumOther"));
  if (medium || mediumOther) {
    const { medium: m, mediumOther: mo } = validateMedium(medium, mediumOther);
    if (m) update.medium = m;
    if (mo) update.mediumOther = mo;
  }
  // WCR Event fields (shown only when source = WCR_EVENT). eventName posts the
  // resolved value (a picked platform OR a typed custom name).
  const eventName = opt<string>(formData.get("eventName")); if (eventName) update.eventName = eventName;
  const eventCountry = opt<string>(formData.get("eventCountry")); if (eventCountry) update.eventCountry = eventCountry;
  const eventState = opt<string>(formData.get("eventState")); if (eventState) update.eventState = eventState;
  const eventCity = opt<string>(formData.get("eventCity")); if (eventCity) update.eventCity = eventCity;
  // Referral field (shown only when source = REFERRAL)
  const referralName = opt<string>(formData.get("referralName")); if (referralName) update.referralName = referralName;
  // Created Date — admin/manager may backfill an earlier date for offline / walk-in /
  // delayed entries (this action is already admin/manager-only; agents were redirected
  // above). The picked date becomes the lead's Created Date (createdAt) so reports /
  // filters / dashboards reflect it; the TRUE insert time stays in the audit trail (the
  // LEAD_CREATED activity carries real-now). A future date is rejected; the default
  // (today) is effectively a no-op. Stored at noon IST. (Lalit 2026-06-28)
  const createdDateStr = String(formData.get("leadCreatedDate") ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(createdDateStr)) {
    const picked = new Date(`${createdDateStr}T06:30:00.000Z`); // 06:30 UTC = 12:00 IST
    if (!isNaN(picked.getTime()) && picked.getTime() <= Date.now() + 24 * 60 * 60 * 1000) {
      update.createdAt = picked;
    }
  }
  if (Object.keys(update).length) await prisma.lead.update({ where: { id: lead.id }, data: update });

  // Link the lead to a discussed Project (matched by name) when one was picked.
  // Mirrors the bulk-edit Project linking — a LeadProject row with MANUAL source.
  // When the typed property name matches no Project, we DON'T force a wrong link;
  // the name is still preserved as the lead's sourceDetail (Interested Property).
  const projectName = String(formData.get("project") ?? "").trim();
  if (projectName) {
    const proj = await prisma.project.findFirst({
      where: { name: { equals: projectName, mode: "insensitive" } },
      select: { id: true },
    });
    if (proj) {
      await prisma.leadProject
        .create({ data: { leadId: lead.id, projectId: proj.id, sourceType: "MANUAL" } })
        .catch(() => {});
    } else if (!update.sourceDetail) {
      // Unmatched custom property name → keep it as the Interested Property text
      // (sourceDetail), but never overwrite an explicit Source Detail entry.
      await prisma.lead.update({ where: { id: lead.id }, data: { sourceDetail: projectName } }).catch(() => {});
    }
  }

  // Assign the lead to the chosen owner at creation time (mandatory in the form).
  // Reuses the canonical assignLeadTo() → sets ownerId + assignedAt + SLA, writes
  // an Assignment history row, and notifies the new owner. Validated against the
  // active, non-HR roster so a tampered POST can't target an inactive/HR user.
  const ownerId = String(formData.get("ownerId") ?? "").trim();
  if (ownerId) {
    const owner = await prisma.user.findFirst({ where: { id: ownerId, active: true, hrOnly: false }, select: { id: true } });
    if (owner) await assignLeadTo(lead.id, owner.id, "manual creation");
  }

  redirect(`/leads/${lead.id}`);
}

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

// Common profession suggestions for the free-text datalist (task 3). The field
// accepts ANY typed value — these are just convenient starting points.
const PROFESSION_SUGGESTIONS = [
  "Job / Salaried",
  "Self-employed",
  "Business owner",
  "Investor",
  "Retired",
  "Student",
  "Other",
];

export default async function NewLeadPage() {
  const me = await requireUser();
  if (me.role === "AGENT") redirect("/leads");
  const dubaiProjects = await prisma.project.findMany({
    where: { country: "AE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  const indiaProjects = await prisma.project.findMany({
    where: { country: "IN" },
    select: { id: true, name: true },
    orderBy: { name: "asc" }
  });
  // Active, non-HR roster for the "Assign To" picker (HR users never appear in Sales).
  const assignableUsers = await prisma.user.findMany({
    where: { active: true, hrOnly: false },
    select: { id: true, name: true, team: true, role: true, isSuperAdmin: true },
    orderBy: { name: "asc" },
  });
  // Available mediums + event names fetched on the server and passed as props.
  // NEVER let a client component import these helpers — they pull Prisma into
  // the bundle (server/client boundary violation).
  const availableMediums = await getAvailableMediums();
  const availableEventNames = await getAvailableEventNames();
  const defaultCurrency = defaultCurrencyForTeam(me.team);
  const defaultTeam = me.team && (me.team === "Dubai" || me.team === "India") ? me.team : (defaultCurrency === "INR" ? "India" : "Dubai");
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold">New Lead</h1>
      <form id="new-lead-form" action={createLeadAction} className="card p-4 sm:p-6 max-w-4xl space-y-5 sm:space-y-6">
        {/* Identity */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">IDENTITY</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div><label className={label}>👤 Customer Name *</label><input name="name" required className={input} /></div>
            <div>
              <label className={label}>📞 Mobile</label>
              <div className="mt-1">
                <PhoneInput name="phone" defaultDial={defaultDialForTeam(me.team)} />
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">Pick the country flag · WhatsApp/Call buttons need the right code</p>
            </div>
            <div><label className={label}>✉ E-mail</label><input name="email" type="email" className={input} /></div>
            <div><label className={label}>👤 Alternative Name</label><input name="altName" className={input} /></div>
            <div>
              <label className={label}>📞 Alternative Mobile</label>
              <div className="mt-1">
                <PhoneInput name="altPhone" defaultDial={defaultDialForTeam(me.team)} />
              </div>
            </div>
            <div><label className={label}>✉ Alternative Email</label><input name="altEmail" type="email" className={input} /></div>
          </div>
          {/* Dedup warning — non-blocking; fires ONLY on phone/altPhone/email/altEmail */}
          <div className="mt-3">
            <DedupWarning formId="new-lead-form" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mt-3">
            <div><label className={label}>🏢 Company</label><input name="company" className={input} /></div>
            <div>
              <label className={label}>💼 Profession</label>
              <input name="profession" className={input} list="profession-suggestions" autoComplete="off" />
              <datalist id="profession-suggestions">
                {PROFESSION_SUGGESTIONS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <label className={label}>🔗 LinkedIn URL</label>
              <input name="linkedInUrl" type="url" className={input} />
            </div>
            <div>
              <label className={label}>📅 Created Date</label>
              <input
                name="leadCreatedDate"
                type="date"
                defaultValue={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}
                max={new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date())}
                className={input}
              />
              <p className="text-[10px] text-gray-500 mt-0.5">Defaults to today · backfill an earlier date for offline / walk-in / delayed entries</p>
            </div>
          </div>
          {/* Location — Country → State/Province → City → Address, cascading
              suggestions with free typing (task 5). */}
          <div className="mt-3">
            <LocationSelect names={{ country: "country", state: "state", city: "city", address: "address" }} />
          </div>
        </section>

        {/* Requirement — Team first; Assign-To / Interested Properties / Currency
            react to the selected team (tasks 6-10). */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">REQUIREMENT</div>
          <RequirementSection
            users={assignableUsers}
            dubaiProjects={dubaiProjects}
            indiaProjects={indiaProjects}
            defaultTeam={defaultTeam}
            defaultCurrency={defaultCurrency}
          />
          {/* Source + Medium (+ WCR Event / Referral conditionals) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mt-3">
            <LeadSourceMediumFields
              sources={Object.values(LeadSource)}
              mediums={availableMediums}
              eventNames={availableEventNames}
            />
          </div>
        </section>

        {/* Notes */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">NOTES</div>
          <div>
            <label className={label}>📝 Remarks</label>
            <textarea name="remarks" rows={3} className={input}></textarea>
          </div>
        </section>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <a href="/leads" className="btn btn-ghost justify-center">Cancel</a>
          <button className="btn btn-primary justify-center">Create Lead</button>
        </div>
      </form>
    </>
  );
}
