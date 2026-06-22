import { redirect } from "next/navigation";
import { ingestLead, assignLeadTo } from "@/lib/leadIngest";
import { LeadSource, Profession, ClientType, AuthorityLevel, BantStatus } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultCurrencyForTeam } from "@/lib/money";
import { defaultDialForTeam, toE164 } from "@/lib/phone";
import PhoneInput from "@/components/PhoneInput";
import { fromISTLocalInput } from "@/lib/datetime";
import BudgetInput from "@/components/BudgetInput";
import FormDateTimeIST from "@/components/FormDateTimeIST";
import DedupWarning from "@/components/DedupWarning";
import AssignToSelect from "@/components/AssignToSelect";

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

  const { lead } = await ingestLead({
    name: String(formData.get("name") ?? "").trim(),
    phone,
    email: String(formData.get("email") ?? "").trim() || undefined,
    city: String(formData.get("city") ?? "").trim() || undefined,
    configuration: String(formData.get("configuration") ?? "").trim() || undefined,
    budgetMin: Number(formData.get("budgetMin")) || undefined,
    budgetMax: Number(formData.get("budgetMax")) || undefined,
    notesShort: String(formData.get("remarks") ?? "").trim() || undefined,
    source,
  });

  // Add alternative contact info after lead creation
  const altName = String(formData.get("altName") ?? "").trim() || undefined;
  const altEmail = String(formData.get("altEmail") ?? "").trim() || undefined;
  if (altName || altPhone || altEmail) {
    await prisma.lead.update({ where: { id: lead.id }, data: { altName, altPhone, altEmail } });
  }

  // Enrich with Dubai depth fields
  const opt = <T,>(v: FormDataEntryValue | null): T | undefined => {
    const s = (v ?? "").toString().trim();
    return s ? (s as unknown as T) : undefined;
  };

  const update: Record<string, unknown> = {};
  const team = String(formData.get("forwardedTeam") ?? "");
  if (team) update.forwardedTeam = team;
  // Currency is now selected independently
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
  const clientType = opt<ClientType>(formData.get("clientType")); if (clientType) update.clientType = clientType;
  const authorityLevel = opt<AuthorityLevel>(formData.get("authorityLevel")); if (authorityLevel) update.authorityLevel = authorityLevel;
  const bantStatus = opt<BantStatus>(formData.get("bantStatus")); if (bantStatus) update.bantStatus = bantStatus;
  const profession = opt<Profession>(formData.get("profession")); if (profession) update.profession = profession;
  const linkedInUrl = opt<string>(formData.get("linkedInUrl"));
  if (linkedInUrl) {
    // Basic URL validation — reject anything not http(s)
    if (/^https?:\/\//i.test(linkedInUrl)) update.linkedInUrl = linkedInUrl;
  }
  const remarks = opt<string>(formData.get("remarks")); if (remarks) update.remarks = remarks;
  // WCR Event fields (shown only when source = WCR_EVENT)
  const eventName = opt<string>(formData.get("eventName")); if (eventName) update.eventName = eventName;
  const eventCountry = opt<string>(formData.get("eventCountry")); if (eventCountry) update.eventCountry = eventCountry;
  const eventState = opt<string>(formData.get("eventState")); if (eventState) update.eventState = eventState;
  const eventCity = opt<string>(formData.get("eventCity")); if (eventCity) update.eventCity = eventCity;
  // Referral field (shown only when source = REFERRAL)
  const referralName = opt<string>(formData.get("referralName")); if (referralName) update.referralName = referralName;
  if (Object.keys(update).length) await prisma.lead.update({ where: { id: lead.id }, data: update });

  // Link the lead to a discussed Project (matched by name) when one was picked.
  // Mirrors the bulk-edit Project linking — a LeadProject row with MANUAL source.
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
            <div><label className={label}>👤 Customer name *</label><input name="name" required className={input} /></div>
            <div>
              <label className={label}>📞 Mobile</label>
              <div className="mt-1">
                <PhoneInput name="phone" defaultDial={defaultDialForTeam(me.team)} placeholder="50 123 4567" />
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">Pick country flag · WhatsApp/Call buttons stop working without the right code</p>
            </div>
            <div><label className={label}>✉ E-mail</label><input name="email" type="email" className={input} /></div>
            <div><label className={label}>👤 Alternative name</label><input name="altName" placeholder="Co-buyer, spouse" className={input} /></div>
            <div>
              <label className={label}>📞 Alternative mobile</label>
              <div className="mt-1">
                <PhoneInput name="altPhone" defaultDial={defaultDialForTeam(me.team)} placeholder="50 123 4567" />
              </div>
            </div>
            <div><label className={label}>✉ Alternative email</label><input name="altEmail" type="email" className={input} /></div>
          </div>
          {/* Dedup warning — non-blocking; appears after the user enters phone/email */}
          <div className="mt-3">
            <DedupWarning formId="new-lead-form" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mt-3">
            <div><label className={label}>🏢 Company</label><input name="company" placeholder="e.g. Emirates NBD, TCS" className={input} /></div>
            <div>
              <label className={label}>💼 Profession</label>
              <select name="profession" className={input} defaultValue="">
                <option value="">—</option>
                <option value="JOB">Job (salaried)</option>
                <option value="SELF_EMPLOYED">Self-employed</option>
                <option value="BUSINESS_OWNER">Business owner</option>
                <option value="INVESTOR">Investor</option>
                <option value="RETIRED">Retired</option>
                <option value="STUDENT">Student</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
            <div>
              <label className={label}>🔗 LinkedIn URL</label>
              <input name="linkedInUrl" type="url" placeholder="https://linkedin.com/in/…" className={input} />
            </div>
            <div><label className={label}>City</label><input name="city" className={input} /></div>
            <div><label className={label}>State / Province</label><input name="state" className={input} /></div>
            <div><label className={label}>Country</label><input name="country" className={input} /></div>
            <div className="md:col-span-3"><label className={label}>Address</label><input name="address" className={input} /></div>
          </div>
        </section>

        {/* Requirement */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">REQUIREMENT</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className={label}>🏢 Project (discussed after intake)</label>
              <input name="project" placeholder="Marina Bay, Silverglades..." className={input} />
            </div>
            <div><label className={label}>Configuration</label><input name="configuration" placeholder="2BR / Penthouse / Villa" className={input} /></div>
            <div>
              <label className={label}>Team *</label>
              <select name="forwardedTeam" required className={input}>
                <option value="">— Select team —</option>
                <option value="Dubai">Dubai</option>
                <option value="India">India</option>
              </select>
            </div>
            <div>
              <label className={label}>Currency *</label>
              <select name="budgetCurrency" required className={input}>
                <option value="">— Select currency —</option>
                <option value="AED">AED (United Arab Emirates)</option>
                <option value="INR">INR (India)</option>
                <option value="GBP">GBP (United Kingdom)</option>
                <option value="USD">USD (United States)</option>
              </select>
            </div>
            <div>
              <label className={label}>👤 Assign To *</label>
              <AssignToSelect users={assignableUsers} initialTeam="" />
              <p className="text-[10px] text-gray-500 mt-0.5">Lead is created directly under this agent. List filters by the selected team.</p>
            </div>
            <div>
              <label className={label}>💰 Budget min</label>
              <div className="mt-1">
                <BudgetInput name="budgetMin" currency="AED" />
              </div>
            </div>
            <div>
              <label className={label}>💰 Budget max</label>
              <div className="mt-1">
                <BudgetInput name="budgetMax" currency="AED" />
              </div>
            </div>
            <div>
              <label className={label}>Categorization</label>
              <select name="categorization" className={input}>
                <option value="">—</option>
                <option>NRI Investor</option><option>NRI End-user</option>
                <option>UAE Resident Investor</option><option>UAE Resident End-user</option>
                <option>International Investor</option><option>First-time buyer</option>
              </select>
            </div>
            <div>
              <label className={label}>Source</label>
              <select name="source" id="sourceSelect" className={input}>
                <option value="">— Select source —</option>
                {Object.values(LeadSource).map(s => {
                  const labels: Record<string, string> = {
                    "WEBSITE": "Website",
                    "WCR_WEBSITE": "Website",
                    "WCR_EVENT": "WCR Event",
                    "LANDING_PAGE": "Landing Page",
                    "WHATSAPP": "WhatsApp",
                    "CSV_IMPORT": "CSV Import",
                    "EVENT": "Event",
                    "REFERRAL": "Referral",
                    "INBOUND_CALL": "Call",
                    "FACEBOOK_ADS": "Facebook Ads",
                    "GOOGLE_ADS": "Google Ads",
                    "PORTAL_99ACRES": "Portal 99acres",
                    "PORTAL_MAGICBRICKS": "Portal MagicBricks",
                    "PORTAL_HOUSING": "Portal Housing",
                    "OTHER": "Other",
                  };
                  const display = labels[s] || s.replaceAll("_", " ");
                  return <option key={s} value={s}>{display}</option>;
                })}
              </select>
            </div>
            <div><label className={label}>Source Detail</label><input name="sourceDetail" placeholder="e.g. campaign code, event name" className={input} /></div>

            {/* WCR Event conditional fields */}
            <div id="wcr-event-fields" className="md:col-span-3 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 hidden">
              <div><label className={label}>Event Name</label><input name="eventName" className={input} /></div>
              <div><label className={label}>Event Country</label><input name="eventCountry" className={input} /></div>
              <div><label className={label}>Event State</label><input name="eventState" className={input} /></div>
              <div><label className={label}>Event City</label><input name="eventCity" className={input} /></div>
            </div>

            {/* Referral conditional field */}
            <div id="referral-fields" className="md:col-span-3 hidden">
              <div><label className={label}>Referrer Name</label><input name="referralName" placeholder="Name of the person who referred this lead" className={input} /></div>
            </div>

            <script dangerouslySetInnerHTML={{__html: `
              const sourceSelect = document.getElementById('sourceSelect');
              const wcrEventFields = document.getElementById('wcr-event-fields');
              const referralFields = document.getElementById('referral-fields');

              function updateConditionalFields() {
                const source = sourceSelect.value;
                wcrEventFields.classList.toggle('hidden', source !== 'WCR_EVENT');
                referralFields.classList.toggle('hidden', source !== 'REFERRAL');
              }

              sourceSelect.addEventListener('change', updateConditionalFields);
              updateConditionalFields();
            `}} />
            <div><label className={label}>Property Type</label><input name="propertyType" placeholder="e.g. Residential, Commercial" className={input} /></div>
            <div><label className={label}>Current Status</label><input name="currentStatus" placeholder="e.g. Not reached, Callback today" className={input} /></div>
          </div>
        </section>

        {/* Client Profiling — Quick qualification */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">CLIENT PROFILE</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div>
              <label className={label}>Client Type</label>
              <select name="clientType" className={input}>
                <option value="">—</option>
                <option value="INVESTOR">Investor</option>
                <option value="END_USER">End-user</option>
                <option value="BOTH">Both investor & end-user</option>
                <option value="UNCLEAR">Unclear</option>
              </select>
            </div>
            <div>
              <label className={label}>Authority Level</label>
              <select name="authorityLevel" className={input}>
                <option value="">—</option>
                <option value="DECISION_MAKER">Decision maker</option>
                <option value="INFLUENCER">Influencer</option>
                <option value="GATEKEEPER">Gatekeeper</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>
            <div>
              <label className={label}>BANT Status</label>
              <select name="bantStatus" className={input}>
                <option value="">—</option>
                <option value="UNDER_REVIEW">Under review</option>
                <option value="QUALIFIES">Qualifies</option>
                <option value="NOT_QUALIFIED">Not qualified</option>
              </select>
            </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">NOTES</div>
          <div>
            <label className={label}>📝 Remarks</label>
            <textarea name="remarks" rows={3} placeholder="Any notes about this lead..." className={input}></textarea>
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
