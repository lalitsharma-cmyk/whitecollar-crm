import Link from "next/link";
import type { CustomerHistory, CustomerSection } from "@/lib/customerHistory";

const sectionChip: Record<CustomerSection, string> = {
  "Leads": "bg-emerald-100 text-emerald-700",
  "Revival": "bg-sky-100 text-sky-700",
  "Master Data": "bg-slate-200 text-slate-600",
  "Closed/Archived": "bg-amber-100 text-amber-700",
};

function hrefFor(section: CustomerSection, id: string): string {
  if (section === "Revival") return `/revival-engine/cold-data/${id}`;
  if (section === "Master Data" || section === "Closed/Archived") return `/master-data/${id}`;
  return `/leads/${id}`;
}

// "Previous History Found" — shown on a lead when the SAME customer (mobile/email)
// has earlier enquiries anywhere (Leads / Revival / Master Data / Closed). Makes a
// re-enquiry visible instead of a blind duplicate.
export default function PreviousHistoryCard({ history, currentId }: { history: CustomerHistory; currentId?: string }) {
  return (
    <div data-lead-section="overview" className="card p-4 border-l-4 border-amber-400">
      <div className="flex items-center justify-between flex-wrap gap-1">
        <div className="font-semibold text-gray-900 dark:text-slate-100">
          🕑 Previous History Found
          <span className="text-[11px] font-normal text-amber-700 ml-1.5">
            {history.priorCount} earlier enquir{history.priorCount === 1 ? "y" : "ies"} from this customer
          </span>
        </div>
        <span className="text-[11px] text-gray-500">Total enquiries: <b>{history.totalEnquiries}</b></span>
      </div>

      {(history.projects.length > 0 || history.owners.length > 0) && (
        <div className="mt-1.5 text-[11px] text-gray-500 dark:text-slate-400 space-y-0.5">
          {history.projects.length > 0 && <div><span className="font-medium text-gray-600 dark:text-slate-300">Projects:</span> {history.projects.join(" · ")}</div>}
          {history.owners.length > 0 && <div><span className="font-medium text-gray-600 dark:text-slate-300">Owners:</span> {history.owners.join(" · ")}</div>}
        </div>
      )}

      <div className="mt-3 space-y-1.5">
        {history.records.map((r) => {
          const isCurrent = r.id === currentId;
          return (
            <div key={r.id} className={`flex items-start gap-2 text-sm rounded-lg px-2.5 py-1.5 ${isCurrent ? "bg-amber-50/60 dark:bg-slate-700/40" : "bg-gray-50 dark:bg-slate-800/50"}`}>
              <div className="text-[10px] text-gray-400 w-20 shrink-0 pt-0.5 tabular-nums">
                {new Date(r.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Kolkata" })}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${sectionChip[r.section]}`}>{r.section}</span>
                  {r.status && <span className="text-xs text-gray-700 dark:text-slate-200">{r.status}</span>}
                  <span className="text-[10px] text-gray-400">· {r.owner}</span>
                  {isCurrent && <span className="text-[10px] text-amber-600 font-semibold">· this record</span>}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">
                  {r.projects.length > 0 && <span>{r.projects.join(", ")} · </span>}
                  {r.calls}📞 · {r.notes}📝 · {r.activities} activities
                </div>
                {r.remarks.length > 0 && (
                  <div className="mt-1 space-y-0.5 border-l-2 border-gray-200 dark:border-slate-600 pl-2">
                    {r.remarks.map((m, i) => (
                      <div key={i} className="text-[11px] text-gray-600 dark:text-slate-300 break-words">
                        <span className="text-gray-400">{new Date(m.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · {m.author}:</span>{" "}
                        {m.text}
                      </div>
                    ))}
                    {r.notes > r.remarks.length && <div className="text-[10px] text-gray-400 italic">+{r.notes - r.remarks.length} more remark(s) — open to view</div>}
                  </div>
                )}
              </div>
              {!isCurrent && (
                <Link href={hrefFor(r.section, r.id)} className="text-[11px] text-blue-600 hover:underline shrink-0 pt-0.5">open →</Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
