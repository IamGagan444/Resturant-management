"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NetworkError } from "@/lib/api";
import { onModeChange, startNet } from "@/lib/net";
import { onFlushed, startOutbox } from "@/lib/outbox";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // no point hammering a dead connection; net.ts re-probes and we refetch on reconnect
            retry: (n, e) => !(e instanceof NetworkError) && n < 1,
            refetchOnWindowFocus: true,
            staleTime: 5_000,
          },
        },
      }),
  );

  useEffect(() => {
    startNet();
    startOutbox();
    // switching cloud ↔ hub ↔ offline, or queued actions landing: every screen reloads its data
    const offMode = onModeChange(() => void client.invalidateQueries());
    const offFlush = onFlushed(() => void client.invalidateQueries());
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    return () => {
      offMode();
      offFlush();
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
