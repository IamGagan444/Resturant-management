"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

/** Bottom sheet on phones, centred dialog on tablets and desktops. Escape and backdrop close it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 animate-fade-in bg-black/45 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className="surface relative flex max-h-[92dvh] w-full max-w-lg animate-sheet-up flex-col rounded-t-3xl shadow-lift sm:rounded-3xl">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-(--line) sm:hidden" aria-hidden />
        <div className="line flex items-center justify-between gap-3 border-b px-5 py-3 sm:py-4">
          <h2 className="truncate text-lg font-bold tracking-tight">{title}</h2>
          <button className="muted -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-xl hover:bg-(--sunken)" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
