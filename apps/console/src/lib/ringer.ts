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

/** Time between bursts while an order waits: short, so it feels like an incoming delivery-partner order. */
export const RING_EVERY_MS = 1400;

/**
 * One urgent burst, "ti-ti-ti-ti ti-ti-ti-ti": eight fast, bright beeps alternating between two high notes
 * (G6 / D6), like a delivery rider app's incoming-order alarm. A square wave through a low-pass filter cuts through
 * kitchen noise without sounding harsh. Synthesized, so there is nothing to download.
 * Phones vibrate in step (Android; iPhones' browsers have no vibration API).
 */
export function ring() {
  // four quick buzzes in step with the beeps, then one long one
  buzz([180, 60, 180, 60, 180, 60, 180, 60, 400]);
  if (!ctx || ctx.state !== "running") return;
  const out = ctx.createGain();
  out.gain.value = 0.3;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3800;
  tone.connect(out).connect(ctx.destination);

  const BEEP = 0.075;
  const GAP = 0.035;
  const notes = [1568, 1175];
  for (let i = 0; i < 8; i++) {
    // a slightly longer breath between the two groups of four
    const t = ctx.currentTime + 0.01 + i * (BEEP + GAP) + (i >= 4 ? 0.12 : 0);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(1, t + 0.005);
    env.gain.setValueAtTime(1, t + BEEP - 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + BEEP);
    env.connect(tone);
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = notes[i % 2]!;
    o.connect(env);
    o.start(t);
    o.stop(t + BEEP + 0.01);
  }
}

/**
 * Keeps ringing every few seconds while `active` (e.g. a new ticket nobody started), like a delivery app's
 * incoming-order alarm. `snooze()` silences it for a while; a *new* reason to ring ends the snooze early.
 */
export function useRinger(active: boolean, reasonKey: string, everyMs = RING_EVERY_MS) {
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
