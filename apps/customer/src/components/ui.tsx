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
    primary: "bg-brand text-brand-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_8px_20px_-10px_var(--color-brand)] active:brightness-95",
    outline: "border line surface shadow-xs active:bg-(--sunken)",
    ghost: "active:bg-(--sunken)",
  }[variant];
  return (
    <button
      className={`tap inline-flex items-center justify-center gap-2 rounded-2xl px-4 font-semibold transition duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${styles} ${className}`}
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
      <button className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" aria-label="Close" onClick={onClose} />
      <div className="surface relative flex max-h-[90dvh] w-full max-w-md animate-sheet-up flex-col rounded-t-[28px] shadow-lift md:max-w-lg md:rounded-[28px]">
        <div className="mx-auto mt-2.5 h-1.5 w-10 rounded-full bg-(--line) md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pt-3 pb-2">
          <h2 className="font-display text-xl leading-snug font-semibold">{title}</h2>
          <button className="muted -mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-(--sunken)" onClick={onClose} aria-label="Close">
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
      className="fixed inset-x-0 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto w-fit max-w-[90vw] animate-pop rounded-full bg-[#1c1814] px-5 py-2.5 text-sm font-medium text-white shadow-lift dark:bg-white dark:text-[#1c1814]"
    >
      {message}
    </div>
  );
}

export function LangPicker() {
  const { lang, setLang } = useI18n();
  return (
    <label className="line surface relative flex h-10 shrink-0 items-center rounded-full border shadow-xs">
      <Languages className="muted pointer-events-none absolute left-3 h-4 w-4" aria-hidden />
      <select
        aria-label="Language"
        value={lang}
        onChange={(e) => setLang(e.target.value as Lang)}
        className="h-full appearance-none rounded-full bg-transparent pr-3 pl-9 text-sm font-semibold focus:shadow-none"
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
  return <span className={`inline-flex items-center gap-1 rounded-full bg-(--sunken) px-2.5 py-1 text-xs font-semibold ${className}`}>{children}</span>;
}
