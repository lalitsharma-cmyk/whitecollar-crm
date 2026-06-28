"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard, Users, CalendarDays, Clock, AlertCircle,
  FileText, BarChart3, Settings, ChevronLeft, ChevronRight,
  Menu, X, Briefcase, LogOut, Upload,
} from "lucide-react";

type NavItem = { href: string; label: string; Icon: React.ElementType; badge?: number };

const NAV: NavItem[] = [
  { href: "/hr",             label: "Dashboard",  Icon: LayoutDashboard },
  { href: "/hr/candidates",  label: "Candidates", Icon: Users },
  { href: "/hr/interviews",  label: "Interviews", Icon: CalendarDays },
  { href: "/hr/followups",   label: "Follow Ups", Icon: Clock },
  { href: "/hr/resume-bank", label: "Resume Bank",Icon: FileText },
];
const REPORTS_NAV: NavItem = { href: "/hr/reports",  label: "Reports",  Icon: BarChart3 };
const SETTINGS_NAV: NavItem = { href: "/hr/settings", label: "Settings", Icon: Settings };

function hrRoleLabelFor(role?: string | null) {
  switch (role) {
    case "ADMIN": return "Admin";
    case "SENIOR_HR": return "Senior HR";
    case "JUNIOR_HR": return "Junior HR";
    default: return "HR";
  }
}

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
  /** HR role label source — purely informational here; nav gating uses `perms`. */
  hrRole?: string | null;
  /** Which permission-gated nav items to show. Backend still enforces each. */
  perms?: { reports?: boolean; settings?: boolean; importData?: boolean };
  overdueCount?: number;
}

export default function HRShell({ children, user, hrRole, perms, overdueCount = 0 }: Props) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Collapsed (icons only) BY DEFAULT. Expands on hover (overlay, no reflow) or
  // when pinned open via the toggle. Collapsed gives the candidate table the room.
  const [collapsed, setCollapsed] = useState(true);
  const [hovered, setHovered] = useState(false);
  const expanded = !collapsed || hovered;

  const initials = user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  // RBAC nav hiding: the backend enforces every permission; this only hides nav
  // items the user lacks so they don't follow dead/forbidden links. Reports /
  // Settings / Import are permission-gated (Admin + Senior HR have them; Junior
  // HR does not). All other links stay visible to every HR user.
  const navItems: NavItem[] = [
    ...NAV,
    ...(perms?.importData ? [{ href: "/hr/import", label: "Import", Icon: Upload }] : []),
    ...(perms?.reports ? [REPORTS_NAV] : []),
    ...(perms?.settings ? [SETTINGS_NAV] : []),
  ];

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
        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative border-l-2
          ${active
            ? "bg-[#c9a24b]/15 text-white border-[#c9a24b]"
            : "text-slate-300 hover:bg-white/10 hover:text-white border-transparent"
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
      {/* ── Desktop sidebar — collapsed (64px, icons only) by default. Hover to
             peek (overlays, no reflow); toggle to pin open (240px, reflows). ── */}
      <aside
        className={`hidden lg:block shrink-0 relative transition-[width] duration-200 ${collapsed ? "w-16" : "w-60"}`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className={`absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden bg-[#0b1a33] text-white transition-[width] duration-200
          ${expanded ? "w-60" : "w-16"} ${collapsed && hovered ? "shadow-2xl shadow-black/40" : ""}`}>
          {/* Logo */}
          <div className={`flex items-center border-b border-white/10 ${!expanded ? "justify-center py-4 px-1" : "px-4 py-4"}`}>
            {!expanded ? (
              <Briefcase className="w-6 h-6 text-white/80" />
            ) : (
              <div>
                <div className="text-sm font-bold text-white leading-tight">HR Recruitment</div>
                <div className="text-[10px] text-slate-400">White Collar Realty</div>
              </div>
            )}
          </div>

          {/* Nav items */}
          <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto ${!expanded ? "px-1" : "px-3"}`}>
            {navItems.map(item => navItem(item, !expanded))}
          </nav>

          {/* Sign out */}
          <div className={`border-t border-white/10 ${!expanded ? "px-1 py-2" : "px-3 py-2"}`}>
            <form action="/api/logout" method="post">
              <button
                type="submit"
                title="Sign out"
                className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors ${!expanded ? "justify-center px-2" : ""}`}
              >
                <LogOut className="w-4 h-4 shrink-0" strokeWidth={2} />
                {expanded && <span>Sign out</span>}
              </button>
            </form>
          </div>

          {/* User + collapse toggle */}
          <div className={`border-t border-white/10 p-3 ${!expanded ? "flex justify-center" : "flex items-center justify-between"}`}>
            {expanded && (
              <div className="flex items-center gap-2 min-w-0">
                <div className={`avatar ${user.avatarColor ?? "bg-indigo-500"} w-7 h-7 text-[11px] shrink-0`}>{initials}</div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{user.name}</div>
                  <div className="text-[10px] text-slate-400">{hrRoleLabelFor(hrRole)}</div>
                </div>
              </div>
            )}
            <button
              onClick={() => setCollapsed(c => !c)}
              title={collapsed ? "Pin sidebar open" : "Collapse sidebar"}
              className="text-slate-400 hover:text-white transition p-1 rounded shrink-0"
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </aside>

      {/* ── Mobile: header + drawer ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0b1a33] text-white shrink-0">
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
            <div className="absolute left-0 top-0 bottom-0 w-64 bg-[#0b1a33] flex flex-col">
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
                {navItems.map(item => navItem(item, false))}
              </nav>
              {/* Sign out */}
              <div className="border-t border-white/10 p-3">
                <form action="/api/logout" method="post">
                  <button
                    type="submit"
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
                  >
                    <LogOut className="w-4 h-4 shrink-0" strokeWidth={2} />
                    <span>Sign out</span>
                  </button>
                </form>
              </div>
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
