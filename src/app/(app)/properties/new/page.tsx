import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { ProjectStatus, UnitStatus } from "@prisma/client";
import Link from "next/link";

async function createProjectAction(formData: FormData) {
  "use server";
  await requireRole("ADMIN", "MANAGER");

  const name = String(formData.get("name") ?? "").trim();
  const developer = String(formData.get("developer") ?? "").trim() || null;
  const country = String(formData.get("country") ?? "UAE").trim() || "UAE";
  const city = String(formData.get("city") ?? "").trim();
  if (!city) throw new Error("City required");
  const area = String(formData.get("area") ?? "").trim() || null;
  const statusRaw = String(formData.get("status") ?? "OFF_PLAN");
  const status = (Object.values(ProjectStatus) as string[]).includes(statusRaw)
    ? (statusRaw as ProjectStatus) : ProjectStatus.OFF_PLAN;
  const rera = String(formData.get("rera") ?? "").trim() || null;
  const handoverRaw = String(formData.get("handoverDate") ?? "").trim();
  const handoverDate = handoverRaw ? new Date(handoverRaw) : null;

  // Configurations + base prices (comma-separated)
  // Example input: "1BR=1500000, 2BR=2400000, 3BR=3800000"
  const configsRaw = String(formData.get("configs") ?? "").trim();

  if (!name) throw new Error("Project name required");

  const project = await prisma.project.create({
    data: {
      name,
      developer: developer ?? undefined,
      country,
      city,
      area: area ?? undefined,
      status,
      rera: rera ?? undefined,
      handoverDate: handoverDate && !isNaN(handoverDate.getTime()) ? handoverDate : null,
      heroColor: country === "India" ? "from-[#1e3a8a] to-[#0ea5e9]" : "from-[#0b1a33] to-[#c9a24b]",
      source: "manual",
    },
  });

  // Parse + create initial Units (optional)
  if (configsRaw) {
    const pairs = configsRaw.split(",").map(s => s.trim()).filter(Boolean);
    let unitIdx = 1;
    for (const pair of pairs) {
      const [cfg, priceStr] = pair.split("=").map(s => s.trim());
      const priceBase = Number(priceStr) || 0;
      if (!cfg) continue;
      // Create 3 sample units per configuration (Available state)
      for (let i = 0; i < 3; i++) {
        await prisma.unit.create({
          data: {
            projectId: project.id,
            code: `U-${unitIdx.toString().padStart(3, "0")}`,
            configuration: cfg,
            carpetArea: cfg.includes("1") ? 720 : cfg.includes("2") ? 1180 : cfg.includes("3") ? 1620 : 2200,
            floor: 5 + i * 4,
            view: ["City", "Park", "Pool"][i % 3],
            priceBase,
            status: UnitStatus.AVAILABLE,
          },
        });
        unitIdx++;
      }
    }
  }

  redirect(`/properties`);
}

const inputCls = "w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm";
const labelCls = "text-xs font-semibold text-gray-600";

export default async function NewProjectPage() {
  await requireRole("ADMIN", "MANAGER");
  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">New Project</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Add a new project manually. Initial units are optional — you can add inventory later.
        </p>
      </div>

      <form action={createProjectAction} className="card p-4 sm:p-6 max-w-3xl space-y-5">
        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">PROJECT IDENTITY</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className={labelCls}>Project name *</label>
              <input name="name" required className={inputCls} placeholder="e.g. Marina Bay Residences" />
            </div>
            <div>
              <label className={labelCls}>Developer</label>
              <input name="developer" className={inputCls} placeholder="e.g. Emaar, Sobha, DLF, Lodha" />
            </div>
            <div>
              <label className={labelCls}>Country *</label>
              <select name="country" required defaultValue="UAE" className={inputCls}>
                <option value="UAE">UAE (Dubai team)</option>
                <option value="India">India (India team)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>City *</label>
              <input name="city" required className={inputCls} placeholder="Dubai / Mumbai / Gurgaon" />
            </div>
            <div>
              <label className={labelCls}>Area / locality</label>
              <input name="area" className={inputCls} placeholder="e.g. Dubai Marina, BKC, Sector 42" />
            </div>
            <div>
              <label className={labelCls}>RERA / regulatory id</label>
              <input name="rera" className={inputCls} placeholder="optional" />
            </div>
          </div>
        </section>

        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">STATUS & TIMELINE</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className={labelCls}>Project status</label>
              <select name="status" defaultValue="OFF_PLAN" className={inputCls}>
                <option value="OFF_PLAN">Off-plan</option>
                <option value="UNDER_CONSTRUCTION">Under construction</option>
                <option value="READY">Ready</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Handover date (optional)</label>
              <input name="handoverDate" type="date" className={inputCls} />
            </div>
          </div>
        </section>

        <section>
          <div className="text-xs font-bold tracking-widest text-[#c9a24b] mb-3">INITIAL UNITS (optional)</div>
          <label className={labelCls}>Configurations + base price</label>
          <input
            name="configs"
            className={`${inputCls} font-mono text-xs`}
            placeholder="1BR=1500000, 2BR=2400000, 3BR=3800000"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Format: <code>config=price, config=price</code>. Creates 3 sample units per configuration as <b>Available</b>.
            Use AED for UAE projects (e.g. <code>2BR=2400000</code>) and INR for India (e.g. <code>3BHK=80000000</code>). Leave blank to add inventory later.
          </p>
        </section>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <Link href="/properties" className="btn btn-ghost justify-center">Cancel</Link>
          <button className="btn btn-primary justify-center">Create Project</button>
        </div>
      </form>
    </>
  );
}
