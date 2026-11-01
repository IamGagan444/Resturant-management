"use client";

import { useEffect, useState } from "react";
import { buzz, unlockSound } from "./realtime";

let ctx: AudioContext | null = null;

/** Browsers only play sound after a tap; unlock on the first tap anywhere so nobody has to find a button. */
export function unlockOnFirstTap() {
  const once = () => {
    unlockSound();
    ctx ??= new AudioContext();
    void ctx.resume();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
  return () => {
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
}

export const soundReady = () => ctx?.state === "running";

/**
 * One "trrring trrring": the classic 440 + 480 Hz phone ring, chopped at 20 Hz so it buzzes like a vibrating
 * phone. Synthesized, so there is nothing to download. Phones also vibrate.
 */
export function ring() {
  buzz([350, 120, 350, 120, 350]);
  if (!ctx || ctx.state !== "running") return;
  const out = ctx.createGain();
  out.gain.value = 0.22;
  out.connect(ctx.destination);
  for (const start of [0, 0.55]) {
    const t = ctx.currentTime + start;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.02);
    env.gain.setValueAtTime(1, t + 0.38);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    // tremolo: a 20 Hz square wave on the volume makes the "brrr"
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 20;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(trem.gain);
    for (const f of [440, 480]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(trem);
      o.start(t);
      o.stop(t + 0.43);
    }
    trem.connect(env).connect(out);
    lfo.start(t);
    lfo.stop(t + 0.43);
  }
}

/**
 * Keeps ringing every few seconds while `active` (e.g. a new ticket nobody started), like a delivery app's
 * incoming-order alarm. `snooze()` silences it for a while; a *new* reason to ring ends the snooze early.
 */
export function useRinger(active: boolean, reasonKey: string, everyMs = 3500) {
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [snoozedKey, setSnoozedKey] = useState("");
  const [, tick] = useState(0);
  const snoozed = Date.now() < snoozedUntil && snoozedKey === reasonKey;
  const ringing = active && !snoozed;

  useEffect(() => {
    if (!ringing) return;
    ring();
    const t = setInterval(ring, everyMs);
    return () => clearInterval(t);
  }, [ringing, everyMs]);

  // re-check when the snooze runs out
  useEffect(() => {
    if (!snoozed) return;
    const t = setTimeout(() => tick((n) => n + 1), snoozedUntil - Date.now() + 50);
    return () => clearTimeout(t);
  }, [snoozed, snoozedUntil]);

  return {
    ringing,
    snooze: (ms = 60_000) => {
      setSnoozedUntil(Date.now() + ms);
      setSnoozedKey(reasonKey);
    },
  };
}
