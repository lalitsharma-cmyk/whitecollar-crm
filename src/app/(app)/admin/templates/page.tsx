import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { triggerLabel } from "@/lib/templates";
import TemplateEditor from "@/components/TemplateEditor";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  await requireRole("ADMIN", "MANAGER");
  const templates = await prisma.template.findMany({ orderBy: [{ kind: "asc" }, { trigger: "asc" }, { name: "asc" }] });
  const waCount = templates.filter(t => t.kind === "WHATSAPP").length;
  const emailCount = templates.filter(t => t.kind === "EMAIL").length;

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">📝 Message Templates</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Reusable WhatsApp + email templates. Use <code className="bg-gray-100 px-1 rounded">{`{{name}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{agent}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{project}}`}</code>, <code className="bg-gray-100 px-1 rounded">{`{{budget}}`}</code> as placeholders.
            <br />Currently: {waCount} WhatsApp · {emailCount} Email templates.
          </p>
        </div>
        <TemplateEditor mode="new" />
      </div>

      <div className="card p-4">
        <div className="font-semibold text-sm mb-2">📖 Placeholders cheat sheet</div>
        <div className="text-xs text-gray-700 grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono">
          <div><code>{`{{name}}`}</code> → lead first name</div>
          <div><code>{`{{fullname}}`}</code> → full name</div>
          <div><code>{`{{agent}}`}</code> → your first name</div>
          <div><code>{`{{agent_full}}`}</code> → your full name</div>
          <div><code>{`{{project}}`}</code> → first interested project</div>
          <div><code>{`{{city}}`}</code> → project city</div>
          <div><code>{`{{budget}}`}</code> → formatted budget min</div>
          <div><code>{`{{phone}}`}</code> → lead phone (E.164)</div>
        </div>
      </div>

      {/* WhatsApp section */}
      <section>
        <h2 className="text-base font-bold mb-2">💬 WhatsApp templates ({waCount})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.filter(t => t.kind === "WHATSAPP").map(t => (
            <div key={t.id} className="card p-4 border-l-4 border-emerald-500">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-sm">{t.name}</div>
                <span className="text-[10px] chip src whitespace-nowrap">{triggerLabel(t.trigger)}</span>
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono mt-1 bg-gray-50 p-2 rounded">{t.body}</pre>
              <div className="mt-2 flex justify-end">
                <TemplateEditor mode="edit" template={{ id: t.id, kind: t.kind, trigger: t.trigger, name: t.name, subject: t.subject, body: t.body }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Email section */}
      <section>
        <h2 className="text-base font-bold mb-2">✉ Email templates ({emailCount})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.filter(t => t.kind === "EMAIL").map(t => (
            <div key={t.id} className="card p-4 border-l-4 border-blue-500">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-semibold text-sm">{t.name}</div>
                  {t.subject && <div className="text-xs text-gray-500 mt-0.5"><b>Subject:</b> {t.subject}</div>}
                </div>
                <span className="text-[10px] chip src whitespace-nowrap">{triggerLabel(t.trigger)}</span>
              </div>
              <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono mt-1 bg-gray-50 p-2 rounded max-h-40 overflow-y-auto">{t.body}</pre>
              <div className="mt-2 flex justify-end">
                <TemplateEditor mode="edit" template={{ id: t.id, kind: t.kind, trigger: t.trigger, name: t.name, subject: t.subject, body: t.body }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
