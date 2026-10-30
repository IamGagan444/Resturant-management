"use client";

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { signOut } from "@/lib/auth";
import { useNet } from "@/lib/net";
import { onRejected } from "@/lib/outbox";

type Variant = "primary" | "outline" | "ghost" | "danger" | "success";

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const styles: Record<Variant, string> = {
    primary: "bg-brand text-white",
    success: "bg-fresh text-white",
    danger: "bg-late text-white",
    outline: "border line surface",
    ghost: "",
  };
  return (
    <button
      className={`tap rounded-xl px-4 font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function TopBar({ title, online = true, children }: { title: string; online?: boolean; children?: ReactNode }) {
  return (
    <header className="no-print surface line sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-2">
      <span
        className={`h-3 w-3 shrink-0 rounded-full ${online ? "bg-fresh" : "animate-pulse bg-late"}`}
        role="img"
        aria-label={online ? "Online" : "Offline"}
        title={online ? "Online" : "Offline — reconnecting"}
      />
      <h1 className="text-lg font-bold">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
      <Button variant="ghost" onClick={() => void signOut()} aria-label="Switch user">
        ⇄
      </Button>
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
  if (mode === "hub") {
    return (
      <div role="status" className="no-print bg-warn px-4 py-2 text-center font-semibold text-black">
        Internet down — working through the restaurant hub. Kitchen and floor keep running; bills need the internet.{waiting}
      </div>
    );
  }
  if (mode === "offline") {
    return (
      <div role="status" className="no-print bg-late px-4 py-2 text-center font-semibold text-white">
        Offline — your taps are saved on this device and will sync automatically.{waiting}
      </div>
    );
  }
  if (!online) {
    return (
      <div role="status" className="no-print bg-late px-4 py-2 text-center font-semibold text-white">
        Reconnecting… screen refreshes automatically.{waiting}
      </div>
    );
  }
  if (pending > 0) {
    return (
      <div role="status" className="no-print bg-brand/15 px-4 py-1 text-center text-sm font-semibold">
        Syncing {pending} action{pending > 1 ? "s" : ""}…
      </div>
    );
  }
  return null;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="muted text-xs">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`surface line rounded-2xl border p-4 ${className}`}>{children}</section>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-late">
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
    <button role="alert" onClick={() => setMsg(null)} className="fixed inset-x-0 bottom-4 z-50 mx-auto w-fit max-w-[90vw] rounded-full bg-late px-4 py-2 text-sm font-semibold text-white shadow-lg">
      {msg}
    </button>
  );
}
