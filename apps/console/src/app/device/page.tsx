"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Me, StaffRole } from "@rms/contracts";
import { ApiError, api } from "@/lib/api";
import { describeError } from "@/lib/errors";
import { homeFor } from "@/lib/auth";
import { ChefHat, ConciergeBell, CreditCard, Crown, Delete, MonitorSmartphone, UserRoundCog, type LucideIcon } from "lucide-react";
import { AuthAside } from "@/components/AuthAside";
import { BrandMark, Button, Spinner } from "@/components/ui";

interface DeviceInfo {
  device: { id: string; name: string; kind: string; stationId: string | null };
  hotel: { id: string; name: string };
  staff: { id: string; name: string; role: StaffRole }[];
}

/** Who each kind of paired device offers (mirrors DEVICE_ROLES in the API's auth routes). */
const DEVICE_WHO: Record<string, { name: string; who: string }> = {
  KDS: { name: "kitchen screen", who: "cooks and managers" },
  WAITER: { name: "waiter phone", who: "waiters and managers" },
  POS: { name: "counter", who: "cashiers and managers" },
  MANAGER: { name: "manager device", who: "everyone" },
};

const ROLE_ICON: Record<StaffRole, LucideIcon> = { OWNER: Crown, MANAGER: UserRoundCog, CASHIER: CreditCard, COOK: ChefHat, WAITER: ConciergeBell };

/** Shared tablet/phone: tap your face, type your PIN. Two steps, no typing of phone numbers. */
export default function DevicePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["device"], queryFn: () => api<DeviceInfo>("GET", "/v1/auth/device"), retry: false });
  const [picked, setPicked] = useState<DeviceInfo["staff"][number] | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function submit(p: string) {
    if (!picked || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await api("POST", "/v1/auth/pin", { staffId: picked.id, pin: p });
      const me = await api<Me>("GET", "/v1/auth/me");
      qc.setQueryData(["me"], me);
      router.replace(homeFor(me));
    } catch (e) {
      setPin("");
      setError(e instanceof Error ? e.message : "Wrong PIN");
    } finally {
      busy.current = false;
    }
  }

  function press(d: string) {
    const next = (pin + d).slice(0, 6);
    setPin(next);
    // Auto-submit only at the max length; guessing at 4 would burn lockout attempts for 6-digit PINs.
    if (next.length === 6) void submit(next);
  }

  // Laptops and tablets with keyboards: digits, Backspace, Enter, Esc work like the keypad.
  const keys = useRef({ press, submit, pin });
  keys.current = { press, submit, pin };
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (/^\d$/.test(e.key)) keys.current.press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && keys.current.pin.length >= 4) void keys.current.submit(keys.current.pin);
      else if (e.key === "Escape") {
        setPicked(null);
        setPin("");
        setError(null);
      }
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picked]);

  if (info.isLoading) return <Spinner />;
  if (info.error instanceof ApiError && info.error.code === "DEVICE_NOT_PAIRED") return <NotPaired onPaired={() => void info.refetch()} />;
  if (!info.data) return <p className="p-8 text-center font-medium text-late">Could not reach the server. Retrying…</p>;

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex items-center gap-3">
        <BrandMark />
        <p className="muted min-w-0 truncate text-sm font-medium">
          {info.data.hotel.name} · {info.data.device.name}
        </p>
      </div>
      {!picked ? (
        <>
          <h1 className="mt-8 text-3xl font-bold tracking-tight">Who&apos;s working?</h1>
          <p className="muted mt-1 mb-6 text-sm">
            This is a {DEVICE_WHO[info.data.device.kind]?.name ?? "shared device"}: {DEVICE_WHO[info.data.device.kind]?.who ?? "staff"} can sign in here.
          </p>
          {info.data.staff.length === 0 && (
            <p className="rounded-2xl bg-warn/12 p-4 text-sm font-medium">
              Nobody can sign in here yet. The owner adds team members in Manage → Staff, each with their own PIN.
            </p>
          )}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {info.data.staff.map((s) => {
              const Icon = ROLE_ICON[s.role];
              return (
                <li key={s.id}>
                  <button
                    onClick={() => setPicked(s)}
                    className="surface line group flex h-36 w-full flex-col items-center justify-center gap-2 rounded-2xl border text-lg font-semibold shadow-soft transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-lift active:scale-95"
                  >
                    <span className="grid h-12 w-12 place-items-center rounded-full bg-brand/10 text-brand transition group-hover:bg-brand group-hover:text-brand-ink">
                      <Icon className="h-6 w-6" aria-hidden />
                    </span>
                    <span className="max-w-full truncate px-2">{s.name}</span>
                    <span className="muted -mt-1 text-xs font-medium capitalize">{s.role.toLowerCase()}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <Link href="/login/" className="muted mt-auto block pt-10 text-center text-sm font-medium hover:text-(--ink)">
            Sign in with email instead
          </Link>
        </>
      ) : (
        <div className="mx-auto mt-8 w-full max-w-xs text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-brand text-2xl font-bold text-brand-ink shadow-lift">{picked.name.slice(0, 1).toUpperCase()}</span>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Hi {picked.name}</h1>
          <p className="muted">Enter your PIN, then tap Enter</p>
          <div className="my-7 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={`h-3.5 w-3.5 rounded-full transition ${i < pin.length ? "scale-110 bg-brand" : "bg-(--line)"}`} />
            ))}
          </div>
          {error && (
            <p role="alert" className="mb-4 rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">
              {error}
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} variant="subtle" className="h-16 rounded-full text-2xl font-semibold" onClick={() => press(d)}>
                {d}
              </Button>
            ))}
            <Button variant="ghost" className="h-16 rounded-full text-sm" onClick={() => (setPicked(null), setPin(""), setError(null))}>
              Back
            </Button>
            <Button variant="subtle" className="h-16 rounded-full text-2xl font-semibold" onClick={() => press("0")}>
              0
            </Button>
            <Button variant="ghost" className="h-16 rounded-full" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}>
              <Delete className="h-6 w-6" aria-hidden />
            </Button>
          </div>
          <Button className="mt-5 h-14 w-full text-lg" disabled={pin.length < 4} onClick={() => void submit(pin)}>
            Enter
          </Button>
        </div>
      )}
    </main>
  );
}

/** A fresh device: type the 6-digit code from the owner's phone. Nobody signs in here to pair it. */
function NotPaired({ onPaired }: { onPaired: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", "/v1/auth/devices/claim", { code });
      onPaired();
    } catch (err) {
      setError(describeError(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <AuthAside />
      <main className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-(--ink) text-(--bg)">
            <MonitorSmartphone className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-6 text-3xl font-bold tracking-tight">Set up this device</h1>
          <p className="muted mt-2">
            On the owner&apos;s or a manager&apos;s phone, open <b className="text-(--ink)">Manage → Devices</b> and tap <b className="text-(--ink)">Get a pairing code</b>. Type
            the code here.
          </p>
          <form onSubmit={claim} className="mt-8 space-y-4" noValidate>
            <label htmlFor="pair-code" className="text-sm font-semibold">
              Pairing code
            </label>
            <input
              id="pair-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="000000"
              className="mt-2 text-center text-3xl font-bold tracking-[0.4em]"
              aria-invalid={Boolean(error)}
            />
            {error && (
              <p role="alert" className="rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">
                {error}
              </p>
            )}
            <Button type="submit" className="h-12 w-full" disabled={code.length !== 6 || busy}>
              {busy ? "Pairing…" : "Pair this device"}
            </Button>
          </form>
          <Link href="/login/" className="muted mt-8 block text-center text-sm font-medium hover:text-(--ink)">
            Owner or manager? Sign in with email
          </Link>
        </div>
      </main>
    </div>
  );
}
