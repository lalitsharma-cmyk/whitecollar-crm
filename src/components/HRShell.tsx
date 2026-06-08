"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Users, CalendarDays, Clock, AlertCircle,
  FileText, BarChart3, Settings, ChevronLeft, ChevronRight,
  Menu, X, Briefcase, LogOut,
} from "lucide-react";

type NavItem = { href: string; label: string; Icon: React.ElementType; badge?: number };

const NAV: NavItem[] = [
  { href: "/hr",           label: "Dashboard",       Icon: LayoutDashboard },
  { href: "/hr/candidates",  label: "Candidates",       Icon: Users },
  { href: "/hr/interviews",  label: "Interviews",       Icon: CalendarDays },
  { href: "/hr/followups",   label: "Follow Ups",       Icon: Clock },
  { href: "/hr/calendar",    label: "Calendar",         Icon: CalendarDays },
  { href: "/hr/missed",      label: "Missed Follow Ups",Icon: AlertCircle },
  { href: "/hr/resume-bank", label: "Resume Bank",      Icon: FileText },
  { href: "/hr/reports",     label: "Reports",          Icon: BarChart3 },
  { href: "/hr/settings",    label: "Settings",         Icon: Settings },
];

const BOTTOM_NAV: NavItem[] = [
  { href: "/hr",            label: "Home",       Icon: LayoutDashboard },
  { href: "/hr/candidates", label: "Candidates", Icon: Users },
  { href: "/hr/interviews", label: "Interviews", Icon: CalendarDays },
  { href: "/hr/followups",  label: "Follow Ups", Icon: Clock },
  { href: "/hr/missed",     label: "Missed",     Icon: AlertCircle },
];

interface Props {
  children: React.ReactNode;
  user: { name: string; role: string; avatarColor?: string };
  overdueCount?: number;
}

export default function HRShell({ children, user, overdueCount = 0 }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const initials = user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  function isActive(href: string) {
    if (href === "/hr") return pathname === "/hr";
    return pathname.startsWith(href);
  }

  const navItem = (item: NavItem, compact: boolean) => {
    const active = isActive(item.href);
    const badge = item.href === "/hr/missed" && overdueCount > 0 ? overdueCount : 0;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative
          ${active
            ? "bg-white/15 text-white"
            : "text-slate-300 hover:bg-white/10 hover:text-white"
          }
          ${compact ? "justify-center px-2" : ""}
        `}
        title={compact ? item.label : undefined}
      >
        <item.Icon className={`shrink-0 ${compact ? "w-5 h-5" : "w-4 h-4"}`} />
        {!compact && <span>{item.label}</span>}
        {badge > 0 && (
          <span className={`bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center
            ${compact ? "absolute -top-1 -right-1" : "ml-auto"}`}>
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f5f6fa] dark:bg-slate-950">
      {/* ── Desktop sidebar ── */}
      <aside className={`hidden lg:flex flex-col shrink-0 transition-[width] duration-200 overflow-hidden
        ${collapsed ? "w-14" : "w-60"}
        bg-[#1a2e4a] text-white`}>
        {/* Logo */}
        <div className={`flex items-center border-b border-white/10 ${collapsed ? "justify-center py-4 px-1" : "px-4 py-4"}`}>
          {collapsed ? (
            <Briefcase className="w-6 h-6 text-white/80" />
          ) : (
            <div>
              <div className="text-sm font-bold text-white leading-tight">HR Recruitment</div>
              <div className="text-[10px] text-slate-400">White Collar Realty</div>
            </div>
          )}
        </div>

        {/* Nav items */}
        <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${collapsed ? "px-1" : "px-3"}`}>
          {NAV.map(item => navItem(item, collapsed))}

          {/* Divider + back to Sales CRM */}
          <div className="border-t border-white/10 my-2" />
          <Link href="/dashboard"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition
              ${collapsed ? "justify-center px-2" : ""}`}
            title={collapsed ? "Sales CRM" : undefined}>
            <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
            {!collapsed && "Back to Sales CRM"}
          </Link>
        </nav>

        {/* User + collapse toggle */}
        <div className={`border-t border-white/10 p-3 ${collapsed ? "flex justify-center" : "flex items-center justify-between"}`}>
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <div className={`avatar ${user.avatarColor ?? "bg-indigo-500"} w-7 h-7 text-[11px] shrink-0`}>{initials}</div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">{user.name}</div>
                <div className="text-[10px] text-slate-400">HR</div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className="text-slate-400 hover:text-white transition p-1 rounded"
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>
      </aside>

      {/* ── Mobile: header + drawer ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#1a2e4a] text-white shrink-0">
          <button onClick={() => setMobileOpen(true)} className="p-1 rounded hover:bg-white/10">
            <Menu className="w-5 h-5" />
          </button>
          <div className="text-sm font-bold">HR Recruitment</div>
          <div className={`avatar ${user.avatarColor ?? "bg-indigo-500"} w-7 h-7 text-[11px]`}>{initials}</div>
        </header>

        {/* Mobile drawer overlay */}
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-[#1a2e4a] flex flex-col">
              <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
                <div>
                  <div className="text-sm font-bold text-white">HR Recruitment</div>
                  <div className="text-[10px] text-slate-400">{user.name}</div>
                </div>
                <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex-1 py-3 px-3 space-y-0.5 overflow-y-auto">
                {NAV.map(item => navItem(item, false))}
                <div className="border-t border-white/10 my-2" />
                <Link href="/dashboard" onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/10 transition">
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Back to Sales CRM
                </Link>
              </nav>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

        {/* Mobile bottom nav */}
        <nav className="lg:hidden flex border-t border-gray-200 bg-white dark:bg-slate-900 dark:border-slate-700 shrink-0 safe-area-bottom">
          {BOTTOM_NAV.map(item => {
            const active = isActive(item.href);
            const badge = item.href === "/hr/missed" && overdueCount > 0 ? overdueCount : 0;
            return (
              <Link key={item.href} href={item.href}
                className={`flex-1 flex flex-col items-center py-2 gap-0.5 text-[10px] font-medium transition relative
                  ${active ? "text-[#1a2e4a] dark:text-blue-400" : "text-gray-500 dark:text-slate-500"}`}>
                <item.Icon className="w-5 h-5" />
                <span className="truncate">{item.label}</span>
                {badge > 0 && (
                  <span className="absolute top-1 right-1/4 bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center">
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
