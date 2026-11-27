"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Check, ChevronDown, Languages, Package, X } from "lucide-react";
import type { FoodType } from "@rms/contracts";
import { formatPaise, parcelNumber } from "@rms/domain";
import { LANGS, useI18n, type Lang } from "@/lib/i18n";

export const rupees = (paise: number) => formatPaise(paise).replace(/\.00$/, "");

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "outline" }) {
  const styles = {
    primary: "bg-brand text-brand-ink shadow-[0_6px_16px_-8px_var(--color-brand)] active:brightness-95",
    outline: "bg-(--sunken) text-(--ink) active:bg-(--line)",
    ghost: "active:bg-(--sunken)",
  }[variant];
  return (
    <button
      className={`tap inline-flex items-center justify-center gap-2 rounded-full px-5 font-medium transition duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${styles} ${className}`}
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
        <div className="overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(1.75rem,env(safe-area-inset-bottom))]">{children}</div>
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

/**
 * Language menu. A styled popover instead of a native <select>: the OS list rendered as a grey box on Android
 * and Windows and didn't follow the theme. Menu-button pattern: arrows move, Escape / outside tap closes.
 */
export function LangPicker() {
  const { lang, setLang } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  useEffect(() => {
    if (!open) return;
    items.current[LANGS.findIndex((l) => l.code === lang)]?.focus();
    const outside = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, lang]);

  function choose(l: Lang) {
    setLang(l);
    setOpen(false);
    button.current?.focus();
  }

  function onKey(e: React.KeyboardEvent) {
    const i = items.current.findIndex((el) => el === document.activeElement);
    const move = (to: number) => {
      e.preventDefault();
      items.current[(to + LANGS.length) % LANGS.length]?.focus();
    };
    if (e.key === "Escape") {
      setOpen(false);
      button.current?.focus();
    } else if (e.key === "ArrowDown") move(i + 1);
    else if (e.key === "ArrowUp") move(i - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(LANGS.length - 1);
    else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={root} className="relative shrink-0" onKeyDown={onKey}>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Language: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 rounded-full pr-3 pl-3.5 text-sm font-semibold transition-colors duration-150 ${open ? "bg-(--line)" : "bg-(--sunken) active:bg-(--line)"}`}
      >
        <Languages className="muted h-4 w-4" aria-hidden />
        {current.label}
        <ChevronDown className={`muted h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Language" className="menu-in surface line absolute top-12 right-0 z-50 w-44 rounded-2xl border p-1.5 shadow-lift">
          {LANGS.map((l, i) => {
            const on = l.code === lang;
            return (
              <button
                key={l.code}
                ref={(el) => {
                  items.current[i] = el;
                }}
                role="menuitemradio"
                aria-checked={on}
                lang={l.code}
                onClick={() => choose(l.code)}
                className={`flex h-11 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-[15px] transition-colors duration-150 focus-visible:bg-(--sunken) focus-visible:outline-none active:bg-(--sunken) ${on ? "font-semibold text-brand" : "font-medium"}`}
              >
                {l.label}
                {on && <Check className="h-4 w-4" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** "Table T4", or the token of a walk-in parcel. */
export function usePlace() {
  const { t } = useI18n();
  return (label: string) => {
    const n = parcelNumber(label);
    return n === null ? t("table", { label }) : t("parcelNo", { n });
  };
}

/** Dish packed to take away. */
export function ParcelTag() {
  const { t } = useI18n();
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-brand/12 px-1.5 py-0.5 align-middle text-xs font-bold whitespace-nowrap text-brand">
      <Package className="h-3 w-3" aria-hidden />
      {t("parcel")}
    </span>
  );
}

/** Small rounded label (table number, join code…). */
export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full bg-(--sunken) px-3 py-1 text-xs font-medium ${className}`}>{children}</span>;
}
