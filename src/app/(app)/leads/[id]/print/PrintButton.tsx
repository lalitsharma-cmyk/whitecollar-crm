"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print btn btn-primary mb-4 print:hidden"
    >
      🖨️ Print / Save PDF
    </button>
  );
}
