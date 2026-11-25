"use client";

import { useSyncExternalStore } from "react";

/**
 * In-app sound: one audio context, and one on/off choice kept on this device until someone changes it (on by default).
 * Browsers also need one tap after each launch before they play anything; `soundReady` says whether that happened.
 */
const KEY = "rms:sound";
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

let ctx: AudioContext | null = null;
let enabled: boolean | null = null;

export function soundEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: kept until the app closes
  }
  if (on) unlockSound();
  changed();
}

/** Call from a tap. iPhones suspend audio on calls, lock and app switches, so every tap wakes it again. */
export function unlockSound() {
  if (!ctx) {
    ctx = new AudioContext();
    ctx.addEventListener("statechange", changed);
    // iPhone: play like media, so the Ring/Silent switch doesn't mute the in-app ring
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = "playback";
      } catch {
        // older iOS: the default session
      }
    }
  }
  if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
}

/** The context to play on, or null when sound is off or the browser hasn't allowed it yet. */
export function audioOut(): AudioContext | null {
  if (!soundEnabled() || !ctx) return null;
  if (ctx.state !== "running") {
    void ctx.resume().catch(() => undefined);
    return null;
  }
  return ctx;
}

export const soundReady = () => ctx?.state === "running";

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function useSound() {
  const on = useSyncExternalStore(subscribe, soundEnabled, () => true);
  const ready = useSyncExternalStore(subscribe, soundReady, () => false);
  return { on, ready };
}

/** Wake sound on taps anywhere, for as long as the screen is open. */
export function unlockOnTap() {
  const wake = () => soundEnabled() && unlockSound();
  // iOS counts touchend/click, not pointerdown, as the tap that allows sound
  const events = ["pointerdown", "touchend", "click", "keydown"] as const;
  for (const e of events) window.addEventListener(e, wake);
  return () => {
    for (const e of events) window.removeEventListener(e, wake);
  };
}

/**
 * The service worker asks before it silences a phone alert. Only a screen that is really in front answers:
 * a page frozen in the background can't, whatever the browser reports about it.
 */
export function answerAlertChecks() {
  if (!("serviceWorker" in navigator)) return () => undefined;
  const onMessage = (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type !== "alert-check") return;
    const inFront = document.visibilityState === "visible" && document.hasFocus();
    e.ports[0]?.postMessage({ handled: inFront && (!soundEnabled() || soundReady()) });
  };
  navigator.serviceWorker.addEventListener("message", onMessage);
  navigator.serviceWorker.startMessages?.();
  return () => navigator.serviceWorker.removeEventListener("message", onMessage);
}
