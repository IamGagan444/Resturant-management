"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button
      className="tap mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-(--sunken) font-medium print:hidden"
      onClick={() => window.print()}
    >
      <Printer className="h-4 w-4" aria-hidden />
      Print / save as PDF
    </button>
  );
}
