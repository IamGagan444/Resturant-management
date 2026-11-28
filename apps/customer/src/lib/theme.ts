import { useSyncExternalStore } from "react";
import { DARK_MQ, THEME_KEY as KEY } from "./theme-script";

/**
 * Light / dark / system theme.
 *
 * - The choice lives in localStorage ("rms.theme"), so it survives reloads and holds on every screen.
 * - THEME_SCRIPT (theme-script.ts) runs in <head> before the first paint and puts `.dark` or `.light` on <html>: no flash of the
 *   wrong theme, and React never renders theme-dependent markup on the server, so nothing mismatches on hydration.
 * - "system" follows the OS live (matchMedia), and a change in another tab is picked up through the storage event.
 * - A screen can pin a theme while it's open (the kitchen display is always dark) and hand it back on unmount.
 */
export type ThemePref = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

/** The status bar matches the page canvas (the guest header sits on --bg). */
const META_VAR = "--bg";

const isPref = (v: unknown): v is ThemePref => v === "light" || v === "dark" || v === "system";

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return isPref(v) ? v : "system";
  } catch {
    return "system";
  }
}

let pref: ThemePref | null = null;
let pinned: Resolved | null = null;
let started = false;
const listeners = new Set<() => void>();

const systemDark = () => typeof window !== "undefined" && window.matchMedia(DARK_MQ).matches;
const currentPref = () => (pref ??= readPref());
const resolve = (): Resolved => pinned ?? (currentPref() === "system" ? (systemDark() ? "dark" : "light") : (currentPref() as Resolved));

function apply() {
  const dark = resolve() === "dark";
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.classList.toggle("light", !dark);
  root.style.colorScheme = dark ? "dark" : "light";
  const color = getComputedStyle(root).getPropertyValue(META_VAR).trim();
  if (color) document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => (m.content = color));
}

const emit = () => listeners.forEach((l) => l());

/** Cross-fade between themes where the browser can (View Transitions); instant otherwise or with reduced motion. */
function withTransition(fn: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return fn();
  doc.startViewTransition(fn);
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.matchMedia(DARK_MQ).addEventListener("change", () => {
    if (currentPref() === "system") apply();
    emit();
  });
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    pref = isPref(e.newValue) ? e.newValue : "system";
    apply();
    emit();
  });
  apply(); // the head script set the class; this syncs the status-bar colour
}

export function setTheme(next: ThemePref) {
  pref = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  withTransition(apply);
  emit();
}

/** Force a theme while a screen is mounted. Returns the undo. */
export function pinTheme(theme: Resolved) {
  pinned = theme;
  apply();
  emit();
  return () => {
    pinned = null;
    apply();
    emit();
  };
}

function subscribe(cb: () => void) {
  start();
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

const snapshot = () => `${currentPref()}|${resolve()}|${pinned ? 1 : 0}`;
const serverSnapshot = () => "system|light|0";

export function useTheme() {
  const [p, r, pin] = useSyncExternalStore(subscribe, snapshot, serverSnapshot).split("|") as [ThemePref, Resolved, string];
  return { pref: p, resolved: r, pinned: pin === "1", setTheme };
}
