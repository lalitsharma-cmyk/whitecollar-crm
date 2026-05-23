"use client";
import { useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

export default function AIChat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", content: "Hi! I can see your full CRM. Ask me about hot leads, agent performance, or pipeline trends." },
  ]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = q.trim();
    if (!text || busy) return;
    setQ("");
    setMsgs((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      const json = await res.json();
      setMsgs((m) => [...m, { role: "assistant", content: json.answer ?? json.error ?? "(no response)" }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", content: "Network error. Try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : ""}`}>
            <div
              className="px-3 py-2 rounded-2xl max-w-[85%] text-sm whitespace-pre-wrap"
              style={m.role === "user"
                ? { background: "#0b1a33", color: "#fff", borderBottomRightRadius: 4 }
                : { background: "#fff", border: "1px solid #e5e7eb", borderBottomLeftRadius: 4 }}
            >
              {m.content}
            </div>
          </div>
        ))}
        {busy && <div className="text-xs text-gray-500">Thinking…</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(); }}
          placeholder="Ask anything about your pipeline…"
          className="flex-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
        />
        <button onClick={send} disabled={busy || !q.trim()} className="btn btn-gold">Send</button>
      </div>
    </>
  );
}
