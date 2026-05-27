"use client";
// Vault — private reflection / journal / wins UI.
// Privacy: this component never sends a userId; the server forces it to the
// session user. All reads/writes go through /api/vault and /api/vault/[id].
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Wind, Trophy, MessageSquare, X, Trash2, Plus, Sparkles } from "lucide-react";
import { fmtIST12 } from "@/lib/datetime";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";

// ─── Types ───────────────────────────────────────────────────────────────
export type VaultEntryDTO = {
  id: string;
  kind: string;
  mood: string | null;
  content: string;
  tags: string | null;
  expiresAt: string | null;
  aiReflection: string | null;
  createdAt: string;
};

interface Props {
  initialEntries: VaultEntryDTO[];
}

// ─── Static config ───────────────────────────────────────────────────────
type MoodKey = "GREAT" | "OK" | "STRESSED" | "OVERWHELMED" | "ANGRY" | "SAD";

const MOODS: { key: MoodKey; emoji: string; label: string }[] = [
  { key: "GREAT",        emoji: "😊", label: "Great" },
  { key: "OK",           emoji: "🙂", label: "OK" },
  { key: "STRESSED",     emoji: "😟", label: "Stressed" },
  { key: "OVERWHELMED",  emoji: "🥵", label: "Overwhelmed" },
  { key: "ANGRY",        emoji: "😡", label: "Angry" },
  { key: "SAD",          emoji: "😢", label: "Sad" },
];

const MOOD_EMOJI: Record<string, string> = Object.fromEntries(MOODS.map((m) => [m.key, m.emoji]));

const MOTIVATION_LINES = [
  "Every 'no' brings you closer to the next 'yes'.",
  "The best closers were once rookies. Keep going.",
  "Your worth isn't measured by today's pipeline.",
  "Breathe. The next call is a fresh start.",
  "You've handled hard days before — you'll handle this one too.",
  "Slow is smooth. Smooth is fast. One call at a time.",
];

const KIND_LABEL: Record<string, string> = {
  JOURNAL:   "Journal",
  VENT:      "Vent",
  WIN:       "Win",
  LESSON:    "Lesson",
  GRATITUDE: "Gratitude",
};

const KIND_CHIP: Record<string, string> = {
  JOURNAL:   "bg-blue-100 text-blue-800",
  VENT:      "bg-rose-100 text-rose-800",
  WIN:       "bg-emerald-100 text-emerald-800",
  LESSON:    "bg-amber-100 text-amber-800",
  GRATITUDE: "bg-purple-100 text-purple-800",
};

// ─── Component ───────────────────────────────────────────────────────────
export default function VaultClient({ initialEntries }: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<VaultEntryDTO[]>(initialEntries);
  const [pendingMood, setPendingMood] = useState<MoodKey | null>(null);
  const [moodNote, setMoodNote] = useState("");
  const [showVent, setShowVent] = useState(false);
  const [ventText, setVentText] = useState("");
  const [ventAutoDelete, setVentAutoDelete] = useState(true);
  const [showAddWin, setShowAddWin] = useState(false);
  const [winText, setWinText] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  const wins = useMemo(() => entries.filter((e) => e.kind === "WIN"), [entries]);
  const recentWins = useMemo(() => wins.slice(0, 3), [wins]);

  async function postEntry(payload: {
    kind: string;
    mood?: string | null;
    content: string;
    expiresAt?: string | null;
  }): Promise<VaultEntryDTO | null> {
    setBusy(true);
    try {
      const r = await fetch("/api/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) return null;
      const created = await r.json();
      const dto: VaultEntryDTO = {
        id: created.id,
        kind: created.kind,
        mood: created.mood,
        content: created.content,
        tags: created.tags,
        expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
        aiReflection: created.aiReflection,
        createdAt: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
      };
      setEntries((prev) => [dto, ...prev].slice(0, 30));
      startTransition(() => router.refresh());
      return dto;
    } finally {
      setBusy(false);
    }
  }

  async function saveMood() {
    if (!pendingMood) return;
    const ok = await postEntry({
      kind: "JOURNAL",
      mood: pendingMood,
      content: moodNote.trim() || `Checked in feeling ${pendingMood.toLowerCase()}.`,
    });
    if (ok) {
      setPendingMood(null);
      setMoodNote("");
    }
  }

  async function saveVent() {
    const text = ventText.trim();
    if (!text) return;
    const expiresAt = ventAutoDelete
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : null;
    const ok = await postEntry({ kind: "VENT", content: text, expiresAt });
    if (ok) {
      setVentText("");
      setVentAutoDelete(true);
      setShowVent(false);
    }
  }

  async function saveWin() {
    const text = winText.trim();
    if (!text) return;
    const ok = await postEntry({ kind: "WIN", content: text });
    if (ok) {
      setWinText("");
      setShowAddWin(false);
    }
  }

  async function deleteEntry(id: string) {
    if (!confirm("Delete this entry? This cannot be undone.")) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/vault/${id}`, { method: "DELETE" });
      if (r.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ─── Header ─── */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-rose-400 to-purple-500 flex items-center justify-center flex-none">
          <Heart className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Your Vault</h1>
          <p className="text-sm text-gray-500">
            Private space — only you can see this. Journal, vent, log wins, reset when it gets heavy.
          </p>
        </div>
      </div>

      {/* ─── (a) Today's mood check-in ─── */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-sm">How are you feeling right now?</h2>
        </div>
        <div className="grid grid-cols-6 gap-2">
          {MOODS.map((m) => {
            const selected = pendingMood === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setPendingMood(selected ? null : m.key)}
                disabled={busy}
                className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition min-h-16 ${
                  selected ? "border-[#c9a24b] bg-amber-50" : "border-transparent hover:bg-gray-50"
                }`}
                title={m.label}
                aria-pressed={selected}
              >
                <span className="text-2xl leading-none">{m.emoji}</span>
                <span className="text-[10px] text-gray-700 leading-tight text-center">{m.label}</span>
              </button>
            );
          })}
        </div>
        {pendingMood && (
          <div className="mt-3 space-y-2">
            <textarea
              value={moodNote}
              onChange={(e) => setMoodNote(e.target.value)}
              rows={3}
              placeholder="Optional — what's behind that feeling? (Only you can read this.)"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setPendingMood(null); setMoodNote(""); }}
                disabled={busy}
                className="btn btn-ghost text-xs min-h-11"
              >
                Cancel
              </button>
              <button onClick={saveMood} disabled={busy} className="btn btn-primary text-xs min-h-11">
                {busy ? "Saving…" : "Save check-in"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ─── (b) + (d) action row: Quick Vent + Reset Mode ─── */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          onClick={() => setShowVent((v) => !v)}
          className="card p-4 text-left hover:border-rose-300 transition border-2 border-transparent min-h-24"
        >
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            <div className="font-semibold text-sm">Quick Vent</div>
          </div>
          <div className="text-xs text-gray-500">
            Let it out. Optionally auto-deletes in 24 hours.
          </div>
        </button>

        <button
          onClick={() => setShowReset(true)}
          className="card p-4 text-left hover:border-sky-300 transition border-2 border-transparent min-h-24 bg-gradient-to-br from-sky-50 to-indigo-50"
        >
          <div className="flex items-center gap-2 mb-1">
            <Wind className="w-5 h-5 text-sky-600" />
            <div className="font-semibold text-sm">Reset Mode</div>
          </div>
          <div className="text-xs text-gray-600">
            Breathe. Remember why you're doing this. 60 seconds.
          </div>
        </button>
      </section>

      {showVent && (
        <section className="card p-4 border-l-4 border-rose-400">
          <div className="font-semibold text-sm mb-2">Get it off your chest</div>
          <textarea
            value={ventText}
            onChange={(e) => setVentText(e.target.value)}
            rows={4}
            placeholder="Nobody else will see this. Say what you need to say."
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <label className="flex items-center gap-2 mt-2 text-xs text-gray-700">
            <input
              type="checkbox"
              checked={ventAutoDelete}
              onChange={(e) => setVentAutoDelete(e.target.checked)}
              className="rounded"
            />
            Auto-delete in 24h
          </label>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => { setShowVent(false); setVentText(""); }}
              disabled={busy}
              className="btn btn-ghost text-xs min-h-11"
            >
              Cancel
            </button>
            <button onClick={saveVent} disabled={busy || !ventText.trim()} className="btn btn-primary text-xs min-h-11">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </section>
      )}

      {/* ─── Body: Wins (left) + Recent (right) ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* (c) Wins */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-500" />
              <h2 className="font-semibold text-sm">Your Wins</h2>
            </div>
            <button
              onClick={() => setShowAddWin((v) => !v)}
              className="btn btn-ghost text-xs min-h-11"
            >
              <Plus className="w-3.5 h-3.5" /> Add a win
            </button>
          </div>

          {showAddWin && (
            <div className="mb-3 space-y-2">
              <textarea
                value={winText}
                onChange={(e) => setWinText(e.target.value)}
                rows={3}
                placeholder="Booked first villa client / Talked down an angry client / Cold lead came back warm"
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => { setShowAddWin(false); setWinText(""); }}
                  disabled={busy}
                  className="btn btn-ghost text-xs min-h-11"
                >
                  Cancel
                </button>
                <button onClick={saveWin} disabled={busy || !winText.trim()} className="btn btn-primary text-xs min-h-11">
                  {busy ? "Saving…" : "Save win"}
                </button>
              </div>
            </div>
          )}

          {wins.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              No wins logged yet. The next one starts the streak.
            </div>
          ) : (
            <ul className="space-y-2">
              {wins.map((w) => (
                <li
                  key={w.id}
                  className="rounded-lg border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm whitespace-pre-wrap"
                >
                  <div className="text-[11px] text-emerald-700 font-semibold mb-1">
                    {fmtIST12(w.createdAt)}
                  </div>
                  <div>{w.content}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* (e) Recent entries */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-[#c9a24b]" />
            <h2 className="font-semibold text-sm">Recent Entries</h2>
            <span className="ml-auto text-[11px] text-gray-500">Last {entries.length}</span>
          </div>
          {entries.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              Nothing yet. Start with a mood check-in above.
            </div>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {entries.map((e) => (
                <li key={e.id} className="rounded-lg border border-[#e5e7eb] bg-white/60 px-3 py-2">
                  <div className="flex items-center gap-2 mb-1">
                    {e.mood && <span className="text-base leading-none">{MOOD_EMOJI[e.mood] ?? "·"}</span>}
                    <span className={`chip ${KIND_CHIP[e.kind] ?? "bg-gray-100 text-gray-700"}`}>
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <span className="text-[11px] text-gray-500 ml-1">{fmtIST12(e.createdAt)}</span>
                    <button
                      onClick={() => deleteEntry(e.id)}
                      disabled={busy}
                      className="ml-auto text-gray-400 hover:text-rose-600 p-1"
                      aria-label="Delete entry"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{e.content}</div>
                  {e.tags && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {e.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                        <span key={t} className="pill text-[10px]">#{t}</span>
                      ))}
                    </div>
                  )}
                  {e.expiresAt && (
                    <div className="mt-1 text-[10px] text-rose-600">
                      Auto-deletes {fmtIST12(e.expiresAt)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ─── (d) Reset modal ─── */}
      {showReset && (
        <ResetMode wins={recentWins} onClose={() => setShowReset(false)} />
      )}
    </div>
  );
}

// ─── Reset Mode modal ────────────────────────────────────────────────────
function ResetMode({ wins, onClose }: { wins: VaultEntryDTO[]; onClose: () => void }) {
  useBodyScrollLock(true);
  // Pick 3 random motivational lines per open for variety.
  const lines = useMemo(() => {
    const shuffled = [...MOTIVATION_LINES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 4);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-gradient-to-br from-sky-900 via-indigo-900 to-purple-900 text-white overflow-y-auto">
      <style>{`
        @keyframes vault-breathe {
          0%   { transform: scale(0.7); opacity: .6; }
          33%  { transform: scale(1.15); opacity: 1; }
          66%  { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(0.7); opacity: .6; }
        }
        .vault-breathe-circle {
          animation: vault-breathe 12s ease-in-out infinite;
        }
        @keyframes vault-breathe-label {
          0%   { content: "Breathe in"; }
          33%  { content: "Hold"; }
          66%  { content: "Breathe out"; }
          100% { content: "Breathe in"; }
        }
      `}</style>

      <div className="min-h-full flex flex-col items-center justify-center px-6 py-10 max-w-xl mx-auto text-center">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 min-w-11 min-h-11 flex items-center justify-center"
          aria-label="Close reset mode"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center mb-6">
          <div className="vault-breathe-circle absolute inset-0 rounded-full bg-gradient-to-br from-sky-300/60 to-purple-400/60 blur-xl" />
          <div className="vault-breathe-circle absolute inset-4 rounded-full bg-white/20 backdrop-blur-sm border border-white/30" />
          <Wind className="w-10 h-10 text-white/80 relative z-10" />
        </div>

        <div className="text-xs uppercase tracking-widest text-white/70 mb-1">
          4 seconds in · 4 hold · 4 out
        </div>
        <div className="text-lg font-semibold mb-6">Follow the circle. Just for a minute.</div>

        <ul className="space-y-2 mb-8">
          {lines.map((l, i) => (
            <li key={i} className="text-sm sm:text-base text-white/90 italic leading-relaxed">
              "{l}"
            </li>
          ))}
        </ul>

        {wins.length > 0 && (
          <div className="w-full mb-8">
            <div className="text-xs uppercase tracking-widest text-white/70 mb-2 flex items-center justify-center gap-2">
              <Trophy className="w-4 h-4" /> Remember these wins
            </div>
            <div className="grid grid-cols-1 gap-2">
              {wins.map((w) => (
                <div
                  key={w.id}
                  className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 px-4 py-3 text-sm text-left whitespace-pre-wrap"
                >
                  <div className="text-[10px] uppercase tracking-wider text-white/60 mb-1">
                    {fmtIST12(w.createdAt)}
                  </div>
                  {w.content}
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="px-6 py-3 rounded-full bg-white text-[#0b1a33] font-semibold text-sm min-h-12"
        >
          Done — back to work
        </button>
      </div>
    </div>
  );
}
