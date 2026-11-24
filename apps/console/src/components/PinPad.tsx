"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Delete } from "lucide-react";

/**
 * Fixed-length PIN keypad that also takes a physical keyboard. Built to keep up with fast typing:
 * keys act on press (not release), a ref holds the digits so none are lost between renders, only this
 * component re-renders, and presses show without a fade. The last digit submits; extra digits are ignored.
 * `onSubmit` returns true when signed in (the pad stays locked) or false to clear and try again.
 */
export function PinPad({ length, error, onSubmit, onEdit, onBack }: {
  length: number;
  error: string | null;
  onSubmit: (pin: string) => Promise<boolean>;
  onEdit: () => void;
  onBack: () => void;
}) {
  const digits = useRef("");
  const locked = useRef(false);
  const [count, setCount] = useState(0);
  const [checking, setChecking] = useState(false);

  function update(next: string) {
    digits.current = next;
    setCount(next.length);
  }

  async function submit() {
    locked.current = true;
    setChecking(true);
    const done = await onSubmit(digits.current);
    if (done) return; // leaving the page
    locked.current = false;
    setChecking(false);
    update("");
  }

  function press(d: string) {
    if (locked.current || digits.current.length >= length) return;
    if (error) onEdit();
    update(digits.current + d);
    if (digits.current.length === length) void submit();
  }

  function erase() {
    if (!locked.current) update(digits.current.slice(0, -1));
  }

  function back() {
    if (!locked.current) onBack();
  }

  const keys = useRef({ press, erase, back });
  keys.current = { press, erase, back };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const digit = /^\d$/.test(e.key);
      if (!digit && e.key !== "Backspace" && e.key !== "Escape") return;
      e.preventDefault();
      if (e.repeat && e.key !== "Backspace") return; // a held digit counts once
      if (digit) keys.current.press(e.key);
      else if (e.key === "Backspace") keys.current.erase();
      else keys.current.back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const digitKey = (d: string) => (
    <Key key={d} className="bg-(--sunken) text-2xl" onPress={() => press(d)}>
      {d}
    </Key>
  );

  return (
    <>
      <div role="status" className="my-7 flex justify-center gap-3" aria-label={checking ? "Checking PIN" : `${count} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={`h-3.5 w-3.5 rounded-full ${i < count ? "scale-110 bg-brand" : "bg-(--line)"} ${checking ? "animate-pulse" : ""}`} />
        ))}
      </div>
      {error && (
        <p role="alert" className="mb-4 rounded-lg bg-late/10 px-3 py-2 text-sm font-medium text-late">
          {error}
        </p>
      )}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(digitKey)}
        {/* Back acts on release: on press, the same tap could land on the list that replaces the pad */}
        <button type="button" className={`${KEY} text-sm`} onClick={back}>
          Back
        </button>
        {digitKey("0")}
        <Key label="Delete" onPress={erase}>
          <Delete className="h-6 w-6" aria-hidden />
        </Key>
      </div>
    </>
  );
}

// touch-manipulation: no double-tap zoom, so fast repeat taps register at once
const KEY = "grid h-16 touch-manipulation place-items-center rounded-full font-semibold select-none active:bg-(--line)";

function Key({ label, className = "", onPress, children }: { label?: string; className?: string; onPress: () => void; children: ReactNode }) {
  const pressed = useRef(false); // already handled on pointerdown: skip the click that follows
  return (
    <button
      type="button"
      aria-label={label}
      className={`${KEY} ${className}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        pressed.current = true;
        onPress();
      }}
      onClick={() => {
        // keyboard and screen-reader activation clicks without a pointer press
        if (!pressed.current) onPress();
        pressed.current = false;
      }}
    >
      {children}
    </button>
  );
}
