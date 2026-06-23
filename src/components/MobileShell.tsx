"use client";
import React, { Suspense, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Sparkles, Menu, X,
  Building2, BarChart3, Upload, UserCog, Settings as SettingsIcon, LogOut, Landmark,
  ChevronLeft, ChevronRight, Gem, HelpCircle, AlertTriangle, Lock, PhoneCall, Briefcase, Database, ShieldCheck, Bot, Inbox, BadgeDollarSign,
} from "lucide-react";
import GlobalDateFilter from "./GlobalDateFilter";
import NotifBell from "./NotifBell";
import WhatsAppPanel from "./WhatsAppPanel";
import ThemeToggle from "./ThemeToggle";
import FestiveBanner from "./FestiveBanner";
import AccentPainter from "./AccentPainter";
import QuickSearch from "./QuickSearch";
import QuickAddLeadFab from "./QuickAddLeadFab";
import KeyboardShortcutsHelp from "./KeyboardShortcutsHelp";
import PWAInstallNudge from "./PWAInstallNudge";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

type NavItem = { href: string; label: string; Icon: React.ElementType; tag?: string; agentHidden?: boolean; adminOnly?: boolean; leadOpsHidden?: boolean };
type NavSection = { section: string; adminOnly?: boolean; managerOrAdmin?: boolean; items: NavItem[] };

// §6 — Global Back button + breadcrumb. Every page has a back button that
// preserves filters by using router.back() (keeps the full URL incl. params).
const BACK_LABELS: Record<string, string> = {
  "/leads":           "Leads",
  "/dashboard":       "Dashboard",
  "/reports":         "Reports",
  "/cold-calls":      "Revival Engine",
  "/properties":      "Properties",
  "/action-list":     "Action List",
  "/activities":      "Activities",
  "/calls":           "Call Logs",
  "/team":            "Team",
  "/admin":           "Admin",
  "/settings":        "Settings",
  "/hr":              "HR Recruitment",
  "/hr/candidates":   "Candidates",
};

function GlobalBackButton() {
  const pathname = usePathname();
  const router = useRouter();
  // Don't show on root pages (they have nothing to go back to)
  const rootPages = ["/dashboard", "/leads", "/cold-calls", "/properties",
    "/reports", "/action-list", "/activities", "/calls", "/settings",
    "/notifications", "/team", "/vault", "/ai", "/help", "/leaderboards",
    "/profile", "/admin", "/intake", "/hr"];
  const isRoot = rootPages.some(r => pathname === r);
  if (isRoot) return null;

  // Build breadcrumb label
  const parts = pathname.split("/").filter(Boolean);
  let backLabel = "Back";
  if (parts.length >= 2) {
    const parentPath = "/" + parts.slice(0, -1).join("/");
    backLabel = BACK_LABELS[parentPath] ?? BACK_LABELS["/" + parts[0]] ?? "Back";
  }
  // Special cases
  if (pathname.startsWith("/leads/")) backLabel = "Leads";
  if (pathname.startsWith("/cold-calls/")) backLabel = "Revival Engine";
  if (pathname.startsWith("/hr/candidates/")) backLabel = "Candidates";
  if (pathname.startsWith("/properties/")) backLabel = "Properties";
  if (pathname.startsWith("/admin/")) backLabel = "Admin";
  if (pathname.startsWith("/reports/")) backLabel = "Reports";
  if (pathname.startsWith("/team/")) backLabel = "Team";

  return (
    <button
      onClick={() => router.back()}
      className="flex items-center gap-1 text-sm text-gray-500 hover:text-[#0b1a33] dark:text-slate-400 dark:hover:text-white transition-colors font-medium whitespace-nowrap flex-none px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-slate-700"
    >
      <ChevronLeft className="w-4 h-4" />
      {backLabel}
    </button>
  );
}

const fullNav: NavSection[] = [
  { section: "WORKSPACE", items: [
    { href: "/dashboard",   label: "Dashboard",      Icon: LayoutDashboard },
    { href: "/master-data", label: "Master Data",    Icon: Database, adminOnly: true },
    { href: "/leads",       label: "Leads",          Icon: Users },
    { href: "/cold-calls",  label: "Revival Engine", Icon: Gem },
    { href: "/action-list", label: "Action List",    Icon: Sparkles, leadOpsHidden: true },
    { href: "/properties",  label: "Properties",     Icon: Building2 },
    { href: "/vault",       label: "Vault",          Icon: Lock },
    { href: "/reports",     label: "Reports",        Icon: BarChart3,  agentHidden: true },
    { href: "/call-logs",   label: "Call Logs",      Icon: PhoneCall,  agentHidden: true },
  ]},
  { section: "SETUP", items: [
    { href: "/profile",  label: "My Profile",    Icon: UserCog },
    { href: "/settings", label: "Settings",      Icon: SettingsIcon, agentHidden: true },
    { href: "/help",     label: "Help",          Icon: HelpCircle },
  ]},
  // MANAGER+ADMIN mini-group — surfaced to managers too (Lalit's ask).
  // Currently only the "Awaiting Team" inbox needs this scope; new items go
  // in ADMIN below unless a manager should see them.
  { section: "TEAM", managerOrAdmin: true, items: [
    { href: "/team",                label: "Team & Roles",  Icon: UserCog,       tag: undefined as string | undefined },
    { href: "/admin/awaiting-team", label: "Awaiting Team", Icon: AlertTriangle, tag: undefined as string | undefined },
  ]},
  // ADMIN-only section — all config/system tools live under /settings.
  // Only Lead Intake (CSV import) stays here as a direct link since admins
  // reach it multiple times per day.
  { section: "ADMIN", adminOnly: true, items: [
    { href: "/leads?owner=unassigned&seg=all", label: "Unassigned Leads",   Icon: Inbox },
    { href: "/admin/assistant",       label: "AI Assistant",       Icon: Bot },
    { href: "/intake",                label: "Lead Intake",        Icon: Upload, leadOpsHidden: true },
    { href: "/admin/projects",        label: "Project Master",     Icon: Landmark },
    { href: "/buyer-data",            label: "Buyer Data",         Icon: BadgeDollarSign },
    { href: "/admin/devices",         label: "Devices",            Icon: ShieldCheck },
    { href: "/admin/revival-logs",    label: "Revival Logs",       Icon: Gem },
  ]},
  // HR Recruitment — single entry point that opens the HR workspace
  { section: "RECRUITMENT", managerOrAdmin: true, items: [
    { href: "/hr", label: "HR Recruitment", Icon: Briefcase, leadOpsHidden: true },
  ]},
];

// Bottom nav for mobile — mirrors WORKSPACE order (top 5)
const bottomNav = [
  { href: "/dashboard",   label: "Home",       Icon: LayoutDashboard },
  { href: "/leads",       label: "Leads",      Icon: Users },
  { href: "/cold-calls",  label: "Revival",    Icon: Gem },
  { href: "/action-list", label: "To Do",      Icon: Sparkles },
  { href: "/properties",  label: "Properties", Icon: Building2 },
];

interface Props {
  children: React.ReactNode;
  user: { name: string; role: string; avatarColor: string; photoUrl?: string | null; team?: string | null; leadOpsOnly?: boolean };
  // Red badge count next to ADMIN → "Awaiting Team" — only ever >0 for
  // ADMIN/MANAGER. Server-fetched in (app)/layout.tsx, 0 for agents.
  awaitingTeamCount?: number;
}

/** Inline avatar — uses uploaded photo if present, falls back to colored initials. */
function Avatar({ user, initials, size }: { user: Props["user"]; initials: string; size: string }) {
  if (user.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.photoUrl} alt={user.name} className={`${size} rounded-full object-cover object-top`} />;
  }
  return <div className={`avatar ${user.avatarColor} ${size}`}>{initials}</div>;
}

export default function MobileShell({ children, user, awaitingTeamCount = 0 }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Desktop sidebar — collapsed (icon-only) by default. Persisted in localStorage.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("sidebar_collapsed") : null;
    if (stored === "false") setSidebarCollapsed(false);
  }, []);
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    if (typeof window !== "undefined") localStorage.setItem("sidebar_collapsed", String(next));
  }
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("");

  // Root pages = the 5 bottom-nav destinations + profile. On these, the
  // hamburger menu is the primary nav so no back button needed. On any
  // OTHER page (lead detail, project detail, reports/daily, /intake, /team,
  // admin pages, etc.) show a back button so the user can return.
  // Lalit: "All pages should have back buttons".
  const rootPaths = new Set(["/dashboard", "/action-list", "/leads", "/properties", "/cold-calls", "/profile"]);
  const showBack = pathname != null && !rootPaths.has(pathname);

  // Lock background scroll while the slide-out drawer is open so the page
  // behind it can't shift around — Lalit reported "popups/dropdowns distort
  // the form when they open on mobile". This + the global modal-open CSS
  // covers the shell drawer; other modals opt in via the same hook.
  useBodyScrollLock(open);

  // Back fallback: if browser history is empty (PWA opened from home screen,
  // or page opened in a new tab), router.back() does nothing. Fall back to
  // the parent route: strip the last URL segment.
  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else if (pathname) {
      const parent = pathname.replace(/\/[^/]+\/?$/, "") || "/dashboard";
      router.push(parent);
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <div className="min-h-screen">
      {/* ─────────────────── DESKTOP SIDEBAR (lg+ only) ─────────────────── */}
      {/* Collapsible: icon-only (w-14) by default, expands to w-64 on toggle.
          Preference stored in localStorage under "sidebar_collapsed". */}
      <aside className={`sidebar fixed left-0 top-0 bottom-0 hidden lg:flex flex-col text-white z-30 transition-[width] duration-200 overflow-hidden ${sidebarCollapsed ? "w-14" : "w-64"}`}>

        {/* Logo / monogram */}
        <div className={`border-b border-white/10 flex items-center justify-center flex-none ${sidebarCollapsed ? "py-4 px-1" : "px-5 py-5"}`}>
          {sidebarCollapsed ? (
            <div className="w-8 h-8 bg-[#c9a24b] rounded-lg flex items-center justify-center text-[#0b1a33] font-extrabold text-[10px] select-none">WCR</div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/brand/wcr-logo.png" alt="White Collar Realty" className="h-12 w-auto object-contain" />
          )}
        </div>

        {/* Nav items */}
        <nav className={`flex-1 py-3 space-y-0.5 overflow-y-auto overflow-x-hidden ${sidebarCollapsed ? "px-1" : "px-3"}`}>
          {fullNav.filter((g) => {
            if (g.adminOnly) return user.role === "ADMIN";
            if (g.managerOrAdmin) return user.role === "ADMIN" || user.role === "MANAGER";
            return true;
          }).map((group) => (
            <div key={group.section}>
              {/* Section label — hidden when collapsed */}
              {!sidebarCollapsed && (
                <div className="text-[10px] uppercase tracking-widest text-white/40 px-3 mb-1 mt-3 first:mt-0">{group.section}</div>
              )}
              {sidebarCollapsed && <div className="mb-1 mt-3 first:mt-0 border-t border-white/10 mx-1" />}

              {group.items.filter((item) => !(item.agentHidden && user.role === "AGENT") && !(item.adminOnly && user.role !== "ADMIN") && !(item.leadOpsHidden && user.leadOpsOnly)).map(({ href, label, Icon, tag }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
                const showAwaitingBadge = href === "/admin/awaiting-team" && awaitingTeamCount > 0;
                return (
                  <Link
                    key={href}
                    href={href}
                    title={sidebarCollapsed ? label : undefined}
                    className={`nav-item ${active ? "active" : ""} ${sidebarCollapsed ? "justify-center px-0 py-2" : ""}`}
                  >
                    {/* Icon with badge dot in collapsed mode */}
                    <span className="relative flex-none">
                      <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                      {showAwaitingBadge && sidebarCollapsed && (
                        <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
                      )}
                    </span>
                    {/* Label + badges — only in expanded mode */}
                    {!sidebarCollapsed && (
                      <>
                        <span>{label}</span>
                        {showAwaitingBadge && (
                          <span className="ml-auto text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">{awaitingTeamCount}</span>
                        )}
                        {!showAwaitingBadge && tag && (
                          <span className="ml-auto text-[10px] bg-[#c9a24b] text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{tag}</span>
                        )}
                      </>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: user info + toggle + sign out */}
        <div className={`border-t border-white/10 flex-none space-y-1 ${sidebarCollapsed ? "p-1.5" : "p-3"}`}>
          {/* Collapse / expand toggle */}
          <button
            type="button"
            onClick={toggleSidebar}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`nav-item w-full text-white/60 hover:text-white ${sidebarCollapsed ? "justify-center px-0 py-2" : ""}`}
          >
            {sidebarCollapsed
              ? <ChevronRight className="w-4 h-4 flex-none" strokeWidth={2} />
              : <><ChevronLeft className="w-4 h-4 flex-none" strokeWidth={2} /><span className="text-xs">Collapse</span></>}
          </button>

          {/* User card */}
          {sidebarCollapsed ? (
            <div className="flex justify-center py-1">
              <Avatar user={user} initials={initials} size="w-7 h-7 text-[10px]" />
            </div>
          ) : (
            <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5">
              <Avatar user={user} initials={initials} size="w-[30px] h-[30px]" />
              <div className="text-xs leading-tight flex-1 min-w-0">
                <div className="font-semibold truncate">{user.name}</div>
                <div className="text-white/60 truncate">{user.role === "ADMIN" ? "Administrator" : user.role === "MANAGER" ? "Manager" : "Sales Agent"}</div>
              </div>
            </div>
          )}

          {/* Sign out */}
          <form action="/api/logout" method="post">
            <button type="submit" title={sidebarCollapsed ? "Sign out" : undefined}
              className={`nav-item w-full text-left ${sidebarCollapsed ? "justify-center px-0 py-2" : ""}`}>
              <LogOut className="w-[18px] h-[18px] flex-none" strokeWidth={2} />
              {!sidebarCollapsed && <span>Sign out</span>}
            </button>
          </form>
        </div>
      </aside>

      {/* ─────────────────── MOBILE HEADER (lg- only) ─────────────────── */}
      {/* pt-[safe-area] keeps the bar below the iPhone status notch in PWA mode. */}
      <header
        className="lg:hidden sticky top-0 z-20 bg-[#0b1a33] text-white flex items-center px-3 py-2 gap-2 shadow"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 rounded hover:bg-white/10 w-11 h-11 flex items-center justify-center flex-shrink-0">
          <Menu className="w-6 h-6" />
        </button>
        {/* Global mobile back button — shows on every non-root page so the
            agent can always return to the previous screen. Uses router.back()
            with a parent-route fallback when history is empty. */}
        {showBack && (
          <button
            onClick={goBack}
            aria-label="Back"
            className="p-2 rounded hover:bg-white/10 w-11 h-11 flex items-center justify-center -ml-1 flex-shrink-0"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wcr-logo.png" alt="WCR" className="h-7 w-auto object-contain" />
        <div className="flex-1" />
        <WhatsAppPanel />
        <ThemeToggle />
        <Suspense fallback={<span className="w-9 h-9 inline-block" />}>
          <GlobalDateFilter />
        </Suspense>
        <NotifBell />
        {user.role !== "AGENT" && (
          <Link href="/leads/new" aria-label="New lead" className="p-2 rounded hover:bg-white/10 w-11 h-11 flex items-center justify-center flex-shrink-0">
            <span className="text-xl font-bold leading-none">+</span>
          </Link>
        )}
        <Link href="/profile" className="block">
          <Avatar user={user} initials={initials} size="w-7 h-7 text-[10px]" />
        </Link>
      </header>

      {/* ─────────────────── MOBILE DRAWER (slide-out) ─────────────────── */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 lg:hidden" onClick={() => setOpen(false)} />
          <aside
            className="sidebar fixed left-0 top-0 bottom-0 w-72 z-50 text-white flex flex-col lg:hidden"
            style={{
              paddingTop: "env(safe-area-inset-top)",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/wcr-logo.png" alt="WCR" className="h-9 w-auto object-contain" />
              <button onClick={() => setOpen(false)} className="p-2 rounded hover:bg-white/10"><X className="w-5 h-5" /></button>
            </div>
            <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
              {fullNav.filter((g) => {
                if (g.adminOnly) return user.role === "ADMIN";
                if (g.managerOrAdmin) return user.role === "ADMIN" || user.role === "MANAGER";
                return true;
              }).map((group) => (
                <div key={group.section}>
                  <div className="text-[10px] uppercase tracking-widest text-white/40 px-3 mb-1 mt-3 first:mt-0">{group.section}</div>
                  {group.items.filter((item) => !(item.agentHidden && user.role === "AGENT") && !(item.adminOnly && user.role !== "ADMIN") && !(item.leadOpsHidden && user.leadOpsOnly)).map(({ href, label, Icon, tag }) => {
                    const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
                    const showAwaitingBadge = href === "/admin/awaiting-team" && awaitingTeamCount > 0;
                    return (
                      <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-item ${active ? "active" : ""}`}>
                        <Icon className="w-[18px] h-[18px] flex-none" />
                        <span>{label}</span>
                        {showAwaitingBadge && (
                          <span className="ml-auto text-[10px] bg-red-600 text-white px-2 py-0.5 rounded-full font-bold">
                            {awaitingTeamCount}
                          </span>
                        )}
                        {!showAwaitingBadge && tag && <span className="ml-auto text-[10px] bg-[#c9a24b] text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{tag}</span>}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="p-3 border-t border-white/10 space-y-2">
              <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-white/5">
                <Avatar user={user} initials={initials} size="w-[30px] h-[30px]" />
                <div className="text-xs leading-tight flex-1 min-w-0">
                  <div className="font-semibold truncate">{user.name}</div>
                  <div className="text-white/60 truncate">{user.role}</div>
                </div>
              </div>
              <form action="/api/logout" method="post">
                <button type="submit" className="nav-item w-full text-left">
                  <LogOut className="w-[18px] h-[18px] flex-none" />
                  <span>Sign out</span>
                </button>
              </form>
            </div>
          </aside>
        </>
      )}

      {/* ─────────────────── MAIN CONTENT ─────────────────── */}
      {/* pb adds bottom-nav height (4rem) + iPhone home-indicator safe area */}
      <main
        className={`min-h-screen lg:pb-0 transition-[margin] duration-200 ${sidebarCollapsed ? "lg:ml-14" : "lg:ml-64"}`}
        style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        {/* Desktop topbar (search bar) */}
        <header className="hidden lg:flex bg-white dark:bg-slate-800 border-b border-[#e5e7eb] dark:border-slate-700 px-4 py-3 items-center gap-3 sticky top-0 z-10">
          <GlobalBackButton />
          <div className="relative flex-1 max-w-xl">
            <input
              readOnly
              onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }))}
              className="w-full pl-4 pr-4 py-2 rounded-lg bg-[#f5f6fa] dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600 border border-transparent hover:bg-white dark:hover:bg-slate-600 hover:border-[#e5e7eb] dark:hover:border-slate-500 outline-none text-sm dark:placeholder:text-slate-500 cursor-pointer"
              placeholder="Search leads, properties, phone, email…"
            />
          </div>
          {user.role !== "AGENT" && <Link href="/leads/new" className="btn btn-ghost">+ New Lead</Link>}
          {user.role !== "AGENT" && <Link href="/ai" className="btn btn-gold"><Sparkles className="w-[18px] h-[18px]" /> Ask AI</Link>}
          <WhatsAppPanel />
          <ThemeToggle />
          <Suspense fallback={<span className="w-9 h-9 inline-block" />}>
          <GlobalDateFilter />
        </Suspense>
          <NotifBell />
          <Avatar user={user} initials={initials} size="w-[30px] h-[30px]" />
        </header>
        {/* Festive banner (auto-detected from calendar in src/lib/festivals.ts).
            Shows above ALL page content. Per-festival dismiss respected. */}
        <AccentPainter />
        <FestiveBanner />
        <section className="p-3 lg:p-6 space-y-4 lg:space-y-6">{children}</section>
      </main>

      {/* ─────────────────── MOBILE BOTTOM NAV ─────────────────── */}
      {/* pb adds iPhone home-indicator safe area so the nav doesn't hide behind it */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-[#e5e7eb] dark:border-slate-700 flex z-30 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {bottomNav.filter((it) => !(user.leadOpsOnly && it.href === "/action-list")).map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 min-h-12 text-[10px] font-semibold ${active ? "text-[#c9a24b]" : "text-gray-500 dark:text-slate-400"}`}
            >
              <Icon className="w-5 h-5 mb-0.5" strokeWidth={active ? 2.5 : 2} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Global Ctrl/Cmd+K quick-search palette — mounted at shell so the
          shortcut works on every page. */}
      <QuickSearch />
      {/* Floating "+" quick-add-lead button — capture a lead in 2 taps from
          ANY page. Reuses the same create path (ingestLead) as /leads/new.
          z-40 so it sits under modals (z-50+). */}
      {user.role !== "AGENT" && <QuickAddLeadFab />}
      {/* Global `?` keyboard-shortcuts cheatsheet — also handles the `g X`
          2-key navigation sequences. */}
      <KeyboardShortcutsHelp />
      {/* One-time mobile nudge to install the CRM as a PWA. Hidden on
          desktop, on iOS (no beforeinstallprompt), already-installed, and
          for 30 days after dismissal. */}
      <PWAInstallNudge />
    </div>
  );
}
