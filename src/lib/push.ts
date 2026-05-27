import webpush from "web-push";
import { prisma } from "@/lib/prisma";

// FREE web push using browser-native APIs (Apple/Google push servers).
// VAPID keys generated once with `npx web-push generate-vapid-keys`.

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? "mailto:lalit@whitecollarrealty.com";
  if (!pub || !priv) return; // not configured yet — push silently no-ops
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export function pushEnabled(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;        // dedupes notifications for the same lead
  severity?: "INFO" | "WARNING" | "CRITICAL";
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  if (!pushEnabled()) return { sent: 0, dead: 0 };
  configure();
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return { sent: 0, dead: 0 };

  const body = JSON.stringify(payload);
  let sent = 0, dead = 0;
  const deadIds: string[] = [];
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.authKey } }, body);
      sent++;
    } catch (e) {
      const err = e as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        deadIds.push(s.id);
        dead++;
      }
    }
  }
  if (deadIds.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: deadIds } } });
  return { sent, dead };
}

// ── Hot-lead push helper ─────────────────────────────────────────────────────
// Spec §12.3 "Hot Lead Alert" — in-app sound + pulse already wired; this
// fires a Web Push so the agent gets notified when they're NOT looking at the
// screen. Fire-and-forget at call sites.
//
// De-dupe: hot-lead notifications should fire AT MOST once per lead per 24h
// across the process lifetime. We keep a tiny in-memory set keyed by leadId,
// reset whenever the calendar date (UTC) rolls over. This is a per-instance
// guard — good enough for a single Vercel function; a stronger guarantee
// would persist a hotPushedOn column on Lead, but that's a future refactor.
const hotFiredToday = new Set<string>();
let hotFiredDateKey = "";

function todayKey(): string {
  // YYYY-MM-DD in UTC. Good enough — agents in IST will see the boundary at
  // 5:30am local, which is before their first call window.
  return new Date().toISOString().slice(0, 10);
}

function alreadyFiredHotToday(leadId: string): boolean {
  const key = todayKey();
  if (key !== hotFiredDateKey) {
    hotFiredDateKey = key;
    hotFiredToday.clear();
  }
  if (hotFiredToday.has(leadId)) return true;
  hotFiredToday.add(leadId);
  return false;
}

interface HotLeadInput {
  id: string;
  name: string;
  ownerId: string | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetCurrency?: string | null;
}

function formatBudget(lead: HotLeadInput): string {
  const ccy = lead.budgetCurrency ?? "AED";
  const min = lead.budgetMin;
  const max = lead.budgetMax;
  if (!min && !max) return "budget TBD";
  const fmt = (n: number) => {
    if (ccy === "INR") {
      if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)} Cr`;
      if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
      return `₹${Math.round(n).toLocaleString("en-IN")}`;
    }
    if (n >= 1e6) return `${ccy} ${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${ccy} ${(n / 1e3).toFixed(0)}K`;
    return `${ccy} ${Math.round(n)}`;
  };
  if (min && max && min !== max) return `${fmt(min)}–${fmt(max)}`;
  return fmt(min ?? max ?? 0);
}

/**
 * Fire a hot-lead Web Push to the lead's owner. No-ops cleanly when:
 *   • the lead has no owner
 *   • push isn't configured (no VAPID keys)
 *   • we already fired for this lead today
 * Safe to call fire-and-forget; never throws.
 */
export async function notifyHotLead(lead: HotLeadInput): Promise<{ sent: number; dead: number } | null> {
  if (!lead.ownerId) return null;
  if (alreadyFiredHotToday(lead.id)) return null;
  try {
    return await sendPushToUser(lead.ownerId, {
      title: "🔥 Hot lead arrived",
      body: `${lead.name} · ${formatBudget(lead)}`,
      url: `/leads/${lead.id}`,
      tag: `hot-lead-${lead.id}`,
      severity: "CRITICAL",
    });
  } catch {
    return null;
  }
}
