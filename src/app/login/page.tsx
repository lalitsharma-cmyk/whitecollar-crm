export const metadata = { title: "Sign in · White Collar CRM" };

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; from?: string }> }) {
  const sp = (await searchParams) ?? {};
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b1a33] via-[#0f2347] to-[#0b1a33] p-6">
      <div className="card w-full max-w-md p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {/* h-24 (was h-16) so the brand reads confidently on the login screen.
              filter:invert(1) flips the white source mark to dark for the white card. */}
          <img src="/brand/wcr-logo.png" alt="White Collar Realty" className="h-24 w-auto object-contain" style={{ filter: "invert(1)" }} />
          <div className="text-[11px] tracking-[0.3em] text-gray-400 mt-3">CRM · SIGN IN</div>
        </div>
        {sp.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-2">{sp.error}</div>}
        <form action="/api/login" method="post" className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600">Email</label>
            <input name="email" type="email" required placeholder="you@whitecollarrealty.com"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#c9a24b]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Password</label>
            <input name="password" type="password" required placeholder="Your password"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#c9a24b]" />
          </div>
          <button className="btn btn-primary w-full justify-center mt-2">Sign in</button>
        </form>
        <div className="mt-5 text-[11px] text-gray-500 text-center">
          Forgot password? Ask your admin to reset it.
        </div>
      </div>
    </div>
  );
}
