export default function ComingSoon({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="card p-12 text-center">
      <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest text-[#c9a24b]">PHASE 2 · COMING SOON</div>
      <h1 className="text-2xl font-bold mt-3">{title}</h1>
      <p className="text-sm text-gray-500 mt-2 max-w-xl mx-auto">{blurb}</p>
    </div>
  );
}
