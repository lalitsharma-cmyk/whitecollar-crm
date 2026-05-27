"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, KanbanSquare, Sparkles, Menu, X, Bell,
  Building2, CalendarDays, PhoneCall, BarChart3, Upload, UserCog, Settings as SettingsIcon, LogOut,
  ShieldCheck, ChevronLeft, Heart, Gem, Trophy, HelpCircle, Activity, Copy, Plug,
} from "lucide-react";
import NotifBell from "./NotifBell";
import WhatsAppPanel from "./WhatsAppPanel";
import ThemeToggle from "./ThemeToggle";
import FestiveBanner from "./FestiveBanner";
import AccentPainter from "./AccentPainter";
import XPToastHost from "./XPToast";
import DealCelebrationHost from "./DealCelebration";
import QuickSearch from "./QuickSearch";
import KeyboardShortcutsHelp from "./KeyboardShortcutsHelp";
import OnboardingTour from "./OnboardingTour";
import PWAInstallNudge from "./PWAInstallNudge";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

const fullNav = [
  { section: "WORKSPACE", items: [
    { href: "/dashboard",   label: "Dashboard",   Icon: LayoutDashboard },
    { href: "/action-list", label: "Action List", Icon: Sparkles, tag: "HOT" },
    { href: "/leads",       label: "Leads",       Icon: Users },
    { href: "/cold-calls",  label: "Revival Engine", Icon: Gem },
    { href: "/pipeline",    label: "Pipeline",    Icon: KanbanSquare },
    { href: "/properties",  label: "Properties",  Icon: Building2 },
    { href: "/activities",  label: "Activities",  Icon: CalendarDays },
    { href: "/leaderboards", label: "Leaderboards", Icon: Trophy },
    { href: "/calls",       label: "Call Records",Icon: PhoneCall },
    { href: "/reports",     label: "Reports",     Icon: BarChart3 },
    { href: "/ai",          label: "AI Assistant",Icon: Sparkles, tag: "AI" },
    { href: "/notifications", label: "Notifications", Icon: Bell },
    { href: "/vault", label: "Vault", Icon: Heart, tag: undefined },
  ]},
  { section: "SETUP", items: [
    { href: "/profile",  label: "My Profile",    Icon: UserCog },
    { href: "/team",     label: "Team & Roles",  Icon: UserCog },
    { href: "/settings", label: "Settings",      Icon: SettingsIcon },
    { href: "/help",     label: "Help",          Icon: HelpCircle },
  ]},
  // ADMIN-only section — filtered out in render below
  { section: "ADMIN", adminOnly: true, items: [
    { href: "/intake",            label: "Lead Intake",   Icon: Upload,       tag: undefined as string | undefined },
    { href: "/admin/site-visits", label: "Site Visits",   Icon: CalendarDays, tag: "LIVE" as string | undefined },
    { href: "/admin/attendance",  label: "Attendance",    Icon: CalendarDays, tag: undefined as string | undefined },
    { href: "/admin/workflows",   label: "Workflows",     Icon: Sparkles,     tag: "AUTO" as string | undefined },
    { href: "/admin/templates",   label: "Templates",     Icon: Sparkles,     tag: undefined as string | undefined },
    { href: "/admin/audit",       label: "Audit Log",     Icon: ShieldCheck,  tag: undefined as string | undefined },
    { href: "/admin/targets",     label: "Daily Targets", Icon: Sparkles,     tag: undefined as string | undefined },
    { href: "/admin/team-mood",   label: "Team Mood",     Icon: Sparkles,     tag: undefined as string | undefined },
    { href: "/admin/duplicates",  label: "🔁 Duplicates", Icon: Copy,         tag: undefined as string | undefined },
    { href: "/admin/health",      label: "💚 System health", Icon: Activity,  tag: undefined as string | undefined },
    { href: "/admin/integrations", label: "🔌 Integrations", Icon: Plug,      tag: undefined as string | undefined },
  ]},
];

// Bottom nav for mobile — the 5 most-used routes
const bottomNav = [
  { href: "/dashboard",   label: "Home",     Icon: LayoutDashboard },
  { href: "/action-list", label: "To Do",    Icon: Sparkles },
  { href: "/leads",       label: "Leads",    Icon: Users },
  { href: "/pipeline",    label: "Pipeline", Icon: KanbanSquare },
  { href: "/notifications", label: "Alerts", Icon: Bell },
];

interface Props {
  children: React.ReactNode;
  user: { name: string; role: string; avatarColor: string; photoUrl?: string | null };
}

/** Inline avatar — uses uploaded photo if present, falls back to colored initials. */
function Avatar({ user, initials, size }: { user: Props["user"]; initials: string; size: string }) {
  if (user.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={user.photoUrl} alt={user.name} className={`${size} rounded-full object-cover`} />;
  }
  return <div className={`avatar ${user.avatarColor} ${size}`}>{initials}</div>;
}

export default function MobileShell({ children, user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const initials = user.name.split(" ").map((s) => s[0]).slice(0, 2).join("");

  // Root pages = the 5 bottom-nav destinations + profile. On these, the
  // hamburger menu is the primary nav so no back button needed. On any
  // OTHER page (lead detail, project detail, reports/daily, /intake, /team,
  // admin pages, etc.) show a back button so the user can return.
  // Lalit: "All pages should have back buttons".
  const rootPaths = new Set(["/dashboard", "/action-list", "/leads", "/pipeline", "/notifications", "/profile"]);
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
      <aside className="sidebar fixed left-0 top-0 bottom-0 w-64 hidden lg:flex flex-col text-white z-30">
        <div className="px-5 py-5 border-b border-white/10 flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/wcr-logo.png" alt="White Collar Realty" className="h-12 w-auto object-contain" />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {fullNav.filter((g) => !g.adminOnly || user.role === "ADMIN").map((group) => (
            <div key={group.section}>
              <div className="text-[10px] uppercase tracking-widest text-white/40 px-3 mb-1 mt-3 first:mt-0">{group.section}</div>
              {group.items.map(({ href, label, Icon, tag }) => {
                const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
                return (
                  <Link key={href} href={href} className={`nav-item ${active ? "active" : ""}`}>
                    <Icon className="w-[18px] h-[18px] flex-none" strokeWidth={2} />
                    <span>{label}</span>
                    {tag && <span className="ml-auto text-[10px] bg-[#c9a24b] text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{tag}</span>}
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
              <div className="text-white/60 truncate">{user.role === "ADMIN" ? "Administrator" : user.role === "MANAGER" ? "Manager" : "Sales Agent"}</div>
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

      {/* ─────────────────── MOBILE HEADER (lg- only) ─────────────────── */}
      {/* pt-[safe-area] keeps the bar below the iPhone status notch in PWA mode. */}
      <header
        className="lg:hidden sticky top-0 z-20 bg-[#0b1a33] text-white flex items-center px-3 py-2 gap-2 shadow"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
      >
        <button onClick={() => setOpen(true)} aria-label="Open menu" className="p-2 rounded hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center">
          <Menu className="w-6 h-6" />
        </button>
        {/* Global mobile back button — shows on every non-root page so the
            agent can always return to the previous screen. Uses router.back()
            with a parent-route fallback when history is empty. */}
        {showBack && (
          <button
            onClick={goBack}
            aria-label="Back"
            className="p-2 rounded hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center -ml-1"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/wcr-logo.png" alt="WCR" className="h-7 w-auto object-contain" />
        <div className="flex-1" />
        <WhatsAppPanel />
        <ThemeToggle />
        <NotifBell />
        <Link href="/leads/new" aria-label="New lead" className="p-2 rounded hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center">
          <span className="text-xl font-bold leading-none">+</span>
        </Link>
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
              {fullNav.map((group) => (
                <div key={group.section}>
                  <div className="text-[10px] uppercase tracking-widest text-white/40 px-3 mb-1 mt-3 first:mt-0">{group.section}</div>
                  {group.items.map(({ href, label, Icon, tag }) => {
                    const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
                    return (
                      <Link key={href} href={href} onClick={() => setOpen(false)} className={`nav-item ${active ? "active" : ""}`}>
                        <Icon className="w-[18px] h-[18px] flex-none" />
                        <span>{label}</span>
                        {tag && <span className="ml-auto text-[10px] bg-[#c9a24b] text-[#0b1a33] px-2 py-0.5 rounded-full font-bold">{tag}</span>}
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
        className="lg:ml-64 min-h-screen lg:pb-0"
        style={{ paddingBottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        {/* Desktop topbar (search bar) */}
        <header className="hidden lg:flex bg-white border-b border-[#e5e7eb] px-6 py-3 items-center gap-4 sticky top-0 z-10">
          <div className="relative flex-1 max-w-xl">
            <input
              className="w-full pl-4 pr-4 py-2 rounded-lg bg-[#f5f6fa] border border-transparent focus:bg-white focus:border-[#e5e7eb] outline-none text-sm"
              placeholder="Search leads, properties, phone, email…"
            />
          </div>
          <Link href="/leads/new" className="btn btn-ghost">+ New Lead</Link>
          <Link href="/ai" className="btn btn-gold"><Sparkles className="w-[18px] h-[18px]" /> Ask AI</Link>
          <WhatsAppPanel />
          <ThemeToggle />
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
        className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-[#e5e7eb] flex z-30 shadow-[0_-2px_8px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {bottomNav.map(({ href, label, Icon }) => {
          const active = pathname === href || (href !== "/dashboard" && pathname?.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex-1 flex flex-col items-center justify-center py-2 min-h-12 text-[10px] font-semibold ${active ? "text-[#c9a24b]" : "text-gray-500"}`}
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
      {/* Global `?` keyboard-shortcuts cheatsheet — also handles the `g X`
          2-key navigation sequences. */}
      <KeyboardShortcutsHelp />
      {/* Gamification XP toasts — mounted once at the shell so any client
          component (Log Call, status update, etc.) can call showXpToast(). */}
      <XPToastHost />
      {/* Deal celebrations — premium milestone animations (booking_done is
          the big one). Mounted alongside XPToastHost so any client component
          can fire showCelebration() from anywhere. */}
      <DealCelebrationHost />
      {/* First-run 4-step onboarding tour. Checks a localStorage flag so it
          only ever shows once per device; can be re-triggered from
          /settings → "Restart onboarding tour". */}
      <OnboardingTour />
      {/* One-time mobile nudge to install the CRM as a PWA. Hidden on
          desktop, on iOS (no beforeinstallprompt), already-installed, and
          for 30 days after dismissal. */}
      <PWAInstallNudge />
    </div>
  );
}
