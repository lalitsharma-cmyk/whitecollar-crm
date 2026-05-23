import { redirect } from "next/navigation";
import { ingestLead } from "@/lib/leadIngest";
import { LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function createLeadAction(formData: FormData) {
  "use server";
  await requireUser();
  const sourceRaw = String(formData.get("source") ?? "WEBSITE");
  const source = (Object.values(LeadSource) as string[]).includes(sourceRaw)
    ? (sourceRaw as LeadSource) : LeadSource.OTHER;

  const { lead } = await ingestLead({
    name: String(formData.get("name") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim() || undefined,
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
  const company = opt<string>(formData.get("company")); if (company) update.company = company;
  const address = opt<string>(formData.get("address")); if (address) update.address = address;
  const whoIsClient = opt<string>(formData.get("whoIsClient")); if (whoIsClient) update.whoIsClient = whoIsClient;
  const categorization = opt<string>(formData.get("categorization")); if (categorization) update.categorization = categorization;
  const potential = opt<Potential>(formData.get("potential")); if (potential) update.potential = potential;
  const fundReadiness = opt<FundReadiness>(formData.get("fundReadiness")); if (fundReadiness) update.fundReadiness = fundReadiness;
  const moodStatus = opt<MoodStatus>(formData.get("moodStatus")); if (moodStatus) update.moodStatus = moodStatus;
  const whenCanInvest = opt<InvestTimeline>(formData.get("whenCanInvest")); if (whenCanInvest) update.whenCanInvest = whenCanInvest;
  const todoNext = opt<string>(formData.get("todoNext")); if (todoNext) update.todoNext = todoNext;
  const remarks = opt<string>(formData.get("remarks")); if (remarks) update.remarks = remarks;
  const detailShared = opt<string>(formData.get("detailShared")); if (detailShared) update.detailShared = detailShared;
  const followupRaw = formData.get("followupDate")?.toString();
  if (followupRaw) update.followupDate = new Date(followupRaw);
  if (Object.keys(update).length) await prisma.lead.update({ where: { id: lead.id }, data: update });

  redirect(`/leads/${lead.id}`);
}

const input = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const label = "text-xs font-semibold text-gray-600";

export default async function NewLeadPage() {
  await requireUser();
  return (
    <>
      <h1 className="text-2xl font-bold">New Lead</h1>
      <p className="text-sm text-gray-500">Mirror of your Dubai team sheet — capture the FULL situation, not keywords.</p>
      <form action={createLeadAction} className="card p-6 max-w-4xl space-y-6">
        {/* Identity */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">IDENTITY</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><label className={label}>👤 Customer name *</label><input name="name" required className={input} /></div>
            <div><label className={label}>📞 Mobile</label><input name="phone" type="tel" placeholder="+971 50 ..." className={input} /></div>
            <div><label className={label}>✉ E-mail</label><input name="email" type="email" className={input} /></div>
            <div><label className={label}>Company</label><input name="company" placeholder="e.g. Emirates NBD" className={input} /></div>
            <div><label className={label}>City</label><input name="city" className={input} /></div>
            <div><label className={label}>Address</label><input name="address" className={input} /></div>
          </div>
        </section>

        {/* Requirement */}
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">REQUIREMENT</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><label className={label}>Configuration</label><input name="configuration" placeholder="2BR / Penthouse / Villa" className={input} /></div>
            <div><label className={label}>💰 Budget min (AED)</label><input name="budgetMin" type="number" placeholder="e.g. 2500000" className={input} /></div>
            <div><label className={label}>💰 Budget max (AED)</label><input name="budgetMax" type="number" className={input} /></div>
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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><label className={label}>🔁 Follow-up date</label><input name="followupDate" type="datetime-local" className={input} /></div>
            <div className="md:col-span-2"><label className={label}>✅ To Do — next action</label><input name="todoNext" placeholder="e.g. Send AED brochure & payment plan" className={input} /></div>
            <div className="md:col-span-3"><label className={label}>📤 Detail shared with client</label><input name="detailShared" placeholder="e.g. Brochure v3 + payment plan + RERA note" className={input} /></div>
            <div className="md:col-span-3"><label className={label}>📝 Remarks</label><textarea name="remarks" rows={3} className={input}></textarea></div>
          </div>
        </section>

        <div className="flex gap-2 justify-end">
          <a href="/leads" className="btn btn-ghost">Cancel</a>
          <button className="btn btn-primary">Create Lead</button>
        </div>
      </form>
    </>
  );
}
