import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import ProfilePhotoEditor from "@/components/ProfilePhotoEditor";
import ProfilePasswordChange from "@/components/ProfilePasswordChange";
import XPBar from "@/components/XPBar";
import { format } from "date-fns";
import { BADGES, parseBadgeIds, levelForXp } from "@/lib/gamification";

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

  // Gamification snapshot — parse the comma-string badge column once.
  const earnedIds = parseBadgeIds(me.badges);
  const earnedSet = new Set<string>(earnedIds);
  const levelInfo = levelForXp(me.xp ?? 0);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">👤 My Profile</h1>
        <p className="text-xs sm:text-sm text-gray-500">Personal details visible to teammates inside the CRM.</p>
      </div>

      {/* ── Gamification: level + XP progress, then streaks row ────────── */}
      <XPBar xp={me.xp ?? 0} badgeIds={earnedIds} />

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StreakTile emoji="🔥" label="Daily streak"     value={me.dailyStreak ?? 0} />
        <StreakTile emoji="📅" label="Follow-up streak" value={me.followupStreak ?? 0} />
        <StreakTile emoji="📞" label="Cold-call streak" value={me.coldCallStreak ?? 0} />
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

      {/* Achievements — full grid of badges, locked ones dimmed with tooltip. */}
      <div>
        <div className="text-xs font-bold tracking-widest text-gray-500 mb-2">ACHIEVEMENTS</div>
        <div className="card p-4">
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3">
            {BADGES.map((b) => {
              const earned = earnedSet.has(b.id);
              return (
                <div
                  key={b.id}
                  title={`${b.name} — ${b.desc}${earned ? "" : " (locked)"}`}
                  className={`flex flex-col items-center text-center gap-1 p-2 rounded-lg border transition ${
                    earned
                      ? "bg-[#fdf6e3] border-[#e7c97a]"
                      : "bg-gray-50 border-[#e5e7eb] opacity-50 grayscale"
                  }`}
                >
                  <div className="text-2xl leading-none">{b.emoji}</div>
                  <div className="text-[10px] font-semibold text-[#0b1a33] leading-tight">{b.name}</div>
                  <div className="text-[9px] text-gray-500 leading-tight line-clamp-2">{b.desc}</div>
                </div>
              );
            })}
          </div>
          <div className="text-[10px] text-gray-500 mt-3">
            {earnedIds.length} of {BADGES.length} earned · current level{" "}
            <b className="text-[#0b1a33]">{levelInfo.level.name}</b>
          </div>
        </div>
      </div>

      {/* Password change — admins and managers only; agents contact admin */}
      {me.role !== "AGENT" && (
        <div className="card p-5">
          <div className="font-semibold mb-3">🔒 Change password</div>
          <ProfilePasswordChange />
        </div>
      )}
      {me.role === "AGENT" && (
        <div className="card p-5 border border-slate-200 bg-slate-50">
          <div className="font-semibold mb-1 text-sm text-slate-700">🔒 Password</div>
          <p className="text-sm text-slate-500">To change your password, contact your admin.</p>
        </div>
      )}
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

function StreakTile({ emoji, label, value }: { emoji: string; label: string; value: number }) {
  return (
    <div className="card p-3 text-center">
      <div className="text-xl sm:text-2xl">{emoji}</div>
      <div className="text-lg sm:text-2xl font-bold text-[#0b1a33] mt-0.5">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">{label}</div>
    </div>
  );
}
