"use client";
// Vault — reflection / journal / wins UI for the logged-in agent.
// This component never sends a userId; the server forces it to the session
// user on write. All reads/writes go through /api/vault and /api/vault/[id].
// Note: admins/managers can review entries via /admin/vault (owner decision).
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart, Wind, Trophy, MessageSquare, X, Trash2, Plus, Sparkles, BookOpen } from "lucide-react";
import { fmtIST12 } from "@/lib/datetime";
import { useBodyScrollLock } from "@/hooks/useBodyScrollLock";
import VaultVoiceInput from "@/components/VaultVoiceInput";

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
  JOURNAL:    "Journal",
  VENT:       "Vent",
  WIN:        "Win",
  LESSON:     "Lesson",
  GRATITUDE:  "Gratitude",
  deal_story: "Deal story",
  reset:      "Reset",
};

const KIND_CHIP: Record<string, string> = {
  JOURNAL:    "bg-blue-100 text-blue-800",
  VENT:       "bg-rose-100 text-rose-800",
  WIN:        "bg-emerald-100 text-emerald-800",
  LESSON:     "bg-amber-100 text-amber-800",
  GRATITUDE:  "bg-purple-100 text-purple-800",
  deal_story: "bg-indigo-100 text-indigo-800",
  reset:      "bg-sky-100 text-sky-800",
};

const RESET_MOTIVATION_LINES = [
  "Every 'no' brings you closer to the next 'yes'",
  "Your best closer move is your calm presence",
  "One real conversation beats ten rushed ones",
  "The deal you didn't push? It's still there tomorrow.",
  "Reset. Refocus. The phone will ring.",
];

// ─── Deal-story helpers ──────────────────────────────────────────────────
type DealStoryFields = {
  project: string;
  clientType: string;
  whatWorked: string;
  lessons: string;
};

function formatDealStory(f: DealStoryFields): string {
  return [
    `**Project:** ${f.project.trim()}`,
    `**Client type:** ${f.clientType.trim()}`,
    `**What worked:** ${f.whatWorked.trim()}`,
    `**Lessons:** ${f.lessons.trim()}`,
  ].join("\n");
}

function parseDealStory(content: string): DealStoryFields | null {
  // Match each section. Each label runs until the next **Label:** or end-of-string.
  const grab = (label: string) => {
    const re = new RegExp(
      `\\*\\*${label}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*[A-Za-z][^*]*:\\*\\*|$)`,
      "i"
    );
    const m = content.match(re);
    return m ? m[1].trim() : "";
  };
  const project = grab("Project");
  const clientType = grab("Client type");
  const whatWorked = grab("What worked");
  const lessons = grab("Lessons");
  if (!project && !clientType && !whatWorked && !lessons) return null;
  return { project, clientType, whatWorked, lessons };
}

type EntryFilter = "ALL" | "deal_story";

// ─── Component ───────────────────────────────────────────────────────────
export default function VaultClient({ initialEntries }: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState<VaultEntryDTO[]>(initialEntries);
  const [pendingMood, setPendingMood] = useState<MoodKey | null>(null);
  const [moodNote, setMoodNote] = useState("");
  const [showVent, setShowVent] = useState(false);
  const [ventText, setVentText] = useState("");
  const [showAddWin, setShowAddWin] = useState(false);
  const [winText, setWinText] = useState("");
  const [showReset, setShowReset] = useState(false);
  const [showAddStory, setShowAddStory] = useState(false);
  const [storyFields, setStoryFields] = useState<DealStoryFields>({
    project: "",
    clientType: "",
    whatWorked: "",
    lessons: "",
  });
  const [entryFilter, setEntryFilter] = useState<EntryFilter>("ALL");
  const [busy, setBusy] = useState(false);
  const [resetToast, setResetToast] = useState(false);
  const [, startTransition] = useTransition();

  const wins = useMemo(() => entries.filter((e) => e.kind === "WIN"), [entries]);
  const recentWins = useMemo(() => wins.slice(0, 3), [wins]);
  const dealStoryCount = useMemo(
    () => entries.filter((e) => e.kind === "deal_story").length,
    [entries]
  );
  const filteredEntries = useMemo(() => {
    if (entryFilter === "deal_story") {
      return entries.filter((e) => e.kind === "deal_story");
    }
    return entries;
  }, [entries, entryFilter]);

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
    // Vents are permanent now — no expiresAt is sent.
    const ok = await postEntry({ kind: "VENT", content: text });
    if (ok) {
      setVentText("");
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

  async function saveStory() {
    const { project, clientType, whatWorked, lessons } = storyFields;
    // Require at least one field with content
    if (
      !project.trim() &&
      !clientType.trim() &&
      !whatWorked.trim() &&
      !lessons.trim()
    ) {
      return;
    }
    const ok = await postEntry({
      kind: "deal_story",
      content: formatDealStory(storyFields),
    });
    if (ok) {
      setStoryFields({ project: "", clientType: "", whatWorked: "", lessons: "" });
      setShowAddStory(false);
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
            Your space to journal, vent, log wins, and reset when it gets heavy.
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
              placeholder="Optional — what's behind that feeling?"
              className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              autoFocus
            />
            <VaultVoiceInput
              onTranscript={(t) =>
                setMoodNote((prev) => (prev ? `${prev} ${t}` : t))
              }
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

      {/* ─── (b) + (d) action row: Quick Vent + Reset Mode + Deal story ─── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => setShowVent((v) => !v)}
          className="card p-4 text-left hover:border-rose-300 transition border-2 border-transparent min-h-24"
        >
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-5 h-5 text-rose-500" />
            <div className="font-semibold text-sm">Quick Vent</div>
          </div>
          <div className="text-xs text-gray-500">
            Let it out — get it off your chest.
          </div>
        </button>

        <button
          onClick={() => setShowReset(true)}
          className="card p-4 text-left hover:border-sky-300 transition border-2 border-transparent min-h-24 bg-gradient-to-br from-amber-50 to-indigo-50"
        >
          <div className="flex items-center gap-2 mb-1">
            <Wind className="w-5 h-5 text-sky-600" />
            <div className="font-semibold text-sm">🧘 Reset Mode (5 min)</div>
          </div>
          <div className="text-xs text-gray-600">
            Breathe. Remember why you're doing this. 5 minutes.
          </div>
        </button>

        <button
          onClick={() => setShowAddStory((v) => !v)}
          className="card p-4 text-left hover:border-indigo-300 transition border-2 border-transparent min-h-24 bg-gradient-to-br from-indigo-50 to-purple-50"
        >
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-indigo-600" />
            <div className="font-semibold text-sm">📖 Deal story</div>
          </div>
          <div className="text-xs text-gray-600">
            Capture what worked + lessons from a deal.
          </div>
        </button>
      </section>

      {showAddStory && (
        <section className="card p-4 border-l-4 border-indigo-400">
          <div className="font-semibold text-sm mb-3 flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-indigo-600" />
            New deal story
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Project
              </label>
              <input
                type="text"
                value={storyFields.project}
                onChange={(e) =>
                  setStoryFields((f) => ({ ...f, project: e.target.value }))
                }
                placeholder="e.g. Damac Lagoons, Sobha Hartland"
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Client type
              </label>
              <input
                type="text"
                value={storyFields.clientType}
                onChange={(e) =>
                  setStoryFields((f) => ({ ...f, clientType: e.target.value }))
                }
                placeholder="e.g. NRI from Bangalore, Dubai resident upgrading"
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                What worked / why we won
              </label>
              <textarea
                value={storyFields.whatWorked}
                onChange={(e) =>
                  setStoryFields((f) => ({ ...f, whatWorked: e.target.value }))
                }
                rows={3}
                placeholder="The pitch angle, the timing, the trust moment…"
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Lessons / do differently next time
              </label>
              <textarea
                value={storyFields.lessons}
                onChange={(e) =>
                  setStoryFields((f) => ({ ...f, lessons: e.target.value }))
                }
                rows={3}
                placeholder="What you'd change, what almost killed the deal…"
                className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setShowAddStory(false);
                setStoryFields({ project: "", clientType: "", whatWorked: "", lessons: "" });
              }}
              disabled={busy}
              className="btn btn-ghost text-xs min-h-11"
            >
              Cancel
            </button>
            <button
              onClick={saveStory}
              disabled={
                busy ||
                (!storyFields.project.trim() &&
                  !storyFields.clientType.trim() &&
                  !storyFields.whatWorked.trim() &&
                  !storyFields.lessons.trim())
              }
              className="btn btn-primary text-xs min-h-11"
            >
              {busy ? "Saving…" : "Save story"}
            </button>
          </div>
        </section>
      )}

      {showVent && (
        <section className="card p-4 border-l-4 border-rose-400">
          <div className="font-semibold text-sm mb-2">Get it off your chest</div>
          <textarea
            value={ventText}
            onChange={(e) => setVentText(e.target.value)}
            rows={4}
            placeholder="Say what you need to say — let it out."
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm"
            autoFocus
          />
          <div className="mt-2">
            <VaultVoiceInput
              onTranscript={(t) =>
                setVentText((prev) => (prev ? `${prev} ${t}` : t))
              }
            />
          </div>
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
              <VaultVoiceInput
                onTranscript={(t) =>
                  setWinText((prev) => (prev ? `${prev} ${t}` : t))
                }
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
            <span className="ml-auto text-[11px] text-gray-500">
              {entryFilter === "deal_story"
                ? `${filteredEntries.length} deal ${filteredEntries.length === 1 ? "story" : "stories"}`
                : `Last ${entries.length}`}
            </span>
          </div>

          {/* Tab strip */}
          <div className="flex gap-2 mb-3 flex-wrap">
            <button
              onClick={() => setEntryFilter("ALL")}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                entryFilter === "ALL"
                  ? "bg-[#0b1a33] text-white border-[#0b1a33]"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setEntryFilter("deal_story")}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${
                entryFilter === "deal_story"
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300"
              }`}
            >
              📖 Deal stories {dealStoryCount > 0 && `(${dealStoryCount})`}
            </button>
          </div>

          {filteredEntries.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              {entryFilter === "deal_story"
                ? "No deal stories yet. Capture one after your next close."
                : "Nothing yet. Start with a mood check-in above."}
            </div>
          ) : (
            <ul className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {filteredEntries.map((e) => {
                const story = e.kind === "deal_story" ? parseDealStory(e.content) : null;
                return (
                  <li
                    key={e.id}
                    className={`rounded-lg border px-3 py-2 ${
                      story
                        ? "border-indigo-200 bg-indigo-50/40"
                        : "border-[#e5e7eb] bg-white/60"
                    }`}
                  >
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
                    {story ? (
                      <div className="text-sm space-y-1.5">
                        {story.project && (
                          <div>
                            <span className="font-semibold text-indigo-900">Project: </span>
                            <span className="whitespace-pre-wrap">{story.project}</span>
                          </div>
                        )}
                        {story.clientType && (
                          <div>
                            <span className="font-semibold text-indigo-900">Client type: </span>
                            <span className="whitespace-pre-wrap">{story.clientType}</span>
                          </div>
                        )}
                        {story.whatWorked && (
                          <div>
                            <div className="font-semibold text-indigo-900">What worked</div>
                            <div className="whitespace-pre-wrap text-gray-800">{story.whatWorked}</div>
                          </div>
                        )}
                        {story.lessons && (
                          <div>
                            <div className="font-semibold text-indigo-900">Lessons</div>
                            <div className="whitespace-pre-wrap text-gray-800">{story.lessons}</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-sm whitespace-pre-wrap">{e.content}</div>
                    )}
                    {e.tags && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {e.tags.split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                          <span key={t} className="pill text-[10px]">#{t}</span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* ─── (d) Reset modal ─── */}
      {showReset && (
        <ResetMode
          wins={recentWins}
          onClose={() => setShowReset(false)}
          onComplete={async () => {
            await postEntry({
              kind: "reset",
              mood: "NEUTRAL",
              content: "Completed a 5-minute reset",
            });
            setResetToast(true);
            window.setTimeout(() => setResetToast(false), 4000);
          }}
        />
      )}

      {/* ─── Reset-complete toast ─── */}
      {resetToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[#0b1a33] text-white px-5 py-2.5 text-sm shadow-lg border border-[#c9a24b]/60"
        >
          ✨ Reset complete
        </div>
      )}
    </div>
  );
}

// ─── Reset Mode modal ────────────────────────────────────────────────────
// 5-minute guided breathing reset. On natural completion, auto-saves a
// VaultEntry { kind: "reset" } and lets the parent show a toast.
function ResetMode({
  wins,
  onClose,
  onComplete,
}: {
  wins: VaultEntryDTO[];
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  useBodyScrollLock(true);

  const TOTAL_SECONDS = 5 * 60; // 5 minutes
  const BREATH_PHASE_SECONDS = 4; // inhale 4, hold 4, exhale 4 (12s cycle)
  const LINE_ROTATE_SECONDS = 60; // rotate motivational line every 60s

  const [secondsLeft, setSecondsLeft] = useState(TOTAL_SECONDS);
  const [elapsed, setElapsed] = useState(0);
  const completedRef = useRef(false);
  const completeCbRef = useRef(onComplete);
  completeCbRef.current = onComplete;

  // Shuffle the motivational lines once so rotation order varies per open.
  const lines = useMemo(() => {
    return [...RESET_MOTIVATION_LINES].sort(() => Math.random() - 0.5);
  }, []);

  // ── Countdown timer ────────────────────────────────────────────────
  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed((e) => e + 1);
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          if (!completedRef.current) {
            completedRef.current = true;
            // Fire-and-forget; parent handles toast + router.refresh.
            void Promise.resolve(completeCbRef.current()).finally(() => {
              onClose();
            });
          }
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [onClose]);

  // ── Web Audio: very soft 528Hz sine ping at the start of each
  //    inhale phase (every 12s). Best-effort — silently skipped if the
  //    browser blocks audio.
  useEffect(() => {
    let ctx: AudioContext | null = null;
    type AudioCtor = typeof AudioContext;
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    const Ctor: AudioCtor | undefined = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    const playTone = () => {
      if (!ctx) return;
      try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 528;
        gain.gain.value = 0.05;
        osc.connect(gain).connect(ctx.destination);
        const now = ctx.currentTime;
        // Soft attack + release to avoid clicks
        gain.gain.setValueAtTime(0.0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.02);
        gain.gain.linearRampToValueAtTime(0.0, now + 0.2);
        osc.start(now);
        osc.stop(now + 0.22);
      } catch {
        // ignore
      }
    };
    // Play immediately on open, then every 12s (one full breath cycle).
    playTone();
    const id = window.setInterval(playTone, BREATH_PHASE_SECONDS * 3 * 1000);
    return () => {
      window.clearInterval(id);
      if (ctx) {
        try { void ctx.close(); } catch { /* ignore */ }
      }
    };
  }, []);

  // ── Derived: breath phase + rotating motivational line ─────────────
  const phaseIndex = Math.floor(elapsed / BREATH_PHASE_SECONDS) % 3;
  const phaseLabel = phaseIndex === 0 ? "Breathe in…" : phaseIndex === 1 ? "Hold…" : "Breathe out…";
  const currentLine = lines[Math.floor(elapsed / LINE_ROTATE_SECONDS) % lines.length];

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto text-white"
      role="dialog"
      aria-modal="true"
      aria-label="Reset Mode"
    >
      {/* Soft gold → navy gradient, dimmed */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-[#c9a24b] via-[#3a3470] to-[#0b1a33]"
      />
      <div aria-hidden className="absolute inset-0 bg-black/40" />

      <style>{`
        @keyframes vault-breathe-5 {
          0%   { transform: scale(1.0); }
          50%  { transform: scale(1.4); }
          100% { transform: scale(1.0); }
        }
        .vault-breathe-circle-5 {
          animation: vault-breathe-5 8s ease-in-out infinite;
        }
      `}</style>

      {/* Countdown — top-right corner */}
      <div className="absolute top-4 right-4 z-10 font-mono text-sm sm:text-base bg-black/30 backdrop-blur-sm rounded-full px-3 py-1.5 border border-white/20 tabular-nums">
        {mm}:{ss}
      </div>

      <div className="relative z-10 w-full max-w-xl mx-auto px-6 py-10 flex flex-col items-center justify-center text-center min-h-full">
        {/* Phase label */}
        <div
          key={phaseIndex}
          className="text-lg sm:text-xl font-medium text-white/90 mb-6 tracking-wide"
        >
          {phaseLabel}
        </div>

        {/* Breathing circle */}
        <div className="relative w-48 h-48 sm:w-56 sm:h-56 flex items-center justify-center mb-10">
          <div className="vault-breathe-circle-5 absolute inset-0 rounded-full bg-gradient-to-br from-amber-200/40 to-indigo-300/40 blur-xl" />
          <div className="vault-breathe-circle-5 absolute inset-4 rounded-full bg-white/15 backdrop-blur-sm border border-white/30" />
          <Wind className="w-10 h-10 text-white/80 relative z-10" />
        </div>

        {/* Rotating motivational line */}
        <div
          key={currentLine}
          className="text-base sm:text-lg italic text-white/95 max-w-md leading-relaxed mb-10 min-h-[3rem]"
        >
          “{currentLine}”
        </div>

        {/* Recent wins reminder (optional context) */}
        {wins.length > 0 && (
          <div className="w-full mb-10">
            <div className="text-[10px] uppercase tracking-widest text-white/60 mb-2 flex items-center justify-center gap-2">
              <Trophy className="w-3.5 h-3.5" /> Remember these wins
            </div>
            <div className="grid grid-cols-1 gap-2">
              {wins.slice(0, 2).map((w) => (
                <div
                  key={w.id}
                  className="rounded-xl bg-white/10 backdrop-blur-sm border border-white/20 px-4 py-2.5 text-xs sm:text-sm text-left whitespace-pre-wrap"
                >
                  {w.content}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* End Reset button */}
        <button
          onClick={onClose}
          className="px-6 py-3 rounded-full bg-white/90 hover:bg-white text-[#0b1a33] font-semibold text-sm min-h-12 inline-flex items-center gap-2"
        >
          <X className="w-4 h-4" /> End Reset
        </button>
      </div>
    </div>
  );
}
