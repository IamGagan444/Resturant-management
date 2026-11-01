"use client";

import { useState } from "react";
import type { SessionView, TableLookup } from "@rms/contracts";
import { ApiError, api, deviceId } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { UtensilsCrossed } from "lucide-react";
import { Button, LangPicker } from "./ui";

export interface Joined {
  session: SessionView;
  guestToken: string;
}

export function Join({ lookup, qrToken, onJoined }: { lookup: TableLookup; qrToken: string; onJoined: (j: Joined) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("rms.name") ?? "";
    } catch {
      return "";
    }
  });
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [needCode, setNeedCode] = useState(lookup.hasOpenSession);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phoneError, setPhoneError] = useState(false);
  // same rule as the API (contracts Phone), without shipping zod to guests' phones
  const phoneOk = (p: string) => !p.trim() || /^\+?\d{10,15}$/.test(p.replace(/[\s\-()]/g, ""));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!phoneOk(phone)) return setPhoneError(true);
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("rms.name", name.trim());
      const j = await api<Joined>("POST", "/v1/p/sessions/join", {
        qrToken,
        deviceId: deviceId(),
        name: name.trim(),
        phone: phone.trim() ? phone.trim().replace(/\s/g, "") : undefined,
        joinCode: needCode ? code : undefined,
      });
      onJoined(j);
    } catch (err) {
      if (err instanceof ApiError && err.code === "JOIN_CODE_REQUIRED") setNeedCode(true);
      setError(err instanceof Error ? err.message : t("couldNotJoin"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-5 pb-8">
      <div className="flex justify-end">
        <LangPicker />
      </div>
      <div className="my-auto py-8">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-brand-ink">
          <UtensilsCrossed className="h-7 w-7" aria-hidden />
        </span>
        <p className="font-display mt-6 text-3xl leading-tight font-bold">{lookup.hotel.name}</p>
        <h1 className="mt-2 inline-flex rounded-full bg-brand/10 px-3 py-1 text-sm font-bold text-brand">{t("table", { label: lookup.table.label })}</h1>
        <p className="muted mt-4">{needCode ? t("needCodePrompt") : t("startOrderingPrompt")}</p>
      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            {t("yourName")}
            <span className="ml-0.5 text-red-600" aria-hidden>
              *
            </span>
          </span>
          <input
            required
            maxLength={40}
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="tap rounded-lg border border-transparent bg-(--sunken) px-4 text-base"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">
            {t("phone")} <span className="muted font-normal">{t("phoneHint")}</span>
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => (setPhone(e.target.value), setPhoneError(false))}
            onBlur={() => setPhoneError(!phoneOk(phone))}
            aria-invalid={phoneError || undefined}
            aria-describedby={phoneError ? "phone-error" : undefined}
            className={`tap rounded-lg border bg-(--sunken) px-4 text-base ${phoneError ? "border-red-500" : "border-transparent"}`}
          />
          {phoneError && (
            <span id="phone-error" role="alert" className="text-xs font-medium text-red-600">
              {t("invalidPhone")}
            </span>
          )}
        </label>
        {needCode && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">
              {t("tableCode")}
              <span className="ml-0.5 text-red-600" aria-hidden>
                *
              </span>
            </span>
            <input
              required
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="tap h-16 rounded-lg border border-transparent bg-(--sunken) px-4 text-center text-3xl font-bold tracking-[0.5em]"
              aria-describedby="code-help"
            />
            <span id="code-help" className="muted text-xs">
              {t("codeHelp")}
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="rounded-2xl bg-red-500/10 p-3 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !name.trim()} className="mt-2 h-14 text-base">
          {busy ? t("joining") : needCode ? t("joinTable") : t("startOrdering")}
        </Button>
      </form>
      </div>
    </main>
  );
}
