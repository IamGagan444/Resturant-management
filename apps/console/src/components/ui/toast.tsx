"use client";

import type { ReactNode } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Toasts: sonner (the toast shadcn/ui ships) for stacking, swipe-to-dismiss and timers, with our own card on top —
 * glass surface, a tinted icon with a ripple, a light sweep along the top edge and a countdown bar that pauses while
 * hovered (the Magic UI look, CSS only: no animation library, cheap on kitchen tablets, off with reduced motion).
 */
type Tone = "success" | "error" | "info" | "warning" | "order";

const TONE: Record<Tone, { icon: LucideIcon; text: string; tile: string; bar: string }> = {
  success: { icon: CheckCircle2, text: "text-fresh", tile: "bg-fresh/12", bar: "bg-fresh" },
  error: { icon: XCircle, text: "text-late", tile: "bg-late/12", bar: "bg-late" },
  warning: { icon: AlertTriangle, text: "text-warn", tile: "bg-warn/15", bar: "bg-warn" },
  info: { icon: Info, text: "text-(--ink)", tile: "bg-(--sunken)", bar: "bg-(--muted)" },
  order: { icon: BellRing, text: "text-brand", tile: "bg-brand/12", bar: "bg-brand" },
};

const DURATION: Record<Tone, number> = { success: 3500, info: 4000, warning: 5500, error: 6000, order: 6000 };

function ToastCard({ id, tone, title, description, duration }: { id: string | number; tone: Tone; title: ReactNode; description?: ReactNode; duration: number }) {
  const t = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="toast-card line relative flex w-[calc(100vw-32px)] items-start gap-3 overflow-hidden rounded-2xl border bg-(--surface)/92 p-3.5 pr-10 font-sans text-(--ink) shadow-lift backdrop-blur-xl sm:w-[380px]"
    >
      <span aria-hidden className="toast-shine pointer-events-none absolute inset-x-0 top-0 h-px" />
      <span className={cn("relative grid h-9 w-9 shrink-0 place-items-center rounded-xl", t.tile, t.text)}>
        <span aria-hidden className={cn("toast-ripple absolute inset-0 rounded-xl", t.tile)} />
        <t.icon className={cn("relative h-5 w-5", tone === "order" && "animate-[wiggle_0.5s_ease-in-out_3]")} aria-hidden />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm leading-snug font-semibold">{title}</p>
        {description && <p className="muted mt-0.5 text-[13px] leading-snug break-words">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label="Dismiss"
        className="absolute top-2.5 right-2.5 grid h-7 w-7 place-items-center rounded-full text-(--muted) transition hover:bg-(--sunken) hover:text-(--ink)"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-(--line)/60">
        <span className={cn("toast-progress block h-full origin-left", t.bar)} style={{ animationDuration: `${duration}ms` }} />
      </span>
    </div>
  );
}

export function showToast(tone: Tone, title: ReactNode, description?: ReactNode, duration = DURATION[tone]) {
  return toast.custom((id) => <ToastCard id={id} tone={tone} title={title} description={description} duration={duration} />, { duration });
}

/** Mounted once (providers.tsx). Top-center so it never covers the bottom action bars on phones. */
export function Toaster() {
  return <Sonner position="top-center" gap={10} visibleToasts={4} offset={16} toastOptions={{ unstyled: true }} />;
}
