"use client";

import { useState } from "react";
import type { SessionView, TableLookup } from "@rms/contracts";
import { ApiError, api, deviceId } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center p-6">
      <div className="flex items-center justify-between gap-2">
        <p className="muted text-sm">{lookup.hotel.name}</p>
        <LangPicker />
      </div>
      <h1 className="mt-1 text-2xl font-bold">{t("table", { label: lookup.table.label })}</h1>
      <p className="muted mt-2">
        {needCode ? t("needCodePrompt") : t("startOrderingPrompt")}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{t("yourName")}</span>
          <input
            required
            maxLength={40}
            autoComplete="given-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="tap surface line rounded-xl border px-4 text-base"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">
            {t("phone")} <span className="muted font-normal">{t("phoneHint")}</span>
          </span>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="tap surface line rounded-xl border px-4 text-base"
          />
        </label>
        {needCode && (
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t("tableCode")}</span>
            <input
              required
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="tap surface line rounded-xl border px-4 text-center text-2xl tracking-[0.5em]"
              aria-describedby="code-help"
            />
            <span id="code-help" className="muted text-xs">
              {t("codeHelp")}
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || !name.trim()} className="mt-2 text-lg">
          {busy ? t("joining") : needCode ? t("joinTable") : t("startOrdering")}
        </Button>
      </form>
    </main>
  );
}
