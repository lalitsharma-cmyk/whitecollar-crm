// Per-user ICS calendar feed.
//
// Lets each agent subscribe to their own follow-ups + scheduled activities
// from Google Calendar / Apple Calendar / Outlook. No OAuth — auth is via a
// short HMAC token (userId.signature) generated server-side and shown on
// the Settings page. The token NEVER leaves the server in plaintext until
// the user copies it from settings; agents are told to treat the URL like
// a secret.
//
// Calendar clients poll this endpoint every ~15–60 min on their own, so we
// also set a 5-minute Cache-Control to keep DB load minimal.

import { type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const BASE_URL =
  process.env.NEXTAUTH_URL ?? "https://crm.whitecollarrealty.com";

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

function hmacFor(userId: string): string {
  return createHmac("sha256", secret()).update(userId).digest("hex");
}

function verifyToken(token: string | null): string | null {
  if (!token) return null;
  const idx = token.indexOf(".");
  if (idx <= 0 || idx === token.length - 1) return null;
  const userId = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = hmacFor(userId);
  // Constant-time compare. Both strings must be the same byte length.
  if (sig.length !== expected.length) return null;
  try {
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || a.length === 0) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  return userId;
}

// RFC 5545 §3.3.11 — escape \, ;, , and newline in TEXT values.
function escapeText(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// RFC 5545 §3.1 — long lines SHOULD be folded at 75 octets with CRLF + space.
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  // First chunk = 75 chars, subsequent chunks = 74 (the leading space counts).
  out.push(line.slice(i, i + 75));
  i += 75;
  while (i < line.length) {
    out.push(" " + line.slice(i, i + 74));
    i += 74;
  }
  return out.join("\r\n");
}

function fmtIcsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ in UTC
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  url: string;
};

function renderEvent(stamp: Date, ev: IcsEvent): string {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${ev.uid}`,
    `DTSTAMP:${fmtIcsDate(stamp)}`,
    `DTSTART:${fmtIcsDate(ev.start)}`,
    `DTEND:${fmtIcsDate(ev.end)}`,
    `SUMMARY:${escapeText(ev.summary)}`,
    `DESCRIPTION:${escapeText(ev.description)}`,
    `URL:${ev.url}`,
    "END:VEVENT",
  ];
  return lines.map(foldLine).join("\r\n");
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const userId = verifyToken(token);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.active) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  const [activities, leads] = await Promise.all([
    prisma.activity.findMany({
      where: {
        userId: user.id,
        scheduledAt: { not: null, gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        leadId: true,
        type: true,
        title: true,
        description: true,
        scheduledAt: true,
        lead: { select: { name: true } },
      },
    }),
    prisma.lead.findMany({
      where: {
        ownerId: user.id,
        followupDate: { not: null, gte: windowStart, lt: windowEnd },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        followupDate: true,
        todoNext: true,
        currentStatus: true,
      },
    }),
  ]);

  const stamp = new Date();
  const events: string[] = [];

  for (const a of activities) {
    if (!a.scheduledAt) continue;
    const start = a.scheduledAt;
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const leadUrl = `${BASE_URL}/leads/${a.leadId}`;
    const leadName = a.lead?.name ?? "Lead";
    const summary = `${a.title} — ${leadName}`;
    const desc = [a.description ?? "", `Type: ${a.type}`, leadUrl]
      .filter(Boolean)
      .join("\n");
    events.push(
      renderEvent(stamp, {
        uid: `wcr-activity-${a.id}@whitecollarrealty.com`,
        start,
        end,
        summary,
        description: desc,
        url: leadUrl,
      }),
    );
  }

  for (const l of leads) {
    if (!l.followupDate) continue;
    const start = l.followupDate;
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const leadUrl = `${BASE_URL}/leads/${l.id}`;
    const summary = `Follow-up: ${l.name}`;
    const descParts = [
      l.todoNext ? `To do: ${l.todoNext}` : "",
      l.currentStatus ? `Status: ${l.currentStatus}` : "",
      l.phone ? `Phone: ${l.phone}` : "",
      leadUrl,
    ].filter(Boolean);
    events.push(
      renderEvent(stamp, {
        uid: `wcr-lead-${l.id}@whitecollarrealty.com`,
        start,
        end,
        summary,
        description: descParts.join("\n"),
        url: leadUrl,
      }),
    );
  }

  const body =
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//WCR//CRM//EN",
      "METHOD:PUBLISH",
      "CALSCALE:GREGORIAN",
      foldLine(`X-WR-CALNAME:WCR CRM — ${escapeText(user.name)}`),
      "X-WR-TIMEZONE:Asia/Kolkata",
      ...events,
      "END:VCALENDAR",
    ].join("\r\n") + "\r\n";

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="wcr-calendar.ics"`,
    },
  });
}
