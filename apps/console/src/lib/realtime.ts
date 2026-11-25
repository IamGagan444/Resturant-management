"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@rms/contracts";
import { refresh } from "./api";
import { target, useNet } from "./net";
import { proofFor } from "./devicekey";
import { audioOut } from "./sound";

export type StaffSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Staff socket to wherever requests currently go: the cloud (cookie auth, rooms joined server-side by role)
 * or the local hub during an outage (hub pass). No socket while fully offline.
 * `onSync` runs on every (re)connect and mode switch: screens refetch, so missed events never leave stale state.
 */
export function useStaffSocket(enabled: boolean, onSync: () => void, bind: (s: StaffSocket) => void): { online: boolean } {
  const [online, setOnline] = useState(true);
  const { mode } = useNet();
  const syncRef = useRef(onSync);
  const bindRef = useRef(bind);
  syncRef.current = onSync;
  bindRef.current = bind;

  useEffect(() => {
    if (!enabled) return;
    syncRef.current();
    if (mode === "offline") {
      setOnline(false);
      return;
    }
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const t = target();
    const token = t.headers.authorization?.slice(7);
    const s: StaffSocket = io(t.base, {
      path: "/socket.io",
      withCredentials: mode === "cloud",
      // hub: the pass plus a fresh proof from this device's key, made for every (re)connect
      auth: token
        ? (cb) => {
            void proofFor("GET", `${t.base}/socket.io/`).then(
              (proof) => cb({ token, proof }),
              () => cb({ token }),
            );
          }
        : undefined,
      transports: ["websocket", "polling"],
    });
    s.on("connect", () => {
      setOnline(true);
      syncRef.current();
    });
    s.on("disconnect", () => setOnline(false));
    s.on("connect_error", (e) => {
      setOnline(false);
      // Refused, not unreachable: the 15-minute token ran out while the phone slept. Socket.IO doesn't retry that by
      // itself, which left the screen silent until someone reloaded it.
      if (e.message !== "UNAUTHORIZED" || mode !== "cloud" || retry) return;
      void refresh().then((r) => {
        if (!stopped && r !== "denied") retry = setTimeout(() => ((retry = undefined), s.connect()), r === "ok" ? 300 : 5000);
      });
    });
    // back from the lock screen: reconnect now instead of waiting for the next retry
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!s.connected && !retry) s.connect();
      syncRef.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    bindRef.current(s);
    const goOnline = () => syncRef.current();
    window.addEventListener("online", goOnline);
    return () => {
      stopped = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", goOnline);
      s.disconnect();
    };
  }, [enabled, mode]);

  return { online: online && mode !== "offline" };
}

/** Short synthesized chime — no audio assets to download or cache. */
export function chime(kind: "order" | "alert" = "order") {
  const audio = audioOut();
  if (!audio) return;
  const notes = kind === "order" ? [880, 1175] : [988, 740, 988];
  notes.forEach((f, i) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    o.type = "sine";
    const t = audio.currentTime + i * 0.18;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + 0.17);
  });
}

export function buzz(pattern: number[] = [200, 100, 200]) {
  if ("vibrate" in navigator) navigator.vibrate(pattern);
}
