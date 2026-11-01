"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import type { z } from "zod";
import { describeError, fieldErrorsOf } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";

type Values = Record<string, unknown>;

/**
 * Small form state + validation, using the same zod schemas the API uses (from @rms/contracts).
 * - Raw inputs live in `values` (strings/booleans); `build` turns them into the API body.
 * - Errors are keyed by the schema path ("owner.email"), so keep value keys equal to those paths.
 * - A field shows its error after it was left once, or after a submit attempt.
 * - Server-side VALIDATION errors land on the same fields; anything else becomes `formError`.
 */
export function useForm<V extends Values, S extends z.ZodTypeAny>(opts: { initial: V; schema: S; build: (v: V) => unknown }) {
  const [values, setValues] = useState<V>(opts.initial);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const result = opts.schema.safeParse(opts.build(values));
  const errors: Record<string, string> = { ...serverErrors };
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join(".");
      errors[key] ??= issue.message;
    }
  }

  const error = (key: string) => (touched[key] || submitted ? errors[key] : undefined);

  function set<K extends keyof V>(key: K, value: V[K]) {
    setValues((cur) => ({ ...cur, [key]: value }));
    setServerErrors((cur) => {
      if (!(key as string in cur)) return cur;
      const { [key as string]: _drop, ...rest } = cur;
      return rest;
    });
  }

  /** Props for a text-like <input>/<textarea>. */
  function text(key: keyof V & string) {
    return {
      name: key,
      value: String(values[key] ?? ""),
      onChange: (e: { target: { value: string } }) => set(key, e.target.value as V[typeof key]),
      onBlur: () => setTouched((t) => ({ ...t, [key]: true })),
      "aria-invalid": error(key) ? true : undefined,
    };
  }

  function submit(fn: (body: z.infer<S>) => Promise<void>) {
    return async (e?: FormEvent) => {
      e?.preventDefault();
      setSubmitted(true);
      setFormError(null);
      if (!result.success) {
        setFormError("Some details need fixing. Check the highlighted fields.");
        return;
      }
      setBusy(true);
      try {
        await fn(result.data);
      } catch (err) {
        const fields = fieldErrorsOf(err);
        setServerErrors(fields);
        setFormError(describeError(err));
      } finally {
        setBusy(false);
      }
    };
  }

  /** Wizards: show the errors of these fields now; true when they are all valid. */
  function check(keys: string[]): boolean {
    setTouched((t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }));
    return keys.every((k) => !errors[k]);
  }

  function reset(next: V = opts.initial) {
    setValues(next);
    setTouched({});
    setSubmitted(false);
    setServerErrors({});
    setFormError(null);
  }

  return { values, set, text, error, check, submit, reset, busy, formError, valid: result.success, setFormError };
}

/** Label (with * when required), the control, then either the error or the hint. */
export function Field({
  label,
  required = false,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5 text-sm", className)}>
      <span className="font-medium text-(--ink)">
        {label}
        {required && (
          <span className="ml-0.5 text-late" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-xs font-medium text-late">
          {error}
        </span>
      ) : (
        hint && <span className="muted text-xs">{hint}</span>
      )}
    </label>
  );
}

/** Banner for errors that don't belong to one field. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-late/10 px-3.5 py-3 text-sm font-medium text-late">
      {message}
    </p>
  );
}

const NONE = "__none__"; // Radix Select items can't have an empty value

/** shadcn Select for a plain value + options list. `""` means nothing chosen (shown with `placeholder`/`emptyLabel`). */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  emptyLabel,
  invalid,
  label,
  className,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  /** offer an explicit "none" choice with this label */
  emptyLabel?: string;
  invalid?: boolean;
  /** accessible name when there is no visible <Field> label around it */
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value === "" ? (emptyLabel ? NONE : undefined) : value} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
      <SelectTrigger aria-label={label} aria-invalid={invalid || undefined} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {emptyLabel && <SelectItem value={NONE}>{emptyLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Optional text → null when blank (for nullable API fields). */
export const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
