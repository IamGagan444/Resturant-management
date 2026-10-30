"use client";

import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
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
    primary: "bg-brand text-brand-ink active:brightness-95 disabled:opacity-50",
    outline: "border line surface active:bg-black/5 disabled:opacity-50",
    ghost: "active:bg-black/5 disabled:opacity-50",
  }[variant];
  return <button className={`tap rounded-xl px-4 font-semibold transition ${styles} ${className}`} {...props} />;
}

/** Indian veg / non-veg / egg mark. */
export function FoodMark({ type }: { type: FoodType }) {
  const color = type === "NON_VEG" ? "border-nonveg" : type === "EGG" ? "border-egg" : "border-veg";
  const dot = type === "NON_VEG" ? "bg-nonveg" : type === "EGG" ? "bg-egg" : "bg-veg";
  const label = { VEG: "Vegetarian", VEGAN: "Vegan", NON_VEG: "Non-vegetarian", EGG: "Contains egg" }[type];
  return (
    <span role="img" aria-label={label} title={label} className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border-2 ${color}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
    </span>
  );
}

/** Bottom sheet. Escape and backdrop close it. */
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
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={title}>
      <button className="absolute inset-0 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="surface relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 pb-8 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="tap -mr-2 text-2xl leading-none" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
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
    <div role="status" className="fixed inset-x-0 top-3 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-stone-900 px-4 py-2 text-sm text-white shadow-lg">
      {message}
    </div>
  );
}

export function LangPicker() {
  const { lang, setLang } = useI18n();
  return (
    <select
      aria-label="Language"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      className="tap line surface shrink-0 rounded-full border px-3 text-sm"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
