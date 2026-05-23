// FREE email via Resend (100/day, 3000/month forever).
// If RESEND_API_KEY isn't set, sends silently no-op so the rest of the app works.

interface EmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export function emailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

export async function sendEmail(input: EmailInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? "WCR CRM <noreply@crm.whitecollarrealty.com>";
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not configured (skipping)" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text ?? input.subject,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (json as { message?: string }).message ?? `HTTP ${res.status}` };
    return { ok: true, id: (json as { id?: string }).id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Branded email template — navy + gold
export function emailTemplate(opts: { title: string; body: string; ctaLabel?: string; ctaUrl?: string; footer?: string }): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f5f6fa;padding:24px;margin:0">
  <table width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
    <tr><td style="background:linear-gradient(135deg,#0b1a33,#152d57);padding:20px 24px">
      <div style="color:#c9a24b;font-size:11px;letter-spacing:.16em;font-weight:700">WHITE COLLAR REALTY · CRM</div>
    </td></tr>
    <tr><td style="padding:24px">
      <h2 style="margin:0 0 12px;color:#0b1a33;font-size:18px">${escapeHtml(opts.title)}</h2>
      <div style="color:#374151;font-size:14px;line-height:1.55;white-space:pre-wrap">${escapeHtml(opts.body)}</div>
      ${opts.ctaUrl && opts.ctaLabel ? `<a href="${escapeAttr(opts.ctaUrl)}" style="display:inline-block;margin-top:16px;background:#0b1a33;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(opts.ctaLabel)}</a>` : ""}
    </td></tr>
    <tr><td style="padding:16px 24px;background:#f5f6fa;color:#6b7280;font-size:11px">
      ${escapeHtml(opts.footer ?? "You're receiving this because you have a White Collar Realty CRM account.")}
    </td></tr>
  </table></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function escapeAttr(s: string): string { return escapeHtml(s); }
