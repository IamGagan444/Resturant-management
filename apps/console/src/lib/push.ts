"use client";

import { useCallback, useEffect, useState } from "react";
import type { PushState } from "@rms/contracts";
import { api } from "./api";
import { getMode } from "./net";

/** Phone alerts (Web Push): they ring through a locked screen, other apps and a closed browser. */
export type AlertStatus =
  | "loading"
  | "unsupported" // this browser can't
  | "needs-install" // iPhone: only once the app is on the Home Screen
  | "ask" // not asked yet
  | "blocked" // notifications were refused in the browser
  | "on"
  | "paused" // off duty
  | "error";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

const bytes = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** This browser's subscription, made if needed (permission must be granted). Remade when the server's key changed. */
async function subscription(): Promise<PushSubscription> {
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api<{ publicKey: string }>("GET", "/v1/s/push/key");
  const key = bytes(publicKey);
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    const used = existing.options.applicationServerKey;
    if (used && new Uint8Array(used).every((x, i) => x === key[i])) return existing;
    await existing.unsubscribe();
  }
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

async function register(): Promise<PushState> {
  const { endpoint, keys } = (await subscription()).toJSON();
  return api<PushState>("POST", "/v1/s/push", { endpoint, keys });
}

async function endpoint(): Promise<string> {
  return (await subscription()).endpoint;
}

/** Take finished alerts off the lock screen. */
export async function clearNotifications() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
  for (const n of (await reg?.getNotifications?.({ tag: "rms-alerts" }).catch(() => [])) ?? []) n.close();
}

export function useAlerts(enabled: boolean) {
  const [status, setStatus] = useState<AlertStatus>("loading");

  const sync = useCallback(async () => {
    if (!supported()) return setStatus(isIos() && !installed() ? "needs-install" : "unsupported");
    if (Notification.permission === "denied") return setStatus("blocked");
    if (Notification.permission !== "granted") return setStatus("ask");
    if (getMode() !== "cloud") return; // outage: keep what we know
    try {
      setStatus((await register()).paused ? "paused" : "on");
    } catch {
      setStatus("error");
    }
  }, []);

  // on start, and whenever the phone comes back: permission may have changed, the push service may have moved us
  useEffect(() => {
    if (!enabled) return;
    void sync();
    const onVisible = () => document.visibilityState === "visible" && void sync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [enabled, sync]);

  return {
    status,
    turnOn: async () => {
      await Notification.requestPermission();
      await sync();
    },
    pause: async (paused: boolean) => {
      const s = await api<PushState>("POST", "/v1/s/push/pause", { endpoint: await endpoint(), paused });
      setStatus(s.paused ? "paused" : "on");
    },
    test: async () => api("POST", "/v1/s/push/test", { endpoint: await endpoint() }),
  };
}

interface BatteryLike extends EventTarget {
  charging: boolean;
}

/**
 * Keep the screen on, so the loud in-app ring keeps going: always on tablets and counters, and on phones while
 * charging (left on a table). Not for a phone in a pocket: the screen would be pressed by accident and eat the battery.
 */
export function useStayAwake(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let battery: BatteryLike | null = null;
    let stopped = false;
    const wide = window.matchMedia("(min-width: 768px)");
    const update = async () => {
      const want = document.visibilityState === "visible" && (wide.matches || battery?.charging === true);
      if (!want) {
        await lock?.release().catch(() => undefined);
        lock = null;
      } else if (!lock || lock.released) {
        const got = await navigator.wakeLock.request("screen").catch(() => null); // refused on low battery
        if (stopped) void got?.release();
        else lock = got;
      }
    };
    const onChange = () => void update();
    void (navigator as { getBattery?: () => Promise<BatteryLike> })
      .getBattery?.()
      .then((b) => {
        if (stopped) return;
        battery = b;
        b.addEventListener("chargingchange", onChange);
        onChange();
      })
      .catch(() => undefined);
    onChange();
    document.addEventListener("visibilitychange", onChange);
    wide.addEventListener("change", onChange);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onChange);
      wide.removeEventListener("change", onChange);
      battery?.removeEventListener("chargingchange", onChange);
      void lock?.release().catch(() => undefined);
    };
  }, [enabled]);
}
