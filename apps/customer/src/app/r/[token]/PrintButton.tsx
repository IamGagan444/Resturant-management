"use client";

export function PrintButton() {
  return (
    <button className="tap line mt-4 w-full rounded-xl border font-semibold print:hidden" onClick={() => window.print()}>
      Print / save as PDF
    </button>
  );
}
