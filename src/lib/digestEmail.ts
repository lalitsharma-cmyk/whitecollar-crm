// Weekly Sunday-night leaderboard digest — HTML body builder.
//
// Kept separate from the cron route so it can be unit-tested without
// pulling in Next.js request context. All styling is inline (Gmail / Outlook
// strip <style> blocks) and capped at ~600px wide so it reads cleanly on
// mobile mail clients.

export interface DigestRow {
  /** Display name of the agent. */
  name: string;
  /** Numeric metric (count, percent, currency etc.). */
  value: number;
  /** Pre-formatted display string overriding the number (e.g. "₹1.2 Cr"). */
  display?: string;
}

export interface DigestBoard {
  emoji: string;
  title: string;
  /** Suffix on each row when no `display` override is set (e.g. "calls"). */
  unit?: string;
  rows: DigestRow[];
}

export interface DigestTeamTotals {
  leadsCreated: number;
  callsMade: number;
  meetingsBooked: number;
  bookingsDone: number;
  /** Sum of mid-range budgets across open AED-denominated leads. */
  pipelineAed: number;
  /** Sum of mid-range budgets across open INR-denominated leads. */
  pipelineInr: number;
}

export interface DigestStats {
  /** End-of-window date used in the subject + header (Sunday). */
  weekEnding: Date;
  totals: DigestTeamTotals;
  boards: DigestBoard[];
  /** Optional first name of the recipient — used to personalise the salutation. */
  recipientName?: string;
}

// ── HTML safety helpers (no DOM in this runtime — write our own) ─────
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function fmtDate(d: Date): string {
  // "27 May 2026" — locale-agnostic so it reads the same for Dubai + India.
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNumber(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** Compact AED / INR formatting — keeps the digest readable for big numbers. */
function fmtCurrency(amount: number, currency: "AED" | "INR"): string {
  if (!amount) return `${currency} 0`;
  if (currency === "INR") {
    if (amount >= 1_00_00_000) return `₹${(amount / 1_00_00_000).toFixed(2)} Cr`;
    if (amount >= 1_00_000) return `₹${(amount / 1_00_000).toFixed(2)} L`;
    return `₹${fmtNumber(amount)}`;
  }
  // AED — use M / K thresholds (Gulf convention).
  if (amount >= 1_000_000) return `AED ${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `AED ${(amount / 1_000).toFixed(1)}K`;
  return `AED ${fmtNumber(amount)}`;
}

function rankBadge(rank: number): string {
  // Inline-styled badge — email clients strip class names, so each style is repeated.
  const base =
    "display:inline-block;width:22px;height:22px;line-height:22px;border-radius:50%;text-align:center;font-size:11px;font-weight:700;margin-right:8px;vertical-align:middle;";
  if (rank === 1) return `<span style="${base}background:#fbbf24;color:#78350f">1</span>`;
  if (rank === 2) return `<span style="${base}background:#cbd5e1;color:#1e293b">2</span>`;
  if (rank === 3) return `<span style="${base}background:#d97706;color:#fff7ed">3</span>`;
  return `<span style="${base}background:#f1f5f9;color:#475569">${rank}</span>`;
}

function renderBoard(board: DigestBoard): string {
  const heading = `
    <tr><td style="padding:16px 20px 8px;border-top:1px solid #e2e8f0">
      <div style="font-size:14px;font-weight:700;color:#0b1a33">
        <span style="margin-right:6px">${escapeHtml(board.emoji)}</span>${escapeHtml(board.title)}
      </div>
    </td></tr>`;

  if (board.rows.length === 0) {
    return (
      heading +
      `<tr><td style="padding:4px 20px 16px;color:#94a3b8;font-size:13px;font-style:italic">No data this week.</td></tr>`
    );
  }

  const rows = board.rows
    .map((r, i) => {
      const right = r.display
        ? escapeHtml(r.display)
        : `${fmtNumber(r.value)}${board.unit ? ` <span style="color:#94a3b8;font-weight:400">${escapeHtml(board.unit)}</span>` : ""}`;
      return `
        <tr><td style="padding:6px 20px;font-size:13px;color:#1e293b">
          <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
            <tr>
              <td style="padding:0">${rankBadge(i + 1)}<span style="vertical-align:middle">${escapeHtml(r.name)}</span></td>
              <td style="padding:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums">${right}</td>
            </tr>
          </table>
        </td></tr>`;
    })
    .join("");

  return (
    heading +
    rows +
    `<tr><td style="padding:0 20px 12px"></td></tr>`
  );
}

function renderTotals(totals: DigestTeamTotals): string {
  const tile = (label: string, value: string) => `
    <td align="center" style="padding:12px 8px;background:#f8fafc;border-radius:8px;width:33%">
      <div style="font-size:18px;font-weight:700;color:#0b1a33;font-variant-numeric:tabular-nums">${escapeHtml(value)}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;margin-top:2px">${escapeHtml(label)}</div>
    </td>`;
  const gap = `<td style="width:8px"></td>`;
  return `
    <tr><td style="padding:16px 20px 8px">
      <table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate">
        <tr>
          ${tile("Leads", fmtNumber(totals.leadsCreated))}
          ${gap}
          ${tile("Calls", fmtNumber(totals.callsMade))}
          ${gap}
          ${tile("Meetings", fmtNumber(totals.meetingsBooked))}
        </tr>
        <tr><td style="height:8px" colspan="5"></td></tr>
        <tr>
          ${tile("Bookings", fmtNumber(totals.bookingsDone))}
          ${gap}
          ${tile("Pipeline AED", fmtCurrency(totals.pipelineAed, "AED"))}
          ${gap}
          ${tile("Pipeline INR", fmtCurrency(totals.pipelineInr, "INR"))}
        </tr>
      </table>
    </td></tr>`;
}

export function buildWeeklyDigestHtml(stats: DigestStats): string {
  const dateLabel = fmtDate(stats.weekEnding);
  const greeting = stats.recipientName
    ? `Hi ${escapeHtml(stats.recipientName.split(" ")[0])},`
    : "Hi team,";

  const boardsHtml = stats.boards.map(renderBoard).join("");

  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
  <table width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px">
    <tr><td align="center">
      <table cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08)">
        <tr><td style="background:linear-gradient(135deg,#0b1a33,#152d57);padding:20px 24px">
          <div style="color:#c9a24b;font-size:11px;letter-spacing:.16em;font-weight:700">WHITE COLLAR REALTY · CRM</div>
          <div style="color:#ffffff;font-size:20px;font-weight:700;margin-top:6px">📊 Weekly leaderboard</div>
          <div style="color:#cbd5e1;font-size:13px;margin-top:2px">Week ending ${escapeHtml(dateLabel)}</div>
        </td></tr>

        <tr><td style="padding:18px 20px 4px;font-size:14px;color:#334155">
          ${greeting}<br/>
          Here's how the team did over the past 7 days.
        </td></tr>

        ${renderTotals(stats.totals)}

        ${boardsHtml}

        <tr><td style="padding:14px 20px 18px">
          <a href="https://crm.whitecollarrealty.com/leaderboards"
             style="display:inline-block;background:#0b1a33;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:13px">
            View live leaderboards →
          </a>
        </td></tr>

        <tr><td style="padding:14px 20px;background:#f8fafc;color:#64748b;font-size:11px;line-height:1.5">
          Sent automatically every Sunday evening. Reply to this email to share feedback —
          we read everything.
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}
