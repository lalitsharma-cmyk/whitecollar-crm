import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import ProfilePasswordChange from "@/components/ProfilePasswordChange";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const me = await requireUser();
  // Pull stats — last login, leads owned, calls this month
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [leadsOwned, callsThisMonth, dealsThisMonth, lastLoginRow] = await Promise.all([
    prisma.lead.count({ where: { ownerId: me.id, status: { notIn: ["WON", "LOST"] } } }),
    prisma.callLog.count({ where: { userId: me.id, startedAt: { gte: monthStart } } }),
    prisma.lead.count({ where: { ownerId: me.id, status: "WON", updatedAt: { gte: monthStart } } }),
    prisma.auditLog.findFirst({ where: { userId: me.id, action: "auth.login.success" }, orderBy: { createdAt: "desc" }, skip: 1 }),
  ]);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">👤 My Profile</h1>
        <p className="text-xs sm:text-sm text-gray-500">Personal details visible to teammates inside the CRM.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Photo + identity card */}
        <div className="card p-5">
          <div className="font-semibold mb-3">Photo</div>
          <ProfilePhotoEditor
            initialPhotoUrl={me.photoUrl ?? null}
            avatarColor={me.avatarColor ?? "bg-slate-500"}
            initials={me.name.split(" ").map(s => s[0]).slice(0, 2).join("")}
          />
        </div>

        {/* Identity */}
        <div className="card p-5 lg:col-span-2 space-y-3">
          <div className="font-semibold">Identity</div>
          <Row label="Name" value={me.name} />
          <Row label="Email" value={me.email} />
          <Row label="Role" value={me.role} chip />
          <Row label="Team" value={me.team ?? "—"} />
          {me.phone && <Row label="Phone" value={me.phone} />}
          {me.companyWhatsAppNumber && <Row label="Company WA #" value={me.companyWhatsAppNumber} />}
          {me.acefoneAgentId && <Row label="Acefone agent id" value={me.acefoneAgentId} />}
          {lastLoginRow && <Row label="Last login" value={format(lastLoginRow.createdAt, "d MMM yyyy, HH:mm")} />}
        </div>
      </div>

      {/* My stats this month */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">THIS MONTH</div>
        <div className="grid grid-cols-3 gap-3">
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold">{leadsOwned}</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Active leads</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold">{callsThisMonth}</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Calls made</div>
          </div>
          <div className="card p-4 text-center">
            <div className="text-2xl font-bold text-emerald-700">{dealsThisMonth}</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">Deals closed</div>
          </div>
        </div>
      </div>

      {/* Password change */}
      <div className="card p-5">
        <div className="font-semibold mb-3">🔒 Change password</div>
        <ProfilePasswordChange />
      </div>
    </>
  );
}

function Row({ label, value, chip }: { label: string; value: string; chip?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <div className="text-xs text-gray-500 font-semibold uppercase tracking-wide">{label}</div>
      {chip ? <span className="chip chip-warm">{value}</span> : <div className="text-right break-all">{value}</div>}
    </div>
  );
}
