"use client";

export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn btn-ghost text-xs print:hidden"
      aria-label="Print this lead"
    >
      🖨 Print
    </button>
  );
}
