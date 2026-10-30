"use client";

import { useSyncExternalStore } from "react";
import type { HubHealth, HubPass } from "@rms/contracts";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Where this device's requests go:
 *   cloud    normal operation
 *   hub      internet is down but the restaurant's local hub answers on the Wi-Fi
 *   offline  nothing answers: actions wait in this device's queue
 * A failed request triggers a probe; while not on the cloud we re-probe every few seconds and switch back on our own.
 */
export type Mode = "cloud" | "hub" | "offline";

interface NetState {
  mode: Mode;
  pending: number;
}

const HUB_KEY = "rms.hub";
const PROBE_EVERY_MS = 8_000;
const PROBE_TIMEOUT_MS = 2_500;

let state: NetState = { mode: "cloud", pending: 0 };
const listeners = new Set<() => void>();
const modeListeners = new Set<(m: Mode) => void>();

function set(next: Partial<NetState>) {
  const prev = state.mode;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
  if (next.mode && next.mode !== prev) modeListeners.forEach((l) => l(state.mode));
}

export const getMode = () => state.mode;
export const setPending = (pending: number) => pending !== state.pending && set({ pending });
export function onModeChange(fn: (m: Mode) => void) {
  modeListeners.add(fn);
  return () => void modeListeners.delete(fn);
}

const serverState: NetState = { mode: "cloud", pending: 0 };
/** React: re-render on mode / pending changes. */
export function useNet(): NetState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => void listeners.delete(l)),
    () => state,
    () => serverState,
  );
}

// ── Hub pass (fetched while online, used during an outage) ──

export function savedHub(): HubPass | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const h = JSON.parse(localStorage.getItem(HUB_KEY) ?? "null") as HubPass | null;
    return h?.hubUrl && h.pass && h.expiresAt && new Date(h.expiresAt) > new Date() ? h : null;
  } catch {
    return null;
  }
}

export function saveHub(h: HubPass | null) {
  try {
    if (h?.pass) localStorage.setItem(HUB_KEY, JSON.stringify(h));
    else localStorage.removeItem(HUB_KEY);
  } catch {
    // storage blocked: the device just won't have the hub fallback
  }
}

/** Base URL and auth for the current mode. */
export function target(): { base: string; headers: Record<string, string>; credentials: RequestCredentials } {
  const hub = state.mode === "hub" ? savedHub() : null;
  if (hub?.hubUrl && hub.pass) return { base: hub.hubUrl.replace(/\/$/, ""), headers: { authorization: `Bearer ${hub.pass}` }, credentials: "omit" };
  return { base: API_URL, headers: {}, credentials: "include" };
}

async function reachable(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

let probing: Promise<Mode> | null = null;

/** Work out where requests should go right now. */
export function probe(): Promise<Mode> {
  probing ??= (async (): Promise<Mode> => {
    if (await reachable(`${API_URL}/health`)) return "cloud";
    const hub = savedHub();
    if (hub?.hubUrl) {
      const res = await reachable(`${hub.hubUrl.replace(/\/$/, "")}/hub/health`);
      const health = res ? ((await res.json().catch(() => null)) as HubHealth | null) : null;
      if (health?.hotelId === hub.hotelId) return "hub";
    }
    return "offline";
  })()
    .then((mode) => {
      set({ mode });
      return mode;
    })
    .finally(() => {
      probing = null;
    });
  return probing;
}

/** Called by the API client when a request couldn't reach its server at all. */
export function reportUnreachable() {
  void probe();
}

let started = false;
/** Start background probing (once per page load). */
export function startNet() {
  if (started || typeof window === "undefined") return;
  started = true;
  setInterval(() => {
    if (state.mode !== "cloud") void probe();
  }, PROBE_EVERY_MS);
  window.addEventListener("online", () => void probe());
  window.addEventListener("offline", () => set({ mode: "offline" }));
}
