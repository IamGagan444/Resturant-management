"use client";

import type { ReactNode } from "react";
import { AlertTriangle, BellRing, CheckCircle2, Info, X, XCircle, type LucideIcon } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { useMedia } from "@/lib/use-media";
import { cn } from "@/lib/utils";

/**
 * Toasts: sonner for stacking, swipe-to-dismiss, timers that pause on hover and the stack that fans out on hover,
 * with our own capsule on top — an inverted, compact surface (dark on the light theme, a raised charcoal on the
 * dark one) with one small coloured icon. No sweeps, ripples or countdown bars: it says its thing and gets out of
 * the way. Colours come from --toast-* tokens (globals.css) so status icons stay readable on the dark capsule.
 */
type Tone = "success" | "error" | "info" | "warning" | "order";

const TONE: Record<Tone, { icon: LucideIcon; color: string }> = {
  success: { icon: CheckCircle2, color: "text-(--toast-ok)" },
  error: { icon: XCircle, color: "text-(--toast-bad)" },
  warning: { icon: AlertTriangle, color: "text-(--toast-warn)" },
  info: { icon: Info, color: "text-(--toast-info)" },
  order: { icon: BellRing, color: "text-(--toast-brand)" },
};

const DURATION: Record<Tone, number> = { success: 3500, info: 4000, warning: 5500, error: 6000, order: 6000 };

export interface ToastAction {
  label: string;
  onClick: () => void;
}

function ToastCard({ id, tone, title, description, action }: { id: string | number; tone: Tone; title: ReactNode; description?: ReactNode; action?: ToastAction }) {
  const t = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="group/toast relative flex w-[calc(100vw-32px)] items-start gap-3 rounded-[18px] bg-(--toast-bg) py-3 pr-3 pl-3.5 font-sans text-(--toast-ink) shadow-(--toast-shadow) ring-1 ring-(--toast-ring) sm:w-[360px]"
    >
      <t.icon className={cn("mt-px h-[18px] w-[18px] shrink-0", t.color)} strokeWidth={2.25} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-5 font-medium tracking-[-0.01em]">{title}</p>
        {description && <p className="mt-0.5 text-[13px] leading-[1.4] break-words text-(--toast-muted)">{description}</p>}
      </div>
      {action && (
        <button
          type="button"
          onClick={() => {
            action.onClick();
            toast.dismiss(id);
          }}
          className="-my-0.5 h-7 shrink-0 rounded-full bg-(--toast-ink) px-3 text-[13px] font-semibold text-(--toast-bg) transition hover:opacity-90 active:scale-95"
        >
          {action.label}
        </button>
      )}
      {/* close: always there on touch, appears on hover with a mouse */}
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label="Dismiss"
        className="-my-0.5 -mr-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-(--toast-muted) transition hover:bg-(--toast-ink)/10 hover:text-(--toast-ink) focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/toast:opacity-100"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

export function showToast(tone: Tone, title: ReactNode, description?: ReactNode, opts: { duration?: number; action?: ToastAction } = {}) {
  const duration = opts.duration ?? DURATION[tone];
  return toast.custom((id) => <ToastCard id={id} tone={tone} title={title} description={description} action={opts.action} />, { duration });
}

/**
 * Mounted once (providers.tsx). Phones: top-center, so it never covers the bottom action bars.
 * Desktop: bottom-right, out of the way of the content, stacked and fanning out on hover.
 */
export function Toaster() {
  const wide = useMedia("(min-width: 768px) and (pointer: fine)");
  return (
    <Sonner
      position={wide ? "bottom-right" : "top-center"}
      gap={8}
      visibleToasts={3}
      offset={wide ? 24 : 16}
      mobileOffset={{ top: "max(12px, env(safe-area-inset-top))" }}
      toastOptions={{ unstyled: true }}
    />
  );
}
