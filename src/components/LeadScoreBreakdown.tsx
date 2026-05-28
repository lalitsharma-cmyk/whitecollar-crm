// Rules-based "why this score" breakdown card. Server-safe (no client hooks) —
// pure presentational reducer over the factors produced by explainScore() in
// src/lib/leadRescorer.ts. There is NO AI here; the AI score is itself a
// deterministic rule computation, and this card just narrates the same steps.
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

type Props = {
  score: number;
  bucket: "HOT" | "WARM" | "COLD";
  factors: Factor[];
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

export default function LeadScoreBreakdown({ score, bucket, factors }: Props) {
  const seeds = factors.filter((f) => f.kind === "seed");
  const boosts = factors.filter((f) => f.kind === "boost");
  const penaltiesAndCaps = factors.filter((f) => f.kind === "penalty" || f.kind === "cap");

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-bold tracking-widest text-gray-600">WHY THIS SCORE</span>
        <span className="text-[10px] text-gray-500">— rule-based, no AI</span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-4xl font-bold leading-none tabular-nums">{score}</span>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${bucketChip[bucket]}`}>
          {bucket}
        </span>
        <span className="text-[10px] text-gray-400 ml-auto self-end">
          HOT ≥70 · WARM ≥40 · COLD &lt;40
        </span>
      </div>

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
