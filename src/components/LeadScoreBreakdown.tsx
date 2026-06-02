// "Why this score" breakdown card. Server-safe (no client hooks) — pure
// presentational reducer over the factors produced by explainScore() in
// src/lib/leadRescorer.ts.
//
// Honesty note (B-19): the rule-based number this card narrates is the AI-OFF
// default AND the guardrail floor/ceiling the rescorer always applies. When an
// AI provider is configured, rescoreLead may OVERRIDE the stored aiScoreValue /
// aiScore with the model's own number (it reads the "who is the client"
// narrative the rules can't). In that case the headline chip can show a
// different figure than this rule breakdown. So when `aiActive` is set and the
// stored bucket/score diverge from the rule recomputation, we relabel this card
// as the "rule-based baseline" and note the headline is AI-adjusted — rather
// than implying these factors fully explain the displayed AI number. With AI
// off (or when they agree) it reads exactly as before: a faithful step-by-step
// of the deterministic rule score.
//
// Factors are grouped visually: the seed first, then boosts, then penalties &
// caps. Each row shows a human label + a coloured signed delta (+green / -red /
// cap = gray).

type ScoreFactorKind = "seed" | "boost" | "penalty" | "cap";

type Factor = {
  label: string;
  delta: number;
  kind: ScoreFactorKind;
};

type TopFactor = {
  sign: "+" | "−" | "=";
  label: string;
  magnitude: number;
  kind: ScoreFactorKind;
};

type Props = {
  /** Rule-based score recomputed by explainScore() (the breakdown total). */
  score: number;
  /** Rule-based bucket for `score`. */
  bucket: "HOT" | "WARM" | "COLD";
  factors: Factor[];
  /** Top 3–5 contributors (from topScoreFactors) for the compact summary strip. */
  topFactors?: TopFactor[];
  /** True when an AI provider is configured (aiEnabled()). */
  aiActive?: boolean;
  /** Stored headline value the chip shows (lead.aiScoreValue) — may be AI-set. */
  storedScore?: number | null;
  /** Stored headline bucket the chip shows (lead.aiScore) — may be AI-set. */
  storedBucket?: "HOT" | "WARM" | "COLD" | null;
};

const bucketChip: Record<Props["bucket"], string> = {
  HOT: "bg-red-100 text-red-700 border border-red-200",
  WARM: "bg-amber-100 text-amber-700 border border-amber-200",
  COLD: "bg-blue-100 text-blue-700 border border-blue-200",
};

function fmtDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  return `${delta}`;
}

function FactorRow({ f }: { f: Factor }) {
  let deltaClass = "text-gray-500";
  if (f.kind === "cap") deltaClass = "text-gray-500";
  else if (f.delta > 0) deltaClass = "text-emerald-600";
  else if (f.delta < 0) deltaClass = "text-red-600";

  // For the seed row the delta is relative to the 50 baseline; render the
  // absolute baseline value as context instead of a bare 0.
  const deltaText =
    f.kind === "seed"
      ? `${f.delta === 0 ? "50" : `${fmtDelta(f.delta)} → ${50 + f.delta}`}`
      : f.kind === "cap" && f.delta === 0
      ? "—"
      : fmtDelta(f.delta);

  return (
    <div className="flex items-center justify-between gap-3 text-sm py-1">
      <span className="text-gray-700 min-w-0 truncate">{f.label}</span>
      <span className={`font-semibold tabular-nums flex-none ${deltaClass}`}>{deltaText}</span>
    </div>
  );
}

export default function LeadScoreBreakdown({
  score,
  bucket,
  factors,
  topFactors = [],
  aiActive = false,
  storedScore = null,
  storedBucket = null,
}: Props) {
  const seeds = factors.filter((f) => f.kind === "seed");
  const boosts = factors.filter((f) => f.kind === "boost");
  const penaltiesAndCaps = factors.filter((f) => f.kind === "penalty" || f.kind === "cap");

  // Truthfulness gate: only claim to explain the *headline* number when the
  // rule recomputation actually matches what the chip shows. When AI is on and
  // it overrode the score (different value or bucket), present this as the
  // rule-based BASELINE and surface the divergence instead of misleading.
  const aiAdjusted =
    aiActive &&
    storedScore != null &&
    (storedScore !== score || (storedBucket != null && storedBucket !== bucket));

  const heading = aiAdjusted ? "RULE-BASED BASELINE" : "WHY THIS SCORE";
  const subnote = aiAdjusted ? "— before AI adjustment" : "— rule-based, no AI";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold tracking-widest text-gray-600">{heading}</span>
        <span className="text-[10px] text-gray-500">{subnote}</span>
      </div>

      {aiAdjusted && (
        <div className="mb-3 text-[11px] leading-snug text-gray-600 bg-amber-50 border border-amber-200 rounded p-2">
          The headline score above is <span className="font-semibold">{storedBucket} · {storedScore}</span>,
          set by AI from the client narrative. The breakdown below is the
          deterministic rule baseline ({bucket} · {score}) the AI started from.
        </div>
      )}

      <div className="flex items-center gap-3 mb-3">
        <span className="text-4xl font-bold leading-none tabular-nums">{score}</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${bucketChip[bucket]}`}>
          {bucket}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto self-end">
          HOT ≥70 · WARM ≥40 · COLD &lt;40
        </span>
      </div>

      {/* Compact top-contributors strip — the 3–5 signals that moved the score
          most, biggest first (seed/baseline always first). Chips give the agent
          the gist at a glance; the grouped detail below is the full audit. */}
      {topFactors.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {topFactors.map((f, i) => {
            const tone =
              f.sign === "+"
                ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                : f.sign === "−"
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-gray-50 border-gray-200 text-gray-600";
            return (
              <span
                key={`top-${i}`}
                className={`text-xs rounded-full border px-2.5 py-1 ${tone}`}
                title={f.magnitude ? `${f.sign}${f.magnitude} pts` : undefined}
              >
                {f.sign === "=" ? "" : `${f.sign} `}
                {f.label}
              </span>
            );
          })}
        </div>
      )}

      <div className="divide-y divide-gray-100">
        {seeds.length > 0 && (
          <div className="pb-1">
            {seeds.map((f, i) => (
              <FactorRow key={`seed-${i}`} f={f} />
            ))}
          </div>
        )}

        {boosts.length > 0 && (
          <div className="py-1">
            <div className="text-[10px] uppercase tracking-widest text-emerald-600 font-semibold pt-1">
              Boosts
            </div>
            {boosts.map((f, i) => (
              <FactorRow key={`boost-${i}`} f={f} />
            ))}
          </div>
        )}

        {penaltiesAndCaps.length > 0 && (
          <div className="pt-1">
            <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold pt-1">
              Penalties &amp; caps
            </div>
            {penaltiesAndCaps.map((f, i) => (
              <FactorRow key={`pen-${i}`} f={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
