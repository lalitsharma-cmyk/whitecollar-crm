export const metadata = { title: "Sign in · White Collar CRM" };

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ error?: string; from?: string }> }) {
  const sp = (await searchParams) ?? {};
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0b1a33] via-[#0f2347] to-[#0b1a33] p-6">
      <div className="card w-full max-w-md p-8 shadow-2xl">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-lg bg-[#c9a24b] flex items-center justify-center font-extrabold text-[#0b1a33]">W</div>
          <div>
            <div className="font-bold leading-tight text-[#0b1a33]">White Collar Realty</div>
            <div className="text-[11px] tracking-widest text-gray-500">CRM · SIGN IN</div>
          </div>
        </div>
        {sp.error && <div className="mb-3 text-sm bg-red-50 border border-red-200 text-red-800 rounded-lg p-2">{sp.error}</div>}
        <form action="/api/login" method="post" className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-gray-600">Email</label>
            <input name="email" type="email" required defaultValue="lalit@whitecollarrealty.com"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#c9a24b]" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Password</label>
            <input name="password" type="password" required defaultValue="demo1234"
              className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#c9a24b]" />
          </div>
          <button className="btn btn-primary w-full justify-center mt-2">Sign in</button>
        </form>
        <div className="mt-5 text-xs text-gray-500 space-y-1">
          <div className="font-semibold text-gray-700">Demo accounts (password: <code>demo1234</code>):</div>
          <div>• <b>lalit@whitecollarrealty.com</b> — Admin</div>
          <div>• <b>neha@whitecollarrealty.com</b> — Manager</div>
          <div>• <b>rahul@whitecollarrealty.com</b> — Agent</div>
        </div>
      </div>
    </div>
  );
}
