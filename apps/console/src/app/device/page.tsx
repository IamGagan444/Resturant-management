"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Me, StaffRole } from "@rms/contracts";
import { ApiError, api } from "@/lib/api";
import { homeFor } from "@/lib/auth";
import { Button } from "@/components/ui";

interface DeviceInfo {
  device: { id: string; name: string; kind: string; stationId: string | null };
  hotel: { id: string; name: string };
  staff: { id: string; name: string; role: StaffRole }[];
}

const ROLE_ICON: Record<StaffRole, string> = { OWNER: "👑", MANAGER: "🧑‍💼", CASHIER: "💳", COOK: "👨‍🍳", WAITER: "🛎️" };

/** Shared tablet/phone: tap your face, type your PIN. Two steps, no typing of phone numbers. */
export default function DevicePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ["device"], queryFn: () => api<DeviceInfo>("GET", "/v1/auth/device"), retry: false });
  const [picked, setPicked] = useState<DeviceInfo["staff"][number] | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(p: string) {
    if (!picked) return;
    setError(null);
    try {
      await api("POST", "/v1/auth/pin", { staffId: picked.id, pin: p });
      const me = await api<Me>("GET", "/v1/auth/me");
      qc.setQueryData(["me"], me);
      router.replace(homeFor(me));
    } catch (e) {
      setPin("");
      setError(e instanceof Error ? e.message : "Wrong PIN");
    }
  }

  function press(d: string) {
    const next = (pin + d).slice(0, 6);
    setPin(next);
    // Auto-submit only at the max length; guessing at 4 would burn lockout attempts for 6-digit PINs.
    if (next.length === 6) void submit(next);
  }

  if (info.isLoading) return <p className="muted p-8 text-center">Loading…</p>;
  if (info.error instanceof ApiError && info.error.code === "DEVICE_NOT_PAIRED") {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-6 text-center">
        <div className="text-5xl" aria-hidden>
          📟
        </div>
        <h1 className="text-xl font-bold">This device isn&apos;t set up yet</h1>
        <p className="muted">A manager signs in once here and pairs it as a kitchen screen, waiter phone or counter.</p>
        <Link href="/login/" className="tap bg-brand flex items-center justify-center rounded-xl font-semibold text-white">
          Manager sign in
        </Link>
      </main>
    );
  }
  if (!info.data) return <p className="p-8 text-center text-late">Could not reach the server. Retrying…</p>;

  return (
    <main className="mx-auto max-w-2xl p-6">
      <p className="muted text-sm">
        {info.data.hotel.name} · {info.data.device.name}
      </p>
      {!picked ? (
        <>
          <h1 className="mt-1 mb-6 text-2xl font-bold">Who&apos;s working?</h1>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {info.data.staff.map((s) => (
              <li key={s.id}>
                <button onClick={() => setPicked(s)} className="surface line flex h-32 w-full flex-col items-center justify-center gap-2 rounded-2xl border text-lg font-semibold active:scale-95">
                  <span className="text-4xl" aria-hidden>
                    {ROLE_ICON[s.role]}
                  </span>
                  {s.name}
                  <span className="muted text-xs font-normal">{s.role.toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/login/" className="muted mt-8 block text-center text-sm underline">
            Sign in with email instead
          </Link>
        </>
      ) : (
        <div className="mx-auto max-w-xs text-center">
          <h1 className="mt-1 text-2xl font-bold">Hi {picked.name}</h1>
          <p className="muted">Enter your PIN</p>
          <div className="my-6 flex justify-center gap-3" aria-label={`${pin.length} digits entered`}>
            {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
              <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? "bg-brand" : "bg-stone-300 dark:bg-stone-700"}`} />
            ))}
          </div>
          {error && (
            <p role="alert" className="mb-3 text-late">
              {error}
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Button key={d} variant="outline" className="h-16 text-2xl" onClick={() => press(d)}>
                {d}
              </Button>
            ))}
            <Button variant="ghost" className="h-16" onClick={() => (setPicked(null), setPin(""), setError(null))}>
              Back
            </Button>
            <Button variant="outline" className="h-16 text-2xl" onClick={() => press("0")}>
              0
            </Button>
            <Button variant="ghost" className="h-16 text-2xl" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))}>
              ⌫
            </Button>
          </div>
          <Button className="mt-3 h-16 w-full text-xl" disabled={pin.length < 4} onClick={() => void submit(pin)}>
            Enter
          </Button>
        </div>
      )}
    </main>
  );
}
