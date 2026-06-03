"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, KanbanSquare, Building2, CalendarDays,
  PhoneCall, BarChart3, Sparkles, Upload, UserCog, Settings as SettingsIcon, LogOut, Bell
} from "lucide-react";

// `adminOnly` flag — hides nav item from agents. Lalit's policy:
// - Lead Intake should only be visible to admins (bulk imports + API keys are
//   admin tools — agents shouldn't accidentally land there or see the source mix).
const nav = [
  { section: "WORKSPACE", items: [
    { href: "/dashboard",   label: "Dashboard",   Icon: LayoutDashboard, adminOnly: false },
    { href: "/action-list", label: "Action List", Icon: Sparkles, tag: "HOT", adminOnly: false },
    { href: "/leads",       label: "Leads",       Icon: Users, badge: true, adminOnly: false },
    { href: "/pipeline",    label: "Pipeline",    Icon: KanbanSquare, adminOnly: false },
    { href: "/properties", label: "Properties",  Icon: Building2, adminOnly: false },
    { href: "/calls",      label: "Call Records",Icon: PhoneCall, adminOnly: false },
    { href: "/reports",    label: "Reports",     Icon: BarChart3, adminOnly: false },
    { href: "/ai",         label: "AI Assistant",Icon: Sparkles, tag: "NEW", adminOnly: false },
    { href: "/notifications", label: "Notifications", Icon: Bell, adminOnly: false },
  ]},
  { section: "SETUP", items: [
    { href: "/intake",   label: "Lead Intake",   Icon: Upload, adminOnly: true },
    { href: "/team",     label: "Team & Roles",  Icon: UserCog, adminOnly: false },
    { href: "/settings", label: "Settings",      Icon: SettingsIcon, adminOnly: false },
  ]},
  { section: "ADMIN", items: [
    { href: "/admin/site-visits", label: "Site Visits (live)", Icon: CalendarDays, adminOnly: true, tag: "LIVE" },
    { href: "/admin/attendance",  label: "Attendance",         Icon: CalendarDays, adminOnly: true },
    { href: "/admin/audit",       label: "Audit Log",          Icon: SettingsIcon, adminOnly: true },
  ]},
];

export default function Sidebar({
  leadCount,
  user,
}: {
  leadCount: number;
  user: { name: string; role: string; avatarColor: string };
}) {
  const pathname = usePathname();
  const initials = user.name.split(" ").map(s => s[0]).slice(0, 2).join("");
  const roleLabel = user.role === "ADMIN" ? "Administrator" : user.role === "MANAGER" ? "Manager" : "Sales Agent";
  return (
    <aside className="sidebar w-64 flex-none text-white flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-white/10 flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wcr-logo.png" alt="White Collar Realty" className="h-12 w-auto object-contain" />
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {nav.map((group) => {
          const items = group.items.filter((i) => !i.adminOnly || user.role === "ADMIN");
          if (items.length === 0) return null;
          return (
            <div key={group.section}>
              <div className="text-[10px] uppercase tracking-widest text-white/40 px-3 mb-1 mt-3 first:mt-0">{group.section}</div>
              {items.map(({ href, label, Icon, badge, tag }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
                return (
                  <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
                    <Icon className="w-[18px] h-[18px] flex-none" strokeWidth={2} />
                    <span>{label}</span>
                    {badge && <span className="ml-auto text-[10px] bg-white/10 px-2 py-0.5 rounded-full">{leadCount}</span>}
                    {tag && <span className="ml-auto text-[10px] bg-[#c9a24b] text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{tag}</span>}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="p-3 border-t border-white/10 space-y-2">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5">
          <div className={`avatar ${user.avatarColor}`}>{initials}</div>
          <div className="text-xs leading-tight flex-1 min-w-0">
            <div className="font-semibold truncate">{user.name}</div>
            <div className="text-white/60 truncate">{roleLabel}</div>
          </div>
        </div>
        <form action="/api/logout" method="post">
          <button type="submit" className="nav-item w-full text-left">
            <LogOut className="w-[18px] h-[18px] flex-none" strokeWidth={2} />
            <span>Sign out</span>
          </button>
        </form>
      </div>
    </aside>
  );
}
