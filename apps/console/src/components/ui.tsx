"use client";

import { useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ArrowLeftRight, CloudOff, RefreshCw, Router, type LucideIcon } from "lucide-react";
import { signOut } from "@/lib/auth";
import { useNet } from "@/lib/net";
import { onRejected } from "@/lib/outbox";

type Variant = "primary" | "outline" | "ghost" | "danger" | "success";

const BUTTON_BASE =
  "tap inline-flex items-center justify-center gap-2 rounded-xl px-4 font-semibold transition duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-(--bg)";
const BUTTON_VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_16px_-8px_var(--color-brand)] hover:brightness-110",
  success: "bg-fresh text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_6px_16px_-8px_var(--color-fresh)] hover:brightness-110",
  danger: "bg-late text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] hover:brightness-110",
  outline: "border line surface shadow-xs hover:bg-(--sunken)",
  ghost: "hover:bg-(--sunken)",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`} {...props} />;
}

/** A link that looks like a button (same variants). */
export function LinkButton({ variant = "outline", className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { variant?: Variant }) {
  return <a className={`${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${className}`} {...props} />;
}

/** Product mark used in headers and sign-in screens. */
export function BrandMark({ className = "h-9 w-9 text-base" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-xl bg-linear-to-br from-brand-2 to-brand font-display font-bold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.25)] ${className}`}
    >
      R
    </span>
  );
}

/** Header link with an icon; the text hides on narrow phones so the bar never overflows. */
export function NavLink({ href, icon: Icon, children, active = false }: { href: string; icon: LucideIcon; children: ReactNode; active?: boolean }) {
  return (
    <a
      href={href}
      aria-label={typeof children === "string" ? children : undefined}
      className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm font-semibold transition hover:bg-(--sunken) sm:px-3 ${active ? "text-brand" : "muted hover:text-(--ink)"}`}
    >
      <Icon className="h-4.5 w-4.5" aria-hidden />
      <span className="hidden sm:inline">{children}</span>
    </a>
  );
}

export function TopBar({ title, subtitle, online = true, children }: { title: string; subtitle?: string; online?: boolean; children?: ReactNode }) {
  return (
    <header className="no-print line sticky top-0 z-20 border-b bg-(--surface)/85 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-3 sm:px-6">
        <BrandMark />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-base font-bold tracking-tight sm:text-lg">{title}</h1>
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${online ? "bg-fresh shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-fresh)_20%,transparent)]" : "animate-pulse bg-late"}`}
              role="img"
              aria-label={online ? "Online" : "Offline"}
              title={online ? "Online" : "Offline — reconnecting"}
            />
          </div>
          {subtitle && <p className="muted truncate text-xs">{subtitle}</p>}
        </div>
        <div className="scroll-x ml-auto flex min-w-0 items-center gap-1 sm:gap-2">{children}</div>
        <button
          onClick={() => void signOut()}
          aria-label="Switch user"
          title="Switch user"
          className="muted grid h-10 w-10 shrink-0 place-items-center rounded-xl transition hover:bg-(--sunken) hover:text-(--ink)"
        >
          <ArrowLeftRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </header>
  );
}

/**
 * Connection banner for staff screens. Says where work is going and how much is waiting,
 * so nobody re-taps or reaches for paper during an outage.
 */
export function OfflineBanner({ online }: { online: boolean }) {
  const { mode, pending } = useNet();
  const waiting = pending > 0 ? ` ${pending} action${pending > 1 ? "s" : ""} waiting to sync.` : "";
  const bar = "no-print flex items-center justify-center gap-2 px-4 py-2 text-center text-sm font-semibold";
  if (mode === "hub") {
    return (
      <div role="status" className={`${bar} bg-warn text-black`}>
        <Router className="h-4 w-4 shrink-0" aria-hidden />
        <span>Internet down — working through the restaurant hub. Kitchen and floor keep running; bills need the internet.{waiting}</span>
      </div>
    );
  }
  if (mode === "offline") {
    return (
      <div role="status" className={`${bar} bg-late text-white`}>
        <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
        <span>Offline — your taps are saved on this device and will sync automatically.{waiting}</span>
      </div>
    );
  }
  if (!online) {
    return (
      <div role="status" className={`${bar} bg-late text-white`}>
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
        <span>Reconnecting… screen refreshes automatically.{waiting}</span>
      </div>
    );
  }
  if (pending > 0) {
    return (
      <div role="status" className={`${bar} bg-brand/12 py-1.5 text-brand`}>
        <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
        Syncing {pending} action{pending > 1 ? "s" : ""}…
      </div>
    );
  }
  return null;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm">
      <span className="font-semibold text-(--ink)/85">{label}</span>
      {children}
      {hint && <span className="muted text-xs">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`surface line rounded-2xl border p-4 shadow-soft sm:p-5 ${className}`}>{children}</section>;
}

/** Card title row: heading, optional one-line explanation, optional action on the right. */
export function CardHeader({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        {hint && <p className="muted mt-0.5 text-sm">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

type Tone = "neutral" | "brand" | "fresh" | "warn" | "late";
const TONE: Record<Tone, string> = {
  neutral: "bg-(--sunken) text-(--muted)",
  brand: "bg-brand/12 text-brand",
  fresh: "bg-fresh/12 text-fresh",
  warn: "bg-warn/15 text-warn",
  late: "bg-late/12 text-late",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[tone]} ${className}`}>{children}</span>;
}

/** Big number tile for reports and the platform dashboard. */
export function Stat({ label, value, hint, bad = false, icon: Icon }: { label: string; value: ReactNode; hint?: string; bad?: boolean; icon?: LucideIcon }) {
  return (
    <div className={`surface rounded-2xl border p-4 shadow-soft ${bad ? "border-late/50" : "line"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-xs font-semibold tracking-wide uppercase">{label}</p>
        {Icon && <Icon className={`h-4 w-4 ${bad ? "text-late" : "text-brand"}`} aria-hidden />}
      </div>
      <p className={`mt-1.5 text-2xl font-extrabold tracking-tight tabular-nums sm:text-3xl ${bad ? "text-late" : ""}`}>{value}</p>
      {hint && <p className="muted mt-0.5 text-xs">{hint}</p>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-(--sunken) text-brand">
        <Icon className="h-7 w-7" aria-hidden />
      </span>
      <p className="mt-1 text-lg font-semibold">{title}</p>
      {hint && <p className="muted max-w-sm text-sm">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="muted flex min-h-[40dvh] items-center justify-center gap-2 text-sm" role="status">
      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-2 rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}

/** Shows when a queued action was refused by the server (e.g. someone else already served that dish). */
export function RejectionToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onRejected((r) => setMsg(`Couldn't sync: ${r.reason}`)), []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 6000);
    return () => clearTimeout(t);
  }, [msg]);
  if (!msg) return null;
  return (
    <button
      role="alert"
      onClick={() => setMsg(null)}
      className="fixed inset-x-0 bottom-5 z-50 mx-auto w-fit max-w-[90vw] animate-fade-in rounded-full bg-late px-5 py-2.5 text-sm font-semibold text-white shadow-lift"
    >
      {msg}
    </button>
  );
}
