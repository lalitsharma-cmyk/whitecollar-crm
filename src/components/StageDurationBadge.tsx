interface Props { since: Date | string | null; label?: string }
export default function StageDurationBadge({ since }: Props) {
  if (!since) return null;
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
  if (days < 1) return null; // don't show for less than 1 day
  const color =
    days > 7
      ? "bg-red-100 text-red-700"
      : days > 3
      ? "bg-amber-100 text-amber-700"
      : "bg-emerald-100 text-emerald-700";
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>
      {days}d not updated
    </span>
  );
}
