"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Toaster as Sonner, toast } from "sonner";
import { describeError } from "@/lib/errors";
import { Button } from "./index";
import { Modal } from "./modal";

/** Toasts (sonner), placed where they don't cover the bottom actions on phones. */
export function Toaster() {
  return (
    <Sonner
      position="top-center"
      richColors
      closeButton
      toastOptions={{ className: "!rounded-2xl !font-sans !shadow-lift", duration: 4000 }}
    />
  );
}

export const notify = {
  ok: (message: string) => toast.success(message),
  error: (e: unknown) => toast.error(describeError(e)),
};

/**
 * Query states in one place: skeleton while loading, an error card with "Try again" if it failed,
 * the content otherwise. Background refetch errors keep the old data on screen.
 */
export function Loadable<T>({ query, skeleton, children }: { query: UseQueryResult<T>; skeleton: ReactNode; children: (data: T) => ReactNode }) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  return <>{skeleton}</>;
}

export function QueryError({ error, onRetry, retrying = false }: { error: unknown; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="line flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-late/10 text-late">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <p className="font-semibold">Couldn&apos;t load this</p>
      <p className="muted max-w-sm text-sm">{describeError(error)}</p>
      <Button variant="outline" className="text-sm" onClick={onRetry} disabled={retrying}>
        <RefreshCw className={`h-4 w-4 ${retrying ? "animate-spin" : ""}`} aria-hidden />
        Try again
      </Button>
    </div>
  );
}

// ── Confirm: `await confirm({...})` instead of window.confirm ──

interface ConfirmRequest {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** user must type this (e.g. the restaurant's name) before confirming */
  typeToConfirm?: string;
  resolve: (ok: boolean) => void;
}

let pending: ConfirmRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function confirm(opts: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...opts, resolve };
    emit();
  });
}

/** Mounted once (providers.tsx); renders whatever `confirm()` asked for. */
export function ConfirmHost() {
  const req = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => pending,
    () => null,
  );
  const [typed, setTyped] = useState("");
  const close = (ok: boolean) => {
    req?.resolve(ok);
    pending = null;
    setTyped("");
    emit();
  };
  if (!req) return null;
  const blocked = Boolean(req.typeToConfirm) && typed.trim() !== req.typeToConfirm;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close(false)}
      title={req.title}
      footer={
        <>
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant={req.destructive ? "danger" : "primary"} className="flex-1 sm:flex-none" disabled={blocked} onClick={() => close(true)}>
            {req.confirmLabel ?? "Confirm"}
          </Button>
        </>
      }
    >
      {req.description && <div className="muted text-sm leading-relaxed">{req.description}</div>}
      {req.typeToConfirm && (
        <label className="mt-4 flex flex-col gap-1.5 text-sm">
          <span className="font-semibold">
            Type <span className="rounded bg-(--sunken) px-1.5 py-0.5 font-mono">{req.typeToConfirm}</span> to confirm
          </span>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
      )}
    </Modal>
  );
}
