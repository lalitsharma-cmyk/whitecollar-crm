"use client";
import { Search, Bell, Plus, Sparkles } from "lucide-react";
import Link from "next/link";

export default function Topbar({ user }: { user: { name: string; avatarColor: string } }) {
  const initials = user.name.split(" ").map(s => s[0]).slice(0, 2).join("");
  return (
    <header className="bg-white border-b border-[#e5e7eb] px-6 py-3 flex items-center gap-4 sticky top-0 z-10">
      <div className="relative flex-1 max-w-xl">
        <Search className="w-[18px] h-[18px] absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#f5f6fa] border border-transparent focus:bg-white focus:border-[#e5e7eb] outline-none text-sm"
          placeholder="Search leads, properties, phone, email…"
        />
      </div>
      <Link href="/leads/new" className="btn btn-ghost"><Plus className="w-[18px] h-[18px]" /> New Lead</Link>
      <Link href="/ai" className="btn btn-gold"><Sparkles className="w-[18px] h-[18px]" /> Ask AI</Link>
      <div className="relative">
        <Bell className="w-[20px] h-[20px] text-gray-500" />
        <span className="absolute -top-1 -right-2 bg-[#ef4444] text-white text-[10px] font-bold rounded-full px-1.5">7</span>
      </div>
      <div className={`avatar ${user.avatarColor}`}>{initials}</div>
    </header>
  );
}
