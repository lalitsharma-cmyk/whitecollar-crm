export const metadata = { title: "Sign in · White Collar Realty" };

/**
 * Login page — intentionally SELF-CONTAINED.
 *
 * The critical layout (centering, card, and especially the logo size cap) is set
 * with INLINE styles + a co-located <style> block, NOT Tailwind utility classes.
 * Why: a login screen must render correctly even if the external Tailwind CSS
 * chunk is slow, cached-stale, or blocked. Previously the logo relied on the
 * `h-32` utility; with no inline fallback, a missing stylesheet let the image
 * render at its natural ~1280px size and shoved the form off-screen. Inline
 * styles can't be dropped by the cascade, so the page can no longer collapse.
 */
export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; from?: string }> }) {
  const sp = (await searchParams) ?? {};

  const label: React.CSSProperties = {
    fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: "rgba(11,26,51,0.7)",
  };
  const input: React.CSSProperties = {
    width: "100%", marginTop: "6px", borderRadius: "9px", border: "1px solid #e3ddcf",
    background: "#ffffff", padding: "11px 14px", fontSize: "14px", color: "#0b1a33", outline: "none",
  };

  return (
    <main
      className="wcr-login"
      style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px", boxSizing: "border-box",
        background: "radial-gradient(1100px 580px at 50% -10%, #16315b 0%, #0b1a33 42%, #070f1f 100%)",
      }}
    >
      {/* Co-located styles for :focus / ::placeholder (can't be done inline). If
          this fails to load the inputs still render correctly from inline styles. */}
      <style>{`
        .wcr-login input:focus { border-color:#c9a24b !important; box-shadow:0 0 0 3px rgba(201,162,75,0.25); }
        .wcr-login input::placeholder { color:#9ca3af; }
        .wcr-login .wcr-signin:hover { background:linear-gradient(180deg,#0f2347,#15294f) !important; }
      `}</style>

      <div style={{ width: "100%", maxWidth: "420px" }}>
        {/* gold top-accent bar */}
        <div style={{ height: "4px", borderRadius: "16px 16px 0 0", background: "linear-gradient(90deg,#c9a24b,#e7c97a,#c9a24b)" }} />

        {/* card */}
        <div
          style={{
            background: "rgba(255,253,247,0.97)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            borderRadius: "0 0 16px 16px",
            padding: "30px 26px",
            boxShadow: "0 30px 80px -25px rgba(0,0,0,0.75)",
          }}
        >
          {/* Logo — HARD-CAPPED inline so it can never overflow the card */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/wcr-logo.png"
            alt="White Collar Realty"
            style={{ display: "block", height: "auto", maxHeight: "84px", maxWidth: "74%", margin: "0 auto", objectFit: "contain" }}
          />

          <div style={{ textAlign: "center", marginTop: "8px" }}>
            <div style={{ fontFamily: "var(--font-serif), Georgia, serif", fontSize: "19px", fontWeight: 700, color: "#0b1a33", letterSpacing: "-0.01em" }}>
              White Collar Realty
            </div>
            <div style={{ fontSize: "10px", letterSpacing: "0.32em", textTransform: "uppercase", color: "#9a7b2e", marginTop: "4px" }}>
              Client Management System
            </div>
          </div>

          {sp.error && (
            <div style={{ marginTop: "18px", fontSize: "13px", background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: "9px", padding: "9px 11px", textAlign: "center" }}>
              {sp.error}
            </div>
          )}

          <form action="/api/login" method="post" style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "14px" }}>
            <div>
              <div style={label}>Email</div>
              <input name="email" type="email" required autoComplete="email" placeholder="you@whitecollarrealty.com" style={input} />
            </div>
            <div>
              <div style={label}>Password</div>
              <input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" style={input} />
            </div>
            <button
              type="submit"
              className="wcr-signin"
              style={{
                marginTop: "4px", width: "100%",
                display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px",
                borderRadius: "9px", background: "linear-gradient(180deg,#0b1a33,#0f2347)", color: "#ffffff",
                fontWeight: 600, fontSize: "14px", padding: "12px 16px",
                border: "1px solid rgba(201,162,75,0.3)", cursor: "pointer",
              }}
            >
              Sign in <span style={{ color: "#e7c97a" }}>→</span>
            </button>
          </form>

          <div style={{ textAlign: "center", marginTop: "18px", fontSize: "11px", color: "#9ca3af" }}>
            Forgot password? Ask your admin to reset it.
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: "18px", fontSize: "10px", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)" }}>
          Premium Real Estate Advisory · India &amp; UAE
        </div>
      </div>
    </main>
  );
}
