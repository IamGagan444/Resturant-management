"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TableCodeResult } from "@rms/contracts";
import { TABLE_CODE_LENGTH, normalizeTableCode, tableCodeProblem } from "@rms/domain";
import { QrCode } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { LangProvider, useI18n } from "@/lib/i18n";
import { Button, LangPicker } from "./ui";

/** No QR scanned yet: scan it, or type the code printed under it. */
export function Home() {
  return (
    <LangProvider fallback="en">
      <Inner />
    </LangProvider>
  );
}

function Inner() {
  const { t } = useI18n();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function problemText(typed: string): string | null {
    switch (tableCodeProblem(typed)) {
      case "EMPTY":
        return t("codeEmpty");
      case "BAD_CHARACTER":
        return t("codeBadChar");
      case "TOO_SHORT":
        return t("codeShort", { n: TABLE_CODE_LENGTH - normalizeTableCode(typed).length });
      case "TOO_LONG":
        return t("codeLong");
      default:
        return null;
    }
  }

  function change(typed: string) {
    setCode(typed.toUpperCase());
    // a wrong character shows at once; "too short" only after Open menu, as it's always short while typing
    const p = tableCodeProblem(typed);
    setError(p === "BAD_CHARACTER" || p === "TOO_LONG" ? problemText(typed) : null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = problemText(code);
    if (problem) {
      setError(problem);
      return input.current?.focus();
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<TableCodeResult>("POST", "/v1/p/table-code", { code: normalizeTableCode(code) });
      router.push(`/h/${encodeURIComponent(r.slug)}/t/${encodeURIComponent(r.qrToken)}`); // stays busy until the page opens
    } catch (err) {
      setBusy(false);
      if (!(err instanceof ApiError)) setError(t("codeOffline"));
      else if (err.status === 429) setError(t("codeTooMany"));
      else if (err.code === "TABLE_CODE_NOT_FOUND") setError(t("codeNotFound"));
      else setError(err.message);
      input.current?.focus();
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pt-5 pb-8">
      <div className="flex justify-end">
        <LangPicker />
      </div>
      <div className="my-auto flex flex-col items-center py-8 text-center">
        <span className="grid h-20 w-20 place-items-center rounded-3xl bg-brand text-brand-ink">
          <QrCode className="h-10 w-10" aria-hidden />
        </span>
        <h1 className="font-display mt-6 text-3xl leading-tight font-bold">{t("scanTitle")}</h1>
        <p className="muted mt-3 max-w-xs">{t("scanHint")}</p>

        <form onSubmit={submit} className="line mt-8 flex w-full flex-col gap-3 border-t pt-8" noValidate>
          <label htmlFor="table-code" className="font-semibold">
            {t("cantScan")}
          </label>
          <input
            ref={input}
            id="table-code"
            value={code}
            onChange={(e) => change(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={12}
            placeholder="ABC-234"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "table-code-error" : "table-code-help"}
            className={`h-16 w-full rounded-2xl border bg-(--sunken) px-4 text-center text-2xl font-bold tracking-[0.2em] ${error ? "border-red-500" : "border-transparent"}`}
          />
          {error ? (
            <p id="table-code-error" role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          ) : (
            <p id="table-code-help" className="muted text-sm">
              {t("tableCodeHelp")}
            </p>
          )}
          <Button type="submit" disabled={busy} className="mt-1 h-14 text-base">
            {busy ? t("checking") : t("openMenu")}
          </Button>
        </form>
      </div>
    </main>
  );
}
