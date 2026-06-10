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
            background: "#ffffff",
            borderRadius: "0 0 16px 16px",
            padding: "30px 26px 32px",
            boxShadow: "0 30px 80px -25px rgba(0,0,0,0.75)",
          }}
        >
          {/* Logo — larger (impact) and HARD-CAPPED inline so it can never overflow.
              Sits on a soft light halo so its white collar/shirt + "WHITE" text keep
              contrast and don't blend into the white card. The logo already carries
              "White Collar Realty", so the company name is NOT repeated below it. */}
          <div
            style={{
              display: "flex", justifyContent: "center", alignItems: "center",
              padding: "8px 0 4px", borderRadius: "14px",
              background: "radial-gradient(130% 135% at 50% 46%, #e9edf3 0%, rgba(233,237,243,0) 70%)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/wcr-logo.png"
              alt="White Collar Realty"
              style={{ display: "block", height: "auto", maxHeight: "112px", maxWidth: "86%", objectFit: "contain" }}
            />
          </div>

          <div style={{ textAlign: "center", marginTop: "10px" }}>
            <div style={{ fontSize: "10px", letterSpacing: "0.34em", textTransform: "uppercase", color: "#9a7b2e" }}>
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
              <input name="email" type="email" required autoComplete="email" placeholder="Enter your email" style={input} />
            </div>
            <div>
              <div style={label}>Password</div>
              <input name="password" type="password" required autoComplete="current-password" placeholder="Enter your password" style={input} />
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
