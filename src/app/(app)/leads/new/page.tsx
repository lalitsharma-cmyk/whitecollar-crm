import { redirect } from "next/navigation";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, Profession } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { defaultCurrencyForTeam } from "@/lib/money";
import { defaultDialForTeam, toE164 } from "@/lib/phone";
import PhoneInput from "@/components/PhoneInput";
import { nowISTLocalInput, fromISTLocalInput } from "@/lib/datetime";

async function createLeadAction(formData: FormData) {
  "use server";
  await requireUser();
  const sourceRaw = String(formData.get("source") ?? "WEBSITE");
  const source = (Object.values(LeadSource) as string[]).includes(sourceRaw)
    ? (sourceRaw as LeadSource) : LeadSource.OTHER;

  // PhoneInput posts already-E164'd value; normalise anyway as defence
  const rawPhone = String(formData.get("phone") ?? "").trim();
  const phone = toE164(rawPhone) ?? undefined;

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

  // Enrich with Dubai depth fields
  const opt = <T,>(v: FormDataEntryValue | null): T | undefined => {
    const s = (v ?? "").toString().trim();
    return s ? (s as unknown as T) : undefined;
  };

  const update: Record<string, unknown> = {};
  const currency = String(formData.get("budgetCurrency") ?? "");
  if (currency === "AED" || currency === "INR") update.budgetCurrency = currency;
  const team = String(formData.get("forwardedTeam") ?? "");
  if (team) update.forwardedTeam = team;
  const company = opt<string>(formData.get("company")); if (company) update.company = company;
  const address = opt<string>(formData.get("address")); if (address) update.address = address;
  const whoIsClient = opt<string>(formData.get("whoIsClient")); if (whoIsClient) update.whoIsClient = whoIsClient;
  const categorization = opt<string>(formData.get("categorization")); if (categorization) update.categorization = categorization;
  const potential = opt<Potential>(formData.get("potential")); if (potential) update.potential = potential;
  const fundReadiness = opt<FundReadiness>(formData.get("fundReadiness")); if (fundReadiness) update.fundReadiness = fundReadiness;
  const moodStatus = opt<MoodStatus>(formData.get("moodStatus")); if (moodStatus) update.moodStatus = moodStatus;
  const whenCanInvest = opt<InvestTimeline>(formData.get("whenCanInvest")); if (whenCanInvest) update.whenCanInvest = whenCanInvest;
  const profession = opt<Profession>(formData.get("profession")); if (profession) update.profession = profession;
  const linkedInUrl = opt<string>(formData.get("linkedInUrl"));
  if (linkedInUrl) {
    // Basic URL validation — reject anything not http(s)
    if (/^https?:\/\//i.test(linkedInUrl)) update.linkedInUrl = linkedInUrl;
  }
  const todoNext = opt<string>(formData.get("todoNext")); if (todoNext) update.todoNext = todoNext;
  const remarks = opt<string>(formData.get("remarks")); if (remarks) update.remarks = remarks;
  const detailShared = opt<string>(formData.get("detailShared")); if (detailShared) update.detailShared = detailShared;
  // Parse follow-up datetime-local input as IST wall-clock (the picker is IST-labelled).
  // Without explicit IST offset, `new Date("2026-05-26T18:00")` on Vercel (UTC) becomes
  // 18:00 UTC = 23:30 IST — 5.5 hours off what the agent typed.
  const followupRaw = formData.get("followupDate")?.toString();
  if (followupRaw) {
    const d = fromISTLocalInput(followupRaw);
    if (d && d.getTime() > Date.now()) update.followupDate = d;
  }
  if (Object.keys(update).length) await prisma.lead.update({ where: { id: lead.id }, data: update });

  redirect(`/leads/${lead.id}`);
}

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

export default async function NewLeadPage() {
  const me = await requireUser();
  const defaultCurrency = defaultCurrencyForTeam(me.team);
  const defaultTeam = me.team && (me.team === "Dubai" || me.team === "India") ? me.team : (defaultCurrency === "INR" ? "India" : "Dubai");
  return (
    <>
      <h1 className="text-xl sm:text-2xl font-bold">New Lead</h1>
      <p className="text-xs sm:text-sm text-gray-500">Mirror of your Dubai team sheet — capture the FULL situation, not keywords.</p>
      <form action={createLeadAction} className="card p-4 sm:p-6 max-w-4xl space-y-5 sm:space-y-6">
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
            <div><label className={label}>Address</label><input name="address" className={input} /></div>
          </div>
        </section>

        {/* Requirement */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">REQUIREMENT</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div><label className={label}>Configuration</label><input name="configuration" placeholder="2BR / Penthouse / Villa" className={input} /></div>
            <div>
              <label className={label}>Team / Currency</label>
              <select name="forwardedTeam" defaultValue={defaultTeam} className={input}>
                <option value="Dubai">Dubai (AED)</option>
                <option value="India">India (₹)</option>
              </select>
              <input type="hidden" name="budgetCurrency" defaultValue={defaultCurrency} />
            </div>
            <div>
              <label className={label}>💰 Budget min</label>
              <div className="flex items-stretch mt-1 border border-[#e5e7eb] rounded-lg overflow-hidden">
                <span className="bg-[#f5f6fa] border-r border-[#e5e7eb] px-3 py-2 text-xs font-mono text-gray-600 flex items-center">{defaultCurrency}</span>
                <input
                  name="budgetMin"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  placeholder={defaultCurrency === "AED" ? "2500000" : "30000000"}
                  className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                />
              </div>
              <p className="text-[10px] text-gray-500 mt-0.5">Numbers only · {defaultCurrency === "AED" ? "AED 2,500,000 = 2.5M" : "₹3,00,00,000 = 3 Cr"}</p>
            </div>
            <div>
              <label className={label}>💰 Budget max</label>
              <div className="flex items-stretch mt-1 border border-[#e5e7eb] rounded-lg overflow-hidden">
                <span className="bg-[#f5f6fa] border-r border-[#e5e7eb] px-3 py-2 text-xs font-mono text-gray-600 flex items-center">{defaultCurrency}</span>
                <input
                  name="budgetMax"
                  type="number"
                  min="0"
                  step="1000"
                  inputMode="numeric"
                  className="flex-1 min-w-0 px-3 py-2 text-sm outline-none"
                />
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
              <select name="source" className={input}>{Object.values(LeadSource).map(s => <option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select>
            </div>
          </div>
        </section>

        {/* Qualification — Dubai depth fields */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">QUALIFICATION</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            <div>
              <label className={label}>Potential</label>
              <select name="potential" className={input}>
                <option value="">—</option>
                <option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option><option value="UNKNOWN">Unknown</option>
              </select>
            </div>
            <div>
              <label className={label}>Fund Readiness</label>
              <select name="fundReadiness" className={input}>
                <option value="">—</option>
                <option value="CASH_READY">Cash ready</option>
                <option value="BANK_APPROVED">Bank pre-approved</option>
                <option value="FINANCING_NEEDED">Financing needed</option>
                <option value="NOT_DISCUSSED">Not yet discussed</option>
              </select>
            </div>
            <div>
              <label className={label}>When can invest</label>
              <select name="whenCanInvest" className={input}>
                <option value="">—</option>
                <option value="IMMEDIATE">This week</option>
                <option value="THIRTY_DAYS">Within 30 days</option>
                <option value="THREE_MONTHS">3 months</option>
                <option value="SIX_PLUS_MONTHS">6+ months</option>
                <option value="WINDOW_SHOPPING">Just browsing</option>
                <option value="UNKNOWN">Unknown</option>
              </select>
            </div>
            <div>
              <label className={label}>Mood</label>
              <select name="moodStatus" className={input}>
                <option value="">—</option>
                <option value="EXCITED">😀 Excited</option><option value="INTERESTED">🙂 Interested</option>
                <option value="NEUTRAL">😐 Neutral</option><option value="HESITANT">🤔 Hesitant</option>
                <option value="COLD">🧊 Cold</option><option value="CONFUSED">😵 Confused</option>
                <option value="ANGRY">😠 Angry</option>
              </select>
            </div>
          </div>
        </section>

        {/* DEPTH — the field that matters most */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">WHO IS THE CLIENT — full situation, not keywords</div>
          <textarea name="whoIsClient" rows={6} placeholder="e.g. NRI from Mumbai based in Dubai 6+ years. Senior Director at consulting firm. Husband already owns at Burj Vista. Looking for parents who'll relocate next year. Wife is decision maker, needs to fly in. Concerned about service charges. Budget flexible if right unit." className={`${input} font-mono text-[13px] leading-relaxed`}></textarea>
        </section>

        {/* Action / scheduling */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">ACTION & SCHEDULING</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
            <div><label className={label}>🔁 Follow-up date (IST)</label><input name="followupDate" type="datetime-local" min={nowISTLocalInput()} className={input} /></div>
            <div className="md:col-span-2"><label className={label}>✅ To Do — next action</label><input name="todoNext" placeholder="e.g. Send AED brochure & payment plan" className={input} /></div>
            <div className="md:col-span-3"><label className={label}>📤 Detail shared with client</label><input name="detailShared" placeholder="e.g. Brochure v3 + payment plan + RERA note" className={input} /></div>
            <div className="md:col-span-3"><label className={label}>📝 Remarks</label><textarea name="remarks" rows={3} className={input}></textarea></div>
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
