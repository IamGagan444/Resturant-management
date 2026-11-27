"use client";

import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@rms/contracts";

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * socket.io-client is ~12 kB gzipped and only needed once the guest is in a session, so it stays out of the
 * menu's first paint (guests open it cold on mobile data). It starts downloading right after hydration.
 */
let ioModule: Promise<typeof import("socket.io-client")> | null = null;
const loadIo = () => (ioModule ??= import("socket.io-client"));

/**
 * Socket for the guest's table session. Events only trigger refetches;
 * on every (re)connect we call `onSync` so state is correct even if events were missed.
 */
export function useSessionSocket(
  guestToken: string | null,
  onSync: () => void,
  bind: (s: S) => void,
): { online: boolean } {
  const [online, setOnline] = useState(true);
  const syncRef = useRef(onSync);
  const bindRef = useRef(bind);
  syncRef.current = onSync;
  bindRef.current = bind;

  useEffect(() => {
    const t = setTimeout(() => void loadIo().catch(() => undefined), 0); // warm up off the critical path
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!guestToken) return;
    let stopped = false;
    let s: S | undefined;
    const onVisible = () => document.visibilityState === "visible" && syncRef.current();
    document.addEventListener("visibilitychange", onVisible);
    loadIo().then(
      ({ io }) => {
        if (stopped) return;
        s = io(process.env.NEXT_PUBLIC_API_URL ?? "", {
          path: "/socket.io",
          auth: { guestToken },
          transports: ["websocket", "polling"],
        });
        s.on("connect", () => {
          setOnline(true);
          syncRef.current();
        });
        s.on("disconnect", () => setOnline(false));
        bindRef.current(s);
      },
      () => {
        // chunk failed to load (flaky network): no live updates this time, but returning to the tab still resyncs
        // and the next session mount retries the download
        if (!stopped) ioModule = null;
      },
    );
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisible);
      s?.disconnect();
    };
  }, [guestToken]);

  return { online };
}
