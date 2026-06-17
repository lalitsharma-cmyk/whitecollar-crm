"use client";
import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Building2, PhoneCall,
  BarChart3, Settings as SettingsIcon, LogOut, Bell,
  Zap, Flame, ChevronRight, ChevronLeft,
  CalendarDays, UserCog, Upload, Database,
} from "lucide-react";

type NavItem = {
  href: string; label: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  adminOnly?: boolean; agentHidden?: boolean; badge?: boolean; tag?: string;
};
type NavGroup = { section: string | null; items: NavItem[] };

// Spec §5: Dashboard, Leads, Revival Engine, Action List, Properties, Reports, Settings
// Section headings hidden by default (icon-only). Visible when expanded.
const nav: NavGroup[] = [
  { section: null, items: [
    { href: "/dashboard",   label: "Dashboard",      Icon: LayoutDashboard, adminOnly: false },
    // Master Data sits ABOVE Leads (admin/super-admin only) — Lalit's request.
    { href: "/master-data", label: "Master Data",    Icon: Database,        adminOnly: true },
    { href: "/leads",       label: "Leads",          Icon: Users,           badge: true, adminOnly: false },
    { href: "/cold-calls",  label: "Revival Engine", Icon: Flame,           adminOnly: false },
    { href: "/action-list", label: "Action List",    Icon: Zap,             adminOnly: false },
    { href: "/properties",  label: "Properties",     Icon: Building2,       adminOnly: false },
    { href: "/reports",     label: "Reports",        Icon: BarChart3,       adminOnly: false },
  ]},
  { section: "Personal", items: [
    { href: "/notifications", label: "Notifications", Icon: Bell,          adminOnly: false },
    { href: "/calls",         label: "Call Records",  Icon: PhoneCall,     adminOnly: false, agentHidden: true },
    { href: "/settings",      label: "Settings",      Icon: SettingsIcon,  adminOnly: false },
  ]},
  { section: "Admin", items: [
    { href: "/intake",              label: "Lead Intake",     Icon: Upload,      adminOnly: true },
    { href: "/team",                label: "Team & Roles",    Icon: UserCog,     adminOnly: false },
    { href: "/admin/attendance",    label: "Attendance",      Icon: CalendarDays,adminOnly: true },
    { href: "/admin/audit",         label: "Audit Log",       Icon: SettingsIcon,adminOnly: true },
    { href: "/admin/site-visits",   label: "Site Visits",     Icon: CalendarDays,adminOnly: true },
  ]},
];

const STORAGE_KEY = "wcr_sidebar_expanded";

export default function Sidebar({
  leadCount,
  user,
}: {
  leadCount: number;
  user: { name: string; role: string; avatarColor: string };
}) {
  const pathname = usePathname();
  const initials = user.name.split(" ").map(s => s[0]).slice(0, 2).join("");
  const roleLabel = user.role === "ADMIN" ? "Admin" : user.role === "MANAGER" ? "Manager" : "Agent";

  // Default: collapsed (icon-only). Persisted in localStorage.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "1") setExpanded(true);
    } catch { /* ignore */ }
  }, []);

  function toggle() {
    setExpanded(e => {
      try { localStorage.setItem(STORAGE_KEY, e ? "0" : "1"); } catch { /* ignore */ }
      return !e;
    });
  }

  const w = expanded ? "w-56" : "w-[60px]";

  return (
    <aside className={`sidebar ${w} flex-none text-white flex flex-col h-screen sticky top-0 transition-all duration-200 overflow-hidden`}>
      {/* Logo + toggle */}
      <div className="flex items-center justify-between px-3 py-4 border-b border-white/10 min-h-[64px]">
        {expanded ? (
          <img src="/brand/wcr-logo.png" alt="WCR" className="h-9 w-auto object-contain" />
        ) : (
          <div className="w-full flex justify-center">
            <div className="w-8 h-8 rounded-full bg-[#c9a24b] flex items-center justify-center text-[#0b1a33] text-xs font-bold select-none">
              WCR
            </div>
          </div>
        )}
        {expanded && (
          <button onClick={toggle} className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors flex-none ml-2">
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Collapse toggle when icon-only */}
      {!expanded && (
        <button onClick={toggle}
          className="mx-2 mt-2 mb-1 p-1.5 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors flex items-center justify-center"
          title="Expand sidebar">
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {nav.map((group) => {
          const items = group.items.filter(i =>
            (!i.adminOnly || user.role === "ADMIN") &&
            !(i.agentHidden && user.role === "AGENT")
          );
          if (items.length === 0) return null;
          return (
            <div key={group.section ?? "main"}>
              {/* Section heading — only visible when expanded */}
              {expanded && group.section && (
                <div className="text-[9px] uppercase tracking-widest text-white/30 px-2 mb-1 mt-3 first:mt-0 font-semibold">
                  {group.section}
                </div>
              )}
              {!expanded && group.section && (
                <div className="border-t border-white/10 my-2 mx-1" />
              )}
              {items.map(({ href, label, Icon, badge }) => {
                const active = pathname === href ||
                  (href !== "/dashboard" && href !== "/leads" && pathname?.startsWith(href));
                return (
                  <Link key={href} href={href}
                    title={!expanded ? label : undefined}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors text-sm font-medium
                      ${active
                        ? "bg-white/15 text-white"
                        : "text-white/70 hover:bg-white/10 hover:text-white"}
                      ${expanded ? "" : "justify-center"}`}>
                    <Icon className="w-[18px] h-[18px] flex-none" strokeWidth={active ? 2.5 : 2} />
                    {expanded && (
                      <>
                        <span className="truncate">{label}</span>
                        {badge && (
                          <span className="ml-auto text-[10px] bg-white/10 px-1.5 py-0.5 rounded-full tabular-nums">
                            {leadCount}
                          </span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* User + sign-out */}
      <div className="p-2 border-t border-white/10 space-y-1">
        {expanded ? (
          <div className="flex items-center gap-2 px-2 py-2 rounded-lg bg-white/5">
            <div className={`avatar ${user.avatarColor} w-7 h-7 text-[11px] flex-none`}>{initials}</div>
            <div className="text-xs leading-tight flex-1 min-w-0">
              <div className="font-semibold truncate">{user.name}</div>
              <div className="text-white/50 text-[10px]">{roleLabel}</div>
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-1" title={user.name}>
            <div className={`avatar ${user.avatarColor} w-7 h-7 text-[11px]`}>{initials}</div>
          </div>
        )}
        <form action="/api/logout" method="post">
          <button type="submit"
            title={!expanded ? "Sign out" : undefined}
            className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors text-sm
              ${expanded ? "" : "justify-center"}`}>
            <LogOut className="w-4 h-4 flex-none" strokeWidth={2} />
            {expanded && <span>Sign out</span>}
          </button>
        </form>
      </div>
    </aside>
  );
}
