export const metadata = { title: "Sign in · White Collar Realty" };

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; from?: string }> }) {
  const sp = (await searchParams) ?? {};
  return (
    <main className="login-screen relative min-h-screen flex items-center justify-center overflow-hidden px-5 py-10">
      {/* ── Luxury layered backdrop — deep navy with a soft champagne glow ── */}
      <div
        aria-hidden
        className="absolute inset-0 -z-20"
        style={{ background: "radial-gradient(1200px 620px at 50% -8%, #16315b 0%, #0b1a33 40%, #060d1c 100%)" }}
      />
      {/* gold hairline along the very top edge */}
      <div aria-hidden className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-[#c9a24b]/70 to-transparent" />
      {/* champagne glow behind the card */}
      <div
        aria-hidden
        className="absolute left-1/2 top-[-90px] -z-10 h-[340px] w-[560px] -translate-x-1/2 rounded-full opacity-25 blur-[100px]"
        style={{ background: "radial-gradient(circle, #c9a24b 0%, transparent 70%)" }}
      />

      <div className="w-full max-w-md">
        {/* gold top-accent bar */}
        <div className="h-1 rounded-t-2xl bg-gradient-to-r from-[#c9a24b] via-[#e7c97a] to-[#c9a24b]" />

        <div className="rounded-b-2xl bg-[#fffdf7] ring-1 ring-black/5 px-8 py-9 sm:px-10 sm:py-10 shadow-[0_30px_90px_-25px_rgba(0,0,0,0.75)]">
          {/* Logo — real brand mark, on light, NEVER inverted, ~2× the old size */}
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/wcr-logo.png"
              alt="White Collar Realty"
              className="h-32 sm:h-40 w-auto object-contain select-none"
              draggable={false}
            />
            <div className="mt-4 flex items-center gap-3 w-full">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[#c9a24b]/50" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.34em] text-[#9a7b2e] whitespace-nowrap">Client Management</span>
              <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[#c9a24b]/50" />
            </div>
          </div>

          <div className="mt-7 text-center">
            <h1 className="font-display text-[22px] sm:text-2xl text-[#0b1a33]">Welcome back</h1>
            <p className="mt-1 text-xs text-gray-500">Sign in to your workspace</p>
          </div>

          {sp.error && (
            <div className="mt-6 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-2.5 text-center">{sp.error}</div>
          )}

          <form action="/api/login" method="post" className="mt-7 space-y-4">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#0b1a33]/70">Email</label>
              <input
                name="email" type="email" required autoComplete="email"
                placeholder="you@whitecollarrealty.com"
                className="w-full mt-1.5 rounded-lg border border-[#e3ddcf] bg-white px-3.5 py-2.5 text-sm text-[#0b1a33] placeholder:text-gray-400 focus:outline-none focus:border-[#c9a24b] focus:ring-2 focus:ring-[#c9a24b]/25 transition"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-[#0b1a33]/70">Password</label>
              <input
                name="password" type="password" required autoComplete="current-password"
                placeholder="••••••••"
                className="w-full mt-1.5 rounded-lg border border-[#e3ddcf] bg-white px-3.5 py-2.5 text-sm text-[#0b1a33] placeholder:text-gray-400 focus:outline-none focus:border-[#c9a24b] focus:ring-2 focus:ring-[#c9a24b]/25 transition"
              />
            </div>
            <button
              type="submit"
              className="group w-full mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-b from-[#0b1a33] to-[#0f2347] px-4 py-2.5 text-sm font-semibold text-white ring-1 ring-[#c9a24b]/30 hover:from-[#0f2347] hover:to-[#15294f] transition"
            >
              Sign in
              <span className="text-[#e7c97a] transition-transform group-hover:translate-x-0.5">→</span>
            </button>
          </form>

          <div className="mt-6 text-center text-[11px] text-gray-400">
            Forgot password? Ask your admin to reset it.
          </div>
        </div>

        {/* Brand footer line on the dark canvas */}
        <div className="mt-6 text-center text-[10px] uppercase tracking-[0.3em] text-white/35">
          Premium Real Estate Advisory · India &amp; UAE
        </div>
      </div>
    </main>
  );
}
