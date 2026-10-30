"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@rms/contracts";

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

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
    if (!guestToken) return;
    const s: S = io(process.env.NEXT_PUBLIC_API_URL ?? "", {
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
    const onVisible = () => document.visibilityState === "visible" && syncRef.current();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      s.disconnect();
    };
  }, [guestToken]);

  return { online };
}
