"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Languages, X } from "lucide-react";
import type { FoodType } from "@rms/contracts";
import { formatPaise } from "@rms/domain";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";

export const rupees = (paise: number) => formatPaise(paise).replace(/\.00$/, "");

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const styles = {
    primary: "bg-brand text-brand-ink active:opacity-85",
    outline: "bg-(--sunken) text-(--ink) active:bg-(--line)",
    ghost: "active:bg-(--sunken)",
  }[variant];
  return (
    <button
      className={`tap inline-flex items-center justify-center gap-2 rounded-full px-5 font-medium transition duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ink) focus-visible:ring-offset-2 ${styles} ${className}`}
      {...props}
    />
  );
}

/** Indian veg / non-veg / egg mark. */
export function FoodMark({ type }: { type: FoodType }) {
  const color = type === "NON_VEG" ? "border-nonveg" : type === "EGG" ? "border-egg" : "border-veg";
  const dot = type === "NON_VEG" ? "bg-nonveg" : type === "EGG" ? "bg-egg" : "bg-veg";
  const label = { VEG: "Vegetarian", VEGAN: "Vegan", NON_VEG: "Non-vegetarian", EGG: "Contains egg" }[type];
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] bg-white ${color}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
    </span>
  );
}

/** Bottom sheet (a centred dialog on wide screens). Escape and backdrop close it. */
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
    <div className="fixed inset-0 z-40 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 animate-fade-in bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="surface relative flex max-h-[90dvh] w-full max-w-md animate-sheet-up flex-col rounded-t-2xl shadow-lift md:max-w-lg md:rounded-2xl">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-(--line) md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2">
          <h2 className="font-display text-2xl leading-snug font-bold">{title}</h2>
          <button className="-mr-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--sunken)" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-2 pb-[max(1.75rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto w-fit max-w-[90vw] animate-pop rounded-full bg-brand px-5 py-3 text-sm font-medium text-brand-ink shadow-lift"
    >
      {message}
    </div>
  );
}

export function LangPicker() {
  const { lang, setLang } = useI18n();
  return (
    <label className="relative flex h-10 shrink-0 items-center rounded-full bg-(--sunken)">
      <Languages className="muted pointer-events-none absolute left-3 h-4 w-4" aria-hidden />
      <select
        aria-label="Language"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="h-full appearance-none rounded-full border-0 bg-transparent pr-3.5 pl-9 text-sm font-medium focus:shadow-none"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Small rounded label (table number, join code…). */
export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-(--sunken) px-3 py-1 text-xs font-medium ${className}`}>{children}</span>;
}
