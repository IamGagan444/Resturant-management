"use client";

import { Fragment, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { TableCodeResult } from "@rms/contracts";
import { TABLE_CODE_LENGTH, normalizeTableCode, tableCodeProblem } from "@rms/domain";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { ApiError, api } from "@/lib/api";
import { LangProvider, useI18n } from "@/lib/i18n";
import { Button, HeaderTools } from "./ui";

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
  const [focused, setFocused] = useState(false);
  const [shaking, setShaking] = useState(false);

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
      setShaking(true);
      return input.current?.focus();
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api<TableCodeResult>("POST", "/v1/p/table-code", { code: normalizeTableCode(code) });
      router.push(`/h/${encodeURIComponent(r.slug)}/t/${encodeURIComponent(r.qrToken)}`); // stays busy until the page opens
    } catch (err) {
      setBusy(false);
      // a 5xx here means the API behind the Next proxy is down or failing, not that the code is wrong
      if (!(err instanceof ApiError) || err.status >= 500) setError(t("codeOffline"));
      else if (err.status === 429) setError(t("codeTooMany"));
      else if (err.code === "TABLE_CODE_NOT_FOUND") setError(t("codeNotFound"));
      else setError(err.message);
      setShaking(true);
      input.current?.focus();
    }
  }

  const typed = normalizeTableCode(code);

  return (
    <main className="relative isolate mx-auto flex min-h-dvh max-w-md flex-col overflow-hidden px-6 pt-5 pb-8">
      {/* warm light behind the card; static, so it costs nothing */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[30rem] bg-[radial-gradient(60%_55%_at_50%_30%,color-mix(in_oklab,var(--color-brand)_18%,transparent),transparent_75%)]"
      />
      <div className="flex justify-end">
        <HeaderTools />
      </div>

      <div className="my-auto flex flex-col items-center py-6 text-center">
        <TableCard />
        <h1 className="font-display mt-9 text-3xl leading-tight font-bold text-balance">{t("scanTitle")}</h1>
        <p className="muted mt-3 max-w-xs text-pretty">{t("scanHint")}</p>

        <form onSubmit={submit} className="mt-9 flex w-full flex-col gap-3" noValidate>
          <div className="muted flex items-center gap-3" aria-hidden>
            <span className="line h-px flex-1 border-t" />
            <span className="h-1 w-1 rounded-full bg-current" />
            <span className="line h-px flex-1 border-t" />
          </div>
          <label htmlFor="table-code" className="mt-1 font-semibold">
            {t("cantScan")}
          </label>

          {/* Six boxes, grouped like the printed code (K7M-4QP). One real input sits on top, invisible, so the
              keyboard, paste, autofill and screen readers all work on a normal text field. */}
          <div className={`relative ${shaking ? "shake" : ""}`} onAnimationEnd={(e) => e.animationName === "shake" && setShaking(false)}>
            <div className="grid grid-cols-[1fr_1fr_1fr_auto_1fr_1fr_1fr] items-center gap-1.5 min-[380px]:gap-2" aria-hidden>
              {Array.from({ length: TABLE_CODE_LENGTH }, (_, i) => {
                const ch = typed[i];
                const active = focused && !ch && i === typed.length;
                return (
                  <Fragment key={i}>
                    {i === 3 && <span className="muted px-0.5 text-xl font-bold">-</span>}
                    <span
                      className={`grid h-15 place-items-center rounded-2xl border-2 text-2xl font-bold transition-colors duration-150 ${
                        error
                          ? "border-late/70 bg-late/5"
                          : active
                            ? "border-brand bg-(--surface)"
                            : ch
                              ? "line surface shadow-soft"
                              : "line bg-(--sunken)"
                      }`}
                    >
                      {ch ? (
                        <span key={`${i}${ch}`} className="cell-in">
                          {ch}
                        </span>
                      ) : active ? (
                        <span className="caret h-7 w-0.5 rounded-full bg-brand" />
                      ) : null}
                    </span>
                  </Fragment>
                );
              })}
            </div>
            <input
              ref={input}
              id="table-code"
              value={code}
              onChange={(e) => change(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={12}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "table-code-error" : "table-code-help"}
              className="absolute inset-0 h-full w-full cursor-text rounded-2xl border-0 bg-transparent text-base text-transparent caret-transparent opacity-0 focus:shadow-none"
            />
          </div>

          {error ? (
            <p id="table-code-error" role="alert" className="text-sm font-medium text-balance text-late">
              <AlertCircle className="mr-1.5 inline h-4 w-4 align-[-3px]" aria-hidden />
              {error}
            </p>
          ) : (
            <p id="table-code-help" className="muted text-sm">
              {t("tableCodeHelp")}
            </p>
          )}
          <Button type="submit" disabled={busy} className="group mt-2 h-14 text-base font-semibold">
            {busy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                {t("checking")}
              </>
            ) : (
              <>
                {t("openMenu")}
                <ArrowRight className="h-5 w-5 transition-transform duration-200 group-active:translate-x-0.5" aria-hidden />
              </>
            )}
          </Button>
        </form>
      </div>
    </main>
  );
}

const CORNERS = [
  "top-0 left-0 rounded-tl-lg border-t-[3px] border-l-[3px]",
  "top-0 right-0 rounded-tr-lg border-t-[3px] border-r-[3px]",
  "bottom-0 left-0 rounded-bl-lg border-b-[3px] border-l-[3px]",
  "bottom-0 right-0 rounded-br-lg border-r-[3px] border-b-[3px]",
];

/**
 * The printed card guests are looking for, drawn: QR on top, the code underneath. It shows *where* the code is
 * without another sentence to translate. Always white, like the paper on the table, in both themes.
 */
function TableCard() {
  return (
    <div className="relative" aria-hidden>
      <div className="absolute inset-4 -z-10 translate-y-4 rounded-[28px] bg-brand/30 blur-2xl" />
      <div className="flex w-44 -rotate-3 flex-col items-center gap-3 rounded-[28px] bg-white p-4 pb-3.5 text-[#1e2a36] shadow-lift ring-1 ring-black/5">
        <div className="relative p-2">
          {CORNERS.map((c) => (
            <span key={c} className={`absolute h-5 w-5 border-brand ${c}`} />
          ))}
          <QrGlyph className="h-28 w-28" />
          <span
            className="scan-line absolute inset-x-1 top-2 h-0.5 rounded-full bg-brand shadow-[0_0_12px_2px_var(--color-brand)]"
            style={{ "--scan-travel": "110px" } as CSSProperties}
          />
        </div>
        <span className="rounded-lg bg-[#1e2a36]/6 px-2.5 py-1 font-mono text-[15px] font-bold tracking-[0.18em]">K7M-4QP</span>
      </div>
    </div>
  );
}

/** A QR-shaped pattern: three finder squares plus fixed noise. Decorative; it encodes nothing. */
const QR_N = 21;
const QR_PATH = (() => {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const finder = (x: number, y: number) => x < 8 && y < 8;
  const inFinder = (x: number, y: number) => finder(x, y) || finder(QR_N - 1 - x, y) || finder(x, QR_N - 1 - y);
  let d = "";
  for (let y = 0; y < QR_N; y++) for (let x = 0; x < QR_N; x++) if (!inFinder(x, y) && rnd() > 0.52) d += `M${x} ${y}h1v1h-1z`;
  for (const [fx, fy] of [
    [0, 0],
    [QR_N - 7, 0],
    [0, QR_N - 7],
  ] as const)
    d += `M${fx} ${fy}h7v7h-7zM${fx + 1} ${fy + 1}v5h5v-5zM${fx + 2} ${fy + 2}h3v3h-3z`;
  return d;
})();

function QrGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox={`0 0 ${QR_N} ${QR_N}`} className={className} shapeRendering="crispEdges">
      <path d={QR_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
